import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearerMatches, isPublicAddress, parseEligibility, parsePaymentEvent, receiptDisposition, safeJsonRequest, TOKEN, verifyWebhook, type CurrentEligibility, type PaymentEvent } from '../src/index.ts';

const secret='test-only-webhook-secret-'.repeat(3);
const now=Date.now();
const event:PaymentEvent={event_id:'event_12345678',event_type:'payment.accepted',payment_id:'payment_12345678',checkout_reference:'checkout_12345678',merchant_order_id:'12345678-1234-4123-8123-123456789abc',state_version:2,amount_base_units:'25000000',token:TOKEN,chain_id:1874,payer:'0x1111111111111111111111111111111111111111',merchant:'0x2222222222222222222222222222222222222222',confirmation_stage:'included_2_blocks',eligible:true,refund_amount_base_units:'0',created_at:new Date(now).toISOString()};
const current=(patch:Partial<CurrentEligibility>={}):CurrentEligibility=>({...event,status:'accepted',refund_hold:false,grant_expires_at:new Date(now+10_000).toISOString(),...patch});
const raw=Buffer.from(JSON.stringify(event));const timestamp=String(Math.floor(now/1000));
const sign=(body=raw,time=timestamp)=>`v1=${createHmac('sha256',secret).update(time+'.').update(body).digest('hex')}`;

describe('real raw-byte webhook receiver protocol',()=>{
  it('validates bounded exact bytes and a fresh HMAC; altered body/time/header cannot pass',()=>{
    expect(()=>verifyWebhook(raw,timestamp,sign(),secret,now)).not.toThrow();
    expect(()=>verifyWebhook(Buffer.concat([raw,Buffer.from(' ')]),timestamp,sign(),secret,now)).toThrow('WEBHOOK_UNAUTHORIZED');
    expect(()=>verifyWebhook(raw,String(Number(timestamp)-301),sign(raw,String(Number(timestamp)-301)),secret,now)).toThrow('WEBHOOK_UNAUTHORIZED');
    expect(()=>verifyWebhook(raw,timestamp,'v2='+sign().slice(3),secret,now)).toThrow('WEBHOOK_UNAUTHORIZED');
    expect(()=>verifyWebhook(Buffer.alloc(32_769),timestamp,sign(),secret,now)).toThrow('BODY_TOO_LARGE');
  });
  it('validates token/chain/exact integer/state association at the receiver boundary',()=>{
    expect(parsePaymentEvent(raw)).toMatchObject({amount_base_units:'25000000',chain_id:1874});
    for(const patch of [{chain_id:1},{token:'0x3333333333333333333333333333333333333333'},{amount_base_units:'25.00'},{amount_base_units:(2n**256n).toString()},{eligible:'yes'},{state_version:1.5}])expect(()=>parsePaymentEvent(Buffer.from(JSON.stringify({...event,...patch})))).toThrow('EVENT_INVALID');
    expect(parseEligibility(current())).toMatchObject({status:'accepted'});
    expect(()=>parseEligibility(current({status:'invalid' as 'accepted'}))).toThrow('ELIGIBILITY_INVALID');
  });
  it('grants fulfillment only for current accepted canonical, unrefunded eligible state',()=>{
    expect(receiptDisposition(event,current(),now)).toBe('fulfill');
    for(const patch of [{status:'orphaned' as const},{status:'review' as const},{eligible:false},{refund_hold:true},{refund_amount_base_units:'1'}])expect(receiptDisposition(event,current(patch),now)).toBe('review');
    expect(receiptDisposition(event,current({state_version:3}),now)).toBe('superseded');
    expect(()=>receiptDisposition(event,current({amount_base_units:'1'}),now)).toThrow('ASSOCIATION_MISMATCH');
    expect(()=>receiptDisposition(event,current({grant_expires_at:new Date(now-1).toISOString()}),now)).toThrow('ELIGIBILITY_GRANT_EXPIRED');
    expect(()=>receiptDisposition(event,current({grant_expires_at:new Date(now+60_000).toISOString()}),now)).toThrow('ELIGIBILITY_GRANT_EXPIRED');
  });
  it('rejects forged/length-mismatched scoped bearer credentials',()=>{
    expect(bearerMatches(`Bearer ${secret}`,secret)).toBe(true);
    expect(bearerMatches('Bearer x',secret)).toBe(false);
    expect(bearerMatches(undefined,secret)).toBe(false);
  });
});

describe('approved endpoint transport',()=>{
  let server:Server;let origin:string;
  beforeAll(async()=>{server=createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:'/ok'});res.end();}else if(req.url==='/large'){res.end(JSON.stringify('x'.repeat(40_000)));}else if(req.url==='/slow'){res.writeHead(200,{'Content-Type':'application/json'});res.write('[');const timer=setInterval(()=>res.write(' '),20);res.on('close',()=>clearInterval(timer));}else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));}});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No port');origin=`http://127.0.0.1:${address.port}`;});
  afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  it('rejects private/metadata/reserved/mapped addresses and permits normal public addresses',()=>{
    for(const value of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fd00::1','fe80::1','2001:db8::1'])expect(isPublicAddress(value),value).toBe(false);
    for(const value of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])expect(isPublicAddress(value),value).toBe(true);
  });
  it('requires exact approved origin and explicit local override; never follows redirects',async()=>{
    await expect(safeJsonRequest(new URL('/ok',origin),{approvedOrigin:origin})).rejects.toThrow('ENDPOINT_NOT_ALLOWED');
    await expect(safeJsonRequest(new URL('/ok',origin),{approvedOrigin:'https://other.example',allowLocal:true})).rejects.toThrow('ENDPOINT_NOT_ALLOWED');
    await expect(safeJsonRequest(new URL('/ok',origin),{approvedOrigin:origin,allowLocal:true})).resolves.toEqual({ok:true});
    await expect(safeJsonRequest(new URL('/redirect',origin),{approvedOrigin:origin,allowLocal:true})).rejects.toThrow('DEPENDENCY_REJECTED');
    await expect(safeJsonRequest(new URL('/large',origin),{approvedOrigin:origin,allowLocal:true})).rejects.toThrow('DEPENDENCY_TOO_LARGE');
  });
  it('enforces an absolute deadline even while a peer keeps streaming below the size bound',async()=>{
    const started=Date.now();
    await expect(safeJsonRequest(new URL('/slow',origin),{approvedOrigin:origin,allowLocal:true,timeoutMs:150})).rejects.toThrow('DEPENDENCY_TIMEOUT');
    expect(Date.now()-started).toBeLessThan(1500);
  });
});
