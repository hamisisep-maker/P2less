"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, Badge } from "@/components/ui";
import { createTrainingSessionAction, endTrainingSessionAction, addTrainingParticipantAction } from "@/lib/training-actions";

type ActiveSession = { id: string; tenantId: string; tenantName: string; name: string; questionsPerParticipant: number; maxParticipants: number | null; joinCode: string; tenantWhatsAppNumber: string | null; participantCount: number; questionsUsed: number; createdAt: Date; participants: { address: string; questionCount: number }[] };
type TenantOption = { id: string; name: string };

// wa.me pre-fills the message box with the join code — a tester taps the
// link, WhatsApp opens already addressed to the right number with the code
// typed in, and they only have to tap send. Removes both failure points at
// once: mistyping the phone number, and mistyping the code itself.
function waLink(phoneNumber: string, joinCode: string): string {
  const digits = phoneNumber.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(joinCode)}`;
}

function CopyLink({ url }: { url: string }) {
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url)
          .then(() => toast.success("Link copied"))
          .catch(() => toast.error("Couldn't copy — your browser blocked clipboard access."));
      }}
      className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium hover:bg-surface-2"
    >
      Copy link
    </button>
  );
}

function AddParticipant({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Tester phone number"
        className="w-40 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs outline-none focus:border-accent"
      />
      <button
        disabled={pending || !phone.trim()}
        onClick={() => startTransition(async () => {
          const res = await addTrainingParticipantAction(sessionId, phone);
          if (res.error) { toast.error(res.error); return; }
          toast.success("Participant enrolled");
          setPhone("");
        })}
        className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
      >
        Enroll
      </button>
    </div>
  );
}

/** Minimal v1 — a named session, a per-participant question counter, an
 *  optional participant cap (both enforced atomically, server-side), and a
 *  near-limit prompt. See docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md
 *  for what's deliberately NOT here yet (target vs. max as separate numbers,
 *  objectives, the full session lifecycle) — real, documented, deferred
 *  until this minimal version proves the workflow is worth the rest. */
export function TrainingSessionCard({ tenants, activeSessions }: { tenants: TenantOption[]; activeSessions: ActiveSession[] }) {
  const [pending, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [name, setName] = useState("");
  const [questionsPerParticipant, setQuestionsPerParticipant] = useState(20);
  const [maxParticipants, setMaxParticipants] = useState("");

  return (
    <Card className="mb-4 p-5">
      <h2 className="mb-1 font-display font-semibold">Training sessions</h2>
      <p className="mb-3 text-xs text-muted">Only phone numbers explicitly enrolled below are gated — a real customer messaging the same tenant is never affected by an active session. Every message an enrolled tester sends counts against their question limit, enforced on the server. On their final allowed question, they&apos;re prompted to report anything they found before the session ends for them.</p>

      {activeSessions.length > 0 && (
        <div className="mb-4 space-y-2">
          {activeSessions.map((s) => (
            <div key={s.id} className="rounded-xl border border-line-soft px-3.5 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="green" dot>active</Badge>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted">{s.tenantName}</span>
                </div>
                <button
                  disabled={pending}
                  onClick={() => startTransition(async () => {
                    const res = await endTrainingSessionAction(s.id);
                    if ("error" in res) { toast.error(res.error); return; }
                    toast.success("Session ended");
                  })}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
                >
                  End session
                </button>
              </div>
              <div className="mt-1.5 text-xs text-muted">
                <span className="tabular-nums font-medium">{s.participantCount}</span>{s.maxParticipants !== null && <span className="tabular-nums"> / {s.maxParticipants}</span>} participant{s.participantCount === 1 ? "" : "s"} · <span className="tabular-nums font-medium">{s.questionsUsed}</span> questions used · {s.questionsPerParticipant} allowed per participant
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>Join code:</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono font-semibold tracking-wider text-ink">{s.joinCode}</span>
                <span>— never guessable, so a real customer&apos;s ordinary message won&apos;t match it.</span>
              </div>
              {s.tenantWhatsAppNumber ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span>Share this link (opens WhatsApp with the code pre-filled, one tap to send):</span>
                  <CopyLink url={waLink(s.tenantWhatsAppNumber, s.joinCode)} />
                </div>
              ) : (
                <div className="mt-1.5 text-xs text-faint">No active WhatsApp number on this tenant yet — a share link needs one to point to.</div>
              )}
              {s.participants.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.participants.map((p) => (
                    <span key={p.address} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
                      {p.address} · {p.questionCount}/{s.questionsPerParticipant}
                    </span>
                  ))}
                </div>
              )}
              <AddParticipant sessionId={s.id} />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-line-soft pt-3">
        <label className="block">
          <span className="text-xs font-medium text-muted">Tenant</span>
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="mt-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent">
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-muted">Session name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WhatsApp Training — 23 Aug" className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Questions/participant</span>
          <input type="number" min={1} value={questionsPerParticipant} onChange={(e) => setQuestionsPerParticipant(Number(e.target.value))} className="mt-1 w-20 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Max participants</span>
          <input type="number" min={1} value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} placeholder="no cap" className="mt-1 w-24 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
        </label>
        <button
          disabled={pending || !name.trim() || !tenantId}
          onClick={() => startTransition(async () => {
            const cap = maxParticipants.trim() ? Number(maxParticipants) : null;
            const res = await createTrainingSessionAction(tenantId, name, questionsPerParticipant, cap);
            if (res.error) { toast.error(res.error); return; }
            toast.success("Training session started");
            setName("");
            setMaxParticipants("");
          })}
          className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          Start session
        </button>
      </div>
    </Card>
  );
}
