import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ======================================================================
//  AYARLAR
// ======================================================================
const MODEL_URL = 'model3.glb';
const MODEL_SIZE = 6;                       // modelin sahnedeki en büyük boyutu
const FLY_TIME = 1.1;                       // parçanın yerine gitme süresi (sn)
const ORTHO_H = 10;                         // ortografik kameranın yarı yüksekliği
const ORTHO_DIST = MODEL_SIZE * 4;          // ortografik kameranın uzaklığı
const FIT_MARGIN = 0.7;                     // modelin etrafında bırakılan boşluk (büyüdükçe model küçülür)
const DEFAULT_DIR = new THREE.Vector3(0.95, 0.72, 1.15).normalize(); // başlangıç bakış yönü

// Animasyon butonuna basılınca dönecek parçalar (isim içinde geçmesi yeterli, büyük/küçük harf fark etmez)
const SPIN_PARTS = ['parca_10', 'parca_11', 'parca_12', 'parca_13'];
const SPIN_AXIS = {};                       // gerekirse eksen: { parca_12: 'z' }  (x, y veya z)
const SPIN_SPEED = 7;                       // radyan/sn

const WOOD = [0xe2bf8a, 0xd8ae78, 0xeccfa3];       // ahşap tonları (parçalara sırayla verilir)
const GHOST_COLOR = new THREE.Color(0x8fa8e6);
const HOT_COLOR = new THREE.Color(0x4f6bff);

const V3 = THREE.Vector3;
const rad = THREE.MathUtils.degToRad;
const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0);
const AXES = [AX, AY, new V3(0, 0, 1)];
const IDENT = new THREE.Quaternion();
const ZERO = new V3();
const $ = (id) => document.getElementById(id);

const stageEl = $('stage'), listEl = $('pieceList'), countEl = $('count'), barEl = $('bar');
const animBtn = $('animBtn'), leftEl = $('left'), toastEl = $('toast'), hintEl = $('hint'), cubeEl = $('cube'), cubeWrap = $('cubeWrap');
const DEFAULT_HINT = hintEl.textContent;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ======================================================================
//  ANA SAHNE (sağdaki model görünümü)
// ======================================================================
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stageEl.prepend(renderer.domElement);

const persp = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
const ortho = new THREE.OrthographicCamera(-ORTHO_H, ORTHO_H, ORTHO_H, -ORTHO_H, 0.1, 300);
let camera = persp;
let isOrtho = false;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.rotateSpeed = 0.9;
controls.minZoom = 0.35;
controls.maxZoom = 6;
controls.autoRotateSpeed = 1.6;

// Işıklar
scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd8ee, 1.6));
scene.add(new THREE.AmbientLight(0xffffff, 0.3));
const sun = new THREE.DirectionalLight(0xfff4e2, 2.2);
sun.position.set(6, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
fill.position.set(-8, 5, -6);
scene.add(fill);

const modelGroup = new THREE.Group();
scene.add(modelGroup);

let modelRadius = MODEL_SIZE * 0.7;
let loaded = false, finished = false, placedCount = 0;
let anim = null;
let animating = false;                    // animasyon butonuyla açılır
let userMoved = false;

function resize() {
  const w = Math.max(1, stageEl.clientWidth);
  const h = Math.max(1, stageEl.clientHeight);
  renderer.setSize(w, h, false);
  const a = w / h;
  persp.aspect = a;
  persp.updateProjectionMatrix();
  ortho.left = -ORTHO_H * a; ortho.right = ORTHO_H * a;
  ortho.top = ORTHO_H; ortho.bottom = -ORTHO_H;
  ortho.updateProjectionMatrix();
  if (loaded && !userMoved && !anim) goHome(0); // kullanıcı dokunmadıysa pencereye göre yeniden ortala
}
new ResizeObserver(resize).observe(stageEl);
resize();

// ======================================================================
//  SES
// ======================================================================
let audioCtx = null;
function beep(freq, dur, type = 'sine', vol = 0.2, slide = null, delay = 0) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sfx = {
  pop: () => beep(520, 0.09, 'sine', 0.22, 780),
  knock: () => beep(380, 0.13, 'triangle', 0.4, 110),
  win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.35, 'triangle', 0.3, null, i * 0.12)),
};
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// ======================================================================
//  KONFETİ
// ======================================================================
const N = 240;
const cPos = new Float32Array(N * 3), cCol = new Float32Array(N * 3), cVel = new Float32Array(N * 3), cLife = new Float32Array(N);
for (let i = 0; i < N; i++) cPos[i * 3 + 1] = -100;
const cGeo = new THREE.BufferGeometry();
cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
cGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
const dotCanvas = document.createElement('canvas');
dotCanvas.width = dotCanvas.height = 64;
{
  const g = dotCanvas.getContext('2d');
  g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fillStyle = '#fff'; g.fill();
}
const dotTex = new THREE.CanvasTexture(dotCanvas);
const confetti = new THREE.Points(cGeo, new THREE.PointsMaterial({
  size: 0.16, map: dotTex, vertexColors: true, transparent: true, alphaTest: 0.3, depthWrite: false,
}));
confetti.frustumCulled = false;
scene.add(confetti);
const palette = [0x4f6bff, 0xff9a24, 0xffd166, 0x4cc9f0, 0x80ed99, 0xff7eb3].map((c) => new THREE.Color(c));
let cNext = 0;

function burst(pos, count, power) {
  for (let k = 0; k < count; k++) {
    const i = cNext; cNext = (cNext + 1) % N;
    const a = Math.random() * Math.PI * 2;
    const up = Math.random();
    const sp = power * (0.4 + Math.random());
    cPos[i * 3] = pos.x; cPos[i * 3 + 1] = pos.y; cPos[i * 3 + 2] = pos.z;
    cVel[i * 3] = Math.cos(a) * sp * (1 - up * 0.4);
    cVel[i * 3 + 1] = sp * (0.6 + up);
    cVel[i * 3 + 2] = Math.sin(a) * sp * (1 - up * 0.4);
    cLife[i] = 1.2 + Math.random() * 0.9;
    const c = palette[(Math.random() * palette.length) | 0];
    cCol[i * 3] = c.r; cCol[i * 3 + 1] = c.g; cCol[i * 3 + 2] = c.b;
  }
  cGeo.attributes.color.needsUpdate = true;
}

function updateConfetti(dt) {
  let any = false;
  for (let i = 0; i < N; i++) {
    if (cLife[i] <= 0) continue;
    any = true;
    cLife[i] -= dt;
    cVel[i * 3 + 1] -= 9 * dt;
    cPos[i * 3] += cVel[i * 3] * dt;
    cPos[i * 3 + 1] += cVel[i * 3 + 1] * dt;
    cPos[i * 3 + 2] += cVel[i * 3 + 2] * dt;
    if (cLife[i] <= 0) cPos[i * 3 + 1] = -100;
  }
  if (any) cGeo.attributes.position.needsUpdate = true;
}

// ======================================================================
//  KAMERA: yörünge, animasyonlu görünüm geçişleri, ViewCube, butonlar
// ======================================================================
function fitDist() {
  const vf = rad(persp.fov);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * persp.aspect);
  return (modelRadius / Math.sin(Math.min(vf, hf) / 2)) * FIT_MARGIN;
}
function fitZoom() {
  const a = ortho.right / ortho.top;
  const half = Math.max(modelRadius * FIT_MARGIN, (modelRadius * FIT_MARGIN) / a);
  return ORTHO_H / half;
}

function applyAnim(e) {
  const a = anim;
  const dir = a.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerpQuaternions(IDENT, a.q, e));
  const dist = THREE.MathUtils.lerp(a.fromDist, a.toDist, e);
  controls.target.lerpVectors(a.fromT, a.toT, e);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  if (isOrtho) {
    camera.zoom = THREE.MathUtils.lerp(a.fromZoom, a.toZoom, e);
    camera.updateProjectionMatrix();
  }
  camera.lookAt(controls.target);
}

function animateTo({ dir, target, dist, zoom }, dur = 0.7) {
  const off = camera.position.clone().sub(controls.target);
  if (off.lengthSq() < 1e-6) off.copy(dir).multiplyScalar(dist || 1); // kamera hedefin üstündeyse (ilk açılış) yönü ver
  const fromDir = off.clone().normalize();
  const toDir = dir.clone().normalize();
  anim = {
    t: 0, dur,
    fromDir, toDir,
    q: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
    fromT: controls.target.clone(), toT: target.clone(),
    fromDist: off.length(), toDist: dist,
    fromZoom: camera.zoom, toZoom: zoom,
  };
  if (dur <= 0) { applyAnim(1); anim = null; }
}

function stepAnim(dt) {
  anim.t += dt / anim.dur;
  const t = Math.min(anim.t, 1);
  applyAnim(easeInOut(t));
  if (t >= 1) anim = null;
}

function currentDir() {
  return camera.position.clone().sub(controls.target).normalize();
}

function goHome(dur = 0.7) {
  animateTo({
    dir: DEFAULT_DIR, target: ZERO,
    dist: isOrtho ? ORTHO_DIST : fitDist(),
    zoom: isOrtho ? fitZoom() : 1,
  }, dur);
}
function goFit() {
  animateTo({
    dir: currentDir(), target: ZERO,
    dist: isOrtho ? ORTHO_DIST : fitDist(),
    zoom: isOrtho ? fitZoom() : 1,
  }, 0.5);
}
function zoomBy(f) {
  const off = camera.position.clone().sub(controls.target);
  if (isOrtho) {
    const z = THREE.MathUtils.clamp(camera.zoom * f, controls.minZoom, controls.maxZoom);
    animateTo({ dir: currentDir(), target: controls.target, dist: off.length(), zoom: z }, 0.25);
  } else {
    const d = THREE.MathUtils.clamp(off.length() / f, controls.minDistance, controls.maxDistance);
    animateTo({ dir: currentDir(), target: controls.target, dist: d, zoom: 1 }, 0.25);
  }
}

function setOrtho(on) {
  if (on === isOrtho) return;
  const off = camera.position.clone().sub(controls.target);
  const dir = off.clone().normalize();
  if (on) {
    const h = off.length() * Math.tan(rad(persp.fov / 2));
    ortho.zoom = THREE.MathUtils.clamp(ORTHO_H / h, controls.minZoom, controls.maxZoom);
    ortho.position.copy(controls.target).addScaledVector(dir, ORTHO_DIST);
    camera = ortho;
  } else {
    const h = ORTHO_H / ortho.zoom;
    const d = THREE.MathUtils.clamp(h / Math.tan(rad(persp.fov / 2)), controls.minDistance, controls.maxDistance);
    persp.position.copy(controls.target).addScaledVector(dir, d);
    camera = persp;
  }
  isOrtho = on;
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  controls.object = camera;
  controls.update();
  // ortografikte nokta boyutu perspektife bağlı olmasın
  confetti.material.sizeAttenuation = !on;
  confetti.material.size = on ? 7 : 0.16;
  confetti.material.needsUpdate = true;
  $('btnProj').classList.toggle('on', on);
}

controls.addEventListener('start', () => { anim = null; userMoved = true; controls.autoRotate = false; });

$('btnHome').onclick = () => { userMoved = false; goHome(); };
$('btnFit').onclick = () => goFit();
$('btnIn').onclick = () => zoomBy(1.3);
$('btnOut').onclick = () => zoomBy(1 / 1.3);
$('btnProj').onclick = () => setOrtho(!isOrtho);

// ---- ViewCube: kamerayı yansıtır; sürükleyince modeli çevirir; yüze tıklayınca o görünüme geçer ----
const VIEWS = {
  front: new V3(0, 0, 1), back: new V3(0, 0, -1),
  right: new V3(1, 0, 0), left: new V3(-1, 0, 0),
  top: new V3(0, 1, 0.001), bottom: new V3(0, -1, 0.001),
};
const cubeMat = new THREE.Matrix4();
const cubeQ = new THREE.Quaternion();
function updateCube() {
  cubeQ.copy(camera.quaternion).invert();
  const e = cubeMat.makeRotationFromQuaternion(cubeQ).elements;
  cubeEl.style.transform =
    `matrix3d(${e[0]},${-e[1]},${e[2]},0,${-e[4]},${e[5]},${-e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
}

let cubeDrag = null;
cubeWrap.addEventListener('pointerdown', (e) => {
  cubeWrap.setPointerCapture(e.pointerId);
  cubeDrag = { x: e.clientX, y: e.clientY, moved: 0, face: e.target.dataset ? e.target.dataset.view : null };
});
cubeWrap.addEventListener('pointermove', (e) => {
  if (!cubeDrag) return;
  const dx = e.clientX - cubeDrag.x, dy = e.clientY - cubeDrag.y;
  cubeDrag.x = e.clientX; cubeDrag.y = e.clientY;
  cubeDrag.moved += Math.hypot(dx, dy);
  if (cubeDrag.moved < 4) return;
  anim = null; userMoved = true; controls.autoRotate = false;
  const off = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(off);
  sph.theta -= dx * 0.012;
  sph.phi = THREE.MathUtils.clamp(sph.phi - dy * 0.012, 0.01, Math.PI - 0.01);
  off.setFromSpherical(sph);
  camera.position.copy(controls.target).add(off);
  camera.lookAt(controls.target);
});
const endCube = () => {
  if (cubeDrag && cubeDrag.moved < 4 && cubeDrag.face && VIEWS[cubeDrag.face]) {
    animateTo({
      dir: VIEWS[cubeDrag.face], target: ZERO,
      dist: isOrtho ? ORTHO_DIST : fitDist(),
      zoom: isOrtho ? fitZoom() : 1,
    }, 0.6);
  }
  cubeDrag = null;
};
cubeWrap.addEventListener('pointerup', endCube);
cubeWrap.addEventListener('pointercancel', () => { cubeDrag = null; });

// ======================================================================
//  PARÇA KÜÇÜK RESİMLERİ (sol panel): tek renderer, her kart 2D canvas
// ======================================================================
const TW = 360, TH = 270;
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
thumbRenderer.setPixelRatio(1);
thumbRenderer.setSize(TW, TH, false);
const thumbScene = new THREE.Scene();
const thumbCam = new THREE.PerspectiveCamera(30, TW / TH, 0.1, 100);
thumbScene.add(new THREE.HemisphereLight(0xffffff, 0xcfd8ee, 1.6));
const thumbSun = new THREE.DirectionalLight(0xfff4e2, 2.0);
thumbSun.position.set(3, 5, 6);
thumbScene.add(thumbSun);
const thumbMesh = new THREE.Mesh();
thumbScene.add(thumbMesh);

function renderThumb(p) {
  thumbMesh.geometry = p.geom;
  thumbMesh.material = p.thumbMat;
  thumbMesh.quaternion.copy(p.thumbQuat);
  const d = (p.radius / Math.sin(rad(thumbCam.fov / 2))) * 1.1;
  thumbCam.position.set(0, 0, d);
  thumbCam.near = d * 0.1;
  thumbCam.far = d * 3;
  thumbCam.updateProjectionMatrix();
  thumbRenderer.render(thumbScene, thumbCam);
  p.ctx.clearRect(0, 0, TW, TH);
  p.ctx.drawImage(thumbRenderer.domElement, 0, 0);
}

// ======================================================================
//  OYUN DURUMU
// ======================================================================
const pieces = [];
const flights = [];
let hoverPiece = null;
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    const p = pieces.find((x) => x.card === en.target);
    if (p) p.visible = en.isIntersecting;
  });
}, { root: listEl, threshold: 0.05 });

function buildCard(p) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<canvas width="${TW}" height="${TH}"></canvas>
    <div class="meta"><b>${p.label}</b><span class="tag">Tıkla</span></div>`;
  listEl.appendChild(card);
  p.card = card;
  p.tag = card.querySelector('.tag');
  p.canvas = card.querySelector('canvas');
  p.ctx = p.canvas.getContext('2d');
  io.observe(card);

  card.addEventListener('pointerenter', () => { hoverPiece = p; });
  card.addEventListener('pointerleave', () => { if (hoverPiece === p) hoverPiece = null; });

  // Sürükle = parçayı çevir, kısa dokunuş/tıklama = yerine gönder
  let drag = null;
  p.canvas.addEventListener('pointerdown', (e) => {
    initAudio();
    p.canvas.setPointerCapture(e.pointerId);
    hoverPiece = p;
    p.grab = true;
    drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
  });
  p.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.hypot(dx, dy);
    const qy = new THREE.Quaternion().setFromAxisAngle(AY, dx * 0.013);
    const qx = new THREE.Quaternion().setFromAxisAngle(AX, dy * 0.013);
    p.thumbQuat.premultiply(qy).premultiply(qx).normalize();
    renderThumb(p);
  });
  const up = () => {
    if (!drag) return;
    const tap = drag.moved < 7 && performance.now() - drag.t < 600;
    drag = null;
    p.grab = false;
    if (tap) placePiece(p);
  };
  p.canvas.addEventListener('pointerup', up);
  p.canvas.addEventListener('pointercancel', () => { drag = null; p.grab = false; });
}

function updateInfo() {
  if (!pieces.length) return;
  const total = pieces.length;
  countEl.textContent = finished ? 'Tamamlandı!' : `${placedCount} / ${total}`;
  barEl.style.width = `${(placedCount / total) * 100}%`;
  const left = total - placedCount;
  leftEl.textContent = left ? `${left} parça kaldı` : 'Hepsi yerinde';
}

function removeCard(p) {
  const c = p.card;
  c.style.height = `${c.offsetHeight}px`;
  void c.offsetHeight;
  c.classList.add('leaving');
  c.style.height = '0px';
  clearTimeout(p.goneTimer);
  p.goneTimer = setTimeout(() => c.classList.add('gone'), 560);
}
function restoreCard(p) {
  clearTimeout(p.goneTimer);
  const c = p.card;
  c.classList.remove('gone', 'leaving', 'done');
  c.style.height = '';
}

function setAnimating(on) {
  animating = on;
  animBtn.textContent = on ? '■ Animasyonu durdur' : '▶ Animasyonu başlat';
  animBtn.classList.toggle('playing', on);
}
animBtn.onclick = () => { initAudio(); setAnimating(!animating); };

function flightStart(p) {
  camera.updateMatrixWorld();
  const z = p.target.clone().project(camera).z;
  return new V3(-0.82, -0.05, z).unproject(camera);
}

function placePiece(p) {
  if (!loaded || p.state !== 'idle') return;
  initAudio();
  p.state = 'flying';
  removeCard(p);
  p.tag.textContent = 'Gidiyor…';
  sfx.pop();

  const from = flightStart(p);
  p.mesh.visible = true;
  p.mesh.position.copy(from);
  p.mesh.quaternion.copy(p.thumbQuat);
  p.mesh.scale.setScalar(0.55);

  const arc = isOrtho ? (ORTHO_H / camera.zoom) * 0.25 : camera.position.distanceTo(controls.target) * 0.1;
  flights.push({ p, t: 0, from, qFrom: p.thumbQuat.clone(), arc });
}

function land(f) {
  const p = f.p;
  p.state = 'placed';
  p.mesh.position.copy(p.target);
  p.mesh.quaternion.copy(IDENT);
  p.mesh.scale.setScalar(1);
  p.ghost.visible = false;
  p.flash = 1;
  p.tag.textContent = 'Yerleşti ✓';
  placedCount++;
  sfx.knock();
  burst(p.target, 24, 2.2);
  updateInfo();
  if (placedCount === pieces.length) finish();
}

function finish() {
  finished = true;
  updateInfo();
  toastEl.classList.add('show');
  hintEl.textContent = 'Animasyon butonuna bas, modeli döndürerek her açıdan incele.';
  burst(new V3(0, MODEL_SIZE * 0.3, 0), 150, 4.5);
  setTimeout(() => burst(new V3(0, MODEL_SIZE * 0.3, 0), 110, 5.5), 450);
  sfx.win();
  controls.autoRotate = false;
}

function restart() {
  finished = false;
  placedCount = 0;
  flights.length = 0;
  setAnimating(false);
  toastEl.classList.remove('show');
  hintEl.textContent = DEFAULT_HINT;
  controls.autoRotate = false;
  pieces.forEach((p) => {
    p.state = 'idle';
    p.mesh.visible = false;
    p.mesh.position.copy(p.target);
    p.mesh.quaternion.copy(IDENT);
    p.mesh.scale.setScalar(1);
    p.ghost.visible = true;
    p.flash = 0;
    if (p.spin) p.spin.v = 0;
    restoreCard(p);
    p.tag.textContent = 'Tıkla';
    renderThumb(p);
  });
  updateInfo();
  goHome();
}
$('restart').onclick = restart;
$('again').onclick = restart;

// ======================================================================
//  MODEL YÜKLEME
// ======================================================================
new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    meshes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    console.log('Parçalar:', meshes.map((m) => m.name));

    // Her parçanın geometrisini dünya konumuna pişir, bütün kutuyu bul
    const whole = new THREE.Box3();
    const raw = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      g.computeBoundingBox();
      const b = g.boundingBox.clone();
      whole.union(b);
      return { m, g, b };
    });
    const wholeSize = whole.getSize(new V3());
    const wholeCenter = whole.getCenter(new V3());
    const S = MODEL_SIZE / Math.max(wholeSize.x, wholeSize.y, wholeSize.z);
    modelRadius = (wholeSize.length() * S) / 2;
    const groundY = -(wholeSize.y * S) / 2;

    raw.forEach((o, i) => {
      const c = o.b.getCenter(new V3());
      const size = o.b.getSize(new V3()).multiplyScalar(S);
      const target = c.clone().sub(wholeCenter).multiplyScalar(S);

      // Geometriyi kendi merkezine al ve ölçekle (hayalet, gerçek parça ve küçük resim aynı geometriyi kullanır)
      const g = o.g;
      g.translate(-c.x, -c.y, -c.z);
      g.scale(S, S, S);
      if (!g.attributes.normal) g.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({ color: WOOD[i % WOOD.length], roughness: 0.55 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.copy(target);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      modelGroup.add(mesh);

      const ghostMat = new THREE.MeshStandardMaterial({
        color: GHOST_COLOR.clone(), transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.3,
      });
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x6f86c9, transparent: true, opacity: 0.4 });
      const ghost = new THREE.Mesh(g, ghostMat);
      ghost.position.copy(target);
      ghost.renderOrder = 1;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), edgeMat);
      edges.renderOrder = 2;
      ghost.add(edges);
      modelGroup.add(ghost);

      // Oyun sonunda dönecek parça mı?
      const lname = o.m.name.toLowerCase();
      const key = SPIN_PARTS.find((k) => lname.includes(k));
      let spin = null;
      if (key) {
        const sz = [size.x, size.y, size.z];
        const thin = sz.indexOf(Math.min(...sz));
        const axisName = SPIN_AXIS[key];
        spin = { axis: (axisName ? AXES['xyz'.indexOf(axisName)] : AXES[thin]).clone(), v: 0 };
      }

      const num = /parca_?(\d+)/i.exec(o.m.name);
      pieces.push({
        name: o.m.name,
        label: num ? `Parça ${num[1]}` : (o.m.name || `Parça ${i + 1}`),
        geom: g, mesh, mat, ghost, ghostMat, edgeMat,
        thumbMat: mat.clone(),
        target, radius: size.length() / 2,
        thumbQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.65 + i * 0.4, 0.1)),
        state: 'idle', flash: 0, spin, visible: true, grab: false,
      });
    });

    // Zemin: yumuşak gölge + model altına hafif leke
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.18 })
    );
    shadowPlane.position.y = groundY - 0.002;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    const sc = document.createElement('canvas');
    sc.width = sc.height = 256;
    {
      const g = sc.getContext('2d');
      const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, 'rgba(110,130,185,0.28)');
      gr.addColorStop(1, 'rgba(110,130,185,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
    const spot = new THREE.Mesh(
      new THREE.CircleGeometry(modelRadius * 1.5, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false })
    );
    spot.position.y = groundY - 0.004;
    spot.renderOrder = -1;
    scene.add(spot);

    // Kamera sınırları + başlangıç görünümü
    controls.minDistance = modelRadius * 0.5;
    controls.maxDistance = modelRadius * 10;
    controls.target.copy(ZERO);
    loaded = true;
    goHome(0);

    listEl.innerHTML = '';
    pieces.forEach((p) => { buildCard(p); renderThumb(p); });
    loaded = true;
    updateInfo();
  },
  undefined,
  (err) => {
    console.error(err);
    countEl.textContent = 'Model yüklenemedi (F12 konsola bak)';
  }
);

// ======================================================================
//  ANA DÖNGÜ
// ======================================================================
const clock = new THREE.Clock();
let lastThumb = performance.now();
const autoQ = new THREE.Quaternion();
const tmp = new V3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4.5);

  if (anim) stepAnim(dt);
  controls.update();
  updateConfetti(dt);

  // Uçan parçalar
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    const p = f.p;
    f.t += dt / FLY_TIME;
    const t = Math.min(f.t, 1);
    const e = easeInOut(t);
    tmp.lerpVectors(f.from, p.target, e);
    tmp.y += Math.sin(Math.PI * t) * f.arc;
    p.mesh.position.copy(tmp);
    p.mesh.quaternion.slerpQuaternions(f.qFrom, IDENT, easeOut(Math.min(1, t * 1.3)));
    p.mesh.scale.setScalar(THREE.MathUtils.lerp(0.55, 1, easeOut(Math.min(1, t * 1.5))));
    if (t >= 1) { flights.splice(i, 1); land(f); }
  }

  pieces.forEach((p) => {
    // Hayalet parlaması: üstüne gelinen / yola çıkan parça
    if (p.ghost.visible) {
      const hot = p === hoverPiece || p.state === 'flying';
      p.ghostMat.color.lerp(hot ? HOT_COLOR : GHOST_COLOR, 0.2);
      p.ghostMat.opacity = THREE.MathUtils.lerp(p.ghostMat.opacity, hot ? 0.45 + 0.2 * pulse : 0.16, 0.2);
      p.edgeMat.opacity = THREE.MathUtils.lerp(p.edgeMat.opacity, hot ? 0.95 : 0.4, 0.2);
      p.edgeMat.color.setHex(hot ? 0x4f6bff : 0x6f86c9);
    }
    // Yerleşince kısa parlama
    if (p.flash > 0) {
      p.flash = Math.max(0, p.flash - dt * 2.2);
      p.mat.emissive.setHex(0x4f6bff);
      p.mat.emissiveIntensity = p.flash * 0.55;
    } else if (p.mat.emissiveIntensity) {
      p.mat.emissiveIntensity = 0;
    }
    // Animasyon açıkken parca_10-13 kendi ekseninde döner
    if (p.spin && p.state === 'placed') {
      const goal = finished && animating ? SPIN_SPEED : 0;
      p.spin.v = THREE.MathUtils.lerp(p.spin.v, goal, 1 - Math.exp(-dt * 1.5));
      if (Math.abs(p.spin.v) > 0.001) p.mesh.rotateOnAxis(p.spin.axis, p.spin.v * dt);
    }
  });

  renderer.render(scene, camera);
  updateCube();

  // Sol paneldeki parçalar yavaşça kendi etrafında döner (yaklaşık 30 fps)
  const now = performance.now();
  if (loaded && now - lastThumb > 33) {
    const step = (now - lastThumb) / 1000;
    lastThumb = now;
    for (const p of pieces) {
      if (p.state !== 'idle' || !p.visible) continue;
      if (!p.grab) p.thumbQuat.premultiply(autoQ.setFromAxisAngle(AY, step * 0.5));
      renderThumb(p);
    }
  }
});

// ======================================================================
//  BUILDER AI (sağ altta, yalnızca görsel – hazır senaryo, gerçek yapay zekâ yok)
// ======================================================================
const aiFab = $('aiFab'), aiPanel = $('aiPanel'), aiBody = $('aiBody');
const AI_SCRIPT = {
  intro: ['Merhaba! Ben Builder AI 👋', 'Bu projede ahşap parçalardan bir robot aracı birlikte kuruyoruz.'],
  steps: [
    { q: 'Daha önce 3D puzzle yaptın mı?',
      opts: [['Evet, yaptım', 'Harika! O zaman hızlı ilerlersin 🚀'], ['İlk kez yapıyorum', 'Sorun değil, adım adım birlikte yaparız 😊']] },
    { q: 'Parçaları nasıl yerleştirmek istersin?',
      opts: [['Sırayla', 'Güzel, listenin en üstünden başla.'], ['Kendim seçeyim', 'Olur, istediğin parçaya tıkla.']] },
  ],
  outro: ['Soldaki bir parçaya tıkla, yerine uçup oturur ✨', 'Sağ üstteki küple modeli her açıdan inceleyebilirsin.'],
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let aiStarted = false;

function aiScroll() { aiBody.scrollTop = aiBody.scrollHeight; }
function aiMsg(text, who) {
  const d = document.createElement('div');
  d.className = `msg ${who}`;
  d.textContent = text;
  aiBody.appendChild(d);
  aiScroll();
}
async function aiSay(lines) {
  for (const line of lines) {
    const t = document.createElement('div');
    t.className = 'msg bot typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    aiBody.appendChild(t);
    aiScroll();
    await wait(650);
    t.remove();
    aiMsg(line, 'bot');
    await wait(180);
  }
}
function aiChoose(labels) {
  return new Promise((res) => {
    const row = document.createElement('div');
    row.className = 'chips';
    labels.forEach((l, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = l;
      b.onclick = () => { row.remove(); aiMsg(l, 'me'); res(i); };
      row.appendChild(b);
    });
    aiBody.appendChild(row);
    aiScroll();
  });
}
async function aiRun() {
  await aiSay(AI_SCRIPT.intro);
  for (const s of AI_SCRIPT.steps) {
    await aiSay([s.q]);
    const i = await aiChoose(s.opts.map((o) => o[0]));
    await aiSay([s.opts[i][1]]);
  }
  await aiSay(AI_SCRIPT.outro);
  await aiChoose(['Başlayalım! 🚀']);
  aiToggle(false);
}
function aiToggle(open) {
  aiPanel.hidden = !open;
  aiFab.classList.toggle('open', open);
  aiFab.classList.remove('pulse');
  if (open && !aiStarted) { aiStarted = true; aiRun(); }
}
aiFab.onclick = () => aiToggle(aiPanel.hidden);
$('aiClose').onclick = () => aiToggle(false);