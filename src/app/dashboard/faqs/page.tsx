import { withTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { FaqsEditor } from "./faqs-editor";

type Faq = { q: string; a: string };

export default async function FaqsPage() {
  return withTenantUser(async (user) => {
    const canManage = userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE);
    const tenant = await db.tenant.findUnique({ where: { id: user.tenantId! } });
    const faqs = ((tenant?.faqs as Faq[] | null) ?? []).filter((f) => f && f.q && f.a);

    return (
      <div>
        <PageHeader
          title="Assistant FAQs"
          subtitle="Approved answers your assistant can give for common general questions — hours, term dates, locations, payment methods. It answers from these word-for-word and never makes anything up."
        />

        <Card className="mb-4 p-4 text-sm text-muted">
          <p className="mb-1"><strong className="text-ink">How this works.</strong> When someone asks a general question that isn&apos;t one of your services, the assistant checks these approved answers first. If it finds a match, it replies using your wording. If nothing matches, it won&apos;t guess — it says it isn&apos;t sure and points them to your office.</p>
          <p>Sensitive, per-person data (fees, grades, appointments) is never answered from here — that always goes through a verified lookup.</p>
        </Card>

        {faqs.length === 0 && (
          <Card className="mb-4 border-amber/30 bg-amber-soft p-4 text-sm">
            <p className="mb-1 font-medium text-amber">You haven&apos;t added any yet</p>
            <p className="text-muted">Without any approved answers, general questions get an honest &quot;I&apos;m not sure&quot; instead of a real one. Add a few below — even 3-5 common questions makes a real difference — or use &quot;Import from your website&quot; to draft some automatically from your site&apos;s own content.</p>
          </Card>
        )}

        {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view the FAQs, but need the <code>tenant.manage</code> permission to edit them.</Card>}

        <FaqsEditor initial={faqs} canManage={canManage} />
      </div>
    );
  });
}
