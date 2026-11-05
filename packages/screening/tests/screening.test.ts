import { describe, expect, it, vi } from "vitest";
import {
  COVERAGE_POLICY,
  DECISION_TTL_MS,
  MAX_SOURCE_AGE_MS,
  OFAC_SDN_URL,
  evaluateWallet,
  importCurrentOfac,
  normalizeWalletAddress,
  parseOfacSnapshot,
  type SourceSnapshot,
} from "../src/index.js";

// Synthetic addresses only. No real flagged counterparty appears in the tests.
const denied = "0x1111111111111111111111111111111111111111";
const allowed = "0x2222222222222222222222222222222222222222";
const clock = new Date("2026-11-06T10:00:00.000Z");
const health = { state: "available" as const, checkedAt: clock.toISOString() };

function xml(body = `<id><uid>3</uid><idType>Digital Currency Address - ETH</idType><idNumber>${denied}</idNumber></id>`, count = 1) {
  return `<?xml version="1.0"?><sdnList xmlns="https://example.invalid/schema"><publshInformation><Publish_Date>11/05/2026</Publish_Date><Record_Count>${count}</Record_Count></publshInformation><sdnEntry><uid>1</uid><idList>${body}</idList></sdnEntry></sdnList>`;
}

function snapshot(): SourceSnapshot {
  return parseOfacSnapshot(xml(), { fetchedAt: clock });
}

function fetchMock(responses: Response[]) {
  return vi.fn<typeof fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch in test");
    return response;
  });
}

describe("official source parser", () => {
  it("records complete source provenance and extracts only explicit ETH identifiers", () => {
    const source = parseOfacSnapshot(xml(`<id><idType>Digital Currency Address - ETH</idType><idNumber>${denied}</idNumber></id><id><idType>Digital Currency Address - TRX</idType><idNumber>not-an-evm-address</idNumber></id>`), { fetchedAt: clock });
    expect(source.addresses).toEqual([denied]);
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.sourceUrl).toBe(OFAC_SDN_URL);
    expect(source.publishedAt).toBe("2026-11-05T00:00:00.000Z");
    expect(source.entryCount).toBe(1);
    expect(source.recordCount).toBe(1);
    expect(source.coverage).toMatchObject({ policy: COVERAGE_POLICY, ownershipAttribution: false, indirectExposure: false });
  });

  it("deduplicates identifiers without losing source occurrence count", () => {
    const id = `<id><idType>Digital Currency Address - ETH</idType><idNumber>${denied}</idNumber></id>`;
    const source = parseOfacSnapshot(xml(id + id), { fetchedAt: clock });
    expect(source.addresses).toEqual([denied]);
    expect(source.entryCount).toBe(2);
  });

  it.each([
    ["<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///private'>]>" + xml(), "SOURCE_XML_UNSAFE"],
    ["<!ENTITY e 'expansion'>" + xml(), "SOURCE_XML_UNSAFE"],
    [xml().replace("</sdnList>", ""), "SOURCE_XML_INVALID"],
    [xml("", 1), "SOURCE_ADDRESSES_EMPTY"],
    [xml(undefined, 2), "SOURCE_RECORD_COUNT_MISMATCH"],
    [xml().replace(denied, "0xnot-an-address"), "SOURCE_ADDRESS_INVALID"],
    [xml().replace("11/05/2026", "02/31/2026"), "SOURCE_DATE_INVALID"],
    [xml().replace("11/05/2026", "11/07/2026"), "SOURCE_DATE_FROM_FUTURE"],
  ])("rejects unsafe, partial or unsupported source data (%s)", (source, code) => {
    expect(() => parseOfacSnapshot(source, { fetchedAt: clock })).toThrow(code);
  });

  it("rejects nonpublisher provenance, oversized XML and a future fetch clock", () => {
    expect(() => parseOfacSnapshot(xml(), { fetchedAt: clock, sourceUrl: "https://example.invalid/list.xml" })).toThrow("SOURCE_URL_NOT_ALLOWED");
    expect(() => parseOfacSnapshot(xml(), { fetchedAt: clock, maxBytes: 50 })).toThrow("SOURCE_TOO_LARGE");
    expect(() => parseOfacSnapshot(xml(), { fetchedAt: new Date(clock.getTime() + 1), now: clock })).toThrow("SOURCE_DATE_FROM_FUTURE");
  });
});

describe("deterministic wallet policy", () => {
  it("allows no-match only for current required evidence and accurately labels coverage", () => {
    const decision = evaluateWallet({ address: allowed, snapshot: snapshot(), providerHealth: health, now: clock });
    expect(decision.state).toBe("allowed");
    expect(decision.reasonCodes).toEqual(["PASSED_CONFIGURED_CHECKS"]);
    expect(decision.expiresAt).toBe(new Date(clock.getTime() + DECISION_TTL_MS).toISOString());
    expect(decision.coverage).toMatchObject({ targetChainId: 1874, indirectExposure: false, ownershipAttribution: false });
  });

  it("blocks official matches and independent internal hard denials", () => {
    expect(evaluateWallet({ address: denied, snapshot: snapshot(), providerHealth: health, now: clock })).toMatchObject({ state: "blocked", reasonCodes: ["OFFICIAL_ADDRESS_MATCH"] });
    expect(evaluateWallet({ address: allowed, snapshot: null, providerHealth: { state: "unavailable", checkedAt: clock.toISOString() }, internalDenials: [allowed], now: clock })).toMatchObject({ state: "blocked", reasonCodes: ["INTERNAL_HARD_DENIAL"] });
  });

  it("does not allow on a previous good snapshot when the required provider is unavailable", () => {
    expect(evaluateWallet({ address: allowed, snapshot: snapshot(), providerHealth: { ...health, state: "unavailable" }, now: clock })).toMatchObject({ state: "unavailable", reasonCodes: ["REQUIRED_SOURCE_UNAVAILABLE"] });
  });

  it("fails closed at the source age boundary and bounds decision expiry by evidence", () => {
    const stale = { ...snapshot(), fetchedAt: new Date(clock.getTime() - MAX_SOURCE_AGE_MS).toISOString() };
    expect(evaluateWallet({ address: allowed, snapshot: stale, providerHealth: health, now: clock })).toMatchObject({ state: "unavailable", reasonCodes: ["SOURCE_STALE"] });
    const nearExpiry = { ...stale, fetchedAt: new Date(clock.getTime() - MAX_SOURCE_AGE_MS + 30_000).toISOString() };
    expect(evaluateWallet({ address: allowed, snapshot: nearExpiry, providerHealth: health, now: clock }).expiresAt).toBe(new Date(clock.getTime() + 30_000).toISOString());
  });

  it("rejects invalid address, absent/empty/malformed snapshot, future data and unsupported coverage", () => {
    const base = snapshot();
    const evaluate = (source: SourceSnapshot | null) => evaluateWallet({ address: allowed, snapshot: source, providerHealth: health, now: clock });
    expect(evaluate(null).reasonCodes).toEqual(["SOURCE_MISSING"]);
    expect(evaluate({ ...base, addresses: [] }).reasonCodes).toEqual(["SOURCE_INVALID"]);
    expect(evaluate({ ...base, sha256: "not-a-hash" }).reasonCodes).toEqual(["SOURCE_INVALID"]);
    expect(evaluate({ ...base, fetchedAt: new Date(clock.getTime() + 1).toISOString() }).reasonCodes).toEqual(["SOURCE_FROM_FUTURE"]);
    expect(evaluate({ ...base, coverage: { ...base.coverage, targetChainId: 1 } as unknown as SourceSnapshot["coverage"] }).reasonCodes).toEqual(["UNSUPPORTED_COVERAGE"]);
    expect(evaluate({ ...base, coverage: undefined as unknown as SourceSnapshot["coverage"] }).reasonCodes).toEqual(["UNSUPPORTED_COVERAGE"]);
    expect(evaluateWallet({ address: "not-a-wallet", snapshot: base, providerHealth: health, now: clock })).toMatchObject({ state: "review_required", reasonCodes: ["INVALID_ADDRESS"] });
    expect(normalizeWalletAddress("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("rejects stale/future health and policies that broaden freshness", () => {
    expect(evaluateWallet({ address: allowed, snapshot: snapshot(), providerHealth: { ...health, checkedAt: "not-a-date" }, now: clock }).reasonCodes).toEqual(["HEALTH_INVALID"]);
    expect(evaluateWallet({ address: allowed, snapshot: snapshot(), providerHealth: { ...health, checkedAt: new Date(clock.getTime() - MAX_SOURCE_AGE_MS).toISOString() }, now: clock }).reasonCodes).toEqual(["HEALTH_STALE"]);
    expect(() => evaluateWallet({ address: allowed, snapshot: snapshot(), providerHealth: health, now: clock, decisionTtlMs: DECISION_TTL_MS + 1 })).toThrow("Screening freshness policy");
    expect(evaluateWallet({ address: allowed, snapshot: snapshot(), providerHealth: health, now: clock, internalDenials: ["invalid-policy-entry"] }).reasonCodes).toEqual(["POLICY_INVALID"]);
  });
});

describe("bounded official download", () => {
  it("fetches the fixed publisher URL with manual redirects and parses a direct XML response", async () => {
    const fetch = fetchMock([new Response(xml(), { headers: { "content-type": "text/xml" } })]);
    const source = await importCurrentOfac({ fetch, now: () => clock });
    expect(source.addresses).toEqual([denied]);
    expect(fetch).toHaveBeenCalledWith(OFAC_SDN_URL, expect.objectContaining({ redirect: "manual" }));
  });

  it("permits only the publisher's dedicated public-bucket redirect and never stores its signed URL", async () => {
    const location = "https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/Published/test/SDN.XML?X-Amz-Signature=synthetic";
    const fetch = fetchMock([new Response(null, { status: 302, headers: { location } }), new Response(xml())]);
    const source = await importCurrentOfac({ fetch, now: () => clock });
    expect(source.sourceUrl).toBe(OFAC_SDN_URL);
    expect(JSON.stringify(source)).not.toContain("X-Amz");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://127.0.0.1/SDN.XML",
    "https://169.254.169.254/Published/SDN.XML",
    "https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com.evil.invalid/Published/x/SDN.XML",
    "https://user:password@wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/Published/x/SDN.XML",
    "https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/other/SDN.XML",
  ])("rejects unsafe redirect %s", async (location) => {
    const fetch = fetchMock([new Response(null, { status: 302, headers: { location } })]);
    await expect(importCurrentOfac({ fetch, now: () => clock })).rejects.toThrow("SOURCE_REDIRECT_NOT_ALLOWED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects redirect chains, HTTP errors and oversized chunked bodies", async () => {
    const location = "https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/Published/x/SDN.XML";
    await expect(importCurrentOfac({ fetch: fetchMock([new Response(null, { status: 302, headers: { location } }), new Response(null, { status: 302, headers: { location } })]), now: () => clock })).rejects.toThrow("SOURCE_REDIRECT_NOT_ALLOWED");
    await expect(importCurrentOfac({ fetch: fetchMock([new Response(null, { status: 503 })]) })).rejects.toThrow("SOURCE_HTTP_ERROR");
    await expect(importCurrentOfac({ fetch: fetchMock([new Response(xml())]), maxBytes: 64 })).rejects.toThrow("SOURCE_TOO_LARGE");
  });

  it("turns a network failure into a safe code and aborts stalled downloads", async () => {
    const failingFetch = vi.fn<typeof fetch>(async () => { throw new Error("provider details must not escape"); });
    await expect(importCurrentOfac({ fetch: failingFetch })).rejects.toThrow("SOURCE_FETCH_FAILED");
    const stalledFetch = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await expect(importCurrentOfac({ fetch: stalledFetch, timeoutMs: 5 })).rejects.toThrow("SOURCE_TIMEOUT");
  });
});
