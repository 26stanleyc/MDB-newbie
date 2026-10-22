import { useEffect } from 'react';

import { api } from '@/api';
import { useScans } from '@/store/use-scans';

/**
 * Walls saved before scans carried a photo fingerprint have none, so the same photo
 * saved twice can't be matched. Fetch the missing fingerprints once from the server
 * and collapse duplicates (keeping the newest). Offline: nothing changes.
 */
export function usePhotoHashBackfill() {
  const setPhotoHashes = useScans((s) => s.setPhotoHashes);
  useEffect(() => {
    const missing = useScans.getState().scans.filter((s) => !s.photoHash);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((s) =>
        api
          .getScan(s.scanId)
          .then((scan) => [s.scanId, scan.photoHash] as const)
          .catch(() => [s.scanId, undefined] as const),
      ),
    ).then((pairs) => {
      const hashes: Record<string, string> = {};
      for (const [id, h] of pairs) if (h) hashes[id] = h;
      if (Object.keys(hashes).length) setPhotoHashes(hashes);
    });
  }, [setPhotoHashes]);
}
