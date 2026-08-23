/** The 11-category quality-investigation taxonomy, exactly as defined in
 *  docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md — kept as one shared
 *  source of truth so the DB values, the triage UI, and the doc never drift
 *  apart from each other. Split out from ticket-actions.ts because a
 *  "use server" file can only export async functions, not plain constants. */
export const QUALITY_CATEGORIES = [
  { value: "bug", label: "🐛 Technical Bug" },
  { value: "ai_hallucination", label: "🤖 AI Hallucination" },
  { value: "knowledge_gap", label: "📚 Knowledge Gap" },
  { value: "incorrect_source_data", label: "🗄️ Incorrect Source Data" },
  { value: "incorrect_connector_result", label: "🔄 Incorrect Connector Result" },
  { value: "intent_classification_error", label: "🎯 Intent/Classification Error" },
  { value: "authorization_error", label: "🔐 Authorization Error" },
  { value: "integration_failure", label: "🔌 Integration Failure" },
  { value: "conversation_context_failure", label: "💬 Conversation/Context Failure" },
  { value: "correct_user_misunderstanding", label: "❓ Correct Response — User Misunderstanding" },
  { value: "unknown_investigating", label: "🔎 Unknown / Requires Investigation" },
] as const;

export const TICKET_SOURCES = [
  { value: "internal", label: "Internal — P2Less's own team found it" },
  { value: "tenant", label: "Tenant — a tenant's own staff or contact reported it" },
  { value: "public_report", label: "Public — reported through the public feedback programme" },
] as const;

/** The corrective-action decision — deliberately a SEPARATE choice from
 *  QUALITY_CATEGORIES above (root cause). A category doesn't imply a fix
 *  layer: "knowledge_gap" might mean updating an FAQ, not touching code.
 *  Ordered cheapest-appropriate-layer first, matching the correction-
 *  routing ladder in docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md
 *  (config/knowledge → code → provider/model → fine-tuning) — "requires
 *  code" is meant to be the exception a reviewer actively decides on, with
 *  a stated reason, never the reflexive default. */
export const ACTION_DECISIONS = [
  { value: "no_action", label: "🟢 No action required" },
  { value: "knowledge_update", label: "🟡 Knowledge/content update" },
  { value: "configuration_change", label: "🟡 Configuration change" },
  { value: "prompt_change", label: "🟡 Prompt/instruction change" },
  { value: "connector_data_fix", label: "🟠 Connector/data correction" },
  { value: "ai_model_change", label: "🟠 AI provider/model change" },
  { value: "operational_procedure", label: "🟠 Operational procedure" },
  { value: "user_training", label: "🔵 User training" },
  { value: "documentation_change", label: "🔵 Documentation change" },
  { value: "ux_change", label: "🔵 UX/content improvement" },
  { value: "monitoring_change", label: "🔵 Monitoring/alert change" },
  { value: "code_change", label: "🔴 Engineering/code change" },
] as const;
