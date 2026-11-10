# Painel de Comissões Shopee

Painel web para afiliadas da Shopee acompanharem vendas, comissões, gastos com anúncios e **ROI** por período, com relatório em PDF. Projeto da disciplina de Projeto de Software, criado para a Home da Isa (parceira: Isabely).

- **Endereço publicado:** https://painel-comissoes-shopee.painel-afiliado.workers.dev
- **Protótipo de teste (dados fictícios):** https://prototipo-painel-afiliado.painel-afiliado.workers.dev (código em `docs/prototipo/`)
- **Hospedagem:** Cloudflare Workers + banco Cloudflare D1 (plano gratuito)
- **Login:** conta Google, somente para e-mails aprovados por você
- **Dados de vendas:** API de afiliados da Shopee (Open API), consultada em tempo real

---

## 1. Visão geral

### O que o sistema faz
1. A pessoa entra com a conta Google (se o e-mail estiver na lista de aprovados).
2. Na primeira vez, cadastra o **AppID** e o **Secret** da API de afiliados da Shopee. O sistema testa as credenciais antes de salvar.
3. O painel consulta a Shopee e mostra, para o período escolhido: comissão prevista, comissão confirmada, pedidos, itens vendidos, valor dos pedidos, cancelados, totais por status, totais por dia e o Top 5 de produtos.
4. Na seção **Gastos com anúncios**, a pessoa registra quanto gastou em cada dia (de qualquer canal). O painel soma os gastos do período e mostra o **ROI confirmado** e o **ROI estimado**, com a palavra Lucro ou Prejuízo.
5. O botão **Gerar PDF** abre a impressão do navegador com o relatório do período, no tema (normal ou noturno) que estiver na tela.

### Como as peças se encaixam

```
Navegador  ──►  Cloudflare Worker (src/worker.ts)  ──►  API de afiliados da Shopee
 (public/)         │        │
                   │        └──►  Google (login OAuth)
                   └──►  Banco D1 (usuários e credenciais criptografadas)
```

- A **tela** (pasta `public/`) é HTML, CSS e JavaScript puros, sem bibliotecas.
- O **servidor** é um Worker da Cloudflare. Ele roda **antes** de entregar qualquer arquivo, para exigir login também nas páginas.
- O **Secret da Shopee nunca vai para o navegador.** Ele fica criptografado no banco e só é lido pelo servidor, no momento da consulta.

### Estado atual
| Item | Situação |
|---|---|
| Login com Google + lista de aprovados | Pronto e publicado |
| Cadastro e validação das credenciais da Shopee | Pronto e publicado |
| Painel, PDF, modo noturno, atalhos de período | Pronto e publicado |
| Nome do negócio (campo nas Configurações) | Pronto e publicado |
| Gastos com anúncios e cálculo do ROI | Pronto e publicado em 10/11/2026 (História 2); falta conferir com uma conta logada e dados reais |
| Cliques | **Não disponível:** a API da Shopee não informa cliques (seção 4.4) |

---

## 2. Estrutura das pastas

```
teste-api-shopee/
├── src/
│   ├── worker.ts          Entrada do Cloudflare (liga segredos e banco às rotas)
│   ├── aplicacao.ts       Todas as rotas e regras de acesso
│   ├── autenticacao.ts    Sessão em cookie assinado (HMAC) e cookie do login Google
│   ├── google.ts          Login com Google (OAuth 2.0 com PKCE)
│   ├── cifra.ts           Criptografia do Secret da Shopee (AES-GCM)
│   ├── repositorio.ts     Acesso ao banco D1 (e versão em memória para testes)
│   ├── shopee.ts          Cliente da API da Shopee (assinatura, consulta, paginação)
│   ├── gastos.ts          Validação dos gastos com anúncios (data, valor, descrição)
│   └── relatorio.ts       Cálculos: totais, status, dias, produtos, ROI, fuso de Brasília
├── public/                Telas: login, painel (index), configurações, estilo, scripts
├── migrations/            Criação e alteração das tabelas do banco
├── tests/                 Testes automáticos (54)
├── docs/                  Guia em PDF e protótipo das telas (docs/prototipo)
├── scripts/descobrir_campos.ts   Lista o que a API da Shopee oferece (usa o .env)
├── wrangler.jsonc         Configuração do Worker, do banco e dos arquivos da tela
├── .dev.vars              Segredos para rodar no seu computador (NÃO vai para o Git)
├── .dev.vars.example      Modelo do .dev.vars
├── .env / .env.example    Credenciais da Shopee só para o script descobrir-campos
├── teste_api_shopee.ts, teste_shopee.py, resposta.json   Testes antigos da API (legado)
└── README.md
```

---

## 3. Rodando no seu computador

**Requisitos:** Node.js 24 ou mais novo. As dependências são só o Wrangler (`npm install`).

```bash
npm install
npm run dev        # aplica as migrações no banco local e abre em http://localhost:8787
npm test           # roda os 54 testes automáticos
```

- O `.dev.vars` guarda os segredos locais. Copie o `.dev.vars.example` e preencha (seção 7).
- Com `MODO_DESENVOLVIMENTO=1` no `.dev.vars`, o endereço `http://localhost:8787/auth/dev` entra sem Google. Esse atalho **só existe no computador**, nunca em produção.
- O banco local fica em `.wrangler/state/` e é **separado** do banco de produção. Cadastros feitos aqui não aparecem no site publicado.
- Se `npm run dev` avisar que a porta está ocupada, há um servidor antigo aberto. No PowerShell: `Get-Process workerd | Stop-Process`.
- Mantenha o `.dev.vars` na pasta. Sem ele, o Wrangler pode ler o `.env` no lugar e o painel acusa configuração faltando.

---

## 4. Como cada parte funciona

### 4.1 Login e sessão
1. **Entrar com o Google** leva ao Google com um código de estado e PKCE (proteção contra troca de códigos).
2. O Google devolve a pessoa para `/auth/google/callback`. O servidor troca o código pelo perfil (nome, e-mail, identificador).
3. Se o e-mail **não** estiver em `EMAILS_PERMITIDOS`, a pessoa volta ao login com um aviso e **nada é salvo**.
4. Se estiver, o usuário é criado (ou atualizado) e recebe um cookie de sessão de **30 dias**: assinado, `HttpOnly`, `Secure` e `SameSite=Lax`.
5. A cada acesso o servidor confere de novo: a sessão vale, a conta ainda existe **e** o e-mail continua na lista. Tirar alguém da lista derruba a sessão na hora.

Rotas de entrada: `/auth/google`, `/auth/google/callback`. Alterações enviadas por outro site são recusadas (conferência de `Origin`).

### 4.2 Credenciais da Shopee
- Onde obter: portal de afiliados da Shopee, menu **Abrir API** (AppID e Secret).
- Na tela **Configurações**, ao salvar, o servidor faz uma consulta mínima à Shopee. Se ela recusar, **nada é salvo**.
- O Secret é criptografado com AES-GCM usando a `CHAVE_CRIPTOGRAFIA` e gravado no formato `iv.dados`. Sem a chave, o banco sozinho não revela o Secret.

### 4.3 Painel e cálculos
- **Período:** Hoje, Ontem, Últimos 7 dias, Este mês, Mês passado ou Personalizado. Os dias seguem o **horário de Brasília** (UTC-3).
- **Comissão prevista:** soma de `totalCommission` dos pedidos que não foram cancelados.
- **Comissão confirmada:** soma só dos pedidos com status `COMPLETED` (Concluído).
- **Valor dos pedidos:** soma de `actualAmount` (valor pago pelos compradores).
- **Valores:** somados com precisão de 5 casas decimais e arredondados só na exibição, para não gerar diferença de centavos.
- **Conferência feita:** de 01/11 a 03/11/2026, pedidos, itens, comissão por dia, valor dos pedidos e Top 5 bateram com o painel da Shopee.
- **Limite por consulta:** até 45 páginas de 50 conversões (2.250 conversões). Períodos maiores pedem para escolher um intervalo menor.

### 4.4 O que a API da Shopee informa (e o que não informa)
- **Autenticação:** cabeçalho `Authorization: SHA256 Credential=<AppID>, Timestamp=<agora>, Signature=<assinatura>`, onde a assinatura é o SHA-256 de `AppID + timestamp + corpo da requisição + Secret`.
- **Endereço:** `https://open-api.affiliate.shopee.com.br/graphql`
- **Consultas disponíveis** (listadas pelo script `npm run descobrir-campos`): ofertas (`shopOfferV2`, `shopeeOfferV2`, `productOfferV2`), relatórios (`conversionReport`, `validatedReport`, `partnerOrderReport`) e feeds de produtos.
- **Cliques:** não existe relatório de cliques. Só há `clickTime` nas conversões, isto é, o clique que **virou compra**. Os cliques totais do painel da Shopee não vêm pela API.
- **Nome da empresa/conta:** a API **não** tem consulta de perfil. Os campos "nome" são da loja vendedora (`shopName`) e da rede MCN (`linkedMcnName`). Por isso o **Nome do negócio** é preenchido pela própria pessoa nas Configurações.
- **Paginação:** por `scrollId`. Segundo fontes não oficiais, ele expira em cerca de 30 segundos, então as páginas são buscadas em sequência.

### 4.5 Nome do negócio
Campo opcional em **Configurações**, até 80 caracteres. Aparece logo abaixo de "Olá, Nome" no painel e também no PDF. Fica na coluna `nome_negocio` da tabela `usuarios` (migração `0002`). Um novo login do Google não apaga esse nome.

### 4.6 Gastos com anúncios e ROI
- **Registro:** data (não pode ser futura), valor em reais e descrição opcional de até 80 caracteres. O valor aceita `25,50`, `25.50`, `25` e `R$ 1.234,56`, e fica guardado em centavos. Erros voltam com o campo e a correção, por exemplo "Informe um valor maior que zero, como 25,50."
- **Fórmula:** `ROI = (comissão − gasto) ÷ gasto`, calculada em centavos.
  - **ROI confirmado:** usa só a comissão de pedidos concluídos.
  - **ROI estimado:** usa a comissão prevista, que inclui pedidos pendentes. Aparece com a etiqueta "estimativa".
  - Sem gasto no período, o ROI fica vazio ("Sem gasto registrado neste período").
- **Na tela:** o ROI aparece com sinal, seta e a palavra **Lucro** ou **Prejuízo**, e não só pela cor. A tabela por dia ganha a coluna de gasto.
- **Exclusão:** cada gasto tem "Excluir", sempre com confirmação. Uma afiliada só vê e exclui os próprios gastos.

### 4.7 Banco de dados (D1)
| Tabela | Campos |
|---|---|
| `usuarios` | `id` (identificador do Google), `email`, `nome`, `criado_em`, `nome_negocio` |
| `credenciais_shopee` | `usuario_id`, `app_id`, `secret_cifrado`, `atualizado_em` |
| `gastos_anuncios` | `id`, `usuario_id`, `data` (AAAA-MM-DD), `valor_centavos`, `descricao`, `criado_em` (migração `0003`) |

Excluir a conta (Configurações) apaga o usuário, as credenciais e os gastos.

### 4.8 Rotas do servidor
| Rota | Quem acessa | Função |
|---|---|---|
| `GET /login`, `/login.js`, `/estilo.css` | Qualquer pessoa | Tela de login |
| `GET /auth/google`, `/auth/google/callback` | Qualquer pessoa | Fluxo do login Google |
| `GET /` e `/configuracoes` | Logada | Páginas |
| `GET /api/eu` | Logada | Nome, e-mail, nome do negócio e credenciais (só AppID) |
| `GET /api/relatorio?inicio=AAAA-MM-DD&fim=AAAA-MM-DD` | Logada | Relatório do período, com gasto e ROI |
| `GET /api/gastos?inicio=AAAA-MM-DD&fim=AAAA-MM-DD` | Logada | Gastos da usuária no período e total |
| `POST /api/gastos` | Logada | Valida e registra um gasto (`data`, `valor`, `descricao`) |
| `DELETE /api/gastos/:id` | Logada | Exclui um gasto da própria usuária (de outra pessoa: 404) |
| `POST /api/negocio` | Logada | Salva o nome do negócio |
| `POST` / `DELETE /api/credenciais` | Logada | Valida e salva / remove credenciais da Shopee |
| `DELETE /api/conta` | Logada | Exclui a conta e os dados |
| `POST /api/sair` | Qualquer pessoa | Encerra a sessão |

---

## 5. Google (login)

### 5.1 O que existe hoje
- **Projeto no Google Cloud:** `painel-comissoes-shopee` (console.cloud.google.com, menu **Google Auth Platform**).
- **Tela de consentimento:** nome do app "Painel de Comissões Shopee", público **Externo**, status **Testando**.
- **Escopos usados:** `openid`, `email` e `profile` (os básicos, sem verificação especial).
- **Cliente OAuth** tipo "Aplicativo da Web" (nome "Cliente Web 1") com dois endereços de retorno autorizados:
  - `http://localhost:8787/auth/google/callback` (computador)
  - `https://painel-comissoes-shopee.painel-afiliado.workers.dev/auth/google/callback` (produção)

### 5.2 Coisas que você deve saber
- **A lista de "usuários de teste" do Google não barra ninguém.** A Isabely entrou sem estar nela. Quem barra é a lista `EMAILS_PERMITIDOS` do sistema (seção 8).
- **Aviso "Google não verificou este app":** aparece para todos enquanto o app está em testes. É esperado: clique em Avançar e depois em Continuar.
- **Limite de 100 usuários** enquanto o app não for verificado pelo Google.
- **O Secret do cliente só aparece uma vez**, quando é criado. Se perder, crie um novo segredo na página do cliente (Google Auth Platform > Clientes > o cliente) e atualize onde ele é usado (item abaixo). A interface do Google muda com frequência, então procure por "adicionar segredo".
- **Publicar o app** (sair do modo de testes) exige completar a página **Branding** (política de privacidade, domínio autorizado). Isso não foi tentado e pode exigir um domínio próprio, porque `workers.dev` pode não ser aceito como domínio autorizado.

### 5.3 Trocar o Secret ou o ID do cliente
1. Atualize `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` no `.dev.vars`.
2. Em produção: `npx wrangler secret put GOOGLE_CLIENT_SECRET` (e o mesmo para `GOOGLE_CLIENT_ID`). Não precisa publicar o código de novo.

### 5.4 Mudou o endereço do site?
Se o endereço público mudar (outro subdomínio ou domínio próprio), cadastre o novo `https://<endereço>/auth/google/callback` na página do cliente OAuth. O Google pode levar de alguns minutos a horas para aplicar. Erro típico: `redirect_uri_mismatch`.

### 5.5 Refazer do zero (resumo)
1. Console do Google Cloud: criar projeto novo.
2. Google Auth Platform > Começar: nome do app, e-mail de suporte, público **Externo**, e-mail de contato, aceitar a política.
3. Clientes > Criar cliente > **Aplicativo da Web**, com os endereços de retorno acima.
4. Copiar ID e Secret para o `.dev.vars` e para os segredos da Cloudflare.

---

## 6. Cloudflare (hospedagem)

### 6.1 O que existe hoje
| Item | Valor |
|---|---|
| Conta | A conta Cloudflare do Álex (login `npx wrangler login`) |
| Worker | `painel-comissoes-shopee` |
| Subdomínio `workers.dev` | `painel-afiliado` (fica público e ligado à conta) |
| Banco D1 | `painel-comissoes` (identificador no `wrangler.jsonc`) |
| Endereços de pré-visualização | Desligados (`preview_urls: false`) |

**O site NÃO está no GitHub.** Ele foi enviado direto do computador para a Cloudflare pelo comando `npm run deploy`. O GitHub é opcional (seção 9).

### 6.2 Publicar uma mudança
```bash
npm test           # confira antes de publicar
npm run deploy     # aplica migrações novas no banco de produção e envia o código e a tela
```
A publicação é imediata. O endereço continua o mesmo.

### 6.3 Segredos de produção
Ficam guardados na Cloudflare e **não podem ser lidos de volta**. Para ver os nomes: `npx wrangler secret list`.

| Segredo | Para que serve | Se mudar |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Identifica o app no Google | Troca junto com o cliente OAuth |
| `GOOGLE_CLIENT_SECRET` | Segredo do cliente OAuth | Login falha até atualizar |
| `SEGREDO_SESSAO` | Assina os cookies de sessão | **Todo mundo é deslogado** |
| `CHAVE_CRIPTOGRAFIA` | Criptografa o Secret da Shopee no banco | **As credenciais salvas ficam ilegíveis**; cada pessoa precisa cadastrar de novo |
| `EMAILS_PERMITIDOS` | Lista de e-mails que podem entrar | Quem sair da lista perde o acesso na hora |

Cadastrar ou trocar um segredo (o comando pede o valor, que não fica gravado em arquivo):
```bash
npx wrangler secret put NOME_DO_SEGREDO
```
**Guarde uma cópia da `CHAVE_CRIPTOGRAFIA` em lugar seguro** (gerenciador de senhas). Ela existe só no `.dev.vars` e na Cloudflare.

### 6.4 Banco de dados em produção
```bash
npx wrangler d1 execute painel-comissoes --remote --command "SELECT email, nome, criado_em FROM usuarios;"
npx wrangler d1 migrations apply painel-comissoes --remote     # criar/alterar tabelas
```
Nunca rode consultas que mostrem `secret_cifrado` em lugares públicos. Para mudar a estrutura do banco, crie um arquivo novo em `migrations/` (`0003_...sql`) e rode `npm run deploy`.

### 6.5 Ver erros e voltar versão
```bash
npx wrangler tail                       # logs ao vivo (Ctrl+C para sair)
npx wrangler deployments list           # histórico de publicações
npx wrangler rollback                   # volta para a versão anterior
```
O painel da Cloudflare (dash.cloudflare.com > Workers & Pages > `painel-comissoes-shopee`) também mostra métricas e logs.

### 6.6 Limites do plano gratuito
Valores conhecidos em nov/2026, a conferir na página de preços da Cloudflare: cerca de 100 mil requisições por dia, tempo de CPU curto por requisição, até 50 chamadas externas por requisição (por isso o limite de 45 páginas da Shopee) e armazenamento do D1 de alguns GB. Para o uso de uma ou poucas afiliadas, há muita folga. Confira também os termos de uso para uso comercial.

### 6.7 Trocar de conta ou de subdomínio
- **Sair da conta neste computador:** `npx wrangler logout`.
- **Mudar o subdomínio:** no painel da Cloudflare, Workers & Pages, configurações de subdomínio. O endereço muda, então **atualize o endereço de retorno no Google** (seção 5.4).

### 6.8 Refazer do zero (resumo)
```bash
npx wrangler login
npx wrangler d1 create painel-comissoes          # copie o id para o wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID         # repita para os 5 segredos
npm run deploy
```
Na primeira publicação, a Cloudflare pede para registrar um subdomínio `workers.dev`. Se o comando reclamar, abra o painel da Cloudflare e registre por lá.

---

## 7. Variáveis de configuração

Arquivo `.dev.vars` (computador). Modelo em `.dev.vars.example`. Cuidado: o arquivo não pode ter caracteres estranhos no início (BOM).

| Variável | Uso |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Do cliente OAuth do Google |
| `SEGREDO_SESSAO` | Texto aleatório longo |
| `CHAVE_CRIPTOGRAFIA` | 32 bytes aleatórios em base64 |
| `EMAILS_PERMITIDOS` | E-mails separados por vírgula |
| `MODO_DESENVOLVIMENTO` | `1` libera `/auth/dev` **só no computador**; nunca em produção |

Gerar um valor aleatório:
```bash
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
```

O `.env` é usado **apenas** pelo script `npm run descobrir-campos` e tem `SHOPEE_APP_ID` e `SHOPEE_SECRET_KEY`.

---

## 8. Liberar ou bloquear pessoas

A lista fica no segredo `EMAILS_PERMITIDOS` (e-mails separados por vírgula, sem diferença de maiúsculas). Sem a lista, **ninguém entra**.

```bash
npx wrangler secret put EMAILS_PERMITIDOS
```
Informe a lista **inteira** (a nova substitui a antiga). Não precisa publicar o código de novo. Quem for removido perde o acesso imediatamente, mas os dados dele continuam no banco até a conta ser excluída.

Para apagar os dados de alguém, a própria pessoa usa **Configurações > Excluir minha conta**. Você também pode apagar direto no banco (seção 6.4).

---

## 9. GitHub

- Repositório **público**: https://github.com/alexjrav/dashboard-shopee (branch `main`). É público porque a disciplina avalia o código.
- O `.gitignore` protege `.env`, `.dev.vars`, `resposta.json`, `.wrangler/`, `node_modules/` e cópias do banco (`copia*.sql`, `backup*.sql`).
- Antes de cada envio, rode `git status` e confirme que **nenhum desses arquivos aparece**. Como o repositório é público, qualquer segredo enviado fica exposto.
- O identificador do banco no `wrangler.jsonc` não é segredo.
- Mensagens de commit seguem o padrão semântico: `feat:` (função nova), `fix:` (correção), `test:` (testes), `docs:` (documentação).

A rotina é: `npm test`, `git add` dos arquivos alterados, `git commit -m "tipo: o que mudou"` e `git push`. Publicar no site continua sendo `npm run deploy`, que é independente do GitHub.
- Publicação automática a cada envio ao GitHub é possível pelo recurso de integração Git da Cloudflare (Workers Builds), mas **não está configurada**: hoje a publicação é sempre manual.

---

## 10. Segurança em resumo

- Secret da Shopee: criptografado no banco, nunca enviado ao navegador, não aparece em logs.
- Sessão: cookie assinado, `HttpOnly`, `Secure`, 30 dias; encerra ao sair, excluir a conta ou sair da lista.
- Login Google com PKCE e conferência do token (emissor, aplicativo, validade, e-mail verificado).
- Pedidos de alteração vindos de outro site são recusados.
- Cada pessoa só consulta a Shopee com as próprias credenciais.
- **Nunca** coloque `.dev.vars`, `.env`, `resposta.json` ou prints com AppID/Secret em pastas públicas, no Git ou em mensagens.
- Se um Secret vazar: gere outro no portal da Shopee e cadastre de novo; para o Google, crie outro segredo do cliente.

---

## 11. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Configure SEGREDO_SESSAO, CHAVE_CRIPTOGRAFIA, GOOGLE_CLIENT_ID e EMAILS_PERMITIDOS" | Falta algum segredo | `npx wrangler secret list` e cadastre o que faltar |
| `redirect_uri_mismatch` no Google | Endereço de retorno não cadastrado ou ainda não aplicado | Seção 5.4; espere alguns minutos |
| "Esta conta Google ainda não foi liberada" | E-mail fora da lista | Seção 8 |
| Pessoa liberada cai de novo no login | Sessão antiga ou e-mail diferente do da lista | Conferir o e-mail e entrar de novo |
| "A Shopee não aceitou essas credenciais" | AppID/Secret errados ou com espaço | Copiar de novo no portal da Shopee |
| "Cadastre suas credenciais da Shopee" | Credenciais removidas ou banco novo | Configurações > cadastrar |
| "Não foi possível consultar a Shopee agora" | Falha ou instabilidade da API | Tentar de novo; `npx wrangler tail` mostra o motivo |
| Erro de SSL logo após criar o subdomínio | O certificado ainda não propagou | Esperar 1 a 3 minutos |
| Credenciais salvas deixam de funcionar para todos | `CHAVE_CRIPTOGRAFIA` foi trocada | Cada pessoa cadastra de novo |
| PDF sai branco ou sem fundo | Opção do navegador | Ativar "Gráficos em segundo plano" na impressão |
| PDF fica muito pequeno | Escala dobrada | Deixar a escala em **Padrão** (o relatório já reduz para cerca de 86%) |
| `npm run dev` diz que a porta está ocupada | Servidor antigo aberto | `Get-Process workerd \| Stop-Process` |
| Mudança não aparece no site | Faltou publicar | `npm run deploy`; recarregar com Ctrl+F5 |

---

## 12. Pendências do projeto

1. **Conferir gastos e ROI em produção** com uma conta logada: registrar e excluir um gasto de teste e ver o ROI do período. Publicado em 10/11/2026, com a migração `0003` aplicada no banco real.
2. **Validação com a Isabely** (13 a 15/11/2026): teste do protótipo (`docs/prototipo/`), medir o tempo antes e depois, conferir os totais com o painel da Shopee e obter o termo de aceite.
3. **Confirmar com a Isabely** a fórmula de ROI que ela usa e se há outros custos além dos anúncios.
4. **Planejados, ainda não feitos:** cabeçalho Content-Security-Policy, limite de tentativas nas rotas de login e de credenciais, migração da tela para Angular.
5. **Opcional:** domínio próprio, verificação do app no Google, edição de gasto (hoje: excluir e lançar de novo) e ROI por anúncio.
