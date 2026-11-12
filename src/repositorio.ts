// Acesso aos dados dos usuários. Em produção usa o banco D1 do Cloudflare;
// nos testes, uma versão em memória com a mesma interface.

export type Usuario = { id: string; email: string; nome: string; nomeNegocio?: string | null };
export type CredenciaisSalvas = { appId: string; secretCifrado: string; atualizadoEm: string };
// data no formato AAAA-MM-DD (dia de Brasília); valor em centavos.
export type NovoGasto = { data: string; valorCentavos: number; descricao: string | null };
export type Gasto = NovoGasto & { id: number };

export interface Repositorio {
  salvarUsuario(usuario: Usuario): Promise<void>;
  buscarUsuario(id: string): Promise<Usuario | null>;
  salvarNomeNegocio(id: string, nomeNegocio: string | null): Promise<void>;
  excluirUsuario(id: string): Promise<void>;
  buscarCredenciais(usuarioId: string): Promise<CredenciaisSalvas | null>;
  salvarCredenciais(usuarioId: string, appId: string, secretCifrado: string): Promise<void>;
  excluirCredenciais(usuarioId: string): Promise<void>;
  // Gastos com anúncios: sempre filtrados pela usuária, para uma não ver os da outra.
  listarGastos(usuarioId: string, inicio: string, fim: string): Promise<Gasto[]>;
  salvarGasto(usuarioId: string, gasto: NovoGasto): Promise<Gasto>;
  // Devolve false se o gasto não existe ou é de outra usuária.
  excluirGasto(usuarioId: string, id: number): Promise<boolean>;
  // Usada pelo monitoramento: lança erro se o banco não responder.
  verificarConexao(): Promise<void>;
}

// Só a parte da API do D1 que usamos.
type ConsultaD1 = {
  bind(...valores: unknown[]): ConsultaD1;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
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
      // Apaga credenciais e gastos junto, sem depender do ON DELETE CASCADE estar ativo.
      await banco.batch([
        banco.prepare('DELETE FROM gastos_anuncios WHERE usuario_id = ?').bind(id),
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
    async listarGastos(usuarioId, inicio, fim) {
      const { results } = await banco
        .prepare(
          `SELECT id, data, valor_centavos AS valorCentavos, descricao
           FROM gastos_anuncios WHERE usuario_id = ? AND data BETWEEN ? AND ?
           ORDER BY data DESC, id DESC`,
        )
        .bind(usuarioId, inicio, fim)
        .all<Gasto>();
      return results;
    },
    async salvarGasto(usuarioId, { data, valorCentavos, descricao }) {
      const linha = await banco
        .prepare(
          `INSERT INTO gastos_anuncios (usuario_id, data, valor_centavos, descricao, criado_em)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(usuarioId, data, valorCentavos, descricao, new Date().toISOString())
        .first<{ id: number }>();
      if (!linha) throw new Error('O banco não devolveu o id do gasto.');
      return { id: linha.id, data, valorCentavos, descricao };
    },
    async excluirGasto(usuarioId, id) {
      const resultado = await banco
        .prepare('DELETE FROM gastos_anuncios WHERE id = ? AND usuario_id = ?')
        .bind(id, usuarioId)
        .run();
      return (resultado.meta?.changes ?? 0) > 0;
    },
    async verificarConexao() {
      const linha = await banco.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      if (linha?.ok !== 1) throw new Error('O banco não respondeu à verificação.');
    },
  };
}

export function repositorioEmMemoria(): Repositorio {
  const usuarios = new Map<string, Usuario>();
  const credenciais = new Map<string, CredenciaisSalvas>();
  const gastos: Array<Gasto & { usuarioId: string }> = [];
  let proximoId = 1;
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
      for (let i = gastos.length - 1; i >= 0; i--) {
        if (gastos[i].usuarioId === id) gastos.splice(i, 1);
      }
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
    async listarGastos(usuarioId, inicio, fim) {
      return gastos
        .filter((g) => g.usuarioId === usuarioId && g.data >= inicio && g.data <= fim)
        .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)
        .map(({ usuarioId: _, ...gasto }) => gasto);
    },
    async salvarGasto(usuarioId, gasto) {
      const salvo = { ...gasto, id: proximoId++ };
      gastos.push({ ...salvo, usuarioId });
      return salvo;
    },
    async excluirGasto(usuarioId, id) {
      const indice = gastos.findIndex((g) => g.id === id && g.usuarioId === usuarioId);
      if (indice === -1) return false;
      gastos.splice(indice, 1);
      return true;
    },
    async verificarConexao() {
      // Em memória, o "banco" está sempre disponível.
    },
  };
}
