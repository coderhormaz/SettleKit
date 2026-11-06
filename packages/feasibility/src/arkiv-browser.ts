import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { repoRoot, printEvidence, writeEvidence, reportProbeFailure } from "./support.js";

async function main() {
const sdkEvidence = JSON.parse(await readFile(resolve(repoRoot, "docs/evidence/phase-1/arkiv-network.json"), "utf8")) as { queryRpcRequest?: unknown; writer: string; entityKey: string | null };
if (!sdkEvidence.queryRpcRequest) throw new Error("RUN_ARKIV_SDK_PROBE_FIRST");
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end("<!doctype html><title>Independent Arkiv browser probe</title><p>Public RPC query feasibility. No gateway API or private credentials.</p>");
});
await new Promise<void>((resolveReady) => server.listen(3012, "127.0.0.1", resolveReady));
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3012");
  const result = await page.evaluate(async (rpcRequest) => {
    const response = await fetch("https://rpc.rabdi.db-chain.testnet.arkiv.network", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rpcRequest),
    });
    const body = await response.json() as { error?: { code: number }; result?: { data: unknown[]; blockNumber: string } };
    if (!response.ok || body.error || !body.result) throw new Error("PUBLIC_BROWSER_ARKIV_QUERY_FAILED");
    return { httpStatus: response.status, returnedRecordCount: body.result.data.length, blockNumber: body.result.blockNumber };
  }, sdkEvidence.queryRpcRequest);
  const evidence = { kind: "live-independent-browser-query", observedAt: new Date().toISOString(), origin: "http://127.0.0.1:3012", publicRpc: "https://rpc.rabdi.db-chain.testnet.arkiv.network", writerFilter: sdkEvidence.writer, query: sdkEvidence.queryRpcRequest, ...result, gatewayApiUsed: false, privateBrowserCredentialUsed: false, ownEntityWritten: sdkEvidence.entityKey !== null, limitation: sdkEvidence.entityKey ? "Queries a separately written feasibility entity, not payment accounting." : "Public-browser query works, but no owned entity can be demonstrated until writer test-GLM funding." };
  await writeEvidence("arkiv-browser.json", evidence);
  printEvidence(evidence);
} finally {
  await browser?.close();
  await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
}
}

await main().catch((error: unknown) => reportProbeFailure("arkiv-browser", error));
