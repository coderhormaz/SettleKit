import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import hre from 'hardhat';
import { encodeFunctionData, keccak256, stringToHex, toFunctionSelector, zeroAddress, zeroHash, type Hex } from 'viem';
import { paymentTypes, refundTypes, routerDomain, type PaymentAuthorization, type RefundAuthorization } from '../../core/src/router.ts';

const { viem, networkHelpers } = await hre.network.create();
const id = (value: string) => keccak256(stringToHex(value));

async function fixture() {
  const [admin, signer, payer, merchant, stranger] = await viem.getWalletClients();
  const client = await viem.getPublicClient();
  const token = await viem.deployContract('MockUsdt');
  const router = await viem.deployContract('SettleKitRouter', [token.address, admin.account.address, signer.account.address]);
  const timestamp = (await client.getBlock()).timestamp;
  await router.write.syncPolicy([1n, timestamp + 3600n, id('current-source'), [], []]);
  await token.write.mint([payer.account.address, 100_000_000n]);
  await token.write.approve([router.address, 100_000_000n], { account: payer.account });
  await token.write.approve([router.address, 100_000_000n], { account: merchant.account });
  const payment = async (overrides: Partial<PaymentAuthorization> = {}): Promise<PaymentAuthorization> => ({
    invoiceId: id('invoice-1'), payer: payer.account.address, merchant: merchant.account.address,
    token: token.address, amount: 25_000_000n, evidence: id('screening-commitment'), epoch: await router.read.policyEpoch(),
    deadline: (await client.getBlock()).timestamp + 60n, ...overrides,
  });
  const domain = routerDomain(await client.getChainId(), router.address);
  const signPayment = (message: PaymentAuthorization, overrides: Partial<typeof domain> = {}) => signer.signTypedData({ domain: { ...domain, ...overrides }, types: paymentTypes, primaryType: 'Payment', message });
  const signRefund = (message: RefundAuthorization) => signer.signTypedData({ domain, types: refundTypes, primaryType: 'Refund', message });
  const pay = async (message?: PaymentAuthorization, signature?: Hex) => {
    const p = message ?? await payment();
    return router.write.pay([p, signature ?? await signPayment(p)], { account: payer.account });
  };
  const settled = async () => {
    const p = await payment(); await pay(p);
    const refund: RefundAuthorization = { ...p, refundId: id('refund-1'), amount: 5_000_000n, deadline: (await client.getBlock()).timestamp + 60n };
    return { p, refund };
  };
  return { admin, signer, payer, merchant, stranger, client, token, router, payment, domain, signPayment, signRefund, pay, settled };
}

describe('SettleKitRouter local simulated-chain security', () => {
  it('settles exact 25 USDT directly to merchant, emits bound evidence and holds no funds', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment();
    await viem.assertions.emitWithArgs(f.pay(p), f.router, 'PaymentAccepted', [p.invoiceId, p.payer, p.merchant, p.token, p.amount, p.evidence, p.epoch, p.deadline]);
    assert.equal(await f.token.read.balanceOf([p.merchant]), 25_000_000n);
    assert.equal(await f.token.read.balanceOf([f.router.address]), 0n);
    const stored = await f.router.read.payments([p.invoiceId]);
    assert.deepEqual([stored[0].toLowerCase(), stored[1].toLowerCase(), stored[2], stored[3]], [p.payer.toLowerCase(), p.merchant.toLowerCase(), p.amount, 0n]);
  });

  it('starts fail-closed and rejects invalid token/admin/signer configuration', async () => {
    const f = await networkHelpers.loadFixture(fixture);
    const initial = await viem.deployContract('SettleKitRouter', [f.token.address, f.admin.account.address, f.signer.account.address]);
    const p = await f.payment();
    await assert.rejects(initial.write.pay([p, await f.signPayment(p)], { account: f.payer.account }), /PolicyUnavailable/);
    await assert.rejects(viem.deployContract('SettleKitRouter', [zeroAddress, f.admin.account.address, f.signer.account.address]), /InvalidConfiguration/);
    await assert.rejects(viem.deployContract('SettleKitRouter', [f.token.address, f.admin.account.address, f.admin.account.address]), /InvalidConfiguration/);
  });

  it('rejects missing signatures, unauthorized signer and direct caller bypass', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment();
    await assert.rejects(f.pay(p, '0x'), /ECDSAInvalidSignatureLength/);
    const forged = await f.stranger.signTypedData({ domain: f.domain, types: paymentTypes, primaryType: 'Payment', message: p });
    await assert.rejects(f.pay(p, forged), /InvalidAuthorization/);
    await assert.rejects(f.router.write.pay([p, await f.signPayment(p)], { account: f.stranger.account }), /WrongCaller/);
  });

  for (const field of ['invoiceId', 'merchant', 'token', 'amount', 'evidence', 'epoch', 'deadline'] as const) {
    it(`rejects signed payment ${field} substitution`, async () => {
      const f = await networkHelpers.loadFixture(fixture); const p = await f.payment(); const signature = await f.signPayment(p);
      const replacements = { invoiceId: id('other-invoice'), merchant: f.stranger.account.address, token: f.stranger.account.address, amount: 25_000_001n, evidence: id('other-evidence'), epoch: 2n, deadline: p.deadline - 1n };
      await assert.rejects(f.pay({ ...p, [field]: replacements[field] }, signature), /InvalidAuthorization|PolicyUnavailable/);
    });
  }

  it('rejects payer substitution even when the replacement submits the call', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment();
    await assert.rejects(f.router.write.pay([{ ...p, payer: f.stranger.account.address }, await f.signPayment(p)], { account: f.stranger.account }), /InvalidAuthorization/);
  });

  it('rejects wrong chain, router and operation domains', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment();
    await assert.rejects(f.pay(p, await f.signPayment(p, { chainId: 1874 })), /InvalidAuthorization/);
    await assert.rejects(f.pay(p, await f.signPayment(p, { verifyingContract: f.stranger.account.address })), /InvalidAuthorization/);
    await assert.rejects(f.pay(p, await f.signRefund({ ...p, refundId: id('refund') })), /InvalidAuthorization/);
  });

  it('rejects invoice replay, zero amount/id/evidence and overly long/expired approvals', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment(); await f.pay(p);
    await assert.rejects(f.pay(p), /InvoiceAlreadyPaid/);
    for (const invalid of [{ invoiceId: zeroHash }, { amount: 0n }, { evidence: zeroHash }]) await assert.rejects(f.pay(await f.payment(invalid)), /InvalidAuthorization/);
    await assert.rejects(f.pay(await f.payment({ deadline: (await f.client.getBlock()).timestamp + 500n })), /AuthorizationExpired/);
    await networkHelpers.time.increase(61);
    await assert.rejects(f.pay({ ...p, invoiceId: id('later') }), /AuthorizationExpired/);
  });

  it('requires confirmed current policy and rejects stale epochs, pause and expired policy', async () => {
    const f = await networkHelpers.loadFixture(fixture); const old = await f.payment();
    await f.router.write.syncPolicy([2n, (await f.client.getBlock()).timestamp + 100n, id('new-policy'), [], []]);
    await assert.rejects(f.pay(old), /PolicyUnavailable/);
    const p = await f.payment(); await f.router.write.setPaused([true]);
    await assert.rejects(f.pay(p), /PolicyUnavailable/);
    await f.router.write.setPaused([false]);
    await assert.rejects(f.pay(await f.payment()), /PolicyUnavailable/);
    await f.router.write.syncPolicy([5n, (await f.client.getBlock()).timestamp + 10n, id('restored'), [], []]);
    await networkHelpers.time.increase(11);
    await assert.rejects(f.pay(await f.payment()), /PolicyUnavailable/);
  });

  for (const role of ['payer', 'merchant'] as const) {
    it(`enforces ${role} hard denial on payment and preserves denial when omitted from later sync`, async () => {
      const f = await networkHelpers.loadFixture(fixture);
      await f.router.write.syncPolicy([2n, (await f.client.getBlock()).timestamp + 300n, id('denials'), [f[role].account.address], [true]]);
      await assert.rejects(f.pay(await f.payment()), /WalletDenied/);
      await f.router.write.syncPolicy([3n, (await f.client.getBlock()).timestamp + 300n, id('same-denials'), [], []]);
      assert.equal(await f.router.read.denied([f[role].account.address]), true);
      await assert.rejects(f.pay(await f.payment()), /WalletDenied/);
    });
  }

  it('rejects merchant policy administration, invalid sync data and rotates signer with invalidation', async () => {
    const f = await networkHelpers.loadFixture(fixture); const now = (await f.client.getBlock()).timestamp; const p = await f.payment();
    await assert.rejects(f.router.write.syncPolicy([2n, now + 100n, id('x'), [], []], { account: f.merchant.account }), /OwnableUnauthorizedAccount/);
    await assert.rejects(f.router.write.setPaused([true], { account: f.signer.account }), /OwnableUnauthorizedAccount/);
    await assert.rejects(f.router.write.setAuthorizationSigner([f.stranger.account.address], { account: f.merchant.account }), /OwnableUnauthorizedAccount/);
    for (const args of [[1n, now + 100n, id('x'), [], []], [2n, now + 8000n, id('x'), [], []], [2n, now + 100n, zeroHash, [], []], [2n, now + 100n, id('x'), [f.payer.account.address], []]] as const) await assert.rejects(f.router.write.syncPolicy(args), /InvalidPolicy/);
    await assert.rejects(f.router.write.transferOwnership([f.signer.account.address]), /InvalidConfiguration/);
    await f.router.write.setAuthorizationSigner([f.stranger.account.address]);
    assert.equal(await f.router.read.policyValidUntil(), 0n);
    await assert.rejects(f.pay(p), /PolicyUnavailable/);
    await f.router.write.syncPolicy([3n, now + 300n, id('rotated'), [], []]);
    await assert.rejects(f.pay(await f.payment()), /InvalidAuthorization/);
  });

  it('rolls back failed transfers and permits a correctly approved retry', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment();
    await f.token.write.setFailTransfers([true]);
    await assert.rejects(f.pay(p), /SafeERC20FailedOperation/);
    assert.equal((await f.router.read.payments([p.invoiceId]))[0], zeroAddress);
    await f.token.write.setFailTransfers([false]);
    await f.token.write.approve([f.router.address, 0n], { account: f.payer.account });
    await assert.rejects(f.pay(p), /ERC20InsufficientAllowance/);
    await f.token.write.approve([f.router.address, p.amount], { account: f.payer.account });
    await f.pay(p);
    assert.equal(await f.token.read.allowance([p.payer, f.router.address]), 0n);
  });

  it('executes 5 USDT partial and 20 USDT remainder refunds to the original payer only', async () => {
    const f = await networkHelpers.loadFixture(fixture); const { p, refund } = await f.settled();
    await viem.assertions.emitWithArgs(f.router.write.refund([refund, await f.signRefund(refund)], { account: f.merchant.account }), f.router, 'RefundExecuted', [refund.refundId, p.invoiceId, p.payer, p.merchant, p.token, refund.amount, p.evidence, p.epoch, refund.deadline]);
    const remainder = { ...refund, refundId: id('refund-2'), amount: 20_000_000n };
    await f.router.write.refund([remainder, await f.signRefund(remainder)], { account: f.merchant.account });
    assert.equal((await f.router.read.payments([p.invoiceId]))[3], p.amount);
    assert.equal(await f.token.read.balanceOf([p.payer]), 100_000_000n);
    assert.equal(await f.token.read.balanceOf([p.merchant]), 0n);
  });

  it('rejects refund caller/recipient/token/merchant substitution, nonexistent invoices and operation signature reuse', async () => {
    const f = await networkHelpers.loadFixture(fixture); const { refund } = await f.settled(); const sig = await f.signRefund(refund);
    await assert.rejects(f.router.write.refund([refund, sig], { account: f.payer.account }), /WrongCaller/);
    for (const invalid of [{ payer: f.stranger.account.address }, { merchant: f.stranger.account.address }, { token: f.stranger.account.address }, { refundId: zeroHash }]) {
      const r = { ...refund, ...invalid };
      await assert.rejects(f.router.write.refund([r, await f.signRefund(r)], { account: f.merchant.account }), /InvalidAuthorization/);
    }
    const unknown = { ...refund, invoiceId: id('unknown') };
    await assert.rejects(f.router.write.refund([unknown, await f.signRefund(unknown)], { account: f.merchant.account }), /UnknownPayment/);
    await assert.rejects(f.router.write.refund([refund, await f.signPayment(refund)], { account: f.merchant.account }), /InvalidAuthorization/);
  });

  it('caps cumulative refunds, rejects replay and restores refund state after transfer failure', async () => {
    const f = await networkHelpers.loadFixture(fixture); const { refund } = await f.settled();
    const over = { ...refund, amount: 25_000_001n };
    await assert.rejects(f.router.write.refund([over, await f.signRefund(over)], { account: f.merchant.account }), /RefundExceedsPayment/);
    await f.token.write.setFailTransfers([true]);
    await assert.rejects(f.router.write.refund([refund, await f.signRefund(refund)], { account: f.merchant.account }), /SafeERC20FailedOperation/);
    assert.equal(await f.router.read.usedRefunds([refund.refundId]), false);
    assert.equal((await f.router.read.payments([refund.invoiceId]))[3], 0n);
    await f.token.write.setFailTransfers([false]);
    await f.router.write.refund([refund, await f.signRefund(refund)], { account: f.merchant.account });
    await assert.rejects(f.router.write.refund([refund, await f.signRefund(refund)], { account: f.merchant.account }), /RefundAlreadyUsed/);
    const overRemainder = { ...refund, refundId: id('over-rem'), amount: 20_000_001n };
    await assert.rejects(f.router.write.refund([overRemainder, await f.signRefund(overRemainder)], { account: f.merchant.account }), /RefundExceedsPayment/);
  });

  it('rechecks hard denials and policy/deadline at refund execution', async () => {
    const f = await networkHelpers.loadFixture(fixture); const { refund } = await f.settled();
    await f.router.write.syncPolicy([2n, (await f.client.getBlock()).timestamp + 300n, id('new-denial'), [refund.payer], [true]]);
    await assert.rejects(f.router.write.refund([refund, await f.signRefund(refund)], { account: f.merchant.account }), /PolicyUnavailable/);
    const current = { ...refund, epoch: 2n };
    await assert.rejects(f.router.write.refund([current, await f.signRefund(current)], { account: f.merchant.account }), /WalletDenied/);
    await f.router.write.syncPolicy([3n, (await f.client.getBlock()).timestamp + 300n, id('cleared'), [refund.payer], [false]]);
    await networkHelpers.time.increase(61);
    const expired = { ...refund, epoch: 3n };
    await assert.rejects(f.router.write.refund([expired, await f.signRefund(expired)], { account: f.merchant.account }), /AuthorizationExpired/);
  });

  it('preserves one-base-unit precision without rounding', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment({ amount: 1n }); await f.pay(p);
    assert.equal(await f.token.read.balanceOf([p.merchant]), 1n);
    const r = { ...p, refundId: id('micro-refund') };
    await f.router.write.refund([r, await f.signRefund(r)], { account: f.merchant.account });
    assert.equal((await f.router.read.payments([p.invoiceId]))[3], 1n);
  });

  it('preserves the complete uint256 range in payment and refund accounting', async () => {
    const f = await networkHelpers.loadFixture(fixture); const maximum = (1n << 256n) - 1n;
    await f.token.write.mint([f.payer.account.address, maximum - 100_000_000n]);
    await f.token.write.approve([f.router.address, maximum], { account: f.payer.account });
    await f.token.write.approve([f.router.address, maximum], { account: f.merchant.account });
    const p = await f.payment({ amount: maximum }); await f.pay(p);
    const r = { ...p, refundId: id('max-refund') };
    await f.router.write.refund([r, await f.signRefund(r)], { account: f.merchant.account });
    assert.equal((await f.router.read.payments([p.invoiceId]))[3], maximum);
    assert.equal(await f.token.read.balanceOf([p.payer]), maximum);
  });

  it('rejects fee/inexact transfers rather than emitting an incorrect settled amount', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment();
    await f.token.write.setChargeFee([true]);
    await assert.rejects(f.pay(p), /InexactTransfer/);
    assert.equal((await f.router.read.payments([p.invoiceId]))[0], zeroAddress);
    await f.token.write.setChargeFee([false]); await f.pay(p);
    await f.token.write.setChargeFee([true]);
    const r = { ...p, refundId: id('fee-refund'), amount: 5_000_000n };
    await assert.rejects(f.router.write.refund([r, await f.signRefund(r)], { account: f.merchant.account }), /InexactTransfer/);
    assert.equal((await f.router.read.payments([p.invoiceId]))[3], 0n);
  });

  it('rejects reentrant token callbacks with the guard and preserves exactly one settlement', async () => {
    const f = await networkHelpers.loadFixture(fixture); const p = await f.payment(); const signature = await f.signPayment(p);
    await f.token.write.setCallback([f.router.address, encodeFunctionData({ abi: f.router.abi, functionName: 'pay', args: [p, signature] })]);
    await f.pay(p, signature);
    assert.equal(await f.token.read.callbackFailure(), toFunctionSelector('ReentrancyGuardReentrantCall()'));
    assert.equal(await f.token.read.balanceOf([p.merchant]), p.amount);
  });
});
