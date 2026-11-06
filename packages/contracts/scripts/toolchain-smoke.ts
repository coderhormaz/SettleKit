import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import solc from "solc";

const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(resolve(project, "contracts/ToolchainSmoke.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "ToolchainSmoke.sol": { content: source } },
  settings: { evmVersion: "prague", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const result = JSON.parse(solc.compile(JSON.stringify(input), {
  import(path: string) {
    try { return { contents: readFileSync(require.resolve(path), "utf8") }; }
    catch { return { error: "IMPORT_NOT_FOUND" }; }
  },
})) as { errors?: { severity: string; formattedMessage: string }[]; contracts?: Record<string, Record<string, { evm: { bytecode: { object: string } } }>> };
const errors = result.errors?.filter((error) => error.severity === "error") ?? [];
if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
const bytecode = result.contracts?.["ToolchainSmoke.sol"]?.ToolchainSmoke?.evm.bytecode.object;
if (!bytecode) throw new Error("SMOKE_BYTECODE_MISSING");
const evidence = { kind: "local-contract-toolchain-spike", observedAt: new Date().toISOString(), compiler: solc.version(), evmVersion: "prague", openZeppelinImports: true, bytecodeBytes: bytecode.length / 2, deployed: false, routerImplemented: false };
const directory = resolve(project, "../../docs/evidence/phase-1");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "contract-toolchain.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
