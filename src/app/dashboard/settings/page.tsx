import { withTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

type Branding = { assistantName?: string; logoText?: string; primaryColor?: string; welcome?: string; poweredBy?: string; pdfFooter?: string; logoUrl?: string; phone?: string; website?: string };

// Real gap found 2026-08-23: Tenant.name/industry/branding are live-consumed
// (conversation greetings, generated PDFs, the widget embed snippet) but had
// zero edit path anywhere after signup. Deliberately does NOT duplicate
// Channels/Billing/Users & Roles, which already have their own pages —
// this is the org-level config that had no home at all.
//
// useCases/channelsNeeded added the same day, found live: nav.ts gates the
// Commerce/Integrations/Developer/Widget nav groups on these two fields OR
// real usage data — a tenant that under-selected at signup (or, like every
// pre-existing tenant, signed up before this question existed at all and
// has them null) had no way to ever reveal a hidden group except by
// organically generating the underlying data first, a real dead end. Same
// option lists as the /onboard form, for the same self-report.
export default async function DashboardSettingsPage() {
  return withTenantUser(async (user) => {
    const canManage = userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE);
    const tenant = await db.tenant.findUnique({ where: { id: user.tenantId! }, select: { name: true, industry: true, branding: true, useCases: true, channelsNeeded: true } });
    const branding = (tenant?.branding as Branding | null) ?? {};

    return (
      <div>
        <PageHeader title="Settings" subtitle="Your organization's name, industry, assistant branding, and which parts of the dashboard are relevant to you." />

        {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view these settings, but need the <code>tenant.manage</code> permission to edit them.</Card>}

        <SettingsForm
          initial={{
            name: tenant?.name ?? "", industry: tenant?.industry ?? "business",
            assistantName: branding.assistantName ?? "", logoText: branding.logoText ?? "", primaryColor: branding.primaryColor ?? "",
            welcome: branding.welcome ?? "", poweredBy: branding.poweredBy ?? "", pdfFooter: branding.pdfFooter ?? "",
            logoUrl: branding.logoUrl ?? "", phone: branding.phone ?? "", website: branding.website ?? "",
            useCases: (tenant?.useCases as string[] | null) ?? [], channelsNeeded: (tenant?.channelsNeeded as string[] | null) ?? [],
          }}
          canManage={canManage}
        />
      </div>
    );
  });
}
