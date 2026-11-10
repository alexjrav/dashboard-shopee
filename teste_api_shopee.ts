import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const endpoint = 'https://open-api.affiliate.shopee.com.br/graphql';
const responseFile = join(dirname(fileURLToPath(import.meta.url)), 'resposta.json');
const appId = process.env.SHOPEE_APP_ID;
const secret = process.env.SHOPEE_SECRET_KEY;

if (!appId || !secret) {
  throw new Error('Defina as variáveis de ambiente SHOPEE_APP_ID e SHOPEE_SECRET_KEY.');
}

async function getConversionReport(
  purchaseTimeStart: number,
  purchaseTimeEnd: number,
  limit: number,
) {
  const query = `
    query {
      conversionReport(
        purchaseTimeStart: ${purchaseTimeStart}
        purchaseTimeEnd: ${purchaseTimeEnd}
        limit: ${limit}
      ) {
        nodes {
          conversionId
          purchaseTime
          totalCommission
          orders {
            orderId
            orderStatus
          }
        }
        pageInfo {
          hasNextPage
          scrollId
        }
      }
    }
  `;
  const payloadString = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash('sha256')
    .update(appId + timestamp + payloadString + secret)
    .digest('hex');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payloadString,
  });
  const result: unknown = await response.json();
  await writeFile(responseFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  }

  if (
    typeof result === 'object' &&
    result !== null &&
    'errors' in result &&
    Array.isArray(result.errors) &&
    result.errors.length > 0
  ) {
    throw new Error(`Erro GraphQL: ${JSON.stringify(result.errors)}`);
  }

  return result;
}

async function main() {
  const daysBack = 7;
  const purchaseTimeEnd = Math.floor(Date.now() / 1000);
  const purchaseTimeStart = purchaseTimeEnd - daysBack * 24 * 60 * 60;
  const limit = 50;

  const report = await getConversionReport(
    purchaseTimeStart,
    purchaseTimeEnd,
    limit,
  );
  console.log('Relatório de conversões:', JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error('Erro ao consultar o relatório de conversões:', error);
  process.exitCode = 1;
});
