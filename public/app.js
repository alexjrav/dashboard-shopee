const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = new Intl.NumberFormat('pt-BR');
const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const elementos = {
  form: document.getElementById('form-periodo'),
  inicio: document.getElementById('inicio'),
  fim: document.getElementById('fim'),
  consultar: document.getElementById('consultar'),
  atalhos: document.querySelectorAll('.atalho'),
  erro: document.getElementById('erro'),
  resultado: document.getElementById('resultado'),
  descricao: document.getElementById('descricao-periodo'),
  prevista: document.getElementById('comissao-prevista'),
  confirmada: document.getElementById('comissao-confirmada'),
  validos: document.getElementById('pedidos-validos'),
  cancelados: document.getElementById('pedidos-cancelados'),
  tabelaStatus: document.getElementById('tabela-status'),
  tabelaDias: document.getElementById('tabela-dias'),
  semVendas: document.getElementById('sem-vendas'),
  atualizadoEm: document.getElementById('atualizado-em'),
  itensVendidos: document.getElementById('itens-vendidos'),
  valorPedidos: document.getElementById('valor-pedidos'),
  listaProdutos: document.getElementById('lista-produtos'),
  semProdutos: document.getElementById('sem-produtos'),
  alternarTema: document.getElementById('alternar-tema'),
  gerarPdf: document.getElementById('gerar-pdf'),
  sair: document.getElementById('sair'),
  nomeUsuario: document.getElementById('nome-usuario'),
  nomeNegocio: document.getElementById('nome-negocio'),
  cartaoRoi: document.getElementById('cartao-roi'),
  roiConfirmado: document.getElementById('roi-confirmado'),
  seloRoi: document.getElementById('selo-roi'),
  roiEstimado: document.getElementById('roi-estimado'),
  gastoAnuncios: document.getElementById('gasto-anuncios'),
  quantidadeGastos: document.getElementById('quantidade-gastos'),
  irParaGastos: document.getElementById('ir-para-gastos'),
};

const percentual = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tituloOriginal = document.title;
let periodoExibido = null;
let temaFixadoParaImpressao = false;

// Datas sempre no formato AAAA-MM-DD, no horário de Brasília.
function hoje() {
  return formatoDia.format(new Date());
}

function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function inicioDoMes(data) {
  return `${data.slice(0, 7)}-01`;
}

function periodoDoAtalho(atalho) {
  const atual = hoje();
  switch (atalho) {
    case 'hoje':
      return [atual, atual];
    case 'ontem': {
      const ontem = somarDias(atual, -1);
      return [ontem, ontem];
    }
    case '7dias':
      return [somarDias(atual, -6), atual];
    case 'mes':
      return [inicioDoMes(atual), atual];
    case 'mesPassado': {
      const fimMesPassado = somarDias(inicioDoMes(atual), -1);
      return [inicioDoMes(fimMesPassado), fimMesPassado];
    }
    default:
      return [atual, atual];
  }
}

function formatarDia(data) {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

function marcarAtalho(ativo) {
  for (const botao of elementos.atalhos) {
    botao.setAttribute('aria-pressed', String(botao.dataset.atalho === ativo));
  }
}

function linha(celulas) {
  const tr = document.createElement('tr');
  for (const [texto, classe] of celulas) {
    const td = document.createElement('td');
    td.textContent = texto;
    if (classe) td.className = classe;
    tr.append(td);
  }
  return tr;
}

function itemDoProduto(produto) {
  const li = document.createElement('li');
  li.className = 'produto';

  // Só aceita imagens servidas por https, vindas da própria Shopee.
  if (/^https:\/\//.test(produto.imagem)) {
    const imagem = document.createElement('img');
    imagem.src = produto.imagem;
    imagem.alt = '';
    // Sem carregamento tardio: imagens fora da tela sairiam em branco no PDF.
    imagem.referrerPolicy = 'no-referrer';
    li.append(imagem);
  } else {
    const vazio = document.createElement('span');
    vazio.className = 'sem-imagem';
    li.append(vazio);
  }

  const nome = document.createElement('p');
  nome.className = 'nome';
  nome.textContent = produto.nome;
  nome.title = produto.nome;

  const numeros = document.createElement('div');
  numeros.className = 'numeros';
  const itens = document.createElement('strong');
  itens.textContent = `${numero.format(produto.itens)} ${produto.itens === 1 ? 'item' : 'itens'}`;
  numeros.append(itens, moeda.format(produto.comissao));

  li.append(nome, numeros);
  return li;
}

function mostrarErro(mensagem) {
  elementos.erro.textContent = mensagem;
  elementos.erro.hidden = !mensagem;
}

// O ROI sai sempre com sinal, número e palavra, para não depender só da cor.
function textoDoRoi(roi) {
  if (roi === null || roi === undefined) return '—';
  const sinal = roi > 0 ? '+' : roi < 0 ? '−' : '';
  return `${sinal}${percentual.format(Math.abs(roi) * 100)}%`;
}

function mostrarRoi(dados) {
  const semGasto = dados.roiConfirmado === null;
  const lucro = !semGasto && dados.roiConfirmado >= 0;
  elementos.cartaoRoi.className = `cartao roi ${semGasto ? '' : lucro ? 'lucro' : 'prejuizo'}`;
  elementos.roiConfirmado.textContent = textoDoRoi(dados.roiConfirmado);
  elementos.seloRoi.textContent = semGasto
    ? 'Sem gasto registrado neste período. Registre um gasto para calcular o ROI.'
    : lucro
      ? '▲ Lucro: os anúncios renderam mais do que custaram'
      : '▼ Prejuízo: os anúncios custaram mais do que renderam';
  elementos.roiEstimado.textContent = textoDoRoi(dados.roiEstimado);
  elementos.gastoAnuncios.textContent = moeda.format(dados.gastoAnuncios);
  elementos.quantidadeGastos.textContent =
    dados.quantidadeGastos === 1 ? '1 gasto registrado' : `${numero.format(dados.quantidadeGastos)} gastos registrados`;
}

function mostrarRelatorio(dados) {
  periodoExibido = { inicio: dados.inicio, fim: dados.fim };
  mostrarRoi(dados);
  const mesmoDia = dados.inicio === dados.fim;
  elementos.descricao.textContent = mesmoDia
    ? `Resultados de ${formatarDia(dados.inicio)}`
    : `Resultados de ${formatarDia(dados.inicio)} a ${formatarDia(dados.fim)}`;

  elementos.prevista.textContent = moeda.format(dados.comissaoPrevista);
  elementos.confirmada.textContent = moeda.format(dados.comissaoConfirmada);
  elementos.validos.textContent = numero.format(dados.pedidosValidos);
  elementos.cancelados.textContent = numero.format(dados.pedidosCancelados);
  elementos.itensVendidos.textContent = numero.format(dados.itensVendidos);
  elementos.valorPedidos.textContent = moeda.format(dados.valorPedidos);

  elementos.listaProdutos.replaceChildren(...dados.topProdutos.map(itemDoProduto));
  elementos.semProdutos.hidden = dados.topProdutos.length > 0;

  elementos.tabelaStatus.replaceChildren(
    ...dados.porStatus.map((item) =>
      linha([[item.rotulo], [numero.format(item.pedidos), 'num'], [moeda.format(item.comissao), 'num']]),
    ),
  );
  // Dia mais recente primeiro, que é o que ela consulta com mais frequência.
  elementos.tabelaDias.replaceChildren(
    ...[...dados.porDia]
      .reverse()
      .map((item) =>
        linha([
          [formatarDia(item.dia)],
          [numero.format(item.pedidos), 'num'],
          [moeda.format(item.comissao), 'num'],
          [moeda.format(item.comissaoConfirmada), 'num confirmado'],
          [moeda.format(item.gasto ?? 0), 'num'],
        ]),
      ),
  );
  elementos.semVendas.hidden = dados.porDia.length > 0;

  const atualizado = new Date(dados.atualizadoEm).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  elementos.atualizadoEm.textContent = `Atualizado em ${atualizado}`;
  elementos.resultado.hidden = false;
}

async function consultar() {
  const inicio = elementos.inicio.value;
  const fim = elementos.fim.value;
  if (!inicio || !fim) {
    mostrarErro('Escolha a data inicial e a final.');
    return;
  }
  if (fim < inicio) {
    mostrarErro('A data final deve ser igual ou posterior à data inicial.');
    return;
  }

  mostrarErro('');
  atualizarLinkDeGastos(inicio, fim);
  elementos.consultar.disabled = true;
  elementos.consultar.textContent = 'Consultando...';
  try {
    const resposta = await fetch(`/api/relatorio?${new URLSearchParams({ inicio, fim })}`);
    // Sessão expirada: volta para a tela de login.
    if (resposta.status === 401) {
      window.location.replace('/login');
      return;
    }
    // Credenciais removidas em outra aba: volta para as configurações.
    if (resposta.status === 409) {
      window.location.replace('/configuracoes');
      return;
    }
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new Error(dados.erro ?? 'Não foi possível carregar o relatório.');
    }
    mostrarRelatorio(dados);
  } catch (erro) {
    mostrarErro(erro instanceof Error ? erro.message : 'Não foi possível carregar o relatório.');
  } finally {
    elementos.consultar.disabled = false;
    elementos.consultar.textContent = 'Consultar';
  }
}

// O botão de gastos leva o período escolhido para a tela de registro.
function atualizarLinkDeGastos(inicio, fim) {
  elementos.irParaGastos.href = `/gastos?${new URLSearchParams({ inicio, fim })}`;
}

// Ao voltar da tela de gastos (/?inicio=...&fim=...), reabre o mesmo período.
function abrirPeriodoInicial() {
  const parametros = new URLSearchParams(window.location.search);
  const inicio = parametros.get('inicio');
  const fim = parametros.get('fim');
  const valida = (data) => /^\d{4}-\d{2}-\d{2}$/.test(data ?? '');
  if (!valida(inicio) || !valida(fim) || fim < inicio) {
    aplicarAtalho('7dias');
    return;
  }
  const atalho = ['hoje', 'ontem', '7dias', 'mes', 'mesPassado'].find((nome) => {
    const [i, f] = periodoDoAtalho(nome);
    return i === inicio && f === fim;
  });
  if (atalho) {
    aplicarAtalho(atalho);
    return;
  }
  marcarAtalho('personalizado');
  elementos.form.hidden = false;
  elementos.inicio.value = inicio;
  elementos.fim.value = fim;
  consultar();
}

function aplicarAtalho(atalho) {
  marcarAtalho(atalho);
  // No personalizado, ela escolhe as datas e consulta quando quiser.
  if (atalho === 'personalizado') {
    elementos.form.hidden = false;
    elementos.inicio.focus();
    return;
  }
  elementos.form.hidden = true;
  const [inicio, fim] = periodoDoAtalho(atalho);
  elementos.inicio.value = inicio;
  elementos.fim.value = fim;
  consultar();
}

function temaAtual() {
  const escolhido = document.documentElement.dataset.tema;
  if (escolhido) return escolhido;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

function mostrarBotaoTema() {
  const noturno = temaAtual() === 'escuro';
  elementos.alternarTema.setAttribute('aria-pressed', String(noturno));
  elementos.alternarTema.textContent = noturno ? 'Modo noturno: ligado' : 'Modo noturno: desligado';
}

function alternarTema() {
  const novo = temaAtual() === 'escuro' ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = novo;
  try {
    localStorage.setItem('tema', novo);
  } catch {
    // Sem armazenamento, o tema vale só até fechar a página.
  }
  mostrarBotaoTema();
}

// AAAA-MM-DD vira DD-MM-AA, formato usado no nome do arquivo.
function diaParaArquivo(data) {
  const [ano, mes, dia] = data.split('-');
  return `${dia}-${mes}-${ano.slice(2)}`;
}

function nomeDoArquivo({ inicio, fim }) {
  const periodo = inicio === fim ? diaParaArquivo(inicio) : `${diaParaArquivo(inicio)}-a-${diaParaArquivo(fim)}`;
  return `relatorio-comissao-shopee-dia-${periodo}`;
}

function gerarPdf() {
  if (!periodoExibido) return;
  // O título vira o nome sugerido do arquivo ao salvar como PDF.
  document.title = nomeDoArquivo(periodoExibido);
  // Fixa o tema visto na tela, porque a impressão pode ignorar o tema do aparelho.
  temaFixadoParaImpressao = !document.documentElement.dataset.tema;
  document.documentElement.dataset.tema = temaAtual();
  window.print();
}

for (const botao of elementos.atalhos) {
  botao.addEventListener('click', () => aplicarAtalho(botao.dataset.atalho));
}

elementos.form.addEventListener('submit', (evento) => {
  evento.preventDefault();
  consultar();
});

elementos.alternarTema.addEventListener('click', alternarTema);
elementos.gerarPdf.addEventListener('click', gerarPdf);
elementos.sair.addEventListener('click', async () => {
  await fetch('/api/sair', { method: 'POST' }).catch(() => {});
  window.location.replace('/login');
});
window.addEventListener('afterprint', () => {
  document.title = tituloOriginal;
  if (temaFixadoParaImpressao) {
    delete document.documentElement.dataset.tema;
    temaFixadoParaImpressao = false;
  }
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', mostrarBotaoTema);

// Sem credenciais da Shopee, não há o que mostrar: leva direto para as configurações.
async function iniciar() {
  const resposta = await fetch('/api/eu');
  if (resposta.status === 401) {
    window.location.replace('/login');
    return;
  }
  const usuario = await resposta.json();
  if (!usuario.credenciais) {
    window.location.replace('/configuracoes');
    return;
  }
  elementos.nomeUsuario.textContent = `Olá, ${usuario.nome}`;
  elementos.nomeNegocio.textContent = usuario.nomeNegocio ?? '';
  elementos.nomeNegocio.hidden = !usuario.nomeNegocio;
  abrirPeriodoInicial();
}

elementos.inicio.max = hoje();
elementos.fim.max = hoje();
mostrarBotaoTema();
iniciar().catch(() => mostrarErro('Sem conexão. Recarregue a página.'));
