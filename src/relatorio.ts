import type { Conversao } from './shopee.ts';

// Os valores chegam como texto com até 5 casas decimais ("0.41985").
// Os cálculos usam inteiros nessa escala para não acumular erro de arredondamento.
const CASAS_DECIMAIS = 5;
const ESCALA = 10 ** CASAS_DECIMAIS;
const TOP_PRODUTOS = 5;

// O Brasil não tem horário de verão desde 2019, então Brasília é sempre UTC-3.
const DESLOCAMENTO_BRASILIA = '-03:00';
const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const STATUS_CONFIRMADO = 'COMPLETED';
const STATUS_CANCELADO = 'CANCELLED';
const STATUS_VARIOS = 'VARIOS';
const ORDEM_DOS_STATUS = ['COMPLETED', 'PENDING', 'UNPAID', 'CANCELLED', STATUS_VARIOS];
const ROTULOS: Record<string, string> = {
  COMPLETED: 'Concluído',
  PENDING: 'Pendente',
  UNPAID: 'Aguardando pagamento',
  CANCELLED: 'Cancelado',
  [STATUS_VARIOS]: 'Vários status',
};

export class ErroPeriodo extends Error {}

export type LinhaStatus = { status: string; rotulo: string; pedidos: number; comissao: number };
export type LinhaDia = { dia: string; pedidos: number; comissao: number; comissaoConfirmada: number };
export type Produto = { itemId: number; nome: string; imagem: string; itens: number; comissao: number };

export type Resumo = {
  comissaoPrevista: number;
  comissaoConfirmada: number;
  pedidosValidos: number;
  pedidosCancelados: number;
  itensVendidos: number;
  valorPedidos: number;
  porStatus: LinhaStatus[];
  porDia: LinhaDia[];
  topProdutos: Produto[];
};

export function lerComissao(valor: string): number {
  const partes = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valor.trim());
  if (!partes) {
    throw new Error(`Valor de comissão inválido: ${valor}`);
  }
  const [, sinal, inteiro, decimais = ''] = partes;
  const fracao = Number(decimais.slice(0, CASAS_DECIMAIS).padEnd(CASAS_DECIMAIS, '0'));
  const total = Number(inteiro) * ESCALA + fracao;
  return sinal ? -total : total;
}

// Para campos que podem faltar ou vir vazios: contam como zero.
function lerValorOpcional(valor: string | undefined): number {
  return valor ? lerComissao(valor) : 0;
}

function emReais(valorNaEscala: number): number {
  return Math.round(valorNaEscala / (ESCALA / 100)) / 100;
}

export function diaEmBrasilia(timestamp: number): string {
  return formatoDia.format(new Date(timestamp * 1000));
}

function dataValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return false;
  }
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

export function intervaloDoPeriodo(inicio: string, fim: string) {
  if (!dataValida(inicio) || !dataValida(fim)) {
    throw new ErroPeriodo('Informe as datas no formato AAAA-MM-DD.');
  }
  const inicioTs = Date.parse(`${inicio}T00:00:00${DESLOCAMENTO_BRASILIA}`) / 1000;
  const fimTs = Date.parse(`${fim}T23:59:59${DESLOCAMENTO_BRASILIA}`) / 1000;
  if (fimTs < inicioTs) {
    throw new ErroPeriodo('A data final deve ser igual ou posterior à data inicial.');
  }
  return { inicioTs, fimTs };
}

function statusDaConversao(conversao: Conversao): string {
  const status = new Set(conversao.orders.map((pedido) => pedido.orderStatus));
  return status.size === 1 ? [...status][0] : STATUS_VARIOS;
}

export function resumir(conversoes: Conversao[]): Resumo {
  // Páginas consecutivas podem repetir uma conversão; cada uma conta só uma vez.
  const unicas = new Map(conversoes.map((c) => [c.conversionId, c]));

  const porStatus = new Map<string, { pedidos: number; comissao: number }>();
  const porDia = new Map<string, { pedidos: number; comissao: number; confirmada: number }>();
  const produtos = new Map<number, Produto>();
  let prevista = 0;
  let confirmada = 0;
  let pedidosValidos = 0;
  let pedidosCancelados = 0;
  let itensVendidos = 0;
  let valorPedidos = 0;

  for (const conversao of unicas.values()) {
    const status = statusDaConversao(conversao);
    const comissao = lerComissao(conversao.totalCommission);
    const pedidos = conversao.orders.length;

    const linhaStatus = porStatus.get(status) ?? { pedidos: 0, comissao: 0 };
    linhaStatus.pedidos += pedidos;
    linhaStatus.comissao += comissao;
    porStatus.set(status, linhaStatus);

    if (status === STATUS_CANCELADO) {
      pedidosCancelados += pedidos;
      continue;
    }

    prevista += comissao;
    pedidosValidos += pedidos;
    if (status === STATUS_CONFIRMADO) {
      confirmada += comissao;
    }

    const dia = diaEmBrasilia(conversao.purchaseTime);
    const linhaDia = porDia.get(dia) ?? { pedidos: 0, comissao: 0, confirmada: 0 };
    linhaDia.pedidos += pedidos;
    linhaDia.comissao += comissao;
    if (status === STATUS_CONFIRMADO) {
      linhaDia.confirmada += comissao;
    }
    porDia.set(dia, linhaDia);

    for (const pedido of conversao.orders) {
      for (const item of pedido.items ?? []) {
        itensVendidos += item.qty;
        // actualAmount é o valor pago; conferido com o "Valor do pedido" do painel da Shopee.
        valorPedidos += lerValorOpcional(item.actualAmount);

        const produto = produtos.get(item.itemId) ?? {
          itemId: item.itemId,
          nome: item.itemName,
          imagem: item.imageUrl,
          itens: 0,
          comissao: 0,
        };
        produto.itens += item.qty;
        produto.comissao += lerValorOpcional(item.itemTotalCommission);
        produtos.set(item.itemId, produto);
      }
    }
  }

  const posicao = (status: string) => {
    const indice = ORDEM_DOS_STATUS.indexOf(status);
    return indice === -1 ? ORDEM_DOS_STATUS.length : indice;
  };

  return {
    comissaoPrevista: emReais(prevista),
    comissaoConfirmada: emReais(confirmada),
    pedidosValidos,
    pedidosCancelados,
    itensVendidos,
    valorPedidos: emReais(valorPedidos),
    porStatus: [...porStatus.entries()]
      .sort(([a], [b]) => posicao(a) - posicao(b))
      .map(([status, linha]) => ({
        status,
        rotulo: ROTULOS[status] ?? status,
        pedidos: linha.pedidos,
        comissao: emReais(linha.comissao),
      })),
    porDia: [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, linha]) => ({
        dia,
        pedidos: linha.pedidos,
        comissao: emReais(linha.comissao),
        comissaoConfirmada: emReais(linha.confirmada),
      })),
    topProdutos: [...produtos.values()]
      .sort((a, b) => b.itens - a.itens || b.comissao - a.comissao)
      .slice(0, TOP_PRODUTOS)
      .map((produto) => ({ ...produto, comissao: emReais(produto.comissao) })),
  };
}
