// Acesso aos dados dos usuários. Em produção usa o banco D1 do Cloudflare;
// nos testes, uma versão em memória com a mesma interface.

export type Usuario = { id: string; email: string; nome: string; nomeNegocio?: string | null };
export type CredenciaisSalvas = { appId: string; secretCifrado: string; atualizadoEm: string };

export interface Repositorio {
  salvarUsuario(usuario: Usuario): Promise<void>;
  buscarUsuario(id: string): Promise<Usuario | null>;
  salvarNomeNegocio(id: string, nomeNegocio: string | null): Promise<void>;
  excluirUsuario(id: string): Promise<void>;
  buscarCredenciais(usuarioId: string): Promise<CredenciaisSalvas | null>;
  salvarCredenciais(usuarioId: string, appId: string, secretCifrado: string): Promise<void>;
  excluirCredenciais(usuarioId: string): Promise<void>;
}

// Só a parte da API do D1 que usamos.
type ConsultaD1 = {
  bind(...valores: unknown[]): ConsultaD1;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};
export type BancoD1 = { prepare(sql: string): ConsultaD1; batch(consultas: ConsultaD1[]): Promise<unknown> };

export function repositorioD1(banco: BancoD1): Repositorio {
  return {
    async salvarUsuario({ id, email, nome }) {
      await banco
        .prepare(
          `INSERT INTO usuarios (id, email, nome, criado_em) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET email = excluded.email, nome = excluded.nome`,
        )
        .bind(id, email, nome, new Date().toISOString())
        .run();
    },
    async buscarUsuario(id) {
      return banco
        .prepare('SELECT id, email, nome, nome_negocio AS nomeNegocio FROM usuarios WHERE id = ?')
        .bind(id)
        .first<Usuario>();
    },
    async salvarNomeNegocio(id, nomeNegocio) {
      await banco.prepare('UPDATE usuarios SET nome_negocio = ? WHERE id = ?').bind(nomeNegocio, id).run();
    },
    async excluirUsuario(id) {
      // Apaga as credenciais junto, sem depender do ON DELETE CASCADE estar ativo.
      await banco.batch([
        banco.prepare('DELETE FROM credenciais_shopee WHERE usuario_id = ?').bind(id),
        banco.prepare('DELETE FROM usuarios WHERE id = ?').bind(id),
      ]);
    },
    async buscarCredenciais(usuarioId) {
      return banco
        .prepare(
          `SELECT app_id AS appId, secret_cifrado AS secretCifrado, atualizado_em AS atualizadoEm
           FROM credenciais_shopee WHERE usuario_id = ?`,
        )
        .bind(usuarioId)
        .first<CredenciaisSalvas>();
    },
    async salvarCredenciais(usuarioId, appId, secretCifrado) {
      await banco
        .prepare(
          `INSERT INTO credenciais_shopee (usuario_id, app_id, secret_cifrado, atualizado_em) VALUES (?, ?, ?, ?)
           ON CONFLICT(usuario_id) DO UPDATE SET app_id = excluded.app_id,
             secret_cifrado = excluded.secret_cifrado, atualizado_em = excluded.atualizado_em`,
        )
        .bind(usuarioId, appId, secretCifrado, new Date().toISOString())
        .run();
    },
    async excluirCredenciais(usuarioId) {
      await banco.prepare('DELETE FROM credenciais_shopee WHERE usuario_id = ?').bind(usuarioId).run();
    },
  };
}

export function repositorioEmMemoria(): Repositorio {
  const usuarios = new Map<string, Usuario>();
  const credenciais = new Map<string, CredenciaisSalvas>();
  return {
    async salvarUsuario({ id, email, nome }) {
      // Como no banco, um novo login atualiza nome e e-mail sem apagar o nome do negócio.
      usuarios.set(id, { ...usuarios.get(id), id, email, nome });
    },
    async buscarUsuario(id) {
      const usuario = usuarios.get(id);
      return usuario ? { nomeNegocio: null, ...usuario } : null;
    },
    async salvarNomeNegocio(id, nomeNegocio) {
      const usuario = usuarios.get(id);
      if (usuario) usuarios.set(id, { ...usuario, nomeNegocio });
    },
    async excluirUsuario(id) {
      usuarios.delete(id);
      credenciais.delete(id);
    },
    async buscarCredenciais(usuarioId) {
      return credenciais.get(usuarioId) ?? null;
    },
    async salvarCredenciais(usuarioId, appId, secretCifrado) {
      credenciais.set(usuarioId, { appId, secretCifrado, atualizadoEm: new Date().toISOString() });
    },
    async excluirCredenciais(usuarioId) {
      credenciais.delete(usuarioId);
    },
  };
}
