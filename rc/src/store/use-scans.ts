import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Place } from '@/api';

import { asyncStorage } from './persist';

/** Lightweight record of a saved scan (the full Scan is re-fetched on open). */
export type SavedScan = {
  scanId: string;
  placeId: string;
  placeName: string;
  imageUri: string;
  createdAt: string;
  photoHash?: string; // same photo (re-uploaded) → one saved wall
};

const SAME_PHOTO_BITS = 6; // matches backend/pipeline/photo_hash.py

/** Whether two photo fingerprints (16 hex chars) are the same photo. */
function samePhoto(a?: string, b?: string): boolean {
  if (!a || !b || a.length !== 16 || b.length !== 16) return false;
  let bits = 0;
  for (let i = 0; i < 16; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) {
      bits += x & 1;
      x >>>= 1;
    }
  }
  return bits <= SAME_PHOTO_BITS;
}

type ScansState = {
  scans: SavedScan[];
  places: Record<string, Pick<Place, 'id' | 'name'>>;
  /** Scans the climber deleted; kept so starter walls don't come back on the next fetch. */
  removed: string[];
  /**
   * climbed: the climber just finished a route on it — it replaces an earlier save of
   * the same photo and comes back even if they had deleted it. Without it (starter
   * walls) a wall whose photo is already saved, or was deleted, is skipped.
   */
  addScan: (scan: SavedScan, opts?: { climbed?: boolean }) => void;
  removeScan: (scanId: string) => void;
  /** Fill in fingerprints for walls saved before they existed, then keep one per photo. */
  setPhotoHashes: (hashes: Record<string, string>) => void;
  placesWithScans: () => { id: string; name: string; count: number }[];
  scansForPlace: (placeId: string) => SavedScan[];
};

/** Saved-walls history, grouped by place. Persisted so it survives restart (M5). */
export const useScans = create<ScansState>()(
  persist(
    (set, get) => ({
      scans: [],
      places: {},
      removed: [],
      addScan: (scan, opts) =>
        set((s) => {
          const same = (e: SavedScan) =>
            e.scanId === scan.scanId || samePhoto(e.photoHash, scan.photoHash);
          if (!opts?.climbed && (s.scans.some(same) || s.removed.includes(scan.scanId))) return s;
          return {
            scans: [scan, ...s.scans.filter((e) => !same(e))], // one entry per photo, newest
            removed: s.removed.filter((id) => id !== scan.scanId),
            places: {
              ...s.places,
              [scan.placeId]: { id: scan.placeId, name: scan.placeName },
            },
          };
        }),
      // Only the climber's list: the server keeps the scan (it's training data).
      removeScan: (scanId) =>
        set((s) => ({
          scans: s.scans.filter((e) => e.scanId !== scanId),
          removed: [...s.removed, scanId],
        })),
      setPhotoHashes: (hashes) =>
        set((s) => {
          const newestFirst = s.scans
            .map((e) => (hashes[e.scanId] ? { ...e, photoHash: hashes[e.scanId] } : e))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const kept: SavedScan[] = [];
          for (const e of newestFirst) {
            if (!kept.some((k) => samePhoto(k.photoHash, e.photoHash))) kept.push(e);
          }
          return { scans: kept };
        }),
      placesWithScans: () => {
        const { scans, places } = get();
        const counts = new Map<string, number>();
        for (const s of scans) counts.set(s.placeId, (counts.get(s.placeId) ?? 0) + 1);
        return [...counts.entries()]
          .map(([id, count]) => ({ id, name: places[id]?.name ?? 'Unknown', count }))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      scansForPlace: (placeId) =>
        get()
          .scans.filter((s) => s.placeId === placeId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }),
    { name: 'capitan-scans', storage: asyncStorage },
  ),
);
