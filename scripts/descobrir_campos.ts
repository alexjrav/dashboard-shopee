// Lista as consultas e os campos que a API de afiliados oferece para esta conta.
// Não lê vendas: só a descrição do esquema. Rode com: npm run descobrir-campos
import { criarClienteShopee } from '../src/shopee.ts';

type TipoRef = { name: string | null; kind: string; ofType: TipoRef | null };
type Campo = { name: string; type: TipoRef };
type Tipo = { name: string; kind: string; fields: Campo[] | null };

function nomeDoTipo(tipo: TipoRef | null): string {
  if (!tipo) return '?';
  if (tipo.kind === 'NON_NULL') return `${nomeDoTipo(tipo.ofType)}!`;
  if (tipo.kind === 'LIST') return `[${nomeDoTipo(tipo.ofType)}]`;
  return tipo.name ?? '?';
}

const { executarConsulta } = criarClienteShopee(process.env.SHOPEE_APP_ID, process.env.SHOPEE_SECRET_KEY);
const refTipo = 'name kind ofType { name kind ofType { name kind ofType { name kind } } }';
const dados = await executarConsulta<{ __schema: { queryType: { name: string }; types: Tipo[] } }>(`
  query {
    __schema {
      queryType { name }
      types { name kind fields { name type { ${refTipo} } } }
    }
  }
`);

const tipos = dados.__schema.types.filter((t) => t.kind === 'OBJECT' && !t.name.startsWith('__') && t.fields);
const raiz = tipos.find((t) => t.name === dados.__schema.queryType.name);

console.log('CONSULTAS DISPONÍVEIS');
for (const campo of raiz?.fields ?? []) {
  console.log(`  ${campo.name}: ${nomeDoTipo(campo.type)}`);
}

console.log('\nTIPOS E CAMPOS');
for (const tipo of tipos) {
  if (tipo === raiz) continue;
  console.log(`\n${tipo.name}`);
  for (const campo of tipo.fields ?? []) {
    console.log(`  ${campo.name}: ${nomeDoTipo(campo.type)}`);
  }
}

const mencoesDeClique = tipos.flatMap((t) =>
  (t.fields ?? []).filter((c) => /click/i.test(c.name)).map((c) => `${t.name}.${c.name}`),
);
console.log('\nCAMPOS COM "CLICK" NO NOME');
console.log(mencoesDeClique.length ? mencoesDeClique.map((m) => `  ${m}`).join('\n') : '  nenhum');
