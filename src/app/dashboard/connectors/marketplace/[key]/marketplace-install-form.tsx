"use client";

import { useRouter } from "next/navigation";
import type { DraftAction } from "@/lib/openapi-import";
import { ConnectorDraftReviewForm } from "../../connector-draft-review-form";

export function MarketplaceInstallForm({ name, description, baseUrlHint, actions }: { name: string; description: string; baseUrlHint: string; actions: DraftAction[] }) {
  const router = useRouter();
  return (
    <ConnectorDraftReviewForm
      initialName={name}
      initialDescription={description}
      initialBaseUrl={baseUrlHint}
      initialActions={actions}
      onBack={() => router.push("/dashboard/connectors/marketplace")}
      backLabel="Back to marketplace"
    />
  );
}
