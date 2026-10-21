import { NEARBY_PLACES, SEED_SCANS } from '@/api/fixtures';
import type { VGrade } from '@/api/types';

/** Mock data for the design lab, derived from the Phase 1 fixtures. */

export type LabWall = { id: string; name: string; imageUri: string; routeCount: number; date: string };
export type LabRoute = { id: string; name: string; color: string; grade?: VGrade; wallId: string; wallName: string };
export type LabSend = { id: string; routeName: string; color: string; grade: VGrade; when: string };

const WALL_NAMES: Record<string, string> = { 'scan-1': 'Overhang wall', 'scan-2': 'Slab wall' };

export const GYM = NEARBY_PLACES[0];
export const GYMS = NEARBY_PLACES;

export const WALLS: LabWall[] = Object.values(SEED_SCANS).map((s) => ({
  id: s.id,
  name: WALL_NAMES[s.id] ?? 'Wall',
  imageUri: s.imageUri,
  routeCount: s.routes.length,
  date: new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
}));

export const ROUTES: LabRoute[] = Object.values(SEED_SCANS).flatMap((s) =>
  s.routes.map((r) => ({
    id: r.id,
    name: r.displayName,
    color: r.color,
    grade: r.communityGrade?.grade,
    wallId: s.id,
    wallName: WALL_NAMES[s.id] ?? 'Wall',
  })),
);

export const SEED_SENDS: LabSend[] = [
  { id: 's1', routeName: 'Green', color: 'green', grade: 'V1', when: 'Tuesday' },
  { id: 's2', routeName: 'Blue', color: 'blue', grade: 'V3', when: 'Monday' },
];

/** Keypad order, 3 columns. */
export const GRADES: VGrade[] = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10'];
