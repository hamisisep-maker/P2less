import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import type { DraftAction } from "@/lib/openapi-import";
import { MarketplaceInstallForm } from "./marketplace-install-form";

export default async function InstallTemplatePage({ params }: { params: Promise<{ key: string }> }) {
  await requireTenantUser();
  const { key } = await params;
  const template = await db.connectorTemplate.findUnique({ where: { key } });
  if (!template || !template.active) notFound();

  return (
    <div>
      <PageHeader title={`Install: ${template.name}`} subtitle="Point this at your own system and review every capability before anything goes live." />
      <MarketplaceInstallForm
        name={template.name}
        description={template.description ?? ""}
        baseUrlHint={template.baseUrlHint}
        actions={template.actions as unknown as DraftAction[]}
      />
    </div>
  );
}
