import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tratarRequisicao, type Ambiente } from '../src/aplicacao.ts';
import { criarCookieDeSessao, lerSessao, paraBase64Url } from '../src/autenticacao.ts';
import { cifrar, decifrar } from '../src/cifra.ts';
import { ErroGoogle, perfilDoIdToken, type PerfilGoogle } from '../src/google.ts';
import { repositorioEmMemoria, type Repositorio } from '../src/repositorio.ts';

const SEGREDO = 'segredo-de-teste';
const CHAVE = Buffer.alloc(32, 7).toString('base64');
const CLIENT_ID = 'cliente.apps.googleusercontent.com';
const ORIGEM = 'https://painel.exemplo';
const ISABELY: PerfilGoogle = { id: 'google-123', email: 'isa@exemplo.com', nome: 'Isabely' };

type Contexto = { ambiente: Ambiente; repositorio: Repositorio; fontesCriadas: Array<[string, string]> };

function criarContexto(mudancas: Partial<Ambiente> = {}): Contexto {
  const repositorio = repositorioEmMemoria();
  const fontesCriadas: Array<[string, string]> = [];
  const ambiente: Ambiente = {
    segredoDaSessao: SEGREDO,
    chaveCriptografia: CHAVE,
    googleClientId: CLIENT_ID,
    emailsPermitidos: 'Isa@Exemplo.com, outra@exemplo.com',
    repositorio,
    trocarCodigoGoogle: async () => ISABELY,
    criarFonte: (appId, secret) => {
      fontesCriadas.push([appId, secret]);
      return async () => [];
    },
    validarCredenciais: async () => {},
    servirArquivo: async (r) => new Response(`arquivo ${new URL(r.url).pathname}`),
    ...mudancas,
  };
  return { ambiente, repositorio, fontesCriadas };
}

function pedir(contexto: Contexto, caminho: string, opcoes: RequestInit = {}, origem = ORIGEM) {
  return tratarRequisicao(new Request(`${origem}${caminho}`, opcoes), contexto.ambiente);
}

function cookies(resposta: Response): string[] {
  return resposta.headers.getSetCookie();
}

async function logar(contexto: Contexto, perfil = ISABELY): Promise<string> {
  await contexto.repositorio.salvarUsuario(perfil);
  return (await criarCookieDeSessao(SEGREDO, perfil.id, true)).split(';')[0];
}

function idToken(dados: Record<string, unknown>): string {
  const parte = (objeto: object) => paraBase64Url(new TextEncoder().encode(JSON.stringify(objeto)));
  return `${parte({ alg: 'RS256' })}.${parte(dados)}.assinatura`;
}

// --- Criptografia ---

test('criptografa e recupera o Secret, com iv diferente a cada vez', async () => {
  const a = await cifrar('meu-secret', CHAVE);
  const b = await cifrar('meu-secret', CHAVE);
  assert.notEqual(a, b);
  assert.ok(!a.includes('meu-secret'));
  assert.equal(await decifrar(a, CHAVE), 'meu-secret');
  await assert.rejects(decifrar(a, Buffer.alloc(32, 9).toString('base64')));
});

// --- Token do Google ---

test('aceita só tokens do Google para este aplicativo e com e-mail verificado', () => {
  const valido = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 60,
    sub: '123',
    email: 'isa@exemplo.com',
    email_verified: true,
    name: 'Isabely',
  };
  assert.deepEqual(perfilDoIdToken(idToken(valido), CLIENT_ID), { id: '123', email: 'isa@exemplo.com', nome: 'Isabely' });
  assert.throws(() => perfilDoIdToken(idToken({ ...valido, aud: 'outro' }), CLIENT_ID), ErroGoogle);
  assert.throws(() => perfilDoIdToken(idToken({ ...valido, iss: 'https://outro.com' }), CLIENT_ID), ErroGoogle);
  assert.throws(() => perfilDoIdToken(idToken({ ...valido, email_verified: false }), CLIENT_ID), ErroGoogle);
  assert.throws(() => perfilDoIdToken(idToken({ ...valido, exp: 1 }), CLIENT_ID), ErroGoogle);
});

// --- Sessão ---

test('a sessão guarda o usuário e recusa cookie adulterado ou vencido', async () => {
  const cookie = (await criarCookieDeSessao(SEGREDO, 'u1', true)).split(';')[0];
  assert.equal(await lerSessao(cookie, SEGREDO), 'u1');
  assert.equal(await lerSessao(cookie, 'outro-segredo'), null);
  assert.equal(await lerSessao(cookie.replace('sessao=e', 'sessao=f'), SEGREDO), null);
  assert.equal(await lerSessao(cookie, SEGREDO, Date.now() + 31 * 24 * 60 * 60 * 1000), null);
});

test('o cookie de sessão é protegido', async () => {
  const cookie = await criarCookieDeSessao(SEGREDO, 'u1', true);
  for (const atributo of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
    assert.ok(cookie.includes(atributo), `faltou ${atributo}`);
  }
});

// --- Acesso sem login ---

test('sem login, a página leva ao login e a API responde 401', async () => {
  const contexto = criarContexto();
  const pagina = await pedir(contexto, '/');
  assert.equal(pagina.status, 302);
  assert.equal(pagina.headers.get('Location'), '/login');
  assert.equal((await pedir(contexto, '/api/eu')).status, 401);
  assert.equal((await pedir(contexto, '/configuracoes')).status, 302);
  assert.equal((await pedir(contexto, '/gastos')).headers.get('Location'), '/login');
});

test('a tela de login e o estilo ficam acessíveis sem login', async () => {
  const contexto = criarContexto();
  for (const caminho of ['/login', '/login.js', '/estilo.css']) {
    assert.equal((await pedir(contexto, caminho)).status, 200, caminho);
  }
});

// --- Login com Google ---

test('o login leva ao Google com estado e PKCE', async () => {
  const resposta = await pedir(criarContexto(), '/auth/google');
  const destino = new URL(resposta.headers.get('Location') ?? '');
  assert.equal(destino.origin, 'https://accounts.google.com');
  assert.equal(destino.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(destino.searchParams.get('redirect_uri'), `${ORIGEM}/auth/google/callback`);
  assert.equal(destino.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(destino.searchParams.get('state'));
  assert.match(cookies(resposta)[0], /^oauth=.+Path=\/auth/);
});

async function iniciarEVoltar(contexto: Contexto, alterarEstado = false) {
  const inicio = await pedir(contexto, '/auth/google');
  const estado = new URL(inicio.headers.get('Location') ?? '').searchParams.get('state');
  const cookieOAuth = cookies(inicio)[0].split(';')[0];
  return pedir(contexto, `/auth/google/callback?code=abc&state=${alterarEstado ? 'outro' : estado}`, {
    headers: { Cookie: cookieOAuth },
  });
}

test('o retorno do Google cria o usuário e a sessão', async () => {
  const contexto = criarContexto();
  const retorno = await iniciarEVoltar(contexto);
  assert.equal(retorno.headers.get('Location'), '/');
  const sessao = cookies(retorno).find((c) => c.startsWith('sessao='))?.split(';')[0] ?? '';

  const eu = await pedir(contexto, '/api/eu', { headers: { Cookie: sessao } });
  assert.deepEqual(await eu.json(), { nome: 'Isabely', email: 'isa@exemplo.com', nomeNegocio: null, credenciais: null });
});

test('retorno com estado diferente não cria sessão', async () => {
  const retorno = await iniciarEVoltar(criarContexto(), true);
  assert.equal(retorno.headers.get('Location'), '/login?erro=expirado');
  assert.ok(!cookies(retorno).some((c) => c.startsWith('sessao=') && !c.includes('Max-Age=0')));
});

test('falha na troca com o Google volta ao login com aviso', async () => {
  const contexto = criarContexto({
    trocarCodigoGoogle: async () => {
      throw new ErroGoogle('recusado');
    },
  });
  assert.equal((await iniciarEVoltar(contexto)).headers.get('Location'), '/login?erro=google');
  assert.equal((await pedir(contexto, '/auth/google/callback?error=access_denied')).headers.get('Location'), '/login?erro=cancelado');
});

// --- Credenciais da Shopee ---

test('sem credenciais, o relatório pede o cadastro', async () => {
  const contexto = criarContexto();
  const resposta = await pedir(contexto, '/api/relatorio?inicio=2026-11-01&fim=2026-11-01', {
    headers: { Cookie: await logar(contexto) },
  });
  assert.equal(resposta.status, 409);
});

test('credenciais recusadas pela Shopee não são salvas', async () => {
  const contexto = criarContexto({
    validarCredenciais: async () => {
      throw new Error('Erro GraphQL');
    },
  });
  const resposta = await pedir(contexto, '/api/credenciais', {
    method: 'POST',
    headers: { Cookie: await logar(contexto) },
    body: JSON.stringify({ appId: '123', secret: 'errado' }),
  });
  assert.equal(resposta.status, 400);
  assert.equal(await contexto.repositorio.buscarCredenciais(ISABELY.id), null);
});

test('credenciais válidas ficam criptografadas e alimentam o relatório', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  const salvar = await pedir(contexto, '/api/credenciais', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify({ appId: ' 123 ', secret: 'segredo-da-isa' }),
  });
  assert.equal(salvar.status, 204);

  const salvas = await contexto.repositorio.buscarCredenciais(ISABELY.id);
  assert.equal(salvas?.appId, '123');
  assert.ok(salvas && !salvas.secretCifrado.includes('segredo-da-isa'));

  const relatorio = await pedir(contexto, '/api/relatorio?inicio=2026-11-01&fim=2026-11-01', { headers: { Cookie: cookie } });
  assert.equal(relatorio.status, 200);
  assert.deepEqual(contexto.fontesCriadas, [['123', 'segredo-da-isa']]);
});

test('cada pessoa consulta só com as próprias credenciais', async () => {
  const contexto = criarContexto();
  const outra: PerfilGoogle = { id: 'google-999', email: 'outra@exemplo.com', nome: 'Outra' };
  const cookieIsa = await logar(contexto);
  const cookieOutra = await logar(contexto, outra);
  await contexto.repositorio.salvarCredenciais(ISABELY.id, 'app-isa', await cifrar('secret-isa', CHAVE));
  await contexto.repositorio.salvarCredenciais(outra.id, 'app-outra', await cifrar('secret-outra', CHAVE));

  await pedir(contexto, '/api/relatorio?inicio=2026-11-01&fim=2026-11-01', { headers: { Cookie: cookieOutra } });
  await pedir(contexto, '/api/relatorio?inicio=2026-11-01&fim=2026-11-01', { headers: { Cookie: cookieIsa } });
  assert.deepEqual(contexto.fontesCriadas, [
    ['app-outra', 'secret-outra'],
    ['app-isa', 'secret-isa'],
  ]);
});

// --- Conta ---

test('excluir a conta apaga os dados e invalida a sessão', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  await contexto.repositorio.salvarCredenciais(ISABELY.id, '123', await cifrar('x', CHAVE));

  const resposta = await pedir(contexto, '/api/conta', { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(resposta.status, 204);
  assert.match(cookies(resposta)[0], /Max-Age=0/);
  assert.equal(await contexto.repositorio.buscarUsuario(ISABELY.id), null);
  assert.equal(await contexto.repositorio.buscarCredenciais(ISABELY.id), null);
  assert.equal((await pedir(contexto, '/api/eu', { headers: { Cookie: cookie } })).status, 401);
});

// --- Proteções gerais ---

test('recusa alterações enviadas a partir de outro site', async () => {
  const contexto = criarContexto();
  const resposta = await pedir(contexto, '/api/conta', {
    method: 'DELETE',
    headers: { Cookie: await logar(contexto), Origin: 'https://site-malicioso.exemplo' },
  });
  assert.equal(resposta.status, 403);
  assert.ok(await contexto.repositorio.buscarUsuario(ISABELY.id));
});

test('toda resposta leva os cabeçalhos de segurança', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  const respostas = [
    await pedir(contexto, '/login'), // arquivo público
    await pedir(contexto, '/'), // redirecionamento sem login
    await pedir(contexto, '/api/eu'), // 401 da API
    await pedir(contexto, '/api/eu', { headers: { Cookie: cookie } }), // API com login
    await pedir(contexto, '/gastos', { headers: { Cookie: cookie } }), // página com login
  ];
  for (const resposta of respostas) {
    const politica = resposta.headers.get('Content-Security-Policy') ?? '';
    assert.match(politica, /script-src 'self'(;|$)/, `status ${resposta.status}`);
    assert.match(politica, /frame-ancestors 'none'/);
    assert.doesNotMatch(politica, /unsafe-inline|unsafe-eval/);
    assert.equal(resposta.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(resposta.headers.get('X-Frame-Options'), 'DENY');
  }
});

test('os cabeçalhos de segurança não mudam status, corpo nem cookies', async () => {
  const contexto = criarContexto();
  const pagina = await pedir(contexto, '/login');
  assert.equal(await pagina.text(), 'arquivo /login');
  const saida = await pedir(contexto, '/api/sair', { method: 'POST' });
  assert.equal(saida.status, 204);
  assert.match(cookies(saida)[0], /^sessao=;.*Max-Age=0/);
});

test('o script de tema fica acessível na tela de login', async () => {
  assert.equal((await pedir(criarContexto(), '/tema.js')).status, 200);
});

test('o atalho de desenvolvimento só funciona no computador e com o modo ligado', async () => {
  const ligado = criarContexto({ modoDesenvolvimento: true });
  const local = await pedir(ligado, '/auth/dev', {}, 'http://localhost:8787');
  assert.equal(local.headers.get('Location'), '/');
  assert.ok(cookies(local)[0].startsWith('sessao='));

  const publicado = await pedir(ligado, '/auth/dev');
  assert.equal(publicado.headers.get('Location'), '/login');

  const desligado = await pedir(criarContexto(), '/auth/dev', {}, 'http://localhost:8787');
  assert.equal(desligado.headers.get('Location'), '/login');
});

test('sem configuração, nada é liberado', async () => {
  const resposta = await pedir(criarContexto({ chaveCriptografia: undefined }), '/');
  assert.equal(resposta.status, 500);
});

// --- Lista de e-mails aprovados ---

test('sem a lista de aprovados, ninguém entra', async () => {
  for (const lista of [undefined, '']) {
    const resposta = await pedir(criarContexto({ emailsPermitidos: lista }), '/auth/google');
    assert.equal(resposta.status, 500, `lista ${JSON.stringify(lista)}`);
  }
});

test('e-mail fora da lista não cria conta nem sessão', async () => {
  const intruso: PerfilGoogle = { id: 'google-666', email: 'estranho@exemplo.com', nome: 'Estranho' };
  const contexto = criarContexto({ trocarCodigoGoogle: async () => intruso });
  const retorno = await iniciarEVoltar(contexto);
  assert.equal(retorno.headers.get('Location'), '/login?erro=nao-autorizado');
  assert.ok(!cookies(retorno).some((c) => c.startsWith('sessao=') && !c.includes('Max-Age=0')));
  assert.equal(await contexto.repositorio.buscarUsuario(intruso.id), null);
});

test('a lista ignora maiúsculas e minúsculas e aceita vírgulas, espaços e ponto e vírgula', async () => {
  const perfil: PerfilGoogle = { id: 'google-777', email: 'OUTRA@exemplo.COM', nome: 'Outra' };
  const contexto = criarContexto({ trocarCodigoGoogle: async () => perfil, emailsPermitidos: 'x@y.com; Outra@Exemplo.com' });
  assert.equal((await iniciarEVoltar(contexto)).headers.get('Location'), '/');
  assert.ok(await contexto.repositorio.buscarUsuario(perfil.id));
});

test('quem sai da lista perde o acesso na hora', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  assert.equal((await pedir(contexto, '/api/eu', { headers: { Cookie: cookie } })).status, 200);

  contexto.ambiente.emailsPermitidos = 'outra@exemplo.com';
  assert.equal((await pedir(contexto, '/api/eu', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await pedir(contexto, '/', { headers: { Cookie: cookie } })).headers.get('Location'), '/login');
});

// --- Nome do negócio ---

function salvarNegocio(contexto: Contexto, cookie: string, nome: unknown) {
  return pedir(contexto, '/api/negocio', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ nome }) });
}

test('o nome do negócio é salvo, limpo de espaços extras e devolvido em /api/eu', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  const resposta = await salvarNegocio(contexto, cookie, '  Home   da  Isa ');
  assert.deepEqual(await resposta.json(), { nomeNegocio: 'Home da Isa' });

  const eu = await (await pedir(contexto, '/api/eu', { headers: { Cookie: cookie } })).json();
  assert.equal(eu.nomeNegocio, 'Home da Isa');
});

test('nome do negócio vazio apaga o que estava salvo', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  await salvarNegocio(contexto, cookie, 'Home da Isa');
  assert.deepEqual(await (await salvarNegocio(contexto, cookie, '   ')).json(), { nomeNegocio: null });
  assert.equal((await (await pedir(contexto, '/api/eu', { headers: { Cookie: cookie } })).json()).nomeNegocio, null);
});

test('recusa nome do negócio grande demais ou em formato errado', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  assert.equal((await salvarNegocio(contexto, cookie, 'x'.repeat(81))).status, 400);
  const semCorpo = await pedir(contexto, '/api/negocio', { method: 'POST', headers: { Cookie: cookie }, body: 'não é json' });
  assert.equal(semCorpo.status, 400);
  assert.equal(await contexto.repositorio.buscarUsuario(ISABELY.id).then((u) => u?.nomeNegocio ?? null), null);
});

test('um novo login não apaga o nome do negócio', async () => {
  const contexto = criarContexto();
  const cookie = await logar(contexto);
  await salvarNegocio(contexto, cookie, 'Home da Isa');
  await contexto.repositorio.salvarUsuario({ ...ISABELY, nome: 'Isabely Z.' });
  const usuario = await contexto.repositorio.buscarUsuario(ISABELY.id);
  assert.equal(usuario?.nomeNegocio, 'Home da Isa');
  assert.equal(usuario?.nome, 'Isabely Z.');
});

test('só quem está logado altera o nome do negócio', async () => {
  const resposta = await pedir(criarContexto(), '/api/negocio', { method: 'POST', body: JSON.stringify({ nome: 'x' }) });
  assert.equal(resposta.status, 401);
});

// --- Gastos com anúncios e ROI ---

// 10/11/2026 às 15h em Brasília.
const AGORA = Date.parse('2026-11-10T15:00:00-03:00');

function registrarGasto(contexto: Contexto, cookie: string, corpo: unknown) {
  return pedir(contexto, '/api/gastos', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(corpo) });
}

async function listarGastos(contexto: Contexto, cookie: string, inicio = '2026-11-01', fim = '2026-11-10') {
  return (await pedir(contexto, `/api/gastos?inicio=${inicio}&fim=${fim}`, { headers: { Cookie: cookie } })).json();
}

test('registra um gasto válido e o lista no período com o total', async () => {
  const contexto = criarContexto({ agora: () => AGORA });
  const cookie = await logar(contexto);
  const resposta = await registrarGasto(contexto, cookie, { data: '2026-11-10', valor: '25,50', descricao: 'Anúncio do dia' });
  assert.equal(resposta.status, 201);
  await registrarGasto(contexto, cookie, { data: '2026-11-03', valor: '30' });
  await registrarGasto(contexto, cookie, { data: '2026-10-31', valor: '99' }); // fora do período

  const lista = await listarGastos(contexto, cookie);
  assert.equal(lista.totalCentavos, 5550);
  assert.deepEqual(
    lista.gastos.map((g: { data: string; valorCentavos: number; descricao: string | null }) => [g.data, g.valorCentavos, g.descricao]),
    [
      ['2026-11-10', 2550, 'Anúncio do dia'],
      ['2026-11-03', 3000, null],
    ],
  );
});

test('gasto inválido é recusado com o campo e nada é gravado', async () => {
  const contexto = criarContexto({ agora: () => AGORA });
  const cookie = await logar(contexto);
  for (const corpo of [{ data: '2026-11-10', valor: '0' }, { data: '2026-11-11', valor: '10' }, { data: '2026-11-10', valor: 'abc' }]) {
    const resposta = await registrarGasto(contexto, cookie, corpo);
    assert.equal(resposta.status, 400, JSON.stringify(corpo));
    assert.ok((await resposta.json()).campo);
  }
  assert.equal((await pedir(contexto, '/api/gastos', { method: 'POST', headers: { Cookie: cookie }, body: 'não é json' })).status, 400);
  assert.equal((await listarGastos(contexto, cookie)).gastos.length, 0);
});

test('a descrição é devolvida como texto, sem interpretar marcação', async () => {
  const contexto = criarContexto({ agora: () => AGORA });
  const cookie = await logar(contexto);
  const resposta = await registrarGasto(contexto, cookie, { data: '2026-11-10', valor: '5', descricao: '<script>alert(1)</script>' });
  assert.equal((await resposta.json()).gasto.descricao, '<script>alert(1)</script>');
  assert.equal(resposta.headers.get('Content-Type'), 'application/json; charset=utf-8');
});

test('uma usuária não vê nem exclui os gastos de outra', async () => {
  const contexto = criarContexto({ agora: () => AGORA });
  const outra: PerfilGoogle = { id: 'google-999', email: 'outra@exemplo.com', nome: 'Outra' };
  const cookieIsa = await logar(contexto);
  const cookieOutra = await logar(contexto, outra);
  const { gasto } = await (await registrarGasto(contexto, cookieIsa, { data: '2026-11-10', valor: '25,50' })).json();

  assert.equal((await listarGastos(contexto, cookieOutra)).gastos.length, 0);
  const tentativa = await pedir(contexto, `/api/gastos/${gasto.id}`, { method: 'DELETE', headers: { Cookie: cookieOutra } });
  assert.equal(tentativa.status, 404);
  assert.equal((await listarGastos(contexto, cookieIsa)).gastos.length, 1);

  const exclusao = await pedir(contexto, `/api/gastos/${gasto.id}`, { method: 'DELETE', headers: { Cookie: cookieIsa } });
  assert.equal(exclusao.status, 204);
  assert.equal((await listarGastos(contexto, cookieIsa)).gastos.length, 0);
});

test('sem login, as rotas de gastos respondem 401', async () => {
  const contexto = criarContexto();
  assert.equal((await pedir(contexto, '/api/gastos?inicio=2026-11-01&fim=2026-11-10')).status, 401);
  assert.equal((await pedir(contexto, '/api/gastos', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await pedir(contexto, '/api/gastos/1', { method: 'DELETE' })).status, 401);
});

test('o relatório traz o gasto do período e o ROI', async () => {
  const contexto = criarContexto({
    agora: () => AGORA,
    criarFonte: () => async () => [
      { conversionId: 1, purchaseTime: AGORA / 1000, totalCommission: '105.00', orders: [{ orderId: 'P1', orderStatus: 'COMPLETED' }] },
      { conversionId: 2, purchaseTime: AGORA / 1000, totalCommission: '45.00', orders: [{ orderId: 'P2', orderStatus: 'PENDING' }] },
    ],
  });
  const cookie = await logar(contexto);
  await contexto.repositorio.salvarCredenciais(ISABELY.id, '123', await cifrar('x', CHAVE));
  await registrarGasto(contexto, cookie, { data: '2026-11-08', valor: '94,50' });
  await registrarGasto(contexto, cookie, { data: '2026-11-10', valor: '25,50' });

  const dados = await (await pedir(contexto, '/api/relatorio?inicio=2026-11-01&fim=2026-11-10', { headers: { Cookie: cookie } })).json();
  assert.equal(dados.gastoAnuncios, 120);
  assert.equal(dados.roiConfirmado, -0.125);
  assert.equal(dados.roiEstimado, 0.25);
  assert.deepEqual(
    dados.porDia.map((d: { dia: string; gasto: number }) => [d.dia, d.gasto]),
    [
      ['2026-11-08', 94.5],
      ['2026-11-10', 25.5],
    ],
  );
});

test('excluir a conta apaga também os gastos', async () => {
  const contexto = criarContexto({ agora: () => AGORA });
  const cookie = await logar(contexto);
  await registrarGasto(contexto, cookie, { data: '2026-11-10', valor: '10' });
  await pedir(contexto, '/api/conta', { method: 'DELETE', headers: { Cookie: cookie } });
  assert.deepEqual(await contexto.repositorio.listarGastos(ISABELY.id, '2026-01-01', '2026-12-31'), []);
});
