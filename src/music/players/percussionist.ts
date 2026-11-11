import type { Ev } from '../types';
import { bandTacet, type PlayCtx } from './common';

export class Percussionist {
  feelKey = 'perc' as const;
  jitter = 8;

  bar(ctx: PlayCtx): Ev[] {
    const { info, rng } = ctx;
    if (!ctx.active || bandTacet(info)) return [];
    const f = info.flags;
    if (f.breakBand || f.stopTime || f.dropdown || f.kime || info.seg === 'fermata') return [];
    const evs: Ev[] = [];
    const kind = ctx.style.perc;
    if (kind === 'snap') {
      for (const b of [1, 3]) evs.push({ beat: b, dur: 0.2, inst: 'kit', drum: 'snap', vel: 0.55 + rng.range(-0.08, 0.08) });
      if (ctx.intensity > 0.7 && rng.chance(0.15)) evs.push({ beat: 3.5, dur: 0.2, inst: 'kit', drum: 'snap', vel: 0.3 });
    } else if (kind === 'shaker') {
      const acc = [0.42, 0.18, 0.3, 0.2];
      for (let i = 0; i < 16; i++) {
        if (rng.chance(0.06)) continue;
        evs.push({ beat: i * 0.25, dur: 0.2, inst: 'kit', drum: 'shaker', vel: acc[i % 4] + rng.range(-0.05, 0.05) });
      }
    } else {
      for (const b of [1, 3]) evs.push({ beat: b, dur: 0.2, inst: 'kit', drum: 'clap', vel: 0.62 + rng.range(-0.06, 0.06), offMs: 12 });
      if (rng.chance(0.18)) evs.push({ beat: 3.75, dur: 0.2, inst: 'kit', drum: 'clap', vel: 0.35, offMs: 12 });
    }
    return evs.map((e) => ({ ...e, ch: 'perc' as const }));
  }
}
