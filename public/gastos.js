// Tela de registro dos gastos com anúncios. Recebe o período do painel pelo endereço
// (/gastos?inicio=AAAA-MM-DD&fim=AAAA-MM-DD) e devolve para o painel no mesmo período.
import { ativarMascaraDeValor } from './valor.js';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const elementos = {
  nomeNegocio: document.getElementById('nome-negocio'),
  descricaoPeriodo: document.getElementById('descricao-periodo'),
  form: document.getElementById('form-gasto'),
  data: document.getElementById('gasto-data'),
  valor: document.getElementById('gasto-valor'),
  descricao: document.getElementById('gasto-descricao'),
  contador: document.getElementById('contador-descricao'),
  salvar: document.getElementById('salvar-gasto'),
  salvo: document.getElementById('gasto-salvo'),
  verRoi: document.getElementById('ver-roi'),
  voltar: document.getElementById('voltar'),
  lista: document.getElementById('lista-gastos'),
  semGastos: document.getElementById('sem-gastos'),
  erroLista: document.getElementById('erro-lista'),
  total: document.getElementById('total-gastos'),
  confirmar: document.getElementById('confirmar-exclusao'),
  textoExclusao: document.getElementById('texto-exclusao'),
  cancelar: document.getElementById('cancelar-exclusao'),
  excluir: document.getElementById('confirmar-exclusao-botao'),
};
const erros = {
  data: document.getElementById('erro-gasto-data'),
  valor: document.getElementById('erro-gasto-valor'),
  descricao: document.getElementById('erro-gasto-descricao'),
};
const campos = { data: elementos.data, valor: elementos.valor, descricao: elementos.descricao };

let gastoParaExcluir = null;
let botaoQueAbriu = null;

function hoje() {
  return formatoDia.format(new Date());
}

function formatarDia(data) {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

const dataValida = (texto) => /^\d{4}-\d{2}-\d{2}$/.test(texto ?? '');

// Período vindo do painel; sem ele (ou inválido), usa o mês atual até hoje.
function lerPeriodo() {
  const parametros = new URLSearchParams(window.location.search);
  const inicio = parametros.get('inicio');
  const fim = parametros.get('fim');
  if (dataValida(inicio) && dataValida(fim) && inicio <= fim) return { inicio, fim };
  const atual = hoje();
  return { inicio: `${atual.slice(0, 7)}-01`, fim: atual };
}

const periodo = lerPeriodo();
const enderecoDoPainel = `/?${new URLSearchParams(periodo)}`;

function mostrarErroDoCampo(campo, mensagem) {
  for (const [nome, elemento] of Object.entries(erros)) {
    const ativo = nome === campo && Boolean(mensagem);
    elemento.textContent = ativo ? `⚠ ${mensagem}` : '';
    elemento.hidden = !ativo;
    campos[nome].setAttribute('aria-invalid', String(ativo));
  }
}

function itemDoGasto(gasto) {
  const li = document.createElement('li');
  const texto = document.createElement('div');
  const dia = document.createElement('strong');
  dia.textContent = formatarDia(gasto.data).slice(0, 5);
  // textContent: a descrição digitada aparece como texto, nunca como código.
  texto.append(dia, ` · ${gasto.descricao ?? 'Sem descrição'}`);

  const valor = document.createElement('span');
  valor.className = 'valor-gasto';
  valor.textContent = moeda.format(gasto.valorCentavos / 100);

  const acoes = document.createElement('div');
  acoes.className = 'acoes-gasto';
  const excluir = document.createElement('button');
  excluir.type = 'button';
  excluir.className = 'botao-perigo';
  excluir.textContent = 'Excluir';
  excluir.setAttribute('aria-label', `Excluir gasto de ${valor.textContent} de ${formatarDia(gasto.data)}`);
  excluir.addEventListener('click', () => pedirExclusao(gasto, excluir));
  acoes.append(excluir);

  li.append(texto, valor, acoes);
  return li;
}

async function carregarGastos() {
  try {
    const resposta = await fetch(`/api/gastos?${new URLSearchParams(periodo)}`);
    if (resposta.status === 401) {
      window.location.replace('/login');
      return;
    }
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro);
    elementos.lista.replaceChildren(...dados.gastos.map(itemDoGasto));
    elementos.semGastos.hidden = dados.gastos.length > 0;
    elementos.total.textContent = moeda.format(dados.totalCentavos / 100);
    elementos.erroLista.hidden = true;
  } catch {
    elementos.erroLista.textContent = 'Não foi possível carregar os gastos. Recarregue a página.';
    elementos.erroLista.hidden = false;
  }
}

function mostrarAviso(mensagem) {
  elementos.salvo.textContent = mensagem;
  elementos.salvo.hidden = false;
  elementos.verRoi.hidden = false;
}

async function salvarGasto() {
  mostrarErroDoCampo(null, '');
  elementos.salvo.hidden = true;
  elementos.salvar.disabled = true;
  elementos.salvar.textContent = 'Salvando...';
  try {
    const resposta = await fetch('/api/gastos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: elementos.data.value,
        valor: elementos.valor.value,
        descricao: elementos.descricao.value,
      }),
    });
    if (resposta.status === 401) {
      window.location.replace('/login');
      return;
    }
    const dados = await resposta.json();
    if (!resposta.ok) {
      const campo = dados.campo ?? 'valor';
      mostrarErroDoCampo(campo, dados.erro ?? 'Não foi possível salvar o gasto.');
      campos[campo].focus();
      return;
    }
    const { data } = dados.gasto;
    elementos.valor.value = '';
    elementos.descricao.value = '';
    elementos.contador.textContent = '0/80';
    const dentro = data >= periodo.inicio && data <= periodo.fim;
    mostrarAviso(
      dentro
        ? 'Gasto salvo. ROI atualizado.'
        : `Gasto salvo em ${formatarDia(data)}, fora do período desta tela. Ele aparece no painel quando o período incluir essa data.`,
    );
    await carregarGastos();
  } catch {
    mostrarErroDoCampo('valor', 'Sem conexão. Tente salvar de novo.');
  } finally {
    elementos.salvar.disabled = false;
    elementos.salvar.textContent = 'Salvar gasto';
  }
}

function pedirExclusao(gasto, botao) {
  gastoParaExcluir = gasto;
  botaoQueAbriu = botao;
  elementos.textoExclusao.textContent =
    `Excluir o gasto de ${moeda.format(gasto.valorCentavos / 100)} de ${formatarDia(gasto.data)}? Esta ação não pode ser desfeita.`;
  elementos.confirmar.hidden = false;
  elementos.confirmar.scrollIntoView({ block: 'center' });
  elementos.cancelar.focus();
}

function fecharExclusao() {
  elementos.confirmar.hidden = true;
  gastoParaExcluir = null;
  botaoQueAbriu?.focus();
}

async function excluirGasto() {
  if (!gastoParaExcluir) return;
  elementos.excluir.disabled = true;
  try {
    const resposta = await fetch(`/api/gastos/${encodeURIComponent(gastoParaExcluir.id)}`, { method: 'DELETE' });
    if (resposta.status === 401) {
      window.location.replace('/login');
      return;
    }
    elementos.confirmar.hidden = true;
    gastoParaExcluir = null;
    mostrarAviso(resposta.ok ? 'Gasto excluído. ROI atualizado.' : 'Esse gasto já não existia.');
    await carregarGastos();
  } catch {
    elementos.textoExclusao.textContent = 'Sem conexão. Tente excluir de novo.';
  } finally {
    elementos.excluir.disabled = false;
  }
}

elementos.form.addEventListener('submit', (evento) => {
  evento.preventDefault();
  salvarGasto();
});
ativarMascaraDeValor(elementos.valor);
elementos.descricao.addEventListener('input', () => {
  elementos.contador.textContent = `${elementos.descricao.value.length}/80`;
});
elementos.cancelar.addEventListener('click', fecharExclusao);
elementos.excluir.addEventListener('click', excluirGasto);

async function iniciar() {
  const resposta = await fetch('/api/eu');
  if (resposta.status === 401) {
    window.location.replace('/login');
    return;
  }
  const usuario = await resposta.json();
  elementos.nomeNegocio.textContent = usuario.nomeNegocio || `Olá, ${usuario.nome}`;
}

elementos.descricaoPeriodo.textContent =
  periodo.inicio === periodo.fim
    ? `Período: ${formatarDia(periodo.inicio)}`
    : `Período: ${formatarDia(periodo.inicio).slice(0, 5)} a ${formatarDia(periodo.fim)}`;
elementos.verRoi.href = enderecoDoPainel;
elementos.voltar.href = enderecoDoPainel;
// A data sugerida é hoje, desde que caiba no período; senão, o último dia dele.
elementos.data.value = periodo.fim < hoje() ? periodo.fim : hoje();
elementos.data.max = hoje();
iniciar().catch(() => {});
carregarGastos();
