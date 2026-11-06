import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {hashToken,randomToken,encryptSecret} from '@settlekit/core/server';
import {operationFilter,csvCell} from '../../core/src/operations.ts';
import {verifyWebhook} from '@settlekit/integration';
import {createDatabase,transaction} from '../src/client.ts';
import {OFAC_SOURCE_ID} from '@settlekit/screening';
import {addReviewNote,archiveContact,assertCollectionPayable,auditList,authenticateOperationKey,contactDetail,contactsList,createCollectionCheckout,createInvoice,createOperationKey,deactivateLink,invoiceDetail,invoicesList,keysList,linksList,operationPaymentDetail,operationPayments,operationSettings,overview,publicCollection,readInternalOrder,replayDelivery,reportCsv,resolveReview,revokeOperationKey,revokeOperationSessions,rotateOperationKey,rotateWebhookSecret,saveContact,saveLink,saveOperationSettings,saveWebhookConfiguration,testWebhook,voidInvoice,webhookConfiguration} from '../src/operations.ts';
import type {CheckoutRow} from '../src/payments.ts';

if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('A separate isolated Neon test branch is required.');
const db=createDatabase(process.env.TEST_DATABASE_URL,4);const merchantId=randomUUID();const foreignId=randomUUID();const payer=privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const testToken=randomToken();const otherToken=randomToken();const owner=privateKeyToAccount(generatePrivateKey()).address.toLowerCase();let port=0;let expectedSecret='';let testEvents=0;
const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));res.setHeader('Content-Type','application/json');if(req.url==='/reject'){res.writeHead(401);res.end('{}');return;}try{verifyWebhook(Buffer.concat(chunks),String(req.headers['x-settlekit-timestamp']),String(req.headers['x-settlekit-signature']),expectedSecret);const value=JSON.parse(Buffer.concat(chunks).toString()) as {event_type:string};if(value.event_type!=='endpoint.test')throw new Error('Unexpected financial event.');testEvents++;res.end('{"testReceived":true}');}catch{res.writeHead(401);res.end('{}');}});
let paymentId='';let checkoutId='';let refundId='';let sourceSaved:Record<string,unknown>|undefined;
const filter=(extra='')=>operationFilter(new URLSearchParams(`from=2026-11-06&to=2026-11-06&${extra}`));
beforeAll(async()=>{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>{port=(server.address() as {port:number}).port;resolve();}));
  for(const [id,address]of [[merchantId,owner],[foreignId,payer]])await db.pool.query('insert into merchants(id,owner_wallet,settlement_wallet,settlement_proven_at,display_name,website_origin) values($1,$2,$2,now(),$3,$4)',[id,address,'Operations test',`http://127.0.0.1:${port}`]);
  await db.pool.query("insert into merchant_sessions(token_hash,merchant_id,expires_at) values($1,$3,now()+interval '1 hour'),($2,$3,now()+interval '1 hour')",[hashToken(testToken),hashToken(otherToken),merchantId]);
});
afterAll(async()=>{
  for(const id of [merchantId,foreignId]){
    await db.pool.query('delete from delivery_replay_budget where merchant_id=$1',[id]);
    await db.pool.query('delete from payment_review_notes where merchant_id=$1',[id]);
    await db.pool.query('delete from refund_events where merchant_id=$1',[id]);
    await db.pool.query('delete from webhook_deliveries where merchant_id=$1',[id]);
    await db.pool.query('delete from payments where checkout_id in(select id from checkout_sessions where merchant_id=$1)',[id]);
    await db.pool.query('delete from payment_authorizations where checkout_id in(select id from checkout_sessions where merchant_id=$1)',[id]);
    await db.pool.query('delete from payer_challenges where checkout_id in(select id from checkout_sessions where merchant_id=$1)',[id]);
    await db.pool.query('update internal_collection_orders set checkout_id=null where merchant_id=$1',[id]);
    await db.pool.query('delete from checkout_sessions where merchant_id=$1',[id]);
    for(const table of ['internal_collection_orders','merchant_invoices','payment_links','merchant_contacts','merchant_api_keys','merchant_settings','webhook_tests','merchant_integrations','audit_events','outbox_jobs','merchant_sessions'])await db.pool.query(`delete from ${table} where merchant_id=$1`,[id]);
    await db.pool.query('delete from merchants where id=$1',[id]);
    await db.pool.query('delete from request_budgets where key like $1',[`operations:%:${id}`]);
  }
  if(sourceSaved)await db.pool.query('update screening_sources set snapshot=$2,health=$3,fetched_at=$4,updated_at=$5 where source_id=$1',[OFAC_SOURCE_ID,JSON.stringify(sourceSaved.snapshot),JSON.stringify(sourceSaved.health),sourceSaved.fetched_at,sourceSaved.updated_at]);
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.pool.end();
});

describe('Phase 3 actual isolated Neon operations and exact synthetic event fixtures',()=>{
  it('persists contact edits/archive and immutable invoice contact snapshots, rejecting every foreign association',async()=>{
    const contact=(await saveContact(db,merchantId,{name:'Original person',email:'person@example.test',notes:'Private note'})).item;const id=String(contact.id);
    const invoice=(await createInvoice(db,merchantId,{title:'Original invoice',amountBaseUnits:'25000000',contactId:id,dueDate:'2026-11-05',notes:'Private invoice note'})).item;
    const edited=(await saveContact(db,merchantId,{version:1,name:'Updated person',email:'new@example.test',notes:''},id)).item;expect(edited.name).toBe('Updated person');
    await archiveContact(db,merchantId,id,{version:2});expect((await contactsList(db,merchantId,filter('status=archived'))).items).toHaveLength(1);
    const detail=await invoiceDetail(db,merchantId,String(invoice.id));expect(detail.contactSnapshot).toMatchObject({name:'Original person',email:'person@example.test'});expect(detail.item.status).toBe('overdue');
    await expect(createInvoice(db,foreignId,{title:'Forbidden',amountBaseUnits:'1',contactId:id})).rejects.toMatchObject({code:'CONTACT_UNAVAILABLE'});
    await expect(contactDetail(db,foreignId,id)).rejects.toMatchObject({status:404});await expect(saveContact(db,foreignId,{version:3,name:'No',email:'',notes:''},id)).rejects.toMatchObject({status:404});await expect(invoiceDetail(db,foreignId,String(invoice.id))).rejects.toMatchObject({status:404});
    expect(JSON.stringify(await publicCollection(db,'invoice',String(invoice.reference)))).not.toMatch(/person@example|Private invoice note/);
    await voidInvoice(db,merchantId,String(invoice.id),{version:1});expect((await invoiceDetail(db,merchantId,String(invoice.id))).item.status).toBe('void');
  });
  it('creates real no-code collection checkout without integration, preserves fixed snapshots and closes inactive links',async()=>{
    const link=(await saveLink(db,merchantId,{title:'Fixed collection',amountBaseUnits:'25000000'})).item;const metadata=await publicCollection(db,'link',String(link.reference));expect(metadata).toMatchObject({amountBaseUnits:'25000000',active:true,merchantWallet:owner});
    const first=await createCollectionCheckout(db,'link',String(link.reference));const second=await createCollectionCheckout(db,'link',String(link.reference));expect(first.reference).not.toBe(second.reference);
    const row=(await db.pool.query<CheckoutRow>('select * from checkout_sessions where reference=$1',[first.reference])).rows[0];expect(row.mode).toBe('collection');expect(row.merchant_wallet).toBe(owner);expect(row.amount).toBe('25000000');
    expect(await readInternalOrder(db,merchantId,row.order_id,row.amount)).toMatchObject({state:'pending',amount_base_units:'25000000'});
    expect(await readInternalOrder(db,foreignId,row.order_id,row.amount)).toBeNull();await transaction(db,sql=>assertCollectionPayable(sql,row));
    await saveLink(db,merchantId,{version:1,title:'Renamed',expiresAt:null},String(link.id));expect((await db.pool.query('select amount from checkout_sessions where id=$1',[row.id])).rows[0].amount).toBe('25000000');
    await expect(saveLink(db,merchantId,{version:2,title:'Bad amount edit',amountBaseUnits:'1'},String(link.id))).rejects.toThrow();
    await deactivateLink(db,merchantId,String(link.id),{version:2});await expect(createCollectionCheckout(db,'link',String(link.reference))).rejects.toMatchObject({code:'LINK_INACTIVE'});await expect(transaction(db,sql=>assertCollectionPayable(sql,row))).rejects.toMatchObject({code:'LINK_INACTIVE'});
    await expect(deactivateLink(db,foreignId,String(link.id),{version:3})).rejects.toMatchObject({status:404});expect((await linksList(db,merchantId,filter('status=inactive'))).items).toHaveLength(1);
  });
  it('reuses one invoice order and safely renews expired unpaid checkout; void prevents new payment',async()=>{
    const invoice=(await createInvoice(db,merchantId,{title:'Renewable invoice',amountBaseUnits:'10'})).item;const [first,repeated]=await Promise.all([createCollectionCheckout(db,'invoice',String(invoice.reference)),createCollectionCheckout(db,'invoice',String(invoice.reference))]);expect(repeated).toEqual(first);
    await db.pool.query("update checkout_sessions set expires_at=now()-interval '1 minute' where reference=$1",[first.reference]);expect(await createCollectionCheckout(db,'invoice',String(invoice.reference))).toEqual(first);expect((await db.pool.query('select expires_at>now() as valid from checkout_sessions where reference=$1',[first.reference])).rows[0].valid).toBe(true);
    await voidInvoice(db,merchantId,String(invoice.id),{version:1});await expect(createCollectionCheckout(db,'invoice',String(invoice.reference))).rejects.toMatchObject({code:'INVOICE_CLOSED'});expect((await invoicesList(db,merchantId,filter('status=void'))).items.length).toBeGreaterThan(0);
  });
  it('keeps scoped keys reveal-once, atomically rotates/revokes and never revives a legacy key',async()=>{
    const legacy=`sk_${randomToken()}`;await db.pool.query('insert into merchant_integrations(merchant_id,key_hash,webhook_url,order_api_url,webhook_secret,order_read_secret) values($1,$2,$3,$4,$5,$6)',[merchantId,hashToken(legacy),`http://127.0.0.1:${port}/hook`,`http://127.0.0.1:${port}/orders`,encryptSecret(randomToken(),process.env.DATA_ENCRYPTION_KEY!,`webhook:${merchantId}`),encryptSecret(randomToken(),process.env.DATA_ENCRYPTION_KEY!,`orders:${merchantId}`)]);
    expect(await authenticateOperationKey(db,`Bearer ${legacy}`,'checkout:create')).toBe(merchantId);
    const created=await createOperationKey(db,merchantId,{name:'Read-only',scopes:['payment:read']});expect(await authenticateOperationKey(db,`Bearer ${created.key}`,'payment:read')).toBe(merchantId);await expect(authenticateOperationKey(db,`Bearer ${created.key}`,'checkout:create')).rejects.toMatchObject({status:403});await expect(authenticateOperationKey(db,`Bearer ${legacy}`,'checkout:create')).rejects.toMatchObject({status:401});
    const rotated=await rotateOperationKey(db,merchantId,String(created.item.id));await expect(authenticateOperationKey(db,`Bearer ${created.key}`,'payment:read')).rejects.toMatchObject({code:'API_KEY_REVOKED'});expect(await authenticateOperationKey(db,`Bearer ${rotated.key}`,'payment:read')).toBe(merchantId);
    await expect(revokeOperationKey(db,foreignId,String(rotated.item.id))).rejects.toMatchObject({status:404});await revokeOperationKey(db,merchantId,String(rotated.item.id));await expect(authenticateOperationKey(db,`Bearer ${legacy}`,'payment:read')).rejects.toMatchObject({status:401});
    const listing=JSON.stringify(await keysList(db,merchantId,filter()));expect(listing).not.toContain(created.key);expect(listing).not.toContain(rotated.key);expect(listing).not.toContain('keyHash');expect((await db.pool.query('select active from merchant_integrations where merchant_id=$1',[merchantId])).rows[0].active).toBe(true);
  });
  it('encrypts validated integration configuration, rotates and sends a real nonfinancial signed HTTP test',async()=>{
    await expect(saveWebhookConfiguration(db,merchantId,{webhookUrl:'https://unapproved.example/hook',orderApiUrl:`http://127.0.0.1:${port}/orders`})).rejects.toMatchObject({code:'ENDPOINT_NOT_ALLOWED'});
    await saveWebhookConfiguration(db,merchantId,{webhookUrl:`http://127.0.0.1:${port}/hook`,orderApiUrl:`http://127.0.0.1:${port}/orders`,orderReadSecret:randomToken()});
    expectedSecret=(await rotateWebhookSecret(db,merchantId)).secret;
    expect((await db.pool.query<{webhook_secret:string}>('select webhook_secret from merchant_integrations where merchant_id=$1',[merchantId])).rows[0].webhook_secret).not.toContain(expectedSecret);
    expect((await testWebhook(db,merchantId)).item.status).toBe('delivered');expect(testEvents).toBe(1);await expect(testWebhook(db,merchantId)).rejects.toMatchObject({status:429});
    const config=await webhookConfiguration(db,merchantId,filter());expect(config.config.configured).toBe(true);expect(JSON.stringify(config)).not.toContain(expectedSecret);expect(config.items).toHaveLength(1);expect((await db.pool.query('select count(*)::integer as n from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1',[merchantId])).rows[0].n).toBe(0);
  });
  it('uses versioned pause and opaque session references, preserves current session and isolates settings',async()=>{
    const settings=await operationSettings(db,merchantId,testToken);expect(settings.sessions).toHaveLength(2);expect(JSON.stringify(settings)).not.toContain(hashToken(testToken));expect(JSON.stringify(settings)).not.toContain(testToken);
    await saveOperationSettings(db,merchantId,{version:1,paused:true});await expect(saveOperationSettings(db,merchantId,{version:1,paused:false})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    const c=(await db.pool.query<CheckoutRow>('select * from checkout_sessions where merchant_id=$1 limit 1',[merchantId])).rows[0];await expect(transaction(db,sql=>assertCollectionPayable(sql,c))).rejects.toMatchObject({code:'MERCHANT_PAUSED'});await saveOperationSettings(db,merchantId,{version:2,paused:false});
    const foreignSession=await operationSettings(db,foreignId,randomToken());expect(foreignSession.sessions).toHaveLength(0);
    expect(await revokeOperationSessions(db,merchantId,testToken)).toMatchObject({revoked:1});expect((await operationSettings(db,merchantId,testToken)).sessions).toHaveLength(1);await expect(revokeOperationSessions(db,foreignId,randomToken(),settings.sessions[0].id)).rejects.toMatchObject({status:404});
  });
  it('computes exact event-time25/5/20 period totals and formula-safe CSV, excluding orphaned events',async()=>{
    // Synthetic canonical evidence is inserted solely to exercise real SQL math/date semantics.
    checkoutId=randomUUID();paymentId=randomUUID();const authorizationId=randomUUID();const invoice=`0x${randomToken()}`;const evidence=`0x${randomToken()}`;
    await db.pool.query("insert into checkout_sessions(id,reference,merchant_id,order_id,idempotency_key,request_hash,invoice_id,merchant_wallet,amount,return_url,status,refund_amount,expires_at,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,'25000000',$9,'review','5000000',now()+interval '30 minutes','2026-10-01T00:00:00Z')",[checkoutId,randomToken(),merchantId,'=HYPERLINK("malicious")',randomToken(),randomToken(),invoice,owner,`http://127.0.0.1:${port}/`]);
    await db.pool.query("insert into payment_authorizations(id,checkout_id,payer,router,evidence,epoch,deadline,payload,signature) values($1,$2,$3,$4,$5,1,now()+interval '60 seconds','{}','0x00')",[authorizationId,checkoutId,payer,'0x3333333333333333333333333333333333333333',evidence]);
    await db.pool.query("insert into payments(id,checkout_id,authorization_id,tx_hash,log_index,block_number,block_hash,payer,block_time) values($1,$2,$3,$4,0,100,$5,$6,'2026-11-06T10:00:00Z')",[paymentId,checkoutId,authorizationId,`0x${randomToken()}`,`0x${randomToken()}`,payer]);
    refundId=randomUUID();await db.pool.query("insert into refund_events(id,merchant_id,payment_id,refund_id,amount,tx_hash,log_index,block_number,block_hash,block_time) values($1,$2,$3,$4,'5000000',$5,0,101,$6,'2026-11-06T12:00:00Z')",[refundId,merchantId,paymentId,`0x${randomToken()}`,`0x${randomToken()}`,`0x${randomToken()}`]);
    expect(await overview(db,merchantId,filter())).toMatchObject({grossBaseUnits:'25000000',refundedBaseUnits:'5000000',netBaseUnits:'20000000',paymentCount:1});
    expect((await operationPayments(db,merchantId,filter('search=HYPERLINK'))).items).toHaveLength(1);expect((await operationPaymentDetail(db,merchantId,paymentId)).remainingRefundableBaseUnits).toBe('20000000');await expect(operationPaymentDetail(db,foreignId,paymentId)).rejects.toMatchObject({status:404});
    const csv=await reportCsv(db,merchantId,filter());expect(csv).toContain("'=HYPERLINK");expect(csv).toContain('"-5000000"');expect(csvCell(' \t=1+1')).toContain("' ");
    await db.pool.query("update refund_events set block_time='2026-11-07T12:00:00Z' where id=$1",[refundId]);expect(await overview(db,merchantId,filter())).toMatchObject({grossBaseUnits:'25000000',refundedBaseUnits:'0',netBaseUnits:'25000000'});expect(await overview(db,merchantId,filter('from=2026-11-07&to=2026-11-07'))).toMatchObject({grossBaseUnits:'0',refundedBaseUnits:'5000000',netBaseUnits:'-5000000'});
    await db.pool.query('update refund_events set canonical=false where id=$1',[refundId]);expect(await overview(db,merchantId,filter('from=2026-11-07&to=2026-11-07'))).toMatchObject({refundedBaseUnits:'0'});
  });
  it('keeps review notes private and refuses unsafe resolution/replay; audit contains no revealed secrets',async()=>{
    const note=await addReviewNote(db,merchantId,paymentId,{note:'Merchant review evidence'});expect(note.item.note).toBe('Merchant review evidence');await expect(addReviewNote(db,foreignId,paymentId,{note:'Forbidden note'})).rejects.toMatchObject({status:404});
    await db.pool.query('update payments set canonical=false where id=$1',[paymentId]);await expect(resolveReview(db,merchantId,paymentId)).rejects.toMatchObject({code:'REVIEW_NOT_RESOLVABLE'});
    await expect(replayDelivery(db,foreignId,randomUUID())).rejects.toMatchObject({status:404});const history=await auditList(db,merchantId,filter());expect(history.total).toBeGreaterThan(0);expect(JSON.stringify(history)).not.toContain(expectedSecret);expect((await auditList(db,foreignId,filter())).items).toHaveLength(0);
  });
  it('a received canonical collection payment does not invent business fulfillment before worker eligibility',async()=>{
    const link=(await saveLink(db,merchantId,{title:'Receipt is not fulfillment',amountBaseUnits:'1'})).item;const quote=await createCollectionCheckout(db,'link',String(link.reference));
    const c=(await db.pool.query<CheckoutRow>('select * from checkout_sessions where reference=$1',[quote.reference])).rows[0];const authId=randomUUID();
    await db.pool.query("insert into payment_authorizations(id,checkout_id,payer,router,evidence,epoch,deadline,payload,signature) values($1,$2,$3,$4,$5,1,now()+interval '1 minute','{}','0x00')",[authId,c.id,payer,'0x3333333333333333333333333333333333333333',`0x${randomToken()}`]);
    await db.pool.query("insert into payments(checkout_id,authorization_id,tx_hash,log_index,block_number,block_hash,payer,block_time) values($1,$2,$3,0,200,$4,$5,'2026-11-08T00:00:00Z')",[c.id,authId,`0x${randomToken()}`,`0x${randomToken()}`,payer]);
    await db.pool.query("update checkout_sessions set status='accepted' where id=$1",[c.id]);expect(await readInternalOrder(db,merchantId,c.order_id,c.amount)).toMatchObject({state:'pending'});
    await db.pool.query("update internal_collection_orders set state='fulfilled',version=version+1 where id=$1",[c.collection_order_id]);expect(await readInternalOrder(db,merchantId,c.order_id,c.amount)).toMatchObject({state:'fulfilled'});
  });
  it('shows tenant-bound contact invoice/payment history and preserves orphan review with actual follow-up counts',async()=>{
    // Explicit source-event fixtures test the real SQL projection, not chain execution.
    const contact=(await saveContact(db,merchantId,{name:'History fixture',email:'history@example.test',notes:'Private history'})).item;
    const invoice=(await createInvoice(db,merchantId,{title:'History invoice',amountBaseUnits:'1',contactId:contact.id})).item;
    const session=await createCollectionCheckout(db,'invoice',String(invoice.reference));const checkout=(await db.pool.query<CheckoutRow>('select * from checkout_sessions where reference=$1',[session.reference])).rows[0];
    const authorization=(await db.pool.query("insert into payment_authorizations(checkout_id,payer,router,evidence,epoch,deadline,payload,signature) values($1,$2,$3,$4,1,now()+interval '1 minute','{}','0x00') returning id",[checkout.id,payer,'0x3333333333333333333333333333333333333333',`0x${randomToken()}`])).rows[0].id;
    const payment=(await db.pool.query('insert into payments(checkout_id,authorization_id,tx_hash,log_index,block_number,block_hash,payer,block_time) values($1,$2,$3,0,300,$4,$5,now()) returning id',[checkout.id,authorization,`0x${randomToken()}`,`0x${randomToken()}`,payer])).rows[0].id;
    await db.pool.query("update checkout_sessions set status='accepted' where id=$1",[checkout.id]);
    const history=await contactDetail(db,merchantId,String(contact.id));expect(history.invoices[0].status).toBe('paid');expect(history.payments.map(row=>row.id)).toEqual([payment]);expect(history.historyLimit).toBe(100);await expect(contactDetail(db,foreignId,String(contact.id))).rejects.toMatchObject({status:404});
    await db.pool.query('update payments set canonical=false where id=$1',[payment]);await db.pool.query("update checkout_sessions set status='orphaned',state_version=2 where id=$1",[checkout.id]);
    expect((await contactDetail(db,merchantId,String(contact.id))).invoices[0].status).toBe('review');expect(await publicCollection(db,'invoice',String(invoice.reference))).toMatchObject({status:'review',active:false});
    await db.pool.query("insert into webhook_deliveries(payment_id,merchant_id,state_version,event_type,status) values($1,$2,2,'payment.review','dead')",[payment,merchantId]);
    const followUp=await overview(db,merchantId,filter());expect(followUp.reviewCount).toBeGreaterThanOrEqual(1);expect(followUp.notificationIssueCount).toBeGreaterThanOrEqual(1);expect(await overview(db,foreignId,filter())).toMatchObject({reviewCount:0,notificationIssueCount:0});
  });
});
