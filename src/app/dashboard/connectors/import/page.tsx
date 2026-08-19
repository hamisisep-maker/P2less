import { requireTenantUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { OpenApiImportForm } from "./openapi-import-form";

export default async function ImportConnectorPage() {
  await requireTenantUser();
  return (
    <div>
      <PageHeader title="Import from OpenAPI" subtitle="Paste your system's OpenAPI (Swagger) spec — P2Less drafts a capability for every endpoint, you review and edit before anything goes live." />
      <OpenApiImportForm />
    </div>
  );
}
