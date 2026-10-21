# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Capitan** — an iOS app (Expo Go, React Native) for climbing gyms: photograph a wall, detect holds, group them into routes by color, and show a personalized hand/foot path. The authoritative spec is **`Capitan — Design Document v2.md`** (Draft v4) in the repo root — read it before any feature work. The older `Rock climbing route detection app design - Claude.pdf` is the original version; section numbers below refer to the design doc. `AGENTS.md` holds the Expo/React Native operating rules (versioned-docs discipline, Expo Router, EAS, CNG) — follow it; this file does not repeat it.

## Phases

Work is split into **Phase 1 (frontend, mocked backend, M0–M6)** and **Phase 2 (backend + ML, M7+)**. Each milestone ends by asking Stanley to sign off.

When something isn't specified in the design doc, **ask Stanley — do not assume** (doc §11).

**Current status:** Phase 1 (M0–M6) is built against the mock API and passes tsc, lint, `expo export` (iOS), and `expo-doctor`; on-device sign-off in Expo Go is still pending. Stanley approved Phase 2 on 2026-10-04 — it lives in the parent folder's `backend/` (Python), not in this repo. The app now talks to the real backend by default (`src/api/http.ts`; run the server from the parent folder — see `../CLAUDE.md`). `EXPO_PUBLIC_API_MODE=mock` switches back to the in-app mock; the dev-menu failure toggles only affect the mock. Full build log: `../PROGRESS.md`.

## Commands

```bash
npx expo start                      # dev server (open in Expo Go on an iPhone)
npx tsc --noEmit                    # typecheck — run before declaring work done
npx expo lint                       # lint — run before declaring work done
npx expo export --platform ios --output-dir /tmp/x   # headless "does it boot?" check (no simulator)
npx expo install <pkg>              # ALWAYS use for deps (resolves SDK-compatible versions)
```

There is **no test suite** yet. The reliable headless verification that the app boots is a successful `expo export` for iOS (Metro bundle). Actually running the UI requires Expo Go on a physical iPhone.

## Architecture

### API contract layer (`src/api/`) — the spine of Phase 1
Every backend call goes through `api` imported from `@/api`. The design is built so Phase 2 swaps the implementation with **zero call-site changes**:

- `types.ts` — the exact frontend↔backend contract from **design doc §7**, including the `CapitanApi` interface. This is the source of truth for both phases; keep it in sync with the doc. (The app has since extended `createScan` to `images[]`/`metas[]`/`mode` for precise multi-view scans.)
- `mock.ts` — Phase 1 implementation of `CapitanApi`: realistic 1–3s delays, in-memory mutable state, corrections that regroup routes by hold color.
- `fixtures.ts` — hand-labeled fixture data (Bay Area gyms, 2 wall scans with holds/routes). **The wall images are generated placeholders** (`assets/fixtures/`); replace with real gym photos + re-labeled holds before the M3 results screen.
- `dev-flags.ts` — toggles to force quality-check / processing / no-routes failures for exercising error paths.
- `http.ts` — Phase 2 implementation: calls the Python backend at `API_URL` (defaults to the Expo dev machine's IP, port 8000; override `EXPO_PUBLIC_API_URL`). Auth/profile still delegate to the mock.
- `index.ts` — selects the implementation via `API_MODE` in `src/config/api.ts` (default `http`, `EXPO_PUBLIC_API_MODE=mock` for the mock).

### Theme & design system
- `src/theme/` is the **canonical** token set (colors, spacing/radius, typography, `useThemeColors()`); import from `@/theme`. It is *exported from* `design-system/capitan/MASTER.md`, which is the source of design decisions — **read MASTER.md (and any `design-system/capitan/pages/<screen>.md` override) before building a screen.**
- Palette is deliberately **earthy / muted** (sandstone, granite, chalk, moss accent) so that route **overlays in arbitrary saturated hold colors stay readable** on the wall photo. Never introduce a saturated UI accent that competes with holds; the moss accent is desaturated so it never reads as a route.
- **Accessibility is a hard requirement, not polish:** route/limb identity must never depend on color alone — always label + swatch + shape + number (color-blind climbers). These rules live in MASTER.md.
- The design system is produced with the **UI UX Pro Max** skill (`.claude/skills/ui-ux-pro-max/`). Note: the skill's keyword matcher does not reliably hit the doc's earthy brief, so the MASTER.md palette was hand-tuned on top of the skill's scaffold. Every milestone ends with the MASTER.md pre-delivery checklist.

### Routing & app name
- Expo Router, `src/app/` = **routes only** (`_layout.tsx` = navigator). Keep components/hooks/utils outside `src/app/`. Path aliases: `@/*` → `src/*`, `@/assets/*` → `assets/*`.
- The product name lives **only** in `APP_NAME` (`src/config/app.ts`) and `app.json` — never hardcode it elsewhere, so it can be renamed in one place. Logo is a single swappable asset at `assets/logo.png`.

### Components
`src/components/` holds Capitan components (`wall-view.tsx`, `app-header.tsx`, `ui/`…). The `create-expo-app` starter files were removed in M6 — use `@/theme`, not any starter theme.

## Constraints
- **Expo Go on iOS only** for Phase 1 — no custom native modules or dev-client-only libraries.
- Prefer Expo modules over third-party libraries; check available skills before adding deps.
