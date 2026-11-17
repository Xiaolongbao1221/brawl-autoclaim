const STORE_URL = "https://store.supercell.com/fr/brawlstars";
const CLAIM_URL = "https://store.supercell.com/api/v4/brawlstars/offer/claim";
const FREE_SKU = /com\.supercell\.laser\.scid\.specialoffertier0\.free:chronos:\d+-\d+:\d+/g;
const ACCOUNT_ID = /accountId(?:\\?"|&quot;)?\s*:\s*(?:\\?"|&quot;)[\w-]/;
const REQUEST_TIMEOUT_MS = 20_000;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

type Fetch = typeof fetch;
type Mode = "status" | "claim";
type ClaimResult = "claimed" | "already-claimed" | "rejected" | "unknown";
type Environment = Record<string, string | undefined>;
type LogLevel = "info" | "error";

function log(level: LogLevel, message: string): void {
  const entry = `${JSON.stringify({ level, message })}\n`;
  (level === "error" ? process.stderr : process.stdout).write(entry);
}

export function findDailySkus(html: string): string[] {
  return [...new Set(html.match(FREE_SKU) ?? [])];
}

function hasValidQuota(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (!("quotaConsumed" in value) || !("quotaLimit" in value)) return false;
  const { quotaConsumed, quotaLimit } = value;
  return typeof quotaConsumed === "number" && Number.isInteger(quotaConsumed) &&
    typeof quotaLimit === "number" && Number.isInteger(quotaLimit) &&
    quotaConsumed > 0 && quotaLimit >= quotaConsumed;
}

export function classifyClaim(status: number, body: unknown): ClaimResult {
  if (status === HTTP_BAD_REQUEST || status === HTTP_CONFLICT) return "rejected";
  if (status !== HTTP_OK || !Array.isArray(body)) return "unknown";
  if (body.length === 0) return "already-claimed";
  if (body.length !== 1) return "unknown";
  const item: unknown = body[0];
  if (typeof item !== "object" || item === null || !("result" in item)) return "unknown";
  return hasValidQuota(item.result) ? "claimed" : "unknown";
}

function cookieHeader(env: Environment): string {
  const locale = env.NEXT_LOCALE === undefined || env.NEXT_LOCALE === "" ? "fr" : env.NEXT_LOCALE;
  const cookies = [
    ["SESSION_COOKIE", env.SESSION_COOKIE],
    ["sc-store-q", env.SC_STORE_Q],
    ["scsso_scid", env.SCSO_SCID],
    ["NEXT_LOCALE", locale],
  ] as const;
  if (cookies.some(([, value]) => value === undefined || value === "" || /[;\r\n]/.test(value))) {
    throw new Error("Missing or invalid session configuration.");
  }
  return cookies.map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeHeaders(env: Environment): Record<string, string> {
  return {
    cookie: cookieHeader(env),
    "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
    referer: STORE_URL,
    origin: "https://store.supercell.com",
  };
}

async function fetchOffers(request: Fetch, headers: Record<string, string>): Promise<string[] | null> {
  const response = await request(STORE_URL, {
    headers, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.ok === false) {
    log("error", `Store request failed (HTTP ${response.status}).`);
    return null;
  }
  const html = await response.text();
  if (ACCOUNT_ID.test(html) === false) {
    log("error", "Could not verify the store session. Cookies may have expired or the page format may have changed.");
    return null;
  }
  const skus = findDailySkus(html);
  if (skus.length === 0) {
    log("error", "No recognized daily free offer found; it may be unavailable or the store format may have changed.");
    return null;
  }
  return skus;
}

async function readClaimResponse(response: Response): Promise<ClaimResult> {
  try {
    const body: unknown = await response.json();
    return classifyClaim(response.status, body);
  } catch {
    return classifyClaim(response.status, undefined);
  }
}

function reportClaim(result: ClaimResult, status: number): boolean {
  if (result === "claimed") {
    log("info", "A daily offer was claimed.");
    return true;
  }
  if (result === "already-claimed") {
    log("info", "A daily offer appears to have already been claimed (empty response).");
    return true;
  }
  const message = result === "rejected"
    ? `A daily offer was rejected or already claimed (HTTP ${status}); outcome is unconfirmed.`
    : `A daily offer returned an unexpected response (HTTP ${status}).`;
  log("error", message);
  return false;
}

async function claimOffer(sku: string, headers: Record<string, string>, request: Fetch): Promise<boolean> {
  try {
    const response = await request(CLAIM_URL, {
      method: "POST",
      headers: { ...headers, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ skus: [sku] }),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return reportClaim(await readClaimResponse(response), response.status);
  } catch {
    // A timeout can occur after the server processes a claim; never retry blindly.
    log("error", "Claim request failed or timed out; its outcome is unknown.");
    return false;
  }
}

async function claimOffers(skus: string[], headers: Record<string, string>, request: Fetch): Promise<number> {
  let allSucceeded = true;
  for (const sku of skus) {
    const succeeded = await claimOffer(sku, headers, request);
    if (succeeded === false) allSucceeded = false;
  }
  return allSucceeded ? 0 : 1;
}

export async function run(mode: Mode, env: Environment, request: Fetch = fetch): Promise<number> {
  try {
    const headers = storeHeaders(env);
    const skus = await fetchOffers(request, headers);
    if (skus === null) return 1;
    if (mode === "claim") return await claimOffers(skus, headers, request);
    log("info", `Found ${skus.length} matching daily free offer(s). No claims submitted.`);
    return 0;
  } catch {
    // Exceptions may contain sensitive request details.
    log("error", "Unable to run. Check session configuration and network access.");
    return 1;
  }
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command !== "claim" && command !== "status") {
    log("error", "Usage: bun src/index.ts <status|claim>");
    process.exitCode = 2;
  } else {
    process.exitCode = await run(command, process.env);
  }
}
