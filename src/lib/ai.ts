import "server-only";
import { matchIntent, type IntentAction, type IntentMatch } from "./intent-engine";

// ─────────────────────────────────────────────────────────────────────────────
// AI layer — provider-agnostic (Claude / OpenAI / Gemini). It does three jobs:
//   1) understand()      — pick an ALLOWED action + entities from the user's words,
//                          USING recent conversation so references ("her fees",
//                          "and the other one") and topic switches resolve.
//   2) humanizeReply()   — rephrase the REAL connector result into a warm, natural
//                          human reply, in the flow of the conversation, strictly
//                          grounded (no invented facts).
//   3) smallTalk()       — respond kindly, in context, to off-topic chit-chat.
//
// Guardrails: the AI never reaches a system or invents data. For understanding it
// may only choose from configured actions (re-validated). For replies it only
// rephrases facts we already retrieved and hands it. It never reveals it is AI.
// Everything degrades gracefully to the deterministic engine / templates with no
// API key, so the platform always works offline.
// ─────────────────────────────────────────────────────────────────────────────

type Provider = "anthropic" | "openai" | "google" | "xai";

/** A prior turn in this conversation, oldest→newest, so the AI has memory. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

/** Which providers actually have a key configured. */
function hasKey(p: Provider): boolean {
  return p === "anthropic" ? !!process.env.ANTHROPIC_API_KEY
    : p === "openai" ? !!process.env.OPENAI_API_KEY
    : p === "xai" ? !!process.env.XAI_API_KEY
    : !!process.env.GEMINI_API_KEY;
}

/** The ORDERED list of providers to try: the configured primary first, then any
 *  other providers that have a key, as automatic failover. So if the primary is
 *  throttled/down (e.g. free-tier Gemini 429/503), the reply still goes out via a
 *  backup key instead of falling to a canned template. Add a 2nd key to enable. */
function providerChain(): Provider[] {
  const all: Provider[] = ["google", "anthropic", "openai", "xai"];
  const configured = (process.env.AI_PROVIDER || "").toLowerCase();
  const primary = all.find((p) => p === configured && hasKey(p))
    ?? all.find(hasKey); // auto-detect if AI_PROVIDER unset/keyless
  const chain: Provider[] = [];
  if (primary) chain.push(primary);
  for (const p of all) if (hasKey(p) && !chain.includes(p)) chain.push(p);
  return chain;
}

export function aiEnabled(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.XAI_API_KEY);
}

/** General-purpose completion for super-app TOOLS (data analysis, doc summary,
 *  rewrite…). Goes through the same retry + provider-failover chain, so tools get
 *  the same reliability as the chat layer. Returns text or null. */
export async function complete(system: string, user: string, maxTokens = 900, temperature = 0.3): Promise<string | null> {
  if (!aiEnabled()) return null;
  return callLLM(system, user, { maxTokens, temperature });
}

/** Transcribe a WhatsApp voice note to text (Gemini is multimodal). Returns the
 *  spoken text in its original language, or null if we can't understand it. Lets
 *  users TALK to the assistant, not just type. Needs a Gemini key + audio-capable
 *  model (lite models may not accept audio, so use a full flash model for STT). */
export async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.GEMINI_STT_MODEL || "gemini-flash-latest";
  try {
    const res = await fetchT(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { text: "Transcribe this voice message verbatim into text, in the SAME language that is spoken. Output ONLY the transcription — no quotes, no commentary. If nothing intelligible is said, output nothing." },
            { inlineData: { mimeType: mimeType || "audio/ogg", data: base64 } },
          ] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0 },
        }),
      },
      20_000, // audio can take longer than a text turn
    );
    if (!res || !res.ok) return null;
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

type LLMOpts = { maxTokens?: number; temperature?: number; history?: ChatTurn[] };

// A hung or slow model must NEVER hold up the user's reply — on a real channel
// that means no WhatsApp message arrives at all. Any call that exceeds this
// budget is aborted and the caller falls back to the deterministic template.
const LLM_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 9000);

/** fetch() with a hard abort timeout. Returns null on timeout/abort. */
async function fetchT(url: string, init: RequestInit, timeoutMs = LLM_TIMEOUT_MS): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Completion with retries AND provider failover. Each provider in the chain is
 *  tried a couple of times (transient 429/503/timeout backoff); if it still fails,
 *  we fall over to the next configured provider before giving up to the
 *  deterministic template. A single throttled key no longer silences the reply. */
async function callLLM(system: string, user: string, opts: LLMOpts = {}): Promise<string | null> {
  const chain = providerChain();
  const perProvider = Number(process.env.AI_ATTEMPTS || 2);
  for (const p of chain) {
    for (let i = 0; i < perProvider; i++) {
      const out = await callOnce(p, system, user, opts);
      if (out) return out;
      if (i < perProvider - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1))); // 300ms, 600ms…
    }
    // This provider failed every attempt → fall over to the next configured one.
  }
  return null;
}

/** Single completion attempt against ONE provider, with optional multi-turn history. */
async function callOnce(p: Provider, system: string, user: string, opts: LLMOpts = {}): Promise<string | null> {
  const { maxTokens = 300, temperature = 0.4 } = opts;
  // Gemini and Anthropic REQUIRE the first turn to be a user turn. Our history is
  // a raw slice of recent messages, so it may start with an assistant reply —
  // passing that verbatim makes the whole call 400 and the AI silently falls back.
  // Drop any leading assistant turns so history always starts with a user turn.
  let history = opts.history ?? [];
  while (history.length && history[0].role === "assistant") history = history.slice(1);
  try {
    // OpenAI and xAI (Grok) share the same Chat Completions request shape — only
    // the base URL, key and default model differ.
    if ((p === "openai" && process.env.OPENAI_API_KEY) || (p === "xai" && process.env.XAI_API_KEY)) {
      const isXai = p === "xai";
      const url = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
      const key = isXai ? process.env.XAI_API_KEY! : process.env.OPENAI_API_KEY!;
      const model = isXai ? (process.env.XAI_MODEL || "grok-4") : (process.env.OPENAI_MODEL || "gpt-4o-mini");
      const res = await fetchT(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: "system", content: system },
            ...history.map((t) => ({ role: t.role, content: t.text })),
            { role: "user", content: user },
          ],
        }),
      });
      if (!res || !res.ok) return null;
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return j.choices?.[0]?.message?.content?.trim() ?? null;
    }
    if (p === "google" && process.env.GEMINI_API_KEY) {
      const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
      // Full "thinking" flash models (e.g. gemini-3.x-flash) burn the output-token
      // budget on hidden reasoning and truncate the visible reply, so we turn it
      // off. But the fast "lite" models don't support thinkingConfig at all (400),
      // and don't need it — so only send it to non-lite models.
      const genCfg: Record<string, unknown> = { maxOutputTokens: maxTokens, temperature };
      if (!/lite/i.test(model)) genCfg.thinkingConfig = { thinkingBudget: 0 };
      const res = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            ...history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
            { role: "user", parts: [{ text: user }] },
          ],
          generationConfig: genCfg,
        }),
      });
      if (!res || !res.ok) return null;
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    }
    if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      const res = await fetchT("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
          max_tokens: maxTokens,
          temperature,
          system,
          messages: [
            ...history.map((t) => ({ role: t.role, content: t.text })),
            { role: "user", content: user },
          ],
        }),
      });
      if (!res || !res.ok) return null;
      const j = (await res.json()) as { content?: { text?: string }[] };
      return j.content?.[0]?.text?.trim() ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

// The org's local timezone for dates/times the assistant reasons about. Defaults
// to East Africa (these are Kenyan orgs); override with APP_TIMEZONE.
const TZ = process.env.APP_TIMEZONE || "Africa/Nairobi";

/** morning | afternoon | evening | night, in the org's local timezone. */
export function partOfDay(): string {
  try {
    const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: TZ }));
    return h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  } catch {
    return "day";
  }
}

/** A friendly, human-readable "now" the AI can reason about — date, local clock
 *  time and part of day — so it can tell the time and greet appropriately. */
function nowStr(): string {
  try {
    const d = new Date();
    const date = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
    return `${date}, ${time} (${partOfDay()}), local time in ${TZ}`;
  } catch {
    return new Date().toISOString();
  }
}

// Lightweight EN/SW detector so we can give the model an EXPLICIT language to
// reply in, instead of hoping it infers it (it tends to drift to the language of
// recent history). Counts distinctive frequent words in each language; the higher
// count wins. Returns null for too-short/ambiguous/mixed input (let the model
// decide from the message itself). Good enough for the common English↔Swahili case.
const SW_WORDS = /\b(ni|na|ya|wa|kwa|la|za|cha|vya|kwenye|kuhusu|nataka|ninahitaji|naomba|tafadhali|asante|karibu|habari|mambo|sasa|pole|poleni|samahani|salio|ada|deni|mtoto|wangu|wako|mwalimu|shule|tarehe|lini|nini|vipi|leo|kesho|jana|ndio|ndiyo|hapana|mwanafunzi|mahudhurio|matokeo|miadi|lipa|hodi|jambo|nzuri|sawa|niambie|onyesha|angalia)\b/gi;
const EN_WORDS = /\b(the|is|are|was|my|your|what|when|where|how|why|please|need|want|show|tell|give|me|a|an|of|to|for|and|you|i|do|does|can|could|would|will|this|that|it|more|about|everything|general|overview|balance|fee|fees|child|school|today|tomorrow|yes|no|thanks|thank|hello|hi|results|attendance|appointment|arrived|owe)\b/gi;
function detectLang(text: string): "English" | "Swahili" | null {
  const sw = (text.match(SW_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  if (sw === 0 && en === 0) return null;
  if (sw > en) return "Swahili";
  if (en > sw) return "English";
  return null; // tie → ambiguous/mixed
}

/** Today's calendar date (YYYY-MM-DD) in the org timezone. */
function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // en-CA → YYYY-MM-DD
}

/** Whole days from today to an ISO date (positive = future, negative = past). */
function daysFromToday(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayISO());
  if (!m || !t) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = Date.UTC(+t[1], +t[2] - 1, +t[3]);
  return Math.round((target - today) / 86_400_000);
}

/** Precompute how far each date in the facts is from today, so the AI can answer
 *  "how many days until…" ACCURATELY (deterministic math, not model arithmetic). */
function dateHints(factText: string): string {
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const iso of factText.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
    if (seen.has(iso)) continue;
    seen.add(iso);
    const d = daysFromToday(iso);
    if (d === null) continue;
    const rel =
      d === 0 ? "that is TODAY" :
      d === 1 ? "that is TOMORROW (1 day from today)" :
      d === -1 ? "that was YESTERDAY (1 day ago)" :
      d > 1 ? `that is ${d} days from today` :
      `that was ${-d} days ago`;
    hints.push(`- ${iso}: ${rel}.`);
  }
  return hints.length ? `\n\nTEMPORAL CONTEXT (today is ${todayISO()} — use ONLY if the user asks about timing/how many days; these are exact, trust them):\n${hints.join("\n")}` : "";
}

/** An explicit language instruction for reply prompts, based on THIS message. */
function langDirective(text: string): string {
  const lang = detectLang(text);
  return lang
    ? `Reply ONLY in ${lang}. The user's current message is in ${lang}, so your entire reply must be in ${lang}.`
    : `Reply in the SAME language as the user's current message (English → English, Swahili → Swahili, Sheng/mixed → mirror it).`;
}

/** Render recent history as a compact transcript for prompts that need it inline. */
function transcript(history: ChatTurn[], max = 8): string {
  return history
    .slice(-max)
    .map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${t.text}`)
    .join("\n");
}

// ── 1) Intent understanding (controlled tools, context-aware) ───────────────
export async function understand(text: string, actions: IntentAction[], history: ChatTurn[] = []): Promise<IntentMatch & { via: "ai" | "local" }> {
  if (!aiEnabled()) return { ...matchIntent(text, actions), via: "local" };
  const allowed = actions.map((a) => a.key);
  const catalog = actions.map((a) => `- ${a.key}: ${a.name}${a.description ? ` — ${a.description}` : ""} (e.g. ${(a.samplePhrases ?? []).slice(0, 3).join("; ")})`).join("\n");
  const convo = history.length ? `RECENT CONVERSATION (use it to resolve references like "her", "that one", follow-ups like "and the fees?", and topic switches):\n${transcript(history)}\n\n` : "";
  const system = `You are an intent router for a WhatsApp assistant. Choose the single best action for what the user wants NOW, from the ALLOWED list, or "NONE" if nothing fits.
- Use the recent conversation to interpret short or referring messages (e.g. after talking about a student named Zawadi, "and her fees?" means the fee-balance action for Zawadi).
- ASKING vs DOING: if the user is asking for information about something that may already exist ("when is…", "what's…", "do I have…", "check…", "show…", "next appointment/meeting"), pick the matching LOOKUP/GET action — NOT a create/book/submit action. Only pick a create/book/schedule/submit/cancel action when the user clearly wants to make or change something ("book", "schedule", "request", "I want to create", "cancel").
- If the message is about something you have NO action for — staff/people like a driver, cook, headmaster, a teacher's name, bus routes, uniforms, directions, general trivia — return "NONE". NEVER map an unrelated question onto a student-data action (e.g. do not answer "who is the driver of the school?" with a fee balance). Pick an action ONLY when the message genuinely matches what that action does.
- META / ELIGIBILITY / small clarifying questions about the SERVICE itself are NOT data lookups → return "NONE". Examples: "parents only?", "is this only for parents?", "who can use this?", "what can you do?", "are you a bot?", "how does this work?". Do not trigger an action just because a keyword (like "parents") appears in such a question.
- TIMING / "HOW MANY DAYS" questions: "how many days until / how long until / how soon is / when is <event>" about an appointment or meeting → the NEXT-APPOINTMENT lookup; about a due date/payment → the FEE/BALANCE lookup. Route to whichever LOOKUP returns that event's DATE (do NOT pick attendance just because the word "days" appears).
- BROAD / VAGUE requests: if the message is a broad, open-ended, or summary-style request that does NOT clearly point to ONE specific action — e.g. "tell me about Zawadi", "give me an overview of everything about my child", "how is she doing", "everything about X", "general info" — return "NONE". Do NOT force it into a single action like fees or results. (The assistant will then offer the specific things it can show.) Only pick a specific action when the user clearly wants that ONE thing.
- Extract entities (a person's name — resolve pronouns from context; dates; times). Right now it is ${nowStr()} — resolve relative dates/times like "today", "tomorrow", "next Friday", "this evening" against it. Never invent an action not in the list.`;
  const user = `${convo}ALLOWED ACTIONS:\n${catalog}\n\nCurrent user message: ${JSON.stringify(text)}\n\nRespond with ONLY compact JSON: {"action":"<KEY or NONE>","confidence":0..1,"entities":{"name":"...","date":"...","time":"..."}}`;
  const raw = await callLLM(system, user, { maxTokens: 250, temperature: 0 });
  if (raw) {
    try {
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { action: string; confidence?: number; entities?: Record<string, string> };
      if (parsed.action && parsed.action !== "NONE" && allowed.includes(parsed.action)) {
        const chosen = actions.find((a) => a.key === parsed.action)!;
        const score = Math.min(1, Math.max(0, parsed.confidence ?? 0.7));
        const entities = Object.fromEntries(Object.entries(parsed.entities ?? {}).filter(([, v]) => v != null && String(v).trim() !== "")) as Record<string, string>;
        return { actionId: chosen.id, actionKey: chosen.key, score, entities, candidates: [{ actionId: chosen.id, actionKey: chosen.key, score }], via: "ai" };
      }
      if (parsed.action === "NONE") {
        // The AI is confident nothing fits (e.g. a broad "tell me about X"). TRUST
        // it — only override with the deterministic engine on a VERY strong keyword
        // hit, so vague requests go to small talk instead of being forced into a
        // random action (that's what made "tell me more about X" ask for a date).
        const local = matchIntent(text, actions);
        if (local.actionId && local.score >= 0.85) return { ...local, via: "local" };
        return { actionId: null, actionKey: null, score: 0, entities: {}, candidates: [], via: "ai" };
      }
    } catch {
      /* fall through */
    }
  }
  return { ...matchIntent(text, actions), via: "local" };
}

// ── 1b) Commerce intent (typo/language-tolerant, grounded to the REAL catalog) ──
// Same discipline as understand(): the AI picks from a list it's given (real
// product ids only, never invented) and returns "none" when unsure rather than
// guessing. This exists because keyword regexes cannot handle typos ("procys"),
// alternate phrasing ("how much is X" ≠ an order), or non-English input
// (Swahili "bei gani", "nataka tano") — all real, reported failures.
export type CommerceIntent =
  | { kind: "browse" }
  | { kind: "order"; productId: string; quantity?: number; optionAnswer?: string }
  | { kind: "price_question"; productId?: string }
  | { kind: "image_question"; productId?: string }
  | { kind: "none" };

export async function classifyCommerceMessage(
  text: string,
  products: { id: string; name: string }[],
  history: ChatTurn[] = [],
): Promise<CommerceIntent> {
  if (!aiEnabled() || products.length === 0) return { kind: "none" };
  const catalog = products.map((p) => `- id="${p.id}": ${p.name}`).join("\n");
  const convo = history.length ? `RECENT CONVERSATION (use it to resolve short follow-ups — e.g. after discussing "the sweater", "blue, any size, five of them" answers THAT product):\n${transcript(history)}\n\n` : "";
  const system = `You are a shopping-intent classifier for a WhatsApp business assistant. The business sells EXACTLY these products — never invent, assume, or match a different one:
${catalog}

Classify the user's CURRENT message. Understand ANY language (English, Swahili, Sheng, mixed) and tolerate typos/shorthand — read for MEANING, not exact keywords.
- "browse": asking what's for sale in general, not about one specific product.
- "order": wants to buy/order a SPECIFIC product from the list. Extract quantity as a number if one was genuinely stated, in ANY language or word form ("tano"→5, "five"→5, "5"→5) — omit if not stated, never default to 1. If the message also answers a color/size/variant choice, put that free text in optionAnswer.
- "price_question": asking the price/cost/"how much"/"bei gani" for a product (a specific one if identifiable, else omit productId).
- "image_question": asking to see a photo/picture/image of a product.
- "none": anything else — a different question, small talk, unrelated topic. If genuinely unsure which of the above it is, choose "none" rather than guessing.

Respond with ONLY compact JSON: {"kind":"browse"|"order"|"price_question"|"image_question"|"none","productId":"<exact id from the list, or omit>","quantity":<number, or omit>,"optionAnswer":"<text, or omit>"}`;
  const raw = await callLLM(system, `${convo}Current message: ${JSON.stringify(text)}`, { maxTokens: 150, temperature: 0 });
  if (!raw) return { kind: "none" };
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { kind?: string; productId?: string; quantity?: number; optionAnswer?: string };
    const validId = parsed.productId && products.some((p) => p.id === parsed.productId) ? parsed.productId : undefined;
    if (parsed.kind === "order" && validId) {
      return { kind: "order", productId: validId, quantity: typeof parsed.quantity === "number" && parsed.quantity > 0 ? Math.floor(parsed.quantity) : undefined, optionAnswer: parsed.optionAnswer || undefined };
    }
    if (parsed.kind === "price_question") return { kind: "price_question", productId: validId };
    if (parsed.kind === "image_question") return { kind: "image_question", productId: validId };
    if (parsed.kind === "browse") return { kind: "browse" };
    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

/** Interprets a free-form reply to ONE pending order question (quantity, a
 *  color/size choice, delivery-vs-pickup, or a delivery address) when the fast
 *  deterministic check didn't recognize it. Used so a state never just repeats
 *  its canned question verbatim when the customer said something real — asks
 *  something else, answers unclearly, or the wording just didn't match a
 *  regex. If they answered, extracts the value; if not, produces an honest,
 *  natural, non-repetitive reply (answering their real question if it can from
 *  what it actually knows) that still ends by restating what's needed. */
export async function resolveOrderStepAnswer(opts: {
  assistant: string;
  question: string; // what we're waiting for, in plain words, e.g. "how many they want" | "delivery or pickup" | "their delivery address" | "which color/size (Colors: Navy, Grey)"
  userText: string;
  knownFacts?: string;
  history?: ChatTurn[];
}): Promise<{ answered: true; value: string } | { answered: false; reply: string }> {
  if (!aiEnabled()) return { answered: false, reply: "" };
  const known = `\n\nWHAT YOU ACTUALLY KNOW ABOUT THIS PRODUCT (this is the COMPLETE list — nothing else about it is known, not even by inference):\n${opts.knownFacts || "(nothing beyond the name)"}`;
  const system = `You are a warm, sharp human staff member for ${opts.assistant} on WhatsApp, mid-way through taking an order. You are currently waiting for ONE specific thing: ${opts.question}.

The customer just replied. Two possibilities:
1. Their reply GENUINELY answers what you asked (even phrased oddly, in another language, or with a typo) — extract it.
2. They said something else — a real question, a comment, confusion, pushback — not an answer.

LANGUAGE: ${langDirective(opts.userText)}
CRITICAL RULE — DO NOT INVENT: if they ask about ANYTHING not explicitly listed under "WHAT YOU ACTUALLY KNOW" below (colors, sizes, materials, stock, brand, specs, delivery time, anything) — do NOT guess or make up a plausible-sounding answer, even one word of it. Say plainly that it's not something you have on file and you'll check with the team, THEN continue toward what you still need. Inventing details that don't exist is the single worst thing you can do here — a customer could pay for something based on a detail you made up. When in doubt, say you don't know.
Never just repeat a canned line — sound like a real person, vary your wording, a touch of warmth or light humor is welcome but keep it brief and helpful, then naturally circle back to what you still need.${known}

Respond with ONLY compact JSON:
{"answered": true, "value": "<the extracted answer, exactly as they'd want it recorded>"} — if case 1
{"answered": false, "reply": "<your natural reply text>"} — if case 2`;
  const raw = await callLLM(system, `Customer said: ${JSON.stringify(opts.userText)}`, { maxTokens: 200, temperature: 0.6, history: opts.history });
  if (!raw) return { answered: false, reply: "" };
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { answered?: boolean; value?: string; reply?: string };
    if (parsed.answered && parsed.value) return { answered: true, value: String(parsed.value) };
    if (parsed.reply) return { answered: false, reply: String(parsed.reply) };
    return { answered: false, reply: "" };
  } catch {
    return { answered: false, reply: "" };
  }
}

// ── 2) Human-like reply (grounded rephrase — no hallucination, in flow) ─────
export async function humanizeReply(orgName: string, userText: string, factText: string, history: ChatTurn[] = []): Promise<string> {
  if (!aiEnabled() || !factText) return factText;
  const system = `You are the friendly WhatsApp assistant for ${orgName}, talking one-to-one with someone you're already in a conversation with. Rewrite the ANSWER as a warm, natural, human-sounding reply that fits the flow of the chat.
STRICT RULES:
- LANGUAGE (important): ${langDirective(userText)} EVEN IF earlier messages in the history were in a different language. Do not switch languages on your own.
- Keep every number, amount, currency, date, time, reference and name EXACTLY as given in the ANSWER (translate the wording around them if needed, but never change a digit, name or date).
- Do NOT add, guess, or invent any fact that is not in the ANSWER. EXCEPTION: if the user asks about timing ("how many days until…", "is that soon", "what day is that"), you MAY use the TEMPORAL CONTEXT below to tell them how many days away a date is — those figures are pre-calculated and exact. Still keep the original date too.
- Do NOT say you are a bot, an AI, an assistant program, or automated. Sound like a helpful person.
- If it's a follow-up (e.g. "and her fees?"), answer naturally as a continuation, not as a fresh greeting.
- Keep it concise and WhatsApp-appropriate (usually 1–3 short sentences). A tasteful emoji is fine.
Reply with ONLY the message text — no preamble.`;
  const user = `The user just asked (reply in THIS message's language): ${JSON.stringify(userText)}\n\nANSWER to convey (keep all facts — numbers, dates, names — exactly): ${JSON.stringify(factText)}${dateHints(factText)}`;
  const out = await callLLM(system, user, { maxTokens: 220, temperature: 0.5, history });
  return out && out.length > 1 ? out : factText;
}

// ── 3) Small talk / general conversation (human, grounded) ──────────────────
export type Faq = { q: string; a: string };

export async function smallTalk(orgName: string, userText: string, capabilities: string[], history: ChatTurn[] = [], knownFacts = "", faqs: Faq[] = []): Promise<string | null> {
  if (!aiEnabled()) return null;
  const known = knownFacts ? `\n\nWHAT YOU ALREADY KNOW (authorized — you MAY share these if asked):\n${knownFacts}` : "";
  const faqBlock = faqs.length
    ? `\n\nAPPROVED ORGANIZATION ANSWERS (official — if the user's question matches one of these, answer using this information; you may reword it naturally but keep every fact, number, date and name exact):\n${faqs.map((f) => `- Q: ${f.q}\n  A: ${f.a}`).join("\n")}`
    : "";
  const system = `You are a warm, switched-on human staff member replying on ${orgName}'s WhatsApp. Talk like a real person — never say or imply you are a bot, AI, or automated. Right now it is ${nowStr()}.

The user said something that isn't one of your bookable services, is chatting, or is unclear. Reply naturally, like a helpful colleague would — warm and genuinely engaged, never robotic or boring.

IF THE MESSAGE IS UNCLEAR OR PARTIAL (e.g. just "my sister", "the results", "help", "that one"): do NOT dump a list of options and do NOT jump to a random service. Ask ONE friendly, specific clarifying question to pin down what they actually need (e.g. "Sure — what would you like to know about your sister's schooling? For example her attendance, results, or fees?"). If they refer to a person you don't have on file, gently say who you DO have linked (from WHAT YOU ALREADY KNOW) and offer to help with them.

LANGUAGE: ${langDirective(userText)} If an approved answer or known fact below is written in another language, translate it into that language while keeping every number, date, name and reference exact. Ignore the language of earlier messages — match THIS message. Never switch languages on your own.

WHAT YOU CAN DO FREELY:
- Answer general everyday questions using common sense and REAL general/world knowledge, confidently — the current date, day of the week, the time of day (you DO know these from "Right now it is …" above), geography, common facts, everyday reasoning. Don't hedge on things you genuinely know. If someone jokes or says something that doesn't add up (wrong facts, a town that isn't near the sea, etc.), you can warmly call it out or tease back — a real, switched-on person would. Handle greetings, banter, and small courtesies naturally, with real personality, never flat or robotic.
- Answer using the APPROVED ORGANIZATION ANSWERS below when the question matches one (hours, dates, locations, policies, payment methods, etc.) — state these as plain fact, confidently, they're real and approved.
- Share the facts under "WHAT YOU ALREADY KNOW" if the user asks (e.g. their own name, their child's/record's name).
- IDENTITY: the CONTACT you're chatting with is NEVER the same person as a linked record unless explicitly stated. If asked "who is <name>" about a linked record, explain the RELATIONSHIP (e.g. "Kevin Otieno is the student linked to your account, Grade 6") — never say "You are <name>". If the contact's own name isn't known, don't invent or assign one.
- After answering, if it's natural, gently mention you can also help with: ${capabilities.join("; ")}.

WHAT YOU MUST NOT DO — THIS IS THE MOST IMPORTANT RULE, NEVER BREAK IT:
- Never invent ORGANIZATION-SPECIFIC or PERSONAL details you weren't given. If the question is about the organization (fees, policies, hours, dates, prices, photos, physical items, anything real-world) and it is NOT covered by the APPROVED ORGANIZATION ANSWERS or "WHAT YOU ALREADY KNOW", say plainly that you don't have that on hand and that they should reach the office/business directly themselves.
- NEVER offer to "check", "ask", "find out", or "get back to you" on something — you have no actual way to relay a message to anyone or receive a reply, so that offer can never be honestly followed through on. And if you ever find yourself about to say you DID check, ask, verify, or contact someone — STOP. You did not. Say so honestly instead ("I'm not able to check that myself, best to reach out to the office directly") rather than inventing a completed action and a result that never happened. Fabricating a check-in and its outcome is a real lie to someone who trusted you — the single worst thing you can do here, worse than saying "I don't know."
- Never invent a person's fees, balances, grades, exam results, attendance or appointment times — those come only from an authorized lookup.
- Never invent whether something DID or DIDN'T happen (an order, a payment, a message you supposedly sent). If "WHAT YOU ALREADY KNOW" below states something real happened, treat it as fact and never contradict it, deny it, or call it a "test"/"mistake" — that is real user-facing history, not a hypothetical. If nothing there covers what's being asked, say you don't have that on record rather than guessing either way.${known}${faqBlock}

Keep it to 1–3 short, natural sentences. Reply with ONLY the message text.`;
  return callLLM(system, userText, { maxTokens: 200, temperature: 0.6, history });
}
