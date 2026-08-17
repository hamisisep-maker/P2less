"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Org = { number: string; name: string; department: string; slug: string; industry: string };
type Sender = { phone: string; name: string; hint: string; orgNumber: string };
type Reply = { body: string; kind?: string; meta?: { url?: string } };
type Bubble = { id: string; dir: "in" | "out"; body: string; kind?: string; url?: string };

// Sample prompts per organization, keyed by slug (fallback by industry).
const SAMPLES: Record<string, string[]> = {
  hamzone: ["Hi", "Send me my payslip", "What is my leave balance?"],
  riverside: ["Hi", "What is John's fee balance?", "Show me John's results.", "Book a meeting for John"],
  "nairobi-hospital": ["Hi", "When is my next appointment?"],
  "kilimani-retail": ["Hi", "Where is my order?", "Track my order"],
};
const INDUSTRY_ICON: Record<string, string> = { school: "🎓", hospital: "🏥", business: "🏢", government: "🏛️" };

export function DemoClient({ orgs, senders }: { orgs: Org[]; senders: Sender[] }) {
  const [org, setOrg] = useState<Org>(orgs[0]);
  const orgSenders = senders.filter((s) => s.orgNumber === org.number);
  const [from, setFrom] = useState<string>(orgSenders[0]?.phone ?? "+254700000000");
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  function pickOrg(o: Org) {
    setOrg(o);
    const s = senders.filter((x) => x.orgNumber === o.number);
    setFrom(s[0]?.phone ?? "+254700000000");
    setMessages([]);
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), dir: "in", body: t }]);
    setBusy(true);
    try {
      const res = await fetch("/api/channels/webchat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toNumber: org.number, fromNumber: from, text: t }),
      });
      const data = (await res.json()) as { replies?: Reply[] };
      setMessages((m) => [
        ...m,
        ...(data.replies ?? []).map((r) => ({ id: crypto.randomUUID(), dir: "out" as const, body: r.body, kind: r.kind, url: r.meta?.url })),
      ]);
    } catch {
      setMessages((m) => [...m, { id: crypto.randomUUID(), dir: "out", body: "⚠️ Network error." }]);
    } finally {
      setBusy(false);
    }
  }

  const samples = SAMPLES[org.slug] ?? ["Hi"];

  return (
    <div className="min-h-screen bg-[var(--color-wa-bg)]">
      <div className="mx-auto grid min-h-screen max-w-6xl lg:grid-cols-[300px_1fr_320px]">
        {/* Organization directory — the numbers you can message */}
        <aside className="hidden flex-col border-r border-black/10 bg-surface lg:flex">
          <div className="flex items-center gap-2 bg-[var(--color-wa)] px-4 py-3.5 text-white">
            <Link href="/" className="text-white/80 hover:text-white">←</Link>
            <span className="font-medium">Your WhatsApp</span>
          </div>
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-faint">Organizations you can message</div>
          <div className="flex-1 overflow-y-auto">
            {orgs.map((o) => (
              <button
                key={o.number}
                onClick={() => pickOrg(o)}
                className={`flex w-full items-center gap-3 border-b border-line-soft px-3 py-3 text-left hover:bg-surface-2 ${org.number === o.number ? "bg-surface-2" : ""}`}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-lg">{INDUSTRY_ICON[o.industry] ?? "🏢"}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{o.name}</span>
                  <span className="block truncate text-xs text-muted">{o.number} · {o.department}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Conversation */}
        <div className="flex min-h-screen flex-col bg-[#efeae2]">
          <div className="flex items-center gap-3 bg-[var(--color-wa)] px-4 py-3 text-white">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-lg">{INDUSTRY_ICON[org.industry] ?? "🏢"}</span>
            <div className="leading-tight">
              <div className="font-medium">{org.name}</div>
              <div className="text-[11px] text-white/70">{org.number} · online</div>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" style={{ backgroundImage: "radial-gradient(rgba(0,0,0,.03) 1px,transparent 1px)", backgroundSize: "18px 18px" }}>
            <div className="mx-auto max-w-md rounded-lg bg-white/80 p-2.5 text-center text-[11px] text-muted shadow-sm">
              You are messaging <b>{org.name}</b> at <b>{org.number}</b> from <b>{from}</b>. P2Less is invisible behind this number.
            </div>
            {messages.map((b) => <Message key={b.id} b={b} />)}
            {busy && <div className="ml-1 text-xs text-muted">{org.name} is typing…</div>}
            <div ref={endRef} />
          </div>

          <div className="flex flex-wrap gap-1.5 bg-[#efeae2] px-4 pb-2">
            {samples.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs hover:bg-white disabled:opacity-50">{s}</button>
            ))}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 bg-[#f0f0f0] px-4 py-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message" className="flex-1 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:border-[var(--color-wa)]" />
            <button type="submit" disabled={busy || !input.trim()} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-wa)] text-white disabled:opacity-50" aria-label="Send">➤</button>
          </form>
        </div>

        {/* Identity panel */}
        <aside className="hidden flex-col gap-4 border-l border-black/5 bg-surface p-5 lg:flex">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-faint">You are messaging as</div>
            <div className="mt-2 space-y-2">
              {orgSenders.length === 0 && <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">No registered contacts for this org. Try messaging anyway — you&apos;ll be treated as an unknown sender.</div>}
              {orgSenders.map((s) => (
                <button key={s.phone} onClick={() => { setFrom(s.phone); setMessages([]); }} className={`w-full rounded-xl border p-3 text-left text-sm ${from === s.phone ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted">{s.phone} · {s.hint}</div>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="text-[11px] text-faint">Or send from any number:</label>
              <input value={from} onChange={(e) => { setFrom(e.target.value); setMessages([]); }} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs text-muted">
            <div className="mb-1 font-medium text-ink">How routing works</div>
            The destination number (<b>{org.number}</b>) tells P2Less which organization &amp; systems to use. Message a different org&apos;s number and you get that org — and only what you&apos;re authorized to see there.
          </div>
          <Link href="/login" className="rounded-xl border border-line bg-surface px-4 py-2.5 text-center text-sm font-medium hover:bg-surface-2">Organization dashboard →</Link>
        </aside>
      </div>
    </div>
  );
}

function Message({ b }: { b: Bubble }) {
  const isIn = b.dir === "in";
  if (b.kind === "otp_hint") {
    return <div className="mx-auto max-w-md rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-center text-xs text-amber">🔐 {b.body}</div>;
  }
  return (
    <div className={`flex ${isIn ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm ${isIn ? "rounded-br-none bg-[#d9fdd3]" : "rounded-bl-none bg-white"}`}>
        {b.url ? (
          <span>{b.body.replace(b.url, "").trim()} <a href={b.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">Open document</a></span>
        ) : b.body}
      </div>
    </div>
  );
}
