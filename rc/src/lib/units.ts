/**
 * Height / wingspan unit helpers. Measurements are ALWAYS stored in cm
 * (design doc M1) and converted only for display/entry.
 */
export type UnitSystem = 'imperial' | 'metric';

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export function ftInToCm(feet: number, inches: number): number {
  return Math.round((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH);
}

/** Human-readable height, e.g. "5' 10"" or "178 cm". */
export function formatHeight(cm: number, unit: UnitSystem): string {
  if (unit === 'metric') return `${Math.round(cm)} cm`;
  const { feet, inches } = cmToFtIn(cm);
  return `${feet}' ${inches}"`;
}

/** Human-readable wingspan, e.g. "180 cm" or "71 in". */
export function formatSpan(cm: number, unit: UnitSystem): string {
  if (unit === 'metric') return `${Math.round(cm)} cm`;
  return `${Math.round(cm / CM_PER_INCH)} in`;
}
