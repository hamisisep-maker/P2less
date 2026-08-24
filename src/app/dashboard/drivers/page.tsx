import { withTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { DriversEditor } from "./drivers-editor";

export const dynamic = "force-dynamic";

export default async function DriversPage() {
  return withTenantUser(async (user) => {
    const canManage = userPermissions(user).includes(PERMISSIONS.DRIVERS_MANAGE);
    const drivers = await db.driver.findMany({ where: { tenantId: user.tenantId! }, orderBy: { createdAt: "desc" } });
    const activeTrips = await db.deliveryTrip.findMany({
      where: { tenantId: user.tenantId!, status: { in: ["searching", "offered", "assigned"] } },
      include: { order: true, driver: true },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div>
        <PageHeader
          title="Drivers"
          subtitle="Your delivery roster. Availability is set by each driver over WhatsApp, not typed in here — the assistant asks them directly and updates this automatically."
        />

        <Card className="mb-4 p-4 text-sm text-muted">
          <p className="mb-1"><strong className="text-ink">How this works.</strong> Add a driver&apos;s name and WhatsApp number below. When there&apos;s a delivery, the assistant finds a driver who has said they&apos;re available right now, offers them the delivery, and waits up to 5 minutes for a reply before trying the next one — never assumes, never double-books someone already on a delivery.</p>
        </Card>

        {activeTrips.length > 0 && (
          <Card className="mb-4 p-4">
            <h2 className="mb-2 font-display text-sm font-semibold">Deliveries in progress</h2>
            <div className="space-y-2 text-sm">
              {activeTrips.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-2 last:border-0 last:pb-0">
                  <span>Order {t.order.reference} — {t.order.deliveryAddress ?? "—"}</span>
                  <span className="text-muted">
                    {t.status === "searching" && "Looking for a driver…"}
                    {t.status === "offered" && "Waiting on a driver to accept…"}
                    {t.status === "assigned" && `Assigned to ${t.driver?.name ?? "—"}`}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view drivers, but need the <code>drivers.manage</code> permission to add or edit them.</Card>}

        <DriversEditor initial={drivers} canManage={canManage} />
      </div>
    );
  });
}
