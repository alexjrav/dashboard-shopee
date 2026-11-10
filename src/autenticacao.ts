// Sessões em cookies assinados com HMAC, sem tabela de sessões.
// SameSite=Lax (e não Strict) porque o retorno do Google chega por um redirecionamento vindo de outro site.

const COOKIE_SESSAO = 'sessao';
const COOKIE_OAUTH = 'oauth';
const DURACAO_SESSAO = 30 * 24 * 60 * 60;
// Tempo para concluir o login no Google.
const DURACAO_OAUTH = 10 * 60;

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

export function paraBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function deBase64Url(texto: string): Uint8Array {
  const base64 = texto.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function assinar(segredo: string, texto: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return paraBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', chave, codificador.encode(texto))));
}

// Compara sem parar no primeiro caractere diferente, para não revelar nada pelo tempo de resposta.
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

async function valorAssinado(segredo: string, dados: object): Promise<string> {
  const conteudo = paraBase64Url(codificador.encode(JSON.stringify(dados)));
  return `${conteudo}.${await assinar(segredo, conteudo)}`;
}

async function lerValorAssinado<T extends { exp: number }>(valor: string | null, segredo: string, agora: number) {
  if (!valor) return null;
  const [conteudo, assinatura] = valor.split('.');
  if (!conteudo || !assinatura || !iguais(assinatura, await assinar(segredo, conteudo))) return null;
  try {
    const dados = JSON.parse(decodificador.decode(deBase64Url(conteudo))) as T;
    return typeof dados.exp === 'number' && dados.exp >= Math.floor(agora / 1000) ? dados : null;
  } catch {
    return null;
  }
}

export function lerCookie(cabecalho: string | null, nome: string): string | null {
  return (
    cabecalho
      ?.split(';')
      .map((parte) => parte.trim())
      .find((parte) => parte.startsWith(`${nome}=`))
      ?.slice(nome.length + 1) || null
  );
}

function montarCookie(nome: string, valor: string, maxAge: number, seguro: boolean, caminho = '/') {
  return `${nome}=${valor}; Path=${caminho}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${seguro ? '; Secure' : ''}`;
}

export async function criarCookieDeSessao(segredo: string, usuarioId: string, seguro: boolean, agora = Date.now()) {
  const exp = Math.floor(agora / 1000) + DURACAO_SESSAO;
  return montarCookie(COOKIE_SESSAO, await valorAssinado(segredo, { u: usuarioId, exp }), DURACAO_SESSAO, seguro);
}

export function cookieDeSaida(seguro: boolean): string {
  return montarCookie(COOKIE_SESSAO, '', 0, seguro);
}

// Devolve o id do usuário logado, ou null.
export async function lerSessao(cabecalhoCookie: string | null, segredo: string, agora = Date.now()) {
  const dados = await lerValorAssinado<{ u: string; exp: number }>(lerCookie(cabecalhoCookie, COOKIE_SESSAO), segredo, agora);
  return typeof dados?.u === 'string' ? dados.u : null;
}

export type DadosOAuth = { estado: string; verificador: string };

export async function criarCookieOAuth(segredo: string, dados: DadosOAuth, seguro: boolean, agora = Date.now()) {
  const exp = Math.floor(agora / 1000) + DURACAO_OAUTH;
  return montarCookie(COOKIE_OAUTH, await valorAssinado(segredo, { ...dados, exp }), DURACAO_OAUTH, seguro, '/auth');
}

export function apagarCookieOAuth(seguro: boolean): string {
  return montarCookie(COOKIE_OAUTH, '', 0, seguro, '/auth');
}

export async function lerCookieOAuth(cabecalhoCookie: string | null, segredo: string, agora = Date.now()) {
  return lerValorAssinado<DadosOAuth & { exp: number }>(lerCookie(cabecalhoCookie, COOKIE_OAUTH), segredo, agora);
}

export function textoAleatorio(bytes = 32): string {
  return paraBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
