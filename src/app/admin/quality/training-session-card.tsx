"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, Badge } from "@/components/ui";
import { createTrainingSessionAction, endTrainingSessionAction, addTrainingParticipantAction } from "@/lib/training-actions";

type ActiveSession = { id: string; tenantId: string; tenantName: string; name: string; questionsPerParticipant: number; participantCount: number; questionsUsed: number; createdAt: Date; participants: { address: string; questionCount: number }[] };
type TenantOption = { id: string; name: string };

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

/** Minimal v1 — a named session, a per-participant question counter, a
 *  near-limit prompt. See docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md
 *  for what's deliberately NOT here yet (participant caps, objectives,
 *  the full session lifecycle) — real, documented, deferred until this
 *  minimal version proves the workflow is worth the rest. */
export function TrainingSessionCard({ tenants, activeSessions }: { tenants: TenantOption[]; activeSessions: ActiveSession[] }) {
  const [pending, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [name, setName] = useState("");
  const [questionsPerParticipant, setQuestionsPerParticipant] = useState(20);

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
                    if (res.error) { toast.error(res.error); return; }
                    toast.success("Session ended");
                  })}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
                >
                  End session
                </button>
              </div>
              <div className="mt-1.5 text-xs text-muted">
                <span className="tabular-nums font-medium">{s.participantCount}</span> participant{s.participantCount === 1 ? "" : "s"} · <span className="tabular-nums font-medium">{s.questionsUsed}</span> questions used · {s.questionsPerParticipant} allowed per participant
              </div>
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
        <button
          disabled={pending || !name.trim() || !tenantId}
          onClick={() => startTransition(async () => {
            const res = await createTrainingSessionAction(tenantId, name, questionsPerParticipant);
            if (res.error) { toast.error(res.error); return; }
            toast.success("Training session started");
            setName("");
          })}
          className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          Start session
        </button>
      </div>
    </Card>
  );
}
