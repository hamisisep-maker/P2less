"use client";

import { useActionState } from "react";
import Link from "next/link";
import { provisionOrganizationAction } from "@/lib/actions";
import { Card } from "@/components/ui";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

type State = { ok?: boolean; email?: string; password?: string; slug?: string; error?: string } | null;

export function OnboardForm() {
  const [state, action, pending] = useActionState(provisionOrganizationAction, null as State);

  if (state?.ok) {
    return (
      <Card className="space-y-4 p-6">
        <div className="text-2xl">🎉</div>
        <h2 className="text-lg font-semibold">Your P2Less workspace is ready</h2>
        <p className="text-sm text-muted">Sign in with the one-time credentials below (save them now).</p>
        <div className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
          <div className="flex justify-between"><span className="text-muted">Email</span><span className="font-mono">{state.email}</span></div>
          <div className="flex justify-between"><span className="text-muted">Password</span><span className="font-mono">{state.password}</span></div>
        </div>
        <div className="rounded-xl border border-amber/30 bg-amber-soft p-3 text-xs text-amber">
          Your number is <b>pending</b> — the next step is the Meta Embedded Signup confirmation
          (one popup), after which it goes live. In this demo that step is stubbed.
        </div>
        <Link href="/login" className="inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink">Go to sign in →</Link>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={action} className="space-y-4">
        <div><label className={label}>Organization name</label><input name="orgName" required placeholder="Acme Clinic" className={field} /></div>
        <div>
          <label className={label}>Industry</label>
          <select name="industry" className={field} defaultValue="business">
            <option value="school">School</option><option value="hospital">Hospital</option>
            <option value="business">Business</option><option value="sacco">SACCO</option>
            <option value="ngo">NGO</option><option value="government">Government</option>
          </select>
        </div>
        <div><label className={label}>WhatsApp number to connect</label><input name="phoneNumber" required placeholder="+254712345678" className={field} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={label}>Your name</label><input name="adminName" required placeholder="Jane Doe" className={field} /></div>
          <div><label className={label}>Your email</label><input name="adminEmail" type="email" required placeholder="jane@acme.co" className={field} /></div>
        </div>
        {state?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
          {pending ? "Provisioning…" : "Connect with Meta (Embedded Signup)"}
        </button>
        <p className="text-center text-[11px] text-faint">By continuing you authorize P2Less to register this number with WhatsApp on your behalf.</p>
      </form>
    </Card>
  );
}
