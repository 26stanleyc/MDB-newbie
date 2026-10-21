import { Platform } from 'react-native';

import { APP_NAME } from '@/config/app';

/**
 * Design-lab variants. Every variant runs the same prototype flow and the same
 * motion choreography (borrowed from the Phantom reference video); they differ
 * in palette, type, shape and spring personality so they can be compared
 * side by side. None of this touches the real app theme in `@/theme`.
 */

export type LabSpring = { damping: number; stiffness: number; mass: number };

export type LabTheme = {
  id: string;
  name: string;
  blurb: string;
  dark: boolean;
  /** Draw the wall photo full-bleed behind the whole app. */
  wallBackdrop: boolean;
  /** Draw faint topo contour lines behind home. */
  contours: boolean;
  c: {
    bg: string;
    surface: string;
    surfaceHi: string;
    text: string;
    dim: string;
    line: string;
    primary: string;
    onPrimary: string;
    chip: string;
    scrim: string;
  };
  font: {
    display: string;
    body: string;
    number: string;
    numberWeight: '500' | '600' | '700' | '800';
  };
  radius: { card: number; button: number; fab: number };
  spring: LabSpring;
  /** ms between staggered items entering. */
  stagger: number;
};

const ios = <T,>(v: T, fallback: T) => (Platform.OS === 'web' || Platform.OS === 'ios' ? v : fallback);

export const VARIANTS: LabTheme[] = [
  {
    id: 'refined',
    name: `${APP_NAME}, refined`,
    blurb: 'The current chalk, moss and serif look, with the reference motion added.',
    dark: false,
    wallBackdrop: false,
    contours: true,
    c: {
      bg: '#F5F1E8',
      surface: '#EAE3D5',
      surfaceHi: '#DED5C4',
      text: '#2A2723',
      dim: '#5A544A',
      line: '#D8CFBE',
      primary: '#55694A',
      onPrimary: '#F5F1E8',
      chip: '#E2DACA',
      scrim: 'rgba(245,241,232,0.55)',
    },
    font: {
      display: ios('Iowan Old Style', 'serif'),
      body: ios('system-ui', 'normal'),
      number: ios('Iowan Old Style', 'serif'),
      numberWeight: '600',
    },
    radius: { card: 14, button: 999, fab: 999 },
    spring: { damping: 18, stiffness: 180, mass: 1 },
    stagger: 40,
  },
  {
    id: 'night',
    name: 'Night session',
    blurb: 'Closest to the reference: dark, dense, with a chalk-white pill as the only bright thing.',
    dark: true,
    wallBackdrop: false,
    contours: false,
    c: {
      bg: '#121110',
      surface: '#1F1D1A',
      surfaceHi: '#2A2723',
      text: '#F2EEE6',
      dim: '#9C958A',
      line: '#2E2B27',
      primary: '#ECE6D8',
      onPrimary: '#16140F',
      chip: '#26231F',
      scrim: 'rgba(10,9,8,0.45)',
    },
    font: {
      display: ios('Avenir Next', 'sans-serif'),
      body: ios('Avenir Next', 'sans-serif'),
      number: ios('Avenir Next', 'sans-serif'),
      numberWeight: '700',
    },
    radius: { card: 18, button: 999, fab: 999 },
    spring: { damping: 22, stiffness: 260, mass: 0.9 },
    stagger: 28,
  },
  {
    id: 'guidebook',
    name: 'Guidebook',
    blurb: 'A printed topo guide: limestone grey, ink, condensed numerals, square corners.',
    dark: false,
    wallBackdrop: false,
    contours: false,
    c: {
      bg: '#E3E3DE',
      surface: '#D6D6D0',
      surfaceHi: '#C9C9C2',
      text: '#1D2124',
      dim: '#4E5458',
      line: '#B9BAB3',
      primary: '#1D2124',
      onPrimary: '#E3E3DE',
      chip: '#D0D0CA',
      scrim: 'rgba(227,227,222,0.6)',
    },
    font: {
      display: ios('Avenir Next Condensed', 'sans-serif-condensed'),
      body: ios('Avenir Next', 'sans-serif'),
      number: ios('Avenir Next Condensed', 'sans-serif-condensed'),
      numberWeight: '700',
    },
    radius: { card: 4, button: 6, fab: 6 },
    spring: { damping: 30, stiffness: 420, mass: 0.8 },
    stagger: 22,
  },
  {
    id: 'wall',
    name: 'On the wall',
    blurb: 'Your last scanned wall sits blurred behind everything; panels are frosted glass.',
    dark: true,
    wallBackdrop: true,
    contours: false,
    c: {
      bg: '#0E0F10',
      surface: 'rgba(255,255,255,0.10)',
      surfaceHi: 'rgba(255,255,255,0.18)',
      text: '#FFFFFF',
      dim: 'rgba(255,255,255,0.68)',
      line: 'rgba(255,255,255,0.14)',
      primary: '#FFFFFF',
      onPrimary: '#111214',
      chip: 'rgba(255,255,255,0.12)',
      scrim: 'rgba(0,0,0,0.25)',
    },
    font: {
      display: ios('Futura', 'sans-serif'),
      body: ios('system-ui', 'normal'),
      number: ios('Futura', 'sans-serif'),
      numberWeight: '600',
    },
    radius: { card: 22, button: 999, fab: 999 },
    spring: { damping: 14, stiffness: 160, mass: 1 },
    stagger: 45,
  },
];

export function variantById(id: string | undefined): LabTheme {
  return VARIANTS.find((v) => v.id === id) ?? VARIANTS[0];
}
