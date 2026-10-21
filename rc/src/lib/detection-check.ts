import type { Hold } from '@/api';

/*
 * Thresholds from the stored scans (2026-10-21): every real wall photo had
 * 64–177 holds with a median confidence of 0.99 or more; a photo of a laptop
 * still got 18 "holds" at a median of 0.90.
 */
const MIN_HOLDS = 25;
const MIN_MEDIAN_CONFIDENCE = 0.95;

/** Why a scan's detections look too weak to trust, or null when they look fine. */
export function weakDetection(holds: Hold[]): string | null {
  if (holds.length === 0) return 'We didn’t find any holds in this photo.';
  if (holds.length < MIN_HOLDS) {
    return `We only found ${holds.length} ${holds.length === 1 ? 'hold' : 'holds'} — a wall usually has many more.`;
  }
  const conf = holds.map((h) => h.confidence).sort((a, b) => a - b);
  const median = conf[Math.floor(conf.length / 2)];
  if (median < MIN_MEDIAN_CONFIDENCE) return 'We weren’t confident about most of the holds we found.';
  return null;
}
