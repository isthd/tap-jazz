// Final-stage humanization: swing mapping, per-player timing tendency, directed
// jitter, velocity shaping, note length. Not random noise: each player has a fixed
// "feel" (bass/ride on top, piano and soloist laid back) and jitter is small around it.
import type { BarTiming, ChannelId, Ev, ScheduledNote } from './types';
import { beatTime } from './types';
import type { StyleDef } from './styles/style';
import { swingRatio } from './styles/style';
import type { Rng } from '../util/rng';
import { clamp } from '../util/rng';

export interface HumanizeCtx {
  timing: BarTiming;
  style: StyleDef;
  bpm: number;
  intensity: number;
  ch: ChannelId;
  feelKey: keyof StyleDef['feel'];
  rng: Rng;
  /** 0 = straight, 1 = full style swing. */
  swingAmt?: number;
  jitterMs?: number;
  legato?: number;
  doubleTime?: boolean;
}

function swingMap(f: number, r: number): number {
  const s = r / (1 + r);
  return f < 0.5 ? f * (s / 0.5) : s + (f - 0.5) * ((1 - s) / 0.5);
}

export function swingBeat(beat: number, style: StyleDef, bpm: number, amt: number, doubleTime = false): number {
  if (amt <= 0) return beat;
  if (style.swing === 'tempo') {
    const r = 1 + (swingRatio(doubleTime ? bpm * 2 : bpm) - 1) * amt;
    if (doubleTime) {
      // swing the 16ths (8ths of the double-time feel)
      const h = beat * 2;
      const i = Math.floor(h);
      return (i + swingMap(h - i, r)) / 2;
    }
    const i = Math.floor(beat);
    return i + swingMap(beat - i, r);
  }
  if (style.swing === 'sixteenth') {
    const r = 1 + 0.38 * amt;
    const h = beat * 2;
    const i = Math.floor(h);
    return (i + swingMap(h - i, r)) / 2;
  }
  return beat;
}

export function humanize(evs: Ev[], c: HumanizeCtx): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  const feel = (c.style.feel[c.feelKey] ?? 0) / 1000;
  const sigma = (c.jitterMs ?? 7) / 1000;
  const amt = c.swingAmt ?? 1;
  const legato = c.legato ?? 1;
  const grpJitter = new Map<number, number>();
  for (const e of evs) {
    const b0 = e.trip ? e.beat : swingBeat(e.beat, c.style, c.bpm, amt, c.doubleTime);
    const b1 = e.trip ? e.beat + e.dur : swingBeat(e.beat + e.dur, c.style, c.bpm, amt, c.doubleTime);
    let jitter = clamp(c.rng.gauss() * sigma, -2.2 * sigma, 2.2 * sigma);
    if (e.grp !== undefined) {
      const g = grpJitter.get(e.grp);
      if (g === undefined) grpJitter.set(e.grp, jitter);
      else jitter = g + c.rng.gauss() * 0.0025;
    }
    const strum = (e.strum ?? 0) * 0.011;
    const t = beatTime(c.timing, b0) + feel + (e.offMs ?? 0) / 1000 + jitter + strum;
    const end = beatTime(c.timing, b1);
    const dur = Math.max(0.03, (end - beatTime(c.timing, b0)) * legato - strum * 0.5);
    const vel = clamp(e.vel * (0.8 + 0.3 * c.intensity) + c.rng.gauss() * 0.025, 0.02, 1);
    out.push({
      time: t,
      dur,
      inst: e.inst,
      vel,
      midi: e.midi,
      drum: e.drum,
      slideFrom: e.slideFrom,
      ch: e.ch ?? c.ch,
    });
  }
  return out;
}
