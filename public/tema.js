// Aplica o tema salvo antes de desenhar a página, para não piscar.
// Fica em arquivo (e não dentro do HTML) para a política de segurança permitir só scripts do próprio site.
try {
  const tema = localStorage.getItem('tema');
  if (tema === 'claro' || tema === 'escuro') document.documentElement.dataset.tema = tema;
} catch {}
