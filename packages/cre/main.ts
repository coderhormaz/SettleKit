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
import { z } from "zod";

const WHITECHAIN_RPC = "https://rpc.testnet.whitechain.io";
const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const configSchema = z.object({
  schedule: z.string().min(1),
  diagnosticUrl: z.literal("http://127.0.0.1:3011/health"),
});
type Config = z.infer<typeof configSchema>;
type RouteProof = { whitechainChainId: number; token: string; decimals: number; merchantApi: string; proof: string };

function proveRoutes(sendRequester: HTTPSendRequester, config: Config): RouteProof {
  const rpcResponse = sendRequester.sendRequest({
    url: WHITECHAIN_RPC,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: btoa(JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: USDT, data: "0x313ce567" }, "latest"] },
    ])),
    cacheSettings: { readFromCache: true, maxAgeMs: 1_000 },
  }).result();
  if (!ok(rpcResponse)) throw new Error("WHITECHAIN_RPC_HTTP_FAILED");
  const values = z.array(z.object({ id: z.number(), result: z.string() })).parse(json(rpcResponse));
  const chainHex = values.find((entry) => entry.id === 1)?.result;
  const decimalsHex = values.find((entry) => entry.id === 2)?.result;
  if (chainHex !== "0x752" || !decimalsHex || BigInt(decimalsHex) !== 6n) throw new Error("WHITECHAIN_TOKEN_OR_CHAIN_MISMATCH");

  const merchantResponse = sendRequester.sendRequest({ url: config.diagnosticUrl, method: "GET" }).result();
  if (!ok(merchantResponse)) throw new Error("MERCHANT_DIAGNOSTIC_HTTP_FAILED");
  const merchant = z.object({ service: z.literal("settlekit-phase1-diagnostic"), status: z.literal("ready") }).parse(json(merchantResponse));
  return { whitechainChainId: 1874, token: USDT, decimals: 6, merchantApi: merchant.service, proof: "CRE HTTP route feasibility only; no payment or recovery claim" };
}

function onCron(runtime: Runtime<Config>): RouteProof {
  const result = new HTTPClient().sendRequest(runtime, proveRoutes, consensusIdenticalAggregation<RouteProof>())(runtime.config).result();
  runtime.log(`Route proof: Whitechain ${result.whitechainChainId}, sponsor USDT decimals ${result.decimals}, separate diagnostic API ready.`);
  return result;
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run((config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)]);
}
