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
