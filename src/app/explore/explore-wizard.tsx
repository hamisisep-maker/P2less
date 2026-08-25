"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { saveExploreSelectionAction, skipExploreAction } from "@/lib/actions";
import { USE_CASE_OPTIONS, CHANNEL_OPTIONS } from "@/lib/tenant-options";
import { Card } from "@/components/ui";

type Initial = { useCases: string[]; channelsNeeded: string[]; signupGoal: string };

const STEP_TITLES = ["What do you want to use P2Less for?", "Which channels do your customers use?", "One last thing"];

function OptionCard({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all duration-200",
        selected ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface hover:border-accent/40 hover:bg-surface-2",
      )}
    >
      {label}
    </button>
  );
}

export function ExploreWizard({ initial }: { initial: Initial }) {
  const [, saveAction, savePending] = useActionState(saveExploreSelectionAction, null);
  const [, skipAction, skipPending] = useActionState(async () => skipExploreAction(), null);
  const [step, setStep] = useState(0);
  const [useCases, setUseCases] = useState<string[]>(initial.useCases);
  const [channelsNeeded, setChannelsNeeded] = useState<string[]>(initial.channelsNeeded);
  const [signupGoal, setSignupGoal] = useState(initial.signupGoal);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <Card className="animate-in p-6">
      <div className="mb-5 flex items-center gap-1.5">
        {STEP_TITLES.map((_, i) => (
          <span key={i} className={clsx("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-line")} />
        ))}
      </div>
      <h2 className="text-lg font-semibold">{STEP_TITLES[step]}</h2>
      <p className="mt-1 text-sm text-muted">Step {step + 1} of {STEP_TITLES.length}. This just helps tailor your dashboard — you can change it anytime.</p>

      {step === 0 && (
        <div className="mt-5 space-y-2">
          {USE_CASE_OPTIONS.map((opt) => (
            <OptionCard key={opt.value} label={opt.label} selected={useCases.includes(opt.value)} onClick={() => toggle(useCases, setUseCases, opt.value)} />
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="mt-5 space-y-2">
          {CHANNEL_OPTIONS.map((opt) => (
            <OptionCard key={opt.value} label={opt.label} selected={channelsNeeded.includes(opt.value)} onClick={() => toggle(channelsNeeded, setChannelsNeeded, opt.value)} />
          ))}
        </div>
      )}

      {step === 2 && (
        <form action={saveAction} className="mt-5 space-y-4">
          {useCases.map((v) => <input key={v} type="hidden" name="useCases" value={v} />)}
          {channelsNeeded.map((v) => <input key={v} type="hidden" name="channelsNeeded" value={v} />)}
          <div>
            <label className="text-xs font-medium text-muted">What are you hoping to achieve with P2Less? (optional)</label>
            <textarea
              name="signupGoal"
              value={signupGoal}
              onChange={(e) => setSignupGoal(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="e.g. Answer parent questions automatically, without hiring more staff."
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setStep(1)} className="text-sm text-muted hover:text-ink">Back</button>
            <button type="submit" disabled={savePending} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60">
              {savePending && <Loader2 size={16} className="animate-spin" />}
              {savePending ? "Saving…" : "Finish exploring"}
            </button>
          </div>
        </form>
      )}

      {step < 2 && (
        <div className="mt-5 flex items-center justify-between">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} className="text-sm text-muted hover:text-ink">Back</button>
          ) : <span />}
          <button type="button" onClick={() => setStep(step + 1)} className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink">
            Continue
          </button>
        </div>
      )}

      <form action={skipAction} className="mt-4 text-center">
        <button type="submit" disabled={skipPending} className="text-[11px] text-faint underline hover:text-muted">
          {skipPending ? "Skipping…" : "Skip for now"}
        </button>
      </form>
    </Card>
  );
}
