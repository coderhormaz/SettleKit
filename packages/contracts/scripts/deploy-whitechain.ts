import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, erc20Abi, getAddress, http, isAddress, keccak256, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { routerAbi } from '../../core/src/router.ts';

// Run from the workspace root with tsx --env-file=.env. This script never
// prints errors from providers because those can contain private RPC URLs.
const token = getAddress('0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7');
const chain = defineChain({ id: 1874, name: 'Whitechain Sepolia', nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.whitechain.io'] } } });

async function deploy() {
  const key = process.env.WHITECHAIN_DEPLOYER_PRIVATE_KEY;
  const adminValue = process.env.POLICY_ADMIN_ADDRESS;
  const signerValue = process.env.AUTHORIZATION_SIGNER_ADDRESS;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !adminValue || !isAddress(adminValue) || !signerValue || !isAddress(signerValue)) throw new Error('DEPLOYMENT_CONFIGURATION_REQUIRED');
  const admin = getAddress(adminValue), signer = getAddress(signerValue);
  if (admin === signer) throw new Error('SEPARATE_ADMIN_AND_SIGNER_REQUIRED');
  const account = privateKeyToAccount(key as Hex);
  const transport = http(process.env.WHITECHAIN_RPC_URL || chain.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 1 });
  const client = createPublicClient({ chain, transport });
  if (await client.getChainId() !== 1874) throw new Error('WRONG_CHAIN');
  const code = await client.getCode({ address: token });
  if (!code || code === '0x' || await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('WRONG_TOKEN');
  const artifact = JSON.parse(await readFile(new URL('../artifacts/contracts/SettleKitRouter.sol/SettleKitRouter.json', import.meta.url), 'utf8')) as { abi: Abi; bytecode: Hex };
  const balance = await client.getBalance({ address: account.address });
  const wallet = createWalletClient({ chain, account, transport });
  const args = [token, admin, signer] as const;
  const gas = await client.estimateGas({ account, data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args }) }).catch(() => null);
  // Default is a read-only configuration check; broadcasting is explicit.
  if (!process.argv.includes('--broadcast')) {
    process.stdout.write(JSON.stringify({ kind: 'read-only-deployment-preflight', chainId: 1874, token, decimals: 6, deployer: account.address, admin, signer, funded: balance > 0n, bytecodeHash: keccak256(artifact.bytecode), estimateAvailable: gas !== null, broadcast: false }, null, 2) + '\n');
    return;
  }
  if (balance === 0n) throw new Error('TEST_WBT_FUNDING_REQUIRED');
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('DEPLOYMENT_NOT_SUCCESSFUL');
  const address = getAddress(receipt.contractAddress);
  if ((await client.readContract({ address, abi: routerAbi, functionName: 'token' })).toLowerCase() !== token.toLowerCase()) throw new Error('DEPLOYED_TOKEN_MISMATCH');
  const runtimeCode = await client.getCode({ address });
  if (!runtimeCode || runtimeCode === '0x') throw new Error('DEPLOYED_CODE_MISSING');
  const directory = fileURLToPath(new URL('../../../docs/evidence/phase-2/', import.meta.url));
  await mkdir(directory, { recursive: true });
  const evidence = { kind: 'live-whitechain-router-deployment', observedAt: new Date().toISOString(), chainId: 1874, address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, token, constructorArguments: args, compiler: '0.8.38', evmVersion: 'prague', optimizerRuns: 200, bytecodeHash: keccak256(artifact.bytecode), runtimeCodeHash: keccak256(runtimeCode), sourceVerified: false, explorer: `https://explorer.testnet.whitechain.io/address/${address}`, policyInitiallyUnavailable: true };
  await writeFile(`${directory}/router-deployment.json`, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}

try { await deploy(); }
catch (error) {
  const code = error instanceof Error && /^[A-Z_]{1,64}$/.test(error.message) ? error.message : 'DEPLOYMENT_DEPENDENCY_FAILED';
  process.stderr.write(`${code}\n`); process.exitCode = 1;
}
