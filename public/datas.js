// Datas usadas pelas telas, sempre no formato AAAA-MM-DD e no horário de Brasília.
// Antes ficavam copiadas em app.js e gastos.js; agora as duas telas usam este módulo.
const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function hoje(agora = new Date()) {
  return formatoDia.format(agora);
}

export function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

export function inicioDoMes(data) {
  return `${data.slice(0, 7)}-01`;
}

// AAAA-MM-DD vira DD/MM/AAAA.
export function formatarDia(data) {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Mesma regra do servidor: formato certo e dia que existe no calendário (recusa 30/02).
export function dataValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

// Período passado entre as telas pelo endereço (?inicio=...&fim=...). Devolve null se faltar ou for inválido.
export function periodoDoEndereco(busca) {
  const parametros = new URLSearchParams(busca);
  const inicio = parametros.get('inicio');
  const fim = parametros.get('fim');
  if (!dataValida(inicio) || !dataValida(fim) || fim < inicio) return null;
  return { inicio, fim };
}
