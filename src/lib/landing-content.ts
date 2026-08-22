// Canonical marketing copy for the public landing page (`src/app/page.tsx`).
// The FAQ list below is the SAME list seeded verbatim onto the self-referential
// "P2Less" tenant's `Tenant.faqs` by `scripts/setup-self-tenant.ts` — imported
// from here by both, so the on-page accordion and the live embedded widget's
// grounded answers can never drift apart. One canonical list, two renderings.

export type Faq = { q: string; a: string };

export const LANDING_FAQS: Faq[] = [
  {
    q: "Do my customers need to install an app?",
    a: "No. They message the number they already have — your WhatsApp number, your Facebook Page, your Telegram bot, your email address, or the chat bubble on your own website. Nothing new to download, nothing to sign up for.",
  },
  {
    q: "Is our data isolated from other organizations on P2Less?",
    a: "Yes. Every organization is a separate tenant — your conversations, contacts, and connected systems are never visible to another organization, and every single action is checked against your own permissions before it runs.",
  },
  {
    q: "Does P2Less ever change our own systems?",
    a: "Only through the specific, permissioned actions you configure — booking a slot, submitting a leave request, publishing a product. P2Less never gets free-form access to your database. Your own records stay exactly where they already live.",
  },
  {
    q: "Which systems can P2Less connect to?",
    a: "Any system with an API — school management systems, payroll/HR, hospital patient management, retail/order systems, and more. Developers can paste an OpenAPI spec and get a working connector in minutes, or install one of our ready-made templates.",
  },
  {
    q: "Is this only for WhatsApp?",
    a: "No — the same assistant, with the same knowledge and the same rules, also runs on Facebook Messenger, Telegram, email, and a chat widget for your own website. One assistant, wherever your customers already are.",
  },
  {
    q: "How is pricing calculated?",
    a: "A flat monthly plan fee, plus a small per-use cost for messages, AI requests, and documents generated — so you always know your floor, and it scales fairly with how much you actually use it. Free to start — we verify a real card with a $0 authorization as part of signup, but you're never charged unless you upgrade.",
  },
  {
    q: "Can government or regulated institutions use P2Less?",
    a: "Yes. Every action is permission-gated and recorded in a full audit trail, sensitive records require step-up verification before they're ever shared, and each organization's data is fully isolated. Institutional and government deployments are priced on our Enterprise tier.",
  },
  {
    q: "Does the assistant ever make things up?",
    a: "No — it only ever answers from your own approved FAQs, your connected systems' real data, or a live handoff to your staff. If it genuinely doesn't know, it says so. It never invents an answer to sound helpful.",
  },
  {
    q: "Can I try it before connecting my own number?",
    a: "Yes — you're already talking to a real, live P2Less assistant right on this page. You can also open our sandbox to message demo organizations across different industries and see the WhatsApp side of the experience too.",
  },
  {
    q: "How do I sign up?",
    a: "Click the 'Start free' button at the top of this page (or the one in this chat's footer) — it takes a couple of minutes. Part of signing up verifies a real card via a $0 authorization (never charged), then you're in, free to start.",
  },
  {
    q: "Where can I find more details, FAQs, or your pricing?",
    a: "Right here — this page itself has the full pricing breakdown, a security section, and more FAQs further down. There's no separate site to visit; everything about P2Less is on this one page.",
  },
  {
    q: "How many customers/clients do you have?",
    a: "We're honest that P2Less is newly launched — this is real, working software you're using right now, not a mockup, but we don't have a public customer count or client list to share yet. If you sign up, you'd be one of our very first, with direct access to the person who built it.",
  },
  {
    q: "Do you have testimonials or client reviews?",
    a: "Not yet — we're a new platform and haven't collected public testimonials. Everything described on this page is real and working today though, including the assistant you're talking to right now — the best way to judge it is to try it yourself, here or in the live demo.",
  },
  {
    q: "Are you GDPR compliant?",
    a: "We haven't done GDPR-specific compliance work — that's the EU's framework, and it's a different, separate thing from what we've actually built and verified. P2Less's real compliance work so far is around Kenya's Data Protection Act: Hamzone Technologies (the company behind P2Less) is a registered Kenyan company, and our formal registration with Kenya's data protection regulator (the ODPC) is in progress. If GDPR compliance is a hard requirement for your organization, get in touch directly so we can talk through your specific needs honestly.",
  },
  {
    q: "Exactly what do I get on the Free plan, and what happens if I go over?",
    a: "The Free plan includes 2 users, 200 messages/month, 1 connector, 100 AI requests/month, and 20 documents/month — real hard limits, not a soft 'included then billed' allowance. Once you hit a limit, that specific thing stops until next month or you upgrade — no surprise overage bill. Paid plans (Professional, Business) raise every one of these ceilings substantially.",
  },
  {
    q: "Have you ever had downtime or a security breach?",
    a: "We're a newly-launched platform, so honestly, we don't have a long operating history or a formal public track record to point to yet. What we can tell you concretely is what's actually built: isolated tenant data, encrypted credentials, a real audit trail, and active health monitoring — the real mechanisms, not a track-record claim we can't back up yet.",
  },
  {
    q: "How big is your team / how many employees do you have?",
    a: "P2Less is built and run by its founder, Hamisi Onesmus Kilumo, through Hamzone Technologies — a lean, founder-led operation right now, not a large company. That means direct access to the person who actually built the platform, not a support queue.",
  },
  {
    q: "Are you VC-funded? Who are your investors?",
    a: "We haven't published details about funding or ownership — if that's relevant to evaluating us, reach out directly and we'll talk through it honestly.",
  },
  {
    q: "Is there a contract, or can I cancel anytime?",
    a: "The Free, Professional, and Business plans are all month-to-month — no annual contract, cancel anytime. Enterprise is priced and negotiated case-by-case, so its specific terms are worked out directly with you.",
  },
  {
    q: "What are your API rate limits?",
    a: "120 requests per minute per API key — a flat limit, the same for every plan. If a real integration needs more than that, reach out and we can talk it through.",
  },
  {
    q: "What currency do you bill in — USD or KES?",
    a: "Kenyan Shillings (KES) — every price shown on this page (Free, Professional at 4,900 KES/mo, Business at 19,900 KES/mo) is in KES. Enterprise is negotiated case-by-case, and currency there can be discussed directly.",
  },
  {
    q: "Can I export my data if I ever want to leave?",
    a: "There's no self-service export button today — it's a request-based process, not automated. To access or export your data, contact the organization you communicated with, or reach out to us directly and we'll action it. There's no lock-in contract stopping you either way (see the cancellation question above).",
  },
  {
    q: "What languages does the assistant support — English only?",
    a: "It's not limited to English — it matches whatever language you write in, including Swahili and Sheng, and replies in kind. No language setting to configure, just type naturally.",
  },
  {
    q: "Do you have backups or a disaster-recovery plan if your servers crash?",
    a: "Honestly, not a formal one yet — no automated backup schedule is running today. We're a newly-launched platform (see the downtime/security-breach question above) and this is a real gap we're upfront about rather than claiming otherwise. If data safety at that level is critical for you right now, raise it directly before signing up so we can talk through it.",
  },
  {
    q: "Which AI model or company powers the assistant — is it OpenAI's GPT-4?",
    a: "It's not tied to any single AI vendor or model. P2Less automatically fails over across several major AI providers for reliability, so one provider having a slow day never takes the whole assistant down. We don't publicly commit to one specific model/company as \"the\" engine, since that mix is chosen for reliability and can change.",
  },
  {
    q: "Do I get an analytics dashboard — conversations, response times, usage?",
    a: "Yes for conversations and usage: your dashboard shows message volume trends, conversation counts and status breakdown, connector activity, and contact counts, all real-time from your own data. Response-time metrics specifically aren't tracked yet — that's a real gap, not built today.",
  },
  {
    q: "Can I customize the widget's bubble position or greeting message myself?",
    a: "Not yet through a self-service settings screen — that doesn't exist today. Your name, mark/initials, and brand color are set once when your account is created and shown in your embed snippet, but there's no dashboard form to change them yourself, and the bubble's on-screen position is fixed (bottom-right). If you need any of that changed, reach out to us directly.",
  },
  {
    q: "Exactly how many team members/users, messages, and connectors do the paid plans include?",
    a: "Professional (4,900 KES/mo): 15 users, 10,000 messages/month, 10 connectors. Business (19,900 KES/mo): 60 users, 100,000 messages/month, 50 connectors. Enterprise: no fixed ceiling, negotiated case-by-case. (Free plan is 2 users, 200 messages/month, 1 connector — see the Free plan question.)",
  },
];

export type AudienceKey = "business" | "institutions" | "sacco" | "government" | "developers";

export type Audience = {
  key: AudienceKey;
  /** Short label for the orbit ring / tab strip. */
  label: string;
  /** Search-intent-friendly headline, e.g. "Chatbot for Schools & Hospitals" — matches how people actually search. */
  headline: string;
  painPoint: string;
  capabilities: string[];
  cta: { label: string; href: string };
};

export const AUDIENCES: Audience[] = [
  {
    key: "business",
    label: "Retail & Business",
    headline: "Chatbot for retail & business",
    painPoint: "Customers ask \"where's my order\" a hundred times a day, and every new product means another manual social media post.",
    capabilities: [
      "Real order status, pulled from your own retail system, answered instantly",
      "Add a product once — it's automatically posted to your Facebook Page and Instagram",
      "M-Pesa-aware conversations for payments and confirmations",
      "Delivery dispatch that offers a trip to a real driver and tracks the reply",
    ],
    cta: { label: "Start free for your business", href: "/onboard" },
  },
  {
    key: "institutions",
    label: "Schools & Hospitals",
    headline: "Chatbot for schools & hospitals",
    painPoint: "Parents and patients call the front office for the same handful of answers, and after-hours means silence.",
    capabilities: [
      "Grounded answers to fees, term dates, visiting hours — from FAQs your staff actually approved",
      "Real records — exam results, appointments, payslips — released only after a one-time verification code",
      "Multiple branches or campuses under one number, correctly routed and permission-scoped",
      "Answers day or night, without a single extra staff member",
    ],
    cta: { label: "Start free for your institution", href: "/onboard" },
  },
  {
    key: "sacco",
    label: "SACCOs & Cooperatives",
    headline: "Automation for SACCOs & cooperatives",
    painPoint: "Members across many branches all need the same self-service, and your core system wasn't built for chat.",
    capabilities: [
      "One number, many branches — each correctly scoped to its own members and permissions",
      "Connects to your existing core system rather than replacing it — P2Less is the front door, not a new ledger",
      "Member self-service for balances, statements, and standard requests, verified before anything sensitive is shared",
      "Every action logged, so the board can see exactly what happened and when",
    ],
    cta: { label: "Start free for your SACCO", href: "/onboard" },
  },
  {
    key: "government",
    label: "Government",
    headline: "Chatbot for government & institutions",
    painPoint: "Public-facing services need to scale without compromising who can see what, or losing the paper trail.",
    capabilities: [
      "Full audit trail on every privileged action — nothing happens silently",
      "Role-based access scoped by branch or department, not an all-or-nothing account",
      "Encrypted credentials, isolated tenant data, step-up verification before sensitive records move",
      "Custom-priced Enterprise deployment, built around your own real requirements",
    ],
    cta: { label: "Talk to us about a deployment", href: "/onboard" },
  },
  {
    key: "developers",
    label: "Developers",
    headline: "Built for developers",
    painPoint: "Wiring a chat interface to a real backend usually means weeks of custom integration work before anything ships.",
    capabilities: [
      "Paste an OpenAPI spec — P2Less drafts working, permission-scoped connectors for you to review and ship",
      "A curated marketplace of ready-made connector templates for common systems",
      "Every capability risk-tiered and permission-gated by design, not bolted on after launch",
      "API keys and webhooks for building on top of the same engine that powers every channel",
    ],
    cta: { label: "Explore as a developer", href: "/onboard" },
  },
];

export type Channel = { name: string; mark: string; color: string; blurb: string; live: boolean };

export const CHANNELS: Channel[] = [
  { name: "WhatsApp", mark: "WA", color: "#25D366", blurb: "Where your customers already are.", live: true },
  { name: "Messenger", mark: "FM", color: "#0084FF", blurb: "Replies straight from your Facebook Page.", live: true },
  { name: "Telegram", mark: "TG", color: "#229ED9", blurb: "Free, instant setup — no approval needed.", live: true },
  { name: "Email", mark: "✉", color: "#4f46e5", blurb: "For the slower, more formal conversations.", live: true },
  { name: "Website widget", mark: "P2", color: "#0d9488", blurb: "A chat bubble for your own site — like this one.", live: true },
  { name: "X (Twitter)", mark: "X", color: "#12131f", blurb: "Public reply automation.", live: false },
];

export const AUTOMATION_EXAMPLES = [
  {
    title: "Book an appointment",
    who: "Patient",
    says: "Can I get an appointment this week?",
    does: "Checks the hospital's real schedule, books the open slot, and confirms it — no receptionist involved.",
  },
  {
    title: "Submit a leave request",
    who: "Employee",
    says: "I need Monday and Tuesday off.",
    does: "Submits the request to the real HR system and confirms the remaining balance — what used to mean a form and a wait.",
  },
  {
    title: "Check an order",
    who: "Customer",
    says: "Where's my order?",
    does: "Looks up the real status from the retail system and replies instantly, any time of day.",
  },
  {
    title: "Get a real document",
    who: "Employee",
    says: "Send me my payslip.",
    does: "After a one-time verification code, generates the real payslip from the payroll system and sends it — no HR staff involved.",
  },
  {
    title: "Publish a new product",
    who: "The organization",
    says: "adds a product to the P2Less catalog",
    does: "Automatically posts it to the organization's Facebook Page and Instagram — no separate social media step.",
  },
];
