// Gesichtsvermessung, Gesichtsform und Brillenvorschlag.
// Reine Rechenfunktionen ohne Browser-Abhängigkeit (testbar).

export const IRIS_MM = 11.7; // durchschnittlicher Irisdurchmesser Erwachsener

const R_IRIS = [469, 470, 471, 472];
const L_IRIS = [474, 475, 476, 477];

export const LOOKS = {
  casual:   { name: "Casual",   desc: "Alltag, entspannt, zeitlos", shapes: ["wayfarer", "round", "clubmaster"], rim: 4.5, color: "#1f1f1f", tint: "#3a3a3a" },
  business: { name: "Business", desc: "Schmal, klar, dezent",       shapes: ["rect", "clubmaster", "round"],     rim: 3.0, color: "#5b3a26", tint: "#4a4f45" },
  festival: { name: "Festival", desc: "Gross, mutig, farbig",       shapes: ["oversize", "aviator", "round"],    rim: 6.0, color: "#e11d48", tint: "#7c3aed" }
};
export const TIERS = {
  budget:   { name: "Budget",   desc: "PETG im FDM-Druck. Am günstigsten, ideal für den ersten Testdruck.", minRim: 4.0 },
  standard: { name: "Standard", desc: "Nylon PA12 im SLS-Druck. Robust und leicht flexibel, so werden auch kommerzielle 3D-Brillen gedruckt.", minRim: 2.5, tag: "Empfehlung" },
  premium:  { name: "Premium",  desc: "Nylon PA12 SLS, eingefärbt und geglättet, plus Metallscharniere (separat gekauft).", minRim: 2.5 }
};
export const SHAPES = { wayfarer: "Trapez", round: "Rund", clubmaster: "Browline", rect: "Rechteckig", aviator: "Pilot", oversize: "Oversize" };
export const FACE_SHAPES = { oval: "Oval", rund: "Rund", eckig: "Eckig", herz: "Herzförmig", laenglich: "Länglich" };

const FACE_PREF = {
  rund:      ["rect", "wayfarer", "clubmaster"],
  eckig:     ["round", "aviator", "oversize"],
  herz:      ["aviator", "round", "rect"],
  laenglich: ["oversize", "wayfarer", "aviator"],
  oval:      ["wayfarer", "round", "aviator", "rect", "clubmaster", "oversize"]
};
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
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deg = r => r * 180 / Math.PI;
const median = arr => { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

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

// Masse eines Einzelbildes in mm
export function frameMeasure(P) {
  const k = IRIS_MM / irisPx(P);
  return {
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
  const pref = FACE_PREF[faceShape], L = LOOKS[look];
  const scored = Object.keys(SHAPES).map(s => {
    let score = 0;
    const i = pref.indexOf(s);
    if (i >= 0) score += (pref.length - i) * 2 / (faceShape === "oval" ? 3 : 1);
    const j = L.shapes.indexOf(s);
    if (j >= 0) score += 3 + (j === 0 ? 1 : 0);
    return { shape: s, score, faceFit: i >= 0, lookFit: j >= 0 };
  }).sort((a, b) => b.score - a.score);
  return { top: scored.slice(0, 3), reason: FACE_REASON[faceShape] };
}

// Optimale Grösse für Gesicht + Form + Look
export function sizeGlasses(m, shape, look, tier, rimOverride, aspectOf) {
  const minRim = TIERS[tier].minRim;
  const rim = rimOverride ?? clamp(LOOKS[look].rim * Math.sqrt(m.cheek / 140), minRim, 8);
  const e = 5;
  const bridge = clamp(m.bridgeOverride ?? 0.55 * m.intercanthal, 14, 22);
  const plausibleTemple = m.temple > m.cheek * 0.85 && m.temple < m.cheek * 1.05;
  const frameW = m.frameWOverride ?? (plausibleTemple ? m.temple : m.cheek * 0.96);
  const rawW = (frameW - bridge - 2 * rim - 2 * e) / 2;
  const lensW = clamp(rawW, 40, 62);
  const hShape = lensW * aspectOf(shape);
  // Grosse Formen dürfen die Brauen leicht überdecken
  const hMax = Math.max(28, m.browGap * 2 * 0.95 * (shape === "oversize" || shape === "aviator" ? 1.15 : 1));
  const lensH = Math.min(hShape, hMax);
  const templeLen = m.templeLenOverride ?? clamp(Math.round(m.earDepth + 75), 125, 150); // Augenwinkel->Gesichtsrand + ca. 25 mm bis Ohr + ca. 50 mm Bogen hinter dem Ohr;
  return { rim, e, bridge, frameW, rawW, lensW, lensH, lensDrop: 0.05 * lensH, templeLen, framePD: bridge + lensW, limitedByBrow: hShape > hMax };
}
