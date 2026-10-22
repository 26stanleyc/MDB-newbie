/**
 * Dev-only toggles that force otherwise-random/back-end-owned outcomes so every
 * failure path can be exercised in Expo Go (design doc §7 "dev menu toggle").
 *
 * Kept as a plain mutable module for now; a dev-menu UI wires into it in a later
 * milestone. Intentionally not persisted — these reset on reload.
 */
export const devFlags = {
  forceQualityFailure: false,
  forceProcessingFailure: false,
  forceNoRoutesFound: false,
};

export type DevFlag = keyof typeof devFlags;
