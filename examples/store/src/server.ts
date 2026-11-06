import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { IntegrationError, bearerMatches, isEndpointTest, parseEligibility, parsePaymentEvent, safeJsonRequest, verifyWebhook } from '../../../packages/integration/src/index.ts';
import { adapterOrder, applyReceipt, cancelOrder, CATALOG_PRICE, createOrder, createStoreDatabase, orderById, publicOrder, saveCheckout } from './store.ts';
import { html, script, styles } from './ui.ts';

const origin=new URL(process.env.STORE_ORIGIN??'http://127.0.0.1:3200').origin;
const gatewayOrigin=new URL(process.env.APP_ORIGIN??'http://127.0.0.1:3000').origin;
const allowLocal=process.env.ALLOW_LOCAL_HTTP==='true';
const developmentFailures=process.env.ALLOW_DEVELOPMENT_FAILURES==='true'&&allowLocal&&new URL(origin).protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)&&(process.env.STORE_DEVELOPMENT_FAILURE_TOKEN?.length??0)>=32;
const apiKey=process.env.STORE_GATEWAY_API_KEY??'';
const webhookSecret=process.env.STORE_WEBHOOK_SECRET??'';
const orderReadKey=process.env.STORE_ORDER_READ_KEY??'';
if(!process.env.STORE_DATABASE_URL || [apiKey,webhookSecret,orderReadKey].some(secret=>secret.length<32))throw new Error('Store database and private integration credentials are required.');
const pool=createStoreDatabase(process.env.STORE_DATABASE_URL);
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const route=new RegExp(`^/api/orders/(${uuid})(?:/(status|checkout|cancel|download))?$`);
async function readBody(req:IncomingMessage):Promise<Buffer>{
  const parts:Buffer[]=[];let size=0;
  for await (const part of req){size+=part.length;if(size>32_768)throw new IntegrationError('BODY_TOO_LARGE',413);parts.push(Buffer.from(part));}
  return Buffer.concat(parts);
}
function send(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
function protectedHeaders(res:ServerResponse){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function token(req:IncomingMessage){const value=req.headers.authorization;return value?.startsWith('Bearer ')?value.slice(7):'';}
function owner(order:{cancel_token_hash:string},req:IncomingMessage){if(createHash('sha256').update(token(req)).digest('hex')!==order.cancel_token_hash)throw new IntegrationError('ORDER_NOT_FOUND',404);}
async function checkout(id:string){
  const order=await orderById(pool,id);if(order.state!=='pending')throw new IntegrationError('ORDER_NOT_PAYABLE',409);
  if(order.checkout_reference&&order.checkout_url)return {reference:order.checkout_reference,checkout_url:order.checkout_url};
  const response=await safeJsonRequest(new URL('/api/v1/checkouts',gatewayOrigin),{approvedOrigin:gatewayOrigin,allowLocal,method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Idempotency-Key':id},body:{order_id:id,amount_base_units:CATALOG_PRICE,return_url:`${origin}/?order=${id}`}});
  if(!response||typeof response!=='object'||!('reference' in response)||!('checkout_url' in response)||typeof response.reference!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(response.reference)||typeof response.checkout_url!=='string')throw new IntegrationError('CHECKOUT_RESPONSE_INVALID',503);
  const target=new URL(response.checkout_url);
  if(target.origin!==gatewayOrigin || target.username || target.password || target.hash || target.pathname!==`/checkout/${response.reference}`)throw new IntegrationError('CHECKOUT_RESPONSE_INVALID',503);
  await saveCheckout(pool,id,response.reference,target.href);return {reference:response.reference,checkout_url:target.href};
}
const budgets=new Map<string,{count:number;until:number}>();
function budget(req:IncomingMessage){
  const key=req.socket.remoteAddress??'unknown';const now=Date.now();
  if(budgets.size>500)for(const [entry,value]of budgets)if(value.until<=now)budgets.delete(entry);
  if(budgets.size>=1000&&!budgets.has(key))throw new IntegrationError('RATE_LIMITED',429);
  const previous=budgets.get(key);const current=previous&&previous.until>now?{count:previous.count+1,until:previous.until}:{count:1,until:now+60_000};
  budgets.set(key,current);if(current.count>30)throw new IntegrationError('RATE_LIMITED',429);
}
const server=createServer(async(req,res)=>{
  protectedHeaders(res);
  try{
    const url=new URL(req.url??'/',origin);
    if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
    if(req.method==='GET'&&url.pathname==='/store.css'){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});res.end(styles);return;}
    if(req.method==='GET'&&url.pathname==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(script);return;}
    if(req.method==='GET'&&url.pathname==='/fonts/manrope.ttf'){res.writeHead(200,{'Content-Type':'font/ttf'});res.end(await readFile(new URL('../../../apps/gateway/public/fonts/manrope-variable.ttf',import.meta.url)));return;}
    if(req.method==='POST'&&url.pathname==='/api/dev/fail-next'){
      if(!developmentFailures)throw new IntegrationError('NOT_FOUND',404);
      if(!bearerMatches(req.headers.authorization,process.env.STORE_DEVELOPMENT_FAILURE_TOKEN??''))throw new IntegrationError('UNAUTHORIZED',401);
      let input:unknown;try{input=JSON.parse((await readBody(req)).toString());}catch{throw new IntegrationError('INVALID_FAILURE_CONFIG');}
      if(!input||typeof input!=='object'||!('remaining'in input)||Object.keys(input).length!==1||!Number.isInteger(input.remaining)||Number(input.remaining)<0||Number(input.remaining)>3)throw new IntegrationError('INVALID_FAILURE_CONFIG');
      await pool.query("insert into store_runtime_controls(key,remaining) values('payment-webhook',$1) on conflict(key) do update set remaining=excluded.remaining,updated_at=now()",[input.remaining]);
      send(res,200,{armed:true,remaining:input.remaining,developmentFixture:true});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/webhooks/settlekit'){
      if(!req.headers['content-type']?.startsWith('application/json'))throw new IntegrationError('CONTENT_TYPE_INVALID',415);
      const raw=await readBody(req);const timestamp=req.headers['x-settlekit-timestamp'];const signature=req.headers['x-settlekit-signature'];
      verifyWebhook(raw,typeof timestamp==='string'?timestamp:undefined,typeof signature==='string'?signature:undefined,webhookSecret);
      if(isEndpointTest(raw)){send(res,200,{acknowledged:true,test:true,fulfillment:false});return;}
      const event=parsePaymentEvent(raw);
      if(developmentFailures){
        const failed=await pool.query("update store_runtime_controls set remaining=remaining-1,updated_at=now() where key='payment-webhook' and remaining>0 returning remaining");
        if(failed.rowCount){send(res,503,{error:{code:'DEVELOPMENT_DELIVERY_FAILURE',message:'Explicit local failure fixture; no order was fulfilled.'}});return;}
      }
      const current=parseEligibility(await safeJsonRequest(new URL(`/api/v1/payments/${event.payment_id}/eligibility`,gatewayOrigin),{approvedOrigin:gatewayOrigin,allowLocal,headers:{Authorization:`Bearer ${apiKey}`}}));
      send(res,200,await applyReceipt(pool,event,current));return;
    }
    if(req.method==='POST'&&req.headers.origin!==origin)throw new IntegrationError('ORIGIN_DENIED',403);
    if(req.method==='POST')await readBody(req);
    if(req.method==='POST'&&url.pathname==='/api/orders'){
      budget(req);const order=await createOrder(pool);
      try{send(res,201,{...order,...await checkout(order.id)});}catch{send(res,503,{...order,error:{code:'CHECKOUT_UNAVAILABLE',message:'Your order is saved. Retry opening checkout.'}});}return;
    }
    const match=route.exec(url.pathname);if(!match)throw new IntegrationError('NOT_FOUND',404);
    const [,id,action]=match;const order=await orderById(pool,id);
    if(req.method==='GET'&&action==='status'){send(res,200,publicOrder(order));return;}
    if(req.method==='GET'&&!action){if(!bearerMatches(req.headers.authorization,orderReadKey))throw new IntegrationError('UNAUTHORIZED',401);send(res,200,adapterOrder(order));return;}
    if(req.method==='POST'&&action==='checkout'){owner(order,req);send(res,200,await checkout(id));return;}
    if(req.method==='POST'&&action==='cancel'){owner(order,req);await cancelOrder(pool,id,token(req));send(res,200,{cancelled:true});return;}
    if(req.method==='GET'&&action==='download'){
      owner(order,req);if(order.state!=='fulfilled'||order.fulfillment_count!==1)throw new IntegrationError('ORDER_NOT_FULFILLED',409);
      res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="fieldwork-product-brief.md"'});res.end(await readFile(new URL('../content/product-brief.md',import.meta.url),'utf8'));return;
    }
    throw new IntegrationError('NOT_FOUND',404);
  }catch(error){const known=error instanceof IntegrationError;send(res,known?error.status:503,{error:{code:known?error.code:'STORE_UNAVAILABLE',message:known&&error.status<500?'This action could not finish. Check the order and try again.':'The store is temporarily unavailable. Your saved order is safe; retry shortly.'}});}
});
const port=Number(process.env.STORE_PORT??new URL(origin).port??3200);
server.requestTimeout=10_000;server.headersTimeout=10_000;
server.listen(port,'127.0.0.1',()=>process.stdout.write(`Independent demo store listening on ${origin}.\n`));
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{server.close(()=>{void pool.end();});});
