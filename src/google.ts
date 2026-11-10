// Login com Google (OAuth 2.0 / OpenID Connect, fluxo de código com PKCE).
import { deBase64Url, paraBase64Url } from './autenticacao.ts';

const URL_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const EMISSORES = new Set(['https://accounts.google.com', 'accounts.google.com']);

export type PerfilGoogle = { id: string; email: string; nome: string };

export class ErroGoogle extends Error {}

export async function desafioPkce(verificador: string): Promise<string> {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador));
  return paraBase64Url(new Uint8Array(resumo));
}

export function urlDeAutorizacao(clientId: string, redirectUri: string, estado: string, desafio: string): string {
  const parametros = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: estado,
    code_challenge: desafio,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${URL_AUTORIZACAO}?${parametros}`;
}

// O id_token vem direto do Google por HTTPS, em troca do código; por isso basta conferir
// os campos, sem validar a assinatura (permitido pela especificação do OpenID Connect).
export function perfilDoIdToken(idToken: string, clientId: string, agora = Date.now()): PerfilGoogle {
  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(new TextDecoder().decode(deBase64Url(idToken.split('.')[1] ?? '')));
  } catch {
    throw new ErroGoogle('Resposta do Google inválida.');
  }
  if (!EMISSORES.has(String(dados.iss))) throw new ErroGoogle('Emissor do token inválido.');
  if (dados.aud !== clientId) throw new ErroGoogle('Token emitido para outro aplicativo.');
  if (typeof dados.exp !== 'number' || dados.exp * 1000 < agora) throw new ErroGoogle('Token expirado.');
  if (typeof dados.sub !== 'string' || typeof dados.email !== 'string') throw new ErroGoogle('Token sem identificação.');
  if (dados.email_verified !== true) throw new ErroGoogle('O e-mail da conta Google não está verificado.');

  const nome = typeof dados.name === 'string' && dados.name ? dados.name : dados.email;
  return { id: dados.sub, email: dados.email, nome };
}

export function criarTrocaDeCodigo(clientId: string, clientSecret: string) {
  return async (codigo: string, verificador: string, redirectUri: string): Promise<PerfilGoogle> => {
    const resposta = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: codigo,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verificador,
      }),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!resposta.ok || !corpo.id_token) {
      throw new ErroGoogle(`O Google recusou o login (${corpo.error ?? resposta.status}).`);
    }
    return perfilDoIdToken(corpo.id_token, clientId);
  };
}
