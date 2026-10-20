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
  addScan: (scan: SavedScan) => void;
  placesWithScans: () => { id: string; name: string; count: number }[];
  scansForPlace: (placeId: string) => SavedScan[];
};

/** Saved-walls history, grouped by place. Persisted so it survives restart (M5). */
export const useScans = create<ScansState>()(
  persist(
    (set, get) => ({
      scans: [],
      places: {},
      addScan: (scan) =>
        set((s) => {
          if (s.scans.some((e) => e.scanId === scan.scanId)) return s; // dedupe
          return {
            scans: [scan, ...s.scans],
            places: {
              ...s.places,
              [scan.placeId]: { id: scan.placeId, name: scan.placeName },
            },
          };
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
