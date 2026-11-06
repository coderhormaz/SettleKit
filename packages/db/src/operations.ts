import { randomUUID,createHmac,timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError,USDT_ADDRESS,formatUsdt } from '@settlekit/core';
import { contactInput,contactUpdateInput,linkInput,linkUpdateInput,invoiceInput,keyInput,webhookInput,noteInput,settingsInput,versionInput,csvCell,csvLine,csvNumberCell,type ApiScope,type OperationFilter } from '../../core/src/operations.ts';
import { decryptSecret,encryptSecret,hashToken,randomToken,runtimeConfig } from '@settlekit/core/server';
import { safeJsonRequest } from '@settlekit/integration';
import { evaluateWallet,OFAC_SOURCE_ID } from '@settlekit/screening';
import { routerAbi } from '@settlekit/core/router';
import { createCheckout,type CheckoutRow } from './payments.ts';
import { merchantIntegration,readStoreOrder,type StoreOrder } from './integration.ts';
import { currentScreening,refreshMerchantScreening } from './screening.ts';
import { merchantProfile } from './merchant.ts';
import { chainClient,checkPaymentPolicy,routerConfiguration } from './policy.ts';
import { holdPayment,insertDelivery,paymentState,verifiedReceipt } from './observer.ts';
import { enqueue } from './jobs.ts';
import { transaction,type Database } from './client.ts';

type Row=Record<string,unknown>;
const uuid=(value:string)=>z.uuid().parse(value);
const notFound=()=>new AppError('RESOURCE_NOT_FOUND',404,'This item was not found in your workspace.');
const conflict=()=>new AppError('VERSION_CONFLICT',409,'This item changed. Refresh it before saving again.');
const literalSearch=(value:string)=>`%${value.replace(/[\\%_]/g,'\\$&')}%`;
const orderBy=(filter:OperationFilter,created:string,amount?:string)=>filter.sort==='oldest'?`${created} asc`:filter.sort==='amount-asc'&&amount?`${amount} asc,${created} desc`:filter.sort==='amount-desc'&&amount?`${amount} desc,${created} desc`:`${created} desc`;
async function audit(sql:PoolClient,merchantId:string,kind:string,metadata:Record<string,unknown>){await sql.query('insert into audit_events(merchant_id,kind,metadata) values($1,$2,$3)',[merchantId,kind,JSON.stringify(metadata)]);}
function pageResult<T>(items:T[],total:number,f:OperationFilter){return {items,total,page:f.page,pageSize:f.pageSize};}
async function budget(sql:PoolClient,merchantId:string,kind:string,limit=30,seconds=60){
  const result=await sql.query<{count:number}>(`insert into request_budgets(key,count,reset_at) values($1,1,clock_timestamp()+($2*interval '1 second')) on conflict(key) do update set count=case when request_budgets.reset_at<=clock_timestamp() then 1 else request_budgets.count+1 end,reset_at=case when request_budgets.reset_at<=clock_timestamp() then clock_timestamp()+($2*interval '1 second') else request_budgets.reset_at end returning count`,[`operations:${kind}:${merchantId}`,seconds]);
  if(result.rows[0].count>limit)throw new AppError('RATE_LIMITED',429,'Please wait before repeating this action.');
}
async function mutation<T>(db:Database,merchantId:string,kind:string,work:(sql:PoolClient)=>Promise<T>){return transaction(db,async sql=>{await sql.query('select id from merchants where id=$1 for update',[merchantId]);await budget(sql,merchantId,kind);return work(sql);});}
const contactColumns='id,name,email,notes,archived,version,created_at as "createdAt",updated_at as "updatedAt"';
const linkColumns='id,reference,title,amount::text as "amountBaseUnits",expires_at as "expiresAt",active,version,created_at as "createdAt"';
const keyColumns='id,name,prefix,scopes,revoked_at as "revokedAt",created_at as "createdAt",last_used_at as "lastUsedAt"';
function publicLink<T extends Row>(row:T){return {...row,url:`${runtimeConfig().origin}/pay/${String(row.reference)}`};}
function publicInvoice<T extends Row>(row:T){return {...row,url:`${runtimeConfig().origin}/invoice/${String(row.reference)}`};}

export async function contactsList(db:Database,merchantId:string,f:OperationFilter){
  const archived=f.status==='archived';const all=f.status==='all';
  const parameters=[merchantId,literalSearch(f.search),archived,all];
  const where='merchant_id=$1 and (name ilike $2 or email ilike $2) and ($4::boolean or archived=$3)';
  const [rows,count]=await Promise.all([db.pool.query<Row>(`select ${contactColumns} from merchant_contacts where ${where} order by ${orderBy(f,'created_at')} limit $5 offset $6`,[...parameters,f.pageSize,f.offset]),db.pool.query<{total:number}>(`select count(*)::integer as total from merchant_contacts where ${where}`,parameters)]);
  return pageResult(rows.rows,count.rows[0].total,f);
}
export async function contactDetail(db:Database,merchantId:string,id:string){
  const row=(await db.pool.query<Row>(`select ${contactColumns} from merchant_contacts where id=$1 and merchant_id=$2`,[uuid(id),merchantId])).rows[0];if(!row)throw notFound();
  const invoices=(await db.pool.query<Row>('select id,title,amount::text as "amountBaseUnits",state,created_at as "createdAt" from merchant_invoices where contact_id=$1 and merchant_id=$2 order by created_at desc limit 100',[id,merchantId])).rows;return {item:row,invoices};
}
export async function saveContact(db:Database,merchantId:string,payload:unknown,id?:string){
  const data=id?contactUpdateInput.parse(payload):contactInput.parse(payload);
  return mutation(db,merchantId,'contact.save',async sql=>{
    const row=id?(await sql.query<Row>(`update merchant_contacts set name=$3,email=$4,notes=$5,version=version+1,updated_at=now() where id=$1 and merchant_id=$2 and version=$6 returning ${contactColumns}`,[uuid(id),merchantId,data.name,data.email,data.notes,(data as z.infer<typeof contactUpdateInput>).version])).rows[0]:(await sql.query<Row>(`insert into merchant_contacts(merchant_id,name,email,notes) values($1,$2,$3,$4) returning ${contactColumns}`,[merchantId,data.name,data.email,data.notes])).rows[0];
    if(!row){const exists=(await sql.query('select id from merchant_contacts where id=$1 and merchant_id=$2',[id,merchantId])).rowCount;if(!exists)throw notFound();throw conflict();}
    await audit(sql,merchantId,id?'contact.updated':'contact.created',{contactId:row.id});return {item:row};
  });
}
export async function archiveContact(db:Database,merchantId:string,id:string,payload:unknown){const data=versionInput.parse(payload);return mutation(db,merchantId,'contact.archive',async sql=>{const row=(await sql.query<Row>(`update merchant_contacts set archived=true,version=version+1,updated_at=now() where id=$1 and merchant_id=$2 and version=$3 returning ${contactColumns}`,[uuid(id),merchantId,data.version])).rows[0];if(!row)throw notFound();await audit(sql,merchantId,'contact.archived',{contactId:id});return {item:row};});}

export async function linksList(db:Database,merchantId:string,f:OperationFilter){
  const where=`l.merchant_id=$1 and l.title ilike $2 and ($3='' or $3='all' or ($3='active' and l.active and (l.expires_at is null or l.expires_at>now())) or ($3='inactive' and not l.active) or ($3='expired' and l.expires_at<=now()))`;
  const parameters=[merchantId,literalSearch(f.search),f.status];
  const [rows,count]=await Promise.all([db.pool.query<Row>(`select ${linkColumns.split(',').map(column=>column.startsWith('amount')?'l.'+column:column.startsWith('expires_at')?'l.'+column:column.startsWith('created_at')?'l.'+column:column==='id'?'l.id':column).join(',')},(select count(*)::integer from internal_collection_orders o join payments p on p.checkout_id=o.checkout_id and p.canonical=true where o.link_id=l.id) as "paymentCount" from payment_links l where ${where} order by ${orderBy(f,'l.created_at','l.amount')} limit $4 offset $5`,[...parameters,f.pageSize,f.offset]),db.pool.query<{total:number}>(`select count(*)::integer as total from payment_links l where ${where}`,parameters)]);
  return pageResult(rows.rows.map(publicLink),count.rows[0].total,f);
}
export async function saveLink(db:Database,merchantId:string,payload:unknown,id?:string){
  const data=id?linkUpdateInput.parse(payload):linkInput.parse(payload);
  if(data.expiresAt&&Date.parse(data.expiresAt)<=Date.now())throw new AppError('EXPIRY_INVALID',400,'Choose a future expiration time.');
  return mutation(db,merchantId,'link.save',async sql=>{
    const row=id?(await sql.query<Row>(`update payment_links set title=$3,expires_at=$4,version=version+1,updated_at=now() where id=$1 and merchant_id=$2 and version=$5 returning ${linkColumns}`,[uuid(id),merchantId,data.title,data.expiresAt,(data as z.infer<typeof linkUpdateInput>).version])).rows[0]:(await sql.query<Row>(`insert into payment_links(merchant_id,reference,title,amount,expires_at) values($1,$2,$3,$4,$5) returning ${linkColumns}`,[merchantId,randomToken(),data.title,(data as z.infer<typeof linkInput>).amountBaseUnits,data.expiresAt])).rows[0];if(!row)throw notFound();await audit(sql,merchantId,id?'link.updated':'link.created',{linkId:row.id});return {item:publicLink(row)};
  });
}
export async function deactivateLink(db:Database,merchantId:string,id:string,payload:unknown){const data=versionInput.parse(payload);return mutation(db,merchantId,'link.deactivate',async sql=>{const row=(await sql.query<Row>(`update payment_links set active=false,version=version+1,updated_at=now() where id=$1 and merchant_id=$2 and version=$3 returning ${linkColumns}`,[uuid(id),merchantId,data.version])).rows[0];if(!row)throw notFound();await audit(sql,merchantId,'link.deactivated',{linkId:id,outstandingAuthorizationWindowSeconds:60});return {item:publicLink(row)};});}

const invoiceSelect=`select i.id,i.reference,i.title,i.amount::text as "amountBaseUnits",i.contact_id as "contactId",i.contact_snapshot->>'name' as "contactName",i.due_date::text as "dueDate",i.notes,i.version,i.created_at as "createdAt",case when p.id is not null then c.amount else 0 end::text as "paidBaseUnits",case when p.id is not null then c.refund_amount else 0 end::text as "refundedBaseUnits",case when i.state='void' and p.id is null then 'void' when p.id is not null and c.refund_amount>=c.amount then 'refunded' when p.id is not null and c.refund_amount>0 then 'partially_refunded' when p.id is not null and c.status<>'accepted' then 'review' when p.id is not null then 'paid' when i.due_date<(now() at time zone 'UTC')::date then 'overdue' else 'unpaid' end as status from merchant_invoices i left join internal_collection_orders o on o.invoice_id=i.id left join checkout_sessions c on c.id=o.checkout_id left join payments p on p.checkout_id=c.id and p.canonical=true`;
export async function invoicesList(db:Database,merchantId:string,f:OperationFilter){
  const where='merchant_id=$1';
  const rows=await db.pool.query<Row>(`with data as (${invoiceSelect} where i.merchant_id=$1) select * from data where title ilike $2 and ($3='' or $3='all' or status=$3) order by ${orderBy(f,'"createdAt"','"amountBaseUnits"::numeric')} limit $4 offset $5`,[merchantId,literalSearch(f.search),f.status,f.pageSize,f.offset]);
  const count=await db.pool.query<{total:number}>(`with data as (${invoiceSelect} where i.merchant_id=$1) select count(*)::integer as total from data where title ilike $2 and ($3='' or $3='all' or status=$3)`,[merchantId,literalSearch(f.search),f.status]);return pageResult(rows.rows.map(publicInvoice),count.rows[0].total,f);
}
export async function invoiceDetail(db:Database,merchantId:string,id:string){
  const item=(await db.pool.query<Row>(`${invoiceSelect} where i.id=$1 and i.merchant_id=$2`,[uuid(id),merchantId])).rows[0];if(!item)throw notFound();
  const snapshot=(await db.pool.query<{contact_snapshot:unknown}>('select contact_snapshot from merchant_invoices where id=$1 and merchant_id=$2',[id,merchantId])).rows[0];
  return {item:publicInvoice(item),contactSnapshot:snapshot.contact_snapshot,merchant:await merchantProfile(db,merchantId)};
}
export async function createInvoice(db:Database,merchantId:string,payload:unknown){const data=invoiceInput.parse(payload);return mutation(db,merchantId,'invoice.create',async sql=>{
  let snapshot:{name:string;email:string}|null=null;
  if(data.contactId){snapshot=(await sql.query<{name:string;email:string}>('select name,email from merchant_contacts where id=$1 and merchant_id=$2 and archived=false for share',[data.contactId,merchantId])).rows[0]??null;if(!snapshot)throw new AppError('CONTACT_UNAVAILABLE',400,'Choose an active contact from your workspace.');}
  const row=(await sql.query<Row>('insert into merchant_invoices(merchant_id,reference,title,amount,contact_id,contact_snapshot,due_date,notes) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',[merchantId,randomToken(),data.title,data.amountBaseUnits,data.contactId,snapshot?JSON.stringify(snapshot):null,data.dueDate,data.notes])).rows[0];await audit(sql,merchantId,'invoice.created',{invoiceId:row.id});return {id:String(row.id)};
}).then(async result=>({item:(await invoiceDetail(db,merchantId,result.id)).item}));}
export async function voidInvoice(db:Database,merchantId:string,id:string,payload:unknown){const data=versionInput.parse(payload);await mutation(db,merchantId,'invoice.void',async sql=>{
  const row=(await sql.query<{version:number;state:string}>('select version,state from merchant_invoices where id=$1 and merchant_id=$2 for update',[uuid(id),merchantId])).rows[0];if(!row)throw notFound();if(row.version!==data.version)throw conflict();
  const paid=await sql.query('select p.id from internal_collection_orders o join payments p on p.checkout_id=o.checkout_id and p.canonical=true where o.invoice_id=$1',[id]);if(paid.rowCount)throw new AppError('INVOICE_PAID',409,'A received payment cannot be voided. Use the refund flow instead.');
  await sql.query("update merchant_invoices set state='void',version=version+1,updated_at=now() where id=$1",[id]);await sql.query("update internal_collection_orders set state='cancelled',version=version+1 where invoice_id=$1 and state='pending'",[id]);await audit(sql,merchantId,'invoice.voided',{invoiceId:id,outstandingAuthorizationWindowSeconds:60});
});return {item:(await invoiceDetail(db,merchantId,id)).item};}

type CollectionCheckout=CheckoutRow&{mode?:string;collection_order_id?:string|null};
export async function assertCollectionPayable(sql:PoolClient,checkout:Pick<CheckoutRow,'merchant_id'|'amount'>&{mode?:string;collection_order_id?:string|null}){
  // Lock the merchant before reading optional settings so a missing settings
  // row cannot race its first pause. Settings mutations take the same lock.
  await sql.query('select id from merchants where id=$1 for share',[checkout.merchant_id]);
  if((await sql.query<{paused:boolean}>('select paused from merchant_settings where merchant_id=$1 for share',[checkout.merchant_id])).rows[0]?.paused)throw new AppError('MERCHANT_PAUSED',409,'This business has paused new payment actions.');
  if(checkout.mode!=='collection')return;
  // Discover immutable source identity without taking the order lock. Source
  // rows are locked first, matching invoice void's source→order lock ordering.
  const order=(await sql.query<{link_id:string|null;invoice_id:string|null;state:string;amount:string}>('select link_id,invoice_id,state,amount from internal_collection_orders where id=$1 and merchant_id=$2',[checkout.collection_order_id,checkout.merchant_id])).rows[0];
  if(!order)throw new AppError('COLLECTION_CLOSED',409,'This collection is not available for new payment actions.');
  if(order.link_id){const link=(await sql.query<{active:boolean;expires_at:Date|null}>('select active,expires_at from payment_links where id=$1 and merchant_id=$2 for share',[order.link_id,checkout.merchant_id])).rows[0];if(!link?.active||(link.expires_at&&link.expires_at.getTime()<=Date.now()))throw new AppError('LINK_INACTIVE',409,'This payment link is inactive or expired.');}
  if(order.invoice_id){const invoice=(await sql.query<{state:string}>('select state from merchant_invoices where id=$1 and merchant_id=$2 for share',[order.invoice_id,checkout.merchant_id])).rows[0];if(invoice?.state!=='open')throw new AppError('INVOICE_CLOSED',409,'This invoice is no longer available for payment.');}
  const current=(await sql.query<{state:string;amount:string;link_id:string|null;invoice_id:string|null}>('select state,amount,link_id,invoice_id from internal_collection_orders where id=$1 and merchant_id=$2 for share',[checkout.collection_order_id,checkout.merchant_id])).rows[0];
  if(!current||current.state==='cancelled'||current.state==='review'||current.amount!==checkout.amount||current.link_id!==order.link_id||current.invoice_id!==order.invoice_id)throw new AppError('COLLECTION_CLOSED',409,'This collection is not available for new payment actions.');
}
export async function readInternalOrder(db:Database,merchantId:string,orderId:string,amount:string):Promise<StoreOrder|null>{
  if(!z.uuid().safeParse(orderId).success)return null;
  const row=(await db.pool.query<{id:string;amount:string;state:StoreOrder['state'];version:number;checkout_id:string|null;status:string|null;state_version:number|null;payment_id:string|null;link_active:boolean|null;link_expires_at:Date|null;invoice_state:string|null}>(`select o.id,o.amount,o.state,o.version,o.checkout_id,c.status,c.state_version,p.id as payment_id,l.active as link_active,l.expires_at as link_expires_at,i.state as invoice_state from internal_collection_orders o left join checkout_sessions c on c.id=o.checkout_id left join payments p on p.checkout_id=c.id and p.canonical=true left join payment_links l on l.id=o.link_id left join merchant_invoices i on i.id=o.invoice_id where o.id=$1 and o.merchant_id=$2`,[orderId,merchantId])).rows[0];
  if(!row)return null;if(row.amount!==amount)throw new AppError('ORDER_MISMATCH',409,'The collection amount does not match this checkout.');
  const closed=row.state==='cancelled'||row.link_active===false||(row.link_expires_at&&row.link_expires_at.getTime()<=Date.now())||row.invoice_state==='void';
  const state:StoreOrder['state']=closed?'cancelled':row.state==='review'||row.status==='review'||row.status==='orphaned'?'review':row.state;
  return {order_ref:row.id,amount_base_units:row.amount,state,payment_id:row.payment_id,state_version:row.state_version??row.version};
}
export async function publicCollection(db:Database,kind:'link'|'invoice',reference:string){
  if(!/^[a-f0-9]{64}$/.test(reference))throw notFound();
  if(kind==='link'){
    const row=(await db.pool.query<Row>(`select l.title,l.amount::text as "amountBaseUnits",(l.active and (l.expires_at is null or l.expires_at>now()) and not coalesce(s.paused,false)) as active,l.expires_at as "expiresAt",m.display_name as "merchantName",m.settlement_wallet as "merchantWallet",case when coalesce(s.paused,false) then 'paused' when not l.active then 'inactive' when l.expires_at<=now() then 'expired' else 'open' end as status from payment_links l join merchants m on m.id=l.merchant_id left join merchant_settings s on s.merchant_id=m.id where l.reference=$1`,[reference])).rows[0];if(!row)throw notFound();return {...row,kind,reference};
  }
  const row=(await db.pool.query<Row>(`${invoiceSelect} where i.reference=$1`,[reference])).rows[0];if(!row)throw notFound();
  const merchant=(await db.pool.query<{display_name:string;settlement_wallet:string;paused:boolean}>(`select m.display_name,m.settlement_wallet,coalesce(s.paused,false) as paused from merchant_invoices i join merchants m on m.id=i.merchant_id left join merchant_settings s on s.merchant_id=m.id where i.reference=$1`,[reference])).rows[0];
  return {title:row.title,amountBaseUnits:row.amountBaseUnits,dueDate:row.dueDate,merchantName:merchant.display_name,merchantWallet:merchant.settlement_wallet,active:['unpaid','overdue'].includes(String(row.status))&&!merchant.paused,status:merchant.paused?'paused':row.status,kind,reference};
}
export async function createCollectionCheckout(db:Database,kind:'link'|'invoice',reference:string){
  if(!/^[a-f0-9]{64}$/.test(reference))throw notFound();
  const order=await transaction(db,async sql=>{
    const table=kind==='link'?'payment_links':'merchant_invoices';
    const identity=(await sql.query<{merchant_id:string}>(`select merchant_id from ${table} where reference=$1`,[reference])).rows[0];if(!identity)throw notFound();
    await sql.query('select id from merchants where id=$1 for update',[identity.merchant_id]);
    const source=(await sql.query<{id:string;merchant_id:string;amount:string;active?:boolean;expires_at?:Date|null;state?:string}>(`select * from ${table} where reference=$1 and merchant_id=$2 for update`,[reference,identity.merchant_id])).rows[0];if(!source)throw notFound();
    if(kind==='link'&&(!source.active||(source.expires_at&&source.expires_at.getTime()<=Date.now())))throw new AppError('LINK_INACTIVE',409,'This payment link is inactive or expired.');
    if(kind==='invoice'&&source.state!=='open')throw new AppError('INVOICE_CLOSED',409,'This invoice is no longer available for payment.');
    if(kind==='invoice'){
      const existing=(await sql.query<{id:string;amount:string;checkout_id:string|null;status:string|null;expires_at:Date|null;merchant_id:string}>(`select o.id,o.amount,o.checkout_id,o.merchant_id,c.status,c.expires_at from internal_collection_orders o left join checkout_sessions c on c.id=o.checkout_id where o.invoice_id=$1`,[source.id])).rows[0];
      if(existing){
        if(existing.status&&existing.status!=='open')throw new AppError('INVOICE_CLOSED',409,'This invoice already has a payment or review in progress.');
        return {id:existing.id,merchantId:source.merchant_id,amount:existing.amount,renewCheckoutId:existing.checkout_id&&existing.expires_at&&existing.expires_at.getTime()<=Date.now()?existing.checkout_id:null};
      }
    }
    const id=randomUUID();await sql.query('insert into internal_collection_orders(id,merchant_id,link_id,invoice_id,amount) values($1,$2,$3,$4,$5)',[id,source.merchant_id,kind==='link'?source.id:null,kind==='invoice'?source.id:null,source.amount]);return {id,merchantId:source.merchant_id,amount:source.amount,renewCheckoutId:null};
  });
  if(order.renewCheckoutId)await transaction(db,async sql=>{
    // All money/operations mutations take the merchant lock first. Never hold
    // the invoice lock while waiting on an existing checkout in another TX.
    await sql.query('select id from merchants where id=$1 for update',[order.merchantId]);
    const existing=(await sql.query<CollectionCheckout>('select * from checkout_sessions where id=$1 and merchant_id=$2 for update',[order.renewCheckoutId,order.merchantId])).rows[0];if(!existing||existing.status!=='open')throw new AppError('INVOICE_CLOSED',409,'This invoice is no longer available for payment.');
    await assertCollectionPayable(sql,existing);
    if(existing.expires_at.getTime()<=Date.now()){
      if((await sql.query('select id from payment_authorizations where checkout_id=$1 and deadline>now()',[existing.id])).rowCount)throw new AppError('AUTHORIZATION_PENDING',409,'An earlier payment authorization is still valid. Please wait before retrying.');
      await sql.query("update checkout_sessions set expires_at=now()+interval '30 minutes',submitted_tx_hash=null where id=$1",[existing.id]);
    }
  });
  const merchant=(await db.pool.query<{website_origin:string}>('select website_origin from merchants where id=$1',[order.merchantId])).rows[0];if(!merchant?.website_origin)throw new AppError('SETUP_REQUIRED',409,'This business has not completed payment setup.');
  const internalRead=async()=>{const result=await readInternalOrder(db,order.merchantId,order.id,order.amount);if(!result)throw notFound();return result;};
  // Parent createCheckout inserts mode+order association in this same creation transaction.
  const result=await createCheckout(db,order.merchantId,`collection:${order.id}`,{order_id:order.id,amount_base_units:order.amount,return_url:`${runtimeConfig().origin}/${kind==='link'?'pay':'invoice'}/${reference}`},internalRead,order.id);
  await db.pool.query('update internal_collection_orders set checkout_id=c.id from checkout_sessions c where internal_collection_orders.id=$1 and c.reference=$2 and c.merchant_id=internal_collection_orders.merchant_id',[order.id,result.reference]);
  return {reference:result.reference,checkoutUrl:result.checkout_url};
}

export async function authenticateOperationKey(db:Database,bearer:string|null,scope:ApiScope):Promise<string>{
  if(!bearer||!/^Bearer sk_[a-f0-9]{64}$/.test(bearer))throw new AppError('API_KEY_REQUIRED',401,'A valid server API key is required.');
  const hash=hashToken(bearer.slice(7));
  const key=(await db.pool.query<{id:string;merchant_id:string;scopes:ApiScope[];revoked_at:Date|null}>('select id,merchant_id,scopes,revoked_at from merchant_api_keys where key_hash=$1',[hash])).rows[0];
  if(key){if(key.revoked_at)throw new AppError('API_KEY_REVOKED',401,'This server key was revoked.');if(!key.scopes.includes(scope))throw new AppError('API_SCOPE_DENIED',403,'This key does not have permission for that action.');await db.pool.query('update merchant_api_keys set last_used_at=now() where id=$1',[key.id]);return key.merchant_id;}
  // Only merchants with no scoped-key history keep their Phase 2 credential.
  const legacy=(await db.pool.query<{merchant_id:string}>(`select i.merchant_id from merchant_integrations i where i.key_hash=$1 and i.active=true and not exists(select 1 from merchant_api_keys k where k.merchant_id=i.merchant_id)`,[hash])).rows[0];if(!legacy)throw new AppError('API_KEY_INVALID',401,'A valid server API key is required.');return legacy.merchant_id;
}
export async function keysList(db:Database,merchantId:string,f:OperationFilter){const parameters=[merchantId,literalSearch(f.search)];const [rows,count]=await Promise.all([db.pool.query<Row>(`select ${keyColumns} from merchant_api_keys where merchant_id=$1 and name ilike $2 order by created_at desc limit $3 offset $4`,[...parameters,f.pageSize,f.offset]),db.pool.query<{total:number}>('select count(*)::integer as total from merchant_api_keys where merchant_id=$1 and name ilike $2',parameters)]);return pageResult(rows.rows,count.rows[0].total,f);}
async function insertKey(sql:PoolClient,merchantId:string,name:string,scopes:ApiScope[]){const key=`sk_${randomToken()}`;const row=(await sql.query<Row>(`insert into merchant_api_keys(merchant_id,name,prefix,key_hash,scopes) values($1,$2,$3,$4,$5) returning ${keyColumns}`,[merchantId,name,key.slice(0,11),hashToken(key),JSON.stringify(scopes)])).rows[0];return {item:row,key};}
export async function createOperationKey(db:Database,merchantId:string,payload:unknown){const data=keyInput.parse(payload);return mutation(db,merchantId,'key.create',async sql=>{await sql.query('select id from merchants where id=$1 for update',[merchantId]);if((await sql.query<{total:number}>('select count(*)::integer as total from merchant_api_keys where merchant_id=$1 and revoked_at is null',[merchantId])).rows[0].total>=20)throw new AppError('KEY_LIMIT',409,'Revoke an unused key before creating another.');const result=await insertKey(sql,merchantId,data.name,data.scopes);await audit(sql,merchantId,'key.created',{keyId:result.item.id,scopes:data.scopes});return result;});}
export async function revokeOperationKey(db:Database,merchantId:string,id:string){return mutation(db,merchantId,'key.revoke',async sql=>{const row=(await sql.query<Row>(`update merchant_api_keys set revoked_at=coalesce(revoked_at,now()) where id=$1 and merchant_id=$2 returning ${keyColumns}`,[uuid(id),merchantId])).rows[0];if(!row)throw notFound();await audit(sql,merchantId,'key.revoked',{keyId:id});return {item:row};});}
export async function rotateOperationKey(db:Database,merchantId:string,id:string){return mutation(db,merchantId,'key.rotate',async sql=>{const old=(await sql.query<{name:string;scopes:ApiScope[];revoked_at:Date|null}>('select name,scopes,revoked_at from merchant_api_keys where id=$1 and merchant_id=$2 for update',[uuid(id),merchantId])).rows[0];if(!old)throw notFound();if(old.revoked_at)throw new AppError('KEY_REVOKED',409,'Create a new key instead of rotating a revoked one.');await sql.query('update merchant_api_keys set revoked_at=now() where id=$1',[id]);const result=await insertKey(sql,merchantId,old.name,old.scopes);await audit(sql,merchantId,'key.rotated',{oldKeyId:id,newKeyId:result.item.id});return result;});}

const paymentProjection=`select p.id,c.reference,c.order_id as "orderId",c.amount::text as "amountBaseUnits",c.refund_amount::text as "refundedBaseUnits",c.status,'included_2_blocks' as "confirmationStage",(select d.status from webhook_deliveries d where d.payment_id=p.id order by state_version desc limit 1) as "deliveryStatus",c.risk_state as "riskState",p.payer,c.merchant_wallet as "merchantWallet",p.tx_hash as "txHash",p.created_at as "createdAt",p.block_time as "sourceTime",c.state_version as "stateVersion",p.canonical from payments p join checkout_sessions c on c.id=p.checkout_id`;
export async function operationPayments(db:Database,merchantId:string,f:OperationFilter){
  const where=`c.merchant_id=$1 and (c.order_id ilike $2 or p.tx_hash ilike $2 or p.payer ilike $2) and ($3='' or $3='all' or c.status=$3) and p.block_time>=($4::date::timestamp at time zone 'UTC') and p.block_time<(($5::date+1)::timestamp at time zone 'UTC')`;
  const parameters=[merchantId,literalSearch(f.search),f.status,f.from,f.to];
  const [rows,count]=await Promise.all([db.pool.query<Row>(`${paymentProjection} where ${where} order by ${orderBy(f,'p.block_time','c.amount')} limit $6 offset $7`,[...parameters,f.pageSize,f.offset]),db.pool.query<{total:number}>(`select count(*)::integer as total from payments p join checkout_sessions c on c.id=p.checkout_id where ${where}`,parameters)]);return pageResult(rows.rows,count.rows[0].total,f);
}
export async function operationPaymentDetail(db:Database,merchantId:string,id:string){
  const row=(await db.pool.query<Row>(`${paymentProjection} where p.id=$1 and c.merchant_id=$2`,[uuid(id),merchantId])).rows[0];if(!row)throw notFound();
  const timeline=(await db.pool.query<Row>('select event_type as "eventType",status,attempts,error_code as "errorCode",created_at as "createdAt",state_version as "stateVersion" from webhook_deliveries where payment_id=$1 and merchant_id=$2 order by state_version',[id,merchantId])).rows;
  return {item:row,timeline,remainingRefundableBaseUnits:(BigInt(String(row.amountBaseUnits))-BigInt(String(row.refundedBaseUnits))).toString()};
}
export async function overview(db:Database,merchantId:string,f:OperationFilter){
  const result=await db.pool.query<{grossBaseUnits:string;refundedBaseUnits:string;netBaseUnits:string;paymentCount:number}>(`with inflow as(select coalesce(sum(c.amount),0) as gross,count(*)::integer as count from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1 and p.canonical=true and p.block_time>=($2::date::timestamp at time zone 'UTC') and p.block_time<(($3::date+1)::timestamp at time zone 'UTC')),outflow as(select coalesce(sum(r.amount),0) as refunded from refund_events r where r.merchant_id=$1 and r.canonical=true and r.block_time>=($2::date::timestamp at time zone 'UTC') and r.block_time<(($3::date+1)::timestamp at time zone 'UTC')) select gross::text as "grossBaseUnits",refunded::text as "refundedBaseUnits",(gross-refunded)::text as "netBaseUnits",count as "paymentCount" from inflow,outflow`,[merchantId,f.from,f.to]);
  const series=(await db.pool.query<{date:string;grossBaseUnits:string;refundedBaseUnits:string}>(`with days as(select generate_series($2::date,$3::date,interval '1 day')::date as day),pays as(select (p.block_time at time zone 'UTC')::date as day,sum(c.amount) as gross from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1 and p.canonical=true and p.block_time>=($2::date::timestamp at time zone 'UTC') and p.block_time<(($3::date+1)::timestamp at time zone 'UTC') group by 1),refunds as(select (block_time at time zone 'UTC')::date as day,sum(amount) as refunded from refund_events where merchant_id=$1 and canonical=true and block_time>=($2::date::timestamp at time zone 'UTC') and block_time<(($3::date+1)::timestamp at time zone 'UTC') group by 1) select days.day::text as date,coalesce(pays.gross,0)::text as "grossBaseUnits",coalesce(refunds.refunded,0)::text as "refundedBaseUnits" from days left join pays using(day) left join refunds using(day) order by day`,[merchantId,f.from,f.to])).rows;
  const unknown=(await db.pool.query<{count:number}>('select count(*)::integer as count from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1 and p.canonical=true and p.block_time is null',[merchantId])).rows[0].count;
  return {...result.rows[0],series,range:{from:f.from,to:f.to},formula:'Canonical payment inflows minus canonical refund outflows within this UTC period.',unverifiedTimestampCount:unknown};
}
export async function reportCsv(db:Database,merchantId:string,f:OperationFilter){
  const rows=await db.pool.query<{kind:string;reference:string;amount:string;occurred_at:Date;tx_hash:string}>(`select * from (select 'payment'::text as kind,c.order_id as reference,c.amount::text as amount,p.block_time as occurred_at,p.tx_hash from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1 and p.canonical=true and p.block_time>=($2::date::timestamp at time zone 'UTC') and p.block_time<(($3::date+1)::timestamp at time zone 'UTC') and ($4='' or $4='all' or c.status=$4) union all select 'refund'::text,c.order_id,(-r.amount)::text,r.block_time,r.tx_hash from refund_events r join payments p on p.id=r.payment_id join checkout_sessions c on c.id=p.checkout_id where r.merchant_id=$1 and r.canonical=true and r.block_time>=($2::date::timestamp at time zone 'UTC') and r.block_time<(($3::date+1)::timestamp at time zone 'UTC') and ($4='' or $4='all' or c.status=$4)) data where reference ilike $5 or tx_hash ilike $5 order by occurred_at,tx_hash limit 10001`,[merchantId,f.from,f.to,f.status,literalSearch(f.search)]);
  if(rows.rowCount!>10000)throw new AppError('EXPORT_TOO_LARGE',400,'Choose a narrower date range to export up to 10,000 events.');
  const body=rows.rows.map(row=>[csvCell(row.kind),csvCell(row.reference),csvNumberCell(row.amount),csvNumberCell(BigInt(row.amount)<0n?`-${formatUsdt((-BigInt(row.amount)).toString())}`:formatUsdt(row.amount)),csvCell(row.occurred_at.toISOString()),csvCell(row.tx_hash)].join(','));
  return `${csvLine(['kind','order_reference','net_base_units','net_USDT','source_time_UTC','transaction_hash'])}\r\n${body.join('\r\n')}\r\n`;
}

function configurationProjection(row:{webhook_url:string;order_api_url:string;webhook_secret:string;active:boolean}|undefined){return {webhookUrl:row?.webhook_url??'',orderApiUrl:row?.order_api_url??'',configured:!!row,active:row?.active??false,secretConfigured:!!row?.webhook_secret};}
function approvedEndpoint(value:string,origin:string){const url=new URL(value);const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);if(url.origin!==origin||url.username||url.password||url.hash||url.search||(url.protocol!=='https:'&&!(runtimeConfig().allowLocal&&local&&url.protocol==='http:')))throw new AppError('ENDPOINT_NOT_ALLOWED',400,'Use an endpoint on your approved HTTPS business origin, without credentials, query or fragment.');return url.href.replace(/\/$/,'');}
export async function webhookConfiguration(db:Database,merchantId:string,f:OperationFilter){
  const row=(await db.pool.query<{webhook_url:string;order_api_url:string;webhook_secret:string;active:boolean}>('select webhook_url,order_api_url,webhook_secret,active from merchant_integrations where merchant_id=$1',[merchantId])).rows[0];
  const [tests,count]=await Promise.all([db.pool.query<Row>('select id,status,attempts,error_code as "errorCode",created_at as "createdAt" from webhook_tests where merchant_id=$1 order by created_at desc limit $2 offset $3',[merchantId,f.pageSize,f.offset]),db.pool.query<{total:number}>('select count(*)::integer as total from webhook_tests where merchant_id=$1',[merchantId])]);return {config:configurationProjection(row),...pageResult(tests.rows,count.rows[0].total,f)};
}
export async function saveWebhookConfiguration(db:Database,merchantId:string,payload:unknown){const data=webhookInput.parse(payload);if(!process.env.DATA_ENCRYPTION_KEY)throw new AppError('CONFIGURATION_UNAVAILABLE',503,'Private configuration is unavailable.');return mutation(db,merchantId,'webhook.configure',async sql=>{
  const merchant=(await sql.query<{website_origin:string}>('select website_origin from merchants where id=$1 for update',[merchantId])).rows[0];if(!merchant?.website_origin)throw new AppError('SETUP_REQUIRED',409,'Save the approved business website first.');
  const webhookUrl=approvedEndpoint(data.webhookUrl,merchant.website_origin);const orderApiUrl=approvedEndpoint(data.orderApiUrl,merchant.website_origin);
  const old=(await sql.query<{webhook_secret:string;order_read_secret:string}>('select webhook_secret,order_read_secret from merchant_integrations where merchant_id=$1 for update',[merchantId])).rows[0];
  if(!old&&!data.orderReadSecret)throw new AppError('ORDER_SECRET_REQUIRED',400,'Set the same private order-read secret in your store adapter and this configuration.');
  const secret=old?undefined:randomToken();const webhookSecret=old?.webhook_secret??encryptSecret(secret!,process.env.DATA_ENCRYPTION_KEY!,`webhook:${merchantId}`);
  const orderSecret=data.orderReadSecret?encryptSecret(data.orderReadSecret,process.env.DATA_ENCRYPTION_KEY!,`orders:${merchantId}`):old.order_read_secret;
  const row=(await sql.query<{webhook_url:string;order_api_url:string;webhook_secret:string;active:boolean}>(`insert into merchant_integrations(merchant_id,key_hash,webhook_url,order_api_url,webhook_secret,order_read_secret,active) values($1,$2,$3,$4,$5,$6,true) on conflict(merchant_id) do update set webhook_url=excluded.webhook_url,order_api_url=excluded.order_api_url,webhook_secret=excluded.webhook_secret,order_read_secret=excluded.order_read_secret,active=true returning webhook_url,order_api_url,webhook_secret,active`,[merchantId,hashToken(randomToken()),webhookUrl,orderApiUrl,webhookSecret,orderSecret])).rows[0];
  await audit(sql,merchantId,'webhook.configured',{fields:['webhookUrl','orderApiUrl',...(data.orderReadSecret?['orderReadSecret']:[])]});return {config:configurationProjection(row),...(secret?{secret}:{})};
});}
export async function rotateWebhookSecret(db:Database,merchantId:string){if(!process.env.DATA_ENCRYPTION_KEY)throw new AppError('CONFIGURATION_UNAVAILABLE',503,'Private configuration is unavailable.');return mutation(db,merchantId,'webhook.rotate',async sql=>{const secret=randomToken();const result=await sql.query('update merchant_integrations set webhook_secret=$2 where merchant_id=$1 returning merchant_id',[merchantId,encryptSecret(secret,process.env.DATA_ENCRYPTION_KEY!,`webhook:${merchantId}`)]);if(!result.rowCount)throw new AppError('INTEGRATION_UNAVAILABLE',409,'Configure your webhook before rotating its secret.');await audit(sql,merchantId,'webhook.secret_rotated',{});return {secret};});}
export async function testWebhook(db:Database,merchantId:string){
  const config=await merchantIntegration(db,merchantId);const id=randomUUID();const createdAt=new Date().toISOString();
  await transaction(db,async sql=>{await sql.query('select id from merchants where id=$1 for update',[merchantId]);await budget(sql,merchantId,'webhook.test',1);await sql.query('insert into webhook_tests(id,merchant_id) values($1,$2)',[id,merchantId]);await audit(sql,merchantId,'webhook.test_started',{testId:id});});
  const event={event_id:id,event_type:'endpoint.test',created_at:createdAt,message:'SettleKit endpoint test. This event cannot fulfill an order.'};
  const timestamp=Math.floor(Date.now()/1000).toString();const signature=createHmac('sha256',config.webhookSecret).update(`${timestamp}.${JSON.stringify(event)}`).digest('hex');let errorCode:string|null=null;
  try{await safeJsonRequest(new URL(config.webhook_url),{approvedOrigin:config.website_origin,allowLocal:runtimeConfig().allowLocal,method:'POST',headers:{'x-settlekit-timestamp':timestamp,'x-settlekit-signature':`v1=${signature}`},body:event});}catch(error){const code=error instanceof Error&&'code' in error?String(error.code):'ENDPOINT_UNAVAILABLE';errorCode=/^[A-Z_]{1,64}$/.test(code)?code:'ENDPOINT_UNAVAILABLE';}
  const row=(await db.pool.query<Row>('update webhook_tests set status=$3,error_code=$4 where id=$1 and merchant_id=$2 returning id,status,attempts,error_code as "errorCode",created_at as "createdAt"',[id,merchantId,errorCode?'failed':'delivered',errorCode])).rows[0];return {item:row};
}
export async function deliveriesList(db:Database,merchantId:string,f:OperationFilter){
  const where=`d.merchant_id=$1 and ($2='' or $2='all' or d.status=$2)`;
  const [rows,count]=await Promise.all([db.pool.query<Row>(`select d.id,d.payment_id as "paymentId",d.state_version as "stateVersion",d.event_type as "eventType",d.status,d.attempts,d.error_code as "errorCode",d.created_at as "createdAt",coalesce(b.count,0) as "replayCount",(select max(r.delivered_at) from recovery_intents r where r.delivery_id=d.id and r.status='scheduled') as "recoveredAt",case when exists(select 1 from recovery_intents r where r.delivery_id=d.id and r.delivered_at is not null and r.status='scheduled') then 'cre' else null end as "recoveryActor" from webhook_deliveries d left join delivery_replay_budget b on b.delivery_id=d.id where ${where} order by d.created_at desc limit $3 offset $4`,[merchantId,f.status,f.pageSize,f.offset]),db.pool.query<{total:number}>(`select count(*)::integer as total from webhook_deliveries d where ${where}`,[merchantId,f.status])]);return pageResult(rows.rows,count.rows[0].total,f);
}
export async function replayDelivery(db:Database,merchantId:string,id:string){
  const initial=(await db.pool.query<{payment_id:string;state_version:number;event_type:string}>('select payment_id,state_version,event_type from webhook_deliveries where id=$1 and merchant_id=$2',[uuid(id),merchantId])).rows[0];if(!initial)throw notFound();
  const current=await paymentState(db,merchantId,initial.payment_id);
  if(!current.eligible||current.state_version!==initial.state_version||initial.event_type!=='payment.accepted')throw new AppError('REPLAY_INELIGIBLE',409,'This delivery is superseded, held or no longer eligible for fulfillment.');
  return mutation(db,merchantId,'delivery.replay',async sql=>{
    const row=(await sql.query<{status:string;state_version:number}>('select status,state_version from webhook_deliveries where id=$1 and merchant_id=$2 for update',[id,merchantId])).rows[0];if(!row)throw notFound();
    if(row.status==='delivered')throw new AppError('DELIVERY_COMPLETE',409,'This event was already delivered.');
    const payment=(await sql.query<CollectionCheckout>('select c.* from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2 for update of c',[initial.payment_id,merchantId])).rows[0];
    if(!payment||payment.status!=='accepted'||payment.refund_hold||payment.refund_amount!=='0'||payment.state_version!==current.state_version||Date.parse(current.grant_expires_at)<=Date.now())throw new AppError('REPLAY_INELIGIBLE',409,'Current payment state changed. Refresh before retrying.');
    await assertCollectionPayable(sql,payment);
    await sql.query('insert into delivery_replay_budget(delivery_id,merchant_id) values($1,$2) on conflict do nothing',[id,merchantId]);
    const budgetResult=await sql.query('update delivery_replay_budget set count=count+1,last_at=clock_timestamp() where delivery_id=$1 and merchant_id=$2 and count<3 and (last_at is null or last_at<=clock_timestamp()-interval \'60 seconds\') returning count',[id,merchantId]);
    if(!budgetResult.rowCount)throw new AppError('REPLAY_BUDGET',429,'Wait 60 seconds between retries. Each delivery allows at most three manual retries.');
    const existing=await sql.query<{id:string;status:string;lease_until:Date|null}>("select id,status,lease_until from outbox_jobs where kind='payment.webhook' and payload->>'deliveryId'=$1 and merchant_id=$2 for update",[id,merchantId]);
    if(existing.rows.some(item=>item.status==='processing'&&item.lease_until&&item.lease_until.getTime()>Date.now()))throw new AppError('DELIVERY_IN_PROGRESS',409,'A worker is already delivering this event.');
    if(existing.rows[0]){
      const chosen=existing.rows[0].id;
      await sql.query("update outbox_jobs set status='dead',lease_token=null,lease_until=null,last_error_code='SUPERSEDED_BY_MANUAL_REPLAY' where kind='payment.webhook' and merchant_id=$1 and payload->>'deliveryId'=$2 and id<>$3 and status in ('pending','processing')",[merchantId,id,chosen]);
      await sql.query("update outbox_jobs set status='pending',attempts=0,available_at=clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,payload=(payload-'recoveryActor'-'recoveryKey')||jsonb_build_object('recoveryActor','merchant') where id=$1",[chosen]);
    }else await enqueue(sql,'payment.webhook',`delivery:${id}`,{deliveryId:id,recoveryActor:'merchant'},merchantId);
    const item=(await sql.query<Row>('update webhook_deliveries set status=\'pending\',error_code=null where id=$1 returning id,payment_id as "paymentId",state_version as "stateVersion",event_type as "eventType",status,attempts,error_code as "errorCode",created_at as "createdAt"',[id])).rows[0];await audit(sql,merchantId,'delivery.replayed',{deliveryId:id,replayCount:budgetResult.rows[0].count});return {item:{...item,replayCount:budgetResult.rows[0].count}};
  });
}

export async function reviewsList(db:Database,merchantId:string,f:OperationFilter){
  const where=`c.merchant_id=$1 and (c.status in ('review','orphaned') or c.refund_hold or c.risk_state in ('blocked','unavailable','review_required')) and (c.order_id ilike $2 or p.payer ilike $2)`;
  const [items,count,screening]=await Promise.all([db.pool.query<Row>(`select p.id,p.id as "paymentId",c.reference,c.order_id as "orderId",c.amount::text as "amountBaseUnits",c.status,c.risk_state as "riskState",c.refund_hold as "refundHold",p.payer,c.merchant_wallet as "merchantWallet",c.state_version as "stateVersion",p.created_at as "createdAt",coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'createdAt',n.created_at) order by n.created_at) from payment_review_notes n where n.payment_id=p.id and n.merchant_id=$1),'[]'::jsonb) as notes from payments p join checkout_sessions c on c.id=p.checkout_id where ${where} order by p.created_at desc limit $3 offset $4`,[merchantId,literalSearch(f.search),f.pageSize,f.offset]),db.pool.query<{total:number}>(`select count(*)::integer as total from payments p join checkout_sessions c on c.id=p.checkout_id where ${where}`,[merchantId,literalSearch(f.search)]),currentScreening(db,merchantId)]);
  return {...pageResult(items.rows,count.rows[0].total,f),screening};
}
export async function addReviewNote(db:Database,merchantId:string,paymentId:string,payload:unknown){const data=noteInput.parse(payload);return mutation(db,merchantId,'review.note',async sql=>{
  if(!(await sql.query('select p.id from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2',[uuid(paymentId),merchantId])).rowCount)throw notFound();
  const row=(await sql.query<Row>('insert into payment_review_notes(merchant_id,payment_id,note) values($1,$2,$3) returning id,note,created_at as "createdAt"',[merchantId,paymentId,data.note])).rows[0];await audit(sql,merchantId,'review.note_added',{paymentId,noteId:row.id});return {item:row};
});}
export async function refreshReviews(db:Database,merchantId:string){
  await transaction(db,async sql=>{await budget(sql,merchantId,'review.refresh',2);});
  const screening=await refreshMerchantScreening(db,merchantId);
  const source=(await db.pool.query('select snapshot,health from screening_sources where source_id=$1',[OFAC_SOURCE_ID])).rows[0];
  const payments=(await db.pool.query<{id:string;payer:string;merchant_wallet:string}>('select p.id,p.payer,c.merchant_wallet from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1 and p.canonical=true and c.status=\'accepted\' order by p.checked_at asc limit 100',[merchantId])).rows;
  let held=0;for(const payment of payments){if([payment.payer,payment.merchant_wallet].some(address=>evaluateWallet({address,snapshot:source?.snapshot??null,providerHealth:source?.health??{state:'unavailable',checkedAt:new Date().toISOString()}}).state!=='allowed')){await holdPayment(db,payment.id,'SCREENING_REVIEW');held++;}}
  return {screening,checkedPayments:payments.length,heldPayments:held};
}
export async function resolveReview(db:Database,merchantId:string,paymentId:string){
  const row=(await db.pool.query<CollectionCheckout&{payment_id:string;payer:string;tx_hash:`0x${string}`;log_index:number;block_hash:string;canonical:boolean}>(`select c.*,p.id as payment_id,p.payer,p.tx_hash,p.log_index,p.block_hash,p.canonical from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2`,[uuid(paymentId),merchantId])).rows[0];
  if(!row)throw notFound();if(!row.canonical||row.status==='orphaned'||row.refund_hold||BigInt(row.refund_amount)>0n)throw new AppError('REVIEW_NOT_RESOLVABLE',409,'Canonical payment, refund and hold conditions must be resolved before this review can close.');
  const evidence=await verifiedReceipt(row.tx_hash,row.log_index);
  if(evidence.blockHash!==row.block_hash||evidence.invoiceId!==row.invoice_id||evidence.payer!==row.payer||evidence.merchant!==row.merchant_wallet||evidence.amount!==row.amount)throw new AppError('REVIEW_CHAIN_MISMATCH',409,'Current chain evidence does not match this payment.');
  const policy=await checkPaymentPolicy(db,[row.payer,row.merchant_wallet]);
  const client=chainClient();const config=routerConfiguration();const anchor=await client.getBlock({blockTag:'latest'});if(anchor.number===null||anchor.hash===null)throw new AppError('CHAIN_UNAVAILABLE',503,'Current chain state is unavailable.');
  const settlement=await client.readContract({address:config.router,abi:routerAbi,functionName:'payments',args:[row.invoice_id],blockNumber:anchor.number});
  if((await client.getBlock({blockNumber:anchor.number})).hash!==anchor.hash||settlement[0].toLowerCase()!==row.payer||settlement[1].toLowerCase()!==row.merchant_wallet||settlement[2]!==BigInt(row.amount)||settlement[3]!==0n)throw new AppError('REVIEW_NOT_RESOLVABLE',409,'Current onchain payment or refund state prevents resolution.');
  if(row.mode!=='collection'){const order=await readStoreOrder(db,merchantId,row.order_id,row.amount);if(!['pending','fulfilled'].includes(order.state)||(order.payment_id!==null&&order.payment_id!==paymentId))throw new AppError('ORDER_REVIEW_REQUIRED',409,'Resolve the merchant store order before closing this payment review.');}
  await mutation(db,merchantId,'review.resolve',async sql=>{
    const current=(await sql.query<CollectionCheckout>('select * from checkout_sessions where id=$1 and merchant_id=$2 for update',[row.id,merchantId])).rows[0];if(!current||current.state_version!==row.state_version||current.refund_hold||current.refund_amount!=='0')throw conflict();
    await assertCollectionPayable(sql,current);
    const source=(await sql.query('select snapshot,health from screening_sources where source_id=$1 for share',[OFAC_SOURCE_ID])).rows[0];
    if(source?.snapshot?.sha256!==policy.sourceHash||source?.snapshot?.fetchedAt!==policy.sourceFetchedAt||policy.expiresAt<=Date.now()||[row.payer,row.merchant_wallet].some(address=>evaluateWallet({address,snapshot:source?.snapshot??null,providerHealth:source?.health??{state:'unavailable',checkedAt:new Date().toISOString()}}).state!=='allowed'))throw new AppError('SCREENING_CHANGED',409,'Required screening changed. Refresh before resolving.');
    const version=current.state_version+1;await sql.query("update checkout_sessions set status='accepted',risk_state='allowed',state_version=$2 where id=$1",[row.id,version]);await audit(sql,merchantId,'review.resolved',{paymentId,stateVersion:version});await insertDelivery(sql,paymentId,merchantId,version,'payment.accepted');
  });return {item:(await operationPaymentDetail(db,merchantId,paymentId)).item};
}

function sessionReference(hash:string){const key=process.env.DATA_ENCRYPTION_KEY;if(!key||!/^[a-f0-9]{64}$/i.test(key))throw new AppError('CONFIGURATION_UNAVAILABLE',503,'Private session configuration is unavailable.');return createHmac('sha256',Buffer.from(key,'hex')).update(`session-reference:${hash}`).digest('hex');}
export async function operationSettings(db:Database,merchantId:string,currentToken:string){
  const [settings,merchant,screening,sessions]=await Promise.all([db.pool.query<{paused:boolean;version:number}>('select paused,version from merchant_settings where merchant_id=$1',[merchantId]),merchantProfile(db,merchantId),currentScreening(db,merchantId),db.pool.query<{token_hash:string;created_at:Date;expires_at:Date}>('select token_hash,created_at,expires_at from merchant_sessions where merchant_id=$1 and expires_at>now() order by created_at desc limit 100',[merchantId])]);
  const currentHash=hashToken(currentToken);return {settings:settings.rows[0]??{paused:false,version:1},merchant,screening,sessions:sessions.rows.map(row=>({id:sessionReference(row.token_hash),createdAt:row.created_at,expiresAt:row.expires_at,current:row.token_hash===currentHash}))};
}
export async function saveOperationSettings(db:Database,merchantId:string,payload:unknown){const data=settingsInput.parse(payload);return mutation(db,merchantId,'settings.save',async sql=>{
  await sql.query('select id from merchants where id=$1 for update',[merchantId]);await sql.query('insert into merchant_settings(merchant_id) values($1) on conflict do nothing',[merchantId]);
  const row=(await sql.query<{paused:boolean;version:number}>('update merchant_settings set paused=$2,version=version+1,updated_at=now() where merchant_id=$1 and version=$3 returning paused,version',[merchantId,data.paused,data.version])).rows[0];if(!row)throw conflict();await audit(sql,merchantId,'settings.payment_pause_changed',{paused:data.paused,outstandingAuthorizationWindowSeconds:60});return {settings:row};
});}
export async function revokeOperationSessions(db:Database,merchantId:string,currentToken:string,id?:string){return mutation(db,merchantId,'session.revoke',async sql=>{
  if(!id){const result=await sql.query('delete from merchant_sessions where merchant_id=$1 and token_hash<>$2',[merchantId,hashToken(currentToken)]);await audit(sql,merchantId,'session.others_revoked',{count:result.rowCount});return {revoked:result.rowCount??0};}
  if(!/^[a-f0-9]{64}$/.test(id))throw notFound();
  const candidates=(await sql.query<{token_hash:string}>('select token_hash from merchant_sessions where merchant_id=$1 and expires_at>now() order by created_at desc limit 100',[merchantId])).rows;
  const row=candidates.find(candidate=>timingSafeEqual(Buffer.from(sessionReference(candidate.token_hash),'hex'),Buffer.from(id,'hex')));if(!row)throw notFound();
  await sql.query('delete from merchant_sessions where token_hash=$1 and merchant_id=$2',[row.token_hash,merchantId]);await audit(sql,merchantId,'session.revoked',{current:row.token_hash===hashToken(currentToken)});return {revoked:1,current:row.token_hash===hashToken(currentToken)};
});}
function safeMetadata(value:unknown):unknown {if(Array.isArray(value))return value.map(safeMetadata);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(^(secret|password|token|cookie|signature|privateKey|authorization|headers|rawBody)$|secret$|tokenHash$)/i.test(key)).map(([key,item])=>[key,safeMetadata(item)]));return value;}
export async function auditList(db:Database,merchantId:string,f:OperationFilter){const parameters=[merchantId,literalSearch(f.search),f.from,f.to];const where="merchant_id=$1 and kind ilike $2 and created_at>=($3::date::timestamp at time zone 'UTC') and created_at<(($4::date+1)::timestamp at time zone 'UTC')";const [items,count]=await Promise.all([db.pool.query<Row>(`select id,kind,metadata,created_at as "createdAt" from audit_events where ${where} order by created_at desc limit $5 offset $6`,[...parameters,f.pageSize,f.offset]),db.pool.query<{total:number}>(`select count(*)::integer as total from audit_events where ${where}`,parameters)]);return pageResult(items.rows.map(row=>({...row,metadata:safeMetadata(row.metadata)})),count.rows[0].total,f);}
