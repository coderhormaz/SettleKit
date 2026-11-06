import {
  CronCapability,
  HTTPClient,
  Runner,
  consensusIdenticalAggregation,
  handler,
  json,
  ok,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";

const WHITECHAIN_RPC = "https://rpc.testnet.whitechain.io";
const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
type Config = { schedule: string; diagnosticUrl: string };
type RouteProof = { whitechainChainId: number; token: string; decimals: number; merchantApi: string; proof: string };

function proveRoutes(sendRequester: HTTPSendRequester, config: Config): RouteProof {
  const rpcResponse = sendRequester.sendRequest({
    url: WHITECHAIN_RPC,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: USDT, data: "0x313ce567" }, "latest"] },
    ])).toString("base64"),
    cacheSettings: { store: false, maxAge: "0s" },
  }).result();
  if (!ok(rpcResponse)) throw new Error("WHITECHAIN_RPC_HTTP_FAILED");
  const values: unknown = json(rpcResponse);
  if (!Array.isArray(values)) throw new Error("WHITECHAIN_RPC_RESPONSE_NOT_ARRAY");
  const resultFor = (id: number): unknown => values.find((entry: unknown) => entry !== null && typeof entry === "object" && "id" in entry && entry.id === id)?.result;
  const chainHex = resultFor(1);
  const decimalsHex = resultFor(2);
  if (chainHex !== "0x752" || typeof decimalsHex !== "string" || BigInt(decimalsHex) !== 6n) throw new Error("WHITECHAIN_TOKEN_OR_CHAIN_MISMATCH");

  const merchantResponse = sendRequester.sendRequest({ url: config.diagnosticUrl, method: "GET" }).result();
  if (!ok(merchantResponse)) throw new Error("MERCHANT_DIAGNOSTIC_HTTP_FAILED");
  const merchant: unknown = json(merchantResponse);
  if (!merchant || typeof merchant !== "object" || !("service" in merchant) || merchant.service !== "settlekit-phase1-diagnostic" || !("status" in merchant) || merchant.status !== "ready") throw new Error("MERCHANT_DIAGNOSTIC_RESPONSE_MISMATCH");
  return { whitechainChainId: 1874, token: USDT, decimals: 6, merchantApi: merchant.service, proof: "CRE HTTP route feasibility only; no payment or recovery claim" };
}

function onCron(runtime: Runtime<Config>): RouteProof {
  runtime.log("Starting Phase 1 Whitechain HTTP and merchant API route proof.");
  if (runtime.config.diagnosticUrl !== "http://127.0.0.1:3011/health" || typeof runtime.config.schedule !== "string") throw new Error("INVALID_LOCAL_FEASIBILITY_CONFIG");
  const result = new HTTPClient().sendRequest(runtime, proveRoutes, consensusIdenticalAggregation<RouteProof>())(runtime.config).result();
  runtime.log(`Route proof: Whitechain ${result.whitechainChainId}, sponsor USDT decimals ${result.decimals}, separate diagnostic API ready.`);
  return result;
}

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run((config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)]);
}
