import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, addressSchema } from '@settlekit/core';
import { publicError, randomToken, requireMutationOrigin, runtimeConfig } from '@settlekit/core/server';
import { authenticate, authenticateApiKey, authorizeCheckout, checkoutRow, createCheckout, database, listPayments, logout, merchantProfile, paymentState, publicCheckout, refreshMerchantScreening, relaySponsoredCheckout, requestChallenge, requestPayerChallenge, SESSION_SECONDS, updateMerchant, verifyChallenge } from '@settlekit/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const inputChallenge = z.object({ address: addressSchema }).strict();
const inputSignature = z.object({ id: z.string().uuid(), signature: z.string().regex(/^0x[0-9a-f]+$/i).max(8192) }).strict();

async function body(req: NextRequest) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new AppError('INVALID_CONTENT_TYPE',415,'Send a JSON request.');
  const reader=req.body?.getReader();
  if(!reader)throw new AppError('INVALID_INPUT',400,'A request body is required.');
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>12_000){await reader.cancel();throw new AppError('REQUEST_TOO_LARGE',413,'This request is too large.');}chunks.push(part.value);}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new AppError('INVALID_INPUT',400,'The request body is invalid.'); }
}
const response=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'private, no-store'}});
function cookie(res:NextResponse,name:string,value:string,maxAge:number) { res.cookies.set(name,value,{httpOnly:true,sameSite:'lax',secure:runtimeConfig().secureCookies,path:'/',maxAge}); }

async function handle(req:NextRequest) {
  try {
    const path=req.nextUrl.pathname;
    const db=database();
    // Server adapters use scoped keys rather than browser cookies/Origin.
    if(path.startsWith('/api/v1/')) {
      const merchantId=await authenticateApiKey(db,req.headers.get('authorization'),req.method==='POST'?'checkout:create':'payment:read');
      if(path==='/api/v1/checkouts'&&req.method==='POST')return response(await createCheckout(db,merchantId,req.headers.get('idempotency-key'),await body(req)));
      const eligibility=path.match(/^\/api\/v1\/payments\/([0-9a-f-]{36})\/eligibility$/);
      if(eligibility&&req.method==='GET')return response(await paymentState(db,merchantId,z.string().uuid().parse(eligibility[1])));
      throw new AppError('NOT_FOUND',404,'This server action was not found.');
    }
    if(req.method!=='GET')requireMutationOrigin(req.headers.get('origin'));
    const checkout=path.match(/^\/api\/checkout\/([a-f0-9]{64})(?:\/(challenge|authorize|submitted|relay))?$/);
    if(checkout){
      const [,reference,action]=checkout;
      if(!action&&req.method==='GET')return response(await publicCheckout(db,reference));
      if(action==='challenge'&&req.method==='POST'){
        const input=inputChallenge.parse(await body(req));const browserToken=randomToken();
        const result=await requestPayerChallenge(db,reference,input.address,browserToken);const res=response(result);cookie(res,'sk_payer',browserToken,300);return res;
      }
      if(action==='authorize'&&req.method==='POST'){
        const input=inputSignature.parse(await body(req));const result=await authorizeCheckout(db,reference,{...input,signature:input.signature as `0x${string}`,browserToken:req.cookies.get('sk_payer')?.value??''});
        const res=response(result);cookie(res,'sk_payer','',0);return res;
      }
      if(action==='submitted'&&req.method==='POST'){
        const input=z.object({tx_hash:z.string().regex(/^0x[0-9a-f]{64}$/i)}).strict().parse(await body(req));const row=await checkoutRow(db,reference);
        // An untrusted UI hint, never payment evidence or an observer cursor.
        await db.pool.query("update checkout_sessions set submitted_tx_hash=$2 where id=$1 and status='open' and submitted_tx_hash is null",[row.id,input.tx_hash]);return response({submitted:true});
      }
      if(action==='relay'&&req.method==='POST'){
        return response(await relaySponsoredCheckout(db,reference,await body(req)));
      }
      throw new AppError('NOT_FOUND',404,'This checkout action was not found.');
    }
    const token=req.cookies.get('sk_session')?.value;
    if(path==='/api/auth/challenge' && req.method==='POST') {
      const input=inputChallenge.parse(await body(req));
      const browserToken=randomToken();
      const challenge=await requestChallenge(db,{...input,browserToken,purpose:'login'});
      const res=response(challenge);cookie(res,'sk_browser',browserToken,300);return res;
    }
    if(path==='/api/auth/verify' && req.method==='POST') {
      const input=inputSignature.parse(await body(req));
      const verified=await verifyChallenge(db,{...input,signature:input.signature as `0x${string}`,browserToken:req.cookies.get('sk_browser')?.value??'',purpose:'login'});
      const res=response({merchant:await merchantProfile(db,verified.merchantId)});
      cookie(res,'sk_session',verified.sessionToken!,SESSION_SECONDS);cookie(res,'sk_browser','',0);return res;
    }
    if(path==='/api/auth/logout' && req.method==='POST') {await logout(db,token);const res=response({signedOut:true});cookie(res,'sk_session','',0);cookie(res,'sk_browser','',0);return res;}
    const merchant=await authenticate(db,token);
    if(path==='/api/merchant/payments'&&req.method==='GET')return response(await listPayments(db,merchant.id));
    const paymentDetail=path.match(/^\/api\/merchant\/payments\/([0-9a-f-]{36})$/);
    if(paymentDetail&&req.method==='GET')return response(await listPayments(db,merchant.id,z.string().uuid().parse(paymentDetail[1])));
    if((path==='/api/auth/me'||path==='/api/merchant')&&req.method==='GET')return response({merchant:await merchantProfile(db,merchant.id)});
    if(path==='/api/merchant'&&req.method==='PATCH')return response({merchant:await updateMerchant(db,merchant.id,await body(req))});
    if(path==='/api/merchant/screening'&&req.method==='POST')return response({screening:await refreshMerchantScreening(db,merchant.id)});
    if(path==='/api/merchant/settlement/challenge'&&req.method==='POST') {
      const input=inputChallenge.parse(await body(req));const browserToken=randomToken();
      const challenge=await requestChallenge(db,{...input,browserToken,purpose:'settlement',merchantId:merchant.id});
      const res=response(challenge);cookie(res,'sk_proof',browserToken,300);return res;
    }
    if(path==='/api/merchant/settlement/verify'&&req.method==='POST') {
      const input=inputSignature.parse(await body(req));
      await verifyChallenge(db,{...input,signature:input.signature as `0x${string}`,browserToken:req.cookies.get('sk_proof')?.value??'',purpose:'settlement',merchantId:merchant.id});
      await refreshMerchantScreening(db,merchant.id);
      const res=response({merchant:await merchantProfile(db,merchant.id)});cookie(res,'sk_proof','',0);return res;
    }
    throw new AppError('NOT_FOUND',404,'This action was not found.');
  }catch(error){const result=publicError(error);return NextResponse.json(result.body,{status:result.status,headers:{'Cache-Control':'private, no-store'}});}
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
