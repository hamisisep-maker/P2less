"use client";

import { useActionState, useState } from "react";
import { createConnectorAction } from "@/lib/actions";
import { Card } from "@/components/ui";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

export function ConnectorForm() {
  const [state, action, pending] = useActionState(createConnectorAction, null as { error?: string } | null);
  const [authType, setAuthType] = useState("api_key");

  return (
    <form action={action} className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="font-display font-semibold">System</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={label}>Name</label><input name="name" required placeholder="Riverside School System" className={field} /></div>
          <div><label className={label}>Base URL</label><input name="baseUrl" required placeholder="http://localhost:3000/api/demo-school" className={field} /></div>
        </div>
        <div><label className={label}>Description</label><input name="description" placeholder="The school's student information system" className={field} /></div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-display font-semibold">Authentication</h2>
        <div>
          <label className={label}>Method</label>
          <select name="authType" value={authType} onChange={(e) => setAuthType(e.target.value)} className={field}>
            <option value="none">None</option>
            <option value="api_key">API key (header)</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic auth</option>
          </select>
          <p className="mt-1 text-[11px] text-faint">Credentials are encrypted at rest and never shown again or logged.</p>
        </div>
        {authType === "api_key" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className={label}>Header name</label><input name="apiKeyHeader" defaultValue="x-api-key" className={field} /></div>
            <div><label className={label}>Key value</label><input name="apiKeyValue" type="password" className={field} /></div>
          </div>
        )}
        {authType === "bearer" && <div><label className={label}>Token</label><input name="bearerToken" type="password" className={field} /></div>}
        {authType === "basic" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className={label}>Username</label><input name="basicUser" className={field} /></div>
            <div><label className={label}>Password</label><input name="basicPass" type="password" className={field} /></div>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-display font-semibold">Conversational capability</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={label}>Action key</label><input name="actionKey" required placeholder="GET_STUDENT_RESULTS" className={field} /></div>
          <div><label className={label}>Display name</label><input name="actionName" required placeholder="Get student results" className={field} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
          <div>
            <label className={label}>Method</label>
            <select name="method" className={field}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
          </div>
          <div><label className={label}>Path (use {"{studentId}"} for the student)</label><input name="path" required placeholder="/students/{studentId}/results" className={field} /></div>
        </div>
        <div><label className={label}>Required permission</label><input name="requiredPermission" placeholder="student.results.read" className={field} /></div>
        <div>
          <label className={label}>Sample phrases (one per line)</label>
          <textarea name="samplePhrases" rows={3} placeholder={"show me results\nwhat are the marks\nexam results"} className={field} />
        </div>
        <div><label className={label}>Reply template</label><input name="replyTemplate" placeholder="{name} scored an average of {average}%." className={field} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresStepUp" /> Require OTP verification (sensitive data)</label>
      </Card>

      {state?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
      <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0">
        {pending ? "Creating…" : "Create connector"}
      </button>
    </form>
  );
}
