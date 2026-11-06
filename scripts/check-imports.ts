import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
for(const [workspace,name,requiredExport] of [['feasibility','@arkiv-network/sdk','createPublicClient'],['cre','@chainlink/cre-sdk','HTTPClient']] as const){
  const require=createRequire(new URL(`../packages/${workspace}/package.json`,import.meta.url));
  const manifestUrl=new URL(`../packages/${workspace}/node_modules/${name}/package.json`,import.meta.url);
  const manifest=JSON.parse(readFileSync(manifestUrl,'utf8')) as {exports?:{'.'?:{import?:string}}};
  const esmEntry=manifest.exports?.['.']?.import;
  const moduleUrl=esmEntry?new URL(esmEntry,manifestUrl).href:pathToFileURL(require.resolve(name)).href;
  const imported:Record<string,unknown>=await import(moduleUrl);
  if(!(requiredExport in imported))throw new Error(`Required SDK export missing: ${name}/${requiredExport}`);
  process.stdout.write(`${name}: imported ${requiredExport}\n`);
}
