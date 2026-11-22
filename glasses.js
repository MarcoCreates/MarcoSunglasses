// 3D-Modell der Brille in Millimetern.
// Ursprung = Mitte zwischen den Pupillen auf Augenhöhe, z = 0 ist die Augenebene.
// x rechts (im Bild), y oben, z zur Kamera.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const SHAPE_CFG = {
  round:      { n: 2,   ar: 0.9 },
  rect:       { n: 5,   ar: 0.56 },
  wayfarer:   { n: 3.2, ar: 0.78, trap: 0.13 },
  clubmaster: { n: 3,   ar: 0.74, flat: 0.85 },
  aviator:    { n: 2.3, ar: 0.92, drop: 0.35 },
  oversize:   { n: 3.2, ar: 0.95, trap: 0.08 }
};

export const FINISHES = { gloss: "Glänzend", matte: "Matt", havana: "Havanna (Schildpatt)", crystal: "Kristall (transparent)" };
export const LENSES = {
  grey:         { name: "Grau",              color: "#25282b", op: 0.84 },
  brown:        { name: "Braun",             color: "#4a2c18", op: 0.82 },
  g15:          { name: "G15 Grün",          color: "#2c3a28", op: 0.84 },
  gradient:     { name: "Verlauf Grau",      color: "#25282b", op: 0.9, grad: true },
  mirrorBlue:   { name: "Verspiegelt Blau",  color: "#2f74ff", mirror: true },
  mirrorGold:   { name: "Verspiegelt Gold",  color: "#e0a526", mirror: true },
  mirrorSilver: { name: "Verspiegelt Silber", color: "#d5dae1", mirror: true }
};

// ---------- Glaskontur ----------
function rawOutline(shape, w) {
  const a = w / 2, C = SHAPE_CFG[shape], b = a * C.ar, p = [], N = 120;
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
  const o = rawOutline(shape, w), s = h ? h / o.h : 1;
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

// ---------- Geometrien ----------
function ring(p, outer, hole, depth, mir, bevel) {
  const s = new THREE.Shape(toV(offset(p, outer - (bevel || 0)), mir));
  s.holes.push(new THREE.Path(toV(offset(p, hole + (bevel || 0)), mir)));
  if (!bevel) return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 1 });
  g.translate(0, 0, bevel);
  return g;
}
// Gewölbtes Glas: Fächer aus Ringen, Mitte nach vorne gewölbt
function lensGeo(pts, sag, mir) {
  const R = 10, N = pts.length, pos = [], uv = [], idx = [];
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  pts.forEach(q => { mnx = Math.min(mnx, q[0] * mir); mxx = Math.max(mxx, q[0] * mir); mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]); });
  const U = (x, y) => [(x - mnx) / (mxx - mnx), (y - mny) / (mxy - mny)];
  pos.push(0, 0, sag); uv.push(...U(0, 0));
  for (let k = 1; k <= R; k++) {
    const f = k / R;
    for (let j = 0; j < N; j++) { const x = pts[j][0] * f * mir, y = pts[j][1] * f; pos.push(x, y, sag * (1 - f * f)); uv.push(...U(x, y)); }
  }
  const tri = (a, b, c) => mir > 0 ? idx.push(a, b, c) : idx.push(a, c, b);
  for (let j = 0; j < N; j++) tri(0, 1 + j, 1 + (j + 1) % N);
  for (let k = 2; k <= R; k++) for (let j = 0; j < N; j++) {
    const a = 1 + (k - 2) * N + j, b = 1 + (k - 2) * N + (j + 1) % N, c = 1 + (k - 1) * N + j, d = 1 + (k - 1) * N + (j + 1) % N;
    tri(a, c, d); tri(a, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- Materialien ----------
let havanaTex = null, gradTex = null;
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function havana() {
  if (havanaTex) return havanaTex;
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const x = c.getContext("2d"), r = seeded(42);
  x.fillStyle = "#6b3d1c"; x.fillRect(0, 0, 512, 512);
  const cols = ["rgba(30,12,4,", "rgba(58,26,8,", "rgba(150,92,40,", "rgba(196,140,70,"];
  for (let i = 0; i < 260; i++) {
    const px = r() * 512, py = r() * 512, rad = 8 + r() * 46, col = cols[Math.floor(r() * cols.length)];
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, col + (0.35 + r() * 0.5) + ")"); g.addColorStop(1, col + "0)");
    x.fillStyle = g; x.beginPath(); x.ellipse(px, py, rad * 1.6, rad, r() * 3, 0, 7); x.fill();
  }
  havanaTex = new THREE.CanvasTexture(c);
  havanaTex.colorSpace = THREE.SRGBColorSpace;
  havanaTex.wrapS = havanaTex.wrapT = THREE.RepeatWrapping;
  havanaTex.repeat.set(1 / 45, 1 / 45);
  return havanaTex;
}
function gradient() {
  if (gradTex) return gradTex;
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#fff"); g.addColorStop(0.55, "#9a9a9a"); g.addColorStop(1, "#3a3a3a");
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  gradTex = new THREE.CanvasTexture(c); gradTex.flipY = true;
  return gradTex;
}
export function frameMaterial(style) {
  const f = style.finish || "gloss";
  if (f === "havana") return new THREE.MeshPhysicalMaterial({ map: havana(), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  if (f === "matte") return new THREE.MeshPhysicalMaterial({ color: style.color, roughness: 0.78, metalness: 0, sheen: 0.4, sheenRoughness: 0.8 });
  if (f === "crystal") return new THREE.MeshPhysicalMaterial({ color: style.color, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.5, envMapIntensity: 1.4 });
  return new THREE.MeshPhysicalMaterial({ color: style.color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
}
export function lensMaterial(style) {
  const L = LENSES[style.lens] || LENSES.grey;
  if (L.mirror) return new THREE.MeshPhysicalMaterial({ color: L.color, emissive: L.color, emissiveIntensity: 0.22, metalness: 0.9, roughness: 0.12, iridescence: 0.35, iridescenceIOR: 1.6, transparent: true, opacity: 0.95, envMapIntensity: 3.2, side: THREE.DoubleSide });
  const m = new THREE.MeshPhysicalMaterial({ color: L.color, metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: L.op, envMapIntensity: 1.7, side: THREE.DoubleSide });
  if (L.grad) m.alphaMap = gradient();
  return m;
}
const metal = () => new THREE.MeshStandardMaterial({ color: "#dcdfe4", metalness: 1, roughness: 0.22 });

// ---------- Brille ----------
// g: Ergebnis von sizeGlasses, shape: Form, style: {color, finish, lens}
// Liefert die Darstellung (root), den Gesichtsschatten (shadow) und die druckbaren Teile (exp).
export function buildGlasses(g, shape, style) {
  const Z0 = 10, D1 = 1.4, D2 = 2.2, D3 = 1.4, D = D1 + D2 + D3;
  const pts = lensOutline(shape, g.lensW, g.lensH);
  const cx = g.bridge / 2 + g.lensW / 2;
  const half = g.bridge / 2 + g.lensW + g.rim + g.e;
  const yc = -g.lensDrop, yh = yc + g.lensH * 0.22;
  const mat = frameMaterial(style), lmat = lensMaterial(style), mmat = metal();
  const Lb = 28, Ls = g.templeLen - Lb;

  // --- Darstellung ---
  const root = new THREE.Group(), front = new THREE.Group(), lenses = new THREE.Group();
  for (const side of [-1, 1]) {
    const rg = ring(pts, g.rim, -1.7, D, side, Math.min(0.9, g.rim * 0.25)); // Lippe überdeckt den Glasrand
    rg.translate(side * cx, yc, Z0); front.add(new THREE.Mesh(rg, mat));
    const lg = lensGeo(pts, 2.6, side); lg.translate(side * cx, yc, Z0 + D / 2); // Glasrand in der Nut, Mitte gewölbt
    lenses.add(new THREE.Mesh(lg, lmat));
    const ep = new RoundedBoxGeometry(g.e + 2, 7.5, D, 4, 1.4);
    ep.translate(side * (cx + g.lensW / 2 + g.rim + g.e / 2 - 1), yh, Z0 + D / 2); front.add(new THREE.Mesh(ep, mat));
    const rv = new THREE.CylinderGeometry(1.1, 1.1, 0.6, 24); rv.rotateX(Math.PI / 2);
    rv.translate(side * (cx + g.lensW / 2 + g.rim + 1.2), yh, Z0 + D + 0.2); front.add(new THREE.Mesh(rv, mmat));
  }
  const br = Math.max(1.6, g.rim * 0.42), zb = Z0 + D / 2;
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-g.bridge / 2 - 1.5, yh, zb), new THREE.Vector3(0, yh + 2.8, zb + 1.2), new THREE.Vector3(g.bridge / 2 + 1.5, yh, zb));
  front.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, br, 16, false), mat));
  const temple = side => {
    const grp = new THREE.Group();
    const s = new RoundedBoxGeometry(3.2, 5, Ls, 3, 1.2); s.translate(side * (half - 1.6), yh, Z0 - Ls / 2);
    grp.add(new THREE.Mesh(s, mat));
    const bg = new RoundedBoxGeometry(3.2, 4.5, Lb + 2, 3, 1.2); bg.translate(0, 0, -(Lb + 2) / 2);
    const bm = new THREE.Mesh(bg, mat); bm.position.set(side * (half - 1.6), yh, Z0 - Ls + 1); bm.rotation.x = -0.44;
    grp.add(bm);
    const hg = new THREE.CylinderGeometry(1.2, 1.2, 5.5, 20); hg.translate(side * (half - 0.4), yh, Z0 - 1.5);
    grp.add(new THREE.Mesh(hg, mmat)); // sichtbares Scharnier
    return grp;
  };
  root.add(front, lenses, temple(-1), temple(1));

  // --- Weicher Schatten auf dem Gesicht (nur Anprobe) ---
  const shadow = new THREE.Group();
  for (const side of [-1, 1]) for (const [o, op] of [[0.4, 0.13], [1.6, 0.08], [3, 0.05], [4.6, 0.03]]) {
    const s = new THREE.Shape(toV(offset(pts, g.rim + o), side));
    s.holes.push(new THREE.Path(toV(offset(pts, Math.max(-6, -0.9 - o * 0.6)), side)));
    const sg = new THREE.ShapeGeometry(s); sg.translate(side * cx, yc - 2.2, 4);
    shadow.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: op, depthWrite: false })));
  }

  // --- Druckteile: Front mit Nut für die Gläser, Bügel ---
  const pf = new THREE.Group();
  for (const side of [-1, 1]) {
    [[-0.9, D1, 0], [0.15, D2, D1], [-0.9, D3, D1 + D2]].forEach(([hole, dep, z]) => {
      const geo = ring(pts, g.rim, hole, dep, side); geo.translate(side * cx, yc, Z0 + z); pf.add(new THREE.Mesh(geo));
    });
    const ep = new RoundedBoxGeometry(g.e + 2, 7.5, D, 4, 1.4);
    ep.translate(side * (cx + g.lensW / 2 + g.rim + g.e / 2 - 1), yh, Z0 + D / 2); pf.add(new THREE.Mesh(ep));
  }
  const pb = new RoundedBoxGeometry(g.bridge + 3, Math.max(3.2, br * 2), D, 3, 1); pb.translate(0, yh + 0.8, Z0 + D / 2); pf.add(new THREE.Mesh(pb));
  const pt = side => {
    const grp = new THREE.Group();
    const s = new RoundedBoxGeometry(3.2, 5, Ls, 3, 1.2); s.translate(side * (half - 1.6), yh, Z0 - Ls / 2); grp.add(new THREE.Mesh(s));
    const bg = new RoundedBoxGeometry(3.2, 4.5, Lb + 2, 3, 1.2); bg.translate(0, 0, -(Lb + 2) / 2);
    const bm = new THREE.Mesh(bg); bm.position.set(side * (half - 1.6), yh, Z0 - Ls + 1); bm.rotation.x = -0.44; grp.add(bm);
    return grp;
  };
  const exp = { front: pf, tL: pt(-1), tR: pt(1) };
  return { root, shadow, exp, half };
}

// Unsichtbarer Kopf, der die Bügel hinter dem Kopf verdeckt (nur Anprobe)
export function headOccluder(cheekMm) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ colorWrite: false }));
  m.scale.set(cheekMm / 2 * 0.92, cheekMm * 0.7, 95);
  m.position.set(0, -10, -90);
  m.renderOrder = -1;
  return m;
}

// Weicher Bodenschatten für die 3D-Ansicht
export function groundShadow() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const x = c.getContext("2d"), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(0,0,0,.38)"); g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, -42, -55); m.scale.set(1, 1.15, 1);
  return m;
}

export function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
