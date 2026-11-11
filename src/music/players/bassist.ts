import type { Chord, Ev, InstId } from '../types';
import { Q, bassPc, nearestPc, pc, scalePcs, chordTonePcs } from '../theory';
import { bandTacet, chordOf, kimeRhythm, nextChordAfter, type PlayCtx } from './common';

export class Bassist {
  last = 36;
  dir = 1;
  feelKey = 'bass' as const;
  jitter = 6;

  reset() {
    this.last = 36;
  }

  private range(ctx: PlayCtx): [number, number] {
    const hi = 50 + Math.round(ctx.intensity * 6);
    return [28, hi];
  }

  private place(p: number, ctx: PlayCtx, prefer = this.last): number {
    const [lo, hi] = this.range(ctx);
    let m = nearestPc(p, prefer);
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  }

  bar(ctx: PlayCtx): Ev[] {
    const { info } = ctx;
    const inst = ctx.style.inst.bass;
    if (!ctx.active) {
      if (info.flags.joinNext === 'bass') return this.pickup(ctx, inst);
      return [];
    }
    if (bandTacet(info) || ctx.lead === 'bass') return [];
    const f = info.flags;
    if (info.seg === 'fermata') {
      const c = chordOf(info, 0);
      const m = this.place(bassPc(c), ctx, 31);
      return [{ beat: 0, dur: 3.9, inst, midi: m, vel: 0.85 }];
    }
    if (f.breakBand) {
      const prevBreak = ctx.prev?.flags.breakBand;
      if (prevBreak) return [];
      const c = chordOf(info, 0);
      return [{ beat: 0, dur: 0.6, inst, midi: this.place(bassPc(c), ctx), vel: 0.8 }];
    }
    if (f.stopTime) {
      const c = chordOf(info, 0);
      return [{ beat: 0, dur: 0.7, inst, midi: this.place(bassPc(c), ctx), vel: 0.78 }];
    }
    if (f.kime) {
      return kimeRhythm(info).map((b) => {
        const c = b >= 3.5 ? nextChordAfter(ctx, b) : chordOf(info, b);
        return { beat: b, dur: 0.45, inst, midi: this.place(bassPc(c), ctx), vel: 0.82 };
      });
    }
    if (f.pedal !== undefined) return this.pedal(ctx, inst, f.pedal);

    const style = ctx.style.id;
    if (style === 'bossa') return this.bossa(ctx, inst);
    if (style === 'neosoul') return this.neosoul(ctx, inst);
    const walk =
      !f.dropdown &&
      (info.seg === 'solo' || info.seg === 'trade' || info.seg === 'tag' ||
        ((info.seg === 'head' || info.seg === 'headOut') && info.section === 'B') ||
        (info.seg === 'headOut' && ctx.intensity > 0.6) ||
        (info.seg === 'buildup' && ctx.activeParts.perc && ctx.intensity > 0.45));
    return walk ? this.walk(ctx, inst) : this.twoFeel(ctx, inst);
  }

  /** Approach note into target pitch class from current note. */
  private approach(ctx: PlayCtx, target: number, cur: Chord): number {
    const T = this.place(target, ctx);
    const r = ctx.rng;
    const opts = [T - 1, T + 1, T + 7 > this.range(ctx)[1] ? T - 5 : T + 7, scaleNeighbor(T, cur, r.chance(0.5) ? 1 : -1)];
    let m = r.weighted(opts, [0.36, 0.3, 0.12, 0.22]);
    if (m === this.last) m = opts[0];
    return m;
  }

  private walk(ctx: PlayCtx, inst: InstId): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const [lo, hi] = this.range(ctx);
    const changes = info.chords.map((c) => c.beat);
    for (let k = 0; k < 4; k++) {
      const c = chordOf(info, k);
      const isChange = changes.includes(k);
      const nextIsChange = k === 3 || changes.includes(k + 1);
      let m: number;
      if (isChange) {
        const root = bassPc(c);
        const alt = rng.chance(k === 0 && info.formBar % 8 === 0 ? 0.03 : 0.13);
        const p = alt ? pc(c.root + rng.pick([Q[c.q].third, 7])) : root;
        m = this.place(p, ctx);
        // big leap? prefer the octave that keeps direction
        if (Math.abs(m - this.last) > 7) {
          const alt2 = m + (m < this.last ? 12 : -12);
          if (alt2 >= lo && alt2 <= hi && Math.abs(alt2 - this.last) < Math.abs(m - this.last)) m = alt2;
        }
      } else if (nextIsChange) {
        const nc = k === 3 ? ctx.next.chords[0].chord : nextChordAfter(ctx, k);
        m = this.approach(ctx, bassPc(nc), c);
      } else {
        // chord or scale tone moving in the current direction
        const nc = nextChordAfter(ctx, k);
        const target = this.place(bassPc(nc), ctx);
        const pool = rng.chance(0.6) ? chordTonePcs(c) : scalePcs(c);
        const cands: number[] = [];
        for (let x = this.last - 7; x <= this.last + 7; x++) if (x !== this.last && x >= lo && x <= hi && pool.includes(pc(x))) cands.push(x);
        if (this.last >= hi - 2) this.dir = -1;
        if (this.last <= lo + 2) this.dir = 1;
        if (rng.chance(0.25)) this.dir = target > this.last ? 1 : -1;
        const w = cands.map((x) => {
          const d = x - this.last;
          const inDir = Math.sign(d) === this.dir ? 1 : 0.25;
          return inDir / (1 + Math.abs(Math.abs(d) - 2.5)) / (1 + Math.abs(x - target) * 0.05);
        });
        m = cands.length ? rng.weighted(cands, w) : this.last + this.dir * 2;
        // occasional octave leap
        if (rng.chance(0.05 + 0.04 * ctx.intensity)) {
          const o = m + (m < 40 ? 12 : -12);
          if (o >= lo && o <= hi) m = o;
        }
      }
      const vel = 0.7 + (k % 2 === 1 ? 0.06 : 0) + rng.range(-0.04, 0.05);
      evs.push({ beat: k, dur: 0.88, inst, midi: m, vel });
      this.last = m;
    }
    // embellishments: triplet rake / skip notes / dead notes
    const extra: Ev[] = [];
    for (let k = 1; k < 4; k++) {
      if (rng.chance(0.04 + 0.08 * ctx.intensity)) {
        // triplet rake into beat k
        const tgt = evs[k].midi!;
        evs[k - 1].dur = 0.5;
        extra.push({ beat: k - 1 / 3, dur: 0.3, inst, midi: tgt + (rng.chance(0.5) ? 1 : -1), vel: 0.42, trip: true, ghost: true });
      } else if (rng.chance(0.05 + 0.06 * ctx.intensity)) {
        // skip note on the swung "and"
        evs[k - 1].dur = 0.45;
        extra.push({ beat: k - 0.5, dur: 0.4, inst, midi: evs[k - 1].midi!, vel: 0.35, ghost: true });
      } else if (rng.chance(0.04)) {
        evs[k - 1].dur = 0.45;
        extra.push({ beat: k - 0.5, dur: 0.12, inst, midi: evs[k - 1].midi! , vel: 0.22, ghost: true });
      }
    }
    return evs.concat(extra);
  }

  private twoFeel(ctx: PlayCtx, inst: InstId): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const quiet = info.flags.dropdown ? 0.75 : 1;
    const c0 = chordOf(info, 0);
    const m0 = this.place(bassPc(c0), ctx);
    evs.push({ beat: 0, dur: 1.85, inst, midi: m0, vel: 0.74 * quiet });
    this.last = m0;
    const c2 = chordOf(info, 2);
    let m2: number;
    if (c2 !== c0) m2 = this.place(bassPc(c2), ctx);
    else if (rng.chance(0.55)) m2 = this.approach(ctx, bassPc(ctx.next.chords[0].chord), c0);
    else m2 = this.place(pc(c0.root + 7), ctx);
    if (rng.chance(0.22)) {
      // pickup into beat 3
      evs[0].dur = 1.4;
      evs.push({ beat: 2 - 1 / 3, dur: 0.3, inst, midi: m2 + (rng.chance(0.5) ? 1 : 2), vel: 0.4 * quiet, trip: true });
    }
    evs.push({ beat: 2, dur: 1.85, inst, midi: m2, vel: 0.7 * quiet });
    this.last = m2;
    return evs;
  }

  private bossa(ctx: PlayCtx, inst: InstId): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const halves = [0, 2];
    for (const h of halves) {
      const c = chordOf(info, h);
      const root = this.place(bassPc(c), ctx, 38);
      let fifth = root + 7;
      if (fifth > this.range(ctx)[1] || rng.chance(0.55)) fifth = root - 5;
      evs.push({ beat: h, dur: 1.15, inst, midi: root, vel: 0.72 });
      if (h === 0) {
        evs.push({ beat: 1.5, dur: 0.42, inst, midi: fifth, vel: 0.55 });
      } else {
        const nc = ctx.next.chords[0].chord;
        const goes = nc.root !== c.root;
        const m = goes && rng.chance(0.4) ? this.approach(ctx, bassPc(nc), c) : fifth;
        evs.push({ beat: 3.5, dur: 0.48, inst, midi: m, vel: 0.58 });
      }
      this.last = root;
    }
    // the fifth on beat 3 is held slightly longer in the classic pattern
    if (chordOf(info, 2) === chordOf(info, 0)) {
      evs[2].midi = evs[1].midi;
      evs[2].dur = 1.3;
    }
    return evs;
  }

  private neosoul(ctx: PlayCtx, inst: InstId): Ev[] {
    const { info, rng } = ctx;
    const pats: [number, number][][] = [
      [[0, 0.7], [0.75, 0.4], [2.5, 0.45], [3.25, 0.5]],
      [[0, 1.4], [1.75, 0.3], [2.5, 0.9]],
      [[0, 0.5], [0.75, 0.6], [2, 0.4], [2.75, 0.9]],
      [[0, 2.2], [2.75, 0.25], [3.25, 0.6]],
    ];
    const pat = pats[(info.abs + (rng.chance(0.3) ? 1 : 0)) % pats.length];
    const evs: Ev[] = [];
    pat.forEach(([b, d], i) => {
      const c = chordOf(info, b);
      const nc = b >= 3 ? ctx.next.chords[0].chord : c;
      let m: number;
      if (i === 0 || info.chords.some((x) => x.beat === b)) m = this.place(bassPc(c), ctx, 34);
      else if (b >= 3 && nc !== c) m = this.place(bassPc(nc), ctx);
      else m = this.place(pc(c.root + rng.pick([0, 0, 7, 10, 12])), ctx);
      const ev: Ev = { beat: b, dur: d, inst, midi: m, vel: i === 0 ? 0.8 : 0.62 };
      if (i > 0 && rng.chance(0.25)) ev.slideFrom = m - 2;
      if (i > 0 && rng.chance(0.12)) {
        ev.vel = 0.25;
        ev.dur = 0.1;
        ev.ghost = true;
      }
      evs.push(ev);
      this.last = m;
    });
    return evs;
  }

  private pedal(ctx: PlayCtx, inst: InstId, p: number): Ev[] {
    const m = this.place(p, ctx, 33);
    const swingy = ctx.style.id === 'swing';
    const beats = swingy ? [0, 1, 2, 3] : [0, 1.5, 2, 3.5];
    return beats.map((b, i) => ({
      beat: b,
      dur: swingy ? 0.85 : 0.45,
      inst,
      midi: i % 4 === 3 && ctx.rng.chance(0.3) ? m + 12 : m,
      vel: 0.72 + (i === 0 ? 0.06 : 0),
    }));
  }

  /** Entering next bar: a little walk-up into the root. */
  private pickup(ctx: PlayCtx, inst: InstId): Ev[] {
    const nc = ctx.next.chords[0].chord;
    const target = this.place(bassPc(nc), ctx, 36);
    return [
      { beat: 2, dur: 0.85, inst, midi: target - 3, vel: 0.5 },
      { beat: 3, dur: 0.85, inst, midi: target - 1, vel: 0.55 },
    ];
  }
}

function scaleNeighbor(m: number, c: Chord, dir: number): number {
  const s = scalePcs(c);
  for (let i = 1; i <= 3; i++) if (s.includes(pc(m + dir * i))) return m + dir * i;
  return m + dir * 2;
}
