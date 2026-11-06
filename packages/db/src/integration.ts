import { AppError } from '@settlekit/core';
import { decryptSecret, runtimeConfig } from '@settlekit/core/server';
import { safeJsonRequest } from '@settlekit/integration';
import type { Database } from './client.ts';

export async function merchantIntegration(db:Database,merchantId:string) {
  const result=await db.pool.query<{webhook_url:string;order_api_url:string;webhook_secret:string;order_read_secret:string;website_origin:string}>('select i.webhook_url,i.order_api_url,i.webhook_secret,i.order_read_secret,m.website_origin from merchant_integrations i join merchants m on m.id=i.merchant_id where i.merchant_id=$1 and i.active=true',[merchantId]);
  const row=result.rows[0];if(!row||!process.env.DATA_ENCRYPTION_KEY)throw new AppError('INTEGRATION_UNAVAILABLE',503,'Merchant integration is unavailable.');
  return {...row,webhookSecret:decryptSecret(row.webhook_secret,process.env.DATA_ENCRYPTION_KEY,`webhook:${merchantId}`),orderReadSecret:decryptSecret(row.order_read_secret,process.env.DATA_ENCRYPTION_KEY,`orders:${merchantId}`)};
}
export interface StoreOrder {order_ref:string;amount_base_units:string;state:'pending'|'fulfilled'|'cancelled'|'review';payment_id:string|null;state_version:number}
export async function readStoreOrder(db:Database,merchantId:string,orderId:string,amount:string):Promise<StoreOrder> {
  const config=await merchantIntegration(db,merchantId);const url=new URL(`${config.order_api_url.replace(/\/$/,'')}/${encodeURIComponent(orderId)}`);
  const data=await safeJsonRequest(url,{approvedOrigin:config.website_origin,allowLocal:runtimeConfig().allowLocal,headers:{authorization:`Bearer ${config.orderReadSecret}`}}) as Partial<StoreOrder>|null;
  if(!data||data.order_ref!==orderId||data.amount_base_units!==amount||!['pending','fulfilled','cancelled','review'].includes(data.state??'')||!Number.isSafeInteger(data.state_version)||(data.state_version??0)<1||(data.payment_id!==null&&typeof data.payment_id!=='string'))throw new AppError('ORDER_MISMATCH',409,'The merchant order does not match this payment.');
  return data as StoreOrder;
}
