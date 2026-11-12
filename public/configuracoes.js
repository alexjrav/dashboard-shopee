const elementos = {
  nomeUsuario: document.getElementById('nome-usuario'),
  emailUsuario: document.getElementById('email-usuario'),
  situacao: document.getElementById('situacao'),
  voltar: document.getElementById('voltar'),
  form: document.getElementById('form-credenciais'),
  appId: document.getElementById('app-id'),
  secret: document.getElementById('secret'),
  salvar: document.getElementById('salvar'),
  erro: document.getElementById('erro'),
  sucesso: document.getElementById('sucesso'),
  removerCredenciais: document.getElementById('remover-credenciais'),
  excluirConta: document.getElementById('excluir-conta'),
  sair: document.getElementById('sair'),
  formNegocio: document.getElementById('form-negocio'),
  nomeNegocio: document.getElementById('nome-negocio'),
  salvarNegocio: document.getElementById('salvar-negocio'),
  erroNegocio: document.getElementById('erro-negocio'),
  sucessoNegocio: document.getElementById('sucesso-negocio'),
};

function mostrar(elemento, mensagem) {
  elemento.textContent = mensagem;
  elemento.hidden = !mensagem;
}

function mostrarSituacao(credenciais) {
  const temCredenciais = Boolean(credenciais);
  elementos.voltar.hidden = !temCredenciais;
  elementos.removerCredenciais.hidden = !temCredenciais;
  if (!temCredenciais) {
    elementos.situacao.textContent = 'Para ver seus relatórios, cadastre as credenciais da sua conta de afiliado.';
    return;
  }
  const data = new Date(credenciais.atualizadoEm).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  elementos.situacao.textContent = `Conectado com o AppID ${credenciais.appId} desde ${data}. Para trocar, preencha de novo.`;
}

async function carregar() {
  const resposta = await fetch('/api/eu');
  if (resposta.status === 401) {
    window.location.replace('/login');
    return;
  }
  const usuario = await resposta.json();
  elementos.nomeUsuario.textContent = `Olá, ${usuario.nome}`;
  elementos.emailUsuario.textContent = `Conta Google: ${usuario.email}`;
  elementos.nomeNegocio.value = usuario.nomeNegocio ?? '';
  mostrarSituacao(usuario.credenciais);
}

elementos.formNegocio.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrar(elementos.erroNegocio, '');
  mostrar(elementos.sucessoNegocio, '');
  elementos.salvarNegocio.disabled = true;
  try {
    const resposta = await fetch('/api/negocio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: elementos.nomeNegocio.value }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      throw new Error(dados.erro ?? 'Não foi possível salvar.');
    }
    elementos.nomeNegocio.value = dados.nomeNegocio ?? '';
    mostrar(elementos.sucessoNegocio, dados.nomeNegocio ? 'Nome salvo.' : 'Nome removido.');
  } catch (erro) {
    mostrar(elementos.erroNegocio, erro instanceof Error ? erro.message : 'Não foi possível salvar.');
  } finally {
    elementos.salvarNegocio.disabled = false;
  }
});

elementos.form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrar(elementos.erro, '');
  mostrar(elementos.sucesso, '');
  elementos.salvar.disabled = true;
  elementos.salvar.textContent = 'Validando com a Shopee...';
  try {
    const resposta = await fetch('/api/credenciais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: elementos.appId.value, secret: elementos.secret.value }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => ({}));
      throw new Error(dados.erro ?? 'Não foi possível salvar.');
    }
    // As credenciais estão salvas: segue para o painel.
    window.location.replace('/');
  } catch (erro) {
    mostrar(elementos.erro, erro instanceof Error ? erro.message : 'Não foi possível salvar.');
  } finally {
    elementos.salvar.disabled = false;
    elementos.salvar.textContent = 'Validar e salvar';
  }
});

elementos.removerCredenciais.addEventListener('click', async () => {
  if (!window.confirm('Remover as credenciais da Shopee? O painel deixa de mostrar seus relatórios até você cadastrar de novo.')) {
    return;
  }
  await fetch('/api/credenciais', { method: 'DELETE' });
  await carregar();
  mostrar(elementos.sucesso, 'Credenciais removidas.');
});

elementos.excluirConta.addEventListener('click', async () => {
  if (!window.confirm('Excluir sua conta? Seu cadastro e as credenciais da Shopee serão apagados e isso não pode ser desfeito.')) {
    return;
  }
  await fetch('/api/conta', { method: 'DELETE' });
  window.location.replace('/login');
});

elementos.sair.addEventListener('click', async () => {
  await fetch('/api/sair', { method: 'POST' }).catch(() => {});
  window.location.replace('/login');
});

// Cor do painel: aplica na hora e guarda neste aparelho (o tema.js reaplica em todas as páginas).
// Só os botões: a própria página (<html>) também recebe data-cor quando o rosa está ativo.
const botoesDeCor = document.querySelectorAll('button[data-cor]');

function marcarCor(cor) {
  for (const botao of botoesDeCor) botao.setAttribute('aria-pressed', String(botao.dataset.cor === cor));
}

function escolherCor(cor) {
  if (cor === 'rosa') document.documentElement.dataset.cor = 'rosa';
  else delete document.documentElement.dataset.cor;
  try {
    if (cor === 'rosa') localStorage.setItem('cor', 'rosa');
    else localStorage.removeItem('cor');
  } catch {
    // Sem armazenamento, a cor vale só até fechar a página.
  }
  marcarCor(cor);
}

for (const botao of botoesDeCor) botao.addEventListener('click', () => escolherCor(botao.dataset.cor));
marcarCor(document.documentElement.dataset.cor === 'rosa' ? 'rosa' : 'laranja');

carregar().catch(() => mostrar(elementos.erro, 'Sem conexão. Recarregue a página.'));
