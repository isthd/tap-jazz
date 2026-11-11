// Small, quiet menu in the top-right corner.
import { NOTE_NAMES } from '../music/theory';

export interface MenuHandlers {
  tempo(bpm: number): void;
  key(k: number): void;
  nextStyle(): void;
  record(): Promise<void>;
  share(): Promise<void>;
  mute(m: boolean): void;
  reset(): void;
}

export class Menu {
  root: HTMLElement;
  private panel: HTMLElement;
  private tempo: HTMLInputElement;
  private tempoLabel: HTMLElement;
  private keySel: HTMLSelectElement;
  private recBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private styleLabel: HTMLElement;
  private toastEl: HTMLElement;
  muted = false;

  constructor(h: MenuHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <button class="menu-btn" aria-label="メニュー" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>
      </button>
      <div class="menu-panel" hidden>
        <div class="row style-row"><span class="style-label"></span><button class="link next-style">次のスタイル →</button></div>
        <label class="row">テンポ <span class="tempo-label"></span></label>
        <input class="tempo" type="range" min="90" max="220" step="1" />
        <label class="row">キー
          <select class="key">${NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select>
        </label>
        <div class="buttons">
          <button class="rec">● 録音</button>
          <button class="share">リンクで共有</button>
          <button class="mute">ミュート</button>
          <button class="reset">リセット</button>
        </div>
        <p class="credits">Piano: Salamander Grand Piano (Alexander Holm, CC BY 3.0). その他の音はすべてブラウザ内で合成。<br/>長押し / Shift+Space でスタイル切り替え</p>
      </div>
      <div class="toast" hidden></div>`;
    document.body.appendChild(this.root);
    const $ = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    const btn = $<HTMLButtonElement>('.menu-btn');
    this.panel = $('.menu-panel');
    this.tempo = $('.tempo');
    this.tempoLabel = $('.tempo-label');
    this.keySel = $('.key');
    this.recBtn = $('.rec');
    this.muteBtn = $('.mute');
    this.styleLabel = $('.style-label');
    this.toastEl = $('.toast');
    // the menu must not count as a tap
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    btn.addEventListener('click', () => {
      const open = this.panel.hidden;
      this.panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    this.tempo.addEventListener('input', () => (this.tempoLabel.textContent = this.tempo.value + ' BPM'));
    this.tempo.addEventListener('change', () => h.tempo(+this.tempo.value));
    this.keySel.addEventListener('change', () => h.key(+this.keySel.value));
    $('.next-style').addEventListener('click', () => h.nextStyle());
    this.recBtn.addEventListener('click', () => void h.record());
    $('.share').addEventListener('click', () => void h.share());
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      this.muteBtn.textContent = this.muted ? 'ミュート解除' : 'ミュート';
      this.muteBtn.classList.toggle('on', this.muted);
      h.mute(this.muted);
    });
    $('.reset').addEventListener('click', () => h.reset());
  }

  show(v: boolean) {
    this.root.classList.toggle('visible', v);
  }

  setStyle(name: string, bpm: number, range: [number, number], key: number) {
    this.styleLabel.textContent = name;
    this.tempo.min = String(range[0]);
    this.tempo.max = String(range[1]);
    this.tempo.value = String(Math.round(bpm));
    this.tempoLabel.textContent = Math.round(bpm) + ' BPM';
    this.keySel.value = String(key);
  }

  setRecording(on: boolean, seconds = 0) {
    this.recBtn.textContent = on ? `■ 停止して保存 (${seconds}s)` : '● 録音';
    this.recBtn.classList.toggle('on', on);
  }

  toast(msg: string, ms = 2600) {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout((this.toastEl as any)._t);
    (this.toastEl as any)._t = setTimeout(() => (this.toastEl.hidden = true), ms);
  }
}
