import '@fontsource/poiret-one/400.css';
import '@fontsource/josefin-sans/300.css';
import '@fontsource/josefin-sans/400.css';
import '@fontsource/josefin-sans/300-italic.css';
import './style.css';
import { AudioEngine } from './audio/engine';
import { SessionRecorder } from './audio/recorder';
import { Conductor, JOIN_AT, type UiEvent } from './music/conductor';
import { STYLES, STYLE_ORDER, nextStyle } from './music/styles';
import { NOTE_NAMES } from './music/theory';
import type { StyleId } from './music/types';
import { Scene } from './visual/scene';
import { bindInput } from './input/tap';
import { Menu } from './ui/menu';
import { DebugPanel } from './ui/debug';
import { ChordBar } from './ui/chords';
import { decodeShare, encodeShare, readShareFromLocation, shareUrl, type SharePayload } from './ui/share';
import { newSeed } from './util/rng';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const scene = new Scene(canvas);
const engine = new AudioEngine();
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS) scene.hint = 'iPhone：消音モードだと音が出ない場合があります。音量も確認してください';

let shared: SharePayload | null = null;
let conductor: Conductor | null = null;
let phase: 'start' | 'loading' | 'main' = 'start';
let recorder: SessionRecorder | null = null;
let recTimer = 0;
let initial = { style: 'swing' as StyleId, bpm: 0, key: 0 };
let debug: DebugPanel | null = null;
const chordBar = new ChordBar();

function pickStartStyle(): StyleId {
  const q = params.get('style') as StyleId | null;
  if (q && STYLES[q]) return q;
  const last = store.get('tapjazz.style') as StyleId | null;
  if (last && STYLES[last]) return last;
  return STYLE_ORDER[Math.floor(Math.random() * STYLE_ORDER.length)];
}

const menu = new Menu({
  tempo: (bpm) => conductor?.input('tempo', bpm),
  key: (k) => conductor?.input('key', k),
  nextStyle: () => longPress(),
  record: async () => {
    if (!engine.started) return;
    if (!SessionRecorder.supported()) {
      menu.toast('このブラウザは録音に対応していません');
      return;
    }
    if (!recorder) recorder = new SessionRecorder(engine.ctx, () => engine.mixer.recordStream());
    if (!recorder.recording) {
      recorder.start();
      menu.setRecording(true, 0);
      recTimer = window.setInterval(() => menu.setRecording(true, Math.round((performance.now() - recorder!.startedAt) / 1000)), 1000);
    } else {
      clearInterval(recTimer);
      menu.setRecording(false);
      menu.toast('音声ファイルを作成中…');
      const file = await recorder.stop();
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Tap Jazz' });
          return;
        } catch {
          /* fall back to download */
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      menu.toast(`${file.name} を保存しました`);
    }
  },
  share: async () => {
    if (!conductor || !conductor.record.length) {
      menu.toast('まずはタップして演奏してください');
      return;
    }
    const code = await encodeShare({ v: 1, seed: conductor.seed, style: initial.style, bpm: initial.bpm, key: initial.key, rec: conductor.record });
    const url = shareUrl(code);
    try {
      if (navigator.share) await navigator.share({ url, title: 'Tap Jazz' });
      else {
        await navigator.clipboard.writeText(url);
        menu.toast('リンクをコピーしました');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        menu.toast('リンクをコピーしました');
      } catch {
        prompt('このリンクをコピーしてください', url);
      }
    }
  },
  mute: (m) => {
    void engine.setMuted(m);
  },
  reset: () => {
    conductor?.input('reset');
    menu.toast('エンディングのあと、最初に戻ります');
  },
});

function updateInfo() {
  if (!conductor) return;
  const s = conductor.style;
  scene.info = `${s.name} · ${NOTE_NAMES[conductor.key]} · ${Math.round(conductor.bpm)} BPM`;
  menu.setStyle(s.name, conductor.bpm, s.bpmRange, conductor.key);
}

function onEvent(e: UiEvent) {
  switch (e.type) {
    case 'notes':
      scene.notes(e.notes);
      break;
    case 'join':
      atAudioTime(e.time, () => scene.join(e.part));
      break;
    case 'lead':
      atAudioTime(e.time, () => scene.setLead(e.part));
      break;
    case 'style':
      void engine.loadStyle(e.style);
      atAudioTime(e.time, () => {
        engine.applyStyle(e.style);
        updateInfo();
        store.set('tapjazz.style', e.style);
      });
      break;
    case 'applause':
      engine.mixer.applause(e.time, e.big);
      break;
    case 'session':
      atAudioTime(e.time, () => scene.showLabel('— the band takes it from here'));
      break;
    case 'song':
      atAudioTime(e.time, () => {
        updateInfo();
        scene.hint = '';
      });
      break;
    case 'rest':
      atAudioTime(e.time + 2, () => {
        scene.hint = 'タップで次の曲へ';
        chordBar.show(false);
      });
      break;
    case 'reset':
      atAudioTime(e.time, () => {
        scene.resetParts();
        scene.showLabel('');
        chordBar.show(false);
        scene.hint = '';
      });
      break;
    case 'fx':
      scene.showLabel(e.text);
      updateInfo();
      break;
    case 'bar':
      atAudioTime(e.time, () => {
        chordBar.set(e.info, e.upcoming);
        chordBar.show(true);
      });
      if (debug) {
        const extra = `seed ${conductor?.seed}  piano ${engine.pianoSource}${engine.forceSynthPiano ? ' (forced synth)' : ''}  next join ${JOIN_AT.find((j) => j.taps > e.tapCount)?.taps ?? '-'}`;
        atAudioTime(e.time, () => debug!.bar(e, extra));
      }
      break;
  }
}

function atAudioTime(t: number, fn: () => void) {
  const ms = Math.max(0, (t - engine.now()) * 1000);
  setTimeout(fn, ms);
}

async function begin() {
  phase = 'loading';
  scene.state = 'loading';
  scene.hint = '';
  await engine.start();
  const shareCode = readShareFromLocation();
  if (shareCode) shared = await decodeShare(shareCode);
  const style = shared?.style ?? pickStartStyle();
  const seedParam = params.get('seed');
  const seed = shared?.seed ?? (seedParam ? Number(seedParam) >>> 0 : newSeed());
  conductor = new Conductor(
    { now: () => engine.now(), play: (n) => engine.play(n), emit: onEvent },
    { seed, style, bpm: shared?.bpm, key: shared?.key },
  );
  initial = { style, bpm: conductor.bpm, key: conductor.key };
  engine.applyStyle(style);
  await engine.loadFirst(style, (f) => (scene.progress = f * 0.6));
  const rest = engine.loadStyle(style);
  // the first tap only needs the piano; the band can finish loading in the background
  await Promise.race([rest, new Promise((r) => setTimeout(r, 2500))]);
  scene.progress = 1;
  phase = 'main';
  scene.state = 'main';
  menu.show(true);
  updateInfo();
  if (DEBUG) {
    (window as unknown as Record<string, unknown>).__tapjazz = { engine, conductor, scene, tap };
    debug = new DebugPanel(seed, {
      toggleSynthPiano: () => {
        engine.forceSynthPiano = !engine.forceSynthPiano;
        return engine.forceSynthPiano ? 'synth' : 'samples';
      },
      reloadSeed: () => {
        const u = new URL(location.href);
        u.searchParams.set('seed', String(seed));
        u.hash = '';
        location.href = u.toString();
      },
    });
  }
  if (shared) {
    scene.hint = '共有されたセッションを再生中…';
    conductor.startReplay(shared.rec, engine.now() + 0.3);
  } else scene.hint = 'タップし続けてください';
  setInterval(() => conductor?.tick(), 25);
  // preload the other styles while the user plays
  rest.then(async () => {
    for (const s of STYLE_ORDER) if (s !== style) await engine.loadStyle(s);
  });
}

function tap(x: number, y: number) {
  if (phase === 'start') {
    void begin();
    return;
  }
  if (phase !== 'main' || !conductor) return;
  if (conductor.replaying) return;
  const notes = conductor.tap(engine.now());
  const strength = notes.length ? notes[0].vel : 0.5;
  scene.tap(x, y, strength);
  if (scene.hint && conductor.tapCount + 1 >= 3) scene.hint = '';
}

function longPress() {
  if (phase !== 'main' || !conductor || conductor.replaying) return;
  conductor.input('style');
  void engine.loadStyle(nextStyle(conductor.style.id));
  scene.showLabel(`— next: ${STYLES[nextStyle(conductor.style.id)].name}`);
}

bindInput(canvas, { tap, longPress });

// iPad / iPhone: audio can only be unlocked (or resumed after an interruption)
// inside these gestures, so try on every one of them.
for (const ev of ['pointerup', 'touchend', 'click', 'keydown'])
  document.addEventListener(
    ev,
    () => {
      if (phase !== 'start' && !document.hidden) engine.unlock();
    },
    { capture: true, passive: true },
  );

// background tab: pause; come back: resume
document.addEventListener('visibilitychange', () => {
  if (!engine.started) return;
  if (document.hidden) void engine.setMuted(true);
  else if (!menu.muted) void engine.setMuted(false);
});

function loop() {
  const now = engine.now();
  scene.frame(now);
  const pos = conductor?.position(now);
  if (pos && pos.abs === chordBar.abs) chordBar.beat(pos.beat);
  scene.topInset = chordBar.bottom();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// offline: cache the app and samples after the first visit
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is optional */
    });
  });
}
