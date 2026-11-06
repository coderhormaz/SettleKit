import 'server-only';
import { NextRequest,NextResponse } from 'next/server';
import { AppError } from '@settlekit/core';
import { publicError,requireMutationOrigin } from '@settlekit/core/server';
import { authenticate,database } from '@settlekit/db';
import { emptyInput,operationFilter } from '../../../../../../packages/core/src/operations.ts';
import { addReviewNote,archiveContact,auditList,contactDetail,contactsList,createInvoice,createOperationKey,deactivateLink,deliveriesList,invoiceDetail,invoicesList,keysList,linksList,operationPaymentDetail,operationPayments,operationSettings,overview,refreshReviews,replayDelivery,reportCsv,resolveReview,reviewsList,revokeOperationKey,revokeOperationSessions,rotateOperationKey,rotateWebhookSecret,saveContact,saveLink,saveOperationSettings,saveWebhookConfiguration,testWebhook,voidInvoice,webhookConfiguration } from '../../../../../../packages/db/src/operations.ts';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const response=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'private, no-store'}});
async function input(req:NextRequest):Promise<unknown>{
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('INVALID_CONTENT_TYPE',415,'Send a JSON request.');
  const reader=req.body?.getReader();if(!reader)throw new AppError('INVALID_INPUT',400,'A JSON request body is required.');
  const parts:Uint8Array[]=[];let size=0;
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>12_000){await reader.cancel();throw new AppError('REQUEST_TOO_LARGE',413,'This request is too large.');}parts.push(chunk.value);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;}catch{throw new AppError('INVALID_INPUT',400,'The request body is invalid.');}
}
async function handle(req:NextRequest){
  try{
    if(req.method!=='GET')requireMutationOrigin(req.headers.get('origin'));
    const db=database();const token=req.cookies.get('sk_session')?.value;const merchant=await authenticate(db,token);const merchantId=merchant.id;
    const parts=req.nextUrl.pathname.slice('/api/operations'.length).split('/').filter(Boolean);const [section,id,action]=parts;
    if(parts.length>4||(parts.length===4&&!(section==='settings'&&id==='sessions'&&parts[3]==='revoke')))throw new AppError('NOT_FOUND',404,'This action was not found.');
    if(req.method==='GET'){
      const f=operationFilter(req.nextUrl.searchParams);
      if(section==='overview'&&!id)return response(await overview(db,merchantId,f));
      if(section==='payments'&&!id)return response(await operationPayments(db,merchantId,f));
      if(section==='payments'&&id&&!action)return response(await operationPaymentDetail(db,merchantId,id));
      if(section==='contacts'&&!id)return response(await contactsList(db,merchantId,f));
      if(section==='contacts'&&id&&!action)return response(await contactDetail(db,merchantId,id));
      if(section==='links'&&!id)return response(await linksList(db,merchantId,f));
      if(section==='invoices'&&!id)return response(await invoicesList(db,merchantId,f));
      if(section==='invoices'&&id&&!action)return response(await invoiceDetail(db,merchantId,id));
      if(section==='keys'&&!id)return response(await keysList(db,merchantId,f));
      if(section==='webhooks'&&!id)return response(await webhookConfiguration(db,merchantId,f));
      if(section==='deliveries'&&!id)return response(await deliveriesList(db,merchantId,f));
      if(section==='reviews'&&!id)return response(await reviewsList(db,merchantId,f));
      if(section==='audit'&&!id)return response(await auditList(db,merchantId,f));
      if(section==='settings'&&!id)return response(await operationSettings(db,merchantId,token!));
      if(section==='reports.csv'&&!id)return new NextResponse(await reportCsv(db,merchantId,f),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="settlekit-${f.from}-${f.to}.csv"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(req.method==='POST'||req.method==='PATCH'){
      const value=await input(req);const method=req.method;
      if(method==='POST'&&section==='contacts'&&!id)return response(await saveContact(db,merchantId,value));
      if(method==='PATCH'&&section==='contacts'&&id&&!action)return response(await saveContact(db,merchantId,value,id));
      if(method==='POST'&&section==='contacts'&&id&&action==='archive')return response(await archiveContact(db,merchantId,id,value));
      if(method==='POST'&&section==='links'&&!id)return response(await saveLink(db,merchantId,value));
      if(method==='PATCH'&&section==='links'&&id&&!action)return response(await saveLink(db,merchantId,value,id));
      if(method==='POST'&&section==='links'&&id&&action==='deactivate')return response(await deactivateLink(db,merchantId,id,value));
      if(method==='POST'&&section==='invoices'&&!id)return response(await createInvoice(db,merchantId,value));
      if(method==='POST'&&section==='invoices'&&id&&action==='void')return response(await voidInvoice(db,merchantId,id,value));
      if(method==='POST'&&section==='keys'&&!id)return response(await createOperationKey(db,merchantId,value));
      if(method==='POST'&&section==='keys'&&id&&action==='revoke'){emptyInput.parse(value);return response(await revokeOperationKey(db,merchantId,id));}
      if(method==='POST'&&section==='keys'&&id&&action==='rotate'){emptyInput.parse(value);return response(await rotateOperationKey(db,merchantId,id));}
      if(method==='PATCH'&&section==='webhooks'&&!id)return response(await saveWebhookConfiguration(db,merchantId,value));
      if(method==='POST'&&section==='webhooks'&&id==='rotate-secret'&&!action){emptyInput.parse(value);return response(await rotateWebhookSecret(db,merchantId));}
      if(method==='POST'&&section==='webhooks'&&id==='test'&&!action){emptyInput.parse(value);return response(await testWebhook(db,merchantId));}
      if(method==='POST'&&section==='deliveries'&&id&&action==='replay'){emptyInput.parse(value);return response(await replayDelivery(db,merchantId,id));}
      if(method==='POST'&&section==='reviews'&&id==='refresh'&&!action){emptyInput.parse(value);return response(await refreshReviews(db,merchantId));}
      if(method==='POST'&&section==='reviews'&&id&&action==='notes')return response(await addReviewNote(db,merchantId,id,value));
      if(method==='POST'&&section==='reviews'&&id&&action==='resolve'){emptyInput.parse(value);return response(await resolveReview(db,merchantId,id));}
      if(method==='PATCH'&&section==='settings'&&!id)return response(await saveOperationSettings(db,merchantId,value));
      if(method==='POST'&&section==='settings'&&id==='sessions'&&action==='revoke-others'){emptyInput.parse(value);return response(await revokeOperationSessions(db,merchantId,token!));}
      if(method==='POST'&&section==='settings'&&id==='sessions'&&action&&parts[3]==='revoke'){emptyInput.parse(value);return response(await revokeOperationSessions(db,merchantId,token!,action));}
    }
    throw new AppError('NOT_FOUND',404,'This action was not found.');
  }catch(error){const result=publicError(error);return NextResponse.json(result.body,{status:result.status,headers:{'Cache-Control':'private, no-store'}});}
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
