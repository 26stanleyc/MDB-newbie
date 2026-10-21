import { useState } from 'react';

import { api, type Hold, type Route } from '@/api';

/**
 * Pick a route by its start hold: the backend suggests the rest (same color,
 * within reach, above the start), then taps add or remove holds. Removing the
 * start makes the lowest remaining selected hold the new start.
 */
export function useRoutePicker(scanId: string, holds: Hold[]) {
  const [startId, setStartId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStartId(null);
    setSelected(new Set());
    setError(null);
  };

  const tap = async (holdId: string) => {
    if (busy) return;
    setError(null);
    if (!startId) {
      setBusy(true);
      try {
        const ids = await api.suggestRoute(scanId, holdId);
        setStartId(holdId);
        setSelected(new Set([holdId, ...ids]));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Couldn’t suggest a route from that hold.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (holdId === startId) {
      const rest = [...selected].filter((id) => id !== holdId);
      if (rest.length === 0) {
        reset();
        return;
      }
      // Lowest in the photo = largest y.
      const lowY = (id: string) =>
        Math.max(...(holds.find((h) => h.id === id)?.polygon.map((p) => p.y) ?? [0]));
      setStartId(rest.reduce((a, b) => (lowY(b) > lowY(a) ? b : a)));
      setSelected(new Set(rest));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(holdId)) next.delete(holdId);
      else next.add(holdId);
      return next;
    });
  };

  /** Saves the picked route on the server; null (with `error` set) on failure. */
  const save = async (): Promise<Route | null> => {
    if (!startId) return null;
    setBusy(true);
    try {
      const ordered = [startId, ...[...selected].filter((id) => id !== startId)];
      return await api.createRoute(scanId, ordered, startId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the route.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { startId, selected, busy, error, tap, reset, save };
}
