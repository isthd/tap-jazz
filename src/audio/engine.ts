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

  /** Must be called from a user gesture (iOS). */
  async start() {
    if (this.started) return;
    this.started = true;
    // iOS: play through the silent switch where supported
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* ignore */
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    Tone.setContext(ctx);
    Tone.getContext().lookAhead = 0.03;
    await Tone.start();
    if (ctx.state !== 'running') await ctx.resume();
    this.ctx = ctx;
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
    if (!this.ctx) return;
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
    if (!this.ctx) return;
    if (m) await this.ctx.suspend();
    else await this.ctx.resume();
  }
}
