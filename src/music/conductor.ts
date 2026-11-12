// Conductor: owns the clock, the form, the band's intensity and the session
// story (build-up -> head -> solos -> trades -> head -> ending -> next tune).
import type { BarChord, BarInfo, BarTiming, Chord, Ev, PartId, ScheduledNote, StyleId } from './types';
import { PARTS, beatTime, makeTiming, timeToBeat } from './types';
import { STYLES, nextStyle, type StyleDef } from './styles';
import { swingBeat } from './humanizer';
import { humanize } from './humanizer';
import { buildChart, chordAt, parseTemplate, reharmonize, transpose, type Chart } from './form';
import { Listener } from './listener';
import { Rng, clamp, smoothstep } from '../util/rng';
import { NOTE_NAMES, bebopPcs, chordName, chordTonePcs, guideTonePcs, nearestPc, pc, tensionPcs } from './theory';
import { Bassist } from './players/bassist';
import { Drummer } from './players/drummer';
import { Pianist } from './players/pianist';
import { Guitarist } from './players/guitarist';
import { Percussionist } from './players/percussionist';
import { Soloist } from './players/soloist';
import type { PlayCtx } from './players/common';

// Tunable constants (spec §3.3)
export const JOIN_AT: { taps: number; part: PartId }[] = [
  { taps: 4, part: 'bass' },
  { taps: 8, part: 'drums' },
  { taps: 12, part: 'guitar' },
  { taps: 16, part: 'perc' },
  { taps: 20, part: 'piano' },
];
export const SESSION_AT = 28;
const LOOK = 0.4; // seconds of look-ahead when generating a bar
const IDLE_END = 30; // seconds without taps -> play the ending

export type UiEvent =
  | { type: 'join'; part: PartId; time: number }
  | { type: 'lead'; part: PartId | null; time: number }
  | { type: 'style'; style: StyleId; key: number; bpm: number; time: number }
  | { type: 'bar'; info: BarInfo; intensity: number; time: number; chord: string; drumMode: string; tapCount: number; upcoming: BarChord[][] }
  | { type: 'fx'; text: string; time: number }
  | { type: 'applause'; time: number; big: boolean }
  | { type: 'session'; time: number }
  | { type: 'song'; time: number; form: string }
  | { type: 'rest'; time: number }
  | { type: 'reset'; time: number }
  | { type: 'notes'; notes: ScheduledNote[] };

export interface ConductorHooks {
  now(): number;
  play(notes: ScheduledNote[]): void;
  emit(e: UiEvent): void;
}

export type InputKind = 'tap' | 'style' | 'tempo' | 'key' | 'reset';
export interface InputRec {
  t: number; // seconds since origin
  k: InputKind;
  v?: number;
}

interface SegPlan {
  seg: 'head' | 'solo' | 'trade' | 'headOut';
  bars: number;
  soloist?: PartId;
  traders?: PartId[];
}

type Mode = 'idle' | 'buildup' | 'song' | 'switch' | 'tag' | 'fermata' | 'silence' | 'countin' | 'rest';

export class Conductor {
  readonly seed: number;
  private rng: Rng;
  private tapRng: Rng;
  private reactRng: Rng;
  style: StyleDef;
  key: number;
  bpm: number;
  private curBpm: number;
  mode: Mode = 'idle';
  running = false;
  private abs = 0;
  private nextBarTime = 0;
  private infos = new Map<number, BarInfo>();
  timings = new Map<number, BarTiming>();
  intensity = 0.25;
  tapCount = 0;
  active: Record<PartId, boolean> = { bass: false, drums: false, guitar: false, perc: false, piano: false };
  sessionReached = false;
  private joinQueue: PartId[] = [];
  private joinedCount = 0;
  private chart!: Chart;
  private chorusCache = new Map<string, BarChord[][]>();
  private segs: SegPlan[] = [];
  private songBar = 0;
  private songLen = 0;
  private buildBar = 0;
  private tagBar = 0;
  private tagTpl: BarChord[][] = [];
  private silenceLeft = 0;
  private pendingSession = false;
  private pendingStyle = false;
  private pendingKey: number | null = null;
  private pendingEnd: 'idle' | 'reset' | null = null;
  private pendingTempo: number | null = null;
  private breakSeg = -1;
  private drama: { type: 'dropdown' | 'stopTime' | 'doubleTime' | 'pedal'; until: number } | null = null;
  private lastDrama = -99;
  private compLead: 'piano' | 'guitar' = 'piano';
  private lastLead: PartId | null = null;
  private lastTapAt = -Infinity;
  private lastTapMidi = 72;
  private tapRunDir = 1;
  private inputs: { time: number; k: InputKind; v?: number }[] = [];
  /** Input record for share links (relative to origin). */
  record: InputRec[] = [];
  origin = -1;
  private replayQueue: InputRec[] | null = null;
  // tap-driven direction: the band reads how you tap and changes the tune
  private laidOut = false;
  private lastLayout = -99;
  private reentry = false;
  harmLevel = 0;
  private dtUntil = -1;
  private lastDt = -99;
  private lastTempoFx = -Infinity;
  private lastModTap = -Infinity;
  private lastModAbs = -99;

  listener = new Listener();
  bass = new Bassist();
  drums = new Drummer();
  piano = new Pianist();
  guitar = new Guitarist();
  perc = new Percussionist();
  soloist = new Soloist();
  private prng: Record<string, Rng>;

  constructor(
    private hooks: ConductorHooks,
    opts: { seed: number; style: StyleId; key?: number; bpm?: number },
  ) {
    this.seed = opts.seed;
    this.rng = new Rng(opts.seed);
    this.tapRng = this.rng.fork('tap');
    this.reactRng = this.rng.fork('react');
    this.prng = {
      bass: this.rng.fork('bass'),
      drums: this.rng.fork('drums'),
      piano: this.rng.fork('piano'),
      guitar: this.rng.fork('guitar'),
      perc: this.rng.fork('perc'),
      solo: this.rng.fork('solo'),
      human: this.rng.fork('human'),
      form: this.rng.fork('form'),
    };
    this.style = STYLES[opts.style];
    this.key = opts.key ?? this.style.key;
    this.bpm = opts.bpm ?? this.style.bpm;
    this.curBpm = this.bpm;
    this.chart = buildChart(this.style, this.prng.form);
  }

  get tapInst() {
    return this.style.tapInst[this.tapCount >= JOIN_AT[4].taps ? 1 : 0];
  }

  // ------------------------------------------------------------------ input
  /** User tap (live). Returns the scheduled tap notes. */
  tap(time: number): ScheduledNote[] {
    if (this.origin < 0) this.origin = time;
    this.record.push({ t: +(time - this.origin).toFixed(4), k: 'tap' });
    return this.doTap(time);
  }

  private doTap(time: number): ScheduledNote[] {
    const harmony = time - this.lastTapAt < 0.045;
    if (!this.running && !harmony) this.startClock(time);
    const notes = this.tapNotes(time, harmony);
    if (!harmony) {
      this.inputs.push({ time, k: 'tap' });
      this.lastTapAt = time;
    }
    this.hooks.play(notes);
    this.hooks.emit({ type: 'notes', notes });
    this.tick();
    return notes;
  }

  input(k: Exclude<InputKind, 'tap'>, v?: number) {
    const time = this.hooks.now();
    if (this.origin >= 0) this.record.push({ t: +(time - this.origin).toFixed(4), k, v });
    this.applyInput(k, v, time);
  }

  private applyInput(k: InputKind, v: number | undefined, time: number) {
    if (k === 'style') {
      if (!this.running) this.changeStyle(nextStyle(this.style.id), time);
      else this.pendingStyle = true;
    } else if (k === 'tempo' && v !== undefined) {
      this.pendingTempo = clamp(v, this.style.bpmRange[0], this.style.bpmRange[1]);
      if (!this.running) {
        this.bpm = this.curBpm = this.pendingTempo;
        this.pendingTempo = null;
      }
    } else if (k === 'key' && v !== undefined) {
      if (!this.running) {
        this.key = v;
        this.chorusCache.clear();
      } else this.pendingKey = v;
    } else if (k === 'reset') {
      if (!this.running) this.fullReset(time);
      else this.pendingEnd = 'reset';
    }
  }

  /** Replay a recorded session (share link). */
  startReplay(rec: InputRec[], origin: number) {
    this.replayQueue = rec.slice();
    this.origin = origin;
  }

  private feeding = false;
  private feedReplay(now: number) {
    const q = this.replayQueue;
    if (!q || this.feeding) return;
    this.feeding = true;
    while (q.length && this.origin + q[0].t <= now + 0.005) {
      const r = q.shift()!;
      const t = this.origin + r.t;
      this.record.push(r);
      if (r.k === 'tap') this.doTap(t);
      else this.applyInput(r.k, r.v, t);
    }
    this.feeding = false;
    if (!q.length) this.replayQueue = null;
  }

  get replaying() {
    return this.replayQueue !== null;
  }

  // ------------------------------------------------------------------ clock
  private startClock(time: number) {
    this.running = true;
    this.nextBarTime = time;
    this.infos.clear();
    this.timings.clear();
    this.abs = 0;
    if (this.mode === 'idle') {
      this.mode = 'buildup';
      this.buildBar = 0;
    } else if (this.mode === 'rest') {
      // back from a rest: count in a new tune (or resume the build-up)
      this.mode = this.sessionReached ? 'countin' : 'buildup';
      this.buildBar = 0;
    }
    this.curBpm = this.bpm;
    this.planInto(0);
  }

  tick() {
    const now = this.hooks.now();
    this.feedReplay(now);
    let guard = 0;
    while (this.running && now + LOOK >= this.nextBarTime && guard++ < 4) this.generateBar();
  }

  // ------------------------------------------------------------------ tap voice
  private barAt(time: number): { info: BarInfo; timing: BarTiming } | null {
    for (const [abs, t] of this.timings) {
      if (time >= t.start - 0.001 && time < t.end) {
        const info = this.infos.get(abs);
        if (info) return { info, timing: t };
      }
    }
    return null;
  }

  private tapNotes(time: number, harmony: boolean): ScheduledNote[] {
    const rng = this.tapRng;
    const inst = this.tapInst;
    let qt = time;
    let chord: Chord = { root: this.key, q: this.style.id === 'swing' ? '6' : 'maj9' };
    let strong = true;
    let absBeat = -1;
    let rawBeat = -1;
    let downbeat = false;
    const bar = this.barAt(time + 0.01);
    if (bar) {
      const { info, timing } = bar;
      const beat = timeToBeat(timing, time);
      const grid = this.style.swing === 'tempo' ? 1 / 3 : 0.5;
      // candidate grid points around the tap (swung for 8th grids)
      let best = beat;
      let bestT = Infinity;
      for (let g = Math.floor(beat / grid) - 1; g <= Math.floor(beat / grid) + 2; g++) {
        const b = g * grid;
        const sb = grid === 0.5 ? swingBeat(b, this.style, info.bpm, 1) : b;
        const tt = beatTime(timing, sb);
        if (Math.abs(tt - time) < Math.abs(bestT - time)) {
          bestT = tt;
          best = b;
        }
      }
      // weak quantize: keep 40% of the human offset (cannot move into the past)
      if (bestT > time) qt = time + (bestT - time) * 0.6;
      const lb = Math.max(0, Math.min(3.99, best));
      chord = chordAt(info.chords, lb);
      strong = Math.abs(lb - Math.round(lb)) < 0.01;
      downbeat = lb < 0.01;
      absBeat = info.abs * 4 + lb;
      rawBeat = info.abs * 4 + beat;
    }
    if (harmony) {
      const m = nearestPc(guideTonePcs(chord)[rng.int(0, 1)], this.lastTapMidi - 5);
      return [{ time: qt + 0.004, dur: 0.6, inst, midi: m < this.lastTapMidi ? m : m - 12, vel: 0.45, ch: 'tap' }];
    }
    const ioi = time - this.lastTapAt;
    const vel = clamp(0.36 + 0.24 * Math.log2(Math.max(0.08, ioi) / 0.25), 0.3, 0.88);
    const lo = inst === 'flute' ? 67 : 60;
    const hi = inst === 'flute' ? 91 : 86;
    let last = this.lastTapMidi;
    if (ioi > 2.5) last = 71 + rng.int(-3, 3);
    let m: number;
    if (ioi < 0.33) {
      // fast taps become runs
      const pcs = bebopPcs(chord);
      m = last + this.tapRunDir;
      let k = 0;
      while (!pcs.includes(pc(m)) && k++ < 4) m += this.tapRunDir;
      if (m >= hi || m <= lo) {
        this.tapRunDir *= -1;
        m = last + this.tapRunDir * 2;
      }
    } else {
      const pcs = strong ? chordTonePcs(chord).concat(tensionPcs(chord)) : chordTonePcs(chord).concat(tensionPcs(chord), guideTonePcs(chord));
      const leap = rng.chance(0.2);
      const dir = rng.chance(0.5) ? 1 : -1;
      const cands: number[] = [];
      for (let x = lo; x <= hi; x++) if (pcs.includes(pc(x)) && x !== last) cands.push(x);
      const w = cands.map((x) => {
        const d = x - last;
        const want = leap ? Math.abs(Math.abs(d) - 7) : Math.abs(Math.abs(d) - 2);
        return (Math.sign(d) === dir ? 1 : 0.4) / (0.5 + want);
      });
      m = rng.weighted(cands, w);
      if (leap) this.tapRunDir = m > last ? -1 : 1;
    }
    m = clamp(m, lo, hi);
    this.lastTapMidi = m;
    const dur = ioi > 0.9 ? 1.4 : ioi < 0.33 ? 0.25 : 0.6;
    const notes: ScheduledNote[] = [{ time: qt + 0.004, dur, inst, midi: m, vel, ch: 'tap' }];
    // slow taps get a little chord under them
    if (ioi > 0.9) {
      const g = guideTonePcs(chord);
      const n = rng.chance(0.5) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        let h = nearestPc(g[i], m - 6);
        if (h >= m) h -= 12;
        notes.push({ time: qt + 0.004 + 0.012 * (i + 1), dur, inst, midi: h, vel: vel * 0.75, ch: 'tap' });
      }
    }
    if (bar) notes.push(...this.bandReact(bar.info, qt + 0.004, time, ioi, vel, chord, strong, downbeat));
    this.listener.add({ time, absBeat, rawBeat, vel, midi: m });
    return notes;
  }

  /** Drums and piano answer the tap on the spot (only once they have joined). */
  private bandReact(info: BarInfo, t: number, time: number, ioi: number, vel: number, chord: Chord, strong: boolean, downbeat: boolean): ScheduledNote[] {
    const out: ScheduledNote[] = [];
    if (info.seg === 'silence' || info.seg === 'countin' || info.seg === 'fermata') return out;
    const rng = this.reactRng;
    const lead = this.leadFor(info);
    if (this.active.drums && !info.flags.dropdown) {
      const hits = this.drums.react({ time, ioi, vel, strong, downbeat, style: this.style.id, intensity: this.intensity, rng });
      for (const h of hits) out.push({ time: t, dur: 0.5, inst: 'kit', drum: h.drum, vel: h.vel, ch: 'drums' });
    }
    if (this.active.piano && lead !== 'piano' && !(info.seg === 'trade' && info.soloist === 'drums')) {
      const ns = this.piano.react({ time, ioi, vel, chord, style: this.style, rng });
      for (const n of ns) out.push({ time: t + n.delay, dur: n.dur, inst: this.style.inst.piano, midi: n.midi, vel: n.vel, ch: 'piano' });
    }
    return out;
  }

  // ------------------------------------------------------------------ bar generation
  private processInputs(cutoff: number) {
    const due = this.inputs.filter((i) => i.time <= cutoff);
    this.inputs = this.inputs.filter((i) => i.time > cutoff);
    for (const i of due) {
      if (i.k !== 'tap') continue;
      this.tapCount++;
      for (const j of JOIN_AT) if (this.tapCount === j.taps) this.joinQueue.push(j.part);
      if (this.tapCount >= SESSION_AT && !this.sessionReached) this.pendingSession = true;
      if (this.pendingEnd === 'idle') this.pendingEnd = null;
      if (this.laidOut) {
        this.laidOut = false;
        this.reentry = true;
      }
    }
    // idle: nobody tapping for a while -> wrap the tune up
    const idle = cutoff - this.lastTapAt;
    if (idle > IDLE_END && !this.pendingEnd && (this.mode === 'song' || this.mode === 'buildup') && !this.replaying) this.pendingEnd = 'idle';
    const bps = this.curBpm / 60;
    this.listener.update(cutoff, bps);
    const fresh = this.listener.takeFresh();
    if (fresh) this.soloist.userMotif = fresh;
    this.readTaps(cutoff);
  }

  private fx(text: string) {
    this.hooks.emit({ type: 'fx', text, time: this.hooks.now() });
  }

  /**
   * Gestures read from the tap stream ("the tune follows your hands"):
   *  - steady taps            -> the band follows your tempo
   *  - a fast flurry          -> double time for four bars
   *  - stop for a bar         -> breakdown; the next tap brings the band back with a crash
   *  - mostly off-beat taps   -> reharmonized (spicier) changes; on-beat taps bring them back
   *  - three quick taps, stop -> modulate up a fourth
   */
  private readTaps(cutoff: number) {
    if (this.mode !== 'song' && this.mode !== 'buildup') return;
    const all = this.listener.taps;
    const taps = all.filter((t) => t.time <= cutoff);
    if (!taps.length) return;
    const barSec = (60 / this.curBpm) * 4;
    const last = taps[taps.length - 1];
    const b = this.abs;

    // 1. tempo follows steady taps
    const rec = taps.slice(-6);
    let offTempo = false;
    if (rec.length >= 5 && cutoff - last.time < barSec && last.time - this.lastTempoFx > barSec * 1.5) {
      const iois = rec.slice(1).map((t, i) => t.time - rec[i].time);
      const med = [...iois].sort((x, y) => x - y)[Math.floor(iois.length / 2)];
      if (med >= 0.3 && med <= 1.5 && iois.every((x) => Math.abs(x - med) < med * 0.1)) {
        const raw = 60 / med;
        const [lo, hi] = this.style.bpmRange;
        const c = [raw / 2, raw, raw * 2].filter((x) => x >= lo - 1 && x <= hi + 1).sort((x, y) => Math.abs(x - this.bpm) - Math.abs(y - this.bpm))[0];
        if (c !== undefined && Math.abs(c - this.bpm) / this.bpm > 0.05) {
          offTempo = true;
          this.bpm = Math.round(clamp(c, lo, hi));
          this.pendingTempo = null;
          this.lastTempoFx = last.time;
          this.fx(`— the band follows you · ${this.bpm} BPM`);
        }
      }
    }

    // 2. a flurry of taps -> double time
    if (this.active.drums && b - this.lastDt >= 8 && !this.laidOut) {
      const n = taps.filter((t) => t.time > cutoff - 1.2).length;
      if (n >= 7) {
        this.dtUntil = b + 4;
        this.lastDt = b;
        this.fx('— double time!');
      }
    }

    // 3. stop tapping for a bar -> breakdown
    const gap = cutoff - last.time;
    if (!this.laidOut && gap > barSec * 1.5 && gap < IDLE_END / 2 && b - this.lastLayout >= 6 && (this.active.bass || this.active.drums)) {
      const before = taps.filter((t) => t.time > last.time - barSec * 2).length;
      if (before >= 5) {
        this.laidOut = true;
        this.lastLayout = b;
        this.dtUntil = -1;
        this.fx('— breakdown · tap to bring the band back');
      }
    }

    // 4. syncopated taps -> reharmonize (a steady stream at another tempo is not syncopation)
    if (offTempo || last.time - this.lastTempoFx < barSec * 2) return this.readModulation(cutoff, b);
    const win = taps.filter((t) => t.time > cutoff - barSec * 2 && (t.rawBeat ?? -1) >= 0);
    if (win.length >= 4) {
      // clearly between the beats (a slightly late or early tap is still "on the beat")
      const off =
        win.filter((t) => {
          const f = t.rawBeat! - Math.floor(t.rawBeat!);
          return f > 0.3 && f < 0.7;
        }).length / win.length;
      if (this.harmLevel === 0 && off >= 0.6) {
        this.harmLevel = 1;
        this.fx('— off the beat · the changes get spicy');
      } else if (this.harmLevel === 1 && off <= 0.2) {
        this.harmLevel = 0;
        this.fx('— on the beat · back to the plain changes');
      }
    }

    this.readModulation(cutoff, b);
  }

  // 5. three quick taps, then nothing -> modulate up a fourth
  private readModulation(cutoff: number, b: number) {
    const all = this.listener.taps;
    if (all.length >= 3 && this.pendingKey === null && b - this.lastModAbs >= 8) {
      const [t1, t2, t3] = all.slice(-3);
      const pre = all[all.length - 4];
      if (t3.time !== this.lastModTap && t2.time - t1.time < 0.2 && t3.time - t2.time < 0.2 && (!pre || t1.time - pre.time > 0.6) && cutoff - t3.time > 0.35) {
        this.lastModTap = t3.time;
        this.lastModAbs = b;
        this.pendingKey = pc(this.key + 5);
        this.fx(`— modulation → ${NOTE_NAMES[this.pendingKey]}`);
      }
    }
  }

  /** Apply the tap-driven state to a live bar. */
  private decorate(info: BarInfo) {
    const live = info.seg === 'buildup' || info.seg === 'head' || info.seg === 'solo' || info.seg === 'trade' || info.seg === 'headOut';
    if (!live || info.flags.modulate) return;
    if (this.laidOut) {
      info.flags.dropdown = true;
      delete info.flags.doubleTime;
      delete info.flags.stopTime;
    } else if (info.abs < this.dtUntil && this.active.drums) info.flags.doubleTime = true;
  }

  private generateBar() {
    const b = this.abs;
    const T = this.nextBarTime;
    this.processInputs(T - LOOK);
    if (!this.infos.has(b)) this.planInto(b);
    const info = this.infos.get(b)!;
    this.decorate(info);
    if (this.reentry) {
      this.reentry = false;
      if (info.flags.dropdown) {
        delete info.flags.dropdown;
        info.flags.crash = true;
        this.fx('— and the band is back!');
      }
    }
    // activate a pending join on this downbeat
    if (this.pendingJoin && this.pendingJoin.abs <= b) {
      const p = this.pendingJoin.part;
      this.active[p] = true;
      this.joinedCount++;
      this.pendingJoin = null;
      this.hooks.emit({ type: 'join', part: p, time: T });
    }
    // queue the next join (one at a time, entering on the next downbeat)
    if (!this.pendingJoin && this.joinQueue.length && (info.seg === 'buildup' || info.seg === 'head' || info.seg === 'solo' || info.seg === 'headOut')) {
      const part = this.joinQueue.shift()!;
      info.flags.joinNext = part;
      this.pendingJoin = { part, abs: b + 1 };
    }
    this.planInto(b + 1);
    const next = this.infos.get(b + 1)!;
    const prev = this.infos.get(b - 1) ?? null;

    // intensity
    const target = this.intensityTarget(info, T);
    this.intensity += (target - this.intensity) * 0.35;
    const I = this.intensity;

    // tempo
    if (this.pendingTempo !== null) {
      this.bpm = this.pendingTempo;
      this.pendingTempo = null;
    }
    const push = 1 + 0.015 * Math.max(0, I - 0.6) / 0.4;
    let bpm0 = this.curBpm;
    let bpm1 = bpm0 + (this.bpm * push - bpm0) * 0.5;
    if (info.flags.rit) bpm1 = bpm0 * info.flags.rit;
    if (info.seg === 'fermata') {
      bpm0 = bpm1 = 240 / 6;
    } else this.curBpm = bpm1;
    if (info.seg === 'silence') bpm0 = bpm1 = this.bpm;
    const timing = makeTiming(T, bpm0, bpm1);
    info.bpm = bpm0;
    this.timings.set(b, timing);

    // who leads this bar
    const lead = this.leadFor(info);
    if (lead !== this.lastLead) {
      this.hooks.emit({ type: 'lead', part: lead && info.seg !== 'head' && info.seg !== 'headOut' ? lead : null, time: T });
      this.lastLead = lead;
    }

    const base = (rng: Rng, active: boolean, leadEvs: Ev[]): PlayCtx => ({
      info,
      next,
      prev,
      style: this.style,
      intensity: I,
      rng,
      active,
      lead,
      leadEvs,
      activeParts: this.active,
    });

    // soloist first, so the compers can listen
    let leadEvs: Ev[] = [];
    if (lead && lead !== 'drums') {
      const kind = info.seg === 'fermata' ? 'fermata' : info.seg === 'head' ? 'head' : info.seg === 'headOut' ? 'headOut' : 'improv';
      const progress = info.seg === 'trade' ? 0.7 : info.seg === 'tag' ? 0.95 : info.flags.breakBand ? 0.45 : info.soloProgress;
      leadEvs = this.soloist.bar(base(this.prng.solo, true, []), lead, kind, {
        progress,
        density: info.seg === 'tag' ? 0.5 : lead === 'bass' ? 0.7 : 1,
      });
    } else if (!lead) {
      this.soloist.reset();
    }
    const parts: { id: PartId; evs: Ev[]; p: { feelKey: any; jitter: number } }[] = [];
    const pctx = (id: PartId) => base(this.prng[id], this.active[id], leadEvs);
    parts.push({ id: 'bass', evs: this.bass.bar(pctx('bass')), p: this.bass });
    parts.push({ id: 'drums', evs: this.drums.bar(pctx('drums')), p: this.drums });
    parts.push({ id: 'piano', evs: this.piano.bar(pctx('piano')), p: this.piano });
    parts.push({ id: 'guitar', evs: this.guitar.bar(pctx('guitar')), p: this.guitar });
    parts.push({ id: 'perc', evs: this.perc.bar(pctx('perc')), p: this.perc });

    const human = this.prng.human;
    const all: ScheduledNote[] = [];
    const hctx = { timing, style: this.style, bpm: bpm0, intensity: I, rng: human, doubleTime: !!info.flags.doubleTime };
    for (const p of parts) {
      if (!p.evs.length) continue;
      const swingAmt = p.id === 'bass' ? 0.9 : p.id === 'drums' || p.id === 'perc' ? 1 : 0.95;
      all.push(...humanize(p.evs, { ...hctx, ch: p.id, feelKey: p.p.feelKey, jitterMs: p.p.jitter, swingAmt, legato: p.id === 'bass' ? 1 : 0.96 }));
    }
    if (leadEvs.length && lead) {
      // the melody / soloist sits on top of the band
      const lifted = humanize(leadEvs, { ...hctx, ch: lead, feelKey: 'solo', jitterMs: this.soloist.jitter, swingAmt: 0.85 });
      for (const n of lifted) n.vel = Math.min(1, n.vel * 1.22);
      all.push(...lifted);
    }
    all.sort((a, b2) => a.time - b2.time);
    this.hooks.play(all);
    this.hooks.emit({ type: 'notes', notes: all });
    this.hooks.emit({
      type: 'bar',
      info,
      intensity: I,
      time: T,
      chord: info.chords.map((c) => chordName(c.chord)).join('  '),
      drumMode: this.drums.mode,
      tapCount: this.tapCount,
      upcoming: [next.chords, ...this.peekBars(3)],
    });

    if (info.seg === 'fermata') this.hooks.emit({ type: 'applause', time: timing.end - 0.6, big: true });
    if (info.seg === 'solo' && info.segBar === info.segLen - 1 && I > 0.55) this.hooks.emit({ type: 'applause', time: timing.end, big: false });

    this.nextBarTime = timing.end;
    this.abs++;
    // housekeeping
    this.infos.delete(b - 4);
    this.timings.delete(b - 4);

    if (this.mode === 'rest' || this.mode === 'idle') {
      this.running = false;
      if (this.mode === 'rest') this.hooks.emit({ type: 'rest', time: timing.end });
    }
  }
  private pendingJoin: { part: PartId; abs: number } | null = null;

  private leadFor(info: BarInfo): PartId | null {
    const head = this.style.headPart;
    if (info.seg === 'head' || info.seg === 'headOut') return this.active[head] ? head : null;
    if (info.seg === 'fermata' || info.seg === 'tag') return this.active[head] ? head : null;
    if (info.seg === 'solo' || info.seg === 'trade') return info.soloist ?? null;
    if (info.flags.breakBand && info.soloist) return info.soloist;
    return null;
  }

  private intensityTarget(info: BarInfo, now: number): number {
    let t: number;
    switch (info.seg) {
      case 'buildup':
        t = 0.2 + 0.06 * this.joinedCount;
        break;
      case 'head':
        t = 0.42;
        break;
      case 'headOut':
        t = info.section === 'B' ? 0.62 : 0.55;
        break;
      case 'solo': {
        const p = info.soloProgress;
        t = 0.36 + 0.54 * smoothstep(0, 0.75, p) - 0.3 * smoothstep(0.84, 1, p);
        if (info.soloist === 'bass') t *= 0.6;
        break;
      }
      case 'trade':
        t = 0.8;
        break;
      case 'tag':
        t = 0.5;
        break;
      case 'fermata':
        t = 0.7;
        break;
      default:
        t = 0.4;
    }
    if (info.flags.dropdown) t = 0.18;
    const rate = this.listener.rate(now - LOOK);
    t += 0.28 * Math.min(1, rate / 2.5);
    if (now - this.lastTapAt > 20) t -= 0.08;
    return clamp(t, 0.05, 1);
  }

  // ------------------------------------------------------------------ planning
  private chorusChart(chorus: number, amount: number): BarChord[][] {
    const k = `${this.key}:${chorus}:${amount}`;
    let c = this.chorusCache.get(k);
    if (!c) {
      const r = new Rng((this.seed ^ (chorus * 7919) ^ (this.songCount * 104729)) >>> 0);
      const rel = amount > 0 ? reharmonize(this.chart, r, amount, this.style.id) : this.chart.bars;
      c = transpose(rel, this.key);
      this.chorusCache.set(k, c);
    }
    return c;
  }
  private songCount = 0;

  private changeStyle(s: StyleId, _time: number) {
    this.style = STYLES[s];
    this.key = this.style.key;
    this.bpm = this.style.bpm;
    this.chart = buildChart(this.style, this.prng.form);
    this.chorusCache.clear();
    this.piano.reset();
    this.guitar.reset();
    this.hooks.emit({ type: 'style', style: s, key: this.key, bpm: this.bpm, time: this.nextBarTime });
  }

  private startSong() {
    this.songCount++;
    this.chart = buildChart(this.style, this.prng.form);
    this.chorusCache.clear();
    const formLen = this.chart.bars.length;
    const rng = this.prng.form;
    const segs: SegPlan[] = [];
    const short = formLen < 20;
    segs.push({ seg: 'head', bars: formLen * (short ? 2 : 1) });
    const soloists = this.style.soloOrder.filter((s) => rng.chance(s.p)).map((s) => s.part);
    for (const s of soloists) {
      const ch = s === 'bass' ? (short ? 2 : 1) : formLen >= 32 ? (rng.chance(0.35) ? 2 : 1) : formLen >= 16 ? rng.int(2, 3) : rng.int(2, 4);
      segs.push({ seg: 'solo', bars: formLen * ch, soloist: s });
    }
    if (rng.chance(0.75)) {
      const traders = soloists.filter((s) => s !== 'bass').slice(0, 2);
      if (traders.length) segs.push({ seg: 'trade', bars: formLen * (short ? 2 : 1), traders });
    }
    segs.push({ seg: 'headOut', bars: formLen * (short ? 2 : 1) });
    this.segs = segs;
    this.songLen = segs.reduce((a, s) => a + s.bars, 0);
    this.songBar = 0;
    this.breakSeg = -1;
    this.drama = null;
    const chart0 = transpose(this.chart.bars, this.key);
    this.soloist.head = this.soloist.composeHead(chart0, this.chart.sections, this.style.id, this.style.inst[this.style.headPart], rng.fork('head' + this.songCount));
    this.mode = 'song';
    this.hooks.emit({ type: 'song', time: this.nextBarTime, form: this.chart.name });
  }

  private planInto(abs: number) {
    if (this.infos.has(abs)) return;
    const info = this.planBar(abs);
    this.decorate(info);
    this.infos.set(abs, info);
  }

  private mkInfo(abs: number, chords: BarChord[], o: Partial<BarInfo>): BarInfo {
    return {
      abs,
      chords,
      formBar: 0,
      formLen: this.chart.bars.length,
      section: 'A',
      seg: 'buildup',
      segBar: 0,
      segLen: 1,
      chorus: 0,
      soloProgress: 0,
      compLead: this.compLead,
      flags: {},
      key: this.key,
      style: this.style.id,
      bpm: this.curBpm,
      ...o,
    };
  }

  private planBar(abs: number): BarInfo {
    // --- key change through the new key's dominant
    if (this.pendingKey !== null && (this.mode === 'song' || this.mode === 'buildup')) {
      const k = this.pendingKey;
      this.pendingKey = null;
      this.key = k;
      this.chorusCache.clear();
      if (this.mode === 'song') {
        const chart0 = transpose(this.chart.bars, this.key);
        this.soloist.head = this.soloist.composeHead(chart0, this.chart.sections, this.style.id, this.style.inst[this.style.headPart], this.prng.form.fork('key' + k));
      }
      this.hooks.emit({ type: 'style', style: this.style.id, key: k, bpm: this.bpm, time: this.nextBarTime });
      return this.mkInfo(abs, [
        { beat: 0, chord: { root: pc(k + 2), q: 'm7' } },
        { beat: 2, chord: { root: pc(k + 7), q: '7' } },
      ], { seg: this.mode === 'song' ? 'solo' : 'buildup', flags: { modulate: true, fill: 0.4 }, formBar: 7, section: 'T' });
    }

    // --- style switch: wait for a phrase end, then break + kime, new groove
    if (this.pendingStyle && (this.mode === 'song' || this.mode === 'buildup')) {
      const fb = this.mode === 'song' ? this.songBar % this.chart.bars.length : this.buildBar % 8;
      if (fb % 4 === 3) {
        this.pendingStyle = false;
        const chords = this.mode === 'song' ? this.chorusChart(0, 0)[fb] : transpose(this.chart.bars, this.key)[fb];
        const info = this.mkInfo(abs, chords, { seg: 'switch', formBar: fb, flags: { kime: true } });
        const wasSong = this.mode === 'song';
        this.changeStyle(nextStyle(this.style.id), 0);
        if (wasSong) this.startSong();
        else {
          this.mode = 'buildup';
          this.buildBar = 0;
        }
        return info;
      }
    }

    switch (this.mode) {
      case 'buildup': {
        if (this.pendingEnd && this.buildBar % 4 === 0) return this.enterTag(abs);
        if (this.pendingSession && this.buildBar % 4 === 0 && this.buildBar > 0 && PARTS.every((p) => this.active[p])) {
          this.pendingSession = false;
          this.sessionReached = true;
          this.hooks.emit({ type: 'session', time: this.nextBarTime });
          this.startSong();
          return this.planBar(abs);
        }
        const fb = this.buildBar % 8;
        const bars = this.buildupBars();
        this.buildBar++;
        if (fb === 0) this.compLead = this.prng.form.chance(this.style.id === 'bossa' ? 0.25 : 0.5) ? 'piano' : 'guitar';
        const nextIsSong = this.pendingSession && this.buildBar % 4 === 0 && PARTS.every((p) => this.active[p]);
        return this.mkInfo(abs, bars[fb], {
          seg: 'buildup',
          formBar: fb,
          formLen: 8,
          section: this.chart.sections[fb],
          compLead: this.compLead,
          flags: nextIsSong ? { fill: 0.75 } : {},
        });
      }
      case 'song':
        return this.planSongBar(abs);
      case 'tag':
        return this.planTag(abs);
      case 'fermata': {
        this.mode = 'silence';
        this.silenceLeft = 2;
        const fin = transpose(parseTemplate(this.style.finalChord), this.key)[0];
        return this.mkInfo(abs, fin, { seg: 'fermata', formBar: 0 });
      }
      case 'silence': {
        this.silenceLeft--;
        const info = this.mkInfo(abs, [{ beat: 0, chord: { root: this.key, q: 'maj7' } }], { seg: 'silence' });
        if (this.silenceLeft <= 0) {
          if (this.pendingEnd === 'reset') {
            this.pendingEnd = null;
            this.fullReset(this.nextBarTime);
          } else if (this.pendingEnd === 'idle' || this.replayEndedIdle()) {
            this.pendingEnd = null;
            this.mode = 'rest';
          } else {
            this.mode = 'countin';
            // next tune: new key, sometimes a new style
            if (this.prng.form.chance(0.35)) this.changeStyle(nextStyle(this.style.id), 0);
            else {
              this.key = this.prng.form.pick(this.style.keys);
              this.hooks.emit({ type: 'style', style: this.style.id, key: this.key, bpm: this.bpm, time: this.nextBarTime });
            }
            this.chorusCache.clear();
          }
        }
        return info;
      }
      case 'countin': {
        this.startSong();
        this.mode = 'song';
        const bars = this.chorusChart(0, 0);
        return this.mkInfo(abs, bars[bars.length - 1], { seg: 'countin' });
      }
      default:
        return this.mkInfo(abs, [{ beat: 0, chord: { root: this.key, q: 'maj7' } }], { seg: 'silence' });
    }
  }

  private segAt(s: number): { i: number; acc: number } {
    let acc = 0;
    let i = 0;
    for (; i < this.segs.length; i++) {
      if (s < acc + this.segs[i].bars) break;
      acc += this.segs[i].bars;
    }
    return { i, acc };
  }

  /** Reharmonization amount for a segment, pushed up by off-beat tapping. */
  private amountFor(seg: SegPlan['seg']): number {
    const head = seg === 'head' || seg === 'headOut';
    const base = head ? 0 : seg === 'trade' ? 0.35 : 0.42;
    return this.harmLevel ? Math.min(0.9, base + (head ? 0.3 : 0.4)) : base;
  }

  private buildupBars(): BarChord[][] {
    return this.harmLevel ? this.chorusChart(0, 0.45) : transpose(this.chart.bars, this.key);
  }

  /** Chords of the bars after the next planned one (a forecast; taps can still change them). */
  private peekBars(count: number): BarChord[][] {
    const out: BarChord[][] = [];
    if (this.mode === 'song') {
      const formLen = this.chart.bars.length;
      for (let k = 0; k < count; k++) {
        const s = this.songBar + k;
        if (s >= this.songLen) break;
        const seg = this.segs[this.segAt(s).i];
        out.push(this.chorusChart(Math.floor(s / formLen), this.amountFor(seg.seg))[s % formLen]);
      }
    } else if (this.mode === 'buildup') {
      const bars = this.buildupBars();
      for (let k = 0; k < count; k++) out.push(bars[(this.buildBar + k) % 8]);
    } else if (this.mode === 'tag') {
      const len = this.tagTpl.length * 3;
      for (let k = 0; k < count && this.tagBar + k < len; k++) out.push(this.tagTpl[(this.tagBar + k) % this.tagTpl.length]);
    }
    return out;
  }

  /** Bar and beat at an audio time (for the chord display). */
  position(time: number): { abs: number; beat: number } | null {
    const bar = this.barAt(time);
    return bar ? { abs: bar.info.abs, beat: timeToBeat(bar.timing, time) } : null;
  }

  private replayEndedIdle() {
    return false;
  }

  private enterTag(abs: number): BarInfo {
    this.mode = 'tag';
    this.laidOut = false;
    this.dtUntil = -1;
    this.tagBar = 0;
    const tpl = this.prng.form.pick(this.style.tags);
    this.tagTpl = transpose(parseTemplate(tpl), this.key);
    return this.planTag(abs);
  }

  private planTag(abs: number): BarInfo {
    const reps = 3;
    const len = this.tagTpl.length * reps;
    const i = this.tagBar++;
    const chords = this.tagTpl[i % this.tagTpl.length];
    const flags: BarInfo['flags'] = {};
    if (i >= len - 2) flags.rit = i === len - 1 ? 0.72 : 0.88;
    if (i === len - 1) flags.fill = 0.6;
    if (this.tagBar >= len) this.mode = 'fermata';
    return this.mkInfo(abs, chords, { seg: 'tag', formBar: i, formLen: len, section: 'T', segBar: i, segLen: len, flags });
  }

  private planSongBar(abs: number): BarInfo {
    const formLen = this.chart.bars.length;
    const s = this.songBar;
    // early ending requested: leave at the next 8-bar boundary
    if (this.pendingEnd && s % 8 === 0 && s > 0) return this.enterTag(abs);
    if (s >= this.songLen) return this.enterTag(abs);
    const { i: segIdx, acc } = this.segAt(s);
    const seg = this.segs[segIdx];
    const segBar = s - acc;
    const formBar = s % formLen;
    const chorus = Math.floor(s / formLen);
    const chords = this.chorusChart(chorus, this.amountFor(seg.seg))[formBar];
    this.songBar++;
    const rng = this.prng.form;
    if (formBar % 8 === 0) this.compLead = rng.chance(this.style.id === 'bossa' ? 0.25 : 0.5) ? 'piano' : 'guitar';
    let soloist = seg.soloist;
    if (seg.seg === 'trade' && seg.traders) {
      const u = Math.floor(segBar / 4);
      soloist = u % 2 === 0 ? seg.traders[(u / 2) % seg.traders.length] : 'drums';
    }
    const flags: BarInfo['flags'] = {};
    if (segBar === 0 && segIdx > 0) flags.crash = true;
    if (segBar === seg.bars - 1) flags.fill = 0.8;
    let soloProgress = seg.seg === 'solo' ? segBar / seg.bars : 0;

    // break: the next soloist plays 2 bars alone before the solo starts
    const nextSeg = this.segs[segIdx + 1];
    if (nextSeg && (nextSeg.seg === 'solo' || nextSeg.seg === 'trade') && seg.seg === 'solo' && segBar >= seg.bars - 2) {
      if (segBar === seg.bars - 2 && this.breakSeg !== segIdx && rng.chance(0.35)) this.breakSeg = segIdx;
      if (this.breakSeg === segIdx) {
        flags.breakBand = true;
        flags.fill = 0;
        soloist = nextSeg.soloist ?? nextSeg.traders?.[0];
        soloProgress = 0;
      }
    }

    // drama, used sparingly
    if (this.drama && abs >= this.drama.until) this.drama = null;
    if (!this.drama && seg.seg === 'solo' && formBar % 8 === 0 && abs - this.lastDrama >= 16 && segBar < seg.bars - 8 && soloist !== 'bass') {
      const p = soloProgress;
      const I = this.intensity;
      const r = rng.next();
      if (p < 0.4 && segBar > 0 && r < 0.18) this.drama = { type: 'dropdown', until: abs + 8 };
      else if (r < 0.27) this.drama = { type: 'stopTime', until: abs + 4 };
      else if (p > 0.45 && p < 0.85 && I > 0.6 && r < 0.5) this.drama = { type: 'doubleTime', until: abs + 8 };
      if (this.drama) this.lastDrama = abs;
    }
    if (!this.drama && seg.seg === 'solo' && formBar % 8 === 4 && this.chart.sections[formBar] === 'A' && abs - this.lastDrama >= 16 && rng.chance(0.14)) {
      this.drama = { type: 'pedal', until: abs + 4 };
      this.lastDrama = abs;
    }
    if (this.drama) {
      if (this.drama.type === 'pedal') flags.pedal = pc(this.key + 7);
      else flags[this.drama.type] = true;
    }
    if (seg.seg === 'solo' && formBar % 8 === 7 && soloProgress > 0.6 && soloProgress < 0.9 && !this.drama && rng.chance(0.15)) flags.kime = true;
    if (seg.seg === 'headOut' && segBar === seg.bars - 1 && rng.chance(0.3)) flags.kime = true;

    return this.mkInfo(abs, chords, {
      seg: seg.seg,
      formBar,
      formLen,
      section: this.chart.sections[formBar],
      segBar,
      segLen: seg.bars,
      chorus,
      soloist,
      soloProgress,
      compLead: this.compLead,
      flags,
    });
  }

  private fullReset(time: number) {
    this.running = false;
    this.mode = 'idle';
    this.tapCount = 0;
    this.joinedCount = 0;
    this.sessionReached = false;
    this.pendingSession = false;
    this.pendingStyle = false;
    this.pendingEnd = null;
    this.joinQueue = [];
    this.pendingJoin = null;
    for (const p of PARTS) this.active[p] = false;
    this.listener.reset();
    this.soloist.reset();
    this.bass.reset();
    this.drums.reset();
    this.piano.reset();
    this.guitar.reset();
    this.intensity = 0.25;
    this.laidOut = false;
    this.reentry = false;
    this.harmLevel = 0;
    this.dtUntil = -1;
    this.hooks.emit({ type: 'reset', time });
  }

  /** Current bar info for UI/debug. */
  currentInfo(): BarInfo | null {
    const now = this.hooks.now();
    return this.barAt(now)?.info ?? null;
  }
}
