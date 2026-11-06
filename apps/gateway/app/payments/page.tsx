import type { Metadata } from 'next';
import { Payments } from './payments';

export const metadata: Metadata = { title: 'Payments — SettleKit', description: 'Track verified Whitechain payments and merchant notifications.' };
export default function PaymentsPage() { return <Payments />; }
