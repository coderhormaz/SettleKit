import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { defineSchema, str } from "@arkiv-network/sdk/schema";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readWallets, printEvidence, writeEvidence, reportProbeFailure } from "./support.js";

async function main() {
const Probe = defineSchema("settlekit.phase1-feasibility.v1", {
  kind: str().indexed(),
  message: str(),
});
const configuredKey = process.env.ARKIV_WRITER_PRIVATE_KEY;
if (configuredKey && !/^0x[0-9a-fA-F]{64}$/.test(configuredKey)) throw new Error("INVALID_ARKIV_WRITER_KEY_FORMAT");
const privateKey = configuredKey as Hex | undefined ?? (await readWallets()).arkivWriter.privateKey;
const account = privateKeyToAccount(privateKey);
const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
let queryRpcRequest: unknown;
const transport = http(process.env.ARKIV_RPC_URL, {
  timeout: 15_000,
  retryCount: 1,
  fetchFn: async (input, init) => {
    if (typeof init?.body === "string") {
      const request = JSON.parse(init.body) as { method?: string };
      if (request.method === "arkiv_query") queryRpcRequest = request;
    }
    return fetch(input, init);
  },
});
const publicClient = createPublicClient({ chain, transport });
const observedAt = new Date().toISOString();
const chainId = await publicClient.getChainId();
if (chainId !== 7_794_095) throw new Error("ARKIV_CHAIN_ID_MISMATCH");
const balance = await publicClient.getBalance({ address: account.address });
const reads = await publicClient.select({ $key: true, kind: true, message: true }).from(Probe).ownedBy(account.address).fetch();
const baseEvidence = {
  kind: "live-arkiv-sdk-probe", observedAt, sdk: "@arkiv-network/sdk@1.0.1", chainId,
  writer: account.address, writerBalanceBaseUnits: balance.toString(), schema: "settlekit.phase1-feasibility.v1",
  priorOwnedProbeCount: reads.entities.length,
  query: "publicClient.select({ $key: true, kind: true, message: true }).from(Probe).ownedBy(writer).fetch()",
  queryRpcRequest,
};
if (balance === 0n) {
  const evidence = { ...baseEvidence, write: "blocked", blocker: "Writer has zero test GLM. User must fund this address through the official Arkiv Hub faucet. No entity was written.", entityKey: null };
  await writeEvidence("arkiv-network.json", evidence);
  printEvidence(evidence);
  process.exitCode = 2;
} else {
  const walletClient = createWalletClient({ chain, transport, account });
  const { entityKey } = await walletClient.createEntity(Probe, { kind: "feasibility", message: "SettleKit SDK write/read probe. No payment, customer or risk data." }, { expiration: ExpirationTime.fromDays(1) });
  const rows = await publicClient.select({ $key: true, kind: true, message: true }).from(Probe).ownedBy(account.address).fetch();
  const matched = rows.entities.find((entity) => entity.$key === entityKey);
  if (!matched) throw new Error("ARKIV_WRITTEN_ENTITY_NOT_RETURNED_BY_QUERY");
  const evidence = { ...baseEvidence, write: "confirmed-and-queried", entityKey, ownerFilteredQueryMatched: true, message: matched.message.value, expiresAfter: "1 day; feasibility only, not accounting retention" };
  await writeEvidence("arkiv-network.json", evidence);
  printEvidence(evidence);
}
}

await main().catch((error: unknown) => reportProbeFailure("arkiv", error));
