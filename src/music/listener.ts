// Listener: analyses the user's taps (density, rhythm, strength) and extracts a
// rhythmic motif the soloists can quote back ("the band is listening to you").

export interface TapRecord {
  time: number; // audio seconds
  absBeat: number; // beats since the clock started (-1 if clock not running)
  rawBeat?: number; // unquantized position (for on/off-beat analysis)
  vel: number;
  midi: number;
}

export interface Motif {
  onsets: number[]; // beats, relative to first note (0)
  durs: number[];
  contour: number[]; // semitone steps between consecutive notes
  fromUser: boolean;
}

export class Listener {
  taps: TapRecord[] = [];
  private pending: Motif | null = null;
  lastMotif: Motif | null = null;

  add(t: TapRecord) {
    this.taps.push(t);
    if (this.taps.length > 400) this.taps.splice(0, 200);
  }

  get lastTapTime(): number {
    return this.taps.length ? this.taps[this.taps.length - 1].time : -Infinity;
  }

  /** Taps per second over a window ending at `now`. */
  rate(now: number, window = 6): number {
    let n = 0;
    for (let i = this.taps.length - 1; i >= 0; i--) {
      if (this.taps[i].time < now - window) break;
      if (this.taps[i].time <= now) n++;
    }
    return n / window;
  }

  /** Called once per bar with the bar's cutoff time; detects finished tap phrases. */
  update(cutoff: number, beatsPerSec: number) {
    const ts = this.taps.filter((t) => t.time <= cutoff && t.absBeat >= 0);
    if (ts.length < 3) return;
    const last = ts[ts.length - 1];
    const gapBeats = (cutoff - last.time) * beatsPerSec;
    if (gapBeats < 1.25) return; // phrase still going
    // walk back while gaps are short
    const run: TapRecord[] = [last];
    for (let i = ts.length - 2; i >= 0 && run.length < 7; i--) {
      if (run[0].absBeat - ts[i].absBeat > 2.1) break;
      run.unshift(ts[i]);
    }
    if (run.length < 3) return;
    if (this.lastMotif && this.lastMotif.fromUser && this.pending === null && this.lastMotifEnd === last.time) return;
    this.lastMotifEnd = last.time;
    const q = (b: number) => {
      const r8 = Math.round(b * 2) / 2;
      const r3 = Math.round(b * 3) / 3;
      return Math.abs(r8 - b) <= Math.abs(r3 - b) + 0.04 ? r8 : r3;
    };
    const start = q(run[0].absBeat);
    let onsets = run.map((t) => q(t.absBeat) - start);
    // dedupe & keep it inside 2 bars
    onsets = onsets.filter((o, i) => i === 0 || o > onsets[i - 1] + 0.01).filter((o) => o < 8);
    if (onsets.length < 3) return;
    const durs = onsets.map((o, i) => (i + 1 < onsets.length ? Math.min(1.5, onsets[i + 1] - o) : 1));
    const contour = run.slice(1, onsets.length).map((t, i) => Math.max(-7, Math.min(7, t.midi - run[i].midi)));
    const m: Motif = { onsets, durs, contour, fromUser: true };
    this.pending = m;
    this.lastMotif = m;
  }
  private lastMotifEnd = -1;

  /** A fresh motif from the user, consumed once by a soloist. */
  takeFresh(): Motif | null {
    const m = this.pending;
    this.pending = null;
    return m;
  }

  reset() {
    this.taps = [];
    this.pending = null;
    this.lastMotif = null;
  }
}
