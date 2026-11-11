// Offline DSP: renders instrument "samples" in plain JS (spec §4.5: synthesized
// substitutes when free samples are not available). Everything here is
// deterministic per seed, so round-robin variants differ but are reproducible.
import { Rng } from '../util/rng';

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- filters
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  static lp(f: number, q: number, sr: number) {
    return new Biquad().set('lp', f, q, sr);
  }
  static hp(f: number, q: number, sr: number) {
    return new Biquad().set('hp', f, q, sr);
  }
  static bp(f: number, q: number, sr: number) {
    return new Biquad().set('bp', f, q, sr);
  }
  static peak(f: number, q: number, db: number, sr: number) {
    return new Biquad().set('peak', f, q, sr, db);
  }

  set(type: 'lp' | 'hp' | 'bp' | 'peak', f: number, q: number, sr: number, db = 0): this {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * q);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      a0 = 1,
      a1 = 0,
      a2 = 0;
    if (type === 'lp') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'hp') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'bp') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else {
      const A = Math.pow(10, db / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  apply(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.run(buf[i]);
    return buf;
  }
}

export function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const g = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

/** Short fade in/out to avoid clicks. */
export function fades(buf: Float32Array, sr: number, inMs = 1, outMs = 30) {
  const ni = Math.floor((inMs / 1000) * sr);
  const no = Math.floor((outMs / 1000) * sr);
  for (let i = 0; i < ni && i < buf.length; i++) buf[i] *= i / ni;
  for (let i = 0; i < no && i < buf.length; i++) buf[buf.length - 1 - i] *= i / no;
  return buf;
}

/** Sum of decaying sine partials using recursive oscillators (fast). */
function partials(out: Float32Array, sr: number, list: { f: number; a: number; t60: number; delay?: number }[]) {
  for (const p of list) {
    if (p.f >= sr * 0.48) continue;
    const w = (2 * Math.PI * p.f) / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    let re = 1;
    let im = 0;
    const dec = Math.pow(0.001, 1 / (p.t60 * sr));
    let amp = p.a;
    const start = Math.floor((p.delay ?? 0) * sr);
    const n = Math.min(out.length, start + Math.ceil(p.t60 * sr * 1.2));
    for (let i = start; i < n; i++) {
      out[i] += amp * im;
      const r = re * c - im * s;
      im = re * s + im * c;
      re = r;
      amp *= dec;
    }
  }
}

// ---------------------------------------------------------------- Karplus-Strong
interface KSOpts {
  t60: number;
  bright: number; // excitation lowpass cutoff (Hz)
  pick: number; // pluck position 0..0.5
  damp: number; // 0..0.5 loss-filter averaging (0.5 = darkest)
  vel: number;
}

export function ks(sr: number, freq: number, dur: number, o: KSOpts, rng: Rng): Float32Array {
  const len = Math.floor(dur * sr);
  const out = new Float32Array(len);
  const s = o.damp;
  const D = sr / freq - s;
  const M = Math.ceil(D) + 4;
  const line = new Float32Array(M);
  // excitation: lowpassed noise with pluck-position comb
  const exc = new Float32Array(M);
  const lp = Biquad.lp(o.bright, 0.6, sr);
  for (let i = 0; i < M; i++) exc[i] = lp.run(rng.range(-1, 1));
  const pk = Math.max(1, Math.round(o.pick * D));
  for (let i = 0; i < M; i++) line[i] = exc[i] - (i >= pk ? exc[i - pk] : 0);
  const g = Math.pow(0.001, 1 / (o.t60 * freq));
  let w = 0;
  let prev = 0;
  for (let n = 0; n < len; n++) {
    let rp = w - D;
    while (rp < 0) rp += M;
    const i0 = Math.floor(rp);
    const fr = rp - i0;
    const x = line[i0 % M] * (1 - fr) + line[(i0 + 1) % M] * fr;
    const y = g * ((1 - s) * x + s * prev);
    prev = x;
    line[w] = y;
    out[n] = x;
    w = (w + 1) % M;
  }
  return out;
}

// ---------------------------------------------------------------- tonal instruments
export type ToneRender = (sr: number, midi: number, vel: number, rng: Rng) => Float32Array;

export const renderUpright: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const dur = 2.4;
  const out = ks(sr, f, dur, { t60: 2.2 - (midi - 28) * 0.02, bright: 700 + vel * 1500, pick: 0.18, damp: 0.5, vel }, rng);
  // growl: fast initial decay over a longer body
  for (let i = 0; i < out.length; i++) out[i] *= 0.5 + 0.5 * Math.exp(-i / (0.09 * sr));
  // finger thump
  const th = Biquad.lp(180, 0.8, sr);
  const tl = Math.floor(0.03 * sr);
  for (let i = 0; i < tl; i++) out[i] += th.run(rng.range(-1, 1)) * 0.9 * (1 - i / tl) * vel;
  Biquad.peak(95, 1.3, 7, sr).apply(out);
  Biquad.peak(210, 1.5, 4, sr).apply(out);
  Biquad.lp(1100 + vel * 900, 0.7, sr).apply(out);
  Biquad.hp(32, 0.7, sr).apply(out);
  return fades(normalize(out, 0.9), sr, 1, 80);
};

export const renderEBass: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const out = ks(sr, f, 2.6, { t60: 3.2, bright: 900 + vel * 2200, pick: 0.12, damp: 0.42, vel }, rng);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.6);
  Biquad.peak(80, 1, 5, sr).apply(out);
  Biquad.lp(1600 + vel * 1200, 0.8, sr).apply(out);
  Biquad.hp(30, 0.7, sr).apply(out);
  return fades(normalize(out, 0.9), sr, 1, 80);
};

function guitarBody(out: Float32Array, sr: number, nylon: boolean) {
  Biquad.peak(nylon ? 110 : 95, 1.2, 5, sr).apply(out);
  Biquad.peak(nylon ? 220 : 200, 1.4, 3, sr).apply(out);
  Biquad.peak(nylon ? 2600 : 1500, 0.9, nylon ? 2 : -3, sr).apply(out);
  Biquad.hp(70, 0.7, sr).apply(out);
}

export const renderArchtop: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const out = ks(sr, f, 2.0, { t60: 1.9, bright: 1200 + vel * 2200, pick: 0.2, damp: 0.48, vel }, rng);
  guitarBody(out, sr, false);
  Biquad.lp(2400 + vel * 1500, 0.7, sr).apply(out);
  return fades(normalize(out, 0.9), sr, 1, 60);
};

export const renderNylon: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const out = ks(sr, f, 2.2, { t60: 2.0, bright: 1400 + vel * 2600, pick: 0.15, damp: 0.45, vel }, rng);
  guitarBody(out, sr, true);
  Biquad.lp(3500 + vel * 2500, 0.6, sr).apply(out);
  return fades(normalize(out, 0.9), sr, 1, 60);
};

export const renderEGuitar: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const out = ks(sr, f, 2.6, { t60: 3.4, bright: 2200 + vel * 3000, pick: 0.13, damp: 0.38, vel }, rng);
  Biquad.peak(1800, 0.8, 3, sr).apply(out);
  Biquad.hp(90, 0.7, sr).apply(out);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.2);
  Biquad.lp(4200, 0.7, sr).apply(out);
  return fades(normalize(out, 0.9), sr, 1, 60);
};

export const renderRhodes: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const dur = 3.2;
  const len = Math.floor(dur * sr);
  const out = new Float32Array(len);
  const I0 = 0.6 + vel * 2.6 + Math.max(0, (60 - midi) * 0.02);
  const t60 = Math.max(1.2, 4.2 - (midi - 40) * 0.05);
  const dec = Math.pow(0.001, 1 / (t60 * sr));
  const w = (2 * Math.PI * f) / sr;
  const wt = (2 * Math.PI * f * 7.02) / sr;
  let amp = 1;
  const detune = 1 + rng.range(-0.0004, 0.0004);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const I = I0 * Math.exp(-t / 0.12) + 0.25 * vel;
    const mod = Math.sin(w * i * detune);
    const car = Math.sin(w * i + I * mod);
    const tine = Math.sin(wt * i) * 0.18 * vel * Math.exp(-t / 0.03);
    const atk = Math.min(1, i / (0.002 * sr));
    out[i] = (car + tine) * amp * atk;
    amp *= dec;
  }
  for (let i = 0; i < len; i++) out[i] = Math.tanh(out[i] * (0.8 + vel * 0.7));
  Biquad.lp(3000 + vel * 3000, 0.7, sr).apply(out);
  return fades(normalize(out, 0.85), sr, 0.5, 100);
};

export const renderVibes: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const len = Math.floor(3.2 * sr);
  const out = new Float32Array(len);
  partials(out, sr, [
    { f, a: 1, t60: 3.0 },
    { f: f * 3.99, a: 0.25 + vel * 0.2, t60: 0.9 },
    { f: f * 9.85, a: 0.08 + vel * 0.1, t60: 0.25 },
  ]);
  // mallet
  const hp = Biquad.bp(f * 6, 1.5, sr);
  const ml = Math.floor(0.006 * sr);
  for (let i = 0; i < ml; i++) out[i] += hp.run(rng.range(-1, 1)) * 0.3 * vel;
  // motor tremolo
  const rate = 5.2 + rng.range(-0.2, 0.2);
  for (let i = 0; i < len; i++) out[i] *= 1 - 0.22 * (0.5 + 0.5 * Math.sin((2 * Math.PI * rate * i) / sr));
  return fades(normalize(out, 0.85), sr, 0.5, 100);
};

export const renderFlute: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const len = Math.floor(3.4 * sr);
  const out = new Float32Array(len);
  const bp = Biquad.bp(Math.min(sr * 0.4, f * 2.5), 0.8, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const vib = t > 0.28 ? 0.004 * Math.min(1, (t - 0.28) * 2) * Math.sin(2 * Math.PI * 5.1 * t) : 0;
    ph += (2 * Math.PI * f * (1 + vib)) / sr;
    const env = Math.min(1, t / 0.05) * (0.9 + 0.1 * Math.sin(t * 1.3));
    const tone = Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.3) + 0.08 * Math.sin(3 * ph);
    const breath = bp.run(rng.range(-1, 1)) * (0.12 + 0.35 * Math.exp(-t / 0.04));
    out[i] = (tone * (0.7 + 0.3 * vel) + breath) * env;
  }
  Biquad.lp(6000, 0.7, sr).apply(out);
  return fades(normalize(out, 0.8), sr, 2, 120);
};

export const renderPianoSynth: ToneRender = (sr, midi, vel, rng) => {
  const f = mtof(midi);
  const len = Math.floor(3.0 * sr);
  const out = new Float32Array(len);
  const B = 0.00035;
  const list: { f: number; a: number; t60: number }[] = [];
  const baseT = Math.max(0.8, 6 - (midi - 30) * 0.075);
  for (let n = 1; n <= 14; n++) {
    const fn = n * f * Math.sqrt(1 + B * n * n);
    const a = Math.pow(n, -1.1 - (1 - vel) * 0.8);
    for (const d of [-0.6, 0, 0.7]) list.push({ f: fn * Math.pow(2, (d + rng.range(-0.2, 0.2)) / 1200), a: a / 3, t60: baseT / (1 + 0.25 * n) });
  }
  partials(out, sr, list);
  const hn = Biquad.bp(2500, 1, sr);
  const hl = Math.floor(0.008 * sr);
  for (let i = 0; i < hl; i++) out[i] += hn.run(rng.range(-1, 1)) * 0.15 * vel;
  return fades(normalize(out, 0.85), sr, 0.5, 100);
};

// ---------------------------------------------------------------- drums
export function renderDrum(id: string, sr: number, rng: Rng): Float32Array {
  const N = (s: number) => new Float32Array(Math.floor(s * sr));
  const noise = () => rng.range(-1, 1);
  switch (id) {
    case 'ride':
    case 'rideBell':
    case 'crash': {
      const crash = id === 'crash';
      const bell = id === 'rideBell';
      const dur = crash ? 3.5 : 3.0;
      const out = N(dur);
      const list: { f: number; a: number; t60: number }[] = [];
      const n = crash ? 70 : 55;
      for (let i = 0; i < n; i++) {
        const f = Math.exp(rng.range(Math.log(crash ? 1800 : 2600), Math.log(12000)));
        list.push({ f, a: rng.range(0.2, 1) / n, t60: rng.range(crash ? 1.2 : 0.9, crash ? 3.4 : 2.8) });
      }
      // stick "ping" / bell partials
      const bf = rng.range(520, 600) * (bell ? 1.4 : 1);
      for (const r of [1, 2.41, 3.62, 5.1]) list.push({ f: bf * r * 1.0, a: (bell ? 0.12 : 0.04) / r, t60: bell ? 1.8 : 0.9 });
      partials(out, sr, list);
      const hp = Biquad.hp(crash ? 600 : 900, 0.7, sr);
      const nl = Math.floor((crash ? 1.6 : 0.5) * sr);
      for (let i = 0; i < out.length; i++) {
        const nz = i < nl ? noise() * (crash ? 0.06 : 0.025) * Math.pow(1 - i / nl, 2) : 0;
        out[i] = hp.run(out[i] + nz);
      }
      // stick attack click
      const ck = Biquad.bp(5200, 1.2, sr);
      for (let i = 0; i < Math.floor(0.004 * sr); i++) out[i] += ck.run(noise()) * 0.3;
      if (crash) for (let i = 0; i < Math.floor(0.03 * sr); i++) out[i] *= i / (0.03 * sr) * 0.6 + 0.4;
      return fades(normalize(out, 0.85), sr, 0.2, 200);
    }
    case 'hhClosed':
    case 'hhOpen':
    case 'hhPedal': {
      const open = id === 'hhOpen';
      const pedal = id === 'hhPedal';
      const out = N(open ? 0.7 : 0.18);
      const list: { f: number; a: number; t60: number }[] = [];
      for (let i = 0; i < 30; i++) list.push({ f: Math.exp(rng.range(Math.log(5000), Math.log(13000))), a: rng.range(0.3, 1) / 30, t60: open ? rng.range(0.3, 0.6) : rng.range(0.04, 0.09) });
      partials(out, sr, list);
      const hp = Biquad.hp(pedal ? 3500 : 6000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const env = Math.exp(-i / ((open ? 0.18 : pedal ? 0.025 : 0.035) * sr));
        out[i] = hp.run(out[i] + noise() * 0.3 * env);
      }
      if (pedal) {
        const lp = Biquad.lp(250, 1, sr);
        for (let i = 0; i < Math.floor(0.02 * sr); i++) out[i] += lp.run(noise()) * 0.5 * (1 - i / (0.02 * sr));
      }
      return fades(normalize(out, 0.8), sr, 0.2, open ? 120 : 20);
    }
    case 'snare': {
      const out = N(0.4);
      partials(out, sr, [
        { f: 185 + rng.range(-5, 5), a: 0.5, t60: 0.18 },
        { f: 330, a: 0.25, t60: 0.1 },
      ]);
      const bp = Biquad.bp(3200, 0.7, sr);
      const hp = Biquad.hp(1200, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const env = Math.exp(-i / (0.07 * sr));
        out[i] += hp.run(bp.run(noise()) * 1.4 + noise() * 0.4) * env * 0.9;
      }
      return fades(normalize(out, 0.85), sr, 0.2, 40);
    }
    case 'rim': {
      const out = N(0.12);
      partials(out, sr, [
        { f: 1650 + rng.range(-40, 40), a: 0.6, t60: 0.04 },
        { f: 470, a: 0.5, t60: 0.06 },
        { f: 820, a: 0.3, t60: 0.05 },
      ]);
      const bp = Biquad.bp(3000, 1, sr);
      for (let i = 0; i < Math.floor(0.004 * sr); i++) out[i] += bp.run(noise()) * 0.8;
      return fades(normalize(out, 0.85), sr, 0.1, 20);
    }
    case 'stick': {
      const out = N(0.1);
      partials(out, sr, [
        { f: 2100, a: 0.6, t60: 0.03 },
        { f: 3300, a: 0.4, t60: 0.02 },
      ]);
      return fades(normalize(out, 0.8), sr, 0.1, 10);
    }
    case 'brushTap': {
      const out = N(0.22);
      const bp = Biquad.bp(rng.range(3500, 4500), 0.6, sr);
      const lp = Biquad.lp(7000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.05);
        out[i] = lp.run(bp.run(noise())) * env;
      }
      partials(out, sr, [{ f: 190, a: 0.05, t60: 0.12 }]);
      return fades(normalize(out, 0.75), sr, 0.2, 30);
    }
    case 'brushSweep': {
      const out = N(1.4);
      const bp = Biquad.bp(2800, 0.5, sr);
      const lp = Biquad.lp(5000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const env = Math.sin(Math.PI * Math.min(1, t / 1.3)) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 1.4 * t));
        out[i] = lp.run(bp.run(noise())) * env;
      }
      return fades(normalize(out, 0.5), sr, 10, 100);
    }
    case 'kick': {
      const out = N(0.6);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = 58 + 70 * Math.exp(-t / 0.03);
        ph += (2 * Math.PI * f) / sr;
        out[i] = Math.sin(ph) * Math.exp(-t / 0.22);
      }
      const lp = Biquad.lp(1500, 0.7, sr);
      for (let i = 0; i < Math.floor(0.006 * sr); i++) out[i] += lp.run(noise()) * 0.25;
      return fades(normalize(out, 0.9), sr, 0.2, 60);
    }
    case 'tomHi':
    case 'tomMid':
    case 'tomLo': {
      const base = id === 'tomHi' ? 210 : id === 'tomMid' ? 150 : 100;
      const out = N(0.8);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = base * (1 + 0.25 * Math.exp(-t / 0.04));
        ph += (2 * Math.PI * f) / sr;
        out[i] = Math.sin(ph) * Math.exp(-t / 0.28) + Math.sin(ph * 1.5) * 0.2 * Math.exp(-t / 0.1);
      }
      const bp = Biquad.bp(1800, 0.8, sr);
      for (let i = 0; i < Math.floor(0.01 * sr); i++) out[i] += bp.run(noise()) * 0.3;
      return fades(normalize(out, 0.85), sr, 0.2, 80);
    }
    case 'shaker': {
      const out = N(0.14);
      const hp = Biquad.hp(5000, 0.7, sr);
      const bp = Biquad.bp(8000, 0.8, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.025) * Math.exp(-Math.max(0, t - 0.025) / 0.03);
        out[i] = bp.run(hp.run(noise())) * env;
      }
      return fades(normalize(out, 0.6), sr, 0.5, 15);
    }
    case 'snap': {
      const out = N(0.12);
      const bp = Biquad.bp(2600, 1.8, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        out[i] = bp.run(noise()) * Math.exp(-t / 0.012);
      }
      partials(out, sr, [{ f: 1900, a: 0.15, t60: 0.03 }]);
      return fades(normalize(out, 0.8), sr, 0.1, 15);
    }
    case 'clap': {
      const out = N(0.35);
      const bp = Biquad.bp(1200, 1.1, sr);
      const hits = [0, 0.009 + rng.range(0, 0.003), 0.019 + rng.range(0, 0.004), 0.027 + rng.range(0, 0.004)];
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        let env = 0;
        for (const h of hits) if (t >= h) env += Math.exp(-(t - h) / 0.006) * (h === hits[3] ? 0 : 1);
        env += t >= hits[3] ? Math.exp(-(t - hits[3]) / 0.08) * 1.2 : 0;
        out[i] = bp.run(noise()) * env;
      }
      return fades(normalize(out, 0.8), sr, 0.1, 30);
    }
  }
  return N(0.1);
}

// ---------------------------------------------------------------- room / ambience
/** Small-club impulse response: discrete early reflections + diffuse tail. */
export function renderIR(sr: number, rng: Rng, seconds = 1.5): Float32Array[] {
  const len = Math.floor(seconds * sr);
  const chans = [new Float32Array(len), new Float32Array(len)];
  for (const [ci, ch] of chans.entries()) {
    const lp = Biquad.lp(7000, 0.6, sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t / 0.35) * Math.min(1, t / 0.008);
      // the tail gets darker over time
      ch[i] = lp.run(rng.range(-1, 1)) * env * (1 - 0.5 * Math.min(1, t / seconds));
    }
    for (let k = 0; k < 9; k++) {
      const t = 0.004 + rng.range(0, 0.045);
      const i = Math.floor(t * sr);
      if (i < len) ch[i] += (ci ? -1 : 1) * rng.range(0.3, 0.8) * Math.exp(-t / 0.05);
    }
    normalize(ch, 0.6);
  }
  return chans;
}

/** Bar murmur: many "voices" of formant-filtered noise with syllable-rate gating. */
export function renderMurmur(sr: number, rng: Rng, seconds = 16): Float32Array[] {
  const len = Math.floor(seconds * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const voices = 9;
  for (let v = 0; v < voices; v++) {
    const f1 = rng.range(350, 750);
    const f2 = rng.range(1000, 2200);
    const b1 = Biquad.bp(f1, 3, sr);
    const b2 = Biquad.bp(f2, 4, sr);
    const pan = rng.range(-0.8, 0.8);
    const gain = rng.range(0.4, 1);
    let gate = 0;
    let target = 0;
    let next = 0;
    let talking = rng.chance(0.5);
    let switchAt = Math.floor(rng.range(1, 4) * sr);
    for (let i = 0; i < len; i++) {
      if (i >= switchAt) {
        talking = !talking;
        switchAt = i + Math.floor((talking ? rng.range(1.5, 5) : rng.range(0.5, 3)) * sr);
      }
      if (i >= next) {
        target = talking ? rng.range(0.2, 1) : 0;
        next = i + Math.floor(rng.range(0.08, 0.25) * sr);
      }
      gate += (target - gate) * 0.0015;
      const n = rng.range(-1, 1);
      const s = (b1.run(n) * 1.2 + b2.run(n) * 0.6) * gate * gain;
      L[i] += s * (1 - pan) * 0.5;
      R[i] += s * (1 + pan) * 0.5;
    }
  }
  // seamless loop: crossfade the end into the start
  const xf = Math.floor(1.0 * sr);
  for (let i = 0; i < xf; i++) {
    const a = i / xf;
    L[i] = L[i] * a + L[len - xf + i] * (1 - a);
    R[i] = R[i] * a + R[len - xf + i] * (1 - a);
  }
  const outL = L.subarray(0, len - xf);
  const outR = R.subarray(0, len - xf);
  const lp = Biquad.lp(2800, 0.7, sr);
  const lp2 = Biquad.lp(2800, 0.7, sr);
  lp.apply(outL);
  lp2.apply(outR);
  normalize(outL, 0.5);
  normalize(outR, 0.5);
  return [outL, outR];
}

export function renderApplause(sr: number, rng: Rng, seconds: number, density: number): Float32Array[] {
  const len = Math.floor(seconds * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const clap = (buf: Float32Array, at: number, g: number, f: number) => {
    const bp = Biquad.bp(f, 1.2, sr);
    const n = Math.floor(0.03 * sr);
    for (let i = 0; i < n && at + i < len; i++) buf[at + i] += bp.run(rng.range(-1, 1)) * g * Math.exp(-i / (0.006 * sr));
  };
  const people = Math.round(6 + density * 18);
  for (let p = 0; p < people; p++) {
    const rate = rng.range(3.5, 6.5);
    const f = rng.range(900, 2400);
    const pan = rng.range(0, 1);
    const g = rng.range(0.3, 1);
    let t = rng.range(0, 0.6);
    const stop = seconds * rng.range(0.55, 0.95);
    while (t < stop) {
      const env = Math.min(1, t / 0.5) * Math.max(0, 1 - Math.pow(t / stop, 3));
      const at = Math.floor(t * sr);
      clap(L, at, g * env * (1 - pan), f);
      clap(R, at, g * env * pan, f);
      t += 1 / rate + rng.range(-0.02, 0.02);
    }
  }
  normalize(L, 0.7);
  normalize(R, 0.7);
  return [L, R];
}

export function renderGlass(sr: number, rng: Rng): Float32Array {
  const out = new Float32Array(Math.floor(0.9 * sr));
  const f = rng.range(2200, 3400);
  partials(out, sr, [
    { f, a: 0.5, t60: 0.7 },
    { f: f * 2.32, a: 0.25, t60: 0.4 },
    { f: f * 3.9, a: 0.12, t60: 0.25 },
  ]);
  if (rng.chance(0.5)) {
    // second clink
    const tmp = new Float32Array(out.length);
    partials(tmp, sr, [{ f: f * 1.07, a: 0.35, t60: 0.5, delay: 0.09 }]);
    for (let i = 0; i < out.length; i++) out[i] += tmp[i];
  }
  return fades(normalize(out, 0.6), sr, 0.2, 50);
}

export function renderVinyl(sr: number, rng: Rng, seconds = 7): Float32Array {
  const len = Math.floor(seconds * sr);
  const out = new Float32Array(len);
  const lp = Biquad.lp(4000, 0.7, sr);
  for (let i = 0; i < len; i++) out[i] = lp.run(rng.range(-1, 1)) * 0.03;
  const pops = Math.floor(seconds * 9);
  for (let k = 0; k < pops; k++) {
    const at = Math.floor(rng.range(0, len - 200));
    const g = rng.range(0.1, 1) * (rng.chance(0.1) ? 1 : 0.35);
    for (let i = 0; i < 40; i++) out[at + i] += g * Math.exp(-i / 6) * (i % 2 ? -1 : 1);
  }
  return normalize(out, 0.5);
}
