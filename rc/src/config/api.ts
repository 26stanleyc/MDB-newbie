/**
 * Which API implementation the app uses, and where the backend lives.
 *
 * 'http' talks to the Python backend (`backend/server/app.py` in the parent
 * folder); 'mock' is the in-app Phase 1 mock. Override with EXPO_PUBLIC_API_MODE.
 */
import Constants from 'expo-constants';

export const API_MODE: 'mock' | 'http' =
  process.env.EXPO_PUBLIC_API_MODE === 'mock' ? 'mock' : 'http';

const BACKEND_PORT = 8000;

/**
 * Backend base URL. Defaults to the machine running the Expo dev server (the
 * phone already reaches it over Wi-Fi), on the backend's port. Override with
 * EXPO_PUBLIC_API_URL, e.g. http://192.168.1.20:8000.
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  `http://${Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost'}:${BACKEND_PORT}`;
