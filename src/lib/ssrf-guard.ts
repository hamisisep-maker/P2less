import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

// ─────────────────────────────────────────────────────────────────────────────
// Blocks server-side requests to loopback/private/link-local/reserved
// addresses. A tenant-supplied connector baseUrl is otherwise a textbook
// SSRF: the server fetches whatever URL the tenant configured, with the
// server's own network identity — reachable via the self-serve manual
// connector form AND the OpenAPI-import/marketplace path. Confirmed real via
// 2026-08-23 stress-test review (#31): baseUrl was validated only as
// z.string().url() — any syntactically valid URL, no host restriction.
//
// Checks the RESOLVED IP, not the hostname string, specifically to defeat
// DNS rebinding (a hostname resolving to a public IP at some other time but
// a private one right now) — and is called at EXECUTION time, immediately
// before every real fetch (safeFetch below), not just once at connector-
// creation time, since DNS can change between configuration and use.
// safeFetch also re-validates every redirect hop for the same reason an
// allowlisted host returning a 302 to 169.254.169.254 would otherwise defeat
// a one-time check.
//
// IP PINNING (2026-08-24) — closes the TOCTOU gap left open (and honestly
// documented as such) when this file first shipped: a plain
// "assertSafeUrl(url) then fetch(url)" does TWO separate DNS resolutions a
// few milliseconds apart. A malicious or compromised DNS answer could
// legitimately differ between them — return a safe public IP for the check,
// then a private one for fetch()'s own later lookup. safeFetch now resolves
// each hop's hostname EXACTLY ONCE, validates that specific address, and
// connects DIRECTLY to it via Node's documented `lookup` request option
// (pinnedRequest below) — no second resolution ever happens. The ORIGINAL
// hostname is still used for the Host header and TLS SNI/certificate
// validation, so this doesn't break name-based virtual hosting or weaken
// HTTPS cert checking — only the raw socket destination is pinned.
// ─────────────────────────────────────────────────────────────────────────────

function isDisallowedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → reject
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast and above (incl. reserved)
  return false;
}

function isDisallowedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isDisallowedIPv4(mapped[1]);
  return false;
}

function isDisallowedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return isDisallowedIPv4(ip);
  if (type === 6) return isDisallowedIPv6(ip);
  return true; // not a recognizable IP → reject rather than guess
}

function isLoopback(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return ip.split(".")[0] === "127";
  if (type === 6) return ip.toLowerCase() === "::1";
  return false;
}

export class UnsafeUrlError extends Error {}

/** Resolves `hostname` to every address it currently has and validates each
 *  one — shared by assertSafeUrl (a one-time check, e.g. at connector-save
 *  time) and resolvePinnedAddress (execution-time, feeding pinnedRequest).
 *  Throws on any disallowed address; never returns an empty list. */
async function resolveAndValidate(hostname: string, isProd: boolean): Promise<string[]> {
  const directType = net.isIP(hostname);
  const addresses = directType
    ? [hostname]
    : hostname === "localhost"
      ? ["127.0.0.1"]
      : await dns.lookup(hostname, { all: true }).then(
          (records) => records.map((r) => r.address),
          () => { throw new UnsafeUrlError("Could not resolve host."); },
        );
  if (addresses.length === 0) throw new UnsafeUrlError("Could not resolve host.");
  for (const addr of addresses) {
    if (isLoopback(addr) && !isProd) continue;
    if (isDisallowedIp(addr)) throw new UnsafeUrlError("This address is not allowed (private, loopback, or link-local network).");
  }
  return addresses;
}

function parseHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError("Only http/https URLs are allowed.");
  }
  return parsed;
}

/** Throws UnsafeUrlError if `url` is not safe for the SERVER to fetch on a
 *  tenant's behalf. Resolves DNS and checks every returned address — a
 *  hostname can resolve to multiple IPs; any disallowed one is a reject.
 *  A one-time check (e.g. at connector-save time, or website-crawl.ts's
 *  pre-check) — does NOT pin anything, so it does not by itself close the
 *  DNS-rebinding gap; safeFetch's pinnedRequest is what actually does. */
export async function assertSafeUrl(url: string): Promise<void> {
  const parsed = parseHttpUrl(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  // Loopback is blocked in production, but deliberately allowed outside it —
  // the seeded demo connectors (Kilimani Retail, Hamzone, Nairobi Hospital)
  // intentionally call back into this same app's own /api/demo-* routes,
  // which resolve to a real public Railway URL in production but to
  // localhost in local dev/test. Every OTHER private/link-local/reserved
  // range stays blocked in every environment.
  await resolveAndValidate(hostname, process.env.NODE_ENV === "production");
}

/** Resolves + validates `hostname` ONCE and returns a single address to pin
 *  the actual connection to (the first valid one — deterministic, same as
 *  how DNS resolution ordinarily picks). Callers must not re-resolve after
 *  this; that's exactly the gap pinning exists to close. */
async function resolvePinnedAddress(hostname: string): Promise<string> {
  const addresses = await resolveAndValidate(hostname, process.env.NODE_ENV === "production");
  return addresses[0];
}

function normalizeHeaders(h?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => { out[k] = v; });
  return out;
}

/** Issues ONE real HTTP(S) request to a PRE-VALIDATED, PINNED IP address —
 *  no second DNS resolution happens at all, closing the TOCTOU window a
 *  plain "check, then fetch()" leaves open. The ORIGINAL hostname is still
 *  used for the Host header and TLS SNI/certificate validation (via
 *  `hostname` below, left untouched) — only the raw socket destination is
 *  overridden, via Node's documented `lookup` request option. Supports only
 *  what this codebase's real callers actually send (a string body or none;
 *  no streams/FormData) — deliberately narrow, not a general fetch
 *  replacement. */
function pinnedRequest(
  url: URL,
  pinnedIp: string,
  init: { method?: string; headers?: HeadersInit; body?: string; signal?: AbortSignal },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;
    const headers = normalizeHeaders(init.headers);
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: init.method || "GET",
        headers,
        // Node's Happy Eyeballs (autoSelectFamily, on by default) sometimes
        // calls `lookup` with `{ all: true }`, expecting the ARRAY-shaped
        // dns.lookup callback (err, addresses[]) instead of the single-address
        // (err, address, family) shape — found live via debug-pin: passing
        // only the single-address shape produced a real
        // ERR_INVALID_IP_ADDRESS on every request. Honor both shapes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node's
        // dns.LookupFunction type doesn't capture the dual (all: true) vs
        // single-address callback shape; see comment above.
        lookup: ((_hostname: string, opts: any, cb: any) => {
          const callback = typeof opts === "function" ? opts : cb;
          const wantsAll = typeof opts === "object" && opts?.all;
          const family = net.isIPv6(pinnedIp) ? 6 : 4;
          if (wantsAll) callback(null, [{ address: pinnedIp, family }]);
          else callback(null, pinnedIp, family);
        }) as unknown as http.RequestOptions["lookup"],
        signal: init.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((vv) => responseHeaders.append(k, vv));
            else if (v !== undefined) responseHeaders.set(k, v);
          }
          resolve(new Response(body.length ? body : null, { status: res.statusCode ?? 502, statusText: res.statusMessage, headers: responseHeaders }));
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (init.body) req.end(init.body);
    else req.end();
  });
}

/** fetch()-compatible: validates the target AND every redirect hop, and —
 *  unlike a plain fetch() — connects to the exact address it just validated
 *  rather than letting the transport re-resolve the hostname a moment
 *  later. */
export async function safeFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}, maxRedirects = 5): Promise<Response> {
  const { timeoutMs, method, headers, body } = init;
  if (body !== undefined && typeof body !== "string") {
    throw new UnsafeUrlError("safeFetch only supports a string body or none.");
  }
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const parsed = parseHttpUrl(currentUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const pinnedIp = await resolvePinnedAddress(hostname);
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await pinnedRequest(parsed, pinnedIp, { method, headers, body, signal: controller.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      currentUrl = new URL(res.headers.get("location")!, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError("Too many redirects.");
}
