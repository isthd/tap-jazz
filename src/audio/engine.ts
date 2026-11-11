// Audio engine: AudioContext + Tone.js setup, instrument registry with staged
// loading, and note playback routed through the mixer.
import * as Tone from 'tone';
import type { ChannelId, InstId, ScheduledNote, StyleId } from '../music/types';
import { STYLES } from '../music/styles';
import { BufferInstrument, DrumKit, SPECS, loadSalamander } from './samplers';
import { Mixer } from './mix';

export class AudioEngine {
  ctx!: AudioContext;
  mixer!: Mixer;
  private insts = new Map<InstId, BufferInstrument>();
  private loading = new Map<InstId, Promise<void>>();
  kit!: DrumKit;
  private kitLoad: Promise<void> | null = null;
  pianoSource: 'samples' | 'synth' | 'loading' = 'loading';
  /** Debug: force the synthesized piano instead of the Salamander samples. */
  forceSynthPiano = false;
  private salamander: BufferInstrument | null = null;
  private pianoSynth: BufferInstrument | null = null;
  started = false;

  /** False while the user (or a hidden tab) has paused the sound. */
  private wantRunning = true;
  private keepAlive: HTMLAudioElement | null = null;

  /**
   * Create / resume the AudioContext. Call synchronously inside every user
   * gesture: iPad / iPhone Safari only unlock audio on pointerup / touchend /
   * click / keydown, not on a touch pointerdown, and an interrupted context
   * (call, Siri, background) also needs a fresh gesture to resume.
   */
  unlock() {
    if (!this.ctx) {
      // iOS 16.4+: play through the silent switch
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      try {
        if (nav.audioSession) nav.audioSession.type = 'playback';
      } catch {
        /* ignore */
      }
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      Tone.setContext(ctx);
      Tone.getContext().lookAhead = 0.03;
      if (!nav.audioSession && isIOS()) this.keepAlive = silentLoop();
    }
    if (!this.wantRunning) return;
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {
        /* retried on the next gesture */
      });
      // a tiny silent buffer started inside the gesture is what actually unlocks older iOS
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
    }
    // older iOS: a playing <audio> switches the session to "playback" so the mute switch doesn't silence us
    if (this.keepAlive?.paused) this.keepAlive.play().catch(() => {});
  }

  /** Resolves once the context is actually running (after an unlocking gesture). */
  private running(): Promise<void> {
    const ctx = this.ctx;
    return new Promise((resolve) => {
      if (ctx.state === 'running') return resolve();
      const on = () => {
        if (ctx.state !== 'running') return;
        ctx.removeEventListener('statechange', on);
        resolve();
      };
      ctx.addEventListener('statechange', on);
    });
  }

  /** Call from a user gesture; finishes once audio is unlocked. */
  async start() {
    if (this.started) return;
    this.started = true;
    this.unlock();
    await this.running();
    const ctx = this.ctx;
    this.mixer = new Mixer(ctx);
    this.kit = new DrumKit(ctx);
    await this.mixer.startAmbience();
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private getInst(id: Exclude<InstId, 'kit'>): Promise<void> {
    let p = this.loading.get(id);
    if (p) return p;
    const inst = new BufferInstrument(this.ctx, id, SPECS[id]);
    this.insts.set(id, inst);
    p = inst.renderAll(1000 + id.length * 31 + id.charCodeAt(0));
    this.loading.set(id, p);
    return p;
  }

  private loadKit(): Promise<void> {
    if (!this.kitLoad) this.kitLoad = this.kit.renderAll(4242);
    return this.kitLoad;
  }

  /** Load the piano: Salamander samples, falling back to the synthesized piano. */
  async loadPiano(onProgress?: (f: number) => void) {
    if (this.salamander || this.pianoSource === 'synth') return;
    const synth = new BufferInstrument(this.ctx, 'piano', SPECS.piano);
    const synthP = synth.renderAll(77);
    this.pianoSynth = synth;
    const zones = await Promise.race([
      loadSalamander(this.ctx, 33, 100, onProgress),
      new Promise<null>((r) => setTimeout(() => r(null), 12000)),
    ]);
    if (zones && zones.length >= 12) {
      const s = new BufferInstrument(this.ctx, 'piano', { ...SPECS.piano, gain: 1.6, release: 0.3, bright: [2500, 16000] });
      s.setZones(zones);
      this.salamander = s;
      this.pianoSource = 'samples';
    } else {
      await synthP;
      this.pianoSource = 'synth';
    }
    // keep the synth version rendering in the background for the A/B toggle
    void synthP;
  }

  /** Stage 1: what the very first taps need. */
  async loadFirst(style: StyleId, onProgress?: (f: number) => void) {
    const tap = STYLES[style].tapInst[0];
    if (tap === 'piano') await this.loadPiano(onProgress);
    else await this.getInst(tap as Exclude<InstId, 'kit'>);
    onProgress?.(1);
  }

  /** Stage 2: the rest of the band for a style, in background. */
  async loadStyle(style: StyleId) {
    const s = STYLES[style];
    const order: InstId[] = [s.inst.bass, 'kit', s.inst.guitar, s.inst.piano, s.tapInst[1], s.tapInst[0]];
    for (const id of order) {
      if (id === 'kit') await this.loadKit();
      else if (id === 'piano') await this.loadPiano();
      else await this.getInst(id);
    }
  }

  isReady(style: StyleId): boolean {
    const s = STYLES[style];
    const ids: InstId[] = [s.inst.bass, s.inst.guitar, s.inst.piano, s.tapInst[0], s.tapInst[1]];
    return this.kit?.ready && ids.every((id) => (id === 'piano' ? this.pianoReady() : this.insts.get(id)?.ready));
  }

  private pianoReady() {
    return !!(this.salamander?.ready || this.pianoSynth?.ready);
  }

  private piano(): BufferInstrument | null {
    if (this.forceSynthPiano && this.pianoSynth?.ready) return this.pianoSynth;
    if (this.salamander?.ready) return this.salamander;
    if (this.pianoSynth?.ready) return this.pianoSynth;
    return null;
  }

  play(notes: ScheduledNote[]) {
    if (!this.mixer) return;
    for (const n of notes) {
      const ch = this.mixer.channels[n.ch];
      if (!ch) continue;
      let out: AudioNode = ch.input;
      if (n.inst === 'kit') {
        this.kit.play(n, out);
        continue;
      }
      if (n.inst === 'rhodes') out = this.mixer.rhodesIn;
      else if (n.inst === 'eguitar') out = this.mixer.eguitarIn;
      const inst = n.inst === 'piano' ? this.piano() : this.insts.get(n.inst);
      inst?.play(n, out);
    }
  }

  applyStyle(style: StyleId) {
    const s = STYLES[style];
    this.mixer.setPans(s.pan);
    this.mixer.setVinyl(style === 'neosoul');
    const rh: ChannelId = 'piano';
    const eg: ChannelId = 'guitar';
    this.mixer.routeFx(rh, eg);
  }

  async setMuted(m: boolean) {
    this.wantRunning = !m;
    if (!this.ctx) return;
    if (m) this.keepAlive?.pause();
    else if (this.keepAlive?.paused) this.keepAlive.play().catch(() => {});
    try {
      if (m) await this.ctx.suspend();
      else await this.ctx.resume();
    } catch {
      /* resumed by the next gesture (unlock) */
    }
  }
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** A looping, silent <audio> element (8 kHz mono 8-bit WAV, 0.5 s). */
function silentLoop(): HTMLAudioElement {
  const n = 4000;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  const a = document.createElement('audio');
  a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  a.loop = true;
  a.setAttribute('playsinline', '');
  a.setAttribute('x-webkit-airplay', 'deny');
  a.preload = 'auto';
  return a;
}
