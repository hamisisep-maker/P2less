import "server-only";
import { assertSafeUrl, safeFetch as guardedFetch } from "./ssrf-guard";

// Universal Platform roadmap Phase 8e (2026-08-21) — website content
// ingestion. Fetches an admin-supplied URL server-side — real SSRF exposure,
// protected from the start, not an afterthought.
//
// UNIFIED with ssrf-guard.ts (2026-08-24), not left as its own bespoke
// implementation. This file originally had its own IP-range checks, built
// the same day as (and independently of) connector-engine.ts's — this was
// the ONE already known to be real and protected; connector-engine.ts's was
// the "related, pre-existing, lower-urgency gap" this file's own comment
// used to point at, fixed later in a separate round and given the shared
// ssrf-guard.ts module. Re-checking THIS file's own protection against that
// later, more thoroughly-covered module (2026-08-24 audit) found it was
// actually the weaker of the two by then: no CGNAT (100.64.0.0/10) or
// multicast/reserved (224.0.0.0/4+) ranges, an incomplete IPv6 check
// (`startsWith("fe80")` misses fe90::-febf::, no IPv4-mapped-address
// unwrapping — `::ffff:127.0.0.1` would have sailed straight through), and
// — the more serious one — FAILED OPEN on a DNS resolution error (`.catch(()
// => [])` on a failed lookup produced an empty address list, which the
// following loop treated as "nothing to block" instead of "couldn't
// confirm this is safe"). Replaced with the shared, more thoroughly
// verified implementation rather than patched in place, so the two
// SSRF-relevant code paths in this codebase can't quietly drift apart
// again — one real implementation, not two hand-maintained copies of the
// same security-critical logic.
//
// Known, NOT fixed by either implementation: a DNS-rebinding TOCTOU window
// between assertSafeUrl's own DNS lookup and fetch()'s separate, later one
// a few milliseconds afterward — a malicious/compromised DNS answer could
// theoretically differ between the two. Closing that fully needs resolving
// once and fetching by the pinned IP with a Host-header override (careful
// work for HTTPS/SNI), not attempted in either file today.

const CRAWL_USER_AGENT = "P2LessBot/1.0 (+website content ingestion for a customer's own assistant)";
const CRAWL_TIMEOUT_MS = 8000;

/** Fetches with manual redirect handling so every hop is re-validated —
 *  following an allowed URL's redirect straight to an internal address
 *  without re-checking is the classic SSRF bypass. Thin wrapper over the
 *  shared guard, just fixing this crawler's own User-Agent/timeout/redirect
 *  budget. */
async function safeFetch(urlStr: string): Promise<Response> {
  return guardedFetch(urlStr, { timeoutMs: CRAWL_TIMEOUT_MS, headers: { "User-Agent": CRAWL_USER_AGENT } }, 3);
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
  await assertSafeUrl(startUrl); // throws if unsafe — checked before trusting startUrl at all
  const start = new URL(startUrl);
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
