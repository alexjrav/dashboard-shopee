// Rotas da aplicação, no formato padrão Request → Response (Cloudflare Workers).
// As dependências externas (banco, Google, Shopee, arquivos) chegam pelo Ambiente,
// o que permite testar tudo sem rede.
import {
  apagarCookieOAuth,
  cookieDeSaida,
  criarCookieDeSessao,
  criarCookieOAuth,
  lerCookieOAuth,
  lerSessao,
  textoAleatorio,
} from './autenticacao.ts';
import { cifrar, decifrar } from './cifra.ts';
import { ErroGasto, validarGasto } from './gastos.ts';
import { desafioPkce, urlDeAutorizacao, type PerfilGoogle } from './google.ts';
import { diaEmBrasilia, ErroPeriodo, incluirGastos, intervaloDoPeriodo, resumir } from './relatorio.ts';
import type { Repositorio, Usuario } from './repositorio.ts';
import type { FonteDeConversoes } from './shopee.ts';

export type Ambiente = {
  segredoDaSessao: string | undefined;
  chaveCriptografia: string | undefined;
  googleClientId: string | undefined;
  // E-mails que podem criar conta e entrar, separados por vírgula. Sem a lista, nada é liberado.
  emailsPermitidos: string | undefined;
  repositorio: Repositorio;
  trocarCodigoGoogle: (codigo: string, verificador: string, redirectUri: string) => Promise<PerfilGoogle>;
  criarFonte: (appId: string, secret: string) => FonteDeConversoes;
  validarCredenciais: (appId: string, secret: string) => Promise<void>;
  servirArquivo: (requisicao: Request) => Promise<Response>;
  // Só no computador: libera /auth/dev para testar sem conta Google.
  modoDesenvolvimento?: boolean;
  // Relógio substituível nos testes (milissegundos, como Date.now).
  agora?: () => number;
};

type Configuracao = { segredo: string; chave: string; clientId: string; permitidos: Set<string> };

function lerEmailsPermitidos(lista: string): Set<string> {
  return new Set(
    lista
      .split(/[,;\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Arquivos que a tela de login precisa antes de a pessoa entrar.
const CAMINHOS_PUBLICOS = new Set(['/login', '/login.html', '/login.js', '/estilo.css', '/tema.js']);

// Política de segurança de conteúdo: o navegador só executa scripts e estilos vindos do próprio site,
// só conversa com o próprio servidor e não deixa outro site exibir o painel dentro de um frame.
// Imagens https ficam liberadas porque as fotos do Top 5 vêm do servidor de imagens da Shopee.
const POLITICA_DE_CONTEUDO = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https: data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const CABECALHOS_DE_SEGURANCA: Record<string, string> = {
  'Content-Security-Policy': POLITICA_DE_CONTEUDO,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// Aplica os cabeçalhos em toda resposta (páginas, arquivos, API e redirecionamentos).
// A resposta é recriada porque as que vêm dos arquivos estáticos têm cabeçalhos imutáveis.
function comCabecalhosDeSeguranca(resposta: Response): Response {
  const headers = new Headers(resposta.headers);
  for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) headers.set(nome, valor);
  return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers });
}
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1']);
const USUARIO_DE_DESENVOLVIMENTO: Usuario = { id: 'dev', email: 'dev@localhost', nome: 'Usuário de teste' };

function permitido(usuario: Usuario, config: Configuracao, ambiente: Ambiente): boolean {
  if (ambiente.modoDesenvolvimento && usuario.id === USUARIO_DE_DESENVOLVIMENTO.id) return true;
  return config.permitidos.has(usuario.email.toLowerCase());
}

function json(status: number, corpo: unknown, cabecalhos?: HeadersInit) {
  const headers = new Headers(cabecalhos);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(corpo), { status, headers });
}

function redirecionar(destino: string, cookies: string[] = []) {
  const headers = new Headers({ Location: destino });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function semConteudo(cookies: string[] = []) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 204, headers });
}

async function iniciarLoginGoogle(url: URL, config: Configuracao, seguro: boolean) {
  const estado = textoAleatorio();
  const verificador = textoAleatorio(48);
  const destino = urlDeAutorizacao(
    config.clientId,
    `${url.origin}/auth/google/callback`,
    estado,
    await desafioPkce(verificador),
  );
  return redirecionar(destino, [await criarCookieOAuth(config.segredo, { estado, verificador }, seguro)]);
}

async function concluirLoginGoogle(requisicao: Request, url: URL, ambiente: Ambiente, config: Configuracao, seguro: boolean) {
  const apagarOAuth = apagarCookieOAuth(seguro);
  if (url.searchParams.has('error')) {
    return redirecionar('/login?erro=cancelado', [apagarOAuth]);
  }
  const dados = await lerCookieOAuth(requisicao.headers.get('Cookie'), config.segredo);
  const codigo = url.searchParams.get('code');
  if (!dados || !codigo || dados.estado !== url.searchParams.get('state')) {
    return redirecionar('/login?erro=expirado', [apagarOAuth]);
  }
  try {
    const perfil = await ambiente.trocarCodigoGoogle(codigo, dados.verificador, `${url.origin}/auth/google/callback`);
    // Quem não está na lista não chega a ser cadastrado.
    if (!config.permitidos.has(perfil.email.toLowerCase())) {
      return redirecionar('/login?erro=nao-autorizado', [apagarOAuth]);
    }
    await ambiente.repositorio.salvarUsuario(perfil);
    return redirecionar('/', [apagarOAuth, await criarCookieDeSessao(config.segredo, perfil.id, seguro)]);
  } catch (erro) {
    console.error(erro);
    return redirecionar('/login?erro=google', [apagarOAuth]);
  }
}

async function relatorio(url: URL, usuario: Usuario, ambiente: Ambiente, config: Configuracao) {
  const credenciais = await ambiente.repositorio.buscarCredenciais(usuario.id);
  if (!credenciais) {
    return json(409, { erro: 'Cadastre suas credenciais da Shopee.', semCredenciais: true });
  }
  const inicio = url.searchParams.get('inicio') ?? '';
  const fim = url.searchParams.get('fim') ?? '';
  try {
    const { inicioTs, fimTs } = intervaloDoPeriodo(inicio, fim);
    const secret = await decifrar(credenciais.secretCifrado, config.chave);
    const conversoes = await ambiente.criarFonte(credenciais.appId, secret)(inicioTs, fimTs);
    const gastos = await ambiente.repositorio.listarGastos(usuario.id, inicio, fim);
    return json(200, { inicio, fim, atualizadoEm: new Date().toISOString(), ...incluirGastos(resumir(conversoes), gastos) });
  } catch (erro) {
    if (erro instanceof ErroPeriodo) {
      return json(400, { erro: erro.message });
    }
    console.error(erro);
    return json(502, { erro: 'Não foi possível consultar a Shopee agora. Tente novamente em instantes.' });
  }
}

const MAX_NOME_NEGOCIO = 80;

// Nome vazio apaga o nome do negócio.
async function salvarNomeNegocio(requisicao: Request, usuario: Usuario, ambiente: Ambiente) {
  let nome = '';
  try {
    const corpo = (await requisicao.json()) as { nome?: unknown };
    nome = typeof corpo.nome === 'string' ? corpo.nome.replace(/\s+/g, ' ').trim() : '';
  } catch {
    return json(400, { erro: 'Envie o nome do negócio.' });
  }
  if (nome.length > MAX_NOME_NEGOCIO) {
    return json(400, { erro: `Use no máximo ${MAX_NOME_NEGOCIO} caracteres.` });
  }
  await ambiente.repositorio.salvarNomeNegocio(usuario.id, nome || null);
  return json(200, { nomeNegocio: nome || null });
}

async function salvarCredenciais(requisicao: Request, usuario: Usuario, ambiente: Ambiente, config: Configuracao) {
  let appId = '';
  let secret = '';
  try {
    const corpo = (await requisicao.json()) as { appId?: unknown; secret?: unknown };
    appId = typeof corpo.appId === 'string' ? corpo.appId.trim() : '';
    secret = typeof corpo.secret === 'string' ? corpo.secret.trim() : '';
  } catch {
    // Corpo inválido cai na mensagem abaixo.
  }
  if (!appId || !secret || appId.length > 200 || secret.length > 500) {
    return json(400, { erro: 'Informe o AppID e o Secret.' });
  }
  try {
    await ambiente.validarCredenciais(appId, secret);
  } catch (erro) {
    console.error(erro);
    return json(400, { erro: 'A Shopee não aceitou essas credenciais. Confira o AppID e o Secret e tente de novo.' });
  }
  await ambiente.repositorio.salvarCredenciais(usuario.id, appId, await cifrar(secret, config.chave));
  return semConteudo();
}

function hojeEmBrasilia(ambiente: Ambiente): string {
  return diaEmBrasilia(Math.floor((ambiente.agora ?? Date.now)() / 1000));
}

async function listarGastos(url: URL, usuario: Usuario, ambiente: Ambiente) {
  const inicio = url.searchParams.get('inicio') ?? '';
  const fim = url.searchParams.get('fim') ?? '';
  try {
    intervaloDoPeriodo(inicio, fim);
  } catch (erro) {
    if (erro instanceof ErroPeriodo) return json(400, { erro: erro.message });
    throw erro;
  }
  const gastos = await ambiente.repositorio.listarGastos(usuario.id, inicio, fim);
  const totalCentavos = gastos.reduce((soma, gasto) => soma + gasto.valorCentavos, 0);
  return json(200, { inicio, fim, gastos, totalCentavos });
}

async function registrarGasto(requisicao: Request, usuario: Usuario, ambiente: Ambiente) {
  let corpo: unknown;
  try {
    corpo = await requisicao.json();
  } catch {
    return json(400, { erro: 'Envie a data e o valor do gasto.' });
  }
  try {
    const gasto = await ambiente.repositorio.salvarGasto(usuario.id, validarGasto(corpo, hojeEmBrasilia(ambiente)));
    return json(201, { gasto });
  } catch (erro) {
    if (erro instanceof ErroGasto) return json(400, { erro: erro.message, campo: erro.campo });
    throw erro;
  }
}

async function excluirGasto(id: string, usuario: Usuario, ambiente: Ambiente) {
  const numero = Number(id);
  // Só apaga se o gasto for desta usuária; o de outra pessoa responde como inexistente.
  if (!Number.isSafeInteger(numero) || numero <= 0 || !(await ambiente.repositorio.excluirGasto(usuario.id, numero))) {
    return json(404, { erro: 'Gasto não encontrado.' });
  }
  return semConteudo();
}

export async function tratarRequisicao(requisicao: Request, ambiente: Ambiente): Promise<Response> {
  return comCabecalhosDeSeguranca(await responder(requisicao, ambiente));
}

async function responder(requisicao: Request, ambiente: Ambiente): Promise<Response> {
  const url = new URL(requisicao.url);
  const seguro = url.protocol === 'https:';
  const metodo = requisicao.method;

  const { segredoDaSessao, chaveCriptografia, googleClientId, emailsPermitidos } = ambiente;
  if (!segredoDaSessao || !chaveCriptografia || !googleClientId || !emailsPermitidos) {
    return json(500, {
      erro: 'Configure SEGREDO_SESSAO, CHAVE_CRIPTOGRAFIA, GOOGLE_CLIENT_ID e EMAILS_PERMITIDOS no servidor.',
    });
  }
  const config: Configuracao = {
    segredo: segredoDaSessao,
    chave: chaveCriptografia,
    clientId: googleClientId,
    permitidos: lerEmailsPermitidos(emailsPermitidos),
  };

  // Proteção contra envio de formulários a partir de outros sites.
  const origem = requisicao.headers.get('Origin');
  if (metodo !== 'GET' && origem && origem !== url.origin) {
    return json(403, { erro: 'Origem não permitida.' });
  }

  if (metodo === 'GET' && url.pathname === '/auth/google') {
    return iniciarLoginGoogle(url, config, seguro);
  }
  if (metodo === 'GET' && url.pathname === '/auth/google/callback') {
    return concluirLoginGoogle(requisicao, url, ambiente, config, seguro);
  }
  if (metodo === 'GET' && url.pathname === '/auth/dev' && ambiente.modoDesenvolvimento && HOSTS_LOCAIS.has(url.hostname)) {
    await ambiente.repositorio.salvarUsuario(USUARIO_DE_DESENVOLVIMENTO);
    return redirecionar('/', [await criarCookieDeSessao(config.segredo, USUARIO_DE_DESENVOLVIMENTO.id, seguro)]);
  }
  if (metodo === 'POST' && url.pathname === '/api/sair') {
    return semConteudo([cookieDeSaida(seguro)]);
  }

  const usuarioId = await lerSessao(requisicao.headers.get('Cookie'), config.segredo);
  const cadastrado = usuarioId ? await ambiente.repositorio.buscarUsuario(usuarioId) : null;
  // A sessão deixa de valer se a conta foi excluída ou se o e-mail saiu da lista de aprovados.
  const usuario = cadastrado && permitido(cadastrado, config, ambiente) ? cadastrado : null;

  if (metodo === 'GET' && CAMINHOS_PUBLICOS.has(url.pathname)) {
    if (usuario && url.pathname.startsWith('/login') && !url.pathname.endsWith('.js')) {
      return redirecionar('/');
    }
    return ambiente.servirArquivo(requisicao);
  }

  if (!usuario) {
    return url.pathname.startsWith('/api/') ? json(401, { erro: 'Faça login para continuar.' }) : redirecionar('/login');
  }

  if (url.pathname === '/api/eu' && metodo === 'GET') {
    const credenciais = await ambiente.repositorio.buscarCredenciais(usuario.id);
    return json(200, {
      nome: usuario.nome,
      email: usuario.email,
      nomeNegocio: usuario.nomeNegocio ?? null,
      credenciais: credenciais && { appId: credenciais.appId, atualizadoEm: credenciais.atualizadoEm },
    });
  }
  if (url.pathname === '/api/relatorio' && metodo === 'GET') {
    return relatorio(url, usuario, ambiente, config);
  }
  if (url.pathname === '/api/negocio' && metodo === 'POST') {
    return salvarNomeNegocio(requisicao, usuario, ambiente);
  }
  if (url.pathname === '/api/credenciais' && metodo === 'POST') {
    return salvarCredenciais(requisicao, usuario, ambiente, config);
  }
  if (url.pathname === '/api/credenciais' && metodo === 'DELETE') {
    await ambiente.repositorio.excluirCredenciais(usuario.id);
    return semConteudo();
  }
  if (url.pathname === '/api/gastos' && metodo === 'GET') {
    return listarGastos(url, usuario, ambiente);
  }
  if (url.pathname === '/api/gastos' && metodo === 'POST') {
    return registrarGasto(requisicao, usuario, ambiente);
  }
  const rotaGasto = /^\/api\/gastos\/([^/]+)$/.exec(url.pathname);
  if (rotaGasto && metodo === 'DELETE') {
    return excluirGasto(rotaGasto[1], usuario, ambiente);
  }
  if (url.pathname === '/api/conta' && metodo === 'DELETE') {
    await ambiente.repositorio.excluirUsuario(usuario.id);
    return semConteudo([cookieDeSaida(seguro)]);
  }
  if (metodo !== 'GET') {
    return new Response(null, { status: 405 });
  }
  return ambiente.servirArquivo(requisicao);
}
