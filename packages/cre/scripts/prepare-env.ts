import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const wallets = JSON.parse(await readFile(resolve(root, "data/phase-1-wallets.json"), "utf8")) as { deployer?: { privateKey?: string; address?: string } };
const key = wallets.deployer?.privateKey;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("GENERATE_TEST_WALLETS_FIRST");
const account = privateKeyToAccount(key as Hex);
if (account.address.toLowerCase() !== wallets.deployer?.address?.toLowerCase()) throw new Error("TEST_WALLET_KEY_ADDRESS_MISMATCH");
try {
  await writeFile(resolve(root, "data/cre-simulation.env"), `CRE_ETH_PRIVATE_KEY=${key.slice(2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write("Prepared ignored data/cre-simulation.env from the test-only deployer. No key emitted.\n");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  process.stdout.write("Preserved existing ignored data/cre-simulation.env.\n");
}
