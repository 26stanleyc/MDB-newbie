import { Platform } from 'react-native';

import { API_URL } from '@/config/api';

import { mockApi } from './mock';
import type {
  CapitanApi,
  CaptureMeta,
  ClimberProfile,
  HoldCorrection,
  ImageInput,
  PathStep,
  Place,
  QualityResult,
  Route,
  Scan,
  ScanMode,
  VGrade,
} from './types';

/**
 * Phase 2 implementation of CapitanApi against the Python backend.
 * Auth and profile stay on the local mock until real accounts are designed.
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error(`Can't reach the Capitan server at ${API_URL}. Is it running?`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Server error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Appends an image file to multipart form data (native file URI or web blob URL). */
async function appendImage(form: FormData, field: string, image: ImageInput, i: number) {
  const name = `view_${i}.jpg`;
  if (Platform.OS === 'web') {
    form.append(field, await (await fetch(image.uri)).blob(), name);
  } else {
    // React Native's FormData accepts a { uri, name, type } file descriptor.
    form.append(field, { uri: image.uri, name, type: 'image/jpeg' } as unknown as Blob);
  }
}

export const httpApi: CapitanApi = {
  async checkImageQuality(image: ImageInput): Promise<QualityResult> {
    const form = new FormData();
    await appendImage(form, 'image', image, 0);
    return request('/quality', { method: 'POST', body: form });
  },

  async createScan(
    images: ImageInput[],
    placeId: string,
    metas: CaptureMeta[],
    mode: ScanMode,
  ): Promise<{ scanId: string }> {
    const form = new FormData();
    for (const [i, image] of images.entries()) await appendImage(form, 'images', image, i);
    form.append('placeId', placeId);
    form.append('metas', JSON.stringify(metas));
    form.append('mode', mode);
    return request('/scans', { method: 'POST', body: form });
  },

  getScan: (scanId: string): Promise<Scan> => request(`/scans/${scanId}`),

  getOptimalPath: (scanId: string, routeId: string, profile: ClimberProfile): Promise<PathStep[]> =>
    request(`/scans/${scanId}/routes/${routeId}/path`, json(profile)),

  submitPathCorrection: (
    scanId: string,
    routeId: string,
    steps: PathStep[],
    profile: ClimberProfile,
  ): Promise<PathStep[]> =>
    request(`/scans/${scanId}/routes/${routeId}/path-correction`, json({ steps, profile })),

  submitGrade: (routeId: string, grade: VGrade): Promise<Route> =>
    request(`/routes/${routeId}/grade`, json({ grade })),

  submitCorrections: (scanId: string, corrections: HoldCorrection[]): Promise<Scan> =>
    request(`/scans/${scanId}/corrections`, json({ corrections })),

  suggestRoute: async (scanId: string, startHoldId: string): Promise<string[]> =>
    (await request<{ holdIds: string[] }>(`/scans/${scanId}/routes/suggest`, json({ startHoldId }))).holdIds,

  createRoute: (scanId: string, holdIds: string[], startHoldId?: string): Promise<Route> =>
    request(`/scans/${scanId}/routes`, json({ holdIds, startHoldId })),

  getNearbyPlaces: (lat: number, lng: number): Promise<Place[]> =>
    request(`/places/nearby?lat=${lat}&lng=${lng}`),

  searchPlaces: (query: string): Promise<Place[]> =>
    request(`/places/search?q=${encodeURIComponent(query)}`),

  createPlace: (name: string, lat?: number, lng?: number): Promise<Place> =>
    request('/places', json({ name, lat, lng })),

  listScansByPlace: (placeId: string): Promise<Scan[]> => request(`/places/${placeId}/scans`),

  signUp: mockApi.signUp,
  logIn: mockApi.logIn,
  logOut: mockApi.logOut,
  getCurrentUser: mockApi.getCurrentUser,
  updateProfile: mockApi.updateProfile,
};
