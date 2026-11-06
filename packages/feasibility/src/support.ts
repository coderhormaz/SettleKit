import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const walletFile = resolve(repoRoot, "data/phase-1-wallets.json");
export type WalletRole = "payer" | "merchant" | "deployer" | "quoteSigner" | "policyAdmin" | "arkivWriter";
export type LocalWallets = Record<WalletRole, { address: Hex; privateKey: Hex }>;

export async function readWallets(): Promise<LocalWallets> {
  const parsed: unknown = JSON.parse(await readFile(walletFile, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("INVALID_TEST_WALLET_FILE");
  const records = parsed as Record<string, unknown>;
  const roles: WalletRole[] = ["payer", "merchant", "deployer", "quoteSigner", "policyAdmin", "arkivWriter"];
  for (const role of roles) {
    const value = records[role];
    if (!value || typeof value !== "object") throw new Error("INVALID_TEST_WALLET_ROLE");
    const wallet = value as Record<string, unknown>;
    if (typeof wallet.privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(wallet.privateKey) || typeof wallet.address !== "string") throw new Error("INVALID_TEST_WALLET_FORMAT");
    const derived = privateKeyToAccount(wallet.privateKey as Hex).address;
    if (derived.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("TEST_WALLET_ADDRESS_KEY_MISMATCH");
  }
  return records as LocalWallets;
}

export async function writeEvidence(name: string, evidence: unknown): Promise<void> {
  const directory = resolve(repoRoot, "docs/evidence/phase-1");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export function printEvidence(evidence: unknown): void {
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

export function reportProbeFailure(probe: string, error: unknown): void {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{3,90}$/.test(error.message) ? error.message : "PROBE_FAILED";
  printEvidence({ kind: "probe-error", probe, code, errorType: error instanceof Error ? error.name : "UnknownError", detail: "Transport error details are omitted because provider errors may include credential-bearing URLs." });
  process.exitCode = 1;
}
