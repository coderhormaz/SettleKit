import type {Database} from '../src/client.ts';
import {transaction} from '../src/client.ts';
/** Delete only fresh test-owned tenants on the explicitly isolated branch. */
export async function cleanupTestMerchants(db:Database,ids:string[]){
  if(process.env.TEST_DATABASE_ISOLATED!=='true'||db.pool.options.connectionString!==process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Isolated test database required for fixture cleanup.');
  if(!ids.length)return;
  await transaction(db,async sql=>{
    for(const table of ['recovery_intents','recovery_budgets','delivery_replay_budget','payment_review_notes','arkiv_mappings','refund_events'])await sql.query(`delete from ${table} where merchant_id=any($1::uuid[])`,[ids]);
    await sql.query('delete from refund_authorizations where intent_id in(select id from refund_intents where merchant_id=any($1::uuid[]))',[ids]);
    for(const table of ['refund_intents','webhook_deliveries'])await sql.query(`delete from ${table} where merchant_id=any($1::uuid[])`,[ids]);
    for(const table of ['payments','payer_challenges','payment_authorizations'])await sql.query(`delete from ${table} where checkout_id in(select id from checkout_sessions where merchant_id=any($1::uuid[]))`,[ids]);
    for(const table of ['internal_collection_orders','checkout_sessions','merchant_invoices','payment_links','merchant_contacts','merchant_api_keys','merchant_settings','webhook_tests','merchant_integrations','screening_decisions','audit_events','outbox_jobs','merchant_sessions','wallet_challenges'])await sql.query(`delete from ${table} where merchant_id=any($1::uuid[])`,[ids]);
    await sql.query('delete from merchants where id=any($1::uuid[])',[ids]);
  });
}
