import { devFlags } from './dev-flags';
import { NEARBY_PLACES, SEED_SCANS } from './fixtures';
import type {
  CapitanApi,
  CaptureMeta,
  ClimberProfile,
  Hold,
  HoldCorrection,
  ImageInput,
  PathOption,
  PathStep,
  Place,
  QualityResult,
  Route,
  Scan,
  ScanMode,
  User,
  VGrade,
} from './types';

/** Realistic network-ish delay, 1–3s (§7 "mock behavior"). */
const delay = (ms = 1000 + Math.random() * 2000) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// --- In-memory mutable state -------------------------------------------------

/** Working copies of scans, so corrections persist within a session. */
const scans: Record<string, Scan> = clone(SEED_SCANS);
/**
 * User-corrected optimal paths, keyed by scan+route+profile. In Phase 2 these
 * are labeled training data the shared path model learns from; the mock just
 * replays them so an edited path "sticks" the next time it's requested.
 */
const pathOverrides: Record<string, PathStep[]> = {};
const pathKey = (scanId: string, routeId: string, p: ClimberProfile) =>
  `${scanId}:${routeId}:${p.heightCm}:${p.wingspanCm}`;
const renumber = (steps: PathStep[]): PathStep[] =>
  steps.map((s, i) => ({ ...s, order: i + 1 }));
const extraPlaces: Place[] = [];
let currentUser: User | null = null;
let userProfile: ClimberProfile | null = null;
let scanCounter = Object.keys(scans).length;

function allPlaces(): Place[] {
  return [...NEARBY_PLACES, ...extraPlaces];
}

// --- Implementation ----------------------------------------------------------

export const mockApi: CapitanApi = {
  async checkImageQuality(_image: ImageInput): Promise<QualityResult> {
    await delay(800 + Math.random() * 800);
    if (devFlags.forceQualityFailure) {
      return {
        ok: false,
        reason: 'blurry',
        message: 'The photo looks blurry. Hold steady and try again.',
      };
    }
    return { ok: true };
  },

  async createScan(
    images: ImageInput[],
    placeId: string,
    metas: CaptureMeta[],
    mode: ScanMode,
  ): Promise<{ scanId: string }> {
    // Phase 1: log the capture metadata + scan mode and otherwise ignore them.
    // A precise scan sends several views the Phase 2 backend reconstructs in 3D;
    // the mock treats both the same and renders from a fixture.
    console.log(`[createScan] mode=${mode} images=${images.length}`, JSON.stringify(metas));
    // Precise scans take longer (multi-view reconstruction).
    await delay(mode === 'precise' ? 2500 + Math.random() * 1500 : undefined);
    scanCounter += 1;
    const scanId = `scan-${scanCounter}`;
    // New scans start processing; getScan resolves them (or fails via dev flag).
    scans[scanId] = {
      id: scanId,
      placeId,
      imageUri: images[0].uri,
      createdAt: new Date().toISOString(),
      status: 'processing',
      holds: [],
      routes: [],
    };
    // Seed the eventual result from a fixture wall so results render.
    const template = clone(SEED_SCANS['scan-1']);
    scans[scanId].holds = template.holds;
    scans[scanId].routes = devFlags.forceNoRoutesFound ? [] : template.routes;
    return { scanId };
  },

  async getScan(scanId: string): Promise<Scan> {
    await delay(600 + Math.random() * 1200);
    const scan = scans[scanId];
    if (!scan) throw new Error(`Scan ${scanId} not found`);
    if (scan.status === 'processing') {
      scan.status = devFlags.forceProcessingFailure ? 'failed' : 'done';
    }
    return clone(scan);
  },

  async getOptimalPath(
    scanId: string,
    routeId: string,
    profile: ClimberProfile,
  ): Promise<PathStep[]> {
    await delay(700 + Math.random() * 1000);
    const scan = scans[scanId];
    const route = scan?.routes.find((r) => r.id === routeId);
    if (!route) throw new Error(`Route ${routeId} not found`);

    // A previously saved correction wins — simulates the model having learned it.
    const override = pathOverrides[pathKey(scanId, routeId, profile)];
    if (override) return clone(override);

    const limbs: PathStep['limb'][] = ['RH', 'LH', 'RF', 'LF'];
    const ids = route.holdIds;
    // Taller climbers skip a hold to show personalization differs by profile.
    const stride = profile.heightCm >= 175 ? 1 : 0;
    const steps: PathStep[] = [];
    let order = 1;
    for (let i = 0; i < ids.length; i += 1) {
      if (stride && i > 0 && i < ids.length - 1 && i % 3 === 0) continue;
      steps.push({ order: order, holdId: ids[i], limb: limbs[order % limbs.length] });
      order += 1;
    }
    return steps;
  },

  async submitPathCorrection(
    scanId: string,
    routeId: string,
    steps: PathStep[],
    profile: ClimberProfile,
  ): Promise<PathStep[]> {
    await delay(500 + Math.random() * 700);
    const scan = scans[scanId];
    const route = scan?.routes.find((r) => r.id === routeId);
    if (!route) throw new Error(`Route ${routeId} not found`);
    const saved = renumber(steps);
    pathOverrides[pathKey(scanId, routeId, profile)] = clone(saved);
    return clone(saved);
  },

  async getPathOptions(scanId: string, routeId: string, profile: ClimberProfile): Promise<PathOption[]> {
    const suggested = await mockApi.getOptimalPath(scanId, routeId, profile);
    // Mock alternative: the same path with every other intermediate hand hold skipped.
    const alt = renumber(suggested.filter((s, i) => i < 2 || i === suggested.length - 1 || i % 2 === 0));
    const options: PathOption[] = [{ id: 'recommended', label: 'Suggested', steps: suggested }];
    if (alt.length !== suggested.length) options.push({ id: 'fewer', label: 'Fewer moves', steps: alt });
    return options;
  },

  async choosePath(
    scanId: string,
    routeId: string,
    optionId: string,
    _shownIds: string[],
    profile: ClimberProfile,
  ): Promise<PathStep[]> {
    const options = await mockApi.getPathOptions(scanId, routeId, profile);
    const chosen = options.find((o) => o.id === optionId);
    if (!chosen) throw new Error(`Path option ${optionId} not found`);
    pathOverrides[pathKey(scanId, routeId, profile)] = clone(chosen.steps);
    return clone(chosen.steps);
  },

  async submitGrade(routeId: string, grade: VGrade): Promise<Route> {
    await delay(500 + Math.random() * 700);
    for (const scan of Object.values(scans)) {
      const route = scan.routes.find((r) => r.id === routeId);
      if (route) {
        const votes = (route.communityGrade?.votes ?? 0) + 1;
        route.communityGrade = { grade, votes };
        return clone(route);
      }
    }
    throw new Error(`Route ${routeId} not found`);
  },

  async submitCorrections(
    scanId: string,
    corrections: HoldCorrection[],
  ): Promise<Scan> {
    await delay();
    const scan = scans[scanId];
    if (!scan) throw new Error(`Scan ${scanId} not found`);

    for (const c of corrections) {
      if (c.kind === 'recolor') {
        const hold = scan.holds.find((h) => h.id === c.holdId);
        if (hold) hold.color = c.newColor;
      } else if (c.kind === 'delete') {
        scan.holds = scan.holds.filter((h) => h.id !== c.holdId);
      } else {
        const { topLeft, bottomRight } = c.box;
        const newHold: Hold = {
          id: `${scanId}-add-${Math.random().toString(36).slice(2, 7)}`,
          polygon: [
            topLeft,
            { x: bottomRight.x, y: topLeft.y },
            bottomRight,
            { x: topLeft.x, y: bottomRight.y },
          ],
          color: c.color,
          confidence: 1,
        };
        scan.holds.push(newHold);
      }
    }

    // Regroup routes from holds by color so the route list reflects edits.
    const byColor = new Map<string, string[]>();
    for (const h of scan.holds) {
      byColor.set(h.color, [...(byColor.get(h.color) ?? []), h.id]);
    }
    scan.routes = [...byColor.entries()].map(([color, holdIds]) => {
      const existing = scan.routes.find((r) => r.color === color);
      return {
        id: existing?.id ?? `${scanId}-${color}`,
        color,
        displayName: existing?.displayName ?? capitalize(color),
        holdIds,
        communityGrade: existing?.communityGrade,
      };
    });
    return clone(scan);
  },

  async suggestRoute(scanId: string, startHoldId: string): Promise<string[]> {
    await delay(400 + Math.random() * 400);
    const scan = scans[scanId];
    const start = scan?.holds.find((h) => h.id === startHoldId);
    if (!start) throw new Error(`Hold ${startHoldId} not found`);
    // Mock: every hold of the tapped hold's color, start first.
    return [start.id, ...scan.holds.filter((h) => h.color === start.color && h.id !== start.id).map((h) => h.id)];
  },

  async createRoute(scanId: string, holdIds: string[], startHoldId?: string): Promise<Route> {
    await delay(400 + Math.random() * 400);
    const scan = scans[scanId];
    if (!scan) throw new Error(`Scan ${scanId} not found`);
    const color = scan.holds.find((h) => h.id === holdIds[0])?.color ?? 'grey';
    const n = scan.routes.filter((r) => r.custom).length + 1;
    const route: Route = {
      id: `${scanId}-custom-${n}`,
      color,
      displayName: `My route ${n}`,
      holdIds,
      custom: true,
      startHoldId,
    };
    scan.routes.unshift(route);
    return clone(route);
  },

  async getNearbyPlaces(_lat: number, _lng: number): Promise<Place[]> {
    await delay(600 + Math.random() * 900);
    return clone(allPlaces());
  },

  async searchPlaces(query: string): Promise<Place[]> {
    await delay(400 + Math.random() * 600);
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return clone(allPlaces().filter((p) => p.name.toLowerCase().includes(q)));
  },

  async createPlace(name: string, _lat?: number, _lng?: number): Promise<Place> {
    await delay(500 + Math.random() * 500);
    const place: Place = {
      id: `place-new-${extraPlaces.length + 1}`,
      name: name.trim(),
      scanCount: 0,
    };
    extraPlaces.push(place);
    return clone(place);
  },

  async listScansByPlace(placeId: string): Promise<Scan[]> {
    await delay(500 + Math.random() * 700);
    return clone(
      Object.values(scans)
        .filter((s) => s.placeId === placeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },

  async signUp(email: string, _password: string): Promise<User> {
    await delay(700 + Math.random() * 800);
    currentUser = { id: `user-${Date.now()}`, email, profile: userProfile ?? undefined };
    return clone(currentUser);
  },

  async logIn(email: string, _password: string): Promise<User> {
    await delay(700 + Math.random() * 800);
    currentUser = { id: `user-${Date.now()}`, email, profile: userProfile ?? undefined };
    return clone(currentUser);
  },

  async logOut(): Promise<void> {
    await delay(300);
    currentUser = null;
  },

  async getCurrentUser(): Promise<User | null> {
    await delay(200);
    return currentUser ? clone(currentUser) : null;
  },

  async updateProfile(profile: ClimberProfile): Promise<void> {
    await delay(400 + Math.random() * 400);
    userProfile = { ...profile };
    if (currentUser) currentUser.profile = { ...profile };
  },
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
