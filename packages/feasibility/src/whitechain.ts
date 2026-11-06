import { createPublicClient, defineChain, erc20Abi, http, parseAbi, encodeFunctionData, keccak256, stringToBytes, toHex } from "viem";
import { readWallets, printEvidence, writeEvidence, reportProbeFailure } from "./support.js";

async function main() {
const token = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" as const;
const rpcUrl = process.env.WHITECHAIN_RPC_URL ?? "https://rpc.testnet.whitechain.io";
const chain = defineChain({ id: 1874, name: "Whitechain Sepolia", nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
const observedAt = new Date().toISOString();
const chainId = await client.getChainId();
if (chainId !== 1874) throw new Error("WHITECHAIN_CHAIN_ID_MISMATCH");
const [code, decimals, name, symbol, totalSupply, block] = await Promise.all([
  client.getCode({ address: token }),
  client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
  client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
  client.getBlock(),
]);
if (!code || code === "0x" || decimals !== 6) throw new Error("SPONSOR_TOKEN_METADATA_MISMATCH");

let wallets: Awaited<ReturnType<typeof readWallets>> | undefined;
try { wallets = await readWallets(); } catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
const balances = wallets ? await Promise.all(["payer", "merchant", "deployer", "policyAdmin"].map(async (role) => {
  const wallet = wallets![role as keyof typeof wallets];
  const [gasBalance, tokenBalance] = await Promise.all([
    client.getBalance({ address: wallet.address }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
  ]);
  return { role, address: wallet.address, wbtBaseUnits: gasBalance.toString(), usdtBaseUnits: tokenBalance.toString() };
})) : [];

const optionalAbi = parseAbi([
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);
const featureReads = await Promise.all((["owner", "paused", "DOMAIN_SEPARATOR"] as const).map(async (functionName) => {
  try {
    const result = await client.readContract({ address: token, abi: optionalAbi, functionName });
    return { functionName, read: "succeeded", result: String(result) };
  } catch { return { functionName, read: "reverted-or-unsupported" }; }
}));
const proxySlots = await Promise.all(["implementation", "admin"].map(async (kind) => {
  const slot = toHex(BigInt(keccak256(stringToBytes(`eip1967.proxy.${kind}`))) - 1n, { size: 32 });
  const value = await client.getStorageAt({ address: token, slot });
  return { kind, slot, address: value ? `0x${value.slice(-40)}` : null };
}));

const simulatedCalls = wallets ? await Promise.all([
  { operation: "approve-zero", functionName: "approve" as const, args: [wallets.merchant.address, 0n] as const },
  { operation: "transfer-zero", functionName: "transfer" as const, args: [wallets.merchant.address, 0n] as const },
].map(async (call) => {
  try {
    const result = await client.call({ account: wallets!.payer.address, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: call.functionName, args: call.args }) });
    return { operation: call.operation, execution: "read-only eth_call", returnData: result.data ?? "0x" };
  } catch { return { operation: call.operation, execution: "read-only eth_call", outcome: "reverted" }; }
})) : [];

const evidence = {
  kind: "live-read-only-testnet-probe", observedAt, chainId, token,
  decimals, name, symbol, totalSupplyBaseUnits: totalSupply.toString(), bytecodeBytes: (code.length - 2) / 2,
  blockNumber: block.number.toString(), blockHash: block.hash, balances, featureReads, proxySlots, simulatedCalls,
  conclusions: {
    baseline: "Exact token and chain are reachable. Approval followed by transferFrom remains the supported integration baseline.",
    transferEvidence: "Zero-amount eth_call is simulation only; it proves neither a signed approval nor a successful funded transfer.",
    permit: "No permit support is assumed. DOMAIN_SEPARATOR read alone does not establish a complete permit implementation.",
    issuerControls: "Review the explorer's proxy and implementation ABI/source. Readable owner/paused values are observations, not a security audit.",
    funding: balances.some((balance) => balance.wbtBaseUnits !== "0" && balance.usdtBaseUnits !== "0") ? "Inspect per-role balances before signing any operation." : "Funded approval/transfer remains blocked on test WBT and exact sponsor USDT.",
  },
};
await writeEvidence("whitechain-network.json", evidence);
printEvidence(evidence);
}

await main().catch((error: unknown) => reportProbeFailure("whitechain", error));
