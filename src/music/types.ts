export type StyleId = 'swing' | 'bossa' | 'neosoul';
export type PartId = 'bass' | 'drums' | 'guitar' | 'perc' | 'piano';
export type ChannelId = PartId | 'tap';

export type InstId =
  | 'piano'
  | 'upright'
  | 'ebass'
  | 'archtop'
  | 'nylon'
  | 'eguitar'
  | 'rhodes'
  | 'vibes'
  | 'flute'
  | 'kit';

export type DrumId =
  | 'ride'
  | 'rideBell'
  | 'crash'
  | 'hhClosed'
  | 'hhPedal'
  | 'hhOpen'
  | 'snare'
  | 'rim'
  | 'brushTap'
  | 'brushSweep'
  | 'kick'
  | 'tomHi'
  | 'tomMid'
  | 'tomLo'
  | 'shaker'
  | 'snap'
  | 'clap'
  | 'stick';

export type Quality =
  | 'maj7'
  | 'maj9'
  | 'maj7#11'
  | '6'
  | '69'
  | 'm7'
  | 'm9'
  | 'm11'
  | 'm6'
  | '7'
  | '9'
  | '13'
  | '7b9'
  | '7alt'
  | '7#11'
  | '9sus'
  | 'm7b5'
  | 'dim7';

export interface Chord {
  root: number; // pitch class 0-11
  q: Quality;
  bass?: number; // slash bass pitch class
}

export interface BarChord {
  beat: number; // start beat inside the bar
  chord: Chord;
}

/** A musical event inside one bar, in beats (0..4). Converted to seconds by the Humanizer. */
export interface Ev {
  beat: number;
  dur: number; // beats
  inst: InstId;
  vel: number; // 0..1
  midi?: number;
  drum?: DrumId;
  /** Triplet / explicit position: do not apply swing mapping. */
  trip?: boolean;
  /** Strum index for chord notes (adds a few ms per string). */
  strum?: number;
  slideFrom?: number;
  ghost?: boolean;
  /** Extra timing offset in ms (e.g. laid-back snare). */
  offMs?: number;
  /** Channel override (solo/head notes go to the soloist's channel). */
  ch?: ChannelId;
  /** Notes of one chord share the same timing jitter. */
  grp?: number;
}

export interface ScheduledNote {
  time: number; // AudioContext seconds
  dur: number; // seconds
  inst: InstId;
  vel: number;
  midi?: number;
  drum?: DrumId;
  slideFrom?: number;
  ch: ChannelId;
}

export type Segment = 'buildup' | 'countin' | 'head' | 'solo' | 'trade' | 'headOut' | 'tag' | 'fermata' | 'silence' | 'switch';

export interface BarFlags {
  fill?: number; // 0..1 fill strength at end of this bar
  crash?: boolean; // crash on beat 0
  breakBand?: boolean; // band stops, soloist alone
  stopTime?: boolean; // band hits beat 0 only
  kime?: boolean; // whole band hits the same rhythm
  dropdown?: boolean; // only bass + brushes
  pedal?: number; // bass pedal pitch class
  doubleTime?: boolean;
  rit?: number; // tempo factor at end of bar (1 = none, 0.8 = slower)
  joinNext?: PartId; // this part enters on the next bar (pickup)
  modulate?: boolean; // dominant into a new key
}

export interface BarInfo {
  abs: number;
  chords: BarChord[];
  formBar: number;
  formLen: number;
  section: string; // 'A', 'B', 'C', 'T' (tag)
  seg: Segment;
  segBar: number; // bar index inside segment
  segLen: number;
  chorus: number;
  soloist?: PartId; // who solos (or drums in trades)
  soloProgress: number; // 0..1 inside a solo
  compLead: 'piano' | 'guitar';
  flags: BarFlags;
  key: number;
  style: StyleId;
  bpm: number;
}

export interface BarTiming {
  start: number;
  d0: number; // beat duration at start
  d1: number; // beat duration at end
  end: number;
}

export function beatTime(t: BarTiming, b: number): number {
  // Linear tempo ramp inside the bar: integral of beat duration.
  const k = (t.d1 - t.d0) / 4;
  return t.start + t.d0 * b + (k * b * b) / 2;
}

export function makeTiming(start: number, bpm0: number, bpm1: number): BarTiming {
  const d0 = 60 / bpm0;
  const d1 = 60 / bpm1;
  const t: BarTiming = { start, d0, d1, end: 0 };
  t.end = beatTime(t, 4);
  return t;
}

/** Inverse of beatTime (numeric). */
export function timeToBeat(t: BarTiming, time: number): number {
  let lo = 0,
    hi = 4;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (beatTime(t, m) < time) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export const PARTS: PartId[] = ['bass', 'drums', 'guitar', 'perc', 'piano'];
