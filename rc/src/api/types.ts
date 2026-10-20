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
};

export type PathStep = { order: number; holdId: string; limb: Limb };

export type Route = {
  id: string;
  color: string;
  displayName: string; // "Blue", "Route 3"
  holdIds: string[];
  communityGrade?: { grade: VGrade; votes: number };
};

export type Place = {
  id: string;
  name: string;
  distanceM?: number;
  scanCount: number;
};

export type Scan = {
  id: string;
  placeId: string;
  imageUri: string;
  createdAt: string;
  status: 'processing' | 'done' | 'failed';
  holds: Hold[];
  routes: Route[];
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
  submitGrade(routeId: string, grade: VGrade): Promise<Route>;
  // returns the updated scan with corrections applied
  submitCorrections(scanId: string, corrections: HoldCorrection[]): Promise<Scan>;
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
  searchPlaces(query: string): Promise<Place[]>;
  createPlace(name: string, lat?: number, lng?: number): Promise<Place>;
  listScansByPlace(placeId: string): Promise<Scan[]>;

  signUp(email: string, password: string): Promise<User>;
  logIn(email: string, password: string): Promise<User>;
  logOut(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  updateProfile(profile: ClimberProfile): Promise<void>;
}
