import 'server-only';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {AppError} from '@settlekit/core';
import {publicError,requireMutationOrigin} from '@settlekit/core/server';
import {authenticate,database,authorizeRefund,cancelRefund,createRefundIntent,listRefunds,refundDetail,releaseRefundHold,submitRefundHint} from '@settlekit/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function body(req:NextRequest):Promise<unknown>{
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('INVALID_CONTENT_TYPE',415,'Send a JSON request.');
  const chunks:Uint8Array[]=[];let total=0;const reader=req.body?.getReader();if(!reader)throw new AppError('INVALID_INPUT',400,'A request body is required.');
  for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>12000){await reader.cancel();throw new AppError('REQUEST_TOO_LARGE',413,'This request is too large.');}chunks.push(part.value);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('INVALID_INPUT',400,'Send valid JSON.');}
}
const ok=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'private, no-store'}});
async function handle(req:NextRequest){try{
  if(req.method!=='GET')requireMutationOrigin(req.headers.get('origin'));
  const db=database();const merchant=await authenticate(db,req.cookies.get('sk_session')?.value);const path=req.nextUrl.pathname.replace(/^\/api\/refunds\/?/,'');
  if(!path&&req.method==='GET'){const paymentId=req.nextUrl.searchParams.get('paymentId')??undefined;if(paymentId)z.string().uuid().parse(paymentId);return ok(await listRefunds(db,merchant.id,paymentId));}
  if(!path&&req.method==='POST')return ok(await createRefundIntent(db,merchant.id,await body(req)));
  const parts=path.split('/');const id=z.string().uuid().parse(parts[0]);
  if(parts.length===1&&req.method==='GET')return ok(await refundDetail(db,merchant.id,id));
  if(parts.length===2&&req.method==='POST'){
    if(parts[1]==='submitted'){const input=z.object({txHash:z.string().regex(/^0x[0-9a-f]{64}$/i)}).strict().parse(await body(req));return ok(await submitRefundHint(db,merchant.id,id,input.txHash));}
    z.object({}).strict().parse(await body(req));
    if(parts[1]==='authorize')return ok(await authorizeRefund(db,merchant.id,id));
    if(parts[1]==='cancel')return ok(await cancelRefund(db,merchant.id,id));
    if(parts[1]==='revalidate')return ok(await releaseRefundHold(db,merchant.id,id));
  }
  throw new AppError('NOT_FOUND',404,'This refund action was not found.');
}catch(error){const result=publicError(error);return NextResponse.json(result.body,{status:result.status,headers:{'Cache-Control':'private, no-store'}});}}
export const GET=handle;export const POST=handle;
