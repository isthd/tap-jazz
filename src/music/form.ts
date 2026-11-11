// Form / harmony: parse key-relative templates, build charts, reharmonize per chorus.
import type { BarChord, Chord, Quality } from './types';
import type { StyleDef } from './styles/style';
import { isDominant, isMinor, pc } from './theory';
import type { Rng } from '../util/rng';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

function degree(tok: string): number {
  let acc = 0;
  let i = 0;
  while (tok[i] === 'b' || tok[i] === '#') {
    acc += tok[i] === 'b' ? -1 : 1;
    i++;
  }
  const n = parseInt(tok.slice(i), 10);
  return MAJOR[(n - 1) % 7] + acc;
}

/** "2:m7 5:7 | 1:maj7/3" -> bars of key-relative chords (root as offset from key). */
export function parseTemplate(tpl: string): BarChord[][] {
  return tpl.split('|').map((bar) => {
    const toks = bar.trim().split(/\s+/).filter(Boolean);
    const per = 4 / toks.length;
    return toks.map((t, i) => {
      const [deg, rest] = t.split(':');
      const [q, slash] = rest.split('/');
      const ch: Chord = { root: pc(degree(deg)), q: q as Quality };
      if (slash) ch.bass = pc(degree(slash));
      return { beat: i * per, chord: ch };
    });
  });
}

export function transpose(bars: BarChord[][], key: number): BarChord[][] {
  return bars.map((b) =>
    b.map((bc) => ({
      beat: bc.beat,
      chord: { root: pc(bc.chord.root + key), q: bc.chord.q, bass: bc.chord.bass === undefined ? undefined : pc(bc.chord.bass + key) },
    })),
  );
}

export interface Chart {
  name: string;
  bars: BarChord[][]; // key-relative (key = 0)
  sections: string[]; // section label per bar
}

/** Pick a form and templates for one tune. */
export function buildChart(style: StyleDef, rng: Rng): Chart {
  const form = rng.pick(style.forms);
  const chosen: Record<string, string> = {};
  for (const label of Object.keys(form.sections)) chosen[label] = rng.pick(form.sections[label]);
  const bars: BarChord[][] = [];
  const sections: string[] = [];
  form.order.forEach((label, idx) => {
    let secBars = parseTemplate(chosen[label]);
    // Last A of AABA resolves home in its last bar sometimes (keeps turnaround otherwise).
    if (idx === form.order.length - 1 && rng.chance(0.25) && secBars.length === 8) {
      secBars = secBars.slice(0, 7).concat(parseTemplate('1:6 6:7'));
    }
    for (const b of secBars) {
      bars.push(b);
      sections.push(label);
    }
  });
  fixDominants(bars);
  return { name: form.name, bars, sections };
}

/** V7 resolving to a minor chord becomes 7b9 (makes the minor cadence sound right). */
function fixDominants(bars: BarChord[][]) {
  const flat: BarChord[] = bars.flat();
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i].chord;
    const n = flat[(i + 1) % flat.length].chord;
    if (c.q === '7' && isMinor(n.q) && pc(c.root + 5) === n.root) c.q = '7b9';
  }
}

const cloneBars = (bars: BarChord[][]) => bars.map((b) => b.map((bc) => ({ beat: bc.beat, chord: { ...bc.chord } })));

/**
 * Probabilistic reharmonization (amount 0..1):
 * tritone subs, inserted ii-V, backdoor ii-V, turnaround variations, neo-soul colours.
 */
export function reharmonize(chart: Chart, rng: Rng, amount: number, styleId: string): BarChord[][] {
  const bars = cloneBars(chart.bars);
  const n = bars.length;
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const next = bars[(i + 1) % n][0].chord;
    // Insert ii-V before a dominant that fills a whole bar
    if (bar.length === 1 && isDominant(bar[0].chord.q) && bar[0].chord.q !== '9sus' && rng.chance(0.35 * amount)) {
      const v = bar[0].chord;
      bars[i] = [
        { beat: 0, chord: { root: pc(v.root + 7), q: 'm7' } },
        { beat: 2, chord: v },
      ];
      continue;
    }
    for (let j = 0; j < bar.length; j++) {
      const c = bar[j].chord;
      const following = j + 1 < bar.length ? bar[j + 1].chord : next;
      // Tritone substitution of V7 -> I
      if (isDominant(c.q) && pc(c.root + 5) === following.root && rng.chance(0.3 * amount)) {
        bar[j].chord = { root: pc(c.root + 6), q: rng.chance(0.6) ? '7#11' : '7' };
      } else if (c.q === '7' && rng.chance(0.25 * amount)) {
        // dominant colour
        c.q = rng.pick(['9', '13', '7alt', '7b9'] as Quality[]);
      }
      if (styleId === 'neosoul' && rng.chance(0.3 * amount)) {
        if (c.q === 'm7') c.q = rng.pick(['m9', 'm11'] as Quality[]);
        else if (c.q === 'maj7') c.q = 'maj9';
        else if (c.q === '7') c.q = rng.pick(['9sus', '13'] as Quality[]);
      }
    }
  }
  // Turnaround variation in the last two bars
  if (rng.chance(0.55 * amount + 0.1)) {
    const variants = [
      '1:maj7 6:7 | 2:m7 5:7',
      '3:m7 6:7 | 2:m7 5:7',
      '1:maj7 b3:7 | b6:7 b2:7',
      '3:m7 b3:7 | 2:m7 b2:7',
      '1:6 b7:9 | b6:7#11 5:7alt',
    ];
    const last = bars[n - 1];
    const resolvesHome = last.some((bc) => isDominant(bc.chord.q));
    if (resolvesHome && n >= 8) {
      const tv = parseTemplate(rng.pick(variants));
      const firstOfPrev = bars[n - 2][0].chord;
      // Only replace when the second-to-last bar is a tonic-ish area
      if (!isDominant(firstOfPrev.q) || rng.chance(0.3)) {
        bars[n - 2] = tv[0];
        bars[n - 1] = tv[1];
      }
    }
  }
  // Backdoor ii-V in front of the final tonic of a section
  for (let i = 1; i < n; i++) {
    const c = bars[i][0].chord;
    const prev = bars[i - 1];
    if ((c.q === 'maj7' || c.q === '6' || c.q === 'maj9') && c.root === 0 && prev.length === 2 && rng.chance(0.12 * amount)) {
      bars[i - 1] = [
        { beat: 0, chord: { root: 5, q: 'm7' } },
        { beat: 2, chord: { root: 10, q: '7' } },
      ];
    }
  }
  fixDominants(bars);
  return bars;
}

/** Chord active at a beat in a bar. */
export function chordAt(bar: BarChord[], beat: number): Chord {
  let c = bar[0].chord;
  for (const bc of bar) if (bc.beat <= beat + 1e-6) c = bc.chord;
  return c;
}
