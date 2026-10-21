# Capitan — Design Document

Oct 4, 2026 · @Stanley

**App name:** Capitan (kept in one config constant so it can be renamed) · **Platform:** iOS via Expo Go · **Status:** Draft v4 (adds a per-hold depth dataset built with Depth Anything 3; path planning on hold) · **Author:** Stanley

## 1. Overview

Capitan is an iPhone app for climbing gyms. The climber takes one photo of a wall, and the app identifies the holds, groups them into routes by color, and shows the optimal hand-and-foot sequence up whichever route the climber picks, personalized to their height and wingspan.

The current backend goal is a hold depth dataset. For every hold in every scan, the backend uses ByteDance's Depth Anything 3 (DA3METRIC-LARGE) to build a metric 3D representation of the hold's front surface: how far it protrudes from the wall, its real size, and which way it faces. The optimal-path planner is on hold until this dataset exists; it will be designed on top of it later.

Every photo is tagged with the gym (place) it was taken at and added to a growing training corpus. Each time a user asks for a path, the backend runs the model as trained on the current corpus, so results get better as more scans come in. Users can also correct mistakes in hold detection and route colors, and those corrections become labeled training data. The goal is a model that generalizes to any wall, so old scans stay useful even after a gym resets its routes. All of this matters because the dataset will be small at launch.

## 2. Phasing and ground rules

Work is split into two phases.

**Phase 1 — Frontend (Expo Go, iOS).** The full app experience, built against a mocked API that has the same shape as the future backend. Anywhere the backend would do work (quality check, nearby-gym matching, hold detection, depth estimation, path planning, auth), the frontend shows a processing state and returns fixture data.

**Phase 2 — Backend + ML.** Image quality check, place matching, hold detection, route segmentation, the hold depth dataset, personalized path planning (on hold), storage, real auth, and the training-corpus loop.

**Hard gate:** Do not start any Phase 2 work until Stanley explicitly approves it. Finishing Milestone 6 means stopping and asking.

Other rules for whoever builds this (human or Claude Code):

- Everything in Phase 1 must run in Expo Go on iOS, with no custom native modules or dev-client-only libraries.
- The app name lives in a single constant (`src/config/app.ts` → `APP_NAME = "Capitan"`) and in `app.json`. No hardcoded "Capitan" strings anywhere else, so it can be renamed in one place.
- Use a placeholder logo (simple monogram or generic mountain mark in the theme colors) stored as a single asset at `assets/logo.png`, so it can be swapped later.
- Anything not specified in this doc goes to Stanley as a question rather than an assumption. Section 11 lists what's still open.
- All UI work uses the UI UX Pro Max skill (Section 4).

## 3. Frontend tech stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Expo (latest SDK) + TypeScript | Must run in Expo Go on iOS |
| Navigation | Expo Router | File-based routes, tab + stack |
| Camera | expo-camera | Single-photo capture; request EXIF (`exif: true`) so focal length reaches the depth model |
| Motion | expo-sensors (DeviceMotion) | Gravity vector at the moment of capture, so the backend can measure wall angle against true vertical |
| Location | expo-location | Foreground location for nearby-gym suggestions |
| Image prep | expo-image-manipulator | Resize/compress before upload. It strips EXIF, so read capture metadata before resizing |
| Overlays | react-native-svg | Hold outlines, route highlights, hand/foot path markers |
| Zoom/pan | react-native-gesture-handler + react-native-reanimated | Pinch-zoom on the wall photo with overlays locked to it |
| State | Zustand | Lightweight global store |
| Local persistence | @react-native-async-storage/async-storage | Mock accounts, profile, saved scans in Phase 1 |
| API layer | `src/api/` with a mock and (later) http implementation | Swapped by one config flag |

## 4. Design system (UI UX Pro Max skill)

Install the skill in the project and generate a persisted design system for Capitan before building any screens, using an "earthy outdoor rock-climbing gym fitness app" query, plus a React Native stack search for camera capture, image overlays and zoom.

This produces `design-system/capitan/MASTER.md`. Page-specific overrides (e.g. the camera screen, the path viewer) go in `design-system/capitan/pages/`. Every screen build starts by reading `MASTER.md` plus any page override, and every milestone ends with the skill's pre-delivery checklist.

**Direction:** earthy / outdoor climbing. Warm neutrals (sandstone, granite grey, chalk white, deep forest or moss accents), natural textures used sparingly, sturdy readable type. Follow iOS conventions (safe areas, native-feeling navigation, SF-style tap targets of at least 44pt).

**Constraint the skill won't know about:** gym holds come in arbitrary saturated colors (neon green, hot pink, purple, etc.), and the route overlays have to stay readable on top of them. The UI chrome should therefore stay muted so overlays pop, and overlay styling needs to be tested against real gym photos, not just mockups.

**Accessibility:** route identity must never rely on color alone, since many climbers are color-blind. Every route gets a text label ("Blue," "Route 3") and a swatch. Path steps get numbers, and hands vs feet are distinguished by shape and label (e.g. circle "LH 3" vs square "RF 4"), not just color.

## 5. User flows

**First launch:** Onboarding (3–4 cards on what the app does and how to take a good photo) → Sign up / log in (mocked) → Climber profile setup (height, wingspan) → Home.

**Core scan flow:**

1. Tap Scan wall → camera screen with framing guide and tips.
2. Take photo → preview (Retake / Use photo). At the shutter, the app records capture metadata: focal length from EXIF, original image size, and the gravity vector from DeviceMotion.
3. Pick the place: the app asks for location permission and shows nearby gyms first, with a search field and Add new place below. If permission is denied, it falls back to search only.
4. Quality check: frontend sends the image to `checkImageQuality`. If it fails (blurry, too dark, no wall found), show the reason and a Retake button. In Phase 1 the mock always passes, with a dev toggle to force a failure.
5. Processing screen ("Analyzing wall…" placeholder).
6. Results: the photo with all detected holds outlined, and a route picker listing each color route with its community grade (if any).
7. Optional: tap Fix detection to enter correction mode (see below).
8. Pick a route → path view: that route's holds highlighted, others dimmed, numbered steps showing which hand or foot goes on which hold, computed for the user's height and wingspan.
9. Optional: user enters or confirms a V-scale grade for the route.
10. Scan is saved to the user's history under that place, and the image is added to the training corpus.

**Correction mode:** from the results screen, the user can reassign a hold to a different route color, delete something that isn't a hold, or add a missed hold by drawing a box around it. Edits show immediately on the photo, and Done submits them. Routes and paths are then refetched so the corrected holds are used, and the backend regenerates depth records for the affected holds.

Reopening a saved scan calls the path endpoint again rather than showing a cached result, so the user gets the current model's answer (and their current profile measurements).

**History:** Saved walls tab → list of places → scans at that place (newest first) → tap to reopen.

## 6. Screens

| Screen | Purpose | Key states |
| --- | --- | --- |
| Onboarding | Explain app + photo tips | Skippable; shown once |
| Auth (sign up / log in) | Mocked account access | Loading, error, validation |
| Climber profile setup | Height + wingspan entry | Unit toggle (ft/in ↔ cm), validation, skippable with a warning that paths won't be personalized |
| Home | Entry point: Scan wall, recent scans | Empty state for new users |
| Camera | Capture single photo + capture metadata | Permission denied, framing guide, tips toggle |
| Photo preview | Confirm or retake | — |
| Place picker | Tag scan with gym | Nearby list, location denied → search only, no results → add new |
| Quality check / retake | Backend verdict on photo | Passed, failed with reason, network error |
| Processing | Wait for analysis | Placeholder progress, cancel |
| Results / route picker | All holds + list of routes | No routes found, low-confidence warning |
| Path view | Personalized hand/foot sequence on chosen route | Step-through mode, zoom/pan, recomputing state |
| Correction mode | Fix hold detection and route colors | Select hold → change color / delete; draw box to add; undo; submit |
| Grade entry | User enters/confirms the route's V-scale grade | Picker from VB, V0–V17; shows community grade and number of votes |
| Saved walls | Scans grouped by place | Empty state |
| Place detail | All scans at one place | — |
| Profile | Account info, height/wingspan, units, sign out | Editing measurements triggers path recompute next time |

## 7. Frontend ↔ backend API contract

The mock API implements exactly this interface so Phase 2 only swaps the implementation. The only v4 change is capture metadata sent with createScan; the hold depth dataset is backend-only and has no endpoint yet.

**Data types**

| Type | Fields | Notes |
| --- | --- | --- |
| Point | x, y | Normalized 0–1 image coordinates |
| Limb | LH, RH, LF, RF | Left/right hand, left/right foot |
| ClimberProfile | heightCm, wingspanCm | Always stored in cm |
| Hold | id, polygon (list of Points), color, confidence (0–1) | Polygon is the overlay outline; color is the route color label, e.g. "blue" |
| PathStep | order, holdId, limb | — |
| Route | id, color, displayName, holdIds, optional communityGrade (grade + votes) | displayName e.g. "Blue", "Route 3" |
| Place | id, name, optional distanceM, scanCount | — |
| Scan | id, placeId, imageUri, createdAt, status, holds, routes | Status is processing, done or failed |
| CaptureMeta (v4) | Original and upload width and height (px); optional EXIF focal length (mm) and 35mm-equivalent focal length; optional gravity vector | Recorded at the shutter, before resizing strips EXIF; feeds the depth pipeline |
| HoldCorrection | Recolor (holdId, newColor), delete (holdId), or add (box from top-left to bottom-right Point, color) | — |
| VGrade | VB, V0–V17 | V-scale only |
| QualityResult | ok, or failed with a reason (blurry, too dark, no wall detected) and a message | — |

**Functions (mock now, HTTP later)**

| Function | Takes | Returns | Notes |
| --- | --- | --- | --- |
| checkImageQuality | image | QualityResult | — |
| createScan | image, placeId, CaptureMeta (v4) | scanId | Adds the image to the training corpus; backend queues the hold depth job |
| getScan | scanId | Scan | Poll until status is done |
| getOptimalPath | scanId, routeId, ClimberProfile | list of PathSteps | Never cached; stays mocked while path planning is on hold |
| submitGrade | routeId, VGrade | Route | — |
| submitCorrections | scanId, list of HoldCorrections | Scan | Returns updated holds and routes |
| getNearbyPlaces | latitude, longitude | list of Places | Backend matches and dedupes |
| searchPlaces | query | list of Places | — |
| createPlace | name, optional latitude and longitude | Place | — |
| listScansByPlace | placeId | list of Scans | — |
| signUp, logIn, logOut, getCurrentUser | account details | user/session | Mocked in Phase 1 |
| updateProfile | ClimberProfile | nothing | — |

**Mock behavior:** realistic delays (1–3 s); 2–3 fixture wall photos with hand-labeled holds and routes; a small fixture list of Bay Area gyms for getNearbyPlaces; mock getOptimalPath returns slightly different sequences for different heights so the personalization UI can be tested; mock createScan checks and logs CaptureMeta but otherwise ignores it; mock submitCorrections applies the edits to the fixture scan so the UI updates realistically; and a dev menu toggle to force quality-check failure, processing failure, and "no routes found."

## 8. Data model (shared by both phases)

- **User** → has one ClimberProfile, many Scans, many GradeVotes.
- **Place** → has many Scans and stores coordinates when known.
- **Scan** → has one image, one CaptureMeta, one WallSurface, many Holds, many Routes, and is added to the training corpus on creation. Scan also has many Corrections (who made it, what changed, when), which are kept as training labels.
- **Route** → references Holds and has many GradeVotes (V-scale only).
- **Hold** → has zero or one HoldDepthRecord.
- **WallSurface** (v4, backend only) → the fitted wall planes for a scan, wall angle, and the depth model version used.
- **HoldDepthRecord** (v4, backend only) → one hold's front-surface representation as listed in M11: height map, point cloud, normal map, summary measurements, context, provenance and confidence.

WallSurface and HoldDepthRecords are derived data: they are regenerated when a correction changes a hold or when a model or pipeline version changes, and each records the versions that produced it. Optimal paths are not stored as permanent data; they're computed per request from the scan, route, profile, and current model.

## 9. Phase 1 milestones

**M0 — Project setup and design system.** Expo + TypeScript + Expo Router project runs in Expo Go on an iPhone; `APP_NAME` constant and placeholder logo in place; UI UX Pro Max installed and `MASTER.md` generated; theme tokens exported from `MASTER.md` into `src/theme/`; mock API scaffold with fixture data. *Done when:* app boots in Expo Go showing a themed Capitan placeholder screen, and Stanley has approved the generated design system.

**M1 — Navigation shell, onboarding, mock auth, profile setup.** Tab/stack structure for all screens in Section 6 (placeholders OK); onboarding carousel with photo tips; mocked sign up / log in; climber profile setup with height and wingspan and a unit toggle. *Done when:* every screen is reachable, onboarding and login persist across restarts, and measurements are stored in cm regardless of display unit.

**M2 — Capture, place picker, quality check.** Camera with permission handling and framing guide; preview with retake; capture metadata (EXIF focal length, original and upload dimensions, DeviceMotion gravity) recorded at the shutter, before compression strips EXIF, and passed to `createScan`; place picker with location permission, nearby-gym list from the mock, search fallback, and add-new; quality check call with pass and fail/retake paths; image compressed before "upload." *Done when:* pass, forced-fail, and location-denied paths all work end to end on an iPhone, and a logged `CaptureMeta` shows a focal length and gravity vector on a real device.

**M3 — Processing and results.** Processing placeholder with polling; results screen rendering hold polygons from fixture data over the photo, with pinch-zoom/pan keeping overlays aligned; route picker listing routes with text label, swatch, and community grade. *Done when:* overlays stay aligned at every zoom level on a small and a large iPhone.

**M4 — Personalized path view, corrections, and grade entry.** Selected route highlighted, others dimmed; numbered hand/foot markers distinguishable by shape and label; step-through mode; path fetched with the user's profile on every open; correction mode (recolor, delete, draw-to-add, undo, submit); V-scale grade entry. *Done when:* changing height in the profile and reopening a route shows the mock's different sequence; a correction made on the results screen is reflected in the route list and path; and a climber can follow the steps on a fixture wall without explanation.

**M5 — Profile and saved walls.** Profile screen with editable measurements and sign out; auto-save of scans; saved walls grouped by place; place detail list; reopening a saved scan re-requests the path. *Done when:* scans survive app restart and group correctly under places.

**M6 — Polish and QA.** Empty/error/loading states everywhere; accessibility pass (VoiceOver labels, contrast, Dynamic Type, color-independent route and limb identification); UI UX Pro Max pre-delivery checklist; testing on at least two iPhone sizes via Expo Go. *Done when:* checklist passes and Stanley signs off.

**STOP here. Ask Stanley before starting Phase 2.**

## 10. Phase 2 outline (draft — not to be started without approval)

Phase 2's current goal is a hold depth dataset: for every hold in every scan, a metric 3D representation of the hold's front surface, built with Depth Anything 3. Personalized path planning (M12) is on hold until the dataset exists. Details will be settled with Stanley before any work begins.

**Per-scan pipeline:** quality check (M7) → hold detection (M9) → route grouping (M10) → hold depth records (M11) → records saved to the dataset.

**M7 Image quality check:** blur/exposure scoring plus an "is this a climbing wall" check, behind checkImageQuality.

**M8 Place matching:** getNearbyPlaces and createPlace dedupe gyms using coordinates plus fuzzy name matching, so "Mission Cliffs" and "mission cliffs SF" resolve to one place.

**M9 Hold detection and segmentation:** instance segmentation model producing hold polygons, starting from public climbing-hold datasets and training on the growing corpus.

**M10 Route grouping by color:** color classification per hold, robust to gym lighting, chalk, and similar-looking colors.

### M11 Hold depth dataset (current focus)

Every detected hold gets a depth record describing its visible front surface in real units, in a frame attached to the wall rather than the camera, so holds from different photos and gyms can be compared directly.

**Model.** ByteDance Depth Anything 3, checkpoint DA3METRIC-LARGE (0.35B parameters, Apache-2.0), served on a GPU in the backend. The DA3 any-view Large/Giant and Nested checkpoints are CC-BY-NC 4.0 and are not used. The checkpoint version is pinned and recorded on every record.

**When it runs.** Once per scan as a background job after hold detection; again for any hold touched by a user correction; and across the whole corpus whenever the depth or detection model version changes. Stored images plus capture metadata are enough to regenerate every record.

**Steps.**

1. **Camera intrinsics.** Focal length in pixels comes from the capture metadata: the 35mm-equivalent focal length divided by 36 and multiplied by the image's long side in pixels. If EXIF is missing, use a default for that iPhone model and flag the scan's records as low confidence.
2. **Wall depth.** Run DA3METRIC-LARGE on the full image and convert its output to meters (per the DA3 docs, metric depth equals focal length in pixels times the model output, divided by 300).
3. **Wall surface.** Mask out every detected hold, then fit the bare wall with 1–3 planes so kinks, overhang transitions and volumes are captured. Use the gravity vector from capture to align the result with true vertical and record the wall angle.
4. **Hold detail.** Run DA3METRIC-LARGE again on a padded crop around each hold (batched), so small holds get enough pixels. Align each crop's scale to the full-image depth using the ring of bare wall around the hold, so every hold shares the wall's scale.
5. **Hold frame.** Give each hold a local frame: origin at the center of its footprint on the wall surface, one axis pointing out of the wall, one pointing up along the wall (gravity projected onto the wall), one pointing right.
6. **Front-surface representation.** In that frame, produce the outputs in the table below.
7. **Confidence.** Score each hold from its mask size in pixels, depth noise inside the mask, agreement between crop and full-image scale, occlusion by neighboring holds, and whether intrinsics and gravity were measured or assumed. Low-confidence records are kept but flagged.

**What each hold record holds:**

| Part | Contents | Units |
| --- | --- | --- |
| Height map | Protrusion above the wall on a fixed grid covering the hold's footprint; cells outside the mask left empty | mm, with a recorded mm-per-cell scale |
| Point cloud | Back-projected front-surface points inside the hold mask, with their colors | mm, hold frame |
| Normal map | Surface direction at each height-map cell | unit vectors, hold frame |
| Summary | Max and mean protrusion, footprint width and height, estimated volume above the wall, dominant facing direction | mm, mm³, degrees |
| Context | Wall angle at the hold, hold position on the wall, route color, RGB crop and mask | degrees, mm |
| Provenance | Scan, place, capture date, intrinsics and gravity source, model and pipeline versions, confidence | — |

**Limits.** A single photo only sees the front of each hold; the back and any undercut beneath it are not captured. That matches the dataset's goal, and records note which side was visible.

**Validation.** At one gym, hand-measure 20–30 holds (protrusion and footprint with calipers), optionally with a reference scan from a photogrammetry or LiDAR app outside Capitan, then compare against the records.

**Done when:** every new scan produces a record for every hold; a correction regenerates the affected records; a validation report exists for the measured holds; and a full-corpus re-run from stored images reproduces the dataset.

### Later milestones

**M12 Personalized path planning — on hold.** Will use M11's records (3D hold positions, protrusion, facing direction, wall angle) with the climber's height and wingspan. Design to be written once the dataset exists. Until then, getOptimalPath stays on the Phase 1 mock.

**M13 Training-corpus loop:** every scan and every user correction is added to the corpus, with corrections serving as ground-truth labels. The model is trained to generalize across walls rather than memorize specific ones, so scans from before a reset stay in the training set. Detection models are retrained as the corpus grows. A correction that changes a hold regenerates that hold's depth record. DA3 itself is not fine-tuned, since users don't label depth.

**M14 API service, storage, real auth:** endpoints from Section 7, storage for images and hold depth records, database, a GPU inference service for DA3 and the detection models, and a real auth provider replacing the mock.

**M15 Integration:** swap the mock API for the real one (except getOptimalPath while M12 is on hold); end-to-end testing at a real gym, including the M11 validation.

**Not possible in Expo Go:** iPhone LiDAR depth needs a native module, so LiDAR fusion is out of scope until the app leaves Expo Go.

## 11. Decisions and open questions

**Decided (v2–v3):**

- Paths show hands and feet, personalized by height and wingspan.
- Grades are entered by users.
- GPS suggests nearby gyms. The frontend reads location and shows suggestions; matching and deduplication happen in the backend (mocked in Phase 1).
- Auth is mocked in Phase 1.
- Scans add data to the training corpus; each path request uses the model trained on the current corpus.
- iOS only for now.
- App name: Capitan (renameable); placeholder logo.
- Users can correct hold detection and route colors; corrections become training labels.
- Grades use the V-scale only (VB, V0–V17).
- Old scans stay in the training set; the model should generalize to any wall, so there is no per-wall tagging and no "wall" field in the place picker.

**Decided (v4):**

- Phase 2's current goal is a hold depth dataset: a metric 3D representation of the front surface of every hold, in a wall-aligned frame.
- Depth comes from ByteDance Depth Anything 3, checkpoint DA3METRIC-LARGE (Apache-2.0). CC-BY-NC DA3 checkpoints are excluded.
- Depth records are built for every hold at scan time, not per route on request, and regenerated after corrections or model updates.
- Optimal-path planning is on hold; getOptimalPath stays mocked until it resumes.
- The frontend sends capture metadata (EXIF focal length, image sizes, gravity) with createScan; this adds expo-sensors, which works in Expo Go.

**Still open:**

- [ ] Accuracy target: what protrusion and size error (mm) is acceptable before a hold record is flagged low confidence?
- [ ] Height-map resolution: grid size and mm per cell.
- [ ] Dataset export format and how snapshots are versioned for training.
- [ ] Multi-photo or video scans: DA3's multi-view mode would capture more of each hold, but its larger any-view checkpoints are non-commercial. Revisit once the license of each smaller checkpoint is confirmed.
- [ ] Parked until path planning resumes: whether any hold can be used for feet or only the route's own holds.
