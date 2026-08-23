"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui";

// The finalized Phase A internal-pilot recruiting message, agreed
// 2026-08-23 — see docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md,
// "Phase A". Kept here (not just in the doc) so it's ready to copy the
// moment recruiting actually happens, instead of being drafted fresh
// each time.
const MESSAGE = `Hey team — I need your help breaking P2Less before I let anyone else near it.

Try to break it. Ask it something confusing, wrong, out of order, or just weird — anything that makes it give you a bad, wrong, or unexpected answer.

Two ways to test:
1. WhatsApp: message +254711562526 like a real customer would
2. Widget: go to https://p2less-app-production.up.railway.app and chat with the bot in the corner

When it messes up: just say "I want to talk to a human" in the chat — it'll automatically open a ticket for me to review, no extra step needed. Or just message me directly with what happened and what you expected instead.

This isn't a demo — actually try to trip it up. That's the whole point.`;

export function RecruitPilotCard() {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  // Selects the message text as a fallback for browsers/contexts where
  // navigator.clipboard.writeText is denied (e.g. permissions policy,
  // non-HTTPS, some embedded contexts) — confirmed this actually happens
  // (NotAllowedError), not a theoretical case, so the button always leaves
  // the admin able to copy one way or another instead of failing silently.
  function selectFallback() {
    const el = preRef.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(MESSAGE);
      setCopied(true);
      toast.success("Copied — ready to paste into WhatsApp or Slack");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      selectFallback();
      toast.error("Couldn't copy automatically — selected the text below, press Ctrl+C (or Cmd+C)");
    }
  }

  return (
    <Card className="mb-4 p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display font-semibold">Recruit pilot testers (internal, both channels)</h2>
        <button onClick={handleCopy} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-surface-2">
          {copied ? "Copied" : "Copy message"}
        </button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Internal only, both live channels (Hamzone&apos;s real WhatsApp number + the P2Less widget) — the reviewer-capacity-safe default while this is still one person triaging every report by hand.
      </p>
      <pre ref={preRef} className="whitespace-pre-wrap rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3 text-xs text-muted">{MESSAGE}</pre>
    </Card>
  );
}
