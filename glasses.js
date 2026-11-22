// 3D-Modell der Brille in Millimetern.
// Ursprung = Mitte zwischen den Pupillen auf Augenhöhe, z = 0 ist die Augenebene.
// x rechts (im Bild), y oben, z zur Kamera.
import * as THREE from "three";

const SHAPE_CFG = {
  round:      { n: 2,   ar: 0.9 },
  rect:       { n: 5,   ar: 0.56 },
  wayfarer:   { n: 3.2, ar: 0.78, trap: 0.13 },
  clubmaster: { n: 3,   ar: 0.74, flat: 0.85 },
  aviator:    { n: 2.3, ar: 0.92, drop: 0.35 },
  oversize:   { n: 3.2, ar: 0.95, trap: 0.08 }
};

function rawOutline(shape, w) {
  const a = w / 2, C = SHAPE_CFG[shape], b = a * C.ar, p = [], N = 96;
  for (let i = 0; i < N; i++) {
    const t = i / N * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    let x = a * Math.sign(c) * Math.abs(c) ** (2 / C.n), y = b * Math.sign(s) * Math.abs(s) ** (2 / C.n);
    if (C.trap) x *= 1 + C.trap * (y / b);
    if (C.flat && y > 0) y *= C.flat;
    if (C.drop && y < 0) y *= 1 + C.drop * ((x / a) + 1) / 2;
    p.push([x, y]);
  }
  let mn = Infinity, mx = -Infinity;
  p.forEach(q => { mn = Math.min(mn, q[1]); mx = Math.max(mx, q[1]); });
  const off = (mx + mn) / 2;
  p.forEach(q => q[1] -= off);
  return { p, h: mx - mn };
}

export function aspectOf(shape) { return rawOutline(shape, 100).h / 100; }

export function lensOutline(shape, w, h) {
  const o = rawOutline(shape, w);
  const s = h ? h / o.h : 1;
  o.p.forEach(q => q[1] *= s);
  return o.p;
}

function offset(p, d) {
  const n = p.length;
  return p.map((q, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [q[0] + ty / l * d, q[1] - tx / l * d];
  });
}
const toV = (p, m) => p.map(q => new THREE.Vector2(q[0] * m, q[1]));

function ringGeo(p, outer, hole, depth, mir) {
  const s = new THREE.Shape(toV(offset(p, outer), mir));
  s.holes.push(new THREE.Path(toV(offset(p, hole), mir)));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
}

// g: Ergebnis von sizeGlasses, shape: Form, style: {color, tint}
export function buildGlasses(g, shape, style) {
  const Z0 = 10;                       // Rahmen-Rückseite 10 mm vor dem Auge
  const D1 = 1.4, D2 = 2.2, D3 = 1.4;  // Schichten: Lippe, Nut (Glas), Lippe
  const D = D1 + D2 + D3;
  const pts = lensOutline(shape, g.lensW, g.lensH);
  const cx = g.bridge / 2 + g.lensW / 2;
  const half = g.bridge / 2 + g.lensW + g.rim + g.e;
  const yc = -g.lensDrop;              // Pupille leicht über Glasmitte
  const yh = yc + g.lensH * 0.22;      // Höhe von Steg und Scharnier
  const mat = new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.55, metalness: 0.05 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: style.tint, transparent: true, opacity: 0.72, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide });

  const front = new THREE.Group(), lenses = new THREE.Group();
  for (const side of [-1, 1]) {
    [[-0.9, D1, 0], [0.15, D2, D1], [-0.9, D3, D1 + D2]].forEach(([hole, dep, z]) => {
      const geo = ringGeo(pts, g.rim, hole, dep, side);
      geo.translate(side * cx, yc, Z0 + z);
      front.add(new THREE.Mesh(geo, mat));
    });
    const lg = new THREE.ShapeGeometry(new THREE.Shape(toV(pts, side)));
    lg.translate(side * cx, yc, Z0 + D1 + D2 / 2);
    lenses.add(new THREE.Mesh(lg, lensMat));
    const ep = new THREE.BoxGeometry(g.e + 2, 7, D);
    ep.translate(side * (cx + g.lensW / 2 + g.rim + g.e / 2 - 1), yh, Z0 + D / 2);
    front.add(new THREE.Mesh(ep, mat));
  }
  const br = new THREE.BoxGeometry(g.bridge + 2, Math.max(3, g.rim * 0.8), D);
  br.translate(0, yh, Z0 + D / 2);
  front.add(new THREE.Mesh(br, mat));

  const Lb = 28, Ls = g.templeLen - Lb;
  const temple = side => {
    const grp = new THREE.Group();
    const s = new THREE.BoxGeometry(3.2, 5, Ls);
    s.translate(side * (half - 1.6), yh, Z0 - Ls / 2);
    grp.add(new THREE.Mesh(s, mat));
    const bg = new THREE.BoxGeometry(3.2, 4.5, Lb + 2);
    bg.translate(0, 0, -(Lb + 2) / 2);
    const bm = new THREE.Mesh(bg, mat);
    bm.position.set(side * (half - 1.6), yh, Z0 - Ls + 1);
    bm.rotation.x = -0.44;
    grp.add(bm);
    return grp;
  };
  const tL = temple(-1), tR = temple(1);
  const root = new THREE.Group();
  root.add(front, lenses, tL, tR);
  return { root, front, lenses, tL, tR, half };
}

// Unsichtbarer Kopf, der die Bügel hinter dem Kopf verdeckt (nur Anprobe)
export function headOccluder(cheekMm) {
  const geo = new THREE.SphereGeometry(1, 32, 24);
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(cheekMm / 2 * 0.92, cheekMm * 0.7, 95);
  m.position.set(0, -10, -90);
  m.renderOrder = -1;
  return m;
}

export function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
