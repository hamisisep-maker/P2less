import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { DeliveryZonesEditor } from "./delivery-editor";

export default async function DeliveryPage() {
  const user = await requireTenantUser();
  const canManage = userPermissions(user).includes(PERMISSIONS.DELIVERY_MANAGE);
  const zones = await db.deliveryZone.findMany({ where: { tenantId: user.tenantId! }, orderBy: { createdAt: "desc" } });

  return (
    <div>
      <PageHeader
        title="Delivery Zones"
        subtitle="Manual pricing tiers for delivery — no maps or GPS needed. The assistant matches a customer's delivery address against these to work out the delivery fee."
      />

      <Card className="mb-4 p-4 text-sm text-muted">
        <p className="mb-1"><strong className="text-ink">How this works.</strong> Add a zone with a name and a fee, e.g. &quot;Within Nairobi CBD&quot; — KES 200, or &quot;CBD to Embakasi&quot; — KES 500. Add area names or landmarks in the description to help matching.</p>
        <p>If a customer&apos;s address doesn&apos;t clearly match any zone, the assistant tells them the delivery fee will be confirmed separately rather than guessing.</p>
      </Card>

      {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view delivery zones, but need the <code>delivery.manage</code> permission to add or edit them.</Card>}

      <DeliveryZonesEditor initial={zones} canManage={canManage} />
    </div>
  );
}
