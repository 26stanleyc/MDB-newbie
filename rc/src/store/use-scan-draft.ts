import { create } from 'zustand';

import type { CaptureMeta, ImageInput, ScanMode } from '@/api';

type Capture = { image: ImageInput; meta: CaptureMeta };

type ScanDraftState = {
  /** Scan mode chosen for this flow: quick (1 photo) or precise (multi-view). */
  mode: ScanMode;
  /** Captures for the current scan flow (1 for quick, several for precise). */
  captures: Capture[];
  /** Last captured metadata, kept for dev-menu verification. */
  lastMeta: CaptureMeta | null;
  startScan: (mode: ScanMode) => void;
  addCapture: (capture: Capture) => void;
  clear: () => void;
};

/**
 * Transient holder for the current capture(s) so images + CaptureMeta don't have
 * to travel through navigation params. Not persisted — it's per scan-flow.
 */
export const useScanDraft = create<ScanDraftState>((set) => ({
  mode: 'quick',
  captures: [],
  lastMeta: null,
  startScan: (mode) => set({ mode, captures: [] }),
  addCapture: (capture) =>
    set((s) => ({ captures: [...s.captures, capture], lastMeta: capture.meta })),
  clear: () => set({ captures: [] }),
}));
