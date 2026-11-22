import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs";
import * as A from "./analysis.js";
import { buildGlasses, headOccluder, aspectOf, disposeGroup } from "./glasses.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const STEPS = ["Look", "Material", "Scan", "Deine Brille"];
const NEED = 45; // gerade Bilder für die Messung

const $ = id => document.getElementById(id);
const st = { step: 0, look: null, tier: null, m: null, face: null, faceOverride: "", shape: null, shapeUser: false,
  rim: 4.5, rimUser: false, color: "#1f1f1f", tint: "#3a3a3a", source: null, img: null, staticP: null, view: "try", ov: {} };

// ---------- Navigation ----------
function go(n) {
  st.step = n;
  document.querySelectorAll("section").forEach((s, i) => s.classList.toggle("on", i === n));
  $("steps").innerHTML = STEPS.map((s, i) => `<span class="${i === n ? "on" : i < n ? "done" : ""}">${i + 1}. ${s}</span>`).join("");
  if (n === 2) placeMedia($("scanStage"));
  if (n === 3) { placeMedia($("tryStage")); setupResult(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => go(st.step - 1));

$("looks").innerHTML = Object.entries(A.LOOKS).map(([k, l]) => `<button class="opt" data-k="${k}"><b>${l.name}</b><small>${l.desc}<br>Typische Formen: ${l.shapes.map(s => A.SHAPES[s]).join(", ")}</small></button>`).join("");
$("looks").onclick = e => { const b = e.target.closest(".opt"); if (!b) return; st.look = b.dataset.k; const L = A.LOOKS[st.look];
  st.color = L.color; st.tint = L.tint; st.shapeUser = false; st.rimUser = false;
  document.querySelectorAll("#looks .opt").forEach(x => x.classList.toggle("sel", x === b)); $("n0").disabled = false; };
$("n0").onclick = () => go(1);
$("tiers").innerHTML = Object.entries(A.TIERS).map(([k, t]) => `<button class="opt" data-k="${k}"><b>${t.name}</b><small>${t.desc}</small>${t.tag ? `<span class="tag">${t.tag}</span>` : ""}</button>`).join("");
$("tiers").onclick = e => { const b = e.target.closest(".opt"); if (!b) return; st.tier = b.dataset.k;
  document.querySelectorAll("#tiers .opt").forEach(x => x.classList.toggle("sel", x === b)); $("n1").disabled = false; };
$("n1").onclick = () => go(2);
$("n2").onclick = () => go(3);

// ---------- Gesichtserkennung ----------
let fl = null, flMode = null;
async function getFL(mode) {
  if (!fl) {
    setStatus("Lade Gesichtserkennung … (beim ersten Mal ein paar Sekunden)");
    const fs = await FilesetResolver.forVisionTasks(WASM);
    const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: mode, numFaces: 1 });
    try { fl = await FaceLandmarker.createFromOptions(fs, opts("GPU")); }
    catch (e) { fl = await FaceLandmarker.createFromOptions(fs, opts("CPU")); }
    flMode = mode;
  }
  if (flMode !== mode) { await fl.setOptions({ runningMode: mode }); flMode = mode; }
  return fl;
}
function setStatus(t) { $("status").textContent = t; }

// ---------- Kamera / Foto ----------
const video = $("video"), still = $("still"), dots = $("dots"), dctx = dots.getContext("2d");
let stream = null;
async function startCam() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; await video.play();
  } catch (e) { setStatus("Kamera nicht verfügbar (" + e.name + "). Erlaube den Kamerazugriff oder lade ein Foto hoch."); return; }
  await getFL("VIDEO");
  st.source = "video"; st.staticP = null;
  showMedia(); scanReset(); startLoop();
}
function stopCam() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
function showMedia() {
  $("ph").style.display = "none";
  video.style.display = st.source === "video" ? "block" : "none";
  still.style.display = st.source === "image" ? "block" : "none";
  for (const s of [$("scanStage"), $("tryStage")]) s.classList.toggle("mirror", st.source === "video");
}
// Video/Bild/Canvas in die aktuelle Bühne verschieben
function placeMedia(stage) {
  stage.appendChild(video); stage.appendChild(still);
  if (stage.id === "scanStage") stage.appendChild(dots);
  showMedia();
}
$("cam").onclick = startCam;
$("rescan").onclick = () => { if (st.source === "video") scanReset(); else startCam(); };
$("photo").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  still.src = URL.createObjectURL(f); await still.decode();
  await getFL("IMAGE");
  const r = fl.detect(still);
  if (!r.faceLandmarks.length) { setStatus("Kein Gesicht im Foto gefunden. Bitte ein Foto von vorne verwenden."); return; }
  stopCam(); st.source = "image";
  const P = A.toPx(r.faceLandmarks[0], still.naturalWidth, still.naturalHeight);
  st.staticP = P; showMedia(); drawDots(P, still.naturalWidth, still.naturalHeight);
  const m = A.frameMeasure(P); m.earDepth = 65; m.basePitch = A.pose(P).pitch; // Profil fehlt -> Standard-Bügellänge
  finishScan(m, "Foto ausgewertet. Die Bügellänge ist ein Standardwert, weil das Profil fehlt.");
  startLoop();
};

// ---------- Scan ----------
let scan;
function scanReset() {
  scan = { front: [], ear: [], pitch: [], sA: false, sB: false, done: false };
  st.shapeUser = false; $("n2").disabled = true; $("scanRes").style.display = "none"; $("rescan").style.display = "none"; $("cam").style.display = "none";
  updateBars();
}
function updateBars() {
  $("b0").style.width = Math.min(100, scan.front.length / NEED * 100) + "%";
  $("b1").style.width = scan.sA ? "100%" : "0"; $("b2").style.width = scan.sB ? "100%" : "0";
}
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
function drawDots(P, W, H) {
  if (dots.width !== W) { dots.width = W; dots.height = H; }
  dctx.clearRect(0, 0, W, H); if (!P) return;
  const r = Math.max(2, W / 320);
  dctx.fillStyle = "rgba(255,255,255,.75)";
  OVAL.forEach(i => { dctx.beginPath(); dctx.arc(P[i].x, P[i].y, r, 0, 7); dctx.fill(); });
  dctx.fillStyle = "#f59e0b";
  [468, 473, 105, 334, 133, 362, 172, 397, 234, 454, 10, 152].forEach(i => { dctx.beginPath(); dctx.arc(P[i].x, P[i].y, r * 1.6, 0, 7); dctx.fill(); });
  dctx.strokeStyle = "#22c55e"; dctx.lineWidth = r;
  dctx.beginPath(); dctx.moveTo(P[468].x, P[468].y); dctx.lineTo(P[473].x, P[473].y); dctx.stroke();
}
function scanFrame(P) {
  drawDots(P, video.videoWidth, video.videoHeight);
  if (!scan || scan.done) return;
  if (!P) { setStatus("Kein Gesicht erkannt. Gesicht in die Mitte, gutes Licht."); return; }
  const ip = A.irisPx(P);
  if (ip < 14) { setStatus("Komm etwas näher an die Kamera."); return; }
  if (ip > 70) { setStatus("Etwas weiter weg, bitte."); return; }
  const po = A.pose(P);
  if (Math.abs(po.yaw) < 8 && Math.abs(po.roll) < 8 && scan.front.length < NEED) { scan.front.push(A.frameMeasure(P)); scan.pitch.push(po.pitch); }
  if (Math.abs(po.yaw) > 12) scan.ear.push(A.frameMeasure(P).earDepth);
  if (po.yaw < -20) scan.sA = true;
  if (po.yaw > 20) scan.sB = true;
  updateBars();
  if (scan.front.length < NEED) setStatus("Schau gerade in die Kamera und halte kurz still …");
  else if (!scan.sA || !scan.sB) setStatus("Super! Jetzt den Kopf langsam nach links und nach rechts drehen.");
  else { scan.done = true; const m = A.aggregate(scan.front, scan.ear); m.basePitch = [...scan.pitch].sort((a, b) => a - b)[scan.pitch.length >> 1]; finishScan(m, "✅ Scan fertig!"); }
}
function finishScan(m, msg) {
  st.m = m; st.ov = {}; st.faceOverride = ""; st.shapeUser = false; st.rimUser = false;
  setStatus(msg); $("n2").disabled = false; $("rescan").style.display = "inline-block"; $("cam").style.display = "none";
  const c = A.classify(m);
  $("scanRes").style.display = "block";
  $("scanRes").innerHTML = `<b>Gemessen</b><table>
    <tr><td>Augenabstand</td><td>${m.pd.toFixed(1)} mm</td></tr>
    <tr><td>Gesichtsbreite (Wangenknochen)</td><td>${m.cheek.toFixed(0)} mm</td></tr>
    <tr><td>Schläfenbreite</td><td>${m.temple.toFixed(0)} mm</td></tr>
    <tr><td>Gesichtsform</td><td>${A.FACE_SHAPES[c.shape]}</td></tr></table>`;
}

// ---------- Render-Schleife ----------
let looping = false, lastT = -1, curP = null;
function startLoop() { if (looping) return; looping = true; requestAnimationFrame(loop); }
function loop() {
  requestAnimationFrame(loop);
  if (st.source === "video" && fl && flMode === "VIDEO" && video.readyState >= 2 && video.currentTime !== lastT) {
    lastT = video.currentTime;
    const r = fl.detectForVideo(video, performance.now());
    curP = r.faceLandmarks && r.faceLandmarks[0] ? A.toPx(r.faceLandmarks[0], video.videoWidth, video.videoHeight) : null;
    if (st.step === 2) scanFrame(curP);
  }
  if (st.step === 3 && renderer) renderResult();
}

// ---------- Ergebnis: 3D und Anprobe ----------
let renderer, tryScene, tryCam, preScene, preCam, controls, gTry, gPre, occ;
const smooth = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 0, init: false };

function measures() {
  const m = { ...st.m };
  if (st.ov.fw) m.frameWOverride = st.ov.fw;
  if (st.ov.br) m.bridgeOverride = st.ov.br;
  if (st.ov.tl) m.templeLenOverride = st.ov.tl;
  if (st.ov.pd) m.pd = st.ov.pd;
  return m;
}
function sizes() { return A.sizeGlasses(measures(), st.shape, st.look, st.tier, st.rimUser ? st.rim : undefined, aspectOf); }

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const lights = s => { s.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.6)); const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(80, 120, 300); s.add(d); };
  tryScene = new THREE.Scene(); lights(tryScene);
  tryCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  preScene = new THREE.Scene(); lights(preScene);
  preCam = new THREE.PerspectiveCamera(35, 1, 1, 3000); preCam.position.set(110, 50, 260);
  controls = new OrbitControls(preCam, renderer.domElement); controls.target.set(0, 0, -40); controls.enableDamping = true;
  gTry = new THREE.Group(); gPre = new THREE.Group(); tryScene.add(gTry); preScene.add(gPre);
}

function setupResult() {
  if (!renderer) initRenderer();
  if (!st.shapeUser) { const rec = A.recommend(st.faceOverride || A.classify(st.m).shape, st.look); st.shape = rec.top[0].shape; }
  setView(st.view); rebuild(); panels();
}
function setView(v) {
  st.view = v;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("sel", b.dataset.v === v));
  $("tryStage").style.display = v === "try" ? "block" : "none";
  $("view3d").style.display = v === "3d" ? "block" : "none";
  (v === "try" ? $("tryStage") : $("view3d")).appendChild(renderer.domElement);
  $("viewHint").textContent = v === "try" ? (st.source === "video" ? "Bewege den Kopf. Die Brille folgt dir in echter Grösse." : "Anprobe auf deinem Foto.") : "Drehen: ziehen · Zoomen: scrollen bzw. zwei Finger";
  smooth.init = false;
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setView(b.dataset.v));

function rebuild() {
  for (const g of [gTry, gPre]) { while (g.children.length) { const c = g.children.pop(); disposeGroup(c); } }
  const sz = sizes(), style = { color: st.color, tint: st.tint };
  gTry.add(buildGlasses(sz, st.shape, style).root);
  occ = headOccluder(measures().cheek); gTry.add(occ);
  const pre = buildGlasses(sz, st.shape, style); gPre.add(pre.root); gPre.userData = pre;
  if (!st.rimUser) st.rim = sz.rim;
  $("rim").value = st.rim; $("rv").textContent = st.rim.toFixed(1);
  $("col").value = st.color; $("tint").value = st.tint;
  fitInfo(sz);
}

function panels() {
  const c = A.classify(st.m), fs = st.faceOverride || c.shape, rec = A.recommend(fs, st.look), R = c.ratios;
  $("faceCard").innerHTML = `<b>Deine Gesichtsform</b><div class="big">${A.FACE_SHAPES[fs]}${st.faceOverride ? " (selbst gewählt)" : ""}</div>
   <table><tr><td>Länge : Breite</td><td>${R.lengthToWidth.toFixed(2)}</td></tr><tr><td>Stirn : Wangen</td><td>${R.foreheadToCheek.toFixed(2)}</td></tr>
   <tr><td>Kiefer : Wangen</td><td>${R.jawToCheek.toFixed(2)}</td></tr><tr><td>Kieferwinkel</td><td>${R.jawAngle.toFixed(0)}°</td></tr></table>
   <label class="hint">Stimmt nicht? <select id="faceSel"><option value="">automatisch (${A.FACE_SHAPES[c.shape]})</option>${Object.entries(A.FACE_SHAPES).map(([k, n]) => `<option value="${k}" ${k === st.faceOverride ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
  $("faceSel").onchange = e => { st.faceOverride = e.target.value; st.shapeUser = false; st.shape = A.recommend(st.faceOverride || c.shape, st.look).top[0].shape; rebuild(); panels(); };
  $("recCard").innerHTML = `<b>Vorschlag für dich</b><p class="hint" style="margin:4px 0">${rec.reason} Passend zum Look «${A.LOOKS[st.look].name}».</p>
   <div class="chips">${rec.top.map((t, i) => `<button data-k="${t.shape}" class="${t.shape === st.shape ? "sel" : ""}">${i === 0 ? "★ " : ""}${A.SHAPES[t.shape]}</button>`).join("")}</div>
   <p class="hint" style="margin:10px 0 0">Alle Formen:</p><div class="chips">${Object.entries(A.SHAPES).map(([k, n]) => `<button data-k="${k}" class="${k === st.shape ? "sel" : ""}">${n}</button>`).join("")}</div>`;
  $("recCard").querySelectorAll("button").forEach(b => b.onclick = () => { st.shape = b.dataset.k; st.shapeUser = true; rebuild(); panels(); });
  const m = measures(), sz = sizes();
  $("o_pd").value = m.pd.toFixed(1); $("o_fw").value = sz.frameW.toFixed(1); $("o_br").value = sz.bridge.toFixed(1); $("o_tl").value = sz.templeLen;
}
[["o_pd", "pd"], ["o_fw", "fw"], ["o_br", "br"], ["o_tl", "tl"]].forEach(([id, k]) => $(id).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { st.ov[k] = v; rebuild(); } });
$("rim").oninput = e => { st.rim = +e.target.value; st.rimUser = true; rebuild(); };
$("rimAuto").onclick = e => { e.preventDefault(); st.rimUser = false; rebuild(); };
$("col").oninput = e => { st.color = e.target.value; rebuild(); };
$("tint").oninput = e => { st.tint = e.target.value; rebuild(); };

function fitInfo(sz) {
  const m = measures(), diff = (sz.framePD - m.pd) / 2;
  $("fit").innerHTML = [["Glasbreite", sz.lensW.toFixed(1) + " mm"], ["Glashöhe", sz.lensH.toFixed(1) + " mm"], ["Steg", sz.bridge.toFixed(1) + " mm"],
    ["Gesamtbreite Front", (2 * (sz.bridge / 2 + sz.lensW + sz.rim + sz.e)).toFixed(1) + " mm"], ["Bügellänge", sz.templeLen + " mm"],
    ["Glasmitte vs. Pupille", (diff >= 0 ? "+" : "") + diff.toFixed(1) + " mm pro Auge"]].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("");
  const msg = [];
  if (sz.rawW !== sz.lensW) msg.push(`<div class="warn">⚠️ Für deine Gesichtsbreite wären ${sz.rawW.toFixed(0)} mm breite Gläser nötig, begrenzt auf ${sz.lensW.toFixed(0)} mm.</div>`);
  if (sz.limitedByBrow) msg.push(`<div class="hint" style="margin-top:6px">Glashöhe an deine Augenbrauen angepasst, damit die Brille nicht zu hoch sitzt.</div>`);
  if (Math.abs(diff) > 6) msg.push(`<div class="warn">⚠️ Pupillen deutlich neben der Glasmitte. Ohne Korrektur unkritisch, kann aber ungewohnt aussehen.</div>`);
  if (sz.rim < A.TIERS[st.tier].minRim) msg.push(`<div class="warn">⚠️ Für ${A.TIERS[st.tier].name} ist eine Rahmendicke ab ${A.TIERS[st.tier].minRim} mm empfohlen.</div>`);
  if (!msg.length) msg.push(`<div class="ok">✅ Passt rechnerisch zu deinem Gesicht.</div>`);
  $("fitmsg").innerHTML = msg.join("");
}

function renderResult() {
  if (st.view === "3d") {
    const v = $("view3d"), w = v.clientWidth, h = v.clientHeight;
    if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h); preCam.aspect = w / h; preCam.updateProjectionMatrix(); }
    controls.update(); renderer.render(preScene, preCam); return;
  }
  const isVid = st.source === "video", W = isVid ? video.videoWidth : still.naturalWidth, H = isVid ? video.videoHeight : still.naturalHeight;
  if (!W) return;
  const stage = $("tryStage"), cw = stage.clientWidth, ch = stage.clientHeight;
  if (renderer.domElement.width !== Math.floor(cw * renderer.getPixelRatio()) || tryCam.right !== W / 2) {
    renderer.setSize(cw, ch); tryCam.left = -W / 2; tryCam.right = W / 2; tryCam.top = H / 2; tryCam.bottom = -H / 2; tryCam.updateProjectionMatrix();
  }
  const P = isVid ? curP : st.staticP;
  if (P) {
    const po = A.pose(P);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...po.x), new THREE.Vector3(...po.y), new THREE.Vector3(...po.z)));
    // Neigung der Stirn-Kinn-Linie herausrechnen, damit die Brille in Ruhehaltung gerade sitzt
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(st.m.basePitch || 0) * Math.PI / 180));
    const ax = (P[468].x + P[473].x) / 2, ay = (P[468].y + P[473].y) / 2;
    const pos = new THREE.Vector3(ax - W / 2, H / 2 - ay, 0), sc = A.irisPx(P) / A.IRIS_MM;
    if (!smooth.init || !isVid) { smooth.pos.copy(pos); smooth.quat.copy(q); smooth.scale = sc; smooth.init = true; }
    else { smooth.pos.lerp(pos, 0.5); smooth.quat.slerp(q, 0.5); smooth.scale += (sc - smooth.scale) * 0.3; }
    gTry.position.copy(smooth.pos); gTry.quaternion.copy(smooth.quat); gTry.scale.setScalar(smooth.scale); gTry.visible = true;
  } else gTry.visible = false;
  renderer.render(tryScene, tryCam);
}

// ---------- Download ----------
$("dl").onclick = async () => {
  try {
    $("dlmsg").textContent = "Erstelle Dateien …";
    const pre = gPre.userData; gPre.updateMatrixWorld(true);
    const ex = new STLExporter(), sz = sizes(), m = measures(), zip = new JSZip();
    zip.file("brille_front.stl", ex.parse(pre.front));
    zip.file("brille_buegel_links.stl", ex.parse(pre.tL));
    zip.file("brille_buegel_rechts.stl", ex.parse(pre.tR));
    zip.file("masse.txt", [`Sonnenbrillen-Designer V2`, `Look: ${A.LOOKS[st.look].name}`, `Material: ${A.TIERS[st.tier].name}`, `Form: ${A.SHAPES[st.shape]}`,
      `Augenabstand: ${m.pd.toFixed(1)} mm`, `Rahmenbreite: ${sz.frameW.toFixed(1)} mm`, `Steg: ${sz.bridge.toFixed(1)} mm`, `Glasbreite: ${sz.lensW.toFixed(1)} mm`,
      `Glashoehe: ${sz.lensH.toFixed(1)} mm`, `Rahmendicke: ${sz.rim.toFixed(1)} mm`, `Buegellaenge: ${sz.templeLen} mm`, `Einheit der STL-Dateien: Millimeter`,
      `Hinweis: Testdruck. Die Glaskontur ist eine Standardform.`].join("\n"));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sonnenbrille_${st.shape}.zip`; document.body.appendChild(a); a.click(); a.remove();
    $("dlmsg").textContent = "✅ Download gestartet.";
  } catch (e) { $("dlmsg").textContent = "Download nicht möglich: " + e.message; }
};

go(0);
