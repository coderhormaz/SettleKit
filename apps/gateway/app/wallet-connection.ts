import type { Connector } from 'wagmi';

// EIP-6963 wallets need not expose window.ethereum. The generic injected
// connector may exist even when it has no provider.
export async function availableWallet(connectors: readonly Connector[], active?: Connector): Promise<Connector> {
  if (active && await active.getProvider()) return active;
  for (const connector of connectors) {
    if (await connector.getProvider()) return connector;
  }
  throw new Error('Browser wallet provider not found');
}
