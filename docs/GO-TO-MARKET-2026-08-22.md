# Go-to-market — where the numbers stand + how to get the first real clients

Written 2026-08-22, in response to the user asking directly: "is the current [pricing] one profitable, or am I just helping people build themselves" and "how do I get real paying clients."

---

## Part 1 — Where the numbers actually stand today

**Short answer: not profitable, because there is no real revenue yet — not because the pricing is wrong.** P2Less has zero real paying clients as of this date (confirmed earlier the same session: the reason multi-account free-tier AI keys were chosen over paid billing was explicitly "no revenue to justify billing yet"). Every "Professional"/"Business" plan tenant visible in the dashboard today is seeded demo data, not a real customer. So right now, yes — this is pre-revenue infrastructure-building, not a running business, regardless of what the pricing model would earn if someone actually paid.

**The pricing model itself, checked against the real billing code (`src/lib/billing.ts`), is structurally sound — not being sold at a loss:**

- Billing is hybrid: a flat monthly plan fee **plus** metered usage on top — 2 KES per WhatsApp message, 1 KES per AI request, 5 KES per generated document (`PRICE.*`, admin-editable at `/admin/billing`). This is what actually gets charged at renewal (`computeBill()` → `bill.total`), not just the flat fee.
- Against that, the estimated real cost per unit is lower: 1 KES/message, ~0.4 KES/AI request, 0.2 KES/document (`COST.*`).
- Running the numbers for a Professional-tier tenant maxing out their full 10,000-message monthly allowance: **≈34,900 KES revenue vs ≈12,200 KES cost ≈ 65% gross margin.** There's already a built-in margin calculator for exactly this (`computePlanMargin()` in `billing.ts`, surfaced at `/admin/billing`) — check it live for any plan rather than trust this snapshot as it stays current.

**Two honest caveats on that number, not glossed over:**
1. The WhatsApp per-message cost (1 KES) is an admin-set *estimate* of Meta's real conversation fee — there's no live Meta invoice reconciliation integration today to confirm it's accurate. Worth verifying against a real Meta bill once real WhatsApp volume exists.
2. Real AI cost today is near-zero because the platform runs on free-tier provider keys (a deliberate, previously-discussed decision — see [[p2less-platform-vision]] memory, "top up all accounts to paid once there's real revenue"). The ~0.4 KES/request default won't hold once paid-tier AI capacity is actually needed at scale — re-measure it then.

**Bottom line**: the product and pricing are ready to make money the moment someone real pays. The only missing piece is a real paying client.

---

## Part 2 — How to get the first real paying clients

**The core recommendation: go deep on ONE vertical before going wide across all six.** P2Less's demo/onboarding personas cover six industries (school, hospital, SACCO, NGO, government, retail) — that breadth is a strength for the *product* (same engine, proven across all of them) but a real weakness for *early sales*, because a case study, a pitch, and a trust-building story all need to be specific to be convincing. "We help organizations" convinces nobody; "we cut WhatsApp response time for Nairobi-area private schools from hours to seconds, ask [named school] about it" does. Pick the vertical where you (or someone in your network) already has a warm relationship or credible foot in the door — that's the fastest path to a first real logo.

### Getting client #1 (the hardest one)

- **Warm network first, cold outreach last.** The single highest-probability first client is an organization you or someone you know already has a relationship with — a school a relative's kids attend, a SACCO a friend belongs to, a clinic you've used. Trust is the actual blocker for an institutional buyer trying a new WhatsApp-facing AI system with their members' data; an existing relationship shortcuts that entirely.
- **Offer a real pilot, not just a discount.** Free or heavily discounted for 1–3 months, in exchange for: (a) permission to use their name/logo as a case study once it's working, and (b) direct, frequent feedback while you're still finding rough edges. This is a fair trade — they get free value and white-glove attention, you get the proof you need for client #2.
- **Do the pilot's setup yourself, don't make them self-serve.** `/onboard`'s card-on-file self-serve flow is real and works, but it's built for a confident, already-convinced signup — not for winning over a first skeptical institutional buyer. For the pilot, sit with them (in person or on a call), connect their number, load their real FAQs/connector yourself, and make sure their first real conversation with the assistant works before they ever have to trust the self-serve flow.

### After client #1 — turning one proof point into a pipeline

- **Write the case study immediately, while it's fresh** — concrete numbers if you can get them (response time, messages handled, staff hours saved), a short quote, and what they use it for specifically.
- **Go to the next 3–5 prospects in the SAME vertical**, using that case study as the pitch. Same industry means the same pain points, the same objections, the same demo script — each subsequent sale gets cheaper and faster. Resist the urge to chase a hospital and a SACCO and a school all at once this early; the story doesn't transfer and you'll be starting from zero credibility each time.
- **Vertical-specific channels, once you have a story worth telling**:
  - *Schools*: county/private-school-association WhatsApp groups and Facebook groups (very active in Kenya), headteacher networks, PTA meetings.
  - *SACCOs*: SASRA-registered SACCO directories, cooperative movement events, umbrella bodies (e.g. KUSCCO-affiliated networks).
  - *Retail*: local business associations, market/trade WhatsApp groups, referrals from the SME's own suppliers.
  - *Hospitals/clinics*: harder — longer sales cycles, more compliance-sensitive; save for after you have traction and a compliance story (data handling, OTP-gated access) to point to.
  - *NGOs/government*: longest cycles, procurement processes — realistically a later-stage target once P2Less has a track record, not a first-client bet.
- **Let the self-serve `/onboard` funnel catch inbound demand once there's any** (from the case study, word of mouth, or light content/SEO) — it's a real, working, low-friction signup for someone who already wants to try it; it's just not the right tool for convincing someone who's never heard of you.

### What NOT to do right now

- Don't build channel-based pricing tiers, Track-B-style workspace customization, or other speculative differentiation before there's a real client asking for it — matches the discipline already applied everywhere else in this project (see [[p2less-platform-vision]]).
- Don't spend real money on paid ads or broad marketing before the story is proven with one real, named client — there's nothing to point to yet, so paid acquisition would be burning money to convince strangers of something you can't yet back up.
- Don't try to sign multiple industries simultaneously before the first vertical has 3+ real clients — depth beats breadth until there's a repeatable playbook.

---

## Revisit this doc when

- The first real pilot client is signed — update Part 2 with what actually worked/didn't.
- Real WhatsApp/AI usage exists — replace the estimated costs in Part 1 with real reconciled numbers from `/admin/billing` and a real Meta invoice.
- 3+ paying clients exist in one vertical — decide whether to go deeper or start the second vertical, and document why.
