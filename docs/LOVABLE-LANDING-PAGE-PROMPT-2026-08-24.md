# Prompt for Lovable — landing page UI/UX pass only

Paste everything below the line into Lovable. Kept here so there's a record of exactly what was asked for, and so a re-run later doesn't need to be reconstructed from memory.

---

## Scope — read this before touching anything

You are working ONLY on the public marketing landing page of this Next.js app. This is a real, live, production application with a working backend — you are not building a new app, you are restyling one existing page.

**Files you are allowed to touch:**
- `src/app/page.tsx` — the landing page itself
- `src/app/audience-orbit.tsx`, `src/app/audience-tabs.tsx`, `src/app/channel-badges.tsx`, `src/app/faq-accordion.tsx` — landing-page-only components
- `src/app/globals.css` (or wherever this project's Tailwind/CSS variables are defined) — but ONLY to add new styles, never remove or rename existing CSS variables (see "Design system" below)
- New files you create yourself for landing-page-specific components (e.g. a new section component), as long as they're only imported from `src/app/page.tsx`

**Do NOT touch, under any circumstances:**
- Anything under `src/app/api/`, `src/app/dashboard/`, `src/app/admin/`, `src/app/onboard/`, `src/app/login/`, `src/app/demo/`
- Anything under `src/lib/` (this is server-side business logic, database access, security code — not UI)
- `prisma/schema.prisma` or anything under `prisma/`
- `src/components/ui.tsx` or any shared component used outside the landing page (if you need a shared component's behavior to change, create a NEW landing-page-specific version instead of editing the shared one)
- `package.json` dependencies — do not add, remove, or upgrade any npm package without calling it out explicitly and separately, not silently
- Any `.env` file, config file (`next.config.*`, `tailwind.config.*`, `tsconfig.json`), or CI/deploy configuration
- The actual TEXT content/claims on the page (see "Content" below)

## Content — do not change facts or claims

The words on this page are deliberate and reviewed — pricing figures, FAQ answers, feature descriptions, the "never fabricates" security claims. You may:
- Improve typography, spacing, hierarchy, and how text is broken into lines/sections
- Make minor wording tweaks purely for visual flow (e.g. shortening a line that wraps awkwardly)

You may NOT:
- Add new feature claims, new numbers, new pricing, or new capability descriptions
- Remove or alter the meaning of any existing FAQ answer or security claim
- Invent new content sections not already present

If you think a piece of content needs a real change (not just rewording), leave a comment flagging it instead of changing it.

## Design system already in place — work within it, don't replace it

This page uses Tailwind CSS v4 with CSS custom properties for its whole color system — `var(--color-accent)`, `var(--color-bg)`, `var(--color-ink)`, `var(--color-muted)`, `var(--color-surface)`, `var(--color-line)`, and several `-soft`/`-2` variants, plus `color-mix()` for translucency effects. There's also a `font-display` class for headings.

- Keep using these variables — do not hardcode new hex colors that bypass the variable system, since this same system is likely shared with the rest of the app's dashboard.
- If you genuinely need a new color token, add it as a new CSS variable following the same naming convention, in both light and dark definitions if this project supports dark mode — don't invent a one-off hardcoded color.

## Technical constraints — this page is not a static template

- `src/app/page.tsx`'s `Landing` function is an **async Server Component** — it makes real database calls (`db.whatsAppNumber.findMany(...)`, `getSetting(...)`) at the top of the function before rendering. **Do not remove this data-fetching, do not convert this file to a client component, and do not delete the `export const dynamic = "force-dynamic"` line above it** — all three would break real, working functionality (a live industry count and an admin-controlled feature toggle).
- The FAQ accordion, audience orbit/tabs, and channel badges are populated from real data arrays (`LANDING_FAQS`, `AUDIENCES`, `CHANNELS`, `AUTOMATION_EXAMPLES`) imported from `src/lib/landing-content.ts` — restyle how these render, but keep reading from these same arrays/props rather than hardcoding the content inline.
- There's a live chat widget loaded via `<script src="/widget.js" ...>` at the bottom of the page — do not remove this script tag or change its `data-*` attributes.
- There's a conditional section (`qualityFeedbackInvitationEnabled && (...)`) that only renders when an admin setting is on — keep this conditional intact, don't force it to always render or delete it.
- All internal links (`/demo`, `/onboard`, `/login`) must keep pointing to the same routes.

## What I actually want from you

1. **Full responsiveness** — this needs to work cleanly on mobile (very small screens too, not just tablet-up), tablet, and desktop. No horizontal scrolling anywhere, ever. Touch targets on mobile should be comfortably tappable (not tiny links crammed together). Text should stay readable at every size — no tiny unreadable body text on mobile, no awkwardly huge headlines on small screens.
2. **A genuinely beautiful, professional, modern visual design** — this is a B2B SaaS product for schools, hospitals, SACCOs, government bodies, and businesses. It should read as trustworthy, polished, and credible — not flashy or gimmicky. Elevate typography, spacing rhythm, visual hierarchy, and section-to-section flow. Improve what's there rather than gutting and replacing it wholesale.
3. Test and confirm the page still works correctly at common breakpoints (a real mobile width like 375px, a tablet width like 768px, and a normal desktop width like 1440px) before you consider this done.

## Before you finish — write a record of what you did

At the end, write a clear summary (as a PR description, commit message, or a short note — whatever this integration supports) listing:
- Every file you touched
- What you changed in each one, in plain terms
- Any new dependencies added, if any (there shouldn't be any without flagging it first)
- Anything you were unsure about or wanted to flag rather than just changing

This will be reviewed against the actual code diff before it's trusted — so be accurate about what you actually did, not just what you intended to do.
