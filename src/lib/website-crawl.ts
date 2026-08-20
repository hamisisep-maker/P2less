import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

// Universal Platform roadmap Phase 8e (2026-08-21) — website content
// ingestion. Fetches an admin-supplied URL server-side, so this is
// genuinely new SSRF exposure in this codebase (a related, pre-existing,
// lower-urgency gap was found in connector-engine.ts while scoping this —
// same tenant-admin-supplied-URL pattern, no equivalent protection there
// today, flagged separately, not fixed here). Real protection built in from
// the start, not an afterthought: only http/https, private/reserved IP
// ranges rejected, re-validated after every redirect hop (a redirect from an
// allowed URL to an internal one is the classic bypass).

const PRIVATE_V4_RANGES: [string, number][] = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // cloud metadata range (AWS/GCP/Azure instance metadata)
  ["0.0.0.0", 8],
];

function ipv4ToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const target = ipv4ToLong(ip);
  return PRIVATE_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToLong(base) & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

async function assertSafeUrl(urlStr: string): Promise<URL> {
  const url = new URL(urlStr);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http/https URLs are allowed.");
  const hostname = url.hostname;
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isPrivateIPv4(hostname)) throw new Error("That address isn't reachable for scanning.");
    if (net.isIPv6(hostname) && isPrivateIPv6(hostname)) throw new Error("That address isn't reachable for scanning.");
    return url;
  }
  const resolved = await dns.lookup(hostname, { all: true }).catch(() => []);
  for (const a of resolved) {
    if (a.family === 4 && isPrivateIPv4(a.address)) throw new Error("That address isn't reachable for scanning.");
    if (a.family === 6 && isPrivateIPv6(a.address)) throw new Error("That address isn't reachable for scanning.");
  }
  return url;
}

/** Fetches with manual redirect handling so every hop is re-validated against
 *  the same private-IP check — following an allowed URL's redirect straight
 *  to an internal address without re-checking is the classic SSRF bypass. */
async function safeFetch(urlStr: string, maxRedirects = 3): Promise<Response> {
  let current = urlStr;
  for (let i = 0; i <= maxRedirects; i++) {
    const url = await assertSafeUrl(current);
    const res = await fetch(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "P2LessBot/1.0 (+website content ingestion for a customer's own assistant)" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}

function parseDisallow(robotsTxt: string): string[] {
  const disallow: string[] = [];
  let appliesToUs = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^user-agent:/i.test(line)) {
      appliesToUs = line.split(":")[1]?.trim() === "*"; // only the wildcard block — simplest safe default
    } else if (appliesToUs && /^disallow:/i.test(line)) {
      const path = line.split(":")[1]?.trim();
      if (path) disallow.push(path);
    }
  }
  return disallow;
}

/** Strips a page down to plain text — script/style/nav/footer/header removed,
 *  tags stripped, whitespace normalized. A simple heuristic, not a full
 *  readability engine — good enough since the AI extraction step downstream
 *  is tolerant of some remaining boilerplate. */
export function extractPageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html: string, baseUrl: URL): string[] {
  const links = new Set<string>();
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const abs = new URL(m[1], baseUrl);
      abs.hash = "";
      if (abs.protocol === "http:" || abs.protocol === "https:") links.add(abs.toString());
    } catch {
      // malformed href — skip
    }
  }
  return Array.from(links);
}

export type CrawledPage = { url: string; text: string };

/** Same-domain-only BFS crawl, robots.txt-respecting, capped in both breadth
 *  (maxPages) and depth (maxDepth) — bounds cost and keeps this from ever
 *  becoming a general-purpose crawler. Never follows an off-site link. */
export async function crawlSite(startUrl: string, opts: { maxPages?: number; maxDepth?: number } = {}): Promise<CrawledPage[]> {
  const maxPages = opts.maxPages ?? 10;
  const maxDepth = opts.maxDepth ?? 2;
  const start = await assertSafeUrl(startUrl);
  const origin = start.origin;

  let disallow: string[] = [];
  try {
    const robotsRes = await safeFetch(`${origin}/robots.txt`);
    if (robotsRes.ok) disallow = parseDisallow(await robotsRes.text());
  } catch {
    // No robots.txt, or it's unreachable — proceed without extra restrictions.
  }
  const isAllowed = (pathname: string) => !disallow.some((d) => pathname.startsWith(d));

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: start.toString(), depth: 0 }];
  const pages: CrawledPage[] = [];

  while (queue.length && pages.length < maxPages) {
    const next = queue.shift()!;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    let url: URL;
    try {
      url = new URL(next.url);
    } catch {
      continue;
    }
    if (url.origin !== origin || !isAllowed(url.pathname)) continue;

    let res: Response;
    try {
      res = await safeFetch(next.url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) continue;

    const html = await res.text();
    const text = extractPageText(html).slice(0, 3000); // cap per-page, bounds total prompt size downstream
    if (text) pages.push({ url: next.url, text });

    if (next.depth < maxDepth) {
      for (const href of extractLinks(html, url)) {
        if (!visited.has(href)) queue.push({ url: href, depth: next.depth + 1 });
      }
    }
  }
  return pages;
}
