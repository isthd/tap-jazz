// Chord strip at the top of the stage: the bar being played (with a beat cursor)
// and a forecast of the next bars. The forecast follows your taps, so it can change.
import type { BarChord, BarInfo } from '../music/types';
import { chordName } from '../music/theory';

const CELLS = 4;

function segLabel(i: BarInfo): string {
  if (i.flags.modulate) return 'modulation';
  switch (i.seg) {
    case 'buildup':
      return 'intro';
    case 'head':
      return `head · ${i.section}`;
    case 'headOut':
      return `head out · ${i.section}`;
    case 'solo':
      return i.flags.breakBand ? 'break' : `${i.soloist === 'perc' ? 'percussion' : i.soloist ?? ''} solo · ${i.section}`;
    case 'trade':
      return 'trading fours';
    case 'tag':
      return 'ending';
    case 'fermata':
      return 'fin';
    case 'switch':
      return 'style change';
    default:
      return '';
  }
}

export class ChordBar {
  el: HTMLElement;
  private meta: HTMLElement;
  private cells: HTMLElement[] = [];
  private dots: HTMLElement[] = [];
  private beatIdx = -1;
  private chordBeats: number[] = [];
  abs = -1;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'chords';
    this.el.setAttribute('aria-live', 'off');
    this.el.innerHTML = `<div class="chord-meta"></div><div class="chord-row">${Array.from({ length: CELLS }, (_, i) => `<div class="cell${i === 0 ? ' now' : ''}"><div class="names"></div>${i === 0 ? '<div class="beats"><i></i><i></i><i></i><i></i></div>' : ''}</div>`).join('')}</div>`;
    document.body.appendChild(this.el);
    this.meta = this.el.querySelector('.chord-meta')!;
    this.cells = [...this.el.querySelectorAll<HTMLElement>('.cell')];
    this.dots = [...this.el.querySelectorAll<HTMLElement>('.beats i')];
    addEventListener('resize', () => (this.bottomPx = 0));
  }

  private visible = false;
  private bottomPx = 0;

  show(v: boolean) {
    this.visible = v;
    this.el.classList.toggle('visible', v);
    this.bottomPx = 0;
  }

  /** Bottom edge in CSS px while shown (0 when hidden). */
  bottom(): number {
    if (!this.visible) return 0;
    if (!this.bottomPx) this.bottomPx = this.el.getBoundingClientRect().bottom;
    return this.bottomPx;
  }

  private fill(cell: HTMLElement, bar: BarChord[] | undefined) {
    const names = cell.querySelector('.names') as HTMLElement;
    cell.classList.toggle('empty', !bar);
    if (!bar) {
      names.textContent = '';
      return;
    }
    names.innerHTML = '';
    cell.classList.toggle('two', bar.length > 1);
    for (const bc of bar) {
      const s = document.createElement('span');
      s.textContent = chordName(bc.chord);
      names.appendChild(s);
    }
  }

  set(info: BarInfo, upcoming: BarChord[][]) {
    this.abs = info.abs;
    this.chordBeats = info.chords.map((c) => c.beat);
    this.beatIdx = -1;
    const silent = info.seg === 'silence' || info.seg === 'countin';
    this.fill(this.cells[0], silent ? undefined : info.chords);
    for (let i = 1; i < CELLS; i++) this.fill(this.cells[i], silent ? undefined : upcoming[i - 1]);
    const tags: string[] = [];
    if (info.flags.doubleTime) tags.push('double time');
    if (info.flags.dropdown) tags.push('breakdown');
    const label = segLabel(info);
    this.meta.textContent = [label, ...tags].filter(Boolean).join(' · ');
    this.el.classList.toggle('flash', !!info.flags.modulate);
  }

  beat(b: number) {
    const i = Math.min(3, Math.max(0, Math.floor(b)));
    if (i === this.beatIdx) return;
    this.beatIdx = i;
    this.dots.forEach((d, k) => d.classList.toggle('on', k === i));
    let cur = 0;
    this.chordBeats.forEach((cb, k) => {
      if (cb <= b + 1e-6) cur = k;
    });
    this.cells[0].querySelectorAll('span').forEach((s, k) => s.classList.toggle('cur', k === cur));
  }
}
