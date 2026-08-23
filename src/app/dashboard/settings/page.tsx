import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

type Branding = { assistantName?: string; logoText?: string; primaryColor?: string; welcome?: string; poweredBy?: string; pdfFooter?: string };

// Real gap found 2026-08-23: Tenant.name/industry/branding are live-consumed
// (conversation greetings, generated PDFs, the widget embed snippet) but had
// zero edit path anywhere after signup. Deliberately does NOT duplicate
// Channels/Billing/Users & Roles, which already have their own pages —
// this is the org-level config that had no home at all.
export default async function DashboardSettingsPage() {
  const user = await requireTenantUser();
  const canManage = userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE);
  const tenant = await db.tenant.findUnique({ where: { id: user.tenantId! }, select: { name: true, industry: true, branding: true } });
  const branding = (tenant?.branding as Branding | null) ?? {};

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your organization's name, industry, and assistant branding — used across conversations, generated documents, and the website widget." />

      {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view these settings, but need the <code>tenant.manage</code> permission to edit them.</Card>}

      <SettingsForm
        initial={{
          name: tenant?.name ?? "", industry: tenant?.industry ?? "business",
          assistantName: branding.assistantName ?? "", logoText: branding.logoText ?? "", primaryColor: branding.primaryColor ?? "",
          welcome: branding.welcome ?? "", poweredBy: branding.poweredBy ?? "", pdfFooter: branding.pdfFooter ?? "",
        }}
        canManage={canManage}
      />
    </div>
  );
}
