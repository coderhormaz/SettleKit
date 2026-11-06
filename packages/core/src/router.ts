import { parseAbi, type Address, type Hex } from 'viem';

export const paymentTypes = {
  Payment: [
    { name: 'invoiceId', type: 'bytes32' }, { name: 'payer', type: 'address' },
    { name: 'merchant', type: 'address' }, { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' }, { name: 'evidence', type: 'bytes32' },
    { name: 'epoch', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
} as const;
export const refundTypes = {
  Refund: [{ name: 'refundId', type: 'bytes32' }, ...paymentTypes.Payment],
} as const;
export interface PaymentAuthorization {
  invoiceId: Hex; payer: Address; merchant: Address; token: Address;
  amount: bigint; evidence: Hex; epoch: bigint; deadline: bigint;
}
export interface RefundAuthorization extends PaymentAuthorization { refundId: Hex }
export function routerDomain(chainId: number, verifyingContract: Address) {
  return { name: 'SettleKitRouter', version: '1', chainId, verifyingContract } as const;
}

export const routerAbi = parseAbi([
  'function token() view returns (address)',
  'function owner() view returns (address)',
  'function authorizationSigner() view returns (address)',
  'function policyEpoch() view returns (uint256)',
  'function policyValidUntil() view returns (uint256)',
  'function policyCommitment() view returns (bytes32)',
  'function paused() view returns (bool)',
  'function denied(address wallet) view returns (bool)',
  'function payments(bytes32 invoiceId) view returns (address payer, address merchant, uint256 amount, uint256 refunded)',
  'function usedRefunds(bytes32 refundId) view returns (bool)',
  'function syncPolicy(uint256 nextEpoch, uint256 validUntil, bytes32 commitment, address[] wallets, bool[] blocked)',
  'function setPaused(bool value)',
  'function setAuthorizationSigner(address signer)',
  'function pay((bytes32 invoiceId,address payer,address merchant,address token,uint256 amount,bytes32 evidence,uint256 epoch,uint256 deadline) authorization, bytes signature)',
  'function refund((bytes32 refundId,bytes32 invoiceId,address payer,address merchant,address token,uint256 amount,bytes32 evidence,uint256 epoch,uint256 deadline) authorization, bytes signature)',
  'event PaymentAccepted(bytes32 indexed invoiceId, address indexed payer, address indexed merchant, address token, uint256 amount, bytes32 evidence, uint256 epoch, uint256 deadline)',
  'event RefundExecuted(bytes32 indexed refundId, bytes32 indexed invoiceId, address payer, address merchant, address token, uint256 amount, bytes32 evidence, uint256 epoch, uint256 deadline)',
  'event PolicySynchronized(uint256 indexed epoch, uint256 validUntil, bytes32 commitment)',
]);
