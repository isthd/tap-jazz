// Mixer: per-part channel strips (pan, reverb send), club convolution reverb,
// bus compression + gentle tape saturation, and the room ambience.
import * as Tone from 'tone';
import type { ChannelId } from '../music/types';
import { Rng } from '../util/rng';
import { renderApplause, renderGlass, renderIR, renderMurmur, renderVinyl } from './dsp';

export interface Channel {
  input: GainNode;
  pan: StereoPannerNode;
  send: GainNode;
}

const CH_GAIN: Record<ChannelId, number> = { bass: 0.95, drums: 1.15, piano: 0.95, guitar: 0.75, perc: 1.1, tap: 0.8 };
const CH_SEND: Record<ChannelId, number> = { bass: 0.08, drums: 0.18, piano: 0.22, guitar: 0.2, perc: 0.2, tap: 0.28 };

export class Mixer {
  channels = {} as Record<ChannelId, Channel>;
  bus: GainNode;
  master: GainNode;
  post: GainNode; // after master processing (ambience joins here)
  reverb: ConvolverNode;
  comp: DynamicsCompressorNode;
  rhodesIn: GainNode;
  eguitarIn: GainNode;
  recordDest: MediaStreamAudioDestinationNode | null = null;
  private amb: GainNode;
  private ambSrc: AudioBufferSourceNode | null = null;
  private vinyl: GainNode;
  private vinylSrc: AudioBufferSourceNode | null = null;
  private applauseBufs: { big: AudioBuffer | null; small: AudioBuffer | null } = { big: null, small: null };
  private glassBufs: AudioBuffer[] = [];
  private glassTimer = 0;

  constructor(private ctx: AudioContext) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.012;
    this.comp.release.value = 0.22;
    this.comp.knee.value = 8;
    const sat = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.25) / Math.tanh(1.25);
    }
    sat.curve = curve;
    sat.oversample = '2x';
    const hc = ctx.createBiquadFilter();
    hc.type = 'lowpass';
    hc.frequency.value = 13500;
    hc.Q.value = 0.5;
    const lowWarm = ctx.createBiquadFilter();
    lowWarm.type = 'lowshelf';
    lowWarm.frequency.value = 180;
    lowWarm.gain.value = 1.5;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.post = ctx.createGain();
    this.bus.connect(this.comp).connect(sat).connect(lowWarm).connect(hc).connect(this.master).connect(this.post).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    const ir = renderIR(ctx.sampleRate, new Rng(7));
    const irb = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
    irb.copyToChannel(ir[0] as Float32Array<ArrayBuffer>, 0);
    irb.copyToChannel(ir[1] as Float32Array<ArrayBuffer>, 1);
    this.reverb.buffer = irb;
    const revRet = ctx.createGain();
    revRet.gain.value = 0.5;
    this.reverb.connect(revRet).connect(this.bus);

    for (const id of Object.keys(CH_GAIN) as ChannelId[]) {
      const input = ctx.createGain();
      input.gain.value = CH_GAIN[id];
      const pan = ctx.createStereoPanner();
      const send = ctx.createGain();
      send.gain.value = CH_SEND[id];
      input.connect(pan).connect(this.bus);
      pan.connect(send).connect(this.reverb);
      this.channels[id] = { input, pan, send };
    }

    // Rhodes: tremolo + chorus; clean guitar: light chorus (Tone.js effects)
    this.rhodesIn = ctx.createGain();
    this.eguitarIn = ctx.createGain();
    const trem = new Tone.Tremolo(4.2, 0.28).start();
    const chorus = new Tone.Chorus(1.2, 3.2, 0.35).start();
    chorus.wet.value = 0.45;
    Tone.connect(this.rhodesIn, trem);
    trem.connect(chorus);
    this.rhodesOut = ctx.createGain();
    Tone.connect(chorus, this.rhodesOut);
    const gch = new Tone.Chorus(0.8, 2.5, 0.25).start();
    gch.wet.value = 0.3;
    Tone.connect(this.eguitarIn, gch);
    this.eguitarOut = ctx.createGain();
    Tone.connect(gch, this.eguitarOut);

    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    this.amb.connect(this.post);
    this.vinyl = ctx.createGain();
    this.vinyl.gain.value = 0;
    this.vinyl.connect(this.post);
  }
  rhodesOut: GainNode;
  eguitarOut: GainNode;

  /** Route the Rhodes / e-guitar effect returns to the channel they currently belong to. */
  routeFx(rhodesCh: ChannelId, eguitarCh: ChannelId) {
    this.rhodesOut.disconnect();
    this.eguitarOut.disconnect();
    this.rhodesOut.connect(this.channels[rhodesCh].input);
    this.eguitarOut.connect(this.channels[eguitarCh].input);
  }

  setPans(p: Record<ChannelId, number>) {
    const t = this.ctx.currentTime;
    for (const id of Object.keys(p) as ChannelId[]) this.channels[id].pan.pan.setTargetAtTime(p[id], t, 0.5);
  }

  async startAmbience() {
    const sr = this.ctx.sampleRate;
    const rng = new Rng(11);
    const m = renderMurmur(sr, rng);
    const b = this.ctx.createBuffer(2, m[0].length, sr);
    b.copyToChannel(m[0] as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel(m[1] as Float32Array<ArrayBuffer>, 1);
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.connect(this.amb);
    src.start();
    this.ambSrc = src;
    this.amb.gain.setTargetAtTime(0.16, this.ctx.currentTime, 1.5);
    for (let i = 0; i < 4; i++) {
      const g = renderGlass(sr, rng);
      const gb = this.ctx.createBuffer(1, g.length, sr);
      gb.copyToChannel(g as Float32Array<ArrayBuffer>, 0);
      this.glassBufs.push(gb);
    }
    this.scheduleGlass();
    // applause buffers, lazily
    setTimeout(() => {
      const big = renderApplause(sr, new Rng(3), 6, 1);
      const small = renderApplause(sr, new Rng(5), 3.5, 0.35);
      this.applauseBufs.big = this.toBuffer(big);
      this.applauseBufs.small = this.toBuffer(small);
      const v = renderVinyl(sr, new Rng(9));
      const vb = this.ctx.createBuffer(1, v.length, sr);
      vb.copyToChannel(v as Float32Array<ArrayBuffer>, 0);
      const vs = this.ctx.createBufferSource();
      vs.buffer = vb;
      vs.loop = true;
      vs.connect(this.vinyl);
      vs.start();
      this.vinylSrc = vs;
    }, 1500);
  }

  private toBuffer(ch: Float32Array[]): AudioBuffer {
    const b = this.ctx.createBuffer(ch.length, ch[0].length, this.ctx.sampleRate);
    ch.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  }

  private scheduleGlass() {
    clearTimeout(this.glassTimer);
    const next = 4000 + Math.random() * 11000;
    this.glassTimer = window.setTimeout(() => {
      if (this.ctx.state === 'running' && this.glassBufs.length) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.glassBufs[Math.floor(Math.random() * this.glassBufs.length)];
        const g = this.ctx.createGain();
        g.gain.value = 0.025 + Math.random() * 0.03;
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.random() * 1.6 - 0.8;
        src.connect(g).connect(p).connect(this.post);
        src.start();
        src.onended = () => p.disconnect();
      }
      this.scheduleGlass();
    }, next);
  }

  applause(time: number, big: boolean) {
    const b = big ? this.applauseBufs.big : this.applauseBufs.small;
    if (!b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = big ? 0.22 : 0.08;
    src.connect(g).connect(this.post);
    src.start(Math.max(time, this.ctx.currentTime));
    src.onended = () => g.disconnect();
  }

  setVinyl(on: boolean) {
    if (!this.vinylSrc) return;
    this.vinyl.gain.setTargetAtTime(on ? 0.035 : 0, this.ctx.currentTime, 0.8);
  }

  setAmbience(level: number) {
    if (!this.ambSrc) return;
    this.amb.gain.setTargetAtTime(level, this.ctx.currentTime, 1);
  }

  recordStream(): MediaStream {
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination();
      this.post.connect(this.recordDest);
    }
    return this.recordDest.stream;
  }
}
