import type { InstId, PartId, StyleId } from '../types';

export interface FormSection {
  label: string;
  /** Candidate 8-bar (or 12-bar) templates, key-relative degree notation. */
  templates: string[];
}

export interface StyleDef {
  id: StyleId;
  name: string;
  bpm: number;
  bpmRange: [number, number];
  key: number; // default key pitch class
  keys: number[]; // keys to pick from for new songs
  inst: Record<PartId, InstId>;
  /** Tap instrument before / after the piano takes over comping (tap #20). */
  tapInst: [InstId, InstId];
  headPart: PartId;
  soloOrder: { part: PartId; p: number }[];
  /** Forms: list of section-label sequences with their templates. */
  forms: { name: string; order: string[]; sections: Record<string, string[]> }[];
  /** Tag (ending) turnarounds, 2 bars each. */
  tags: string[];
  finalChord: string;
  /** Swing: 'tempo' (8th swing from tempo), 'straight', 'sixteenth' (light 16th swing). */
  swing: 'tempo' | 'straight' | 'sixteenth';
  /** Timing feel per channel, ms (+ = laid back). */
  feel: Partial<Record<PartId | 'solo' | 'tap', number>>;
  pan: Record<PartId | 'tap', number>;
  /** Percussion flavour. */
  perc: 'snap' | 'shaker' | 'clap';
}

/** Swing ratio (long:short) of 8ths as a function of tempo (slow ~3:1, mid 2:1, fast 1.5:1). */
export function swingRatio(bpm: number): number {
  const pts: [number, number][] = [
    [70, 3.0],
    [100, 2.6],
    [132, 2.0],
    [180, 1.7],
    [220, 1.5],
  ];
  if (bpm <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (bpm <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((bpm - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1.5;
}
