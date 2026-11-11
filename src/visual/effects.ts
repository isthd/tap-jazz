// Small particle / ripple systems for the canvas scene.

export interface Ripple {
  x: number;
  y: number;
  t0: number;
  strength: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  hue: number; // colour temperature as hue
  a: number;
}

export interface Smoke {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  a: number;
  phase: number;
}

export class Effects {
  ripples: Ripple[] = [];
  particles: Particle[] = [];
  smoke: Smoke[] = [];
  maxParticles = 260;

  initSmoke(w: number, h: number, n = 7) {
    this.smoke = [];
    for (let i = 0; i < n; i++) {
      this.smoke.push({
        x: Math.random() * w,
        y: h * (0.15 + Math.random() * 0.6),
        r: Math.max(w, h) * (0.18 + Math.random() * 0.25),
        vx: (Math.random() - 0.5) * 6,
        vy: -2 - Math.random() * 3,
        a: 0.025 + Math.random() * 0.035,
        phase: Math.random() * 10,
      });
    }
  }

  ripple(x: number, y: number, t: number, strength: number) {
    this.ripples.push({ x, y, t0: t, strength });
    if (this.ripples.length > 24) this.ripples.shift();
  }

  burst(x: number, y: number, hue: number, n: number, spread = 1) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6 * spread;
      const sp = 12 + Math.random() * 30;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 30 * spread,
        y: y + (Math.random() - 0.5) * 16,
        vx: Math.cos(ang) * sp * 0.5,
        vy: Math.sin(ang) * sp,
        life: 0,
        max: 2.5 + Math.random() * 3,
        r: 1 + Math.random() * 2.2,
        hue,
        a: 0.5 + Math.random() * 0.5,
      });
    }
  }

  update(dt: number, w: number, h: number, reduced: boolean) {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt + Math.sin(p.life * 2 + p.hue) * 6 * dt;
      p.y += p.vy * dt;
      p.vy *= 0.995;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (!reduced) {
      for (const s of this.smoke) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.phase += dt * 0.1;
        if (s.y < -s.r) s.y = h + s.r * 0.5;
        if (s.x < -s.r) s.x = w + s.r;
        if (s.x > w + s.r) s.x = -s.r;
      }
    }
  }
}
