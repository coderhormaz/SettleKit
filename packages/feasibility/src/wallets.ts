import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type LocalWallets, type WalletRole, readWallets, walletFile, printEvidence, writeEvidence } from "./support.js";

const roles: WalletRole[] = ["payer", "merchant", "deployer", "quoteSigner", "policyAdmin", "arkivWriter"];
await mkdir(dirname(walletFile), { recursive: true });
let wallets: LocalWallets;
try {
  wallets = await readWallets();
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  wallets = Object.fromEntries(roles.map((role) => {
    const privateKey = generatePrivateKey();
    return [role, { address: privateKeyToAccount(privateKey).address, privateKey }];
  })) as LocalWallets;
  await writeFile(walletFile, `${JSON.stringify(wallets, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
const publicEvidence = {
  kind: "test-wallet-setup",
  createdOrReadAt: new Date().toISOString(),
  privateStorage: "Ignored data/phase-1-wallets.json; private keys are never emitted by this command.",
  wallets: Object.fromEntries(roles.map((role) => [role, wallets[role].address])),
  fundingRequired: {
    whitechain: "Test WBT for payer/merchant/deployer/policyAdmin; exact sponsor USDT for payer and merchant. Official faucet requires the user's GitHub authentication.",
    arkiv: "Test GLM for arkivWriter through Arkiv Hub; an access key may be required for dependable RPC access.",
  },
};
await writeEvidence("whitechain-test-wallets.json", publicEvidence);
printEvidence(publicEvidence);
