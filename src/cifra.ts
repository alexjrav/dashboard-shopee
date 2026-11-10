// Criptografia do Secret da Shopee antes de salvar no banco (AES-GCM, 256 bits).
// A chave vem do segredo CHAVE_CRIPTOGRAFIA: 32 bytes em base64.

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

function paraBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function deBase64(texto: string): Uint8Array {
  return Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));
}

async function importarChave(chaveBase64: string): Promise<CryptoKey> {
  const bytes = deBase64(chaveBase64);
  if (bytes.length !== 32) {
    throw new Error('CHAVE_CRIPTOGRAFIA deve ter 32 bytes em base64.');
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Resultado no formato "iv.dados", os dois em base64. Cada chamada usa um iv novo.
export async function cifrar(texto: string, chaveBase64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importarChave(chaveBase64), codificador.encode(texto));
  return `${paraBase64(iv)}.${paraBase64(new Uint8Array(dados))}`;
}

export async function decifrar(cifrado: string, chaveBase64: string): Promise<string> {
  const [iv, dados] = cifrado.split('.');
  const texto = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: deBase64(iv) },
    await importarChave(chaveBase64),
    deBase64(dados),
  );
  return decodificador.decode(texto);
}
