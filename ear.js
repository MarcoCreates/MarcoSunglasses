// Automatische Ohr-Erkennung beim Kopfdrehen (ohne Knopfdruck).
// Idee: Im Seitenbild liegt das Ohr direkt hinter dem Gesichtsrand. Es ist hautfarben
// (Farbe von den Wangen gelernt) und gehört zur Person (Freistellung trennt den Hintergrund).
// Gesucht wird der obere Ohransatz, auf dem der Bügel aufliegt.

const pctl = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

export function findEar(P, yawDeg, img, W, H, seg, faceLenMm) {
  // Sichtbare Seite: der Gesichtsrand, der näher an der Kamera ist
  const useR = P[234].z < P[454].z;
  const e = useR ? P[234] : P[454], canth = useR ? P[33] : P[263];
  const k = faceLenMm / Math.hypot(P[10].x - P[152].x, P[10].y - P[152].y); // mm pro Pixel
  // Richtung nach hinten (Nasenspitze -> Gesichtsrand) und nach oben (Kinn -> Stirn)
  let dx = e.x - P[1].x, dy = e.y - P[1].y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  let ux = P[10].x - P[152].x, uy = P[10].y - P[152].y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;

  // Hautfarbe von den Wangen
  const cheeks = useR ? [50, 205, 187, 123, 117, 118] : [280, 425, 411, 352, 346, 347];
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (const i of cheeks) for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
    const x = Math.round(P[i].x) + ox, y = Math.round(P[i].y) + oy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = (y * W + x) * 4; sr += img[o]; sg += img[o + 1]; sb += img[o + 2]; n++;
  }
  if (!n) return null;
  sr /= n; sg /= n; sb /= n;
  const sSum = sr + sg + sb + 1, cr0 = sr / sSum, cg0 = sg / sSum, L0 = (sr + sg + sb) / 3;
  const isSkin = (r, g, b) => {
    const s = r + g + b + 1, dc = Math.hypot(r / s - cr0, g / s - cg0), db = Math.abs((r + g + b) / 3 - L0) / (L0 + 1);
    return dc < 0.035 && db < 0.5;
  };
  const inPerson = (x, y) => seg.arr[Math.min(seg.h - 1, Math.floor(y * seg.h / H)) * seg.w + Math.min(seg.w - 1, Math.floor(x * seg.w / W))] > 0.5;

  // Raster hinter dem Gesichtsrand absuchen: t = mm nach hinten, s = mm nach oben
  const found = [];
  for (let t = 4; t <= 50; t += 0.8) for (let s = -22; s <= 38; s += 0.8) {
    const x = Math.round(e.x + (dx * t + ux * s) / k), y = Math.round(e.y + (dy * t + uy * s) / k);
    if (x < 0 || y < 0 || x >= W || y >= H || !inPerson(x, y)) continue;
    const o = (y * W + x) * 4;
    if (isSkin(img[o], img[o + 1], img[o + 2])) found.push([t, s]);
  }
  if (found.length < 40) return null;
  const ts = found.map(f => f[0]), tFront = pctl(ts, 0.05), tBack = pctl(ts, 0.95), width = tBack - tFront;
  if (width < 10 || width > 48) return null;
  // Oberer Ohransatz: höchster Hautpunkt im vorderen Teil des Ohrs
  const frontPart = found.filter(f => f[0] <= tFront + 0.45 * width).map(f => f[1]);
  if (frontPart.length < 10) return null;
  const sTop = pctl(frontPart, 0.95);
  if (sTop < 3 || sTop > 36) return null;
  const tAt = tFront + 0.25 * width, sAt = sTop - 3;
  const pt = { x: e.x + (dx * tAt + ux * sAt) / k, y: e.y + (dy * tAt + uy * sAt) / k };
  // Abstand äusserer Augenwinkel -> Ohransatz, korrigiert um die Kopfdrehung
  const L = Math.hypot(pt.x - canth.x, pt.y - canth.y) * k / Math.max(0.75, Math.abs(Math.sin(yawDeg * Math.PI / 180)));
  if (L < 62 || L > 118) return null;
  // Höhenunterschied: wie viel tiefer als der Augenwinkel liegt der Ohransatz (mm)
  const drop = -((pt.x - canth.x) * ux + (pt.y - canth.y) * uy) * k;
  return { L, drop, pt, canth: { x: canth.x, y: canth.y } };
}
