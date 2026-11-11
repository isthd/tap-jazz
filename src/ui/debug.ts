// ?debug=1 panel: intensity, chord, form position, players, seed, A/B piano.
import type { UiEvent } from '../music/conductor';

export class DebugPanel {
  el: HTMLElement;
  private body: HTMLElement;
  constructor(seed: number, actions: { toggleSynthPiano(): string; reloadSeed(): void }) {
    this.el = document.createElement('div');
    this.el.className = 'debug';
    this.el.innerHTML = `<div class="dbg-body"></div>
      <div class="dbg-actions"><button class="ab">piano: samples</button><button class="seed">seed ${seed} で再読込</button></div>`;
    document.body.appendChild(this.el);
    this.body = this.el.querySelector('.dbg-body')!;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const ab = this.el.querySelector('.ab') as HTMLButtonElement;
    ab.addEventListener('click', () => (ab.textContent = 'piano: ' + actions.toggleSynthPiano()));
    this.el.querySelector('.seed')!.addEventListener('click', () => actions.reloadSeed());
  }

  bar(e: Extract<UiEvent, { type: 'bar' }>, extra: string) {
    const i = e.info;
    const flags = Object.entries(i.flags)
      .filter(([, v]) => v !== undefined && v !== false)
      .map(([k, v]) => (v === true ? k : `${k}:${typeof v === 'number' ? +v.toFixed(2) : v}`))
      .join(' ');
    const bar = '█'.repeat(Math.round(e.intensity * 20)).padEnd(20, '·');
    this.body.textContent = [
      `intensity ${bar} ${e.intensity.toFixed(2)}`,
      `chord     ${e.chord}`,
      `form      ${i.seg} ${i.section} bar ${i.formBar + 1}/${i.formLen}  chorus ${i.chorus + 1}  seg ${i.segBar + 1}/${i.segLen}`,
      `lead      ${i.soloist ?? '-'}  progress ${i.soloProgress.toFixed(2)}  comp ${i.compLead}`,
      `drums     ${e.drumMode}   bpm ${i.bpm.toFixed(1)}   taps ${e.tapCount}`,
      `flags     ${flags || '-'}`,
      extra,
    ].join('\n');
  }
}
