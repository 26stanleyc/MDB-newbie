import { Asset } from 'expo-asset';

import type { Hold, Place, Point, Route, Scan } from './types';

/**
 * Hand-labeled fixture data for Phase 1 (design doc §7 "mock behavior").
 *
 * The wall images here are generated placeholders — replace them with real gym
 * photos (and re-label the holds against them) before the M3 results screen.
 */

// Asset.fromModule resolves a bundled image to a URI on both native and web
// (RN's Image.resolveAssetSource doesn't exist in react-native-web).
const wallUri = (mod: number): string => Asset.fromModule(mod).uri;

/** Small square-ish polygon (normalized 0–1) centered on a hold. */
function box(cx: number, cy: number, s = 0.03): Point[] {
  return [
    { x: cx - s, y: cy - s },
    { x: cx + s, y: cy - s },
    { x: cx + s, y: cy + s },
    { x: cx - s, y: cy + s },
  ];
}

// --- Places: a small fixture list of Bay Area gyms (§7) --------------------

export const NEARBY_PLACES: Place[] = [
  { id: 'place-mc', name: 'Mission Cliffs', distanceM: 320, scanCount: 2 },
  { id: 'place-db', name: 'Dogpatch Boulders', distanceM: 1400, scanCount: 0 },
  { id: 'place-mb', name: 'Movement Presidio', distanceM: 2600, scanCount: 0 },
  { id: 'place-gw', name: 'GreatWall Berkeley', distanceM: 12800, scanCount: 0 },
  { id: 'place-bp', name: 'Bridges Rock Gym', distanceM: 18400, scanCount: 0 },
];

// --- Wall 1: blue + pink routes --------------------------------------------

const wall1Holds: Hold[] = [
  { id: 'w1-b1', polygon: box(0.3, 0.85), color: 'blue', confidence: 0.97 },
  { id: 'w1-b2', polygon: box(0.42, 0.68), color: 'blue', confidence: 0.94 },
  { id: 'w1-b3', polygon: box(0.36, 0.5), color: 'blue', confidence: 0.91 },
  { id: 'w1-b4', polygon: box(0.5, 0.34), color: 'blue', confidence: 0.88 },
  { id: 'w1-b5', polygon: box(0.44, 0.18), color: 'blue', confidence: 0.82 },
  { id: 'w1-p1', polygon: box(0.66, 0.82), color: 'pink', confidence: 0.95 },
  { id: 'w1-p2', polygon: box(0.6, 0.62), color: 'pink', confidence: 0.9 },
  { id: 'w1-p3', polygon: box(0.72, 0.46), color: 'pink', confidence: 0.86 },
  { id: 'w1-p4', polygon: box(0.64, 0.28), color: 'pink', confidence: 0.79 },
];

const wall1Routes: Route[] = [
  {
    id: 'w1-blue',
    color: 'blue',
    displayName: 'Blue',
    holdIds: ['w1-b1', 'w1-b2', 'w1-b3', 'w1-b4', 'w1-b5'],
    communityGrade: { grade: 'V3', votes: 8 },
  },
  {
    id: 'w1-pink',
    color: 'pink',
    displayName: 'Pink',
    holdIds: ['w1-p1', 'w1-p2', 'w1-p3', 'w1-p4'],
    communityGrade: { grade: 'V5', votes: 3 },
  },
];

// --- Wall 2: green + purple routes ------------------------------------------

const wall2Holds: Hold[] = [
  { id: 'w2-g1', polygon: box(0.28, 0.86), color: 'green', confidence: 0.96 },
  { id: 'w2-g2', polygon: box(0.34, 0.66), color: 'green', confidence: 0.92 },
  { id: 'w2-g3', polygon: box(0.26, 0.48), color: 'green', confidence: 0.89 },
  { id: 'w2-g4', polygon: box(0.38, 0.3), color: 'green', confidence: 0.84 },
  { id: 'w2-u1', polygon: box(0.7, 0.84), color: 'purple', confidence: 0.94 },
  { id: 'w2-u2', polygon: box(0.62, 0.64), color: 'purple', confidence: 0.9 },
  { id: 'w2-u3', polygon: box(0.74, 0.44), color: 'purple', confidence: 0.85 },
  { id: 'w2-u4', polygon: box(0.66, 0.24), color: 'purple', confidence: 0.8 },
];

const wall2Routes: Route[] = [
  {
    id: 'w2-green',
    color: 'green',
    displayName: 'Green',
    holdIds: ['w2-g1', 'w2-g2', 'w2-g3', 'w2-g4'],
    communityGrade: { grade: 'V1', votes: 12 },
  },
  {
    id: 'w2-purple',
    color: 'purple',
    displayName: 'Purple',
    holdIds: ['w2-u1', 'w2-u2', 'w2-u3', 'w2-u4'],
  },
];

/** Seed scans keyed by id. The mock clones from these so edits don't leak. */
export const SEED_SCANS: Record<string, Scan> = {
  'scan-1': {
    id: 'scan-1',
    placeId: 'place-mc',
    imageUri: wallUri(require('../../assets/fixtures/wall-1.png')),
    createdAt: '2026-09-28T18:12:00.000Z',
    status: 'done',
    holds: wall1Holds,
    routes: wall1Routes,
  },
  'scan-2': {
    id: 'scan-2',
    placeId: 'place-mc',
    imageUri: wallUri(require('../../assets/fixtures/wall-2.png')),
    createdAt: '2026-09-29T20:40:00.000Z',
    status: 'done',
    holds: wall2Holds,
    routes: wall2Routes,
  },
};
