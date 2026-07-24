# Design System — jobhunt-app

## Product Context
- **What this is:** Self-hosted personal tool that tailors one master CV into
  sector-specific variants via a visibility engine, plus a small job board
  and application tracker.
- **Who it's for:** One user, running it locally — not a multi-tenant product.
- **Space/industry:** Job-search tooling (Jobright, Huntr, Simplify, Teal).
- **Project type:** Web app (React/Vite), data-dense working screens, no
  marketing site.

## Aesthetic Direction
- **Direction:** Utilitarian-Confident — function-first, data-dense, but with
  bold geometric type and one confident accent so it reads as "modern SaaS."
- **Decoration level:** Intentional — soft tinted panels and card depth, no
  illustrations/blobs/hero sections.
- **Mood:** Competent and quiet, not marketing-hype. The tool you built for
  yourself, styled properly.
- **Reference sites:** jobright.ai, huntr.co, simplify.jobs

## Typography
- **Display/Hero:** Cabinet Grotesk (700/900) — via Fontshare CDN
  (`https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700,900&display=swap`)
- **Body:** Instrument Sans — Google Fonts
- **UI/Labels:** Instrument Sans (same as body)
- **Data/Tables:** Geist, `font-variant-numeric: tabular-nums` — Google Fonts
- **Code:** JetBrains Mono — Google Fonts
- **Scale:** display 2rem/900, heading 1.3–1.4rem/700, body 1rem/400, data 0.9rem/500, label 0.75rem/600 uppercase

## Color
- **Approach:** Balanced — one primary + a reserved semantic "AI-signal" accent
- **Primary:** `#0F9D6B` light / `#17B37D` dark — buttons, active nav, selected profile
- **AI-signal:** `#00E08A` (both modes) — used ONLY for AI-suggestion badges/highlights. Nothing else may use this color; if a "success" state needs green, use `--color-success` instead.
- **Neutrals:** bg `#FAFAF9`/`#121214`, surface `#FFFFFF`/`#1B1C1F`, border `#E2E4E3`/`#2C2E31`, text `#14151A`/`#F2F3F4`, muted `#63666B`/`#9A9DA3`
- **Semantic:** success `#16A34A`/`#22C55E`, warning `#D97706`/`#F59E0B`, error `#DC2626`/`#EF4444`, info `#2563EB`/`#3B82F6`
- **Dark mode:** `[data-theme="dark"]` override + `prefers-color-scheme` fallback (`apps/web/src/index.css`); primary brightens slightly for contrast on dark surfaces

## Spacing
- **Base unit:** 4px
- **Density:** Compact (toggle lists, kanban cards); comfortable only around the CV PDF preview pane
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48)

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment (the toggle list has real information hierarchy that a loose layout would muddy)
- **Border radius:** sm 6px, md 10px, lg 14px, full 999px (pills)

## Motion
- **Approach:** Intentional, not expressive — fade/slide on section expand, soft highlight flash when an AI suggestion is applied, no decorative/scroll-driven animation
- **Duration:** short (150–200ms) for state changes

## Distinctive pattern: the override marker
A toggle row gets a left-edge `--color-primary` accent bar + a small "overridden"
tag when the profile's `visibility` map has an explicit key for that node
(`CvEditor.tsx`'s `isOverridden`) — rows with no override just inherit the
master's value silently. This makes the CV engine's real guarantee (master
never mutates, overrides are explicit) visible in the UI, not just true in
the code. Note: "overridden" means *the key is present*, not *the effective
value differs from master* — a section toggled off then back on still shows
the tag, because `toggle()` always writes an explicit key.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-24 | Initial design system created | `/design-consultation`, researched Jobright/Huntr/Simplify per user's Jobright reference; scoped implementation to CV Editor (Job Board/Tracker inherit tokens but weren't restyled) |
