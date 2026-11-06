import type { Metadata } from 'next';
import { Checkout } from './checkout';

export const metadata: Metadata = { title: 'Secure checkout — SettleKit', description: 'Pay the exact USDT amount directly to the merchant on Whitechain Sepolia.' };
export default async function CheckoutPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <Checkout reference={reference} />;
}
