/**
 * The single entry point for all backend calls.
 *
 * Import `api` everywhere; the implementation is chosen by the `API_MODE` flag
 * (src/config/api.ts). Phase 2 adds an HTTP client behind the same interface.
 */
import { API_MODE } from '@/config/api';

import { mockApi } from './mock';
import type { CapitanApi } from './types';

export const api: CapitanApi =
  API_MODE === 'mock'
    ? mockApi
    : // Phase 2: HTTP implementation of CapitanApi goes here.
      (() => {
        throw new Error('HTTP API not implemented yet (Phase 2).');
      })();

export * from './types';
