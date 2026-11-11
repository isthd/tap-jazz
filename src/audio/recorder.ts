// Records the master output (MediaStreamAudioDestinationNode -> MediaRecorder)
// and converts the result to WAV when the browser can decode it.

export class SessionRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  startedAt = 0;

  constructor(
    private ctx: AudioContext,
    private stream: () => MediaStream,
  ) {}

  get recording() {
    return this.rec?.state === 'recording';
  }

  static supported() {
    return typeof MediaRecorder !== 'undefined';
  }

  start() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t));
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream(), mimeType ? { mimeType } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.startedAt = performance.now();
  }

  /** Stops and returns a file (WAV if possible). */
  async stop(): Promise<File> {
    const rec = this.rec!;
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.stop();
    await done;
    const raw = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    try {
      const buf = await this.ctx.decodeAudioData(await raw.arrayBuffer());
      return new File([encodeWav(buf)], `tap-jazz-${stamp}.wav`, { type: 'audio/wav' });
    } catch {
      const ext = raw.type.includes('mp4') ? 'm4a' : raw.type.includes('ogg') ? 'ogg' : 'webm';
      return new File([raw], `tap-jazz-${stamp}.${ext}`, { type: raw.type });
    }
  }
}

export function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = Math.min(2, buf.numberOfChannels);
  const len = buf.length;
  const out = new ArrayBuffer(44 + len * ch * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + len * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}
