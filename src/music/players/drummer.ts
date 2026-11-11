import type { DrumId, Ev, StyleId } from '../types';
import type { Rng } from '../../util/rng';
import { kimeRhythm, leadBusy, type PlayCtx } from './common';

const K = 'kit' as const;
const hit = (beat: number, drum: DrumId, vel: number, extra: Partial<Ev> = {}): Ev => ({ beat, dur: 0.5, inst: K, drum, vel, ...extra });

export class Drummer {
  mode: 'brushes' | 'sticks' = 'brushes';
  pendingCrash = false;
  feelKey = 'drums' as const;
  jitter = 4;
  private lastFillAbs = -99;
  private nsKick = 0;

  reset() {
    this.mode = 'brushes';
    this.pendingCrash = false;
  }

  bar(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const f = info.flags;
    if (!ctx.active) {
      if (info.flags.joinNext === 'drums') {
        return this.mode === 'brushes'
          ? [hit(2, 'brushSweep', 0.3, { dur: 2 }), hit(3.5, 'brushTap', 0.45)]
          : [hit(3, 'snare', 0.3), hit(3.5, 'snare', 0.5)];
      }
      return [];
    }
    if (info.seg === 'silence') return [];
    if (info.seg === 'countin') return [0, 1, 2, 3].map((b) => hit(b, 'stick', b === 0 ? 0.7 : 0.55));
    if (info.seg === 'fermata') return this.fermata();
    if (info.seg === 'trade' && info.soloist === 'drums') return this.soloBar(ctx);

    // stick/brush choice at section boundaries
    if (info.formBar % 8 === 0 || info.segBar === 0) {
      const want = ctx.style.id === 'swing' ? (ctx.intensity > 0.52 && info.seg !== 'head' ? 'sticks' : 'brushes') : 'sticks';
      if (f.dropdown) this.mode = 'brushes';
      else if (want !== this.mode && (rng.chance(0.75) || info.segBar === 0)) this.mode = want;
    }
    if (ctx.style.id !== 'swing') this.mode = f.dropdown ? 'brushes' : 'sticks';

    const crash = this.pendingCrash || !!f.crash;
    this.pendingCrash = false;
    const evs: Ev[] = [];

    if (f.breakBand) {
      if (!ctx.prev?.flags.breakBand) evs.push(hit(0, 'crash', 0.75), hit(0, 'kick', 0.7), hit(0, 'snare', 0.6));
      return evs;
    }
    if (f.stopTime) {
      evs.push(hit(0, this.mode === 'sticks' ? 'crash' : 'ride', 0.6), hit(0, 'kick', 0.6), hit(1, 'hhPedal', 0.4), hit(3, 'hhPedal', 0.4));
      return evs;
    }
    if (f.kime) {
      const r = kimeRhythm(info);
      r.forEach((b, i) => evs.push(hit(b, i === 0 || i === r.length - 1 ? 'crash' : 'snare', 0.75), hit(b, 'kick', 0.7)));
      return evs;
    }

    // ---- time keeping
    let tk: Ev[];
    if (ctx.style.id === 'bossa') tk = this.bossa(ctx);
    else if (ctx.style.id === 'neosoul') tk = this.neosoul(ctx);
    else tk = this.mode === 'brushes' ? this.brushes(ctx) : this.swingSticks(ctx);

    // ---- fills at phrase ends
    let fillStrength = f.fill ?? 0;
    if (!fillStrength) {
      const fb = info.formBar;
      if (fb % 8 === 7) fillStrength = info.formBar === info.formLen - 1 ? 0.7 : 0.45;
      else if (fb % 4 === 3 && rng.chance(0.25 + 0.3 * ctx.intensity)) fillStrength = 0.25;
      else if (rng.chance(0.04)) fillStrength = 0.15;
      if (fillStrength && info.abs - this.lastFillAbs < 3 && fillStrength < 0.5) fillStrength = 0;
      if (fillStrength && rng.chance(0.18)) fillStrength *= 0.5; // sometimes stay simple
    }
    if (f.joinNext) fillStrength = Math.max(fillStrength, 0.3);
    if (ctx.next.flags.breakBand || ctx.next.flags.kime) fillStrength = Math.max(fillStrength, 0.5);
    if (f.dropdown && !ctx.next.flags.dropdown) fillStrength = 0.75; // big fill back in
    else if (f.dropdown) fillStrength = Math.min(fillStrength, 0.15);

    if (fillStrength > 0.05) {
      const fill = this.fill(ctx, fillStrength);
      const startBeat = fill.length ? Math.min(...fill.map((e) => e.beat)) : 4;
      tk = tk.filter((e) => e.beat < startBeat - 0.01 || e.drum === 'hhPedal' || (e.drum === 'kick' && e.vel < 0.2));
      evs.push(...fill);
      this.lastFillAbs = info.abs;
      if (fillStrength >= 0.4 && !ctx.next.flags.dropdown && ctx.next.seg !== 'silence') this.pendingCrash = true;
    }

    if (crash) {
      tk = tk.filter((e) => !(e.beat === 0 && (e.drum === 'ride' || e.drum === 'brushTap')));
      evs.push(hit(0, 'crash', this.mode === 'brushes' ? 0.45 : 0.62 + 0.25 * ctx.intensity), hit(0, 'kick', 0.55));
    }
    // dropdown: thin it out
    if (f.dropdown) tk = tk.filter((e) => e.drum !== 'kick' || e.vel < 0.2).map((e) => ({ ...e, vel: e.vel * 0.75 }));
    return evs.concat(tk);
  }

  // ----------------------------------------------------------- swing
  private swingSticks(ctx: PlayCtx): Ev[] {
    const { rng, info } = ctx;
    const I = ctx.intensity;
    const evs: Ev[] = [];
    if (info.flags.doubleTime) {
      for (let i = 0; i < 8; i++) evs.push(hit(i * 0.5, 'ride', i % 2 ? 0.38 : 0.58 + (i % 4 === 2 ? 0.08 : 0)));
    } else {
      const pat: [number, number][] = [
        [0, 0.56],
        [1, 0.7],
        [1.5, 0.4],
        [2, 0.56],
        [3, 0.7],
        [3.5, 0.4],
      ];
      for (const [b, v] of pat) {
        if (b % 1 && rng.chance(0.12)) continue; // drop a skip note
        evs.push(hit(b, 'ride', v + rng.range(-0.05, 0.05)));
      }
      if (rng.chance(0.08 + 0.12 * I)) evs.push(hit(rng.pick([0.5, 2.5]), 'ride', 0.38));
      if (I > 0.75 && rng.chance(0.08)) evs.push(hit(rng.pick([1, 3]), 'rideBell', 0.5));
    }
    evs.push(hit(1, 'hhPedal', 0.55), hit(3, 'hhPedal', 0.58));
    for (let k = 0; k < 4; k++) evs.push(hit(k, 'kick', 0.12 + rng.range(0, 0.04)));
    // snare comping: conversational, more when the soloist breathes
    const slots = [0.5, 1.5, 2.5, 3.5, 1 / 3 + 1, 2 / 3 + 2, 3 + 1 / 3, 2 + 1 / 3];
    const quiet = ctx.leadEvs.length === 0;
    let n = Math.round(rng.range(0, 1.2) + 2.4 * I + (quiet ? 1 : 0));
    for (const s of shuffle(slots, rng)) {
      if (n <= 0) break;
      if (!quiet && leadBusy(ctx.leadEvs, s, 0.3) && rng.chance(0.6)) continue;
      const trip = Math.abs(s * 2 - Math.round(s * 2)) > 0.01;
      const accent = rng.chance(0.25 + 0.3 * I);
      evs.push(hit(s, 'snare', accent ? rng.range(0.5, 0.72) : rng.range(0.18, 0.32), { trip }));
      if (rng.chance(0.1 + 0.15 * I)) evs.push(hit(s, 'kick', rng.range(0.45, 0.65), { trip })); // bomb
      n--;
    }
    return evs;
  }

  private brushes(ctx: PlayCtx): Ev[] {
    const { rng } = ctx;
    const evs: Ev[] = [];
    evs.push(hit(0, 'brushSweep', 0.42, { dur: 2 }), hit(2, 'brushSweep', 0.42, { dur: 2 }));
    const pat: [number, number][] = [
      [0, 0.38],
      [1, 0.62],
      [1.5, 0.3],
      [2, 0.38],
      [3, 0.65],
      [3.5, 0.3],
    ];
    for (const [b, v] of pat) if (!(b % 1) || rng.chance(0.75)) evs.push(hit(b, 'brushTap', v + rng.range(-0.05, 0.05)));
    evs.push(hit(1, 'hhPedal', 0.45), hit(3, 'hhPedal', 0.45));
    for (let k = 0; k < 4; k++) evs.push(hit(k, 'kick', 0.1));
    if (rng.chance(0.25 + 0.3 * ctx.intensity)) evs.push(hit(rng.pick([2 + 2 / 3, 3 + 2 / 3, 1 + 2 / 3]), 'brushTap', 0.5, { trip: true }));
    return evs;
  }

  // ----------------------------------------------------------- bossa
  private bossa(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const clave = info.abs % 2 === 0 ? [0, 1.5, 3] : [1, 2];
    for (const b of clave) evs.push(hit(b, 'rim', 0.55 + rng.range(-0.05, 0.05)));
    const cym = ctx.intensity > 0.65 ? 'ride' : 'hhClosed';
    for (let i = 0; i < 8; i++) evs.push(hit(i * 0.5, cym, (i % 2 ? 0.42 : 0.3) + rng.range(-0.04, 0.04)));
    for (const b of [0, 1.5, 2, 3.5]) evs.push(hit(b, 'kick', b % 2 === 0 ? 0.42 : 0.3));
    if (info.flags.dropdown) return evs.filter((e) => e.drum !== 'kick');
    return evs;
  }

  // ----------------------------------------------------------- neo soul
  private neosoul(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const I = ctx.intensity;
    const evs: Ev[] = [];
    const acc = [0.55, 0.16, 0.34, 0.2];
    for (let i = 0; i < 16; i++) {
      if (i === 14 && rng.chance(0.3)) {
        evs.push(hit(3.5, 'hhOpen', 0.4));
        continue;
      }
      if (i % 2 === 1 && rng.chance(0.2)) continue;
      evs.push(hit(i * 0.25, 'hhClosed', acc[i % 4] + rng.range(-0.05, 0.06)));
    }
    const kicks = [
      [0, 0.75, 2.5],
      [0, 1.75, 2.5],
      [0, 0.5, 2.75, 3.25],
      [0, 2.25, 2.5],
    ];
    if (info.abs % 2 === 0) this.nsKick = rng.int(0, kicks.length - 1);
    for (const b of kicks[this.nsKick]) evs.push(hit(b, 'kick', b === 0 ? 0.8 : 0.62));
    evs.push(hit(1, 'snare', 0.78, { offMs: 18 }), hit(3, 'snare', 0.8, { offMs: 20 }));
    const ghosts = [0.75, 1.75, 2.25, 2.75, 3.75, 1.5];
    for (const g of ghosts) if (rng.chance(0.12 + 0.18 * I)) evs.push(hit(g, 'snare', rng.range(0.1, 0.2)));
    return evs;
  }

  // ----------------------------------------------------------- fills
  private fill(ctx: PlayCtx, strength: number): Ev[] {
    const { rng } = ctx;
    const beats = strength > 0.8 ? 4 : strength > 0.55 ? 2 : 1;
    const start = 4 - beats;
    const evs: Ev[] = [];
    const brush = this.mode === 'brushes' && ctx.style.id === 'swing';
    const snare: DrumId = brush ? 'brushTap' : ctx.style.id === 'bossa' && strength < 0.4 ? 'rim' : 'snare';
    const toms: DrumId[] = ['tomHi', 'tomMid', 'tomLo'];
    const sixteenth = ctx.style.id !== 'swing';
    const step = sixteenth ? 0.25 : 1 / 3;
    let t = start;
    let idx = 0;
    const total = Math.round(beats / step);
    while (t < 4 - 1e-6) {
      const prog = idx / total;
      const vel = (0.3 + 0.45 * prog) * (0.7 + 0.5 * strength);
      const r = rng.next();
      if (r < 0.15 && idx > 0) {
        // rest
      } else if (!brush && prog > 0.4 && r < 0.55) {
        evs.push(hit(t, toms[Math.min(2, Math.floor((prog - 0.4) * 5))], vel, { trip: !sixteenth }));
      } else if (r > 0.9 && !brush) {
        evs.push(hit(t, 'kick', vel, { trip: !sixteenth }));
      } else {
        evs.push(hit(t, snare, vel * (rng.chance(0.25) ? 0.5 : 1), { trip: !sixteenth }));
      }
      t += step;
      idx++;
    }
    // keep the hi-hat foot going
    return evs;
  }

  private soloBar(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    const evs: Ev[] = [];
    const crash = this.pendingCrash;
    this.pendingCrash = false;
    const pos = info.segBar % 4;
    if (crash || pos === 0) evs.push(hit(0, 'crash', 0.7), hit(0, 'kick', 0.7));
    evs.push(hit(1, 'hhPedal', 0.5), hit(3, 'hhPedal', 0.5));
    const sixteenth = ctx.style.id !== 'swing';
    const step = sixteenth ? 0.25 : 1 / 3;
    const cellLen = sixteenth ? 4 : 3;
    // a short cell, repeated with orchestration changes
    const cell = Array.from({ length: cellLen }, () => rng.chance(0.75));
    const voices: DrumId[] = ['snare', 'tomHi', 'tomMid', 'tomLo', 'kick'];
    for (let b = pos === 0 ? 1 : 0; b < 4; b++) {
      const voice = voices[Math.min(4, Math.floor(rng.range(0, 1 + pos + b * 0.6)))];
      for (let i = 0; i < cellLen; i++) {
        if (!cell[i]) continue;
        const prog = (pos * 4 + b) / 16;
        evs.push(hit(b + i * step, i === 0 && rng.chance(0.3) ? 'kick' : voice, (0.4 + 0.4 * prog) * (i === 0 ? 1 : 0.7), { trip: !sixteenth }));
      }
    }
    if (pos === 3) this.pendingCrash = true;
    return evs;
  }

  private fermata(): Ev[] {
    const evs: Ev[] = [hit(0, 'crash', 0.85), hit(0, 'kick', 0.75)];
    // cymbal roll swelling then the final cut-off
    for (let b = 0.5; b < 3.4; b += 0.0625) {
      const v = 0.12 + 0.35 * ((b - 0.5) / 2.9) ** 2;
      evs.push(hit(b, 'ride', v, { trip: true }));
    }
    evs.push(hit(3.5, 'crash', 0.9, { trip: true }), hit(3.5, 'kick', 0.8, { trip: true }), hit(3.5, 'snare', 0.7, { trip: true }));
    this.pendingCrash = false;
    return evs;
  }

  // ----------------------------------------------------------- tap reaction
  private lastReact = -99;
  private runStep = 0;

  /**
   * Answer a user tap right away: an accent on the tap itself.
   * Slow taps get a big hit, medium taps a snare comp, fast runs a tom run.
   */
  react(o: { time: number; ioi: number; vel: number; strong: boolean; downbeat: boolean; style: StyleId; intensity: number; rng: Rng }): { drum: DrumId; vel: number }[] {
    const { ioi, vel, rng, style } = o;
    if (o.time - this.lastReact < 0.14) return [];
    const brush = style === 'swing' && this.mode === 'brushes';
    const out: { drum: DrumId; vel: number }[] = [];
    const v = (x: number) => Math.min(0.95, x * (0.75 + 0.5 * vel));
    if (ioi > 0.9) {
      // deliberate tap: a big accent
      this.runStep = 0;
      if (brush) out.push({ drum: 'brushTap', vel: v(0.62) }, { drum: 'kick', vel: v(0.4) });
      else if (style === 'bossa') out.push({ drum: 'rim', vel: v(0.7) }, { drum: 'kick', vel: v(0.5) });
      else if (style === 'neosoul') out.push({ drum: rng.chance(0.5) ? 'clap' : 'snare', vel: v(0.7) }, { drum: 'kick', vel: v(0.65) });
      else {
        out.push({ drum: 'snare', vel: v(0.62) }, { drum: 'kick', vel: v(0.55) });
        if (o.downbeat || (o.strong && o.intensity > 0.5 && rng.chance(0.4))) out.push({ drum: 'crash', vel: v(0.55) });
      }
    } else if (ioi > 0.33) {
      // conversational comping on the tap
      this.runStep = 0;
      if (!rng.chance(0.8)) return [];
      if (brush) out.push({ drum: 'brushTap', vel: v(0.5) });
      else if (style === 'bossa') out.push({ drum: rng.chance(0.75) ? 'rim' : 'tomHi', vel: v(0.5) });
      else if (style === 'neosoul') out.push(rng.chance(0.6) ? { drum: 'snare', vel: v(0.4) } : { drum: 'hhOpen', vel: v(0.4) });
      else {
        out.push({ drum: 'snare', vel: v(o.strong ? 0.5 : 0.42) });
        if (o.strong && rng.chance(0.3)) out.push({ drum: 'kick', vel: v(0.45) });
      }
    } else {
      // fast run: follow it with a descending tom run
      if (brush) out.push({ drum: 'brushTap', vel: v(0.35) });
      else {
        const run: DrumId[] = style === 'bossa' ? ['rim', 'tomHi', 'tomMid', 'tomLo'] : ['snare', 'tomHi', 'tomMid', 'tomLo'];
        out.push({ drum: run[Math.floor((this.runStep % 8) / 2)], vel: v(0.32 + 0.03 * (this.runStep % 8)) });
        this.runStep++;
      }
    }
    this.lastReact = o.time;
    return out;
  }
}

function shuffle<T>(arr: T[], rng: { next(): number }): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
