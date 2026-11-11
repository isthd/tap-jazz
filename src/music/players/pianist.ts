import type { Chord, Ev } from '../types';
import { bassPc, guideTonePcs, nearestPc, voice } from '../theory';
import { bandTacet, chordOf, kimeRhythm, newGroup, nextChordAfter, type PlayCtx } from './common';
import { pickComp } from './comp';
import type { StyleDef } from '../styles/style';
import type { Rng } from '../../util/rng';

export class Pianist {
  prev: number[] = [];
  prevLH: number[] = [];
  feelKey = 'piano' as const;
  jitter = 9;

  reset() {
    this.prev = [];
    this.prevLH = [];
  }

  private voicing(ctx: PlayCtx, c: Chord): number[] {
    const neo = ctx.style.id === 'neosoul';
    const v = voice(c, this.prev, {
      lo: neo ? 51 : 50,
      hi: neo ? 79 : 76,
      center: neo ? 64 : 62,
      voices: neo ? 5 : 4,
      rng: ctx.rng,
    });
    this.prev = v;
    return v;
  }

  private chordEvs(ctx: PlayCtx, notes: number[], beat: number, dur: number, vel: number, trip = false): Ev[] {
    const inst = ctx.style.inst.piano;
    const g = newGroup();
    const roll = ctx.style.id === 'neosoul' && ctx.rng.chance(0.3);
    return notes.map((m, i) => ({
      beat,
      dur,
      inst,
      midi: m,
      vel: vel * (i === notes.length - 1 ? 1.05 : 0.92),
      grp: g,
      trip,
      strum: roll ? i * 0.6 : undefined,
    }));
  }

  bar(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const f = info.flags;
    if (!ctx.active) {
      if (f.joinNext === 'piano') {
        const nc = ctx.next.chords[0].chord;
        return this.chordEvs(ctx, this.voicing(ctx, nc), 3.5, 1.2, 0.5);
      }
      return [];
    }
    if (bandTacet(info)) return [];
    if (info.seg === 'fermata') {
      const c = chordOf(info, 0);
      const v = this.voicing(ctx, c);
      const low = nearestPc(bassPc(c), 40);
      const notes = [low, low + 7 <= 52 ? low + 7 : low + 12, ...v];
      return notes.map((m, i) => ({ beat: 0, dur: 3.45, inst: ctx.style.inst.piano, midi: m, vel: 0.62, strum: i * 1.4, grp: undefined }));
    }
    const leading = ctx.lead === 'piano';
    if (f.breakBand && !leading) return ctx.prev?.flags.breakBand ? [] : this.chordEvs(ctx, this.voicing(ctx, chordOf(info, 0)), 0, 0.6, 0.7);
    if (f.stopTime && !leading) return this.chordEvs(ctx, this.voicing(ctx, chordOf(info, 0)), 0, 0.5, 0.65);
    if (f.kime) {
      return kimeRhythm(info).flatMap((b) => {
        const c = b >= 3.5 ? nextChordAfter(ctx, b) : chordOf(info, b);
        return this.chordEvs(ctx, this.voicing(ctx, c), b, 0.4, 0.75);
      });
    }
    if (f.dropdown && !leading) return [];
    if (leading) return this.leftHand(ctx);

    const role = !ctx.activeParts.guitar || ctx.lead === 'guitar' || info.compLead === 'piano' ? 'lead' : 'second';
    if (role === 'second' && ctx.style.id !== 'neosoul' && rng.chance(0.45)) {
      // the other comper has the ball: just a soft held colour now and then
      if (rng.chance(0.5)) return [];
      const c = chordOf(info, 0);
      return this.chordEvs(ctx, this.voicing(ctx, c), 0, 2.5, 0.38);
    }
    const hits = pickComp(ctx, role);
    const evs: Ev[] = [];
    const pedal = ctx.intensity < 0.35 ? 1.5 : 1;
    for (const h of hits) {
      const c = h.ant ? nextChordAfter(ctx, h.beat) : chordOf(info, h.beat);
      const v = this.voicing(ctx, c);
      const vel = 0.5 + (h.acc ?? 0) + rng.range(-0.05, 0.08) + (role === 'second' ? -0.1 : 0);
      evs.push(...this.chordEvs(ctx, v, h.beat, h.dur * pedal, vel, h.trip));
    }
    return evs;
  }

  private lastReact = -99;

  /**
   * Answer a user tap right away with a chord stab on the tap.
   * Slow taps get a fuller, longer chord; fast runs are left alone.
   */
  react(o: { time: number; ioi: number; vel: number; chord: Chord; style: StyleDef; rng: Rng }): { midi: number; vel: number; dur: number; delay: number }[] {
    const { ioi, rng } = o;
    if (ioi < 0.33 || o.time - this.lastReact < 0.3) return [];
    const slow = ioi > 0.9;
    if (!slow && !rng.chance(0.7)) return [];
    const neo = o.style.id === 'neosoul';
    const v = voice(o.chord, this.prev, { lo: neo ? 51 : 50, hi: neo ? 79 : 76, center: neo ? 64 : 62, voices: slow ? (neo ? 5 : 4) : 3, rng });
    this.prev = v;
    this.lastReact = o.time;
    const vel = Math.min(0.8, (slow ? 0.5 : 0.42) * (0.8 + 0.4 * o.vel));
    const dur = slow ? 0.9 : 0.22;
    const roll = neo || (slow && rng.chance(0.4));
    return v.map((m, i) => ({ midi: m, vel: vel * (i === v.length - 1 ? 1.05 : 0.92), dur, delay: roll ? i * 0.018 : 0 }));
  }

  /** While the right hand plays melody/solo: sparse left-hand shells below it. */
  private leftHand(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const inst = ctx.style.inst.piano;
    for (const bc of info.chords) {
      if (rng.chance(0.15)) continue;
      const c = bc.chord;
      const g = guideTonePcs(c);
      const ref = this.prevLH.length ? this.prevLH[0] : 52;
      let a = nearestPc(g[0], ref);
      let b = nearestPc(g[1], a + 4);
      if (b < a) b += 12;
      if (a < 47) {
        a += 12;
        b += 12;
      }
      if (b > 64) {
        a -= 12;
        b -= 12;
      }
      this.prevLH = [a, b];
      const beat = bc.beat === 0 && rng.chance(0.3) ? 0.5 : bc.beat === 2 && rng.chance(0.3) ? 1.5 : bc.beat;
      const grp = newGroup();
      const dur = info.chords.length > 1 ? 1.3 : rng.chance(0.5) ? 2.5 : 1;
      evs.push({ beat, dur, inst, midi: a, vel: 0.4, grp }, { beat, dur, inst, midi: b, vel: 0.4, grp });
    }
    return evs;
  }
}
