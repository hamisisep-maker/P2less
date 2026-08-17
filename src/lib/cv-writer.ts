import "server-only";
import { complete } from "./ai";
import type { CvData } from "./documents";

// ─────────────────────────────────────────────────────────────────────────────
// CV writer — conversational, not a single-shot tool. Someone might dump their
// whole career history in one message, or spread it across several ("I worked
// at X..." then later "oh and I studied Y..."). We accumulate their raw words
// across turns (conversation.ts owns that state) and re-attempt extraction each
// time, only generating once we have enough to produce something genuinely
// useful — never inventing employers, dates, or achievements they didn't give us.
// ─────────────────────────────────────────────────────────────────────────────

export type CvExtraction = { sufficient: true; data: CvData } | { sufficient: false; missing: string[] };

/** Does this message look like a request to write/build a CV or resume? */
export function isCvRequest(lower: string): boolean {
  return /\b(cv|curriculum vitae|resume|résumé)\b/i.test(lower) && /\b(write|create|make|build|prepare|draft|design|need|want|help|do|update|fix)\b/i.test(lower);
}

export async function extractCvData(rawText: string): Promise<CvExtraction> {
  const system = `You are helping someone build a professional CV/resume from what they've told you about themselves, over one or more messages.

Extract ONLY facts they actually stated. NEVER invent an employer, job title, date, qualification, or achievement they didn't mention. If something is genuinely missing, say so — don't guess or pad it out.

Consider it SUFFICIENT once you have: their name, at least one way to reach them (phone or email), and at least one work experience OR education entry. Skills and a summary are nice-to-have, not required to proceed.

If NOT sufficient, list what's still needed in "missing" — short, friendly, plain-English items (e.g. "your phone number or email", "at least one job or your education background"), not a robotic field name.

If sufficient: also write a short, natural 1–2 sentence professional summary IF they didn't give one — grounded strictly in what they told you, no invented accomplishments or seniority.

Respond with ONLY this JSON shape, nothing else:
{"sufficient": true|false, "missing": ["..."], "data": {"name": "...", "contact": "phone/email/location, one line", "title": "professional headline or empty", "summary": "...", "experience": [{"role":"...","company":"...","dates":"...","bullets":["..."]}], "education": [{"qualification":"...","institution":"...","dates":"..."}], "skills": ["..."]}}`;
  const user = `What the person has told us about themselves so far:\n${rawText}\n\nRespond with ONLY the JSON.`;

  const out = await complete(system, user, 1000, 0.4);
  if (!out) return { sufficient: false, missing: ["a bit more about yourself — your name, contact details, and your work or education background"] };

  try {
    const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as {
      sufficient?: boolean;
      missing?: string[];
      data?: Partial<CvData>;
    };
    if (parsed.sufficient && parsed.data?.name) {
      const data: CvData = {
        name: parsed.data.name,
        contact: parsed.data.contact ?? "",
        title: parsed.data.title || undefined,
        summary: parsed.data.summary || undefined,
        experience: Array.isArray(parsed.data.experience) ? parsed.data.experience : [],
        education: Array.isArray(parsed.data.education) ? parsed.data.education : [],
        skills: Array.isArray(parsed.data.skills) ? parsed.data.skills : [],
      };
      return { sufficient: true, data };
    }
    return { sufficient: false, missing: parsed.missing?.length ? parsed.missing : ["your name, contact details, and either work experience or education"] };
  } catch {
    return { sufficient: false, missing: ["a bit more about yourself — could you tell me again in a bit more detail?"] };
  }
}
