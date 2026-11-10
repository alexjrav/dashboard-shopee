import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErroGasto, lerValorEmCentavos, validarGasto } from '../src/gastos.ts';
import { diaEmBrasilia, incluirGastos, resumir } from '../src/relatorio.ts';
import type { Conversao } from '../src/shopee.ts';

const HOJE = '2026-11-10';

// --- Leitura do valor ---

test('lê o valor em reais nos formatos que a pessoa costuma digitar', () => {
  assert.equal(lerValorEmCentavos('25,50'), 2550);
  assert.equal(lerValorEmCentavos('25.50'), 2550);
  assert.equal(lerValorEmCentavos('25,5'), 2550);
  assert.equal(lerValorEmCentavos('25'), 2500);
  assert.equal(lerValorEmCentavos('R$ 25,50'), 2550);
  assert.equal(lerValorEmCentavos('1.234,56'), 123456);
  assert.equal(lerValorEmCentavos('0,10'), 10);
});

test('recusa valores em formato ambíguo ou inválido', () => {
  for (const texto of ['abc', '25,555', '1.234', '-10', '2,5,0', '']) {
    assert.ok(Number.isNaN(lerValorEmCentavos(texto)), texto);
  }
});

// --- Validação do gasto ---

test('aceita um gasto válido e limpa a descrição', () => {
  assert.deepEqual(validarGasto({ data: '2026-11-10', valor: '25,50', descricao: '  Anúncio   do dia ' }, HOJE), {
    data: '2026-11-10',
    valorCentavos: 2550,
    descricao: 'Anúncio do dia',
  });
  assert.equal(validarGasto({ data: '2026-11-09', valor: '10' }, HOJE).descricao, null);
});

test('recusa gasto inválido dizendo o campo e como corrigir', () => {
  const casos: Array<[unknown, ErroGasto['campo'], RegExp]> = [
    [{ valor: '10' }, 'data', /data/],
    [{ data: '2026-02-30', valor: '10' }, 'data', /válida/],
    [{ data: '2026-11-11', valor: '10' }, 'data', /futura/],
    [{ data: HOJE, valor: '' }, 'valor', /25,50/],
    [{ data: HOJE, valor: '0' }, 'valor', /maior que zero/],
    [{ data: HOJE, valor: 'abc' }, 'valor', /números/],
    [{ data: HOJE, valor: '200000' }, 'valor', /Confira/],
    [{ data: HOJE, valor: '10', descricao: 'x'.repeat(81) }, 'descricao', /80/],
    [null, 'data', /data/],
  ];
  for (const [corpo, campo, mensagem] of casos) {
    assert.throws(
      () => validarGasto(corpo, HOJE),
      (erro: unknown) => erro instanceof ErroGasto && erro.campo === campo && mensagem.test(erro.message),
      JSON.stringify(corpo),
    );
  }
});

// --- ROI ---

function conversao(id: number, purchaseTime: number, totalCommission: string, status: string): Conversao {
  return { conversionId: id, purchaseTime, totalCommission, orders: [{ orderId: `P${id}`, orderStatus: status }] };
}

const MOMENTO = 1794000000;
const DIA_DA_VENDA = diaEmBrasilia(MOMENTO);

// Comissão confirmada R$ 105,00 e prevista R$ 150,00 (o mesmo cenário do protótipo de teste).
const RESUMO = resumir([conversao(1, MOMENTO, '105.00', 'COMPLETED'), conversao(2, MOMENTO, '45.00', 'PENDING')]);

test('calcula o ROI confirmado e o estimado pela fórmula (comissão − gasto) ÷ gasto', () => {
  const comPrejuizo = incluirGastos(RESUMO, [
    { data: DIA_DA_VENDA, valorCentavos: 9450 },
    { data: DIA_DA_VENDA, valorCentavos: 2550 },
  ]);
  assert.equal(comPrejuizo.gastoAnuncios, 120);
  assert.equal(comPrejuizo.quantidadeGastos, 2);
  assert.equal(comPrejuizo.roiConfirmado, -0.125); // −12,50%: prejuízo
  assert.equal(comPrejuizo.roiEstimado, 0.25); // +25,00% com a comissão prevista

  const comLucro = incluirGastos(RESUMO, [{ data: DIA_DA_VENDA, valorCentavos: 9450 }]);
  assert.equal(comLucro.roiConfirmado, 0.1111); // +11,11%
});

test('sem gasto no período, o ROI fica vazio em vez de dividir por zero', () => {
  const resumo = incluirGastos(RESUMO, []);
  assert.equal(resumo.gastoAnuncios, 0);
  assert.equal(resumo.roiConfirmado, null);
  assert.equal(resumo.roiEstimado, null);
});

test('soma o gasto de cada dia e mostra dias que só tiveram gasto', () => {
  const resumo = incluirGastos(RESUMO, [
    { data: '2026-11-01', valorCentavos: 3000 },
    { data: DIA_DA_VENDA, valorCentavos: 1000 },
    { data: DIA_DA_VENDA, valorCentavos: 500 },
  ]);
  assert.deepEqual(
    resumo.porDia.map(({ dia, pedidos, gasto }) => ({ dia, pedidos, gasto })),
    [
      { dia: '2026-11-01', pedidos: 0, gasto: 30 },
      { dia: DIA_DA_VENDA, pedidos: 2, gasto: 15 },
    ],
  );
});
