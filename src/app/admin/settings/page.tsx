import { ExternalLink } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth";
import { Card, PageHeader, Badge } from "@/components/ui";
import { Avatar } from "@/components/dashboard-ui";
import { PasswordForm } from "./password-form";

const PLATFORM_LINKS = [
  { label: "Railway (hosting)", href: "https://railway.app/dashboard" },
  { label: "GitHub repository", href: "https://github.com" },
  { label: "Meta Business Manager", href: "https://business.facebook.com" },
  { label: "WhatsApp Manager", href: "https://business.facebook.com/wa/manage" },
  { label: "Meta for Developers", href: "https://developers.facebook.com" },
  { label: "Safaricom Daraja (M-Pesa)", href: "https://developer.safaricom.co.ke" },
];

export default async function AdminSettingsPage() {
  const admin = await requireSuperAdmin();

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your admin profile, security, and quick links to the external services P2Less depends on." />

      <Card className="p-5">
        <h2 className="mb-3 font-display font-semibold">Your profile</h2>
        <div className="flex items-center gap-3">
          <Avatar name={admin.name} size={44} />
          <div>
            <div className="font-medium">{admin.name}</div>
            <div className="text-sm text-muted">{admin.email}</div>
          </div>
          <Badge tone="accent">Super Admin</Badge>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Change password</h2>
        <PasswordForm />
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Platform links</h2>
        <p className="mb-3 text-xs text-muted">Where you actually go to operate the parts of P2Less that live outside this dashboard — hosting, source control, WhatsApp, and payments. AI provider links live on the AI Providers page next to each one.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORM_LINKS.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-sm hover:bg-surface-2">
              {l.label}
              <ExternalLink size={14} className="text-faint" />
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
