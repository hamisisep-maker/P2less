# Pricing strategy — what it is, why it's shaped this way, and whether it's sustainable

Written 2026-08-22, in response to a direct request to explain the pricing model clearly before evaluating the channel-pricing-tier idea against it. Describes the pricing **already implemented** in `src/lib/billing.ts` and the `Plan` model — not a new proposal.

---

## What are we actually pricing?

A **hybrid model**: a flat monthly plan fee, plus metered usage billed on top of it.

- **Flat fee** (`Plan.priceMonthly`): Free = 0, Professional = 4,900 KES, Business = 19,900 KES, Enterprise = custom/negotiated.
- **Metered usage, charged per unit consumed, on top of the flat fee** (`PRICE.*` in `billing.ts`, admin-editable at `/admin/billing`): 2 KES per WhatsApp conversation, 1 KES per AI understanding request, 5 KES per generated document.
- **Plan limits are hard ceilings, not a soft "included then overage" allowance**: `checkLimit()` blocks further use once a tenant hits their plan's monthly cap (`used < limit`) — usage isn't unlimited-but-billed past the included amount, it stops. The limit governs *how much they can do*; the per-unit price governs *what it costs them for every bit of it*.

So in plain terms: **a customer pays a base subscription for a bundle of headroom, plus a small fee for every message, AI understanding call, and document they actually use — up to a ceiling that scales with the tier they're on.**

## Why price it this way, not flat-only or usage-only?

Both simpler alternatives have a real failure mode this model avoids:

- **Flat-fee-only** (a fixed monthly price, unlimited usage) risks selling at a loss to any tenant who uses the product heavily — WhatsApp conversations and AI calls cost real money regardless of what's charged, so a flat price with no usage sensitivity means margin erodes exactly when a customer is getting the most value (using it a lot), which is backwards.
- **Usage-only** (pay purely per message/request, no subscription) gives no revenue floor and makes a customer's bill unpredictable month to month, which is a real trust problem for a small institution budgeting carefully — a school or SACCO wants to know roughly what they'll pay.
- **The hybrid captures both**: a predictable floor (the flat fee funds baseline platform cost — infra, support, the built product itself) plus cost-proportional scaling (the metered lines track the two things that actually cost P2Less real money as usage grows: Meta's WhatsApp fee and AI provider spend). This is a well-established SaaS pattern for exactly this reason, not an arbitrary choice.

## What value does each tier actually provide?

| Tier | Price | Includes (hard ceiling/mo) | What it actually buys |
|---|---|---|---|
| **Free / Trial** | 0 KES | 2 users, 200 messages, 1 connector, 100 AI requests, 20 documents | Enough to run one real workflow end-to-end and see it work — genuine, risk-free validation before committing money. |
| **Professional** | 4,900 KES | 15 users, 10,000 messages, 10 connectors, 5,000 AI requests, 1,000 documents | Enough for one real organization running one active WhatsApp line at meaningful volume — the realistic first-paying-customer tier. |
| **Business** | 19,900 KES | 60 users, 100,000 messages, 50 connectors, 50,000 AI requests, 10,000 documents | Real scale — more staff seats, high message volume, enough headroom that limits stop being a day-to-day concern. |
| **Enterprise** | Custom | No fixed ceiling, white-label | Priced case-by-case because "one number" stops making sense at genuinely large/institutional scale — this is the tier for negotiated terms, not a fixed SKU. |

## Who is each tier realistically for?

- **Free**: any first-time evaluator, regardless of sector — a school testing before a full rollout, a solo retailer trying it out, a developer exploring the API.
- **Professional**: the realistic **first real paying customer** across every sector the current GTM plan targets ([[project-p2less-gtm-strategy]]) — one school, one clinic, one SACCO branch, one shop with real but modest volume. This is the tier the go-deep-on-one-vertical pilot strategy is actually built around.
- **Business**: an organization that's outgrown Professional — a larger hospital, a SACCO routing many branches through one number, a retailer with high order volume.
- **Enterprise**: institutional/government-scale organizations, or a reseller/partner needing the P2Less branding removed entirely.

## How does it play across different sectors?

**Deliberately sector-agnostic by design, and that's a real strength, not an oversight.** The metering dimensions — messages, AI requests, documents, connectors, users — are universal usage signals that mean the same thing whether the tenant is a school, hospital, SACCO, NGO, or retailer. Nobody needs a bespoke pricing SKU per vertical; a school's bursty usage around term dates, a hospital's steadier daily volume, and a retailer's spikes around sales periods all just show up as different metered totals on the same pricing structure, with zero extra logic needed per sector.

**The one real gap this doesn't yet cover**: channel differences. WhatsApp has one real per-message cost; a future channel like X would have a *different*, meaningfully higher one ($0.025 per round trip, confirmed against X's own docs — see the roadmap doc's candidate-channels section), and Messenger/the web widget are free to run. Today's pricing charges the same `price_conversation_kes` regardless of which channel a message came through, which is fine while WhatsApp is the only real channel, but would need a real per-channel cost line before a second metered channel actually ships — exactly the gap the "channel pricing-tier" idea raised. Worth solving properly when there's a real channel to price, not retrofitted in a rush.

## Does it support a sustainable, profitable business?

**Yes, verified with real numbers, not just asserted.** `computePlanMargin()` (`billing.ts`) computes what happens if a tenant maxes out every included unit in a month — the actual worst case that determines whether a plan is profitable, not just its headline price:

- Free: ~59% gross margin at max usage
- Professional: ~65% gross margin at max usage (≈34,900 KES revenue vs ≈12,200 KES cost)
- Business: ~62% gross margin at max usage
- Enterprise: no fixed ceiling to compute a worst case from — priced individually instead

This is the actual test of sustainable pricing — a plan whose price only "sounds reasonable" can still lose money at real scale, and many SaaS companies don't discover that until it's already happened. This one is verified not to, at least against current cost assumptions.

**Two honest caveats, not glossed over**:
1. The WhatsApp per-message cost (1 KES) is an admin-set *estimate* of Meta's real fee, never reconciled against a live Meta invoice — worth verifying once real WhatsApp volume exists.
2. Today's AI cost is artificially low because the platform runs on free-tier provider keys (a deliberate decision, see [[p2less-platform-vision]]) — the ~0.4 KES/request assumption won't hold at real paid-tier scale and needs re-measuring once real revenue funds real infrastructure spend.

## Bottom line

The pricing is not the risk in this business today — the complete absence of paying customers is (see [[project-p2less-gtm-strategy]]). The structure itself is sound: it ties revenue to real cost drivers, works the same way across every sector without bespoke logic, and is verified profitable at worst-case usage on every tier. The one real open question — per-channel cost differentiation — is correctly not solved yet, because there's only one real metered channel today; solving it now would be designing for a problem that doesn't exist yet.
