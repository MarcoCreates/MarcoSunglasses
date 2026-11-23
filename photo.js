// Fotomodus: Modelfoto aus dem Kamerabild mit Brille.
// Person freistellen, neuer Hintergrund, Farblook, Logo. Alles im Browser.
import { ImageSegmenter } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs";

const SEG_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
export const OW = 1080, OH = 1350; // Hochformat 4:5

export const PHOTO_BGS = { studio: "Fotostudio", blur: "Unschärfe (Porträtmodus)", sunset: "Sonnenuntergang", beach: "Strand", city: "Stadt bei Nacht", mountains: "Berge", cafe: "Café" };
export const PHOTO_LOOKS = { natural: "Natürlich", summer: "Sommer", film: "Film", cool: "Kühl", bw: "Schwarzweiss" };

const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

let seg = null;
async function getSegmenter(fileset) {
  if (seg) return seg;
  const o = d => ({ baseOptions: { modelAssetPath: SEG_MODEL, delegate: d }, runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false });
  try { seg = await ImageSegmenter.createFromOptions(fileset, o("GPU")); }
  catch (e) { seg = await ImageSegmenter.createFromOptions(fileset, o("CPU")); }
  return seg;
}

// shot: { frame: Canvas (Rohbild), glasses: Canvas (Brille mit Transparenz, gleiche Grösse), P: Gesichtspunkte in Pixeln, mirror }
export async function prepare(shot, fileset) {
  const { frame, glasses, P, mirror } = shot, W = frame.width, H = frame.height;
  // Bildausschnitt 4:5 um das Gesicht, mit Platz für Schultern
  const faceH = Math.hypot(P[10].x - P[152].x, P[10].y - P[152].y);
  let ch = faceH * 2.7, cw = ch * 0.8;
  if (ch > H) { ch = H; cw = ch * 0.8; }
  if (cw > W) { cw = W; ch = cw / 0.8; }
  const cx = (P[468].x + P[473].x) / 2;
  const x0 = Math.max(0, Math.min(W - cw, cx - cw / 2)), y0 = Math.max(0, Math.min(H - ch, P[10].y - faceH * 0.8));
  // Person freistellen
  const s = await getSegmenter(fileset);
  const res = s.segment(frame);
  const m = res.confidenceMasks[0], arr = m.getAsFloat32Array(), mw = m.width, mh = m.height;
  const mc = mk(mw, mh), mx = mc.getContext("2d"), id = mx.createImageData(mw, mh);
  for (let i = 0; i < arr.length; i++) {
    const a = Math.min(1, Math.max(0, (arr[i] - 0.3) / 0.45));
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = a * 255;
  }
  mx.putImageData(id, 0, 0);
  if (m.close) m.close(); if (res.close) res.close();
  const out = src => {
    const c = mk(OW, OH), x = c.getContext("2d"), sx = src.width / W, sy = src.height / H;
    x.imageSmoothingQuality = "high";
    x.drawImage(src, x0 * sx, y0 * sy, cw * sx, ch * sy, 0, 0, OW, OH);
    return c;
  };
  const frameCrop = out(frame), gl = out(glasses), mask = out(mc), person = out(frame);
  mask.getContext("2d").drawImage(gl, 0, 0);   // Brille gehört immer zur Person
  person.getContext("2d").drawImage(gl, 0, 0); // Brille aufs Bild
  return { person, mask, frameCrop, mirror };
}

// ---------- Hintergründe ----------
function blur(src, f) {
  // Weich verkleinern und in Zweierschritten wieder vergrössern: keine Treppenkanten
  let cur = src, w = OW, h = OH;
  while (w / 2 >= OW / f) { const n = mk(w / 2, h / 2), x = n.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, n.width, n.height); cur = n; w = n.width; h = n.height; }
  while (w * 2 <= OW) { const n = mk(w * 2, h * 2), x = n.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, n.width, n.height); cur = n; w = n.width; h = n.height; }
  const o = mk(OW, OH), ox = o.getContext("2d"); ox.imageSmoothingQuality = "high"; ox.drawImage(cur, 0, 0, OW, OH);
  return o;
}
function lin(x, stops) { const g = x.createLinearGradient(0, 0, 0, OH); stops.forEach(([p, c]) => g.addColorStop(p, c)); return g; }
function bokeh(x, n, cols, rMin, rMax, yMin, yMax, seed) {
  const r = seeded(seed);
  for (let i = 0; i < n; i++) {
    const px = r() * OW, py = yMin * OH + r() * (yMax - yMin) * OH, rad = rMin + r() * (rMax - rMin);
    const c = cols[Math.floor(r() * cols.length)], g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, c.replace("A", (0.25 + r() * 0.35).toFixed(2))); g.addColorStop(0.75, c.replace("A", "0.18")); g.addColorStop(1, c.replace("A", "0"));
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
  }
}
function background(key, p, custom) {
  const c = mk(OW, OH), x = c.getContext("2d");
  if (key === "blur") { const b = blur(p.frameCrop, 16); x.drawImage(b, 0, 0); x.fillStyle = "rgba(0,0,0,.08)"; x.fillRect(0, 0, OW, OH); return c; }
  if (key === "custom" && custom) {
    const s = Math.max(OW / custom.width, OH / custom.height), w = custom.width * s, h = custom.height * s;
    x.drawImage(custom, (OW - w) / 2, (OH - h) / 2, w, h); return blur(c, 5);
  }
  if (key === "studio") {
    const g = x.createRadialGradient(OW * 0.5, OH * 0.38, 50, OW * 0.5, OH * 0.45, OH * 0.85);
    g.addColorStop(0, "#efece7"); g.addColorStop(0.6, "#cfc9c0"); g.addColorStop(1, "#8f877c");
    x.fillStyle = g; x.fillRect(0, 0, OW, OH); return c;
  }
  if (key === "sunset") {
    x.fillStyle = lin(x, [[0, "#2c2f5e"], [0.45, "#c2627a"], [0.7, "#f08c5a"], [1, "#f7c38b"]]); x.fillRect(0, 0, OW, OH);
    const s = x.createRadialGradient(OW * 0.7, OH * 0.62, 10, OW * 0.7, OH * 0.62, 420); s.addColorStop(0, "rgba(255,230,170,.9)"); s.addColorStop(1, "rgba(255,200,140,0)");
    x.fillStyle = s; x.fillRect(0, 0, OW, OH);
    bokeh(x, 40, ["rgba(255,190,120,A)", "rgba(255,150,110,A)", "rgba(255,220,170,A)"], 25, 90, 0.35, 1, 7); return blur(c, 6);
  }
  if (key === "beach") {
    x.fillStyle = lin(x, [[0, "#6fb3ea"], [0.5, "#cfe9f8"], [0.58, "#e8f4f8"], [0.6, "#2f87b0"], [0.72, "#6cc0d3"], [0.74, "#f2e4c4"], [1, "#e1c99c"]]); x.fillRect(0, 0, OW, OH);
    const s = x.createRadialGradient(OW * 0.25, OH * 0.2, 10, OW * 0.25, OH * 0.2, 360); s.addColorStop(0, "rgba(255,255,240,.85)"); s.addColorStop(1, "rgba(255,255,240,0)");
    x.fillStyle = s; x.fillRect(0, 0, OW, OH);
    bokeh(x, 30, ["rgba(255,255,255,A)"], 10, 40, 0.58, 0.72, 3); return blur(c, 10);
  }
  if (key === "city") {
    x.fillStyle = lin(x, [[0, "#0b1030"], [0.6, "#1d1a3d"], [1, "#2a1730"]]); x.fillRect(0, 0, OW, OH);
    bokeh(x, 70, ["rgba(255,196,90,A)", "rgba(255,120,150,A)", "rgba(110,200,255,A)", "rgba(255,240,200,A)"], 20, 85, 0.1, 0.95, 11); return blur(c, 4);
  }
  if (key === "mountains") {
    x.fillStyle = lin(x, [[0, "#9ec3e6"], [0.55, "#eaf1f5"], [1, "#d7dfe2"]]); x.fillRect(0, 0, OW, OH);
    const r = seeded(5);
    [["#7f94ad", 0.5], ["#5f7790", 0.62], ["#3f5368", 0.76]].forEach(([col, base]) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, OH);
      let px = 0; while (px <= OW) { x.lineTo(px, OH * (base - 0.12 * r()) ); px += 60 + r() * 120; }
      x.lineTo(OW, OH); x.closePath(); x.fill();
    });
    return blur(c, 14);
  }
  // Café
  x.fillStyle = lin(x, [[0, "#3a2a1f"], [0.6, "#6b4a33"], [1, "#8a6a4c"]]); x.fillRect(0, 0, OW, OH);
  bokeh(x, 55, ["rgba(255,200,120,A)", "rgba(255,170,90,A)", "rgba(255,230,180,A)"], 15, 60, 0.05, 0.6, 17); return blur(c, 5);
}
function avgColor(c) {
  const s = mk(8, 10), x = s.getContext("2d"); x.drawImage(c, 0, 0, 8, 10);
  const d = x.getImageData(0, 0, 8, 10).data; let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4; return { r: r / n | 0, g: g / n | 0, b: b / n | 0 };
}

// ---------- Farblooks ----------
function grade(x, look) {
  const img = x.getImageData(0, 0, OW, OH), d = img.data, rnd = seeded(99);
  const L = { natural: [1, 1, 1, 1, 1.04, 0, 0], summer: [1.06, 1.0, 0.92, 1.15, 1.05, 6, 0], film: [1.03, 1.0, 0.94, 0.85, 0.94, 10, 9], cool: [0.95, 1.0, 1.06, 0.95, 1.05, 0, 0], bw: [1, 1, 1, 0, 1.22, 0, 7] }[look] || [1, 1, 1, 1, 1, 0, 0];
  const [kr, kg, kb, sat, con, lift, grain] = L;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * kr, g = d[i + 1] * kg, b = d[i + 2] * kb;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    r = (r - 128) * con + 128 + lift; g = (g - 128) * con + 128 + lift; b = (b - 128) * con + 128 + lift;
    if (grain) { const n = (rnd() - 0.5) * grain * 2; r += n; g += n; b += n; }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  x.putImageData(img, 0, 0);
}

export function compose(p, bgKey, look, custom) {
  const c = mk(OW, OH), x = c.getContext("2d");
  const mirror = (ctx) => { if (p.mirror) ctx.setTransform(-1, 0, 0, 1, OW, 0); };
  const bg = background(bgKey, p, custom);
  mirror(x); x.drawImage(bg, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0);
  // Person ausschneiden und leicht an die Farbe des Hintergrunds anpassen
  const pm = mk(OW, OH), px = pm.getContext("2d");
  px.drawImage(p.person, 0, 0); px.globalCompositeOperation = "destination-in"; px.drawImage(p.mask, 0, 0);
  const avg = avgColor(bg);
  if (bgKey !== "blur") {
    px.globalCompositeOperation = "source-atop"; px.fillStyle = `rgba(${avg.r},${avg.g},${avg.b},0.14)`; px.fillRect(0, 0, OW, OH);
    // Gegenlicht-Saum: Licht des Hintergrunds um die Silhouette
    x.save(); mirror(x); x.shadowColor = `rgba(${Math.min(255, avg.r + 70)},${Math.min(255, avg.g + 70)},${Math.min(255, avg.b + 70)},0.55)`; x.shadowBlur = 45; x.drawImage(pm, 0, 0); x.restore();
  }
  mirror(x); x.drawImage(pm, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0);
  grade(x, look);
  // Vignette
  const v = x.createRadialGradient(OW / 2, OH * 0.45, OH * 0.35, OW / 2, OH * 0.5, OH * 0.8);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.32)"); x.fillStyle = v; x.fillRect(0, 0, OW, OH);
  // Logo
  x.font = "800 46px -apple-system, Helvetica, Arial, sans-serif"; x.textBaseline = "alphabetic";
  x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 8;
  const tw = x.measureText("marco").width, dw = x.measureText(".").width, lx = OW - 48 - tw - dw, ly = OH - 48;
  x.fillStyle = "rgba(255,255,255,.92)"; x.fillText("marco", lx, ly); x.fillStyle = "#f59e0b"; x.fillText(".", lx + tw, ly);
  return c;
}
