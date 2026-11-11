import type { Chord, Quality } from './types';
import type { Rng } from '../util/rng';

export const NOTE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export const pc = (n: number) => ((n % 12) + 12) % 12;

interface QInfo {
  tones: number[]; // chord tones (intervals from root)
  third: number;
  seventh: number;
  tensions: number[];
  scale: number[];
  /** Rootless voicing extras (two notes added to 3rd + 7th). */
  extras: number[][];
  label: string;
}

const ION = [0, 2, 4, 5, 7, 9, 11];
const LYD = [0, 2, 4, 6, 7, 9, 11];
const DOR = [0, 2, 3, 5, 7, 9, 10];
const MEL = [0, 2, 3, 5, 7, 9, 11];
const MIX = [0, 2, 4, 5, 7, 9, 10];
const MIXB9 = [0, 1, 4, 5, 7, 8, 10];
const ALT = [0, 1, 3, 4, 6, 8, 10];
const LYDDOM = [0, 2, 4, 6, 7, 9, 10];
const LOC2 = [0, 2, 3, 5, 6, 8, 10];
const WH = [0, 2, 3, 5, 6, 8, 9, 11];

export const Q: Record<Quality, QInfo> = {
  maj7: { tones: [0, 4, 7, 11], third: 4, seventh: 11, tensions: [2, 9], scale: ION, extras: [[7, 2], [2, 9]], label: 'maj7' },
  maj9: { tones: [0, 4, 7, 11], third: 4, seventh: 11, tensions: [2, 9], scale: ION, extras: [[2, 7], [2, 9]], label: 'maj9' },
  'maj7#11': { tones: [0, 4, 7, 11], third: 4, seventh: 11, tensions: [2, 6, 9], scale: LYD, extras: [[2, 6], [6, 9]], label: 'maj7♯11' },
  '6': { tones: [0, 4, 7, 9], third: 4, seventh: 9, tensions: [2], scale: ION, extras: [[7, 2]], label: '6' },
  '69': { tones: [0, 4, 7, 9], third: 4, seventh: 9, tensions: [2], scale: ION, extras: [[2, 7], [2, 0]], label: '6/9' },
  m7: { tones: [0, 3, 7, 10], third: 3, seventh: 10, tensions: [2, 5], scale: DOR, extras: [[7, 2], [2, 5]], label: 'm7' },
  m9: { tones: [0, 3, 7, 10], third: 3, seventh: 10, tensions: [2, 5], scale: DOR, extras: [[2, 7], [2, 5]], label: 'm9' },
  m11: { tones: [0, 3, 7, 10], third: 3, seventh: 10, tensions: [2, 5], scale: DOR, extras: [[2, 5], [5, 7]], label: 'm11' },
  m6: { tones: [0, 3, 7, 9], third: 3, seventh: 9, tensions: [2, 5], scale: MEL, extras: [[7, 2]], label: 'm6' },
  '7': { tones: [0, 4, 7, 10], third: 4, seventh: 10, tensions: [2, 9], scale: MIX, extras: [[9, 2], [7, 2]], label: '7' },
  '9': { tones: [0, 4, 7, 10], third: 4, seventh: 10, tensions: [2, 9], scale: MIX, extras: [[2, 7], [2, 9]], label: '9' },
  '13': { tones: [0, 4, 7, 10], third: 4, seventh: 10, tensions: [2, 9], scale: MIX, extras: [[9, 2]], label: '13' },
  '7b9': { tones: [0, 4, 7, 10], third: 4, seventh: 10, tensions: [1, 8], scale: MIXB9, extras: [[8, 1], [9, 1]], label: '7♭9' },
  '7alt': { tones: [0, 4, 10], third: 4, seventh: 10, tensions: [1, 3, 8], scale: ALT, extras: [[8, 1], [3, 8]], label: '7alt' },
  '7#11': { tones: [0, 4, 7, 10], third: 4, seventh: 10, tensions: [2, 6, 9], scale: LYDDOM, extras: [[2, 6], [9, 6]], label: '7♯11' },
  '9sus': { tones: [0, 5, 7, 10], third: 5, seventh: 10, tensions: [2, 9], scale: MIX, extras: [[2, 9], [2, 7]], label: '9sus' },
  m7b5: { tones: [0, 3, 6, 10], third: 3, seventh: 10, tensions: [2, 5, 8], scale: LOC2, extras: [[6, 0], [6, 5]], label: 'm7♭5' },
  dim7: { tones: [0, 3, 6, 9], third: 3, seventh: 9, tensions: [2, 5, 8, 11], scale: WH, extras: [[0, 6]], label: '°7' },
};

export const isDominant = (q: Quality) => q === '7' || q === '9' || q === '13' || q === '7b9' || q === '7alt' || q === '7#11' || q === '9sus';
export const isMinor = (q: Quality) => q === 'm7' || q === 'm9' || q === 'm11' || q === 'm6' || q === 'm7b5';

export function chordName(c: Chord): string {
  const s = NOTE_NAMES[c.root] + Q[c.q].label;
  return c.bass !== undefined && c.bass !== c.root ? `${s}/${NOTE_NAMES[c.bass]}` : s;
}

export const chordTonePcs = (c: Chord) => Q[c.q].tones.map((i) => pc(c.root + i));
export const guideTonePcs = (c: Chord) => [pc(c.root + Q[c.q].third), pc(c.root + Q[c.q].seventh)];
export const tensionPcs = (c: Chord) => Q[c.q].tensions.map((i) => pc(c.root + i));
export const scalePcs = (c: Chord) => Q[c.q].scale.map((i) => pc(c.root + i));

/** Bebop scale: adds a chromatic passing tone so chord tones land on beats. */
export function bebopPcs(c: Chord): number[] {
  const s = scalePcs(c);
  const add = isDominant(c.q) ? pc(c.root + 11) : isMinor(c.q) ? pc(c.root + 4) : pc(c.root + 8);
  if (!s.includes(add)) s.push(add);
  return s;
}

/** All midi notes in [lo, hi] whose pitch class is in pcs. */
export function notesIn(pcs: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(pc(m))) out.push(m);
  return out;
}

/** Nearest midi note with pitch class p to `ref`. */
export function nearestPc(p: number, ref: number): number {
  const base = ref - pc(ref) + p;
  const cands = [base - 12, base, base + 12];
  let best = cands[0];
  for (const c of cands) if (Math.abs(c - ref) < Math.abs(best - ref)) best = c;
  return best;
}

export function fold(m: number, lo: number, hi: number): number {
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}

/** Is this pitch an "avoid" note on a strong beat (e.g. 4th over a major 3rd)? */
export function isAvoid(m: number, c: Chord): boolean {
  const i = pc(m - c.root);
  const q = Q[c.q];
  if (q.third === 4 && i === 5) return true;
  if ((c.q === 'maj7' || c.q === 'maj9' || c.q === '6' || c.q === '69') && i === 1) return true;
  if (isMinor(c.q) && c.q !== 'm7b5' && i === 8) return true;
  if (!q.scale.includes(i) && !q.tensions.includes(i)) return true;
  return false;
}

// ---------------------------------------------------------------- voicings

export interface VoicingOpts {
  lo: number;
  hi: number;
  center: number;
  drop2?: boolean;
  voices?: number; // 3 or 4 (or 5 for neo soul)
  withRoot?: boolean;
  rng?: Rng;
}

function voicingPcSets(c: Chord, opts: VoicingOpts): number[][] {
  const q = Q[c.q];
  const t = pc(c.root + q.third);
  const s = pc(c.root + q.seventh);
  const sets: number[][] = [];
  if ((opts.voices ?? 4) === 3) {
    // shells: root + 3 + 7 (guitar), or 3 + 7 + tension
    if (opts.withRoot) sets.push([c.root, t, s]);
    sets.push([t, s, pc(c.root + q.extras[0][0])]);
    if (q.tensions.length) sets.push([t, s, pc(c.root + q.tensions[0])]);
    return sets;
  }
  for (const ex of q.extras) {
    const set = [t, s, ...ex.map((i) => pc(c.root + i))];
    if (opts.voices === 5) {
      const extra = q.tensions.find((i) => !set.includes(pc(c.root + i)));
      if (extra !== undefined) set.push(pc(c.root + extra));
    }
    sets.push([...new Set(set)]);
  }
  if (opts.withRoot) sets.push([c.root, t, s, pc(c.root + q.extras[0][1])]);
  return sets;
}

function closeVoicings(pcs: number[], lo: number, hi: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pcs.length; i++) {
    const order = [...pcs.slice(i), ...pcs.slice(0, i)];
    // sort ascending pitch classes starting from order[0]
    const rel = order.map((p) => pc(p - order[0])).sort((a, b) => a - b);
    for (let base = lo; base <= hi; base++) {
      if (pc(base) !== order[0]) continue;
      const v = rel.map((r) => base + r);
      if (v[v.length - 1] <= hi) out.push(v);
    }
  }
  return out;
}

function drop2(v: number[]): number[] {
  if (v.length < 4) return v;
  const w = v.slice();
  const second = w.splice(w.length - 2, 1)[0] - 12;
  return [second, ...w].sort((a, b) => a - b);
}

function moveCost(a: number[], b: number[]): number {
  if (!a.length) return 0;
  const n = Math.max(a.length, b.length);
  let cost = 0;
  for (let i = 0; i < n; i++) {
    const x = a[Math.min(i, a.length - 1)];
    const y = b[Math.min(i, b.length - 1)];
    cost += Math.abs(x - y);
  }
  return cost;
}

/** Choose a voicing that moves the least from `prev` (voice leading), within range. */
export function voice(c: Chord, prev: number[], opts: VoicingOpts): number[] {
  const sets = voicingPcSets(c, opts);
  let best: number[] = [];
  let bestCost = Infinity;
  for (const set of sets) {
    let cands = closeVoicings(set, opts.lo, opts.hi);
    if (opts.drop2) cands = cands.map(drop2).filter((v) => v[0] >= opts.lo - 5);
    for (const v of cands) {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      let cost = moveCost(prev, v) + Math.abs(mean - opts.center) * 0.6;
      // muddy low intervals
      if (v[0] < 52 && v[1] - v[0] < 5) cost += 8;
      if (opts.rng) cost += opts.rng.next() * 2.5;
      if (cost < bestCost) {
        bestCost = cost;
        best = v;
      }
    }
  }
  return best.length ? best : [nearestPc(c.root, opts.center)];
}

/** Root position for the bass (with slash bass). */
export const bassPc = (c: Chord) => (c.bass !== undefined ? c.bass : c.root);
