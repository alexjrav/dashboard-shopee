// Regras dos gastos com anúncios. Funções puras, testadas sem banco nem rede.
import type { NovoGasto } from './repositorio.ts';

export const MAX_DESCRICAO = 80;
// Um teto alto o bastante para qualquer gasto diário real e baixo o bastante para pegar erros de digitação.
const MAX_CENTAVOS = 100_000_00;

export class ErroGasto extends Error {
  readonly campo: 'data' | 'valor' | 'descricao';
  constructor(message: string, campo: 'data' | 'valor' | 'descricao') {
    super(message);
    this.campo = campo;
  }
}

// Aceita "25,50", "25.50", "25", "R$ 25,50" e "1.234,56". Devolve o valor em centavos, ou NaN.
// "1.234" sem vírgula é ambíguo (mil ou um real?), então é recusado.
export function lerValorEmCentavos(texto: string): number {
  const limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!/^(\d{1,3}(\.\d{3})+,\d{1,2}|\d+([.,]\d{1,2})?)$/.test(limpo)) return NaN;
  // Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto é decimal.
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const [inteiro, decimais = ''] = normalizado.split('.');
  return Number(inteiro) * 100 + Number(decimais.padEnd(2, '0'));
}

function dataValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

// hoje: data de Brasília no formato AAAA-MM-DD. Lança ErroGasto com a correção a fazer.
export function validarGasto(corpo: unknown, hoje: string): NovoGasto {
  const dados = (typeof corpo === 'object' && corpo !== null ? corpo : {}) as Record<string, unknown>;

  const data = typeof dados.data === 'string' ? dados.data.trim() : '';
  if (!data) throw new ErroGasto('Informe a data do gasto.', 'data');
  if (!dataValida(data)) throw new ErroGasto('Informe uma data válida.', 'data');
  if (data > hoje) throw new ErroGasto('A data não pode ser futura. Use hoje ou uma data anterior.', 'data');

  const textoValor = typeof dados.valor === 'number' ? String(dados.valor) : typeof dados.valor === 'string' ? dados.valor : '';
  if (!textoValor.trim()) throw new ErroGasto('Informe o valor gasto, como 25,50.', 'valor');
  const valorCentavos = lerValorEmCentavos(textoValor);
  if (Number.isNaN(valorCentavos)) throw new ErroGasto('Use só números e vírgula, como 25,50.', 'valor');
  if (valorCentavos <= 0) throw new ErroGasto('Informe um valor maior que zero, como 25,50.', 'valor');
  if (valorCentavos > MAX_CENTAVOS) throw new ErroGasto('Confira o valor: ele passa de R$ 100.000,00.', 'valor');

  const descricao = typeof dados.descricao === 'string' ? dados.descricao.replace(/\s+/g, ' ').trim() : '';
  if (descricao.length > MAX_DESCRICAO) {
    throw new ErroGasto(`Use no máximo ${MAX_DESCRICAO} caracteres na descrição.`, 'descricao');
  }

  return { data, valorCentavos, descricao: descricao || null };
}
