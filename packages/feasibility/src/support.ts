import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Hex } from "viem";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const walletFile = resolve(repoRoot, "data/phase-1-wallets.json");
export type WalletRole = "payer" | "merchant" | "deployer" | "quoteSigner" | "policyAdmin" | "arkivWriter";
export type LocalWallets = Record<WalletRole, { address: Hex; privateKey: Hex }>;

export async function readWallets(): Promise<LocalWallets> {
  return JSON.parse(await readFile(walletFile, "utf8")) as LocalWallets;
}

export async function writeEvidence(name: string, evidence: unknown): Promise<void> {
  const directory = resolve(repoRoot, "docs/evidence/phase-1");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export function printEvidence(evidence: unknown): void {
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
