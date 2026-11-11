import type { BarInfo, Chord, Ev, PartId } from '../types';
import type { StyleDef } from '../styles/style';
import type { Rng } from '../../util/rng';
import { chordAt } from '../form';

export interface PlayCtx {
  info: BarInfo;
  next: BarInfo;
  prev: BarInfo | null;
  style: StyleDef;
  intensity: number;
  rng: Rng;
  active: boolean;
  /** Who carries the melody this bar (soloist / head part), if anyone. */
  lead: PartId | null;
  /** Soloist / head events for this bar (compers respond to the gaps). */
  leadEvs: Ev[];
  activeParts: Record<PartId, boolean>;
}

export const chordOf = (info: BarInfo, beat: number): Chord => chordAt(info.chords, beat);

/** Chord sounding right after `beat` (next change in this bar, else next bar's first chord). */
export function nextChordAfter(ctx: PlayCtx, beat: number): Chord {
  for (const bc of ctx.info.chords) if (bc.beat > beat + 1e-6) return bc.chord;
  return ctx.next.chords[0].chord;
}

export const changeBeats = (info: BarInfo) => info.chords.map((c) => c.beat);

/** Shared kime (band hits) rhythm, deterministic per bar so everyone agrees. */
export function kimeRhythm(info: BarInfo): number[] {
  const pats = info.style === 'neosoul' ? [[0, 0.75, 1.5], [0, 1.5, 2.75], [0, 0.75, 2.5]] : [[0, 1.5, 3], [0, 1, 2.5], [0, 2.5, 3.5]];
  return pats[info.abs % pats.length];
}

/** Is there a lead-note onset near this beat? */
export function leadBusy(leadEvs: Ev[], beat: number, win = 0.35): boolean {
  for (const e of leadEvs) if (Math.abs(e.beat - beat) < win) return true;
  return false;
}

/** True when the band (except soloist) should lay out in this bar. */
export function bandTacet(info: BarInfo): boolean {
  return info.seg === 'silence' || info.seg === 'countin' || (info.seg === 'trade' && info.soloist === 'drums');
}

let grpCounter = 1;
export const newGroup = () => grpCounter++;
