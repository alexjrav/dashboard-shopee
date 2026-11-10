import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { diaEmBrasilia, ErroPeriodo, intervaloDoPeriodo, lerComissao, resumir } from '../src/relatorio.ts';
import type { Conversao } from '../src/shopee.ts';

function conversao(id: number, purchaseTime: number, totalCommission: string, ...status: string[]): Conversao {
  return {
    conversionId: id,
    purchaseTime,
    totalCommission,
    orders: status.map((orderStatus, i) => ({ orderId: `P${id}-${i}`, orderStatus })),
  };
}

test('lê a comissão sem perder casas decimais', () => {
  assert.equal(lerComissao('0.41985'), 41985);
  assert.equal(lerComissao('42.91875'), 4291875);
  assert.equal(lerComissao('0'), 0);
  assert.equal(lerComissao('1.5'), 150000);
  assert.throws(() => lerComissao('abc'));
});

test('soma valores pequenos sem erro de arredondamento', () => {
  const muitas = Array.from({ length: 10 }, (_, i) => conversao(i, 1794000000, '0.1', 'PENDING'));
  assert.equal(resumir(muitas).comissaoPrevista, 1);
});

test('agrupa pelo dia de Brasília, não pelo dia UTC', () => {
  // 08/11/2026 02:37 em UTC é 07/11/2026 23:37 em Brasília.
  assert.equal(diaEmBrasilia(1794105423), '2026-11-07');
});

test('converte o período para o dia inteiro em Brasília', () => {
  const { inicioTs, fimTs } = intervaloDoPeriodo('2026-11-07', '2026-11-07');
  assert.equal(inicioTs, Date.parse('2026-11-07T03:00:00Z') / 1000);
  assert.equal(fimTs, Date.parse('2026-11-08T02:59:59Z') / 1000);
});

test('rejeita períodos inválidos', () => {
  assert.throws(() => intervaloDoPeriodo('2026-02-30', '2026-03-01'), ErroPeriodo);
  assert.throws(() => intervaloDoPeriodo('07/11/2026', '2026-11-08'), ErroPeriodo);
  assert.throws(() => intervaloDoPeriodo('2026-11-08', '2026-11-07'), ErroPeriodo);
});

test('separa comissão prevista, confirmada e cancelada', () => {
  const resumo = resumir([
    conversao(1, 1794000000, '2.00000', 'COMPLETED'),
    conversao(2, 1794000000, '1.00000', 'PENDING'),
    conversao(3, 1794000000, '0.50000', 'UNPAID'),
    conversao(4, 1794000000, '0', 'CANCELLED'),
  ]);
  assert.equal(resumo.comissaoPrevista, 3.5);
  assert.equal(resumo.comissaoConfirmada, 2);
  assert.equal(resumo.pedidosValidos, 3);
  assert.equal(resumo.pedidosCancelados, 1);
  assert.deepEqual(
    resumo.porStatus.map((s) => s.status),
    ['COMPLETED', 'PENDING', 'UNPAID', 'CANCELLED'],
  );
});

test('separa a comissão confirmada de cada dia', () => {
  // 1794000000 cai em 06/11/2026 e 1793900000 em 05/11/2026, no horário de Brasília.
  const resumo = resumir([
    conversao(1, 1794000000, '2', 'COMPLETED'),
    conversao(2, 1794000000, '1', 'PENDING'),
    conversao(3, 1793900000, '0.5', 'COMPLETED'),
  ]);
  assert.deepEqual(
    resumo.porDia.map((d) => [d.dia, d.comissao, d.comissaoConfirmada]),
    [['2026-11-05', 0.5, 0.5], ['2026-11-06', 3, 2]],
  );
});

test('conta uma conversão repetida entre páginas só uma vez', () => {
  const repetida = conversao(1, 1794000000, '1', 'PENDING');
  assert.equal(resumir([repetida, repetida]).comissaoPrevista, 1);
});

test('marca conversões com pedidos em status diferentes', () => {
  const resumo = resumir([conversao(1, 1794000000, '1', 'PENDING', 'COMPLETED')]);
  assert.equal(resumo.porStatus[0].rotulo, 'Vários status');
  assert.equal(resumo.pedidosValidos, 2);
});

test('bate com os totais da resposta real salva', async (t) => {
  let conteudo: string;
  try {
    conteudo = await readFile(new URL('../resposta.json', import.meta.url), 'utf8');
  } catch {
    t.skip('resposta.json não encontrado');
    return;
  }
  const resumo = resumir(JSON.parse(conteudo).data.conversionReport.nodes);
  assert.equal(resumo.comissaoPrevista, 75.22);
  assert.equal(resumo.comissaoConfirmada, 0);
  assert.equal(resumo.pedidosValidos, 45);
  assert.equal(resumo.pedidosCancelados, 5);
  assert.deepEqual(resumo.porDia, [
    { dia: '2026-11-06', pedidos: 7, comissao: 11.96, comissaoConfirmada: 0 },
    { dia: '2026-11-07', pedidos: 38, comissao: 63.26, comissaoConfirmada: 0 },
  ]);
});

function comItens(base: Conversao, ...itens: Array<[number, number, string, string]>): Conversao {
  base.orders[0].items = itens.map(([itemId, qty, actualAmount, itemTotalCommission]) => ({
    itemId,
    itemName: `Produto ${itemId}`,
    imageUrl: '',
    qty,
    actualAmount,
    itemTotalCommission,
  }));
  return base;
}

test('soma itens e valor dos pedidos sem contar cancelados', () => {
  const resumo = resumir([
    comItens(conversao(1, 1794000000, '1', 'PENDING'), [10, 2, '19.90', '0.60'], [20, 1, '9.90', '0.40']),
    comItens(conversao(2, 1794000000, '0', 'CANCELLED'), [10, 5, '49.50', '0']),
  ]);
  assert.equal(resumo.itensVendidos, 3);
  assert.equal(resumo.valorPedidos, 29.8);
});

test('ordena o top de produtos por itens e depois por comissão', () => {
  const resumo = resumir([
    comItens(conversao(1, 1794000000, '1', 'PENDING'), [10, 1, '10', '0.50'], [20, 3, '30', '0.30']),
    comItens(conversao(2, 1794000000, '1', 'UNPAID'), [10, 2, '20', '1.00'], [30, 3, '30', '0.90']),
  ]);
  assert.deepEqual(
    resumo.topProdutos.map((p) => [p.itemId, p.itens, p.comissao]),
    [[10, 3, 1.5], [30, 3, 0.9], [20, 3, 0.3]],
  );
});

test('trata valor pago e comissão de item vazios como zero', () => {
  const resumo = resumir([comItens(conversao(1, 1794000000, '1', 'PENDING'), [10, 1, '', ''])]);
  assert.equal(resumo.valorPedidos, 0);
  assert.equal(resumo.topProdutos[0].comissao, 0);
});
