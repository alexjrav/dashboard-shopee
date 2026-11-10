// Cliente da API de afiliados. Usa só recursos padrão da web (fetch e crypto.subtle),
// para funcionar tanto no Node quanto no Cloudflare Workers.

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';
const LIMITE_POR_PAGINA = 50;
// No plano gratuito do Cloudflare, cada acesso pode fazer no máximo 50 chamadas externas.
const MAX_PAGINAS = 45;

export type ItemVendido = {
  itemId: number;
  itemName: string;
  imageUrl: string;
  qty: number;
  actualAmount: string;
  itemTotalCommission: string;
};

// Os itens não existem na resposta salva do primeiro teste.
export type Pedido = {
  orderId: string;
  orderStatus: string;
  items?: ItemVendido[];
};

// totalCommission foi conferido com a "Comissão est." do painel da Shopee.
export type Conversao = {
  conversionId: number;
  purchaseTime: number;
  totalCommission: string;
  orders: Pedido[];
};

export type FonteDeConversoes = (inicio: number, fim: number) => Promise<Conversao[]>;

type Pagina = {
  nodes: Conversao[];
  pageInfo: { hasNextPage: boolean; scrollId: string | null };
};

export type RespostaGraphQL<T = { conversionReport?: Pagina }> = {
  data?: T;
  errors?: unknown[];
};

export class ErroConfiguracao extends Error {}

function montarConsulta(inicio: number, fim: number, scrollId?: string) {
  const cursor = scrollId ? `\n        scrollId: ${JSON.stringify(scrollId)}` : '';
  return `
    query {
      conversionReport(
        purchaseTimeStart: ${inicio}
        purchaseTimeEnd: ${fim}
        limit: ${LIMITE_POR_PAGINA}${cursor}
      ) {
        nodes {
          conversionId
          purchaseTime
          totalCommission
          orders {
            orderId
            orderStatus
            items {
              itemId
              itemName
              imageUrl
              qty
              actualAmount
              itemTotalCommission
            }
          }
        }
        pageInfo {
          hasNextPage
          scrollId
        }
      }
    }
  `;
}

async function sha256Hex(texto: string): Promise<string> {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function criarClienteShopee(appId: string | undefined, secret: string | undefined) {
  async function executarConsulta<T>(query: string): Promise<T> {
    if (!appId || !secret) {
      throw new ErroConfiguracao('Defina SHOPEE_APP_ID e SHOPEE_SECRET_KEY nas configurações do servidor.');
    }
    const payload = JSON.stringify({ query });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const assinatura = await sha256Hex(appId + timestamp + payload + secret);

    const resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${assinatura}`,
      },
      body: payload,
    });
    const texto = await resposta.text();

    let corpo: RespostaGraphQL<T>;
    try {
      corpo = JSON.parse(texto);
    } catch {
      throw new Error(`Resposta inesperada da Shopee (HTTP ${resposta.status}).`);
    }
    if (!resposta.ok) {
      throw new Error(`HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
    }
    if (corpo.errors?.length) {
      throw new Error(`Erro GraphQL: ${JSON.stringify(corpo.errors)}`);
    }
    if (!corpo.data) {
      throw new Error('A Shopee não retornou dados.');
    }
    return corpo.data;
  }

  const buscarConversoes: FonteDeConversoes = async (inicio, fim) => {
    // As páginas são buscadas em sequência porque o scrollId expira rápido.
    const conversoes: Conversao[] = [];
    let scrollId: string | undefined;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const dados = await executarConsulta<{ conversionReport?: Pagina }>(montarConsulta(inicio, fim, scrollId));
      if (!dados.conversionReport) {
        throw new Error('A Shopee não retornou o relatório de conversões.');
      }
      conversoes.push(...dados.conversionReport.nodes);
      const { hasNextPage, scrollId: proximo } = dados.conversionReport.pageInfo;
      if (!hasNextPage || !proximo) {
        return conversoes;
      }
      scrollId = proximo;
    }
    throw new Error(
      `O período tem mais de ${MAX_PAGINAS * LIMITE_POR_PAGINA} conversões. Escolha um período menor.`,
    );
  };

  // Consulta mínima (1 conversão das últimas 24 horas) só para confirmar que a Shopee aceita as credenciais.
  async function validarCredenciais(): Promise<void> {
    const fim = Math.floor(Date.now() / 1000);
    await executarConsulta(
      `query { conversionReport(purchaseTimeStart: ${fim - 24 * 60 * 60} purchaseTimeEnd: ${fim} limit: 1) { nodes { conversionId } } }`,
    );
  }

  return { executarConsulta, buscarConversoes, validarCredenciais };
}
