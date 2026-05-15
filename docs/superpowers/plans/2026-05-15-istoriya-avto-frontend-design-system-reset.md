# Frontend Design System Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current handmade Milestone 5 frontend implementation with a serious product-grade frontend foundation based on Tailwind CSS, shadcn/ui primitives, feature modules, and explicit design-system boundaries.

**Architecture:** Keep the Milestone 5 backend API work for full report, share links, and PDF export. Rebuild only the frontend layer so `App.tsx` becomes routing/composition, feature state lives in hooks, UI primitives live in `components/ui`, and product flows live under `features/*`. Tailwind/shadcn become the default UI foundation for all serious product surfaces.

**Tech Stack:** React, Vite, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, Bun, existing API client contracts.

---

## Why This Reset Exists

The first Milestone 5 frontend was implemented too quickly. It made the product flow visible, but it did not establish the frontend architecture expected for a serious product:

- too much responsibility accumulated in `App.tsx`;
- UI primitives were handmade instead of standardized;
- no formal design-system boundary existed;
- full report/search/share components were split only after review feedback, not designed up front;
- Tailwind + shadcn/ui were not discussed before building the new product surface.

This reset treats frontend as product infrastructure, not demo code.

## Non-Negotiables

- Do not change approved product logic.
- Keep backend Milestone 5 API behavior unless a bug is discovered and tested.
- Do not expose full report data without access.
- Do not show third-party service names as fact sources.
- Do not store or render personal data about people in user-facing report UI.
- Use Tailwind + shadcn/ui for serious frontend surfaces.
- Do not build another large god component.
- Do not start implementation until this plan is accepted.

## Target Structure

```text
apps/web/src
├── app
│   ├── App.tsx
│   └── routes.tsx
├── components
│   └── ui
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── skeleton.tsx
│       └── tabs.tsx
├── features
│   ├── account
│   │   ├── AccountStatusBar.tsx
│   │   └── account-types.ts
│   ├── report
│   │   ├── FullReportPage.tsx
│   │   ├── ReportActions.tsx
│   │   ├── ReportHero.tsx
│   │   ├── ReportSection.tsx
│   │   ├── ShareReportPage.tsx
│   │   ├── useReportView.ts
│   │   └── report-types.ts
│   └── search
│       ├── CandidateCard.tsx
│       ├── EmptySearchState.tsx
│       ├── SearchPage.tsx
│       ├── SearchResults.tsx
│       ├── UnlockPanel.tsx
│       ├── useSearchFlow.ts
│       └── search-types.ts
├── lib
│   ├── api.ts
│   ├── format.ts
│   ├── seo.ts
│   └── utils.ts
├── index.css
└── main.tsx
```

## Design Direction

The product is an operational decision tool for used-car purchase checks. The UI should feel:

- serious;
- dense enough for repeated analysis;
- calm and legible;
- mobile-first but not “landing page” oriented;
- closer to a professional report/workbench than a marketing site.

Avoid:

- oversized hero-only composition for app flows;
- decorative gradient/orb backgrounds;
- one-off custom controls where shadcn primitives fit;
- verbose explanatory in-app text about how the app works;
- card-inside-card layouts.

Use:

- shadcn buttons, badges, tabs/sheets/dialogs/skeletons;
- restrained report sections;
- predictable action placement;
- sticky or easily reachable report actions on mobile;
- clear empty/loading/error states.

## Task 1: Install Tailwind And shadcn Foundation

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/components.json`
- Create: `apps/web/tailwind.config.ts`
- Modify: `apps/web/vite.config.ts` if path aliases require it

- [ ] Add Tailwind, PostCSS/autoprefixer if needed, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`.
- [ ] Configure `@/*` alias for `apps/web/src`.
- [ ] Add `cn()` helper in `apps/web/src/lib/utils.ts`.
- [ ] Add base CSS variables for shadcn theme.
- [ ] Run `bun run --cwd apps/web typecheck`.
- [ ] Run `bun run --cwd apps/web build`.
- [ ] Commit: `chore: add tailwind shadcn foundation`.

## Task 2: Add shadcn UI Primitives

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/dialog.tsx`
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/components/ui/separator.tsx`
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Create: `apps/web/src/components/ui/tabs.tsx`

- [ ] Add only primitives needed by current flows.
- [ ] Do not add a large component dump.
- [ ] Confirm imports use `@/components/ui/*`.
- [ ] Run web typecheck/build.
- [ ] Commit: `chore: add frontend ui primitives`.

## Task 3: Move Search Flow Into Feature Module

**Files:**
- Create/modify files under `apps/web/src/features/search`
- Modify: `apps/web/src/app/App.tsx`

- [ ] Move search state orchestration into `useSearchFlow.ts`.
- [ ] Move presentational search UI into `SearchPage.tsx`, `SearchResults.tsx`, `CandidateCard.tsx`, `UnlockPanel.tsx`.
- [ ] Use shadcn `Button`, `Badge`, `Skeleton` where applicable.
- [ ] Keep candidate unlock behavior identical.
- [ ] Run web typecheck/build.
- [ ] Commit: `refactor: move search flow into feature module`.

## Task 4: Move Full Report And Share Into Feature Module

**Files:**
- Create/modify files under `apps/web/src/features/report`
- Modify: `apps/web/src/app/App.tsx`

- [ ] Move report orchestration into `useReportView.ts`.
- [ ] Split owner and share entry points: `FullReportPage.tsx`, `ShareReportPage.tsx`.
- [ ] Use shared `ReportHero`, `ReportActions`, `ReportSection`.
- [ ] Preserve `noindex,nofollow` behavior.
- [ ] Preserve share mode restrictions: no PDF, no resharing.
- [ ] Run web typecheck/build.
- [ ] Commit: `refactor: move report flow into feature module`.

## Task 5: Replace Handmade CSS With Tailwind Classes

**Files:**
- Modify/remove: `apps/web/src/styles.css`
- Modify: feature/components files

- [ ] Replace broad handmade CSS with Tailwind/shadcn styling.
- [ ] Keep only global theme/base rules in `index.css`.
- [ ] Avoid page-level CSS selectors for feature internals.
- [ ] Ensure responsive layouts do not overlap at mobile widths.
- [ ] Run web build.
- [ ] Commit: `refactor: replace handmade frontend css`.

## Task 6: Verification And Review

**Files:**
- No broad production changes unless verification reveals issues.

- [ ] Run `bun run test`.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run --cwd apps/web build`.
- [ ] If schema untouched, do not run db generate unless final checklist requires it.
- [ ] Run local browser smoke after Docker/local server is available.
- [ ] Review for:
  - no god components;
  - feature boundaries;
  - shadcn primitives used consistently;
  - full report still locked without access;
  - share mode cannot PDF/reshare;
  - source-brand leak guards unchanged.
- [ ] Commit final fixes if needed.

## Acceptance Criteria

- `App.tsx` is only composition/routing/orchestration.
- Search and report flows live in `features/*`.
- UI primitives live in `components/ui`.
- Tailwind + shadcn are the frontend foundation.
- No product behavior regression from Milestone 5 backend/API.
- Required checks pass.
