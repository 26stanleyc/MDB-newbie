import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';

import type { Vec3 } from '@/api';

/**
 * expo-sensors has no direct gravity field. Gravity (m/s²) is the acceleration
 * *including* gravity minus the user's own acceleration, which cancels motion
 * and leaves the pull of gravity. Direction is what the depth pipeline needs.
 */
export function toGravity(d: DeviceMotionMeasurement): Vec3 | undefined {
  const aig = d.accelerationIncludingGravity;
  if (!aig) return undefined;
  const a = d.acceleration ?? { x: 0, y: 0, z: 0 };
  return { x: aig.x - a.x, y: aig.y - a.y, z: aig.z - a.z };
}

/** Pull focal lengths out of expo-camera's EXIF bag (key names vary by OS). */
export function parseFocal(exif: unknown): {
  focalLengthMm?: number;
  focalLength35mm?: number;
} {
  if (!exif || typeof exif !== 'object') return {};
  const e = exif as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);
  return {
    focalLengthMm: num(e.FocalLength ?? e.focalLength),
    focalLength35mm: num(
      e.FocalLenIn35mmFilm ?? e.FocalLengthIn35mmFilm ?? e.FocalLenIn35mmFormat,
    ),
  };
}

/**
 * Grab one DeviceMotion gravity sample within `timeoutMs`. Best-effort and
 * non-blocking: if motion is unavailable it resolves to undefined so capture is
 * never held up and the user does nothing extra. No iOS permission prompt —
 * raw device-motion doesn't require one.
 */
export async function readGravity(timeoutMs = 350): Promise<Vec3 | undefined> {
  const available = await DeviceMotion.isAvailableAsync().catch(() => false);
  if (!available) return undefined;
  return new Promise<Vec3 | undefined>((resolve) => {
    let done = false;
    const finish = (v: Vec3 | undefined) => {
      if (done) return;
      done = true;
      sub.remove();
      resolve(v);
    };
    DeviceMotion.setUpdateInterval(100);
    const sub = DeviceMotion.addListener((d) => {
      const g = toGravity(d);
      if (g) finish(g);
    });
    setTimeout(() => finish(undefined), timeoutMs);
  });
}
