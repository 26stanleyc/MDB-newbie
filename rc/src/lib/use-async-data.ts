import { useEffect, useState } from 'react';

type State<T> = { data?: T; loading: boolean; error: boolean };

/**
 * Loads async data on mount (and when `deps` change) and exposes a `reload`
 * handler. The mount effect never calls setState synchronously, so it satisfies
 * the react-hooks/set-state-in-effect rule.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ loading: true, error: false });

  const reload = () => {
    setState({ loading: true, error: false });
    loader()
      .then((data) => setState({ data, loading: false, error: false }))
      .catch(() => setState({ loading: false, error: true }));
  };

  useEffect(() => {
    let cancelled = false;
    // No synchronous setState here; .then/.catch update after the await.
    loader()
      .then((data) => !cancelled && setState({ data, loading: false, error: false }))
      .catch(() => !cancelled && setState({ loading: false, error: true }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload };
}
