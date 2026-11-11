// Instruments: multi-zone buffer players with velocity layers, round robin and
// progressive loading. Piano uses the Salamander Grand Piano samples (CC-BY 3.0);
// everything else is rendered in-browser by dsp.ts.
import type { DrumId, InstId, ScheduledNote } from '../music/types';
import { Rng } from '../util/rng';
import {
  renderArchtop,
  renderDrum,
  renderEBass,
  renderEGuitar,
  renderFlute,
  renderNylon,
  renderPianoSynth,
  renderRhodes,
  renderUpright,
  renderVibes,
  type ToneRender,
} from './dsp';

const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

interface Zone {
  midi: number;
  layers: AudioBuffer[][]; // [layer][roundRobin]
}

interface InstSpec {
  render?: ToneRender;
  lo: number;
  hi: number;
  step: number;
  layers: number[]; // velocities to render
  rr: number;
  sr: number;
  gain: number;
  release: number;
  /** Velocity-dependent lowpass (third "layer"); 0 disables. */
  bright: [number, number];
  maxVoices: number;
}

export const SPECS: Record<Exclude<InstId, 'kit'>, InstSpec> = {
  piano: { render: renderPianoSynth, lo: 33, hi: 96, step: 3, layers: [0.45, 0.85], rr: 1, sr: 32000, gain: 0.85, release: 0.35, bright: [1800, 12000], maxVoices: 40 },
  upright: { render: renderUpright, lo: 28, hi: 61, step: 3, layers: [0.45, 0.9], rr: 2, sr: 32000, gain: 1.15, release: 0.12, bright: [700, 3500], maxVoices: 4 },
  ebass: { render: renderEBass, lo: 28, hi: 61, step: 3, layers: [0.45, 0.9], rr: 2, sr: 32000, gain: 1.0, release: 0.08, bright: [900, 4000], maxVoices: 4 },
  archtop: { render: renderArchtop, lo: 40, hi: 84, step: 3, layers: [0.45, 0.9], rr: 2, sr: 32000, gain: 0.8, release: 0.12, bright: [1500, 6000], maxVoices: 24 },
  nylon: { render: renderNylon, lo: 40, hi: 84, step: 3, layers: [0.45, 0.9], rr: 2, sr: 32000, gain: 0.85, release: 0.15, bright: [1800, 8000], maxVoices: 24 },
  eguitar: { render: renderEGuitar, lo: 40, hi: 86, step: 3, layers: [0.45, 0.9], rr: 2, sr: 32000, gain: 0.85, release: 0.12, bright: [2000, 8000], maxVoices: 24 },
  rhodes: { render: renderRhodes, lo: 36, hi: 90, step: 4, layers: [0.4, 0.9], rr: 1, sr: 32000, gain: 0.62, release: 0.25, bright: [2500, 10000], maxVoices: 36 },
  vibes: { render: renderVibes, lo: 53, hi: 90, step: 4, layers: [0.5, 0.9], rr: 1, sr: 32000, gain: 0.7, release: 0.5, bright: [3000, 12000], maxVoices: 20 },
  flute: { render: renderFlute, lo: 58, hi: 96, step: 4, layers: [0.6], rr: 1, sr: 32000, gain: 0.55, release: 0.12, bright: [3000, 9000], maxVoices: 6 },
};

const DRUM_GAIN: Record<DrumId, number> = {
  ride: 0.42,
  rideBell: 0.38,
  crash: 0.45,
  hhClosed: 0.4,
  hhPedal: 0.42,
  hhOpen: 0.36,
  snare: 0.6,
  rim: 0.55,
  brushTap: 0.75,
  brushSweep: 0.55,
  kick: 0.9,
  tomHi: 0.5,
  tomMid: 0.55,
  tomLo: 0.6,
  shaker: 0.95,
  snap: 1.0,
  clap: 0.85,
  stick: 0.4,
};
const DRUM_IDS = Object.keys(DRUM_GAIN) as DrumId[];

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  end: number;
}

export class BufferInstrument {
  zones: Zone[] = [];
  ready = false;
  private voices: Voice[] = [];
  private rr = 0;

  constructor(
    private ctx: AudioContext,
    readonly id: InstId,
    readonly spec: InstSpec,
  ) {}

  async renderAll(seed: number) {
    const sp = this.spec;
    const rng = new Rng(seed);
    for (let m = sp.lo; m <= sp.hi; m += sp.step) {
      const layers: AudioBuffer[][] = [];
      for (const v of sp.layers) {
        const rrs: AudioBuffer[] = [];
        for (let r = 0; r < sp.rr; r++) {
          const data = sp.render!(sp.sr, m, v, rng.fork(`${m}:${v}:${r}`));
          const b = this.ctx.createBuffer(1, data.length, sp.sr);
          b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
          rrs.push(b);
        }
        layers.push(rrs);
      }
      this.zones.push({ midi: m, layers });
      await yieldToMain();
    }
    this.ready = true;
  }

  /** Use externally loaded samples (one layer). */
  setZones(z: { midi: number; buf: AudioBuffer }[]) {
    this.zones = z.sort((a, b) => a.midi - b.midi).map((x) => ({ midi: x.midi, layers: [[x.buf]] }));
    this.ready = this.zones.length > 0;
  }

  play(n: ScheduledNote, out: AudioNode) {
    if (!this.ready || n.midi === undefined) return;
    const ctx = this.ctx;
    const sp = this.spec;
    const t = Math.max(n.time, ctx.currentTime + 0.002);
    // nearest zone
    let z = this.zones[0];
    for (const zz of this.zones) if (Math.abs(zz.midi - n.midi) < Math.abs(z.midi - n.midi)) z = zz;
    const layerIdx = z.layers.length === 1 ? 0 : Math.min(z.layers.length - 1, Math.floor(n.vel * z.layers.length * 1.05));
    const rrs = z.layers[layerIdx];
    const buf = rrs[this.rr++ % rrs.length];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const detune = (Math.random() - 0.5) * 6; // cents: tiny round-robin difference
    const rate = Math.pow(2, (n.midi - z.midi) / 12 + detune / 1200);
    if (n.slideFrom !== undefined) {
      const r0 = Math.pow(2, (n.slideFrom - z.midi) / 12);
      src.playbackRate.setValueAtTime(r0, t);
      src.playbackRate.exponentialRampToValueAtTime(rate, t + 0.07);
    } else src.playbackRate.value = rate;
    const g = ctx.createGain();
    const amp = sp.gain * Math.pow(n.vel, 1.4) * (0.95 + Math.random() * 0.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.002);
    const end = t + Math.max(0.04, n.dur);
    g.gain.setValueAtTime(amp, end);
    g.gain.setTargetAtTime(0, end, sp.release / 4);
    let node: AudioNode = src;
    if (sp.bright[0] > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.5;
      f.frequency.value = sp.bright[0] + (sp.bright[1] - sp.bright[0]) * n.vel * n.vel * (0.9 + Math.random() * 0.2);
      src.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(out);
    const stopAt = end + sp.release * 1.6 + 0.05;
    src.start(t);
    src.stop(Math.min(stopAt, t + buf.duration / rate + 0.05));
    const v: Voice = { src, gain: g, end: stopAt };
    src.onended = () => {
      g.disconnect();
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
    };
    this.voices.push(v);
    // voice stealing
    if (this.voices.length > sp.maxVoices) {
      const old = this.voices.shift()!;
      try {
        old.gain.gain.cancelScheduledValues(t);
        old.gain.gain.setTargetAtTime(0, t, 0.02);
        old.src.stop(t + 0.1);
      } catch {
        /* already stopped */
      }
    }
  }
}

export class DrumKit {
  bufs = new Map<DrumId, AudioBuffer[]>();
  ready = false;
  private rr = 0;
  private openHat: { src: AudioBufferSourceNode; g: GainNode } | null = null;

  constructor(private ctx: AudioContext) {}

  async renderAll(seed: number) {
    const rng = new Rng(seed);
    const sr = this.ctx.sampleRate;
    for (const id of DRUM_IDS) {
      const variants = id === 'brushSweep' || id === 'crash' ? 2 : 3;
      const arr: AudioBuffer[] = [];
      for (let v = 0; v < variants; v++) {
        const data = renderDrum(id, sr, rng.fork(id + v));
        const b = this.ctx.createBuffer(1, data.length, sr);
        b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        arr.push(b);
      }
      this.bufs.set(id, arr);
      await yieldToMain();
    }
    this.ready = true;
  }

  play(n: ScheduledNote, out: AudioNode) {
    if (!this.ready || !n.drum) return;
    const ctx = this.ctx;
    const arr = this.bufs.get(n.drum);
    if (!arr) return;
    const t = Math.max(n.time, ctx.currentTime + 0.002);
    const buf = arr[this.rr++ % arr.length];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.02;
    const g = ctx.createGain();
    const amp = DRUM_GAIN[n.drum] * Math.pow(n.vel, 1.5) * (0.94 + Math.random() * 0.12);
    g.gain.value = amp;
    let node: AudioNode = src;
    if (n.vel < 0.5) {
      // softer hits are darker
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2500 + n.vel * 16000;
      src.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(out);
    let stop = t + buf.duration;
    if (n.drum === 'brushSweep') {
      const end = t + Math.min(buf.duration, Math.max(0.2, n.dur));
      g.gain.setValueAtTime(amp, end - 0.05);
      g.gain.linearRampToValueAtTime(0, end);
      stop = end + 0.01;
    }
    // hi-hat choke
    if (n.drum === 'hhClosed' || n.drum === 'hhPedal') {
      if (this.openHat) {
        this.openHat.g.gain.setTargetAtTime(0, t, 0.01);
        this.openHat = null;
      }
    }
    if (n.drum === 'hhOpen') this.openHat = { src, g };
    src.start(t);
    src.stop(stop);
    src.onended = () => g.disconnect();
  }
}

// ---------------------------------------------------------------- Salamander piano
// bundled with the app (public/samples/piano) so it works offline
const SAL_BASE = `${import.meta.env.BASE_URL}samples/piano/`;
const SAL_NOTES: [string, number][] = [];
{
  const names = ['C', 'Ds', 'Fs', 'A'];
  const pcs = [0, 3, 6, 9];
  for (let oct = 0; oct <= 7; oct++) for (let i = 0; i < 4; i++) {
    const midi = 12 * (oct + 1) + pcs[i];
    if (midi >= 21 && midi <= 108) SAL_NOTES.push([`${names[i]}${oct}`, midi]);
  }
  SAL_NOTES.push(['C8', 108]);
}

export async function loadSalamander(ctx: AudioContext, lo = 33, hi = 100, onProgress?: (f: number) => void): Promise<{ midi: number; buf: AudioBuffer }[]> {
  const list = SAL_NOTES.filter(([, m]) => m >= lo && m <= hi);
  let done = 0;
  const res = await Promise.all(
    list.map(async ([name, midi]) => {
      try {
        const r = await fetch(`${SAL_BASE}${name}.mp3`);
        if (!r.ok) throw new Error(String(r.status));
        const ab = await r.arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        return { midi, buf };
      } catch {
        return null;
      } finally {
        onProgress?.(++done / list.length);
      }
    }),
  );
  return res.filter((x): x is { midi: number; buf: AudioBuffer } => x !== null);
}
