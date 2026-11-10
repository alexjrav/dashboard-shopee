-- Usuários entram com a conta Google; o id é o identificador "sub" do Google.
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

-- Credenciais da Open API de afiliados. O Secret fica criptografado (AES-GCM).
CREATE TABLE credenciais_shopee (
  usuario_id TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  secret_cifrado TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
