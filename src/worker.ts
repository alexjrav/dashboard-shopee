// Entrada do Cloudflare Workers. Segredos e banco vêm das configurações do Worker.
import { tratarRequisicao } from './aplicacao.ts';
import { criarTrocaDeCodigo } from './google.ts';
import { repositorioD1, type BancoD1 } from './repositorio.ts';
import { criarClienteShopee } from './shopee.ts';

type Env = {
  ASSETS: { fetch(requisicao: Request): Promise<Response> };
  DB: BancoD1;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SEGREDO_SESSAO?: string;
  CHAVE_CRIPTOGRAFIA?: string;
  // E-mails aprovados para criar conta, separados por vírgula.
  EMAILS_PERMITIDOS?: string;
  // Nunca defina em produção; serve só para testar no computador sem conta Google.
  MODO_DESENVOLVIMENTO?: string;
};

export default {
  async fetch(requisicao: Request, env: Env): Promise<Response> {
    return tratarRequisicao(requisicao, {
      segredoDaSessao: env.SEGREDO_SESSAO,
      chaveCriptografia: env.CHAVE_CRIPTOGRAFIA,
      googleClientId: env.GOOGLE_CLIENT_ID,
      emailsPermitidos: env.EMAILS_PERMITIDOS,
      repositorio: repositorioD1(env.DB),
      trocarCodigoGoogle: criarTrocaDeCodigo(env.GOOGLE_CLIENT_ID ?? '', env.GOOGLE_CLIENT_SECRET ?? ''),
      criarFonte: (appId, secret) => criarClienteShopee(appId, secret).buscarConversoes,
      validarCredenciais: (appId, secret) => criarClienteShopee(appId, secret).validarCredenciais(),
      servirArquivo: (r) => env.ASSETS.fetch(r),
      modoDesenvolvimento: env.MODO_DESENVOLVIMENTO === '1',
    });
  },
};
