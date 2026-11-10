-- Nome do negócio da afiliada, informado por ela nas Configurações (a API da Shopee não fornece esse dado).
ALTER TABLE usuarios ADD COLUMN nome_negocio TEXT;
