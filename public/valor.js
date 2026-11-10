// Máscara do campo de valor: a pessoa digita só números e a vírgula aparece sozinha.
// Os dois últimos dígitos são os centavos: "1330" vira "13,30"; "5" vira "0,05".
const MAX_DIGITOS = 9; // até 9.999.999,99; o servidor recusa acima de R$ 100.000,00

export function mascararValor(texto) {
  const digitos = String(texto).replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITOS);
  if (!digitos) return '';
  const completo = digitos.padStart(3, '0');
  const reais = Number(completo.slice(0, -2)).toLocaleString('pt-BR');
  return `${reais},${completo.slice(-2)}`;
}

// Aplica a máscara enquanto a pessoa digita ou cola um valor.
export function ativarMascaraDeValor(campo) {
  campo.addEventListener('input', () => {
    campo.value = mascararValor(campo.value);
  });
}
