// 3D-Modell der Brille in Millimetern.
// Ursprung = Mitte zwischen den Pupillen auf Augenhöhe, z = 0 ist die Augenebene.
// x rechts (im Bild), y oben, z zur Kamera.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { MODELS } from "./models.js";

export const FINISHES = { gloss: "Glänzend", matte: "Matt", havana: "Havanna (Schildpatt)", crystal: "Kristall (transparent)" };
export const LENSES = {
  grey:         { name: "Grau",              color: "#25282b", op: 0.84, tc: "#6c7075" },
  brown:        { name: "Braun",             color: "#4a2c18", op: 0.82, tc: "#94603c" },
  g15:          { name: "Grün klassisch",    color: "#2c3a28", op: 0.84, tc: "#647a5c" },
  orange:       { name: "Orange getönt",     color: "#c8641c", op: 0.72, tc: "#f0953f" },
  peach:        { name: "Pfirsich getönt",   color: "#d7a072", op: 0.55, tc: "#f6cfa8" },
  gradient:     { name: "Verlauf Grau",      color: "#25282b", op: 0.9, grad: true, tc: "#8f9397" },
  mirrorBlue:   { name: "Verspiegelt Blau",  color: "#4b70b8", mirror: true },
  mirrorGold:   { name: "Verspiegelt Gold",  color: "#bf9a5a", mirror: true },
  mirrorSilver: { name: "Verspiegelt Silber", color: "#b9bfc8", mirror: true }
};

// ---------- Glaskontur ----------
// Superellipse, optional mit abgeschrägten Ecken (chamfer), danach Verformungen:
// trap = oben breiter, flat = Oberkante flacher, drop = Tropfen unten aussen, lift = Cat-Eye aussen oben.
function implicitF(x, y, o, a, b) {
  const f = Math.pow(Math.pow(Math.abs(x) / a, o.n) + Math.pow(Math.abs(y) / b, o.n), 1 / o.n);
  // chamfer = alle vier Ecken abgeschrägt, chamferTop = nur die oberen
  const ch = o.chamfer || (o.chamferTop && y > 0 ? o.chamferTop : 0);
  if (!ch) return f;
  const g = (Math.abs(x) / a + Math.abs(y) / b) / (2 - ch * 1.2), k = 14;
  return Math.pow(f ** k + g ** k, 1 / k);
}
function rawOutline(model, w) {
  const o = (MODELS[model] || MODELS.bern).outline, a = w / 2, b = a * o.ar, p = [], N = 140;
  for (let i = 0; i < N; i++) {
    const t = i / N * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    let lo = 0, hi = 2 * Math.max(a, b);
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; implicitF(mid * c, mid * s, o, a, b) < 1 ? lo = mid : hi = mid; }
    let x = lo * c, y = lo * s;
    if (o.trap) x *= 1 + o.trap * (y / b);
    if (o.flat && y > 0) y *= o.flat;
    if (o.drop && y < 0) y *= 1 + o.drop * ((x / a) + 1) / 2;
    if (o.lift && y > 0 && x > 0) y += o.lift * b * Math.pow(x / a, 2) * Math.pow(y / b, 0.7);
    p.push([x, y]);
  }
  let mn = Infinity, mx = -Infinity;
  p.forEach(q => { mn = Math.min(mn, q[1]); mx = Math.max(mx, q[1]); });
  const off = (mx + mn) / 2;
  p.forEach(q => q[1] -= off);
  return { p, h: mx - mn };
}
export function aspectOf(model) { return rawOutline(model, 100).h / 100; }
export function lensOutline(model, w, h) {
  const o = rawOutline(model, w), s = h ? h / o.h : 1;
  o.p.forEach(q => q[1] *= s);
  return o.p;
}
// Konstanter Versatz der Kontur nach aussen (d > 0) oder innen (d < 0)
function offset(p, d) { return offsetVar(p, { side: d, top: d, bottom: d }); }
// Versatz je nach Richtung: oben, seitlich und unten unterschiedlich dick
function offsetVar(p, r) {
  const n = p.length;
  return p.map((q, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1, nx = ty / l, ny = -tx / l;
    const d = ny > 0 ? r.side + (r.top - r.side) * Math.pow(ny, 1.5) : r.side + (r.bottom - r.side) * Math.pow(-ny, 1.5);
    return [q[0] + nx * d, q[1] + ny * d];
  });
}
const toV = (p, m) => p.map(q => new THREE.Vector2(q[0] * m, q[1]));
const scaleRim = (r, s, minus = 0) => ({ side: r.side * s - minus, top: r.top * s - minus, bottom: r.bottom * s - minus });

// ---------- Geometrien ----------
function ring(p, rim, hole, depth, mir, bevel) {
  const bv = bevel || 0;
  const s = new THREE.Shape(toV(offsetVar(p, { side: rim.side - bv, top: rim.top - bv, bottom: rim.bottom - bv }), mir));
  s.holes.push(new THREE.Path(toV(offset(p, hole + bv), mir)));
  if (!bv) return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 4, curveSegments: 1 });
  g.translate(0, 0, bv);
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
// Bügel als Seitenprofil: vorne hoch, nach hinten schmaler, am Ende nach unten gebogen
function templeGeo(h, w, Ls, Lb, withBend) {
  const top = [], bot = [], c = [[0, 0, 0], [Ls * 0.5, 0, 0], [Ls, 0, 0]];
  if (withBend) for (let i = 1; i <= 10; i++) { const a = i / 10 * 0.5, R = Lb / 0.5; c.push([Ls + Math.sin(a) * R, -(1 - Math.cos(a)) * R, a]); }
  const total = c.length - 1;
  c.forEach(([u, v, ang], i) => {
    const f = (c[i][0] + (i > 2 ? Lb * (i - 2) / 10 : 0)) / (Ls + (withBend ? Lb : 0)), t = h * (1 - 0.45 * Math.min(1, f * 1.3)) / 2;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    top.push(new THREE.Vector2(u + nx * t, v + ny * t)); bot.push(new THREE.Vector2(u - nx * t, v - ny * t));
  });
  const s = new THREE.Shape([...top, ...bot.reverse()]);
  const bv = Math.min(0.9, w * 0.25);
  const g = new THREE.ExtrudeGeometry(s, { depth: w - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: Math.min(0.6, h * 0.1), bevelSegments: 3, curveSegments: 1 });
  g.translate(0, 0, bv);
  g.rotateY(Math.PI / 2); // Profil-u -> -z, Dicke -> +x
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
let roughTex = null;
function roughness() {
  if (roughTex) return roughTex;
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const x = c.getContext("2d"), r = seeded(7), img = x.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = 200 + r() * 55; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  roughTex = new THREE.CanvasTexture(c); roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping; roughTex.repeat.set(1 / 30, 1 / 30);
  return roughTex;
}
export function frameMaterial(style, tryOn) {
  const m = frameMaterialBase(style, tryOn);
  if (typeof document !== "undefined" && (style.finish === "gloss" || style.finish === "matte" || !style.finish)) m.roughnessMap = roughness();
  return m;
}
function frameMaterialBase(style, tryOn) {
  const f = style.finish || "gloss";
  if (f === "havana") return new THREE.MeshPhysicalMaterial({ map: havana(), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  if (f === "matte") return new THREE.MeshPhysicalMaterial({ color: style.color, roughness: 0.78, metalness: 0, sheen: 0.4, sheenRoughness: 0.8 });
  if (f === "crystal") return tryOn
    ? new THREE.MeshPhysicalMaterial({ color: style.color, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.55, envMapIntensity: 1.2 })
    // Echte Lichtdurchlässigkeit (Transmission) wie bei Acetat in der 3D-Ansicht
    : new THREE.MeshPhysicalMaterial({ color: "#ffffff", transmission: 1, thickness: 4, ior: 1.5, roughness: 0.12, attenuationColor: style.color, attenuationDistance: 6, clearcoat: 1, clearcoatRoughness: 0.03 });
  return new THREE.MeshPhysicalMaterial({ color: style.color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
}
// Getöntes Glas = Filter (multipliziert das Bild dahinter) + Spiegelschicht (addiert Reflexe).
// So sieht man die Augen durch das Glas, wie bei echten Sonnenbrillen.
let gradMapTex = null;
function gradMap() {
  if (gradMapTex) return gradMapTex;
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#555"); g.addColorStop(0.5, "#aaa"); g.addColorStop(1, "#fff");
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  gradMapTex = new THREE.CanvasTexture(c); gradMapTex.colorSpace = THREE.SRGBColorSpace;
  return gradMapTex;
}
export function lensMaterials(style) {
  const L = LENSES[style.lens] || LENSES.grey;
  if (L.mirror) return [new THREE.MeshPhysicalMaterial({ color: L.color, metalness: 0.88, roughness: 0.1, iridescence: 0.18, iridescenceIOR: 1.4, transparent: true, opacity: 0.93, envMapIntensity: 1.5, side: THREE.DoubleSide })];
  const filter = new THREE.MeshBasicMaterial({ color: L.tc || L.color, blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  if (L.grad && typeof document !== "undefined") filter.map = gradMap();
  const refl = new THREE.MeshPhysicalMaterial({ color: "#000000", metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  return [filter, refl];
}
const metal = () => new THREE.MeshStandardMaterial({ color: "#dcdfe4", metalness: 1, roughness: 0.22 });

let engMat = null, engAspect = 4;
function engraving() {
  if (engMat || typeof document === "undefined") return engMat;
  const font = "600 44px -apple-system, Helvetica, Arial, sans-serif";
  const c = document.createElement("canvas"), x = c.getContext("2d");
  x.font = font; const tw = Math.ceil(x.measureText("marco.").width);
  c.width = tw + 12; c.height = 56; engAspect = c.width / c.height;
  x.font = font; x.fillStyle = "#ecd08c"; x.textBaseline = "middle"; x.fillText("marco.", 6, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  engMat = new THREE.MeshStandardMaterial({ map: t, transparent: true, metalness: 0.5, roughness: 0.3, emissive: "#6b5420", emissiveMap: t, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return engMat;
}

// Leichte Biegung der Front ums Gesicht (ca. 5°), wie bei echten Fassungen
const WRAP_R = 550;
function bend(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) - x * x / (2 * WRAP_R)); }
  p.needsUpdate = true;
  return geo;
}
const TILT = 0.14; // Vorneigung ca. 8°: Unterkante näher am Gesicht

// ---------- Brille ----------
// g: Ergebnis von sizeGlasses, model: Modell-Schlüssel, style: {color, finish, lens}
// Liefert die Darstellung (root), den Gesichtsschatten (shadow) und die druckbaren Teile (exp).
export function buildGlasses(g, model, style, opts = {}) {
  const M = MODELS[model] || MODELS.bern;
  const Z0 = 10, D = M.depth, D2 = 2.2, D1 = (D - D2) / 2;
  const rs = g.rim / M.rim.side, rim = scaleRim(M.rim, rs);
  const pts = lensOutline(model, g.lensW, g.lensH);
  const cx = g.bridge / 2 + g.lensW / 2;
  const yc = -g.lensDrop;
  const outer = offsetVar(pts, rim);
  let oxMax = -Infinity, oyMax = -Infinity, oyMin = Infinity;
  outer.forEach(q => { oxMax = Math.max(oxMax, q[0]); oyMax = Math.max(oyMax, q[1]); oyMin = Math.min(oyMin, q[1]); });
  // Oberkante des Rahmens innen (beim Steg) und aussen (bei der Backe)
  let yIn = -Infinity, yOut = -Infinity;
  outer.forEach(q => { if (q[0] < -g.lensW * 0.46) yIn = Math.max(yIn, q[1]); if (q[0] > g.lensW * 0.46) yOut = Math.max(yOut, q[1]); });
  const yTop = yc + oyMax, yTopIn = yc + yIn - 0.3, yTopOut = yc + yOut - 0.3, half = cx + oxMax + g.e;
  const chunky = M.bridge === "solid";
  const endH = Math.max(7.5, M.temple.h + 2);
  const yh = chunky ? yTopOut - endH / 2 : yc + g.lensH * 0.22;             // Höhe von Scharnier und Bügel
  const mat = frameMaterial(style, opts.tryOn), lmats = lensMaterials(style), mmat = metal();
  const Lb = 28, Ls = g.templeLen - Lb, Lv = opts.tryOn ? Math.min(Ls, g.templeLen - 45) : Ls;
  const epX = side => side * (cx + oxMax + g.e / 2 - 2); // Backe greift 3.5 mm in den Rahmen
  const zShift = half * half / (2 * WRAP_R);                 // so weit liegt das Scharnier durch die Biegung hinten

  // Stege
  const bridges = (exportMode) => {
    const parts = [], bw = g.bridge + 2 * rim.side * 0.6;
    if (M.bridge === "solid") {
      const bh = Math.max(4.5, rim.top * 1.1);
      const b = new RoundedBoxGeometry(bw, bh, D, 4, 1.2); b.translate(0, yTopIn - bh / 2, Z0 + D / 2); parts.push(b);
    } else if (M.bridge === "double") {
      const b1 = new RoundedBoxGeometry(bw + 6, 2.2, 2.4, 3, 0.9); b1.translate(0, yTop - 1.6, Z0 + D / 2); parts.push(b1);
      const b2 = new RoundedBoxGeometry(bw, 2.6, D * 0.8, 3, 1); b2.translate(0, yc + g.lensH * 0.18, Z0 + D / 2); parts.push(b2);
    } else {
      const r = M.bridge === "thin" ? 1.3 : Math.max(1.6, rim.side * 0.45), zb = Z0 + D / 2, yb = yc + g.lensH * 0.22;
      if (exportMode) { const b = new RoundedBoxGeometry(g.bridge + 3, Math.max(2.8, r * 2), Math.min(D, r * 2.4), 3, 1); b.translate(0, yb + 1, zb); parts.push(b); }
      else {
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-g.bridge / 2 - 1.5, yb, zb), new THREE.Vector3(0, yb + 2.8, zb + 1), new THREE.Vector3(g.bridge / 2 + 1.5, yb, zb));
        parts.push(new THREE.TubeGeometry(curve, 32, r, 16, false));
      }
    }
    return parts;
  };

  // --- Darstellung ---
  const root = new THREE.Group(), front = new THREE.Group(), lenses = new THREE.Group();
  for (const side of [-1, 1]) {
    const rg = ring(pts, rim, -1.7, D, side, Math.min(1.1, rim.side * 0.25)); rg.translate(side * cx, yc, Z0); front.add(new THREE.Mesh(bend(rg), mat));
    const lg = lensGeo(pts, 1.2, side); /* Glas vorne in der Nut wie bei echten Fassungen */ lg.translate(side * cx, yc, Z0 + D - 2.2); bend(lg); lmats.forEach((lm, i) => { const ms = new THREE.Mesh(lg, lm); ms.renderOrder = 1 + i; lenses.add(ms); });
    const ep = new RoundedBoxGeometry(g.e + 3, endH, D, 5, 1.9); ep.translate(epX(side), yh, Z0 + D / 2); front.add(new THREE.Mesh(bend(ep), mat));
    if (M.pins) for (const dy of [-1.7, 1.7]) {
      const pin = new THREE.CylinderGeometry(0.75, 0.75, 0.5, 20); pin.rotateX(Math.PI / 2);
      pin.translate(side * (cx + oxMax - rim.side * 0.45), yh + dy, Z0 + D + 0.15); front.add(new THREE.Mesh(bend(pin), mmat));
    }
  }
  bridges(false).forEach(b => front.add(new THREE.Mesh(bend(b), mat)));
  const temple = (side, len, bend) => {
    const grp = new THREE.Group(), w = M.temple.w;
    const tg = templeGeo(M.temple.h, w, len, Lb, bend);
    tg.translate(side > 0 ? half - w : -half, yh, Z0 - 0.5 - zShift);
    grp.add(new THREE.Mesh(tg, mat));
    return grp;
  };
  const tL = temple(-1, Lv, !opts.tryOn), tR = temple(1, Lv, !opts.tryOn);
  root.add(front, lenses, tL, tR);
  for (const side of [-1, 1]) { // sichtbares Scharnier
    const hg = new THREE.CylinderGeometry(1.1, 1.1, Math.min(5.5, endH - 1.5), 20); hg.translate(side * (half - M.temple.w * 0.5), yh, Z0 - 1.2 - zShift);
    root.add(new THREE.Mesh(hg, mmat));
  }
  // Gravur «marco.» aussen auf beiden Bügeln (nur Darstellung)
  const eng = engraving();
  if (eng) for (const side of [-1, 1]) {
    const hgt = Math.min(3.6, M.temple.h * 0.55);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(hgt * engAspect, hgt), eng);
    m.rotation.y = side * Math.PI / 2; m.position.set(side * (half + 0.03), yh, Z0 - 24 - zShift);
    root.add(m);
  }

  // --- Weicher Schatten auf dem Gesicht (nur Anprobe) ---
  const shadow = new THREE.Group();
  for (const side of [-1, 1]) for (const [o, op] of [[0.4, 0.13], [1.6, 0.08], [3, 0.05], [4.6, 0.03]]) {
    const s = new THREE.Shape(toV(offsetVar(pts, { side: rim.side + o, top: rim.top + o, bottom: rim.bottom + o }), side));
    s.holes.push(new THREE.Path(toV(offset(pts, Math.max(-6, -0.9 - o * 0.6)), side)));
    const sg = new THREE.ShapeGeometry(s); sg.translate(side * cx, yc - 2.2, 4); bend(sg);
    shadow.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: op, depthWrite: false })));
  }

  // --- Druckteile: Front mit Nut für die Gläser, Bügel ---
  const pf = new THREE.Group();
  for (const side of [-1, 1]) {
    [[-0.9, D1, 0], [0.15, D2, D1], [-0.9, D1, D1 + D2]].forEach(([hole, dep, z]) => {
      const geo = ring(pts, rim, hole, dep, side); geo.translate(side * cx, yc, Z0 + z); pf.add(new THREE.Mesh(bend(geo)));
    });
    const ep = new RoundedBoxGeometry(g.e + 3, endH, D, 5, 1.9); ep.translate(epX(side), yh, Z0 + D / 2); pf.add(new THREE.Mesh(bend(ep)));
  }
  bridges(true).forEach(b => pf.add(new THREE.Mesh(bend(b))));
  root.rotation.x = TILT; shadow.rotation.x = TILT;
  const exp = { front: pf, tL: temple(-1, Ls, true), tR: temple(1, Ls, true) };
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
