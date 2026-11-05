import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { isAddress } from "viem";

export const OFAC_SDN_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
export const OFAC_SOURCE_ID = "ofac-sdn-ethereum-addresses";
export const SOURCE_REFRESH_MS = 60 * 60 * 1_000;
export const MAX_SOURCE_AGE_MS = 2 * SOURCE_REFRESH_MS;
export const DECISION_TTL_MS = 2 * 60 * 1_000;
export const MAX_SOURCE_BYTES = 50 * 1_024 * 1_024;
export const COVERAGE_POLICY = "published-ethereum-identifiers-exact-evm-address-match";

export interface ScreeningCoverage {
  policy: typeof COVERAGE_POLICY;
  sourceNamespace: "ETH";
  targetChainId: 1874;
  matchMethod: "exact-address-text";
  indirectExposure: false;
  ownershipAttribution: false;
}

export const SCREENING_COVERAGE: Readonly<ScreeningCoverage> = Object.freeze({
  policy: COVERAGE_POLICY,
  sourceNamespace: "ETH",
  targetChainId: 1874,
  matchMethod: "exact-address-text",
  indirectExposure: false,
  ownershipAttribution: false,
});

export interface SourceSnapshot {
  sourceId: typeof OFAC_SOURCE_ID;
  sourceUrl: typeof OFAC_SDN_URL;
  sha256: string;
  fetchedAt: string;
  publishedAt: string | null;
  coverage: ScreeningCoverage;
  addresses: string[];
  entryCount: number;
  recordCount: number;
}

export interface ProviderHealth {
  state: "available" | "unavailable";
  checkedAt: string;
  reasonCode?: string;
}

export type ScreeningState = "allowed" | "blocked" | "review_required" | "unavailable";

export type ReasonCode =
  | "INVALID_ADDRESS"
  | "INTERNAL_HARD_DENIAL"
  | "OFFICIAL_ADDRESS_MATCH"
  | "REQUIRED_SOURCE_UNAVAILABLE"
  | "SOURCE_MISSING"
  | "SOURCE_INVALID"
  | "SOURCE_STALE"
  | "SOURCE_FROM_FUTURE"
  | "HEALTH_INVALID"
  | "HEALTH_STALE"
  | "POLICY_INVALID"
  | "UNSUPPORTED_COVERAGE"
  | "PASSED_CONFIGURED_CHECKS";

export interface ScreeningDecision {
  state: ScreeningState;
  address: string | null;
  reasonCodes: ReasonCode[];
  checkedAt: string;
  expiresAt: string;
  policyVersion: "direct-list-v1";
  sourceId: typeof OFAC_SOURCE_ID;
  sourceUrl: typeof OFAC_SDN_URL;
  sourceHash: string | null;
  sourceFetchedAt: string | null;
  sourceAgeMs: number | null;
  coverage: ScreeningCoverage;
}

export type SourceErrorCode =
  | "SOURCE_URL_NOT_ALLOWED"
  | "SOURCE_REDIRECT_NOT_ALLOWED"
  | "SOURCE_TIMEOUT"
  | "SOURCE_FETCH_FAILED"
  | "SOURCE_HTTP_ERROR"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_ENCODING_INVALID"
  | "SOURCE_XML_UNSAFE"
  | "SOURCE_XML_INVALID"
  | "SOURCE_SCHEMA_INVALID"
  | "SOURCE_RECORD_COUNT_MISMATCH"
  | "SOURCE_ADDRESSES_EMPTY"
  | "SOURCE_ADDRESS_INVALID"
  | "SOURCE_DATE_INVALID"
  | "SOURCE_DATE_FROM_FUTURE";

/** Safe to record as an operational code; never contains source data or redirect URLs. */
export class ScreeningSourceError extends Error {
  readonly code: SourceErrorCode;

  constructor(code: SourceErrorCode) {
    super(code);
    this.name = "ScreeningSourceError";
    this.code = code;
  }
}

function sourceError(code: SourceErrorCode): never {
  throw new ScreeningSourceError(code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

export function normalizeWalletAddress(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  return isAddress(value, { strict: false }) ? value.toLowerCase() : null;
}

function validTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parsePublicationDate(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return sourceError("SOURCE_DATE_INVALID");
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return sourceError("SOURCE_DATE_INVALID");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return sourceError("SOURCE_DATE_INVALID");
  }
  return date.toISOString();
}

export interface ParseSourceOptions {
  fetchedAt: Date;
  now?: Date;
  sourceUrl?: string;
  maxBytes?: number;
}

/** Parse a complete official legacy SDN XML snapshot; never publish partially parsed lists. */
export function parseOfacSnapshot(xml: string, options: ParseSourceOptions): SourceSnapshot {
  const sourceUrl = options.sourceUrl ?? OFAC_SDN_URL;
  if (sourceUrl !== OFAC_SDN_URL) return sourceError("SOURCE_URL_NOT_ALLOWED");
  const fetchedMs = options.fetchedAt.getTime();
  const nowMs = (options.now ?? options.fetchedAt).getTime();
  if (!Number.isFinite(fetchedMs) || !Number.isFinite(nowMs)) return sourceError("SOURCE_DATE_INVALID");
  if (fetchedMs > nowMs) return sourceError("SOURCE_DATE_FROM_FUTURE");
  const maxBytes = Math.min(options.maxBytes ?? MAX_SOURCE_BYTES, MAX_SOURCE_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || Buffer.byteLength(xml, "utf8") > maxBytes) {
    return sourceError("SOURCE_TOO_LARGE");
  }
  // Reject declarations before either validator/parser sees them, including internal entity expansion.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return sourceError("SOURCE_XML_UNSAFE");
  if (XMLValidator.validate(xml) !== true) return sourceError("SOURCE_XML_INVALID");
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    processEntities: false,
  });
  let document: unknown;
  try {
    document = parser.parse(xml) as unknown;
  } catch {
    return sourceError("SOURCE_XML_INVALID");
  }
  const root = asRecord(asRecord(document)?.sdnList);
  const publication = asRecord(root?.publshInformation);
  const recordCountText = publication?.Record_Count;
  if (!root || !publication || typeof recordCountText !== "string" || !/^\d+$/.test(recordCountText)) {
    return sourceError("SOURCE_SCHEMA_INVALID");
  }
  const recordCount = Number(recordCountText);
  const entries = asArray(root.sdnEntry);
  if (!Number.isSafeInteger(recordCount) || recordCount < 1 || entries.length !== recordCount) {
    return sourceError("SOURCE_RECORD_COUNT_MISMATCH");
  }
  const publishedAt = parsePublicationDate(publication.Publish_Date);
  if (publishedAt !== null && Date.parse(publishedAt) > nowMs) return sourceError("SOURCE_DATE_FROM_FUTURE");

  const addresses = new Set<string>();
  let entryCount = 0;
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record || typeof record.uid !== "string" || !/^\d+$/.test(record.uid)) {
      return sourceError("SOURCE_SCHEMA_INVALID");
    }
    const idList = asRecord(record.idList);
    for (const identity of asArray(idList?.id)) {
      const id = asRecord(identity);
      if (!id || typeof id.idType !== "string") return sourceError("SOURCE_SCHEMA_INVALID");
      if (id.idType.toUpperCase() !== "DIGITAL CURRENCY ADDRESS - ETH") continue;
      const normalized = normalizeWalletAddress(id.idNumber);
      if (!normalized) return sourceError("SOURCE_ADDRESS_INVALID");
      entryCount += 1;
      addresses.add(normalized);
    }
  }
  if (entryCount === 0 || addresses.size === 0) return sourceError("SOURCE_ADDRESSES_EMPTY");
  return {
    sourceId: OFAC_SOURCE_ID,
    sourceUrl: OFAC_SDN_URL,
    sha256: createHash("sha256").update(xml, "utf8").digest("hex"),
    fetchedAt: options.fetchedAt.toISOString(),
    publishedAt,
    coverage: { ...SCREENING_COVERAGE },
    addresses: [...addresses].sort(),
    entryCount,
    recordCount,
  };
}

export interface ImportSourceOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
}

const TREASURY_PUBLIC_BUCKET = "wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com";

function approvedDownloadRedirect(url: URL): boolean {
  return url.protocol === "https:" && url.hostname === TREASURY_PUBLIC_BUCKET &&
    (url.port === "" || url.port === "443") && !url.username && !url.password && !url.hash &&
    url.pathname.startsWith("/Published/") && url.pathname.endsWith("/SDN.XML");
}

async function downloadText(response: Response, maxBytes: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel();
    return sourceError("SOURCE_TOO_LARGE");
  }
  if (!response.body) return sourceError("SOURCE_FETCH_FAILED");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteCount += chunk.value.byteLength;
      if (byteCount > maxBytes) return sourceError("SOURCE_TOO_LARGE");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ScreeningSourceError) throw error;
    if (error instanceof TypeError) return sourceError("SOURCE_ENCODING_INVALID");
    throw error;
  } finally {
    reader.releaseLock();
  }
  return text;
}

/** Fetches only the fixed publisher URL, with at most its official dedicated-bucket redirect. */
export async function importCurrentOfac(options: ImportSourceOptions = {}): Promise<SourceSnapshot> {
  const fetchSource = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxBytes = Math.min(options.maxBytes ?? MAX_SOURCE_BYTES, MAX_SOURCE_BYTES);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0) return sourceError("SOURCE_FETCH_FAILED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchSource(OFAC_SDN_URL, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/xml, text/xml" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return sourceError("SOURCE_REDIRECT_NOT_ALLOWED");
      let destination: URL;
      try {
        destination = new URL(location, OFAC_SDN_URL);
      } catch {
        return sourceError("SOURCE_REDIRECT_NOT_ALLOWED");
      }
      if (!approvedDownloadRedirect(destination)) return sourceError("SOURCE_REDIRECT_NOT_ALLOWED");
      await response.body?.cancel();
      response = await fetchSource(destination, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "application/xml, text/xml" },
      });
    }
    if (response.status >= 300 && response.status < 400) return sourceError("SOURCE_REDIRECT_NOT_ALLOWED");
    if (!response.ok) return sourceError("SOURCE_HTTP_ERROR");
    if (response.redirected) return sourceError("SOURCE_REDIRECT_NOT_ALLOWED");
    const xml = await downloadText(response, maxBytes);
    const fetchedAt = now();
    return parseOfacSnapshot(xml, { fetchedAt, now: fetchedAt, maxBytes });
  } catch (error) {
    if (controller.signal.aborted) return sourceError("SOURCE_TIMEOUT");
    if (error instanceof ScreeningSourceError) throw error;
    return sourceError("SOURCE_FETCH_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

export interface EvaluateWalletOptions {
  address: string;
  snapshot: SourceSnapshot | null;
  providerHealth: ProviderHealth;
  now?: Date;
  maxSourceAgeMs?: number;
  decisionTtlMs?: number;
  internalDenials?: readonly string[];
}

function coverageMatches(value: unknown): boolean {
  const coverage = asRecord(value);
  return coverage !== null && coverage.policy === COVERAGE_POLICY && coverage.sourceNamespace === "ETH" &&
    coverage.targetChainId === 1874 && coverage.matchMethod === "exact-address-text" &&
    coverage.indirectExposure === false && coverage.ownershipAttribution === false;
}

/** A no-match result means passed configured checks, not clean/lawful funds or source-of-funds tracing. */
export function evaluateWallet(options: EvaluateWalletOptions): ScreeningDecision {
  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("Screening clock is invalid");
  const maxAgeMs = options.maxSourceAgeMs ?? MAX_SOURCE_AGE_MS;
  const decisionTtlMs = options.decisionTtlMs ?? DECISION_TTL_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > MAX_SOURCE_AGE_MS ||
      !Number.isFinite(decisionTtlMs) || decisionTtlMs <= 0 || decisionTtlMs > DECISION_TTL_MS) {
    throw new TypeError("Screening freshness policy exceeds the permitted bounds");
  }
  const address = normalizeWalletAddress(options.address);
  const snapshot = options.snapshot;
  const fetchedMs = snapshot ? validTime(snapshot.fetchedAt) : null;
  const sourceAgeMs = fetchedMs !== null ? nowMs - fetchedMs : null;
  const result = (state: ScreeningState, reason: ReasonCode, expiresMs = nowMs): ScreeningDecision => ({
    state,
    address,
    reasonCodes: [reason],
    checkedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    policyVersion: "direct-list-v1",
    sourceId: OFAC_SOURCE_ID,
    sourceUrl: OFAC_SDN_URL,
    sourceHash: snapshot?.sha256 ?? null,
    sourceFetchedAt: snapshot?.fetchedAt ?? null,
    sourceAgeMs,
    coverage: { ...SCREENING_COVERAGE },
  });
  if (!address) return result("review_required", "INVALID_ADDRESS");
  const denials = options.internalDenials ?? [];
  if (denials.some((denial) => normalizeWalletAddress(denial) === null)) return result("unavailable", "POLICY_INVALID");
  if (denials.some((denial) => normalizeWalletAddress(denial) === address)) {
    return result("blocked", "INTERNAL_HARD_DENIAL");
  }
  if (options.providerHealth.state !== "available") return result("unavailable", "REQUIRED_SOURCE_UNAVAILABLE");
  const healthMs = validTime(options.providerHealth.checkedAt);
  if (healthMs === null || healthMs > nowMs) return result("unavailable", "HEALTH_INVALID");
  if (nowMs - healthMs >= maxAgeMs) return result("unavailable", "HEALTH_STALE");
  if (!snapshot) return result("unavailable", "SOURCE_MISSING");
  if (snapshot.sourceId !== OFAC_SOURCE_ID || snapshot.sourceUrl !== OFAC_SDN_URL ||
      !/^[0-9a-f]{64}$/.test(snapshot.sha256) || fetchedMs === null ||
      !Array.isArray(snapshot.addresses) || snapshot.addresses.length === 0 ||
      !Number.isSafeInteger(snapshot.entryCount) || snapshot.entryCount < snapshot.addresses.length ||
      !Number.isSafeInteger(snapshot.recordCount) || snapshot.recordCount < 1 ||
      snapshot.addresses.some((entry) => normalizeWalletAddress(entry) !== entry)) {
    return result("unavailable", "SOURCE_INVALID");
  }
  if (!coverageMatches(snapshot.coverage)) return result("unavailable", "UNSUPPORTED_COVERAGE");
  if (fetchedMs > nowMs) return result("unavailable", "SOURCE_FROM_FUTURE");
  if (sourceAgeMs !== null && sourceAgeMs >= maxAgeMs) return result("unavailable", "SOURCE_STALE");
  if (snapshot.publishedAt !== null) {
    const publishedMs = validTime(snapshot.publishedAt);
    if (publishedMs === null || publishedMs > fetchedMs) return result("unavailable", "SOURCE_INVALID");
  }
  if (snapshot.addresses.includes(address)) return result("blocked", "OFFICIAL_ADDRESS_MATCH");
  return result("allowed", "PASSED_CONFIGURED_CHECKS", Math.min(nowMs + decisionTtlMs, fetchedMs + maxAgeMs));
}
