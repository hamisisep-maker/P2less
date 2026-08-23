import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

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

/** Throws UnsafeUrlError if `url` is not safe for the SERVER to fetch on a
 *  tenant's behalf. Resolves DNS and checks every returned address — a
 *  hostname can resolve to multiple IPs; any disallowed one is a reject. */
export async function assertSafeUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError("Only http/https URLs are allowed.");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  // Loopback is blocked in production, but deliberately allowed outside it —
  // the seeded demo connectors (Kilimani Retail, Hamzone, Nairobi Hospital)
  // intentionally call back into this same app's own /api/demo-* routes,
  // which resolve to a real public Railway URL in production but to
  // localhost in local dev/test. Every OTHER private/link-local/reserved
  // range stays blocked in every environment.
  const isProd = process.env.NODE_ENV === "production";

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
}

/** fetch() that validates the target AND every redirect hop against
 *  assertSafeUrl before following it. */
export async function safeFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}, maxRedirects = 5): Promise<Response> {
  const { timeoutMs, ...restInit } = init;
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(currentUrl);
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await fetch(currentUrl, { ...restInit, redirect: "manual", signal: controller.signal });
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
