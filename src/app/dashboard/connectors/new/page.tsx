import { requireTenantUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ConnectorForm } from "./connector-form";

export default async function NewConnectorPage() {
  await requireTenantUser();
  return (
    <div>
      <PageHeader title="New connector" subtitle="No code required. Define the system, its authentication, and one conversational capability." />
      <ConnectorForm />
    </div>
  );
}
