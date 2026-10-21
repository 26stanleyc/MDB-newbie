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
};

type ScansState = {
  scans: SavedScan[];
  places: Record<string, Pick<Place, 'id' | 'name'>>;
  /** Scans the climber deleted; kept so starter walls don't come back on the next fetch. */
  removed: string[];
  /** restore: also bring back a wall the climber deleted (they just climbed it again). */
  addScan: (scan: SavedScan, opts?: { restore?: boolean }) => void;
  removeScan: (scanId: string) => void;
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
          if (s.scans.some((e) => e.scanId === scan.scanId)) return s; // dedupe
          if (s.removed.includes(scan.scanId) && !opts?.restore) return s; // deleted by the climber
          return {
            scans: [scan, ...s.scans],
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
