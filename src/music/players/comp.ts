// Shared comping rhythm vocabulary for piano and guitar.
import type { PlayCtx } from './common';
import { leadBusy } from './common';

export interface Hit {
  beat: number;
  dur: number;
  ant?: boolean; // anticipates the next chord
  trip?: boolean;
  acc?: number; // velocity accent
}

const SWING: { hits: Hit[]; dens: number }[] = [
  { hits: [{ beat: 0, dur: 1.4 }], dens: 0.3 },
  { hits: [{ beat: 0, dur: 0.45 }, { beat: 1.5, dur: 1.2, acc: 0.05 }], dens: 0.6 }, // Charleston
  { hits: [{ beat: 1.5, dur: 0.45 }], dens: 0.3 },
  { hits: [{ beat: 3.5, dur: 0.9, ant: true, acc: 0.06 }], dens: 0.3 },
  { hits: [{ beat: 1, dur: 0.4 }, { beat: 2.5, dur: 0.7 }], dens: 0.6 },
  { hits: [{ beat: 2, dur: 0.5 }, { beat: 3.5, dur: 0.7, ant: true }], dens: 0.6 },
  { hits: [{ beat: 0.5, dur: 0.4 }, { beat: 2, dur: 1 }], dens: 0.55 },
  { hits: [{ beat: 1.5, dur: 0.4 }, { beat: 3.5, dur: 0.7, ant: true }], dens: 0.6 },
  { hits: [{ beat: 1 + 2 / 3, dur: 0.3, trip: true }, { beat: 2, dur: 0.45 }], dens: 0.6 },
  { hits: [{ beat: 0, dur: 0.4 }, { beat: 1.5, dur: 0.4 }, { beat: 2.5, dur: 0.4 }, { beat: 3.5, dur: 0.5, ant: true }], dens: 1 },
  { hits: [], dens: 0 },
];

const NEOSOUL: { hits: Hit[]; dens: number }[] = [
  { hits: [{ beat: 0, dur: 1.9 }, { beat: 2.75, dur: 1 }], dens: 0.5 },
  { hits: [{ beat: 0, dur: 0.7 }, { beat: 0.75, dur: 1.2 }, { beat: 3.5, dur: 0.6, ant: true }], dens: 0.7 },
  { hits: [{ beat: 0, dur: 3.5 }], dens: 0.25 },
  { hits: [{ beat: 0.5, dur: 1.2 }, { beat: 2.5, dur: 1.4 }], dens: 0.5 },
  { hits: [{ beat: 0, dur: 0.4 }, { beat: 1.5, dur: 0.4 }, { beat: 2.75, dur: 0.6 }, { beat: 3.75, dur: 0.4, ant: true }], dens: 0.9 },
];

const BOSSA: { hits: Hit[]; dens: number }[] = [
  { hits: [{ beat: 0, dur: 1.8 }, { beat: 2, dur: 1.4 }], dens: 0.4 },
  { hits: [{ beat: 0, dur: 1.4 }, { beat: 3.5, dur: 0.6, ant: true }], dens: 0.4 },
  { hits: [{ beat: 0.5, dur: 1 }, { beat: 2.5, dur: 1 }], dens: 0.5 },
  { hits: [{ beat: 0, dur: 3.6 }], dens: 0.2 },
];

export function pickComp(ctx: PlayCtx, role: 'lead' | 'second'): Hit[] {
  const { rng } = ctx;
  const lib = ctx.style.id === 'neosoul' ? NEOSOUL : ctx.style.id === 'bossa' ? BOSSA : SWING;
  const soloing = ctx.leadEvs.length > 0;
  let want = 0.25 + 0.6 * ctx.intensity - (soloing ? 0.15 : 0) - (role === 'second' ? 0.3 : 0);
  want = Math.max(0, Math.min(1, want));
  const w = lib.map((p) => 1 / (0.15 + Math.abs(p.dens - want)));
  let hits = rng.weighted(lib, w).hits.map((h) => ({ ...h }));
  // make sure a chord change mid-bar gets acknowledged
  const changes = ctx.info.chords.map((c) => c.beat).filter((b) => b > 0);
  for (const cb of changes) {
    if (!hits.some((h) => Math.abs(h.beat - cb) < 0.6) && rng.chance(0.7)) hits.push({ beat: cb - (rng.chance(0.4) ? 0.5 : 0), dur: 0.8 });
  }
  // stay out of the soloist's way: drop hits on top of busy lead notes, add replies in gaps
  if (soloing) {
    hits = hits.filter((h) => !leadBusy(ctx.leadEvs, h.beat, 0.2) || rng.chance(0.35));
    const lastLead = Math.max(...ctx.leadEvs.map((e) => e.beat + e.dur));
    if (lastLead < 2.6 && rng.chance(0.55)) hits.push({ beat: Math.ceil(lastLead * 2) / 2 + 0.5, dur: 0.6, acc: 0.05 });
  }
  hits = hits.filter((h) => h.beat < 4);
  hits.sort((a, b) => a.beat - b.beat);
  // remove overlaps
  return hits.filter((h, i) => i === 0 || h.beat - hits[i - 1].beat > 0.3);
}
