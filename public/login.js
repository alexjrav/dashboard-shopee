// Mostra o motivo quando o login com Google não deu certo.
const MENSAGENS = {
  cancelado: 'O login foi cancelado. Tente de novo quando quiser.',
  expirado: 'O tempo para entrar acabou. Tente de novo.',
  google: 'Não foi possível entrar com o Google. Tente de novo.',
  'nao-autorizado': 'Esta conta Google ainda não foi liberada para usar o painel. Peça acesso a quem enviou o link.',
};

const codigo = new URLSearchParams(window.location.search).get('erro');
const erro = document.getElementById('erro');
if (codigo) {
  erro.textContent = MENSAGENS[codigo] ?? MENSAGENS.google;
  erro.hidden = false;
}
