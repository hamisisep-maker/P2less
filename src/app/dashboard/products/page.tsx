import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { ProductsEditor } from "./products-editor";

export default async function ProductsPage() {
  const user = await requireTenantUser();
  const canManage = userPermissions(user).includes(PERMISSIONS.PRODUCTS_MANAGE);
  const products = await db.product.findMany({ where: { tenantId: user.tenantId! }, orderBy: { createdAt: "desc" } });

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="What your assistant can show and sell straight from WhatsApp. Someone messages your number, asks what you have, and can pay right there via M-Pesa — no separate store, no app."
      />

      <Card className="mb-4 p-4 text-sm text-muted">
        <p className="mb-1"><strong className="text-ink">How this works.</strong> Add products below. On WhatsApp, people can ask things like &quot;what do you sell?&quot; or &quot;do you have X?&quot; and your assistant lists what&apos;s in stock. Ordering triggers a real M-Pesa payment prompt to the customer&apos;s phone.</p>
        <p>This works for any organization, not just retail — a school selling uniforms, a clinic selling supplies. Add whatever you offer.</p>
      </Card>

      {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view products, but need the <code>products.manage</code> permission to add or edit them.</Card>}

      <ProductsEditor initial={products} canManage={canManage} />
    </div>
  );
}
