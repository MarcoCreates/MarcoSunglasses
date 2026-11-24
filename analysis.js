// Gesichtsvermessung, Gesichtsform und Brillenvorschlag.
// Reine Rechenfunktionen ohne Browser-Abhängigkeit (testbar).

import { MODELS } from "./models.js";

export const IRIS_MM = 11.7; // durchschnittlicher Irisdurchmesser Erwachsener

const R_IRIS = [469, 470, 471, 472];
const L_IRIS = [474, 475, 476, 477];

export const LOOKS = {
  casual:   { name: "Casual",   desc: "Alltag, entspannt, zeitlos", color: "#1f1f1f" },
  business: { name: "Business", desc: "Klar, dezent, kompetent",    color: "#5b3a26" },
  festival: { name: "Festival", desc: "Gross, mutig, farbig",       color: "#e11d48" }
};
for (const k of Object.keys(LOOKS)) LOOKS[k].shapes = Object.keys(MODELS).filter(m => MODELS[m].looks.includes(k));
export const TIERS = {
  budget:   { name: "Budget",   desc: "PETG im FDM-Druck. Am günstigsten, ideal für den ersten Testdruck.", minRim: 4.0 },
  standard: { name: "Standard", desc: "Nylon PA12 im SLS-Druck. Robust und leicht flexibel, so werden auch kommerzielle 3D-Brillen gedruckt.", minRim: 2.5, tag: "Empfehlung" },
  premium:  { name: "Premium",  desc: "Nylon PA12 SLS, eingefärbt und geglättet, plus Metallscharniere (separat gekauft).", minRim: 2.5 }
};
export const SHAPES = Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, m.name]));
export const FACE_SHAPES = { oval: "Oval", rund: "Rund", eckig: "Eckig", herz: "Herzförmig", laenglich: "Länglich" };

// Passung eines Modells zur Gesichtsform (Kontrastprinzip, nur Faustregel)
function faceScore(M, face) {
  const o = M.outline;
  if (face === "rund") return (1 - M.round) * 3;
  if (face === "eckig") return M.round * 3;
  if (face === "herz") return (o.drop ? 2 : 0) + M.round * 1.5 + (M.rim.bottom < M.rim.top - 2 ? -1.5 : 0) + (M.rim.side < 4 ? 0.5 : 0);
  if (face === "laenglich") return o.ar * 3 + (M.oversize ? 1 : 0);
  return 1.5;
}
const FACE_REASON = {
  rund:      "Kantige Formen geben deinem eher runden Gesicht Struktur (Kontrastprinzip).",
  eckig:     "Runde, weiche Formen gleichen die markante Kieferlinie aus (Kontrastprinzip).",
  herz:      "Formen, die unten etwas breiter oder leichter wirken, gleichen die breitere Stirn aus.",
  laenglich: "Höhere, grössere Gläser lassen das Gesicht ausgewogener wirken.",
  oval:      "Ausgewogene Proportionen: Dir stehen fast alle Formen."
};

// ---------- kleine Vektorhelfer ----------
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deg = r => r * 180 / Math.PI;
const median = arr0 => { const arr = arr0.filter(v => Number.isFinite(v)); const s = [...arr].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

// MediaPipe-Landmarks (normiert) -> Pixel. z hat dieselbe Skala wie x.
export function toPx(lm, W, H) { return lm.map(p => ({ x: p.x * W, y: p.y * H, z: p.z * W })); }

function irisDiamPx(P, idx) {
  const ds = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) ds.push(d2(P[idx[i]], P[idx[j]]));
  ds.sort((a, b) => b - a);
  return (ds[0] + ds[1]) / 2; // die zwei längsten Paare sind die Durchmesser
}
export function irisPx(P) { return (irisDiamPx(P, R_IRIS) + irisDiamPx(P, L_IRIS)) / 2; }

// Kopfhaltung als Achsen im three.js-System (x rechts, y oben, z zur Kamera)
export function pose(P) {
  const T = p => [p.x, -p.y, -p.z];
  const x = norm(sub(T(P[454]), T(P[234])));
  const yr = norm(sub(T(P[10]), T(P[152])));
  const z = norm(cross(x, yr));
  const y = cross(z, x);
  return { x, y, z, yaw: deg(Math.asin(clamp(x[2], -1, 1))), pitch: deg(Math.asin(clamp(y[2], -1, 1))), roll: deg(Math.atan2(x[1], x[0])) };
}

function angleAt(c, a, b) {
  const v1 = [a.x - c.x, a.y - c.y], v2 = [b.x - c.x, b.y - c.y];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
  return deg(Math.acos(clamp(cos, -1, 1)));
}

// Nasenrücken auf Höhe der Brillenauflage messen (statt aus den Augenwinkeln schätzen).
// Gesichtspunkte werden in ein kopffestes Koordinatensystem gedreht (mm, Ursprung zwischen den Pupillen).
export function noseBridge(P) {
  const k = IRIS_MM / irisPx(P), po = pose(P);
  const T = p => [p.x, -p.y, -p.z];
  const o = T({ x: (P[468].x + P[473].x) / 2, y: (P[468].y + P[473].y) / 2, z: (P[468].z + P[473].z) / 2 });
  const loc = p => { const v = sub(T(p), o); return [dot(v, po.x) * k, dot(v, po.y) * k, dot(v, po.z) * k]; };
  const L = P.slice(0, 468).map(loc);
  const zBase = (L[133][2] + L[362][2]) / 2;                         // Tiefe der inneren Augenwinkel
  const band = L.filter(q => q[1] > -8 && q[1] < -1 && Math.abs(q[0]) < 16); // Höhe der Auflage, nahe der Mitte
  if (band.length < 6) return { width: NaN, depth: NaN };
  const zMax = Math.max(...band.map(q => q[2]));
  const zc = zBase + 0.45 * (zMax - zBase);                          // Tiefe, auf der der Steg anliegt
  const edge = sgn => {
    const side = band.filter(q => sgn * q[0] > 0);
    const above = side.filter(q => q[2] >= zc), below = side.filter(q => q[2] < zc);
    if (!above.length || !below.length) return NaN;
    const a = above.reduce((m, q) => sgn * q[0] > sgn * m[0] ? q : m), b = below.reduce((m, q) => sgn * q[0] < sgn * m[0] ? q : m);
    const t = (zc - b[2]) / ((a[2] - b[2]) || 1);
    return b[0] + (a[0] - b[0]) * t;
  };
  const w = edge(1) - edge(-1);
  return { width: w > 10 && w < 27 ? w : NaN, depth: zMax - zBase };
}

// Masse eines Einzelbildes in mm
export function frameMeasure(P) {
  const k = IRIS_MM / irisPx(P);
  const nb = noseBridge(P);
  return {
    noseW: nb.width,
    noseDepth: nb.depth,
    pd: d2(P[468], P[473]) * k,
    cheek: d2(P[234], P[454]) * k,
    temple: d2(P[127], P[356]) * k,
    forehead: d2(P[103], P[332]) * k,
    jaw: d2(P[172], P[397]) * k,
    length: d2(P[10], P[152]) * k,
    intercanthal: d2(P[133], P[362]) * k,
    browGap: (Math.abs(P[105].y - P[468].y) + Math.abs(P[334].y - P[473].y)) / 2 * k,
    jawAngle: (angleAt(P[172], P[234], P[152]) + angleAt(P[397], P[454], P[152])) / 2,
    earDepth: (d3(P[33], P[234]) + d3(P[263], P[454])) / 2 * k
  };
}

// Viele Einzelbilder -> robuste Masse (Median)
export function aggregate(frames, earFrames) {
  const keys = Object.keys(frames[0]);
  const m = {};
  for (const key of keys) m[key] = median(frames.map(f => f[key]));
  if (earFrames && earFrames.length >= 5) m.earDepth = median(earFrames);
  // Nasenrücken nur verwenden, wenn in genügend Bildern gemessen
  if (frames.filter(f => Number.isFinite(f.noseW)).length < frames.length * 0.4) m.noseW = NaN;
  return m;
}

export function classify(m) {
  const r = m.length / m.cheek, fr = m.forehead / m.cheek, jr = m.jaw / m.cheek, ang = m.jawAngle;
  let shape;
  if (r >= 1.38) shape = "laenglich";
  else if (fr >= 0.9 && jr <= 0.78) shape = "herz";
  else if (jr >= 0.86 && ang < 132 && r < 1.3) shape = "eckig";
  else if (r <= 1.18 && ang >= 132) shape = "rund";
  else shape = "oval";
  return { shape, ratios: { lengthToWidth: r, foreheadToCheek: fr, jawToCheek: jr, jawAngle: ang } };
}

export function recommend(faceShape, look) {
  const scored = Object.entries(MODELS).map(([k, M]) => {
    const f = faceScore(M, faceShape), lf = M.looks.includes(look);
    return { shape: k, score: f * 1.2 + (lf ? 3 : 0) + (M.looks[0] === look ? 0.5 : 0), faceFit: f >= 1.5, lookFit: lf };
  }).sort((a, b) => b.score - a.score);
  return { top: scored.slice(0, 3), reason: FACE_REASON[faceShape] };
}

// Optimale Grösse für Gesicht + Form + Look
export function sizeGlasses(m, shape, look, tier, rimOverride, aspectOf) {
  const minRim = TIERS[tier].minRim;
  const M = MODELS[shape] || MODELS.bern;
  const rim = rimOverride ?? clamp(M.rim.side * Math.sqrt(m.cheek / 140), minRim, 8);
  const e = 5;
  // Steg: gemessener Nasenrücken, sonst Schätzung aus dem Augenwinkel-Abstand
  const bridge = clamp(m.bridgeOverride ?? (Number.isFinite(m.noseW) ? m.noseW + 0.5 : 0.55 * m.intercanthal), 14, 24);
  const plausibleTemple = m.temple > m.cheek * 0.85 && m.temple < m.cheek * 1.05;
  const frameW = m.frameWOverride ?? (plausibleTemple ? m.temple : m.cheek * 0.96);
  const rawW = (frameW + (M.oversize || 0) - bridge - 2 * rim - 2 * e) / 2;
  const lensW = clamp(rawW, 40, 62);
  const hShape = lensW * aspectOf(shape);
  // Grosse Formen dürfen die Brauen leicht überdecken
  const hMax = Math.max(28, m.browGap * 2 * 0.95 * (M.oversize || M.outline.drop ? 1.15 : 1));
  const lensH = Math.min(hShape, hMax);
  // Bügel: gemessener Abstand Augenwinkel -> Ohransatz (falls Ohr erkannt), sonst Schätzung
  const templeLen = m.templeLenOverride ?? (Number.isFinite(m.earLen) ? clamp(Math.round(m.earLen + 47), 125, 155) : clamp(Math.round(m.earDepth + 75), 125, 150)); // Augenwinkel->Gesichtsrand + ca. 25 mm bis Ohr + ca. 50 mm Bogen hinter dem Ohr;
  return { rim, e, bridge, frameW, rawW, lensW, lensH, lensDrop: 0.05 * lensH, templeLen, earDrop: m.earDrop, framePD: bridge + lensW, limitedByBrow: hShape > hMax };
}
