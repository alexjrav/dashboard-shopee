-- Gastos com anúncios registrados pela afiliada, de qualquer canal, para calcular o ROI do período.
-- O valor fica em centavos (inteiro) para não haver erro de arredondamento.
CREATE TABLE gastos_anuncios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  descricao TEXT,
  criado_em TEXT NOT NULL
);

-- As consultas são sempre "gastos desta usuária neste período".
CREATE INDEX gastos_anuncios_usuario_data ON gastos_anuncios (usuario_id, data);
