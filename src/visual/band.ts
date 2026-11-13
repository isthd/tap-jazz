// The band: five voxel musicians built with three.js, rendered into a tiny
// off-screen WebGL canvas and blown up with nearest-neighbour scaling so they
// read as pixel art. The 2D scene composites them between the spotlights and
// the smoke, adding a one-pixel dark outline.
import * as THREE from 'three';
import type { DrumId, PartId } from '../music/types';

const V = 40; // voxels per scene "unit" (a standing figure is ~40 voxels tall)

type Col = number;

interface Look {
  skin: Col;
  hair: Col;
  hairStyle: 'afro' | 'pompadour' | 'long' | 'dreads' | 'fedora';
  jacket: Col;
  shirt: Col;
  pants: Col;
  shoes: Col;
  legs?: Col; // bare legs (dress)
  tie?: Col;
  beard?: Col;
  glasses?: boolean;
  eyes?: Col;
}

interface Body {
  root: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group; // viewer's right (the player's left)
  armR: THREE.Group; // viewer's left (the player's right)
  torso: THREE.Group;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function boxGeo(w: number, h: number, d: number) {
  const k = `${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}

/** One musician: owns its materials so it can glow in its own colour. */
class Rig {
  root = new THREE.Group(); // positioned on screen
  inner = new THREE.Group(); // voxel space, feet at y=0
  mats: THREE.MeshLambertMaterial[] = [];
  private cache = new Map<Col, THREE.MeshLambertMaterial>();
  // animation state
  hitL = -10;
  hitR = -10;
  hitK = -10;
  hitAny = -10;
  alt = 0;
  body!: Body;
  extra: Record<string, THREE.Object3D> = {};

  constructor(public hue: number) {
    this.root.add(this.inner);
  }

  mat(c: Col) {
    let m = this.cache.get(c);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: c, flatShading: true });
      this.cache.set(c, m);
      this.mats.push(m);
    }
    return m;
  }

  box(p: THREE.Object3D, c: Col, x: number, y: number, z: number, w: number, h: number, d: number) {
    const m = new THREE.Mesh(boxGeo(w, h, d), this.mat(c));
    m.position.set(x, y, z);
    p.add(m);
    return m;
  }

  cyl(p: THREE.Object3D, c: Col, x: number, y: number, z: number, r: number, h: number, seg = 10) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), this.mat(c));
    m.position.set(x, y, z);
    p.add(m);
    return m;
  }

  group(p: THREE.Object3D, x: number, y: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    p.add(g);
    return g;
  }

  /** A blocky person. seated: hips at y=10 on a stool, otherwise standing (hips at 15). */
  person(p: THREE.Object3D, L: Look, seated: boolean): Body {
    const root = this.group(p, 0, 0, 0);
    const hip = seated ? 10 : 15;
    const legC = L.legs ?? L.pants;
    if (seated) {
      // stool
      this.box(root, 0x2a1a12, 0, hip - 2, -1, 11, 2, 9);
      this.box(root, 0x1a100b, 0, (hip - 3) / 2, -1, 2, hip - 3, 2);
      for (const sx of [-2.5, 2.5]) {
        this.box(root, L.pants, sx, hip - 0.5, 4, 4.4, 4, 10); // thighs
        this.box(root, legC, sx, (hip - 2) / 2 + 1, 8, 4, hip - 2, 4); // shins
        this.box(root, L.shoes, sx, 1, 9.5, 4.4, 2, 6);
      }
    } else {
      for (const sx of [-2.5, 2.5]) {
        this.box(root, legC, sx, (hip - 2) / 2 + 2, 0, 4, hip - 2, 4);
        this.box(root, L.shoes, sx, 1, 1, 4.4, 2, 6);
      }
      if (L.legs) this.box(root, L.pants, 0, hip - 2, 0, 11, 5, 6.5); // skirt hem
    }
    const torso = this.group(root, 0, hip, 0);
    this.box(torso, L.jacket, 0, 6, 0, 11, 12, 6);
    this.box(torso, L.shirt, 0, 7, 3.05, 3, 10, 0.2);
    if (L.tie) this.box(torso, L.tie, 0, 7.5, 3.2, 1.2, 7, 0.3);
    // head
    const head = this.group(torso, 0, 12, 0);
    this.box(head, L.skin, 0, 1, 0, 3, 2, 3);
    this.box(head, L.skin, 0, 6, 0, 8, 9, 8);
    this.box(head, L.skin, 0, 5.5, 4.4, 1.4, 2.4, 1.2); // nose
    if (L.glasses) {
      this.box(head, 0x0a0a0f, 0, 7, 4.15, 8, 1.8, 0.4);
    } else {
      for (const ex of [-1.8, 1.8]) {
        this.box(head, 0xf4f0e8, ex, 7, 4.05, 1.6, 1.2, 0.2);
        this.box(head, L.eyes ?? 0x2a4a8a, ex + 0.3, 7, 4.12, 0.8, 1.2, 0.2);
      }
      this.box(head, L.hair, 0, 8.6, 4.1, 7, 0.7, 0.3); // brows
    }
    if (L.beard) {
      this.box(head, L.beard, 0, 2.7, 3.2, 8.2, 3.4, 2);
      this.box(head, L.beard, 0, 4.4, 4.3, 4, 1, 0.6); // moustache
    } else {
      this.box(head, 0x7a2e2a, 0, 3.6, 4.05, 2.6, 0.7, 0.2); // mouth
    }
    this.hair(head, L);
    // arms pivot at the shoulders
    const arm = (x: number) => {
      const g = this.group(torso, x, 11, 0);
      this.box(g, L.jacket, 0, -5, 0, 3, 11, 3.4);
      this.box(g, L.skin, 0, -11.5, 0, 2.8, 2.6, 2.8);
      return g;
    };
    const armR = arm(-7);
    const armL = arm(7);
    return { root, head, armL, armR, torso };
  }

  private hair(h: THREE.Group, L: Look) {
    const c = L.hair;
    switch (L.hairStyle) {
      case 'afro':
        this.box(h, c, 0, 8, -1.5, 13, 12, 10);
        this.box(h, c, 0, 11.5, 2.5, 11, 3, 3);
        break;
      case 'pompadour':
        this.box(h, c, 0, 10.8, 0, 8.4, 1.8, 8.4);
        this.box(h, c, 0, 11.8, 3, 8.4, 2.4, 4);
        this.box(h, c, 0, 7, -4.1, 8.4, 8, 0.8);
        for (const sx of [-4.1, 4.1]) this.box(h, c, sx, 7.5, -1, 0.8, 5, 6);
        break;
      case 'long':
        this.box(h, c, 0, 10.6, 0, 8.6, 1.6, 8.6);
        this.box(h, c, 0, 4, -4, 9, 14, 1.6);
        for (const sx of [-4.4, 4.4]) this.box(h, c, sx, 5, -0.5, 1, 11, 7.5);
        this.box(h, c, 0.8, 9.6, 4.2, 6.5, 1.6, 0.6); // fringe
        break;
      case 'dreads':
        this.box(h, c, 0, 10.6, 0, 8.6, 1.8, 8.6);
        for (let i = 0; i < 9; i++) {
          const a = -2.0 + (i / 8) * 4.0;
          this.box(h, c, Math.sin(a) * 4.6, 4 + (i % 2), -Math.cos(a) * 4 + 0.5, 1.6, 12 - (i % 3), 1.6);
        }
        this.box(h, 0xd9a441, 0, 9.8, 0, 8.8, 0.9, 8.8); // band
        break;
      case 'fedora':
        for (const sx of [-4.1, 4.1]) this.box(h, c, sx, 6.5, -1, 0.8, 4, 6);
        this.box(h, c, 0, 6.5, -4.1, 8.4, 5, 0.8);
        this.box(h, 0x2b2622, 0, 10.6, 0, 14, 0.9, 13);
        this.box(h, 0x2b2622, 0, 13, 0, 9, 4.2, 9);
        this.box(h, 0x9b3a2a, 0, 11.6, 0, 9.2, 1, 9.2);
        break;
    }
  }
}

export interface PartDrawState {
  joinedAge: number; // seconds since joining, <0 if absent
  glow: number;
  lead: number;
}

export class Band {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 4000);
  private rigs = {} as Record<PartId, Rig>;
  private outline: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private lw = 1;
  private lh = 1;
  private w = 1;
  private h = 1;
  ok = true;

  constructor() {
    this.outline = document.createElement('canvas');
    this.octx = this.outline.getContext('2d')!;
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.ok = false;
    }
    this.camera.position.z = 2000;
    this.scene.add(new THREE.HemisphereLight(0x6a78b0, 0x2a1408, 1.6));
    const key = new THREE.DirectionalLight(0xffd6a0, 2.6);
    key.position.set(0.35, 1, 0.9);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8090ff, 0.5);
    fill.position.set(-1, 0.2, 0.5);
    this.scene.add(fill);
    this.build();
  }

  resize(w: number, h: number, pixel: number) {
    this.w = w;
    this.h = h;
    this.lw = Math.max(1, Math.ceil(w / pixel));
    this.lh = Math.max(1, Math.ceil(h / pixel));
    this.renderer?.setSize(this.lw, this.lh, false);
    this.outline.width = this.lw;
    this.outline.height = this.lh;
    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = 0;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  hit(p: PartId, vel: number, drum?: DrumId) {
    const r = this.rigs[p];
    const t = performance.now() / 1000;
    if (vel < 0.05) return;
    r.hitAny = t;
    if (p === 'drums') {
      if (drum === 'kick') r.hitK = t;
      else if (drum === 'snare' || drum === 'rim' || drum === 'brushTap' || drum === 'brushSweep' || drum?.startsWith('tom')) r.hitL = t;
      else if (drum === 'hhPedal') return;
      else r.hitR = t;
      return;
    }
    r.alt ^= 1;
    if (r.alt) r.hitR = t;
    else r.hitL = t;
  }

  /** Render the band and composite it onto ctx (in CSS pixels). */
  draw(ctx: CanvasRenderingContext2D, pos: (p: PartId) => { x: number; y: number }, unit: number, st: Record<PartId, PartDrawState>, now: number, reduced: boolean) {
    if (!this.renderer) return;
    let any = false;
    const scale = unit / V;
    for (const p of Object.keys(this.rigs) as PartId[]) {
      const r = this.rigs[p];
      const s = st[p];
      r.root.visible = s.joinedAge >= 0;
      if (!r.root.visible) continue;
      any = true;
      const { x, y } = pos(p);
      // pop in: drop from above with a little squash
      const k = reduced ? 1 : Math.min(1, s.joinedAge / 0.7);
      const drop = (1 - k) * (1 - k) * unit * 0.6;
      const squash = reduced ? 1 : 1 + Math.sin(Math.min(1, s.joinedAge / 0.9) * Math.PI) * 0.12 * (1 - Math.min(1, s.joinedAge / 0.9));
      r.root.position.set(x, -y + drop, 0);
      r.root.scale.set(scale * (2 - squash), scale * squash, scale);
      this.animate(p, r, s, now, reduced);
      const rim = Math.min(1, s.glow * 0.4 + s.lead * 0.7);
      const em = new THREE.Color().setHSL(r.hue / 360, 0.85, 0.5).multiplyScalar(rim * rim * 0.09);
      for (const m of r.mats) m.emissive.copy(em);
    }
    if (!any) return;
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const o = this.octx;
    o.globalCompositeOperation = 'copy';
    o.drawImage(src, 0, 0);
    o.globalCompositeOperation = 'source-in';
    o.fillStyle = '#07050c';
    o.fillRect(0, 0, this.lw, this.lh);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const px = this.w / this.lw;
    const py = this.h / this.lh;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(this.outline, dx * px, dy * py, this.lw * px, this.lh * py);
    ctx.drawImage(src, 0, 0, this.lw * px, this.lh * py);
    ctx.restore();
  }

  private animate(p: PartId, r: Rig, s: PartDrawState, now: number, reduced: boolean) {
    const b = r.body;
    const env = (t: number) => (reduced ? 0 : Math.exp(-(now - t) * 10));
    const eL = env(r.hitL);
    const eR = env(r.hitR);
    const eA = env(r.hitAny);
    const groove = reduced ? 0 : Math.sin(now * 4.2 + r.hue) * (0.3 + Math.min(1, s.glow));
    b.head.rotation.x = 0.06 + eA * 0.12 + groove * 0.04;
    b.head.rotation.z = groove * 0.05;
    b.torso.rotation.z = groove * 0.025;
    switch (p) {
      case 'guitar':
        b.armR.rotation.set(-0.95 - eR * 0.25 + eL * 0.15, 0, -0.45 + eR * 0.12);
        b.armL.rotation.set(-0.85, 0, 1.05 + Math.sin(now * 1.3) * 0.05);
        break;
      case 'bass': {
        b.armL.rotation.set(-0.3, 0, 2.55);
        b.armR.rotation.set(-1.05, 0, 0.55 + (eR + eL) * 0.15);
        r.extra.bass.rotation.z = 0.12 + groove * 0.015;
        break;
      }
      case 'drums': {
        b.armR.rotation.set(-1.25 + eR * 0.55, 0, -0.35);
        b.armL.rotation.set(-1.05 + eL * 0.55, 0, 0.25);
        const k = env(r.hitK);
        r.extra.kick.scale.set(1 + k * 0.06, 1 + k * 0.06, 1);
        r.extra.ride.rotation.z = -0.18 + eR * 0.12;
        break;
      }
      case 'piano':
        b.armR.rotation.set(-1.15 + eR * 0.18, 0, -0.1);
        b.armL.rotation.set(-1.15 + eL * 0.18, 0, 0.1);
        b.root.rotation.y = -0.95 + groove * 0.03;
        break;
      case 'perc':
        b.armR.rotation.set(-0.7 + eR * 0.45, 0, -0.18);
        b.armL.rotation.set(-0.7 + eL * 0.45, 0, 0.18);
        break;
    }
  }

  private add(p: PartId, hue: number, yaw: number) {
    const r = new Rig(hue);
    r.inner.rotation.set(0.2, yaw, 0, 'YXZ');
    this.rigs[p] = r;
    this.scene.add(r.root);
    return r;
  }

  private build() {
    // Guitar — a blond rockabilly cat in shades with a sunburst archtop.
    {
      const r = this.add('guitar', 14, 0.35);
      r.body = r.person(r.inner, { skin: 0xf2c6a2, hair: 0xf3d36b, hairStyle: 'pompadour', jacket: 0x1f3a5a, shirt: 0xf2efe6, pants: 0x1a1d26, shoes: 0x2a1a10, tie: 0xb2222a, glasses: true }, true);
      const g = r.group(r.body.root, -1, 14, 6.5);
      g.rotation.z = 0.42;
      r.box(g, 0xb8501c, -4, 0, 0, 10, 12, 3); // lower bout
      r.box(g, 0xe08a2a, -4, 0, 1.4, 6, 7, 0.4); // sunburst centre
      r.box(g, 0xb8501c, 3, 0, 0, 7, 9, 3); // upper bout
      r.box(g, 0x20120a, 0, 0, 1.6, 2.4, 2.4, 0.3); // sound hole
      r.box(g, 0xd9c08a, -5, 0, 1.7, 1, 4, 0.4); // bridge
      r.box(g, 0x3a2414, 14, 0, 0.5, 16, 2, 1.4); // neck
      r.box(g, 0x231610, 24, 0, 0.5, 4, 3, 1.4); // headstock
    }
    // Drums — a bearded man with a big afro behind a small kit.
    {
      const r = this.add('drums', 44, 0.12);
      r.body = r.person(r.inner, { skin: 0x7a4a2c, hair: 0x1a120d, hairStyle: 'afro', jacket: 0x6a2a6a, shirt: 0xe8c860, pants: 0x30241c, shoes: 0x120c08, beard: 0x1a120d, eyes: 0x2a1a10 }, true);
      const kick = r.group(r.inner, 0, 7.5, 15);
      const kb = r.cyl(kick, 0xe8e2d4, 0, 0, 0, 7.5, 6, 12);
      kb.rotation.x = Math.PI / 2;
      const ring = r.cyl(kick, 0x8a1c22, 0, 0, 0, 7.9, 4, 12);
      ring.rotation.x = Math.PI / 2;
      r.extra.kick = kick;
      r.cyl(r.inner, 0xe8e2d4, -7, 15, 10, 4, 3); // snare
      r.box(r.inner, 0x9a9aa2, -7, 7, 10, 0.8, 14, 0.8);
      r.cyl(r.inner, 0x8a1c22, -3, 17.5, 15, 3.2, 3); // toms
      r.cyl(r.inner, 0x8a1c22, 3.5, 17.5, 15, 3.2, 3);
      r.box(r.inner, 0x9a9aa2, -13, 10, 8, 0.8, 20, 0.8); // hi-hat stand
      r.cyl(r.inner, 0xd9b04a, -13, 20, 8, 4.5, 0.6);
      r.cyl(r.inner, 0xd9b04a, -13, 20.9, 8, 4.5, 0.6);
      r.box(r.inner, 0x9a9aa2, 12, 11, 9, 0.8, 22, 0.8); // ride stand
      const ride = r.group(r.inner, 12, 22.5, 9);
      r.cyl(ride, 0xe0b850, 0, 0, 0, 6.5, 0.6, 12);
      r.extra.ride = ride;
      // sticks
      for (const a of [r.body.armL, r.body.armR]) {
        const s = r.box(a, 0xe8d2a0, 0, -12.5, 4.5, 0.8, 0.8, 9);
        s.rotation.x = 0.15;
      }
    }
    // Bass — a red-bearded giant in a fedora with his upright.
    {
      const r = this.add('bass', 28, -0.15);
      r.body = r.person(r.inner, { skin: 0xf0bfa0, hair: 0xb84a1e, hairStyle: 'fedora', jacket: 0x5a3b26, shirt: 0xe8dcc0, pants: 0x3a281a, shoes: 0x1a100a, beard: 0xb84a1e, tie: 0x2a3a5a }, false);
      const b = r.group(r.inner, 11, 0, 3);
      r.extra.bass = b;
      r.box(b, 0x2a1a10, 0, 1.5, 0, 1, 3, 1); // endpin
      r.box(b, 0x8a4a1a, 0, 9.5, 0, 15, 12, 5.5); // lower bout
      r.box(b, 0x8a4a1a, 0, 17.5, 0, 11, 5, 5.5); // waist
      r.box(b, 0x8a4a1a, 0, 23.5, 0, 12, 8, 5.5); // upper bout
      r.box(b, 0xa86020, 0, 15, 2.8, 9, 18, 0.3); // top highlight
      for (const fx of [-3, 3]) r.box(b, 0x1a0e08, fx, 17, 2.95, 0.8, 5, 0.2); // f-holes
      r.box(b, 0x1a0e08, 0, 10.5, 3.2, 2, 3, 1); // tailpiece
      r.box(b, 0xd9c08a, 0, 14, 3.1, 4.5, 1.6, 0.6); // bridge
      r.box(b, 0x22140c, 0, 35, 1.5, 2.2, 16, 2); // neck
      r.box(b, 0x3a2414, 0, 44.5, 1, 3, 4, 3); // scroll
      for (const sx of [-0.6, 0.6]) r.box(b, 0xd8d0c0, sx, 27, 3.2, 0.25, 28, 0.2); // strings
    }
    // Piano — a platinum blonde in a red dress at a black grand.
    {
      const r = this.add('piano', 205, 0.22);
      const pg = r.group(r.inner, -10, 0, 0);
      r.box(pg, 0x16161e, -4, 16, 0, 26, 4, 16); // case
      r.box(pg, 0x3a3a48, -4, 18.1, 8.05, 26, 0.4, 0.2); // rim highlight
      r.box(pg, 0x0b0b10, -21, 16, -2, 8, 4, 10); // tail
      const lid = r.group(pg, -6, 18, -8);
      const l = r.box(lid, 0x22222c, 0, 0, 8, 30, 0.8, 16);
      l.position.set(-2, 0, 8);
      lid.rotation.x = -1.0;
      r.box(pg, 0x101016, -2, 23, -1, 0.6, 10, 0.6); // prop stick
      for (const [lx, lz] of [[-20, -3], [6, -5], [6, 5]]) r.box(pg, 0x0b0b10, lx, 7, lz, 2.5, 14, 2.5);
      r.box(pg, 0x15151d, 10.5, 14.5, 0, 3, 3, 16); // key bed
      r.box(pg, 0xf2efe6, 10.6, 16.4, 0, 3, 0.8, 14.5); // white keys
      for (let i = 0; i < 6; i++) r.box(pg, 0x101010, 10, 17, -6 + i * 2.4, 1.6, 0.6, 1);
      r.box(pg, 0xd8c8a0, 6, 21, 0, 0.6, 5, 8); // music sheet
      // pianist on a bench, turned towards the keys
      const seat = r.group(r.inner, 13, 0, 0);
      r.body = r.person(seat, { skin: 0xf6d2bc, hair: 0xf6ecc0, hairStyle: 'long', jacket: 0xb8122a, shirt: 0xd02a3a, pants: 0xb8122a, shoes: 0xb8122a, legs: 0xf6d2bc, eyes: 0x3a7a5a }, true);
      r.body.root.rotation.y = -0.95;
    }
    // Percussion — dreadlocks, a loud island shirt and a pair of congas.
    {
      const r = this.add('perc', 352, -0.3);
      r.body = r.person(r.inner, { skin: 0x5a341e, hair: 0x2a1a10, hairStyle: 'dreads', jacket: 0x1f8a6a, shirt: 0xf0c040, pants: 0xe8e2d4, shoes: 0x8a3a1a, eyes: 0x2a1a10 }, false);
      for (const [cx, rr] of [[-4.5, 4.2], [4.5, 4.6]] as const) {
        const c = r.cyl(r.inner, 0xa0521c, cx, 9, 9, rr, 18, 10);
        c.rotation.x = 0.12;
        r.cyl(r.inner, 0xeadcc0, cx, 18.2, 10.1, rr + 0.2, 0.6, 10).rotation.x = 0.12;
        r.cyl(r.inner, 0xd9b04a, cx, 15, 9.6, rr + 0.3, 1, 10).rotation.x = 0.12;
      }
    }
  }
}
