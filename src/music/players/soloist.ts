// Soloist: motif-driven improvisation + the tune's head melody.
// Phrases are planned as rhythms first (motif statement, sequence, displacement,
// lines, riffs), pitches are chosen bar by bar against the real chords: guide
// tones on strong beats, enclosures and chromatic approaches into targets, and a
// rest between phrases (players breathe).
import type { BarChord, Chord, Ev, InstId, PartId } from '../types';
import type { Motif } from '../listener';
import type { Rng } from '../../util/rng';
import { clamp } from '../../util/rng';
import { Q, bebopPcs, chordTonePcs, guideTonePcs, isAvoid, nearestPc, pc, scalePcs, tensionPcs, voice } from '../theory';
import { chordAt } from '../form';
import { chordOf, type PlayCtx } from './common';

interface PNote {
  ab: number; // absolute beat
  dur: number;
  trip?: boolean;
  step?: number; // contour step (semitones) from previous note
  fn?: number; // chord-relative interval for the first note of a statement
  pre?: number; // preset pitch
  acc?: number;
  ghost?: boolean;
  last?: boolean;
}

interface Phrase {
  notes: PNote[];
  shape: 'arch' | 'up' | 'down' | 'wave';
  start: number;
  end: number;
  idx: number;
  block: boolean; // locked-hands / octaves
}

type Phase = 'open' | 'dev' | 'climax' | 'resolve';

const RANGE: Record<string, [number, number, number]> = {
  piano: [55, 88, 70],
  rhodes: [55, 86, 69],
  archtop: [52, 81, 66],
  nylon: [52, 81, 66],
  eguitar: [52, 82, 67],
  upright: [33, 60, 45],
  ebass: [33, 60, 45],
  vibes: [55, 89, 72],
  flute: [60, 93, 76],
  kit: [40, 80, 60],
};

// --------------------------------------------------------------- head melody
interface HNote {
  beat: number; // beats from section start
  dur: number;
  fn?: number; // chord interval (first note of a cell)
  step?: number;
  vel: number;
  trip?: boolean;
}

export interface Head {
  bars: Ev[][]; // per form bar (beat-relative), melody for the head
  barsOut: Ev[][]; // variation for the head out
}

const HEAD_CELLS: Record<string, [number, number][][]> = {
  swing: [
    [[0, 1], [1, 0.5], [1.5, 2.5]],
    [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2]],
    [[0, 1.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
    [[1, 1], [2, 0.5], [2.5, 1.5]],
    [[0.5, 1], [1.5, 1], [2.5, 1.5]],
    [[0, 0.5], [0.5, 0.5], [1, 1], [2.5, 1.5]],
  ],
  bossa: [
    [[0, 1.5], [1.5, 2.5]],
    [[0, 0.5], [0.5, 1], [1.5, 2.5]],
    [[0, 1], [1, 1], [2, 2]],
    [[0.5, 1], [1.5, 1], [2.5, 1.5]],
  ],
  neosoul: [
    [[0, 0.75], [0.75, 0.75], [1.5, 2.5]],
    [[0.5, 0.25], [0.75, 0.75], [2, 2]],
    [[0, 0.5], [0.5, 0.25], [0.75, 1.25], [2.5, 1.5]],
    [[1, 0.5], [1.5, 0.25], [1.75, 2.25]],
  ],
};

export class Soloist {
  feelKey = 'solo' as const;
  jitter = 10;
  part: PartId | null = null;
  private mode: 'improv' | 'head' | null = null;
  private phrase: Phrase | null = null;
  private restUntil = 0;
  private last = 70;
  private dir = 1;
  private motif: Motif | null = null;
  private motifFn = 4;
  private phraseCount = 0;
  head: Head | null = null;
  /** Motif from the listener that the soloist should quote. */
  userMotif: Motif | null = null;
  private prevBlock: number[] = [];

  reset() {
    this.part = null;
    this.mode = null;
    this.phrase = null;
    this.motif = null;
  }

  private inst(ctx: PlayCtx, part: PartId): InstId {
    return ctx.style.inst[part];
  }

  /**
   * Generate this bar's lead events.
   * kind: 'head' | 'headOut' | 'improv' | 'fermata'.
   */
  bar(ctx: PlayCtx, part: PartId, kind: 'head' | 'headOut' | 'improv' | 'fermata', opts: { progress: number; density?: number }): Ev[] {
    const inst = this.inst(ctx, part);
    const [lo, hi, center] = RANGE[inst] ?? RANGE.piano;
    if (kind === 'fermata') return this.flourish(ctx, inst, part);
    if (kind === 'head' || kind === 'headOut') {
      if (this.mode !== 'head' || this.part !== part) {
        this.mode = 'head';
        this.part = part;
      }
      const src = kind === 'head' ? this.head?.bars : this.head?.barsOut;
      const evs = src?.[ctx.info.formBar] ?? [];
      if (evs.length) this.last = evs[evs.length - 1].midi ?? this.last;
      return evs.map((e) => ({ ...e, inst, ch: part }));
    }
    if (this.mode !== 'improv' || this.part !== part) {
      this.mode = 'improv';
      this.part = part;
      this.phrase = null;
      this.phraseCount = 0;
      this.restUntil = ctx.info.abs * 4 + (ctx.info.flags.breakBand ? 0 : ctx.rng.pick([0, 0.5, 1]));
      this.last = clamp(this.last, lo + 4, hi - 4);
      if (Math.abs(this.last - center) > 9) this.last = center - 3;
      // new motif for this solo: quote the user's rhythm when we have one
      const user = this.userMotif;
      if (user && ctx.rng.chance(0.65)) {
        this.motif = user;
        this.userMotif = null;
      } else this.motif = this.makeMotif(ctx.rng);
      this.motifFn = ctx.rng.pick([4, 7, 2, 9, 10]);
    }
    return this.improvise(ctx, inst, part, lo, hi, center, opts);
  }

  private phaseOf(p: number): Phase {
    return p < 0.25 ? 'open' : p < 0.6 ? 'dev' : p < 0.86 ? 'climax' : 'resolve';
  }

  private makeMotif(rng: Rng): Motif {
    const n = rng.int(2, 5);
    const onsets: number[] = [];
    let t = rng.pick([0, 0.5]);
    for (let i = 0; i < n; i++) {
      onsets.push(t);
      t += rng.weighted([0.5, 1, 1.5, 1 / 3], [4, 2, 1, 0.6]);
    }
    const durs = onsets.map((o, i) => (i + 1 < n ? onsets[i + 1] - o : rng.pick([0.5, 1, 1.5])));
    const contour: number[] = [];
    for (let i = 1; i < n; i++) contour.push(rng.weighted([-4, -2, -1, 1, 2, 3, 5], [1, 3, 2, 2, 3, 2, 1]));
    return { onsets, durs, contour, fromUser: false };
  }

  // ------------------------------------------------------------------ improv
  private improvise(ctx: PlayCtx, inst: InstId, part: PartId, lo: number, hi: number, center: number, opts: { progress: number; density?: number }): Ev[] {
    const { info, rng } = ctx;
    const phase = this.phaseOf(opts.progress);
    const climaxLift = { open: -2, dev: 2, climax: 7, resolve: -3 }[phase];
    const ctr = clamp(center + climaxLift + Math.round((ctx.intensity - 0.5) * 6), lo + 6, hi - 6);
    const barStart = info.abs * 4;
    const barEnd = barStart + 4;
    const evs: Ev[] = [];
    let guard = 0;
    while (guard++ < 3) {
      if (!this.phrase) {
        if (this.restUntil >= barEnd - 0.4) break;
        const start = Math.max(this.restUntil, barStart);
        this.phrase = this.planPhrase(ctx, phase, start, opts.density ?? 1, part);
      }
      const ph = this.phrase;
      const inBar = ph.notes.filter((n) => n.ab >= barStart - 1e-6 && n.ab < barEnd - 1e-6);
      for (let j = 0; j < inBar.length; j++) {
        const n = inBar[j];
        const lb = n.ab - barStart;
        const chord = chordOf(info, lb);
        const strong = Math.abs(lb - Math.round(lb)) < 0.01 && (Math.round(lb) % 2 === 0 || info.chords.some((c) => Math.abs(c.beat - lb) < 0.01));
        // plan an enclosure/approach into a strong target
        const n2 = inBar[j + 2];
        if (n.pre === undefined && n2 && n2.pre === undefined && n2.step === undefined && rng.chance(0.2)) {
          const lb2 = n2.ab - barStart;
          if (Math.abs(lb2 - Math.round(lb2)) < 0.01) {
            const T = this.target(chordOf(info, lb2), this.last + this.dir * 3, lo, hi, rng);
            n.pre = upperNeighbor(T, chordOf(info, lb2));
            inBar[j + 1].pre = T - 1;
            n2.pre = T;
          }
        }
        let m: number;
        if (n.pre !== undefined) m = n.pre;
        else if (n.fn !== undefined) {
          m = nearestPc(pc(chord.root + n.fn), this.last + (ctr - this.last) * 0.4);
        } else if (n.step !== undefined) {
          m = this.snap(this.last + n.step, chord, strong, n.step);
        } else {
          m = this.lineStep(ph, n, chord, strong, ctr, lo, hi, rng);
        }
        while (m > hi) m -= 12;
        while (m < lo) m += 12;
        if (Math.abs(m - this.last) > 4 && n.step === undefined) this.dir = m > this.last ? -1 : 1; // after a leap, come back
        this.last = m;
        // articulation & dynamics
        const prog = (n.ab - ph.start) / Math.max(1, ph.end - ph.start);
        let vel = 0.6 + 0.16 * Math.sin(Math.PI * clamp(prog, 0, 1)) + (m - ctr) * 0.005 + (phase === 'climax' ? 0.08 : phase === 'open' ? -0.05 : 0);
        const frac = lb - Math.floor(lb);
        if (ctx.style.id === 'swing' && Math.abs(frac - 0.5) < 0.01) vel += 0.07;
        if (ctx.style.id === 'swing' && frac < 0.01 && n.dur <= 0.5) vel -= 0.04;
        let dur = n.dur;
        if (n.ghost) {
          vel *= 0.45;
          dur *= 0.6;
        }
        if (n.acc) vel += n.acc;
        const ev: Ev = { beat: lb, dur, inst, midi: m, vel: clamp(vel, 0.1, 0.95), trip: n.trip, ch: part };
        evs.push(ev);
        if (ph.block && !n.ghost && dur >= 0.4) evs.push(...this.blockNotes(ctx, m, chord, inst, lb, dur, vel, n.trip, part));
      }
      // phrase finished inside this bar?
      if (ph.end <= barEnd + 1e-6) {
        const restBeats = {
          open: rng.range(2.5, 6),
          dev: rng.range(1.5, 4),
          climax: rng.range(0.75, 2.5),
          resolve: rng.range(3, 7),
        }[phase];
        this.restUntil = ph.end + restBeats;
        this.phrase = null;
        continue;
      }
      break;
    }
    return evs;
  }

  private planPhrase(ctx: PlayCtx, phase: Phase, startAb: number, density: number, part: PartId): Phrase {
    const { rng } = ctx;
    // jazz lines love to start off the beat
    let start = startAb;
    const frac = start - Math.floor(start);
    if (frac < 0.01 && rng.chance(0.55)) start += rng.pick([0.5, 1, 1.5]);
    else if (frac > 0.01 && frac < 0.5) start = Math.floor(start) + 0.5;
    const lenBars = {
      open: rng.weighted([1, 2], [3, 2]),
      dev: rng.weighted([1, 2, 3], [2, 3, 1]),
      climax: rng.weighted([2, 3, 4], [2, 2, 1]),
      resolve: rng.weighted([1, 2], [3, 1]),
    }[phase];
    const len = lenBars * 4 * clamp(density, 0.4, 1.2) - rng.range(0, 1.5);
    const fresh = ctx.info.seg !== 'head' ? null : null;
    void fresh;
    const echo = this.userMotif && rng.chance(0.7);
    const type = echo
      ? 'echo'
      : this.phraseCount === 0
        ? 'motif'
        : rng.weighted(
            ['motif', 'develop', 'line', 'riff'],
            {
              open: [0.45, 0.4, 0.15, 0],
              dev: [0.15, 0.35, 0.5, 0],
              climax: [0.05, 0.2, 0.5, 0.25],
              resolve: [0.3, 0.5, 0.2, 0],
            }[phase],
          );
    this.phraseCount++;
    let notes: PNote[] = [];
    if (type === 'echo' && this.userMotif) {
      const m = this.userMotif;
      this.userMotif = null;
      notes = this.fromMotif(m, start, true);
      notes.push(...this.fromMotif(m, start + Math.ceil(m.onsets[m.onsets.length - 1] + 1.5), false, rng.pick([2, -2, 3])));
    } else if (type === 'motif' && this.motif) {
      notes = this.fromMotif(this.motif, start, true);
      const span = Math.ceil(this.motif.onsets[this.motif.onsets.length - 1] + this.motif.durs[this.motif.durs.length - 1] + 0.5);
      if (len > span + 1) notes.push(...this.fromMotif(this.motif, start + Math.max(2, span), false, rng.pick([0, 2, -2, 5])));
    } else if (type === 'develop' && this.motif) {
      const t = rng.pick(['sequence', 'displace', 'augment', 'diminish', 'repeat'] as const);
      let m = this.motif;
      if (t === 'augment') m = { ...m, onsets: m.onsets.map((o) => o * 2), durs: m.durs.map((d) => d * 2) };
      if (t === 'diminish') m = { ...m, onsets: m.onsets.map((o) => o / 2), durs: m.durs.map((d) => d / 2) };
      const shift = t === 'displace' ? rng.pick([0.5, 1, 1.5]) : 0;
      const span = Math.max(1.5, Math.ceil(m.onsets[m.onsets.length - 1] + 1));
      notes = this.fromMotif(m, start + shift, true);
      notes.push(...this.fromMotif(m, start + shift + span, false, t === 'sequence' ? rng.pick([2, 3, -2, -3]) : 0));
      const used = shift + span * 2;
      if (len - used > 1.5) notes.push(...this.line(ctx, phase, start + used + 0.5, len - used - 0.5));
    } else if (type === 'riff') {
      const cell = rng.pick([
        [0, 1 / 3, 2 / 3],
        [0, 0.5, 1],
        [0, 0.5],
      ]);
      const cellLen = cell.length === 2 ? 1 : 1.5;
      const reps = Math.max(2, Math.floor(len / cellLen));
      const steps = cell.map(() => rng.pick([-3, -2, 2, 3]));
      const back = -steps.slice(1).reduce((a, b) => a + b, 0);
      const climb = rng.pick([0, 0, 1, 2]);
      const trip = cell[1] === 1 / 3;
      for (let r = 0; r < reps; r++) {
        cell.forEach((o, i) => {
          notes.push({ ab: start + r * cellLen + o, dur: trip ? 0.3 : 0.45, trip, step: i === 0 ? (r === 0 ? undefined : back + climb) : steps[i], fn: r === 0 && i === 0 ? this.motifFn : undefined, acc: i === 0 ? 0.08 : 0 });
        });
      }
      // a shouted repetition is the climax gesture; bring it home with a long note
      notes.push({ ab: start + reps * cellLen + 0.5, dur: 1.5, last: true });
    } else {
      notes = this.line(ctx, phase, start, len);
    }
    notes = notes.filter((n) => n.dur > 0.05);
    notes.sort((a, b) => a.ab - b.ab);
    if (!notes.length) notes = [{ ab: start, dur: 1, fn: this.motifFn }];
    // final note: short and clipped, or a held tone
    const lastN = notes[notes.length - 1];
    lastN.last = true;
    if (rng.chance(0.5)) lastN.dur = Math.max(lastN.dur, rng.pick([1, 1.5, 2]));
    else lastN.dur = Math.min(lastN.dur, 0.35);
    const end = lastN.ab + lastN.dur;
    const shape = rng.pick(['arch', 'arch', 'up', 'down', 'wave'] as const);
    this.dir = shape === 'down' ? -1 : 1;
    const block = (phase === 'climax' && rng.chance(0.3) && part !== 'bass') || (part === 'guitar' && phase === 'dev' && rng.chance(0.12));
    return { notes, shape, start, end, idx: this.phraseCount, block };
  }

  private fromMotif(m: Motif, start: number, first: boolean, transpose = 0): PNote[] {
    // a restatement starts where the previous statement started, shifted by `transpose`
    const span = m.contour.slice(0, m.onsets.length - 1).reduce((a, b) => a + b, 0);
    return m.onsets.map((o, i) => {
      const trip = Math.abs(o * 2 - Math.round(o * 2)) > 0.02;
      const n: PNote = { ab: start + o, dur: Math.max(0.2, m.durs[i] * 0.9), trip };
      if (i === 0) {
        if (first) n.fn = this.motifFn;
        else n.step = transpose - span;
      } else n.step = m.contour[i - 1] ?? 0;
      return n;
    });
  }

  private line(ctx: PlayCtx, phase: Phase, start: number, len: number): PNote[] {
    const { rng } = ctx;
    const fast = ctx.info.bpm > 175;
    const dt = ctx.info.flags.doubleTime;
    const sub = dt
      ? 0.25
      : rng.weighted(
          [1, 0.5, 1 / 3, 0.25],
          {
            open: [0.35, 0.6, 0.05, 0],
            dev: [0.1, 0.6, 0.25, 0.05],
            climax: [0.02, 0.4, 0.33, fast ? 0.02 : 0.25],
            resolve: [0.35, 0.55, 0.1, 0],
          }[phase],
        );
    const out: PNote[] = [];
    const trip = Math.abs(sub - 1 / 3) < 0.01;
    let t = trip ? Math.round(start * 3) / 3 : sub === 0.25 ? Math.round(start * 4) / 4 : Math.round(start * 2) / 2;
    const end = start + len;
    let i = 0;
    while (t < end - 1e-6) {
      const skip = i > 0 && rng.chance(0.09);
      if (!skip) {
        const ghost = !trip && sub === 0.5 && Math.abs(t - Math.round(t)) < 0.01 && i > 1 && rng.chance(0.1);
        out.push({ ab: t, dur: sub * 0.92, trip, ghost });
      }
      // occasional triplet turn inside an 8th line
      if (sub === 0.5 && Math.abs(t - Math.round(t)) < 0.01 && rng.chance(0.07) && t + 1 < end) {
        out.push({ ab: t + 1 / 3, dur: 0.3, trip: true }, { ab: t + 2 / 3, dur: 0.3, trip: true });
        t += 1;
        i += 3;
        continue;
      }
      t += sub;
      i++;
    }
    return out;
  }

  private target(c: Chord, ref: number, lo: number, hi: number, rng: Rng): number {
    const pcs = rng.chance(0.7) ? guideTonePcs(c) : tensionPcs(c).concat(chordTonePcs(c));
    let best = ref;
    let bd = 99;
    for (const p of pcs) {
      const m = nearestPc(p, ref);
      if (m < lo || m > hi) continue;
      const d = Math.abs(m - ref);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  private snap(m: number, c: Chord, strong: boolean, step: number): number {
    const pcs = strong ? chordTonePcs(c).concat(tensionPcs(c)) : scalePcs(c).concat(chordTonePcs(c));
    if (pcs.includes(pc(m)) && !(strong && isAvoid(m, c))) return m;
    const dir = step >= 0 ? 1 : -1;
    for (let k = 1; k <= 3; k++) {
      for (const s of [dir, -dir]) {
        const x = m + s * k;
        if (pcs.includes(pc(x)) && !(strong && isAvoid(x, c))) return x;
      }
    }
    return m;
  }

  private lineStep(ph: Phrase, n: PNote, c: Chord, strong: boolean, ctr: number, lo: number, hi: number, rng: Rng): number {
    const prog = (n.ab - ph.start) / Math.max(1, ph.end - ph.start);
    let want = this.dir;
    if (ph.shape === 'arch') want = prog < 0.55 ? 1 : -1;
    else if (ph.shape === 'up') want = 1;
    else if (ph.shape === 'down') want = -1;
    else want = Math.sin(prog * Math.PI * 3) >= 0 ? 1 : -1;
    if (rng.chance(0.12)) want = -want;
    if (this.last > ctr + 9) want = -1;
    if (this.last < ctr - 9) want = 1;
    if (this.last >= hi - 2) want = -1;
    if (this.last <= lo + 2) want = 1;
    this.dir = want;
    const r = rng.next();
    let m: number;
    if (r < 0.72) {
      const pcs = bebopPcs(c);
      m = this.last + want;
      let k = 0;
      while (!pcs.includes(pc(m)) && k++ < 4) m += want;
    } else if (r < 0.94) {
      // arpeggio skip
      const pcs = chordTonePcs(c).concat(tensionPcs(c));
      m = this.last + want * 2;
      let k = 0;
      while (!pcs.includes(pc(m)) && k++ < 5) m += want;
    } else {
      // leap to a chord tone, then step back (handled by caller)
      const pcs = guideTonePcs(c);
      m = this.last + want * rng.int(5, 8);
      let k = 0;
      while (!pcs.includes(pc(m)) && k++ < 5) m += want;
    }
    if (strong && (!chordTonePcs(c).concat(tensionPcs(c)).includes(pc(m)) || isAvoid(m, c))) m = this.snap(m, c, true, want);
    if (n.last) m = this.snap(m, c, true, want);
    return m;
  }

  private blockNotes(ctx: PlayCtx, m: number, c: Chord, inst: InstId, beat: number, dur: number, vel: number, trip: boolean | undefined, part: PartId): Ev[] {
    if (part === 'guitar') return [{ beat, dur, inst, midi: m - 12, vel: vel * 0.85, trip, ch: part }];
    // locked hands: chord tones under the melody within an octave
    const v = voice(c, this.prevBlock, { lo: m - 11, hi: m - 1, center: m - 6, voices: 3, rng: ctx.rng });
    this.prevBlock = v;
    return v.filter((x) => x < m).map((x) => ({ beat, dur, inst, midi: x, vel: vel * 0.7, trip, ch: part }));
  }

  /** Final chord: a quick arpeggio run up to a held top note. */
  private flourish(ctx: PlayCtx, inst: InstId, part: PartId): Ev[] {
    const c = chordOf(ctx.info, 0);
    const [, hi, center] = RANGE[inst] ?? RANGE.piano;
    const pcs = [Q[c.q].tones[0], Q[c.q].third, 7, Q[c.q].seventh, 2].map((i) => pc(c.root + i));
    let m = nearestPc(pcs[0], center - 5);
    const evs: Ev[] = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const p = pcs[i % pcs.length];
      while (pc(m) !== p) m++;
      if (m > hi) m -= 12;
      evs.push({ beat: 0.25 + i * 0.09, dur: i === n - 1 ? 3 : 0.5, inst, midi: m, vel: 0.45 + i * 0.04, trip: true, ch: part });
    }
    return evs;
  }

  // ------------------------------------------------------------------ head
  composeHead(bars: BarChord[][], sections: string[], styleId: string, headInst: InstId, rng: Rng): Head {
    const [lo, hi] = RANGE[headInst] ?? RANGE.piano;
    const center = headInst === 'piano' ? 74 : headInst === 'eguitar' ? 69 : 72;
    const cells = HEAD_CELLS[styleId] ?? HEAD_CELLS.swing;
    // compose one abstract melody per section label
    const plans = new Map<string, HNote[]>();
    const secLen = new Map<string, number>();
    for (const s of sections) secLen.set(s, (secLen.get(s) ?? 0) + 1);
    const counts = new Map<string, number>();
    sections.forEach((s) => counts.set(s, 0));
    const occurrences: { label: string; start: number; len: number }[] = [];
    for (let i = 0; i < sections.length; ) {
      const label = sections[i];
      let j = i;
      while (j < sections.length && sections[j] === label && j - i < 12) j++;
      // split AA into two 8s
      const len = j - i > 8 && label !== 'L' ? 8 : j - i;
      occurrences.push({ label, start: i, len });
      i += len;
    }
    for (const occ of occurrences) {
      if (plans.has(occ.label)) continue;
      plans.set(occ.label, this.composeSection(occ.len, cells, rng));
    }
    const out: Ev[][] = bars.map(() => []);
    const outV: Ev[][] = bars.map(() => []);
    const vr = rng.fork('headOut');
    occurrences.forEach((occ, oi) => {
      const plan = plans.get(occ.label)!;
      const isLast = oi === occurrences.length - 1;
      let last = center;
      let lastV = center;
      for (const hn of plan) {
        const barIdx = occ.start + Math.floor(hn.beat / 4);
        if (barIdx >= bars.length) continue;
        const lb = hn.beat - Math.floor(hn.beat / 4) * 4;
        const c = chordAt(bars[barIdx], lb);
        const strong = Math.abs(lb - Math.round(lb)) < 0.01;
        let m: number;
        if (hn.fn !== undefined) m = nearestPc(pc(c.root + hn.fn), last + (center - last) * 0.5);
        else m = this.snap(last + (hn.step ?? 0), c, strong || hn.dur >= 1, hn.step ?? 0);
        while (m > hi - 3) m -= 12;
        while (m < lo + 5) m += 12;
        // last section: make the final long note a stable tone
        if (isLast && hn === plan[plan.length - 1]) m = nearestPc(pc(c.root + (Q[c.q].tones.includes(9) ? 9 : 4)), m);
        last = m;
        const ev: Ev = { beat: lb, dur: hn.dur, inst: headInst, midi: m, vel: hn.vel, trip: hn.trip };
        out[barIdx].push(ev);
        // head-out: anticipations, grace notes, laid-back placements, small fills
        const v: Ev = { ...ev };
        const r = vr.next();
        if (r < 0.22 && lb >= 0.5 && !hn.trip) v.beat = lb - 0.5;
        else if (r < 0.34) v.offMs = 25;
        if (vr.chance(0.18) && v.beat >= 0.34) {
          outV[barIdx].push({ beat: v.beat - 1 / 3, dur: 0.25, inst: headInst, midi: m - 1, vel: hn.vel * 0.6, trip: true });
          v.trip = true;
        }
        if (vr.chance(0.1) && hn.dur >= 2) {
          // short turn after a long note
          const tb = v.beat + 1.5;
          if (tb + 0.5 < 4) {
            outV[barIdx].push({ beat: tb, dur: 0.3, inst: headInst, midi: m + 2, vel: hn.vel * 0.7 }, { beat: tb + 0.5, dur: 0.4, inst: headInst, midi: m, vel: hn.vel * 0.75 });
            v.dur = 1.4;
          }
        }
        outV[barIdx].push(v);
        lastV = m;
      }
      void lastV;
    });
    return { bars: out, barsOut: outV };
  }

  private composeSection(len: number, cells: [number, number][][], rng: Rng): HNote[] {
    const notes: HNote[] = [];
    const cellA = rng.pick(cells);
    const contourA = cellA.map((_, i) => (i === 0 ? 0 : rng.weighted([-3, -2, -1, 1, 2, 4], [1, 2, 2, 2, 2, 1])));
    const fnA = rng.pick([4, 7, 9, 2, 11, 10]);
    const cellB = rng.pick(cells);
    const contourB = cellB.map((_, i) => (i === 0 ? 0 : rng.weighted([-3, -2, -1, 1, 2], [1, 2, 2, 2, 1])));
    const put = (bar: number, cell: [number, number][], contour: number[], fn: number | undefined, shift = 0, vel = 0.66, firstStep = 0) => {
      cell.forEach(([b, d], i) => {
        const beat = bar * 4 + b + shift;
        notes.push({ beat, dur: d * 0.95, fn: i === 0 && fn !== undefined ? fn : undefined, step: i === 0 ? firstStep : contour[i], vel: vel + (i === 0 ? 0.04 : 0) });
      });
    };
    const answer = (bar: number) => {
      if (rng.chance(0.35)) return; // rest
      notes.push({ beat: bar * 4 + rng.pick([0, 0.5]), dur: rng.pick([2, 3, 3.5]), step: rng.pick([-2, -1, 1, 2]), vel: 0.6 });
    };
    if (len === 12) {
      // blues-like: statement, repeat over IV, answer
      put(0, cellA, contourA, fnA);
      answer(1);
      put(2, cellA, contourA, undefined, 0, 0.64, rng.pick([-2, 2]));
      answer(3);
      put(4, cellA, contourA, fnA);
      answer(5);
      put(6, cellA, contourA, undefined, 0, 0.62, -2);
      answer(7);
      put(8, cellB, contourB, rng.pick([4, 7]));
      put(9, cellB, contourB, undefined, 0.5, 0.64, -2);
      notes.push({ beat: 10 * 4, dur: 3.5, step: -1, vel: 0.62 });
      return notes;
    }
    put(0, cellA, contourA, fnA);
    answer(1);
    put(2, cellA, contourA, fnA); // sequence: same function on the new chord
    answer(3);
    const disp = rng.pick([0, 0.5, 1]);
    put(4, cellA, contourA, undefined, disp, 0.7, rng.pick([2, 3]));
    put(5, cellB, contourB, undefined, 0, 0.72, rng.pick([1, 2]));
    // cadence
    put(6, cellB, contourB.map((x) => -Math.abs(x)), undefined, 0, 0.66, -2);
    notes.push({ beat: 7 * 4, dur: 3.2, step: -1, vel: 0.62 });
    return notes.filter((n) => n.beat < len * 4);
  }
}

function upperNeighbor(T: number, c: Chord): number {
  const s = scalePcs(c);
  for (let k = 1; k <= 2; k++) if (s.includes(pc(T + k))) return T + k;
  return T + 2;
}
