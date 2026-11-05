import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { importCurrentOfac, ScreeningSourceError } from "../src/index.js";

const output = process.argv[2];
if (!output) throw new Error("Supply a sanitized evidence JSON output path");

try {
  const snapshot = await importCurrentOfac();
  const evidence = {
    kind: "live-official-source-read",
    sourceId: snapshot.sourceId,
    sourceUrl: snapshot.sourceUrl,
    sha256: snapshot.sha256,
    fetchedAt: snapshot.fetchedAt,
    publishedAt: snapshot.publishedAt,
    totalSdnRecords: snapshot.recordCount,
    supportedIdentifierOccurrences: snapshot.entryCount,
    uniqueSupportedAddresses: snapshot.addresses.length,
    coverage: snapshot.coverage,
    rawAddressesPublished: false,
    limitations: "Official SDN published ETH address identifiers only; exact address-string policy on Whitechain. No ownership attribution, indirect exposure, comprehensive jurisdictional or source-of-funds coverage.",
  };
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} catch (error) {
  const evidence = { kind: "live-official-source-read", checkedAt: new Date().toISOString(), state: "unavailable", reasonCode: error instanceof ScreeningSourceError ? error.code : "UNEXPECTED_PROBE_ERROR" };
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = 1;
}
