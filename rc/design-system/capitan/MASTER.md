# Design System Master File — Capitan

> **LOGIC:** When building a specific page, first check `design-system/capitan/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. Otherwise follow the rules below.

> **Provenance note:** Generated with the UI UX Pro Max skill. The skill's keyword
> matcher returned palettes that conflict with the design doc's explicit brief
> (attempt 1: vibrant orange + neon green "gaming"; attempt 2: soft-UI lavender +
> green "wellness"). Both used **green/purple as UI accents — colors that are also
> common climbing holds**, which breaks the doc's overlay-readability constraint.
> The **palette below is hand-tuned to the doc's §4 direction** (earthy / warm
> neutrals, muted chrome). The skill's spacing, type intent, and checklist are kept.

---

**Project:** Capitan
**Platform:** iOS via Expo Go (React Native) — light + dark
**Category:** Outdoor / climbing-gym utility

---

## Global Rules

### Direction

Earthy / outdoor climbing. Warm neutrals — sandstone, granite grey, chalk white,
moss/forest accent. Natural, sturdy, calm. **UI chrome stays muted so route
overlays (arbitrary saturated hold colors: neon green, hot pink, purple…) pop on
top of the wall photo.** No vivid brand color that competes with holds.

### Color Palette — Light (primary)

| Role | Hex | Token |
|------|-----|-------|
| Background (chalk) | `#F5F1E8` | `background` |
| Surface / card (sandstone) | `#EAE3D5` | `surface` |
| Surface selected | `#DED5C4` | `surfaceSelected` |
| Text (granite) | `#2A2723` | `text` |
| Text secondary (granite grey) | `#6B655C` | `textSecondary` |
| Border | `#D8CFBE` | `border` |
| Accent (moss) | `#55694A` | `accent` |
| Accent pressed (forest) | `#3E4F36` | `accentPressed` |
| On accent | `#F5F1E8` | `onAccent` |
| Destructive (brick) | `#A8492F` | `destructive` |
| Warning (ochre) | `#B07C2A` | `warning` |

### Color Palette — Dark

| Role | Hex | Token |
|------|-----|-------|
| Background (soil) | `#1A1815` | `background` |
| Surface / card | `#26231E` | `surface` |
| Surface selected | `#322E27` | `surfaceSelected` |
| Text | `#F0EBE0` | `text` |
| Text secondary | `#A69E90` | `textSecondary` |
| Border | `#3A362E` | `border` |
| Accent (moss, lifted) | `#8AA173` | `accent` |
| Accent pressed | `#6E855A` | `accentPressed` |
| On accent | `#14140F` | `onAccent` |
| Destructive | `#C75B40` | `destructive` |
| Warning | `#C79A45` | `warning` |

**Note:** The accent (moss) is deliberately desaturated so it never reads as a
"route color." Never use accent to encode a route.

### Typography

- **Type:** system SF (iOS-native) — sturdy and readable with zero font loading
  in Expo Go. `sans` = system-ui, `rounded` = ui-rounded (numeric step badges),
  `mono` = ui-monospace.
- Skill suggestions for later (if custom fonts are added via expo-font): Lora /
  Raleway or Barlow. Not adopted in M0.

| Style | Size | Weight |
|-------|------|--------|
| Title | 32 | 700 |
| Heading | 22 | 600 |
| Body | 16 | 400 |
| Label | 15 | 600 |
| Caption | 13 | 500 |

### Spacing (matches src/theme + existing scale)

| Token | px |
|-------|----|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 16 |
| `lg` | 24 |
| `xl` | 32 |
| `2xl` | 48 |
| `3xl` | 64 |

### Radius

| Token | px |
|-------|----|
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `pill` | 999 |

---

## Project-specific rules (the skill can't know these)

### Overlays over gym photos
- Holds/routes render in their **own vivid colors** on top of muted chrome.
- Every overlay stroke gets a **contrasting halo** (light outline in dark areas,
  dark in light) so it stays visible on any wall.
- Keep chrome muted; never add a saturated UI color that competes with holds.

### Accessibility — route/limb identity must never be color-only (§4)
- Every route has a **text label** ("Blue", "Route 3") **and a swatch**.
- Path steps are **numbered**; hands vs feet differ by **shape + label**
  (circle "LH 3" vs square "RF 4"), not color.
- iOS conventions: safe areas, ≥44pt tap targets, Dynamic Type, VoiceOver labels.

---

## Pre-Delivery Checklist (per milestone)

- [ ] Route/limb identity works with color removed (label + shape + number)
- [ ] Overlays stay readable on real gym photos, not just mockups
- [ ] Contrast ≥ 4.5:1 for text in light and dark
- [ ] ≥ 44pt tap targets; safe areas respected
- [ ] Dynamic Type doesn't clip; VoiceOver labels present
- [ ] `prefers-reduced-motion` / Reduce Motion respected
- [ ] Tested on a small and a large iPhone via Expo Go
- [ ] No emojis used as icons (use SF Symbols / SVG)
