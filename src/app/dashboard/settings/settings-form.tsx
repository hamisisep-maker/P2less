"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui";
import { updateTenantSettingsAction } from "@/lib/actions";
import { USE_CASE_OPTIONS, CHANNEL_OPTIONS } from "@/lib/tenant-options";

type Initial = {
  name: string; industry: string;
  assistantName: string; logoText: string; primaryColor: string; welcome: string; poweredBy: string; pdfFooter: string;
  logoUrl: string; phone: string; website: string;
  useCases: string[]; channelsNeeded: string[];
};
type State = { ok?: boolean; unchanged?: boolean; error?: string } | null;

const INDUSTRIES = ["school", "hospital", "sacco", "business", "ngo", "government"];

export function SettingsForm({ initial, canManage }: { initial: Initial; canManage: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(updateTenantSettingsAction, null);

  useEffect(() => {
    if (!state?.ok) return;
    if (state.unchanged) toast("No changes were made");
    else toast.success("Settings saved");
  }, [state]);

  return (
    <form action={action}>
      {state?.error && <div className="mb-4 rounded-xl border border-rose/30 bg-rose-soft p-3 text-sm text-rose">{state.error}</div>}

      <Card className="mb-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Organization</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-muted">Organization name</span>
            <input name="name" defaultValue={initial.name} disabled={!canManage} required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Industry</span>
            <select name="industry" defaultValue={initial.industry} disabled={!canManage} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60">
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
        </div>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Assistant branding</h2>
        <p className="mb-3 text-xs text-muted">Shown in real conversation greetings, generated documents (payslips, receipts), and your website widget&apos;s embed snippet. Leave a field blank to keep P2Less&apos;s default.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-muted">Assistant name</span>
            <input name="assistantName" defaultValue={initial.assistantName} disabled={!canManage} placeholder={initial.name || "e.g. Riverside Assistant"} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Logo text (widget header)</span>
            <input name="logoText" defaultValue={initial.logoText} disabled={!canManage} placeholder={initial.name} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Primary color</span>
            <input name="primaryColor" type="text" defaultValue={initial.primaryColor} disabled={!canManage} placeholder="#0f766e" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">&quot;Powered by&quot; footer text</span>
            <input name="poweredBy" defaultValue={initial.poweredBy} disabled={!canManage} placeholder="Powered by P2Less" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted">Welcome message</span>
            <input name="welcome" defaultValue={initial.welcome} disabled={!canManage} placeholder={`Welcome to ${initial.name || "your organization"}.`} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted">PDF document footer</span>
            <input name="pdfFooter" defaultValue={initial.pdfFooter} disabled={!canManage} placeholder="e.g. official document, contact us at..." className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
        </div>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Email reply branding</h2>
        <p className="mb-3 text-xs text-muted">Every AI reply sent over the Email channel goes out with your logo at the top and this contact info in the footer, so customers see your organization, not P2Less. Leave a field blank to skip that part of the email.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted">Logo image URL</span>
            <input name="logoUrl" type="url" defaultValue={initial.logoUrl} disabled={!canManage} placeholder="https://yoursite.com/logo.png" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Phone number</span>
            <input name="phone" type="tel" defaultValue={initial.phone} disabled={!canManage} placeholder="+254 700 000000" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Website</span>
            <input name="website" type="url" defaultValue={initial.website} disabled={!canManage} placeholder="https://yoursite.com" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60" />
          </label>
        </div>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-1 font-display font-semibold">What you use P2Less for</h2>
        <p className="mb-3 text-xs text-muted">Controls which sections show in your sidebar — check anything relevant so that section becomes visible. Unchecking never deletes existing data, it only hides a section you're not using yet.</p>
        <div className="mt-1 space-y-1.5">
          {USE_CASE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="useCases" value={opt.value} defaultChecked={initial.useCases.includes(opt.value)} disabled={!canManage} className="rounded border-line disabled:opacity-60" />
              {opt.label}
            </label>
          ))}
        </div>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Channels your customers use</h2>
        <p className="mb-3 text-xs text-muted">Check &quot;Our website (chat widget)&quot; to reveal the Website Widget section in your sidebar so you can set one up.</p>
        <div className="mt-1 space-y-1.5">
          {CHANNEL_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="channelsNeeded" value={opt.value} defaultChecked={initial.channelsNeeded.includes(opt.value)} disabled={!canManage} className="rounded border-line disabled:opacity-60" />
              {opt.label}
            </label>
          ))}
        </div>
      </Card>

      {canManage && (
        <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
          {pending ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}
