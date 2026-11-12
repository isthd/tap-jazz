// Night jazz bar: back wall, stage with abstract silhouettes, spotlights,
// the candle on the counter (the tap target), ripples, particles and smoke.
import type { ChannelId, PartId, ScheduledNote } from '../music/types';
import { Effects } from './effects';

const HUE: Record<ChannelId, number> = { bass: 28, drums: 44, guitar: 14, perc: 352, piano: 205, tap: 38 };
const POS: Record<PartId, number> = { guitar: 0.17, drums: 0.36, bass: 0.53, piano: 0.73, perc: 0.9 };

interface PartVis {
  joinedAt: number; // performance seconds, -1 if not joined
  glow: number;
}

export type SceneState = 'start' | 'loading' | 'main';

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  fx = new Effects();
  state: SceneState = 'start';
  progress = 0;
  private parts: Record<PartId, PartVis> = {
    bass: { joinedAt: -1, glow: 0 },
    drums: { joinedAt: -1, glow: 0 },
    guitar: { joinedAt: -1, glow: 0 },
    perc: { joinedAt: -1, glow: 0 },
    piano: { joinedAt: -1, glow: 0 },
  };
  private lead: PartId | null = null;
  private leadLevel: Record<PartId, number> = { bass: 0, drums: 0, guitar: 0, perc: 0, piano: 0 };
  private queue: ScheduledNote[] = [];
  private tapGlow = 0;
  private label = { text: '', t0: -10 };
  info = '';
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private lowQuality = false;
  private slowFrames = 0;
  private lastT = performance.now() / 1000;
  hint = '';
  /** Height of DOM overlays at the top of the screen (the neon sign stays below them). */
  topInset = 0;
  private neonFlicker = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    addEventListener('resize', () => this.resize());
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => (this.reduced = e.matches));
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.fx.initSmoke(this.w, this.h, this.lowQuality ? 3 : 7);
  }

  get candle() {
    return { x: this.w / 2, y: this.h * 0.8 };
  }

  join(part: PartId) {
    this.parts[part].joinedAt = performance.now() / 1000;
    this.showLabel(`— ${part === 'perc' ? 'percussion' : part}`);
  }

  resetParts() {
    for (const p of Object.values(this.parts)) {
      p.joinedAt = -1;
      p.glow = 0;
    }
    this.lead = null;
  }

  setLead(p: PartId | null) {
    this.lead = p;
    if (p) this.showLabel(p === 'drums' ? '— drums, four bars' : `— ${p} solo`);
  }

  showLabel(text: string) {
    this.label = { text, t0: performance.now() / 1000 };
  }

  notes(ns: ScheduledNote[]) {
    for (const n of ns) this.queue.push(n);
    if (this.queue.length > 600) this.queue.splice(0, this.queue.length - 600);
  }

  tap(x: number, y: number, strength: number) {
    const t = performance.now() / 1000;
    this.fx.ripple(x, y, t, strength);
    this.tapGlow = Math.min(1.4, this.tapGlow + 0.35 + strength * 0.3);
    const c = this.candle;
    this.fx.burst(c.x, c.y - 30, HUE.tap, this.reduced ? 2 : 5, 0.6);
  }

  /** Draw a frame. audioNow: AudioContext time (for note flashes). */
  frame(audioNow: number) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - this.lastT);
    this.lastT = now;
    // adaptive quality
    if (dt > 0.024) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (!this.lowQuality && this.slowFrames > 90) {
      this.lowQuality = true;
      this.fx.maxParticles = 90;
      this.fx.initSmoke(this.w, this.h, 3);
    }
    // fire due notes
    let i = 0;
    for (; i < this.queue.length; i++) {
      const n = this.queue[i];
      if (n.time > audioNow) break;
      if (audioNow - n.time > 0.3) continue;
      if (n.ch === 'tap') continue;
      const p = this.parts[n.ch as PartId];
      if (!p) continue;
      p.glow = Math.min(1.3, p.glow + n.vel * (n.ch === 'drums' ? 0.25 : 0.45));
      const prob = n.ch === 'drums' || n.ch === 'perc' ? 0.12 : 0.45;
      if (Math.random() < prob * (this.lowQuality ? 0.4 : 1)) {
        const { x, y } = this.partPos(n.ch as PartId);
        this.fx.burst(x, y - this.unit * 0.7, HUE[n.ch], 1, 0.8);
      }
    }
    this.queue.splice(0, i);
    for (const k of Object.keys(this.parts) as PartId[]) {
      this.parts[k].glow *= Math.pow(0.04, dt);
      const target = this.lead === k ? 1 : 0;
      this.leadLevel[k] += (target - this.leadLevel[k]) * Math.min(1, dt * 2);
    }
    this.tapGlow *= Math.pow(0.15, dt);
    if (!this.reduced && Math.random() < 0.004) this.neonFlicker = 0.35;
    this.neonFlicker += (1 - this.neonFlicker) * Math.min(1, dt * 8);
    this.fx.update(dt, this.w, this.h, this.reduced);
    this.draw(now);
  }

  private get portrait() {
    return this.h > this.w * 1.2;
  }

  private get unit() {
    return this.portrait ? Math.min(this.w / 4.1, this.h * 0.16) : Math.min(this.w / 5.2, this.h * 0.2);
  }

  private partPos(p: PartId) {
    const x = this.portrait ? 0.5 + (POS[p] - 0.53) * 1.08 : POS[p];
    return { x: this.w * x, y: this.h * 0.56 };
  }

  private draw(now: number) {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // back wall
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#04060d');
    bg.addColorStop(0.55, '#0a0f1f');
    bg.addColorStop(1, '#05060a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const main = this.state === 'main';
    const stageA = main ? 1 : 0.25;

    // art-deco panel lines
    ctx.save();
    ctx.globalAlpha = 0.07 * stageA;
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 1;
    const step = Math.max(60, w / 10);
    for (let x = step / 2; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.05);
      ctx.lineTo(x, h * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 10, h * 0.05);
      ctx.lineTo(x, h * 0.02);
      ctx.lineTo(x + 10, h * 0.05);
      ctx.stroke();
    }
    ctx.restore();

    // wall sconces
    for (const sx of [0.06, 0.94]) this.glowDot(w * sx, h * 0.24, Math.min(w, h) * 0.12, `rgba(255,170,80,${0.12 * stageA})`);

    // neon sign
    this.neon(now, stageA);

    // stage floor
    const sy = h * 0.56;
    const floor = ctx.createLinearGradient(0, sy - 10, 0, h * 0.72);
    floor.addColorStop(0, `rgba(70,42,20,${0.55 * stageA})`);
    floor.addColorStop(1, 'rgba(10,8,8,0)');
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.ellipse(w / 2, sy, w * 0.55, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // spotlights + silhouettes
    if (main) {
      for (const p of Object.keys(POS) as PartId[]) this.spot(p, now);
      for (const p of Object.keys(POS) as PartId[]) this.figure(p, now);
    }

    // smoke
    if (!this.reduced || this.lowQuality) {
      for (const s of this.fx.smoke) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        const a = s.a * (0.7 + 0.3 * Math.sin(s.phase)) * (main ? 1 : 0.6);
        g.addColorStop(0, `rgba(170,150,140,${a})`);
        g.addColorStop(1, 'rgba(170,150,140,0)');
        ctx.fillStyle = g;
        ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      }
    }

    // counter
    const cy = h * 0.74;
    const counter = ctx.createLinearGradient(0, cy, 0, h);
    counter.addColorStop(0, '#2a170c');
    counter.addColorStop(0.08, '#160c07');
    counter.addColorStop(1, '#070405');
    ctx.fillStyle = counter;
    ctx.fillRect(0, cy, w, h - cy);
    const edge = ctx.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(217,164,65,0)');
    edge.addColorStop(0.5, `rgba(240,180,90,${0.55 + this.tapGlow * 0.2})`);
    edge.addColorStop(1, 'rgba(217,164,65,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, cy, w, 2);

    // particles
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.fx.particles) {
      const k = 1 - p.life / p.max;
      ctx.fillStyle = `hsla(${p.hue},85%,65%,${p.a * k * 0.8})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.6 + 0.4 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // ripples
    for (const r of this.fx.ripples) {
      const age = now - r.t0;
      if (age > 1.6) continue;
      const k = age / 1.6;
      ctx.strokeStyle = `rgba(255,190,110,${(1 - k) * (0.35 + r.strength * 0.4)})`;
      ctx.lineWidth = 1.5 + r.strength * 2 * (1 - k);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 20 + k * (90 + r.strength * 120), (20 + k * (90 + r.strength * 120)) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.candleDraw(now);
    this.texts(now);
  }

  private glowDot(x: number, y: number, r: number, color: string) {
    const g = this.ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  private neon(now: number, a: number) {
    const { ctx, w, h } = this;
    const size = Math.max(18, Math.min(42, w * 0.045));
    ctx.save();
    ctx.font = `${size}px "Poiret One", "Josefin Sans", sans-serif`;
    ctx.textAlign = 'left';
    const x = w * 0.06;
    const y = Math.max(h * 0.11, this.topInset + size + 6);
    const fl = this.neonFlicker * (0.92 + 0.08 * Math.sin(now * 13));
    ctx.globalAlpha = Math.max(0.15, a) * fl;
    ctx.shadowColor = 'rgba(255,40,60,0.9)';
    ctx.shadowBlur = this.lowQuality ? 0 : 18;
    ctx.fillStyle = '#ff5a6e';
    ctx.fillText('Tap Jazz', x, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,220,225,0.8)';
    ctx.fillText('Tap Jazz', x, y);
    ctx.restore();
  }

  private spot(p: PartId, _now: number) {
    const v = this.parts[p];
    if (v.joinedAt < 0) return;
    const { ctx, h } = this;
    const fade = Math.min(1, (performance.now() / 1000 - v.joinedAt) / 2.5);
    const { x, y } = this.partPos(p);
    const lead = this.leadLevel[p];
    const a = (0.05 + v.glow * 0.12 + lead * 0.22) * fade;
    const topW = this.unit * 0.15;
    const botW = this.unit * (0.75 + lead * 0.25);
    const g = ctx.createLinearGradient(0, 0, 0, y + 10);
    const warm = p === 'piano' ? '255,225,190' : '255,200,140';
    g.addColorStop(0, `rgba(${warm},${a * 0.2})`);
    g.addColorStop(1, `rgba(${warm},${a})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - topW, 0);
    ctx.lineTo(x + topW, 0);
    ctx.lineTo(x + botW, y + 6);
    ctx.lineTo(x - botW, y + 6);
    ctx.closePath();
    ctx.fill();
    // pool of light on the floor
    ctx.fillStyle = `rgba(${warm},${a * 0.6})`;
    ctx.beginPath();
    ctx.ellipse(x, y + 4, botW, h * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private figure(p: PartId, now: number) {
    const v = this.parts[p];
    if (v.joinedAt < 0) return;
    const { ctx } = this;
    const fade = Math.min(1, (now - v.joinedAt) / 2.5);
    const { x, y } = this.partPos(p);
    const s = this.unit;
    const sway = this.reduced ? 0 : Math.sin(now * 2.1 + POS[p] * 10) * s * 0.008 * (0.5 + v.glow);
    ctx.save();
    ctx.globalAlpha = fade;
    const rim = Math.min(1, 0.15 + v.glow * 0.6 + this.leadLevel[p] * 0.5);
    if (!this.lowQuality) {
      ctx.shadowColor = `hsla(${HUE[p]},90%,60%,${rim})`;
      ctx.shadowBlur = 6 + rim * 18;
    }
    ctx.fillStyle = '#020307';
    ctx.strokeStyle = `hsla(${HUE[p]},80%,62%,${rim * 0.8})`;
    ctx.lineWidth = 1.2;
    ctx.translate(x + sway, y);
    const path = new Path2D();
    const person = (px: number, seated: boolean, scale = 1) => {
      const k = s * scale;
      path.ellipse(px, -k * (seated ? 0.78 : 0.95), k * 0.075, k * 0.09, 0, 0, Math.PI * 2);
      const top = -k * (seated ? 0.66 : 0.83);
      const hip = -k * (seated ? 0.3 : 0.45);
      path.moveTo(px - k * 0.13, top);
      path.quadraticCurveTo(px, top - k * 0.04, px + k * 0.13, top);
      path.lineTo(px + k * 0.1, hip);
      path.lineTo(px - k * 0.1, hip);
      path.closePath();
      if (seated) {
        path.rect(px - k * 0.1, hip, k * 0.26, k * 0.07);
        path.rect(px + k * 0.1, hip, k * 0.06, -hip);
      } else {
        path.rect(px - k * 0.09, hip, k * 0.07, -hip);
        path.rect(px + k * 0.02, hip, k * 0.07, -hip);
      }
    };
    switch (p) {
      case 'bass': {
        person(-s * 0.08, false);
        // upright bass: two lobes + neck
        path.ellipse(s * 0.14, -s * 0.22, s * 0.14, s * 0.2, -0.12, 0, Math.PI * 2);
        path.ellipse(s * 0.11, -s * 0.5, s * 0.1, s * 0.14, -0.12, 0, Math.PI * 2);
        path.rect(s * 0.05, -s * 1.12, s * 0.025, s * 0.55);
        break;
      }
      case 'drums': {
        person(0, true);
        path.ellipse(0, -s * 0.2, s * 0.2, s * 0.2, 0, 0, Math.PI * 2);
        path.ellipse(-s * 0.3, -s * 0.36, s * 0.11, s * 0.035, 0, 0, Math.PI * 2);
        path.ellipse(s * 0.32, -s * 0.62, s * 0.18, s * 0.025, 0.12, 0, Math.PI * 2);
        path.ellipse(-s * 0.36, -s * 0.66, s * 0.15, s * 0.022, -0.1, 0, Math.PI * 2);
        path.rect(s * 0.31, -s * 0.62, s * 0.012, s * 0.62);
        path.rect(-s * 0.37, -s * 0.66, s * 0.012, s * 0.66);
        break;
      }
      case 'piano': {
        // grand piano with raised lid, player on the right
        path.moveTo(-s * 0.55, -s * 0.42);
        path.quadraticCurveTo(-s * 0.6, -s * 0.62, -s * 0.3, -s * 0.6);
        path.lineTo(s * 0.12, -s * 0.5);
        path.lineTo(s * 0.12, -s * 0.38);
        path.lineTo(-s * 0.55, -s * 0.38);
        path.closePath();
        path.moveTo(-s * 0.5, -s * 0.6);
        path.lineTo(-s * 0.1, -s * 0.95);
        path.lineTo(-s * 0.06, -s * 0.92);
        path.lineTo(-s * 0.3, -s * 0.6);
        path.closePath();
        path.rect(-s * 0.5, -s * 0.38, s * 0.03, s * 0.38);
        path.rect(s * 0.07, -s * 0.38, s * 0.03, s * 0.38);
        person(s * 0.3, true);
        break;
      }
      case 'guitar': {
        person(0, true);
        path.ellipse(s * 0.06, -s * 0.38, s * 0.15, s * 0.1, -0.5, 0, Math.PI * 2);
        path.moveTo(s * 0.12, -s * 0.44);
        path.lineTo(s * 0.42, -s * 0.66);
        path.lineTo(s * 0.43, -s * 0.63);
        path.lineTo(s * 0.14, -s * 0.4);
        path.closePath();
        break;
      }
      case 'perc': {
        person(0, false, 0.92);
        const lift = v.glow * s * 0.05;
        path.ellipse(-s * 0.16, -s * 0.62 - lift, s * 0.03, s * 0.03, 0, 0, Math.PI * 2);
        path.ellipse(s * 0.16, -s * 0.62 - lift, s * 0.03, s * 0.03, 0, 0, Math.PI * 2);
        break;
      }
    }
    ctx.fill(path);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = fade * rim;
    ctx.stroke(path);
    ctx.restore();
  }

  private candleDraw(now: number) {
    const { ctx } = this;
    const { x, y } = this.candle;
    const flick = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(now * 9.3) * Math.sin(now * 3.7 + 1);
    const glowR = (70 + this.tapGlow * 90) * flick * (this.state === 'start' ? 1.3 : 1);
    this.glowDot(x, y - 22, glowR * 1.8, `rgba(255,150,60,${0.18 + this.tapGlow * 0.15})`);
    this.glowDot(x, y - 22, glowR * 0.6, `rgba(255,200,120,${0.35 + this.tapGlow * 0.2})`);
    // glass holder
    ctx.fillStyle = 'rgba(120,40,30,0.55)';
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 14);
    ctx.lineTo(x + 13, y - 14);
    ctx.lineTo(x + 11, y + 6);
    ctx.lineTo(x - 11, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,170,90,0.35)';
    ctx.fillRect(x - 13, y - 15, 26, 2);
    // flame
    const fh = 16 * (0.9 + 0.2 * flick) + this.tapGlow * 6;
    const g = ctx.createRadialGradient(x, y - 18, 1, x, y - 20, fh);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.4, 'rgba(255,190,90,0.9)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    const sway = this.reduced ? 0 : Math.sin(now * 5.1) * 1.5;
    ctx.moveTo(x - 5, y - 14);
    ctx.quadraticCurveTo(x - 6, y - 14 - fh * 0.6, x + sway, y - 14 - fh);
    ctx.quadraticCurveTo(x + 6, y - 14 - fh * 0.6, x + 5, y - 14);
    ctx.closePath();
    ctx.fill();
  }

  private texts(now: number) {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.textAlign = 'center';
    if (this.state === 'start' || this.state === 'loading') {
      const pulse = this.reduced ? 1 : 0.65 + 0.35 * Math.sin(now * 2);
      ctx.font = `${Math.max(22, Math.min(40, w * 0.06))}px "Poiret One", sans-serif`;
      ctx.fillStyle = `rgba(255,214,150,${this.state === 'start' ? pulse : 0.85})`;
      ctx.fillText(this.state === 'start' ? 'Tap to begin' : 'tuning up…', w / 2, h * 0.5);
      if (this.state === 'loading') {
        ctx.fillStyle = 'rgba(255,214,150,0.15)';
        ctx.fillRect(w / 2 - 80, h * 0.53, 160, 2);
        ctx.fillStyle = 'rgba(255,214,150,0.7)';
        ctx.fillRect(w / 2 - 80, h * 0.53, 160 * this.progress, 2);
      }
      if (this.hint) {
        ctx.font = `13px "Josefin Sans", sans-serif`;
        ctx.fillStyle = 'rgba(230,210,190,0.55)';
        ctx.fillText(this.hint, w / 2, h * 0.58);
      }
    } else {
      const age = now - this.label.t0;
      if (age < 3.5 && this.label.text) {
        const a = Math.min(1, age * 2) * Math.min(1, (3.5 - age) / 1.2);
        ctx.font = `italic ${Math.max(16, Math.min(24, w * 0.035))}px "Josefin Sans", sans-serif`;
        ctx.fillStyle = `rgba(255,220,170,${a * 0.85})`;
        ctx.fillText(this.label.text, w / 2, h * 0.66);
      }
      if (this.info) {
        ctx.font = `12px "Josefin Sans", sans-serif`;
        ctx.fillStyle = 'rgba(230,210,190,0.35)';
        ctx.fillText(this.info, w / 2, h - 18);
      }
      if (this.hint) {
        ctx.font = `13px "Josefin Sans", sans-serif`;
        ctx.fillStyle = 'rgba(230,210,190,0.45)';
        ctx.fillText(this.hint, w / 2, h * 0.92);
      }
    }
    ctx.restore();
  }
}
