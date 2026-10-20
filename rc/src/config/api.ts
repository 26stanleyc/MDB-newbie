/**
 * Single flag that swaps the API implementation.
 *
 * Phase 1 uses the in-app mock. In Phase 2 the HTTP client will implement the
 * same `CapitanApi` interface and this flag flips to 'http' — no call sites change.
 */
export const API_MODE: 'mock' | 'http' = 'mock';
