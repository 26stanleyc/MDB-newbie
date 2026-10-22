import type { VGrade } from '@/api';

/** Full V-scale used for grade entry (design doc: VB, V0–V17). */
export const V_GRADES: VGrade[] = [
  'VB',
  ...Array.from({ length: 18 }, (_, i) => `V${i}` as VGrade),
];
