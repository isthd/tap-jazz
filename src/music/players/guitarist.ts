import type { Chord, Ev } from '../types';
import { Q, bassPc, nearestPc, pc, voice } from '../theory';
import { bandTacet, chordOf, kimeRhythm, newGroup, nextChordAfter, type PlayCtx } from './common';
import { pickComp } from './comp';

export class Guitarist {
  prev: number[] = [];
  feelKey = 'guitar' as const;
  jitter = 7;

  reset() {
    this.prev = [];
  }

  private voicing(ctx: PlayCtx, c: Chord, kind: 'drop2' | 'shell' | 'upper'): number[] {
    let v: number[];
    if (kind === 'shell') {
      // root + 3 + 7 (or root + 7 + 3), low register: the 4-to-the-bar sound
      const q = Q[c.q];
      const r = nearestPc(bassPc(c), 45);
      const root = r < 40 ? r + 12 : r > 52 ? r - 12 : r;
      const a = pc(c.root + q.seventh);
      const b = pc(c.root + q.third);
      const s = nearestPc(a, root + 9);
      const t = nearestPc(b, s + 4);
      v = [root, s, t < s ? t + 12 : t];
    } else if (kind === 'upper') {
      v = voice(c, this.prev, { lo: 57, hi: 76, center: 66, voices: 3, rng: ctx.rng });
    } else {
      v = voice(c, this.prev, { lo: 47, hi: 69, center: 58, drop2: true, rng: ctx.rng });
    }
    this.prev = v;
    return v;
  }

  private strum(ctx: PlayCtx, notes: number[], beat: number, dur: number, vel: number, up = false, trip = false): Ev[] {
    const inst = ctx.style.inst.guitar;
    const g = newGroup();
    const ordered = up ? notes.slice().reverse() : notes;
    return ordered.map((m, i) => ({ beat, dur, inst, midi: m, vel: vel * (1 - i * 0.04), strum: i, grp: g, trip }));
  }

  bar(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const f = info.flags;
    if (!ctx.active) {
      if (f.joinNext === 'guitar') return this.strum(ctx, this.voicing(ctx, ctx.next.chords[0].chord, 'drop2'), 3.5, 1, 0.45);
      return [];
    }
    if (bandTacet(info) || ctx.lead === 'guitar') return [];
    if (info.seg === 'fermata') {
      const c = chordOf(info, 0);
      return this.strum(ctx, this.voicing(ctx, c, 'drop2'), 0, 3.45, 0.55).map((e, i) => ({ ...e, strum: i * 2.5 }));
    }
    if (f.breakBand) return ctx.prev?.flags.breakBand ? [] : this.strum(ctx, this.voicing(ctx, chordOf(info, 0), 'drop2'), 0, 0.5, 0.65);
    if (f.stopTime) return this.strum(ctx, this.voicing(ctx, chordOf(info, 0), 'drop2'), 0, 0.4, 0.6);
    if (f.kime) {
      return kimeRhythm(info).flatMap((b) => {
        const c = b >= 3.5 ? nextChordAfter(ctx, b) : chordOf(info, b);
        return this.strum(ctx, this.voicing(ctx, c, 'drop2'), b, 0.35, 0.7);
      });
    }
    if (f.dropdown) return [];

    if (ctx.style.id === 'bossa') return this.bossa(ctx);
    if (ctx.style.id === 'neosoul') return this.neosoul(ctx);

    const role = !ctx.activeParts.piano || ctx.lead === 'piano' || info.compLead === 'guitar' ? 'lead' : 'second';
    if (role === 'second' || (info.seg === 'head' && rng.chance(0.5)) || (ctx.intensity > 0.55 && ctx.intensity < 0.8 && rng.chance(0.2))) {
      // four to the bar, short, 2 and 4 a touch stronger
      if (role === 'second' && ctx.lead !== 'piano' && rng.chance(0.3)) return [];
      const evs: Ev[] = [];
      for (let k = 0; k < 4; k++) {
        const c = chordOf(info, k);
        const v = this.voicing(ctx, c, 'shell');
        evs.push(...this.strum(ctx, v, k, 0.42, (k % 2 ? 0.44 : 0.36) * (role === 'second' ? 0.85 : 1)));
      }
      return evs;
    }
    const hits = pickComp(ctx, role);
    const evs: Ev[] = [];
    for (const h of hits) {
      const c = h.ant ? nextChordAfter(ctx, h.beat) : chordOf(info, h.beat);
      evs.push(...this.strum(ctx, this.voicing(ctx, c, 'drop2'), h.beat, h.dur * 0.8, 0.5 + (h.acc ?? 0) + rng.range(-0.05, 0.05), false, h.trip));
    }
    return evs;
  }

  private bossa(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const inst = ctx.style.inst.guitar;
    const soft = ctx.lead === 'piano' || info.compLead === 'piano' ? 0.82 : 1;
    // thumb
    for (const b of [0, 2]) {
      const c = chordOf(info, b);
      const r = nearestPc(b === 0 ? bassPc(c) : pc(c.root + 7), 45);
      evs.push({ beat: b, dur: 0.9, inst, midi: r < 40 ? r + 12 : r, vel: 0.42 * soft });
    }
    // fingers: 2-bar batida
    const pat = info.abs % 2 === 0 ? [0, 1, 1.5, 2.5, 3] : [0.5, 1, 2, 2.5, 3.5];
    for (const b of pat) {
      const ant = b === 3.5;
      const c = ant ? nextChordAfter(ctx, b) : chordOf(info, b);
      const v = voice(c, this.prev, { lo: 52, hi: 69, center: 60, voices: 3, rng });
      this.prev = v;
      const g = newGroup();
      v.forEach((m, i) => evs.push({ beat: b, dur: 0.42, inst, midi: m, vel: (0.4 + (b % 1 ? 0.05 : 0)) * soft, strum: i * 0.4, grp: g }));
    }
    return evs;
  }

  private neosoul(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const inst = ctx.style.inst.guitar;
    const role = info.compLead === 'guitar' || ctx.lead === 'piano' ? 'lead' : 'second';
    if (role === 'second' && rng.chance(0.4)) return [];
    const hits = pickComp(ctx, role);
    for (const h of hits) {
      const c = h.ant ? nextChordAfter(ctx, h.beat) : chordOf(info, h.beat);
      const v = this.voicing(ctx, c, 'upper');
      const two = rng.chance(0.5) ? v.slice(-2) : v;
      const e = this.strum(ctx, two, h.beat, Math.min(h.dur, 1.2), 0.46 + rng.range(-0.04, 0.06), rng.chance(0.3));
      if (rng.chance(0.2)) e.forEach((x) => (x.slideFrom = x.midi! - 1));
      evs.push(...e);
    }
    // muted "chk" ghosts and a tiny hammer-on fill
    if (rng.chance(0.4)) {
      const b = rng.pick([1.25, 2.25, 3.25]);
      const v = this.prev.slice(-2);
      v.forEach((m, i) => evs.push({ beat: b, dur: 0.08, inst, midi: m, vel: 0.18, strum: i, ghost: true }));
    }
    if (ctx.leadEvs.length === 0 && rng.chance(0.25)) {
      const c = chordOf(info, 3);
      const top = nearestPc(pc(c.root + Q[c.q].tensions[0]), 70);
      evs.push(
        { beat: 3, dur: 0.25, inst, midi: top - 2, vel: 0.4 },
        { beat: 3.25, dur: 0.6, inst, midi: top, vel: 0.45, slideFrom: top - 2 },
      );
    }
    return evs;
  }
}
