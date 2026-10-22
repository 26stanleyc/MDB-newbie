/**
 * The single entry point for all backend calls.
 *
 * Import `api` everywhere; the implementation is chosen by the `API_MODE` flag
 * (src/config/api.ts): the Python backend over HTTP, or the in-app mock.
 */
import { API_MODE } from '@/config/api';

import { httpApi } from './http';
import { mockApi } from './mock';
import type { CapitanApi } from './types';

export const api: CapitanApi = API_MODE === 'mock' ? mockApi : httpApi;

export * from './types';
