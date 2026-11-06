import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOKEN, type CurrentEligibility, type PaymentEvent } from '../src/index.ts';
import { applyReceipt, cancelOrder, createOrder, createStoreDatabase, orderById, saveCheckout } from '../../../examples/store/src/store.ts';

if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_STORE_DATABASE_URL||process.env.TEST_STORE_DATABASE_URL===process.env.STORE_DATABASE_URL)throw new Error('Explicit isolated TEST_STORE_DATABASE_URL required for independent store integration checks.');
const pool=createStoreDatabase(process.env.TEST_STORE_DATABASE_URL);
const ids:string[]=[];
async function setup(){
  const order=await createOrder(pool);ids.push(order.id);const reference='checkout_'+randomUUID().replaceAll('-','');
  await saveCheckout(pool,order.id,reference,'https://gateway.example/checkout/'+reference);
  const event:PaymentEvent={event_id:'event_'+randomUUID(),event_type:'payment.accepted',payment_id:'payment_'+randomUUID(),checkout_reference:reference,merchant_order_id:order.id,state_version:2,amount_base_units:'25000000',token:TOKEN,chain_id:1874,payer:'0x1111111111111111111111111111111111111111',merchant:'0x2222222222222222222222222222222222222222',confirmation_stage:'included_2_blocks',eligible:true,refund_amount_base_units:'0',created_at:new Date().toISOString()};
  return {order,event};
}
const current=(event:PaymentEvent,patch:Partial<CurrentEligibility>={}):CurrentEligibility=>({...event,status:'accepted',refund_hold:false,grant_expires_at:new Date(Date.now()+10_000).toISOString(),...patch});
beforeAll(async()=>{await pool.query('select id from store_orders limit 1');},30_000);
afterAll(async()=>{if(ids.length){await pool.query('delete from store_review_events where order_id=any($1::uuid[])',[ids]);await pool.query('delete from store_receipts where order_id=any($1::uuid[])',[ids]);await pool.query('delete from store_orders where id=any($1::uuid[])',[ids]);}await pool.end();});

describe('actual independent Neon store transactions',()=>{
  it('fulfills once across concurrent retries and different event IDs for one logical payment',async()=>{
    const {order,event}=await setup();const eligibility=current(event);
    const receipts=await Promise.all([applyReceipt(pool,event,eligibility),applyReceipt(pool,event,eligibility)]);
    expect(receipts.filter(receipt=>receipt.duplicate)).toHaveLength(1);
    await applyReceipt(pool,{...event,event_id:'event_'+randomUUID()},current(event));
    expect(await orderById(pool,order.id)).toMatchObject({state:'fulfilled',fulfillment_count:1,payment_id:event.payment_id});
    expect((await pool.query('select count(*)::integer as count from store_receipts where order_id=$1',[order.id])).rows[0].count).toBe(2);
  });
  it('locks cancellation against fulfillment and records paid-after-cancel review',async()=>{
    const {order,event}=await setup();await cancelOrder(pool,order.id,order.cancel_token);
    expect(await applyReceipt(pool,event,current(event))).toMatchObject({disposition:'review'});
    expect(await orderById(pool,order.id)).toMatchObject({state:'cancelled',fulfillment_count:0});
    expect((await pool.query("select code from store_review_events where order_id=$1 and code='PAYMENT_AFTER_CANCELLATION'",[order.id])).rowCount).toBe(1);
    await expect(cancelOrder(pool,order.id,'forged')).rejects.toThrow('ORDER_NOT_FOUND');
  });
  it('holds refunded/refund-pending state and ignores a superseded acceptance',async()=>{
    const first=await setup();await applyReceipt(pool,first.event,current(first.event,{refund_hold:true}));
    expect(await orderById(pool,first.order.id)).toMatchObject({state:'review',fulfillment_count:0});
    const second=await setup();await applyReceipt(pool,second.event,current(second.event,{state_version:3}));
    expect(await orderById(pool,second.order.id)).toMatchObject({state:'pending',fulfillment_count:0});
    const third=await setup();await applyReceipt(pool,third.event,current(third.event,{refund_amount_base_units:'5000000'}));
    expect(await orderById(pool,third.order.id)).toMatchObject({state:'review',fulfillment_count:0});
  });
  it('preserves delivered entitlement history and records corrective exposure after reorg',async()=>{
    const {order,event}=await setup();await applyReceipt(pool,event,current(event));
    const correction:PaymentEvent={...event,event_id:'event_'+randomUUID(),event_type:'payment.review',eligible:false,state_version:3};
    expect(await applyReceipt(pool,correction,current(correction,{status:'orphaned',eligible:false}))).toMatchObject({disposition:'review_exposure'});
    expect(await orderById(pool,order.id)).toMatchObject({state:'review',fulfillment_count:1,payment_version:3});
    expect((await pool.query("select code from store_review_events where order_id=$1 and code='CORRECTION_AFTER_FULFILLMENT'",[order.id])).rowCount).toBe(1);
    await applyReceipt(pool,event,current(event,{state_version:3,status:'orphaned',eligible:false}));
    expect((await orderById(pool,order.id)).fulfillment_count).toBe(1);
  });
  it('rejects mismatched order, amount or checkout association without consuming an event',async()=>{
    const {order,event}=await setup();const altered={...event,checkout_reference:'wrong_checkout_123'};
    await expect(applyReceipt(pool,altered,current(altered))).rejects.toThrow('ORDER_ASSOCIATION_MISMATCH');
    expect((await pool.query('select event_id from store_receipts where order_id=$1',[order.id])).rowCount).toBe(0);
    expect((await orderById(pool,order.id)).fulfillment_count).toBe(0);
  });
  it('revalidates a short current-state grant after waiting on the merchant order lock',async()=>{
    const {order,event}=await setup();const blocker=await pool.connect();
    try{
      await blocker.query('begin');await blocker.query('select id from store_orders where id=$1 for update',[order.id]);
      const result=applyReceipt(pool,event,current(event,{grant_expires_at:new Date(Date.now()+150).toISOString()}));
      const assertion=expect(result).rejects.toThrow('ELIGIBILITY_GRANT_EXPIRED');
      await new Promise(resolve=>setTimeout(resolve,250));await blocker.query('commit');await assertion;
      expect((await orderById(pool,order.id)).fulfillment_count).toBe(0);
    }finally{await blocker.query('rollback');blocker.release();}
  });
});
