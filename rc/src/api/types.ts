/**
 * Frontend ↔ backend API contract (design doc §7).
 *
 * The mock implementation (Phase 1) and the future HTTP implementation (Phase 2)
 * both satisfy `CapitanApi`, so swapping them changes no call sites.
 */

/** Normalized 0–1 image coordinates, so overlays scale with any rendered size. */
export type Point = { x: number; y: number };

export type Limb = 'LH' | 'RH' | 'LF' | 'RF';

export type ClimberProfile = { heightCm: number; wingspanCm: number };

export type Hold = {
  id: string;
  polygon: Point[]; // outline for overlay
  color: string; // route color label, e.g. "blue"
  confidence: number; // 0–1
  // Filled in by the backend's analysis phase a few seconds after the scan is done
  // (Scan.analysis === 'done'); absent before that.
  quality?: number; // 0–1 heuristic: size + how far it stands out from the wall
  gripPoint?: Point | null; // where to grab it
  wallAngleDeg?: number | null; // local wall angle: 0 vertical, + overhang, − slab; null without gravity
  relWallAngleDeg?: number; // vs the scan's main wall, + = steeper
};

export type PathStep = { order: number; holdId: string; limb: Limb };

/** One of several betas offered for a route; the climber's pick is preference data. */
export type PathOption = { id: string; label: string; steps: PathStep[] };

export type Route = {
  id: string;
  color: string;
  displayName: string; // "Blue", "Route 3"
  holdIds: string[];
  communityGrade?: { grade: VGrade; votes: number };
  custom?: boolean; // picked by the climber (tap-to-pick), not grouped by color
  startHoldId?: string;
};

export type Place = {
  id: string;
  name: string;
  distanceM?: number;
  scanCount: number;
  address?: string; // from Google Places, when the gym came from there
  suggested?: boolean; // the gym the climber is probably standing in (nearby list only)
};

export type Scan = {
  id: string;
  placeId: string;
  imageUri: string;
  createdAt: string;
  status: 'processing' | 'done' | 'failed';
  holds: Hold[];
  routes: Route[];
  analysis?: 'pending' | 'done' | 'failed'; // hold quality + wall angle phase
  wall?: {
    angleDeg: number | null; // main wall vs vertical (needs CaptureMeta.gravity)
    source: 'gravity' | 'no_gravity';
    relRangeDeg: [number, number] | null; // spread of local angles vs the main wall
  };
};

export type HoldCorrection =
  | { kind: 'recolor'; holdId: string; newColor: string }
  | { kind: 'delete'; holdId: string }
  | { kind: 'add'; box: { topLeft: Point; bottomRight: Point }; color: string };

export type VGrade =
  | 'VB'
  | `V${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17}`;

export type QualityResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'blurry' | 'too_dark' | 'no_wall_detected';
      message: string;
    };

/**
 * A captured/prepared image handed to the API. Not spelled out in §7; kept
 * minimal so it matches what expo-camera / expo-image-manipulator return.
 */
export type ImageInput = { uri: string; width: number; height: number };

/**
 * How the wall was captured. `quick` = one photo (fast, approximate geometry);
 * `precise` = several overlapping photos the backend reconstructs in 3D for true
 * wall angles + metric hold positions (design doc §11, multi-view option).
 */
export type ScanMode = 'quick' | 'precise';

export type Vec3 = { x: number; y: number; z: number };

/**
 * Capture metadata recorded at the shutter, before compression strips EXIF (§7
 * v4). Frontend-only in Phase 1 (the mock logs it and ignores it); feeds the
 * Phase 2 depth pipeline. Focal length and gravity are optional — a scan whose
 * EXIF/motion is missing is still valid, just flagged low-confidence later.
 */
export type CaptureMeta = {
  originalWidth: number;
  originalHeight: number;
  uploadWidth: number;
  uploadHeight: number;
  focalLengthMm?: number; // EXIF FocalLength
  focalLength35mm?: number; // EXIF 35mm-equivalent focal length
  gravity?: Vec3; // DeviceMotion gravity at the moment of capture
};

/** A starter wall every app gets in Saved walls (seeded on the backend). */
export type FeaturedScan = {
  scanId: string;
  placeId: string;
  placeName: string;
  imageUri: string;
  createdAt: string;
};

/** Mocked auth (§5, §8). Minimal shape; fleshed out in Phase 2. */
export type User = { id: string; email: string; profile?: ClimberProfile };

/**
 * The full API surface (design doc §7). Mock now, HTTP later.
 */
export interface CapitanApi {
  checkImageQuality(image: ImageInput): Promise<QualityResult>;
  // also adds the image(s) to the training corpus; backend queues the depth job.
  // `images`/`metas` are arrays: a quick scan has one; a precise (multi-view) scan
  // has several overlapping views that the Phase 2 backend reconstructs in 3D.
  createScan(
    images: ImageInput[],
    placeId: string,
    metas: CaptureMeta[],
    mode: ScanMode,
  ): Promise<{ scanId: string }>;
  // poll until status === "done"
  getScan(scanId: string): Promise<Scan>;
  // never cached — computed per request from scan, route, profile, current model
  getOptimalPath(
    scanId: string,
    routeId: string,
    profile: ClimberProfile,
  ): Promise<PathStep[]>;
  // 2–3 different betas for the climber to choose between ("Suggested" first; a saved
  // path, if any, first as "Your path").
  getPathOptions(scanId: string, routeId: string, profile: ClimberProfile): Promise<PathOption[]>;
  // The climber's pick among the shown options: logged as preference data and kept as
  // their path for this route. Returns the chosen steps.
  choosePath(
    scanId: string,
    routeId: string,
    optionId: string,
    shownIds: string[],
    profile: ClimberProfile,
  ): Promise<PathStep[]>;
  submitGrade(routeId: string, grade: VGrade): Promise<Route>;
  // returns the updated scan with corrections applied
  submitCorrections(scanId: string, corrections: HoldCorrection[]): Promise<Scan>;
  // Tap-to-pick: hold ids of the route that likely starts at the tapped hold.
  suggestRoute(scanId: string, startHoldId: string): Promise<string[]>;
  // Save a climber-picked route (also labeled training data). Returns the new route.
  createRoute(scanId: string, holdIds: string[], startHoldId?: string): Promise<Route>;
  // Submit a user-corrected optimal path for (scan, route, profile) as labeled
  // training data. Phase 2 persists it so the shared path model learns from it;
  // the mock stores it so getOptimalPath returns the corrected path next time.
  // Returns the saved (re-normalized) path.
  submitPathCorrection(
    scanId: string,
    routeId: string,
    steps: PathStep[],
    profile: ClimberProfile,
  ): Promise<PathStep[]>;
  // backend matches + dedupes
  getNearbyPlaces(lat: number, lng: number): Promise<Place[]>;
  // lat/lng (optional) bias the gym search toward the climber.
  searchPlaces(query: string, lat?: number, lng?: number): Promise<Place[]>;
  createPlace(name: string, lat?: number, lng?: number): Promise<Place>;
  listScansByPlace(placeId: string): Promise<Scan[]>;
  // Starter walls shown in Saved walls before (and alongside) the climber's own scans.
  getFeaturedScans(): Promise<FeaturedScan[]>;

  signUp(email: string, password: string): Promise<User>;
  logIn(email: string, password: string): Promise<User>;
  logOut(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  updateProfile(profile: ClimberProfile): Promise<void>;
}
