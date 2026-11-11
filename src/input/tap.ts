// Unified input: pointer (tap / long press) and keyboard (space / shift+space).

export interface TapHandlers {
  tap(x: number, y: number): void;
  longPress(): void;
}

const LONG_MS = 600;

export function bindInput(el: HTMLElement, h: TapHandlers) {
  const timers = new Map<number, number>();
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    h.tap(e.clientX, e.clientY);
    const id = e.pointerId;
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        h.longPress();
      }, LONG_MS),
    );
  });
  const up = (e: PointerEvent) => {
    const t = timers.get(e.pointerId);
    if (t) clearTimeout(t);
    timers.delete(e.pointerId);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  let spaceTimer = 0;
  let spaceLong = false;
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || (e.target as HTMLElement)?.closest?.('input, select, button, textarea')) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.shiftKey) {
      h.longPress();
      return;
    }
    h.tap(innerWidth / 2, innerHeight * 0.8);
    spaceLong = false;
    spaceTimer = window.setTimeout(() => {
      spaceLong = true;
      h.longPress();
    }, LONG_MS);
  });
  addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    clearTimeout(spaceTimer);
    void spaceLong;
  });
}
