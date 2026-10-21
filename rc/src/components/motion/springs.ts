import { FadeInDown } from 'react-native-reanimated';

/**
 * Capitan's motion personality: calm, weighted springs (a climber settling
 * onto a hold), never bouncy. Reanimated honors the system Reduce Motion
 * setting for all of these by default.
 */
export const Springs = {
  /** Default for anything that moves between two states. */
  settle: { damping: 20, stiffness: 200, mass: 1 },
  /** Press-in: quick so the touch feels immediate. */
  pressIn: { damping: 20, stiffness: 520, mass: 0.6 },
  /** Release after a press. */
  release: { damping: 16, stiffness: 260, mass: 0.9 },
} as const;

const STAGGER_MS = 40;

/** Staggered entrance for list items and screen sections. */
export function enter(index = 0) {
  return FadeInDown.delay(index * STAGGER_MS)
    .springify()
    .damping(Springs.settle.damping)
    .stiffness(Springs.settle.stiffness)
    .mass(Springs.settle.mass);
}
