import { create } from 'zustand';

export type ToastState =
  | { kind: 'hidden' }
  | { kind: 'busy'; text: string }
  | { kind: 'done'; text: string };

type ToastStore = {
  state: ToastState;
  /** Show a busy pill (spinner) until `done` or `hide` is called. */
  busy: (text: string) => void;
  /** Show (or widen the busy pill into) a confirmation, then auto-hide. */
  done: (text: string) => void;
  hide: () => void;
};

let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Global island toast, rendered once in the root layout. */
export const useToast = create<ToastStore>((set) => ({
  state: { kind: 'hidden' },
  busy: (text) => {
    clearTimeout(hideTimer);
    set({ state: { kind: 'busy', text } });
  },
  done: (text) => {
    clearTimeout(hideTimer);
    set({ state: { kind: 'done', text } });
    hideTimer = setTimeout(() => set({ state: { kind: 'hidden' } }), 2200);
  },
  hide: () => {
    clearTimeout(hideTimer);
    set({ state: { kind: 'hidden' } });
  },
}));
