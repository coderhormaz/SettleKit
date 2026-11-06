import type pg from 'pg';
import { adapterOrder, applyReceipt, orderById, saveCheckout } from '../store/src/store.ts';
import { bearerMatches, IntegrationError } from '../../packages/integration/src/index.ts';
import { SettleKitClient } from './server.ts';

// These callbacks are directly runnable against the existing independent store's Neon schema.
// A different merchant replaces the order transaction module with its own durable order system.
export function createMerchantAdapter(pool: pg.Pool, client: SettleKitClient, orderReadSecret: string) {
  if (orderReadSecret.length < 32) throw new IntegrationError('ORDER_SECRET_CONFIGURATION', 503);
  return {
    async checkout(orderId: string) {
      const order = await orderById(pool, orderId);
      if (order.state !== 'pending') throw new IntegrationError('ORDER_NOT_PAYABLE', 409);
      if (order.checkout_reference && order.checkout_url) return { reference: order.checkout_reference, checkout_url: order.checkout_url };
      const result = await client.createCheckout({ id: order.id, amountBaseUnits: order.amount_base_units }, `${client.storeOrigin}/?order=${encodeURIComponent(order.id)}`);
      await saveCheckout(pool, order.id, result.reference, result.checkout_url); return result;
    },
    async orderRead(orderId: string, authorization: string | undefined) {
      if (!bearerMatches(authorization, orderReadSecret)) throw new IntegrationError('UNAUTHORIZED', 401);
      return adapterOrder(await orderById(pool, orderId));
    },
    async webhook(raw: Buffer, timestamp: string | undefined, signature: string | undefined) {
      return client.receive(raw, timestamp, signature, (event, current) => applyReceipt(pool, event, current));
    },
  };
}
