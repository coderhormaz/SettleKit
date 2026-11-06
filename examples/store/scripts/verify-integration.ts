import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const store=process.env.STORE_ORIGIN??'http://127.0.0.1:3200';
const gateway=process.env.APP_ORIGIN??'http://127.0.0.1:3000';
const apiKey=process.env.STORE_GATEWAY_API_KEY;
const readKey=process.env.STORE_ORDER_READ_KEY;
if(!apiKey||!readKey)throw new Error('Configured local merchant integration credentials required.');
type Json = Record<string,unknown>;
async function request(url:string,method='GET',body?:unknown,headers:Record<string,string>={}){
  const response=await fetch(url,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15_000)});
  return {status:response.status,body:await response.json() as Json};
}
const checks:string[]=[];
const created=await request(`${store}/api/orders`,'POST',{amount_base_units:'1'},{Origin:store});
assert.equal(created.status,201);assert.equal(created.body.amount_base_units,'25000000');
const id=String(created.body.id);const cancelToken=String(created.body.cancel_token);const reference=String(created.body.reference);
assert.match(id,/^[0-9a-f-]{36}$/);assert.match(reference,/^[a-f0-9]{64}$/);checks.push('Store catalog overrides untrusted browser amount and creates actual25USDT checkout.');
const order=await request(`${store}/api/orders/${id}`,'GET',undefined,{Authorization:`Bearer ${readKey}`});
assert.equal(order.status,200);assert.equal(order.body.order_ref,id);assert.equal(order.body.amount_base_units,'25000000');assert.equal(order.body.state,'pending');
assert.deepEqual(Object.keys(order.body).sort(),['order_ref','amount_base_units','state','payment_id','state_version'].sort());checks.push('Scoped authenticated minimal order read matches real persisted order.');
assert.equal((await request(`${store}/api/orders/${id}`)).status,401);
assert.equal((await request(`${store}/api/orders/${id}`,'GET',undefined,{Authorization:'Bearer forged-private-key'})).status,401);checks.push('Missing/forged order-read credentials rejected401.');
const publicStatus=await request(`${store}/api/orders/${id}/status`);assert.equal(publicStatus.status,200);assert.equal(publicStatus.body.state,'pending');assert.equal(publicStatus.body.fulfillment_count,0);
assert.deepEqual(Object.keys(publicStatus.body).sort(),['id','amount_base_units','state','state_version','fulfillment_count'].sort());checks.push('Public status is minimal actual state; no redirect-driven fulfillment.');
const checkout=await request(`${gateway}/api/checkout/${reference}`);assert.equal(checkout.status,200);assert.equal(checkout.body.amount_base_units,'25000000');assert.equal(checkout.body.chain_id,1874);assert.equal(checkout.body.status,'open');assert.equal(checkout.body.router,null);checks.push('Actual public checkout preserves exact token/chain/amount; absent router is explicit.');
const payload={order_id:id,amount_base_units:'25000000',return_url:`${store}/?order=${id}`};
const keyHeaders={Authorization:`Bearer ${apiKey}`,'Idempotency-Key':id};
const repeated=await request(`${gateway}/api/v1/checkouts`,'POST',payload,keyHeaders);assert.equal(repeated.status,200);assert.equal(repeated.body.reference,reference);checks.push('Same merchant idempotency key/body returns the same persisted checkout.');
const conflict=await request(`${gateway}/api/v1/checkouts`,'POST',{...payload,return_url:`${store}/result?order=${id}`},keyHeaders);assert.equal(conflict.status,409);checks.push('Changed idempotent request rejected409.');
assert.equal((await request(`${gateway}/api/v1/checkouts`,'POST',payload,{...keyHeaders,Authorization:'Bearer sk_'+'0'.repeat(64)})).status,401);checks.push('Forged gateway server key rejected401.');
assert.equal((await request(`${gateway}/api/v1/checkouts`,'POST',{...payload,return_url:'https://unapproved.example/return'},keyHeaders)).status,400);checks.push('Unapproved return origin rejected400.');
assert.equal((await request(`${store}/api/orders`,'POST',{}, {Origin:'https://unapproved.example'})).status,403);checks.push('Foreign browser mutation origin rejected403.');
const oversized=await fetch(`${store}/api/orders`,{method:'POST',headers:{Origin:store},body:'x'.repeat(32_769),signal:AbortSignal.timeout(15_000)});assert.equal(oversized.status,413);checks.push('Oversized ignored catalog payload still rejected413 before creating an order.');
const retry=await request(`${store}/api/orders/${id}/checkout`,'POST',{}, {Origin:store,Authorization:`Bearer ${cancelToken}`});assert.equal(retry.status,200);assert.equal(retry.body.reference,reference);checks.push('Owner retry reopens the same checkout without creating another order.');
const forgedHook=await request(`${store}/api/webhooks/settlekit`,'POST',{}, {'x-settlekit-timestamp':String(Math.floor(Date.now()/1000)),'x-settlekit-signature':'v1='+'0'.repeat(64)});assert.equal(forgedHook.status,401);checks.push('Forged raw-body webhook rejected401 before eligibility lookup.');
const record={checkedAt:new Date().toISOString(),kind:'actual-local-HTTP-and-Neon',storeOrigin:store,gatewayOrigin:gateway,orderId:id,checkoutReference:reference,checks,paymentExecuted:false,fulfillmentCount:0,fundingGate:'No deployed router or live Whitechain payment. Store order remains pending.'};
await writeFile(new URL('../evidence/local-http.json',import.meta.url),JSON.stringify(record,null,2)+'\n');
// The capability is intentionally private and is never written into evidence or output.
process.stdout.write(`Actual store/gateway HTTP checks passed: ${checks.length}. Saved pending order and sanitized evidence.\n`);
