// Share links: seed + tap record + style/tempo/key packed into the URL hash.
import type { InputKind, InputRec } from '../music/conductor';
import type { StyleId } from '../music/types';

export interface SharePayload {
  v: 1;
  seed: number;
  style: StyleId;
  bpm: number;
  key: number;
  rec: InputRec[];
}

const KIND: InputKind[] = ['tap', 'style', 'tempo', 'key', 'reset'];
const STY: StyleId[] = ['swing', 'bossa', 'neosoul'];

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeShare(p: SharePayload): Promise<string> {
  // compact: [seed, style, bpm, key, dt_ms, kind, (value)...]
  const flat: number[] = [p.seed, STY.indexOf(p.style), Math.round(p.bpm), p.key];
  let prev = 0;
  for (const r of p.rec) {
    const ms = Math.round(r.t * 1000);
    flat.push(ms - prev, KIND.indexOf(r.k));
    if (r.k === 'tempo' || r.k === 'key') flat.push(Math.round(r.v ?? 0));
    prev = ms;
  }
  const json = new TextEncoder().encode(JSON.stringify(flat));
  const z = await deflate(json);
  return z ? 'z' + toB64Url(z) : 'j' + toB64Url(json);
}

export async function decodeShare(s: string): Promise<SharePayload | null> {
  try {
    const raw = fromB64Url(s.slice(1));
    const bytes = s[0] === 'z' ? await inflate(raw) : raw;
    const flat = JSON.parse(new TextDecoder().decode(bytes)) as number[];
    const [seed, st, bpm, key] = flat;
    const rec: InputRec[] = [];
    let t = 0;
    for (let i = 4; i < flat.length; ) {
      t += flat[i++];
      const k = KIND[flat[i++]];
      const r: InputRec = { t: t / 1000, k };
      if (k === 'tempo' || k === 'key') r.v = flat[i++];
      rec.push(r);
    }
    return { v: 1, seed: seed >>> 0, style: STY[st] ?? 'swing', bpm, key, rec };
  } catch {
    return null;
  }
}

export function shareUrl(code: string): string {
  const u = new URL(location.href);
  u.hash = 's=' + code;
  u.search = '';
  return u.toString();
}

export function readShareFromLocation(): string | null {
  const m = location.hash.match(/s=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
