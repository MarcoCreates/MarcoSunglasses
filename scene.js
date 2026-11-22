// Licht, Hintergrund, Gesichts-Verdeckung und Lichtmessung für die Darstellung.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ---------- Umgebungen für Reflexe ----------
export function makeEnvs(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const studio = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  // Natürliches Licht: Himmel mit Verlauf + Sonne
  const sky = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 48, 24);
  const top = new THREE.Color("#7fb0ec"), hor = new THREE.Color("#f3efe6"), bot = new THREE.Color("#a8987f");
  const p = geo.attributes.position, cols = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 50;
    const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(bot, Math.pow(-y, 0.5));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.94, 0.82).multiplyScalar(30) }));
  sun.position.set(25, 35, 20); sky.add(sun);
  const natural = pm.fromScene(sky, 0.02).texture;
  pm.dispose();
  return { studio, natural };
}

// ---------- Lichtaufbau ----------
export function makeRig() {
  const g = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(120, 180, 260);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-200, 60, -120);
  g.add(hemi, key, rim);
  return { g, hemi, key, rim };
}
export function applyLight(scene, rig, envs, mode) {
  if (mode === "natural") {
    scene.environment = envs.natural;
    rig.hemi.color.set("#d6e6ff"); rig.hemi.groundColor.set("#8a7660"); rig.hemi.intensity = 0.7;
    rig.key.color.set("#fff0d6"); rig.key.intensity = 2.1; rig.key.position.set(180, 260, 120); rig.rim.intensity = 0.25;
  } else {
    scene.environment = envs.studio;
    rig.hemi.color.set("#ffffff"); rig.hemi.groundColor.set("#444444"); rig.hemi.intensity = 0.5;
    rig.key.color.set("#ffffff"); rig.key.intensity = 1.4; rig.key.position.set(120, 180, 260); rig.rim.intensity = 0.6;
  }
}
export const BACKGROUNDS = { white: "Weiss", grey: "Grau", room: "Fotostudio (Raum)", custom: "Eigene Farbe" };
// Fotostudio: Boden, der in einer Rundung in die Rückwand übergeht (Hohlkehle)
let cove = null;
function makeCove() {
  const pts = [], R = 140, y0 = -43.5, zBack = -300;
  pts.push(new THREE.Vector2(400, y0));                                   // Boden vorne (z = 400)
  for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI / 2; pts.push(new THREE.Vector2(zBack + R - Math.sin(a) * R, y0 + R - Math.cos(a) * R)); }
  pts.push(new THREE.Vector2(zBack, 700));                                // Wand oben
  const geo = new THREE.BufferGeometry(), pos = [], idx = [], W = 1400;
  pts.forEach(p => { pos.push(-W / 2, p.y, p.x, W / 2, p.y, p.x); });
  for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#ebe8e2", roughness: 1, metalness: 0, side: THREE.DoubleSide }));
  m.renderOrder = -5;
  return m;
}
export function applyBackground(scene, bg, color) {
  if (!cove) cove = makeCove();
  if (bg === "room") { scene.add(cove); scene.background = new THREE.Color("#d9d5cd"); return; }
  scene.remove(cove);
  if (bg === "grey") scene.background = new THREE.Color("#cfcfcb");
  else if (bg === "custom") scene.background = new THREE.Color(color);
  else scene.background = new THREE.Color("#f6f6f4");
}

// ---------- Gesichts-Verdeckung ----------
// Dreiecke aus der MediaPipe-Kantenliste ableiten
export function faceTriangles(edges) {
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const e of edges) { add(e.start, e.end); add(e.end, e.start); }
  const tris = [];
  for (const [a, s] of adj) for (const b of s) if (b > a) for (const c of s) if (c > b && adj.get(b).has(c)) tris.push(a, b, c);
  return tris;
}
// Unsichtbares Gesicht: schreibt nur Tiefe, verdeckt dadurch Bügel hinter Wangen und Stirn
export function makeFaceOccluder(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
  g.setIndex(tris);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = -2; m.frustumCulled = false;
  return m;
}
export function updateFaceOccluder(m, P, W, H, biasPx) {
  const a = m.geometry.attributes.position, ez = (P[468].z + P[473].z) / 2;
  for (let i = 0; i < 468; i++) a.setXYZ(i, P[i].x - W / 2, H / 2 - P[i].y, -(P[i].z - ez) - biasPx);
  a.needsUpdate = true;
}

// ---------- Lichtmessung aus dem Kamerabild ----------
export function makeLightProbe() {
  const c = document.createElement("canvas"); c.width = 24; c.height = 14;
  return { x: c.getContext("2d", { willReadFrequently: true }), lum: 0.5, col: new THREE.Color(1, 1, 1), n: 0 };
}
export function sampleLight(probe, src) {
  try {
    probe.x.drawImage(src, 0, 0, 24, 14);
    const d = probe.x.getImageData(0, 0, 24, 14).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; r /= n * 255; g /= n * 255; b /= n * 255;
    probe.lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b, 0.01);
    probe.col.setRGB(0.6 + 0.4 * r / mx, 0.6 + 0.4 * g / mx, 0.6 + 0.4 * b / mx); // leicht eingefärbt, nie extrem
  } catch (e) { /* Bild noch nicht bereit */ }
}
export function applyProbe(rig, probe) {
  const L = probe.lum;
  rig.hemi.color.copy(probe.col); rig.hemi.intensity = 0.35 + 0.6 * L;
  rig.key.color.copy(probe.col); rig.key.intensity = 0.5 + 1.2 * L; rig.rim.intensity = 0.2 + 0.4 * L;
  return 0.6 + 0.8 * L; // Belichtung
}
