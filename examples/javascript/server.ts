// Server-only. Never import this module from a browser component.
import { IntegrationError, isEndpointTest, parseEligibility, parsePaymentEvent, receiptDisposition, safeJsonRequest, verifyWebhook, type CurrentEligibility, type PaymentEvent } from '../../packages/integration/src/index.ts';

export interface CheckoutResult { reference: string; checkout_url: string }
export interface MerchantOrder { id: string; amountBaseUnits: string }
export interface ClientOptions { gatewayOrigin: string; storeOrigin: string; apiKey: string; webhookSecret: string; allowLocal?: boolean }
const identifier = /^[A-Za-z0-9_-]{8,128}$/;

function approvedOrigin(value: string, allowLocal: boolean) {
  const url = new URL(value); const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.origin !== value.replace(/\/$/, '') || url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:'))) throw new IntegrationError('ORIGIN_CONFIGURATION', 503);
  return url.origin;
}

export class SettleKitClient {
  readonly gatewayOrigin: string; readonly storeOrigin: string; readonly allowLocal: boolean;
  #apiKey: string; #webhookSecret: string;
  constructor(options: ClientOptions) {
    this.allowLocal = options.allowLocal === true;
    this.gatewayOrigin = approvedOrigin(options.gatewayOrigin, this.allowLocal); this.storeOrigin = approvedOrigin(options.storeOrigin, this.allowLocal);
    if (options.apiKey.length < 32 || options.webhookSecret.length < 32) throw new IntegrationError('CREDENTIAL_CONFIGURATION', 503);
    this.#apiKey = options.apiKey; this.#webhookSecret = options.webhookSecret;
  }
  async createCheckout(order: MerchantOrder, returnUrl: string): Promise<CheckoutResult> {
    // The caller reads these values from its own durable order, never from buyer JSON.
    if (!identifier.test(order.id) || !/^[1-9]\d{0,77}$/.test(order.amountBaseUnits) || BigInt(order.amountBaseUnits) >= 2n ** 256n) throw new IntegrationError('ORDER_INVALID');
    const target = new URL(returnUrl); if (target.origin !== this.storeOrigin || target.username || target.password || target.hash) throw new IntegrationError('RETURN_URL_INVALID');
    const value = await safeJsonRequest(new URL('/api/v1/checkouts', this.gatewayOrigin), { approvedOrigin: this.gatewayOrigin, allowLocal: this.allowLocal, method: 'POST', headers: { Authorization: `Bearer ${this.#apiKey}`, 'Idempotency-Key': order.id }, body: { order_id: order.id, amount_base_units: order.amountBaseUnits, return_url: target.href } });
    if (!value || typeof value !== 'object' || !('reference' in value) || !('checkout_url' in value) || typeof value.reference !== 'string' || !/^[a-f0-9]{64}$/.test(value.reference) || typeof value.checkout_url !== 'string') throw new IntegrationError('CHECKOUT_RESPONSE_INVALID', 503);
    const checkout = new URL(value.checkout_url); if (checkout.origin !== this.gatewayOrigin || checkout.username || checkout.password || checkout.hash || checkout.search || checkout.pathname !== `/checkout/${value.reference}`) throw new IntegrationError('CHECKOUT_RESPONSE_INVALID', 503);
    return { reference: value.reference, checkout_url: checkout.href };
  }
  async eligibility(paymentId: string): Promise<CurrentEligibility> {
    if (!identifier.test(paymentId)) throw new IntegrationError('PAYMENT_ID_INVALID');
    return parseEligibility(await safeJsonRequest(new URL(`/api/v1/payments/${paymentId}/eligibility`, this.gatewayOrigin), { approvedOrigin: this.gatewayOrigin, allowLocal: this.allowLocal, headers: { Authorization: `Bearer ${this.#apiKey}` } }));
  }
  async receive<T>(raw: Buffer, timestamp: string | undefined, signature: string | undefined, applyAtomically: (event: PaymentEvent, current: CurrentEligibility) => Promise<T>): Promise<{ test: true; fulfillment: false } | T> {
    verifyWebhook(raw, timestamp, signature, this.#webhookSecret);
    if (isEndpointTest(raw)) return { test: true, fulfillment: false };
    const event = parsePaymentEvent(raw); const current = await this.eligibility(event.payment_id);
    receiptDisposition(event, current); // Validates every association and the short grant, including correction events.
    // Callback must lock order, recheck grant, deduplicate and perform its effect in ONE merchant transaction.
    return applyAtomically(event, current);
  }
}
