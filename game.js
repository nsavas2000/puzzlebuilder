import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LANGS, DEFAULT_LANG, FALLBACK_LANG } from './lang.js';
import { createBuilderAI } from './builder-ai.js';
import { createEffects, nameMatches } from './effects.js';

// ======================================================================
//  AYARLAR
// ======================================================================
const MODELS_DIR = 'models/';                 // .glb dosyaları burada
const MODELS_INDEX = 'models/models.json';    // model listesi
const MODELS_INDEX_ALT = 'models.json';       // alternatif yol (kök dizin)
const FALLBACK_MODELS = [
  { id: "ucak", file: "ucak.glb", name: { tr: "Uçak", en: "Airplane", ar: "طائرة", ru: "Самолёт" }, animation: { type: "clouds", direction: [-1, 0, 0], speed: 2.4 } },
  { id: "noel", file: "noel.glb", name: { tr: "Noel", en: "Christmas", ar: "عيد الميلاد", ru: "Рождество" }, animation: { type: "snow" } },
  { id: "labirent", file: "labirent.glb", name: { tr: "Labirent", en: "Maze", ar: "متاهة", ru: "Лабиринт" }, colors: { "parca_10": "#e11d1d" }, animation: { type: "ball", part: "parca_10", speed: 0.9 } },
];

const MODEL_SIZE = 6;                       // modelin sahnedeki en büyük boyutu
const FLY_TIME = 1.1;                       // parçanın yerine gitme süresi (sn)
const ORTHO_H = 10;                         // ortografik kameranın yarı yüksekliği
const ORTHO_DIST = MODEL_SIZE * 4;          // ortografik kameranın uzaklığı
const FIT_MARGIN = 0.7;                     // modelin etrafında bırakılan boşluk (büyüdükçe model küçülür)
const DEFAULT_DIR = new THREE.Vector3(0.95, 0.72, 1.15).normalize(); // başlangıç bakış yönü
const DEFAULT_SPIN_SPEED = 7;               // animasyon hızı (radyan/sn), models.json'da model başına değişir
// Sol paneldeki parçaların boyutu: 0 = hepsi kartı doldurur, 1 = gerçek oranlarıyla (büyük parça büyük, küçük parça küçük görünür)
const THUMB_REL = 0.4;

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
const nextModelBtn = $('nextModel'), modeOrderedBtn = $('modeOrdered'), modeFreeBtn = $('modeFree');

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ======================================================================
//  DİL (metinler lang.js içinde)
// ======================================================================
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* özel mod vb. */ } },
};
let lang = LANGS[store.get('lang')] ? store.get('lang') : (LANGS[DEFAULT_LANG] ? DEFAULT_LANG : Object.keys(LANGS)[0]);

// "a.b.c" yolunu seçili dilde, yoksa yedek dilde ara
function raw(key) {
  for (const code of [lang, FALLBACK_LANG]) {
    let v = LANGS[code] && LANGS[code].t;
    for (const k of key.split('.')) v = v == null ? undefined : v[k];
    if (v !== undefined) return v;
  }
  return key;
}
function t(key, vars) {
  const s = raw(key);
  if (typeof s !== 'string') return key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}

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

const modelGroup = new THREE.Group();   // modele ait her şey (parçalar, hayaletler, zemin) burada; model değişince boşaltılır
scene.add(modelGroup);

let modelRadius = MODEL_SIZE * 0.7;
let loaded = false, finished = false, placedCount = 0;
let loadState = 'loading';              // 'loading' | 'ready' | 'error'
let anim = null;                        // kamera geçiş animasyonu
let animating = false;                  // model animasyonu (butonla açılır)
let userMoved = false;
let models = [], currentModel = null, modelAnim = null;
let mode = store.get('mode') === 'free' ? 'free' : 'ordered';
let maxPieceRadius = 1;
let groundY = 0;                        // modelin zemin yüksekliği (efektler kullanır)

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
  // Parça boyutu modele göre ölçeklenir: büyük parça büyük, küçük parça küçük görünür (THUMB_REL ile ayarlanır)
  const r = THREE.MathUtils.lerp(p.radius, maxPieceRadius, THUMB_REL);
  const d = (r / Math.sin(rad(thumbCam.fov / 2))) * 1.1;
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

const nextPiece = () => pieces.find((p) => p.state === 'idle');
const isLocked = (p) => mode === 'ordered' && p.state === 'idle' && p !== nextPiece();
const pieceLabel = (p) => (p.num != null ? t('part', { n: p.num }) : (p.name || t('part', { n: p.index })));

// ---- ipucu çubuğu ----
let hintTimer = 0;
function refreshHint() {
  if (finished) hintEl.textContent = modelAnim ? t('hintFinishedAnim') : t('hintFinished');
  else hintEl.textContent = mode === 'ordered' ? t('hintOrdered') : t('hint');
}
function flashHint(text, ms = 2600) {
  clearTimeout(hintTimer);
  hintEl.textContent = text;
  hintTimer = setTimeout(refreshHint, ms);
}

// ---- sıralı / serbest mod ----
function setMode(m) {
  mode = m === 'free' ? 'free' : 'ordered';
  store.set('mode', mode);
  modeOrderedBtn.classList.toggle('on', mode === 'ordered');
  modeFreeBtn.classList.toggle('on', mode === 'free');
  if (hoverPiece && isLocked(hoverPiece)) hoverPiece = null;
  updateCardStates();
  refreshHint();
}
modeOrderedBtn.onclick = () => setMode('ordered');
modeFreeBtn.onclick = () => setMode('free');

// Kartların etiketini / etiket rozetini / kilit durumunu güncelle
function updateCardStates() {
  const nx = nextPiece();
  pieces.forEach((p) => {
    if (!p.card) return;
    const locked = isLocked(p);
    const isNext = mode === 'ordered' && p === nx && !finished;
    p.lbl.textContent = pieceLabel(p);
    p.card.classList.toggle('locked', locked);
    p.card.classList.toggle('next', isNext);
    p.tag.textContent =
      p.state === 'placed' ? t('tag.placed')
      : p.state === 'flying' ? t('tag.flying')
      : locked ? t('tag.locked')
      : isNext ? t('tag.next')
      : t('tag.tap');
  });
}

// Sıradaki (ya da verilen) parçayı listede göster, 3B'de hayaletini parlat
function highlightPiece(p = nextPiece()) {
  if (!p || !p.card) return;
  p.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  p.card.classList.remove('blink');
  void p.card.offsetWidth;
  p.card.classList.add('blink');
  p.hintUntil = performance.now() + 2600;
  clearTimeout(p.blinkTimer);
  p.blinkTimer = setTimeout(() => p.card.classList.remove('blink'), 2200);
}

function lockedTap(p) {
  p.card.classList.remove('shake');
  void p.card.offsetWidth;
  p.card.classList.add('shake');
  const nx = nextPiece();
  if (nx) { flashHint(t('lockedHint', { next: pieceLabel(nx) })); highlightPiece(nx); }
  ai.notify('locked');
}

function buildCard(p) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<canvas width="${TW}" height="${TH}"></canvas>
    <div class="meta"><b></b><span class="tag"></span></div>`;
  listEl.appendChild(card);
  p.card = card;
  p.lbl = card.querySelector('b');
  p.tag = card.querySelector('.tag');
  p.canvas = card.querySelector('canvas');
  p.ctx = p.canvas.getContext('2d');
  io.observe(card);

  card.addEventListener('pointerenter', () => { if (!isLocked(p)) hoverPiece = p; });
  card.addEventListener('pointerleave', () => { if (hoverPiece === p) hoverPiece = null; });

  // Sürükle = parçayı çevir, kısa dokunuş/tıklama = yerine gönder
  let drag = null;
  p.canvas.addEventListener('pointerdown', (e) => {
    initAudio();
    p.canvas.setPointerCapture(e.pointerId);
    if (!isLocked(p)) hoverPiece = p;
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
  if (loadState === 'error') {
    countEl.textContent = t('loadFail');
    barEl.style.width = '0%';
    leftEl.textContent = '';
    return;
  }
  if (!pieces.length) {
    countEl.textContent = t('loading');
    barEl.style.width = '0%';
    leftEl.textContent = '';
    return;
  }
  const total = pieces.length;
  countEl.textContent = finished ? t('complete') : `${placedCount} / ${total}`;
  barEl.style.width = `${(placedCount / total) * 100}%`;
  const left = total - placedCount;
  leftEl.textContent = left ? t('left', { n: left }) : t('allPlaced');
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
  c.classList.remove('gone', 'leaving', 'done', 'shake', 'blink');
  c.style.height = '';
}

function refreshAnimBtn() {
  animBtn.textContent = animating ? t('animStop') : t('animStart');
  animBtn.classList.toggle('playing', animating);
}
function setAnimating(on) {
  animating = on;
  refreshAnimBtn();
}
animBtn.onclick = () => { initAudio(); setAnimating(!animating); };

function flightStart(p) {
  camera.updateMatrixWorld();
  const z = p.target.clone().project(camera).z;
  return new V3(-0.82, -0.05, z).unproject(camera);
}

function placePiece(p) {
  if (!loaded || p.state !== 'idle') return;
  if (isLocked(p)) { lockedTap(p); return; }
  initAudio();
  p.state = 'flying';
  updateCardStates();
  removeCard(p);
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
  placedCount++;
  sfx.knock();
  burst(p.target, 24, 2.2);
  updateInfo();
  updateCardStates();
  if (placedCount === pieces.length) finish();
  else ai.notify('placed');
}

function finish() {
  finished = true;
  updateInfo();
  updateCardStates();
  toastEl.classList.add('show');
  refreshHint();
  burst(new V3(0, MODEL_SIZE * 0.3, 0), 150, 4.5);
  setTimeout(() => burst(new V3(0, MODEL_SIZE * 0.3, 0), 110, 5.5), 450);
  sfx.win();
  controls.autoRotate = false;
  ai.notify('finished');
}


// ======================================================================
//  DÖNEN PARÇALAR  (models.json → animation.type = "spin" ya da "group")
//
//  "spin"  : listedeki her parça kendi pivotu etrafında döner (ör. tırtıl)
//            "parts": ["parca_07","parca_08"], "axis": {"parca_07":"x"}, "offset": {"parca_07":[x,y,z]}
//  "group" : birden çok parça TEK GÖVDE gibi ortak pivot etrafında döner (ör. dönme dolap)
//            "range": [4,16]  (parca_04 … parca_16)  ya da  "parts": [...]
//            "exclude": [6,7,8]  → bu parçalar gruptan çıkar, sabit kalır
//            "axis": "z" (verilmezse en ince yön), "offset": [x,y,z]
//
//  offset = pivotun, parçanın (grubun) geometrik merkezine göre kaydırması.
//  Birim milimetre (glb metre ise); farklıysa "unit" yaz (mm için 0.001, m için 1).
//  X sağ, Y yukarı, Z izleyiciye doğru (modelin ilk yüklenen duruşunda).
//  Pivotu elle bulmak için sayfayı ?pivot ile aç.
// ======================================================================
const spinRigs = [];
const _spinQ = new THREE.Quaternion();
const _spinD = new V3();

function applyRig(rig) {                       // pivotu offset'ten yeniden hesapla
  const k = rig.unit * rig.S;
  rig.pivot.copy(rig.center).add(_spinD.set(rig.mm[0] * k, rig.mm[1] * k, rig.mm[2] * k));
  rig.dirty = true;
}

function addRig(key, members, axis, center, mm, unit, S) {
  const m3 = [Number(mm[0]) || 0, Number(mm[1]) || 0, Number(mm[2]) || 0];
  const rig = { key, members, axis, center, mm: m3, unit, S, pivot: new V3(), angle: 0, v: 0, dirty: false };
  applyRig(rig);
  rig.dirty = false;
  members.forEach((p) => { p.spin = rig; });
  spinRigs.push(rig);
}

function setupSpin(S) {
  spinRigs.length = 0;
  const a = modelAnim;
  if (!a || (a.type !== 'spin' && a.type !== 'group')) return;
  const unit = a.unit != null ? Number(a.unit) : 0.001;
  const thinAxis = (size) => { const z = [size.x, size.y, size.z]; return AXES[z.indexOf(Math.min(...z))]; };
  const axisOf = (name, fallback) => {
    const i = typeof name === 'string' ? 'xyz'.indexOf(name.toLowerCase()) : -1;
    return (name && i >= 0 ? AXES[i] : fallback).clone();
  };

  if (a.type === 'spin') {
    a.parts.forEach((key) => {
      const p = pieces.find((q) => nameMatches(q.name, key));
      if (!p) { console.warn(`[animasyon] "${key}" adlı parça modelde yok`); return; }
      const mm = a.offset && Array.isArray(a.offset[key]) ? a.offset[key] : [0, 0, 0];
      addRig(key, [p], axisOf(a.axis && a.axis[key], thinAxis(p.size)), p.target.clone(), mm, unit, S);
    });
    return;
  }

  // group: üyeleri bul, hepsini kapsayan kutunun merkezi = dönüş merkezi
  const inList = (p) => (a.parts || []).some((k) => nameMatches(p.name, k));
  const inRange = (p) => a.range && p.num != null && p.num >= a.range[0] && p.num <= a.range[1];
  // "exclude": [6,7,8] ya da ["parca_06"] → bu parçalar gruptan çıkar, yerinde sabit kalır
  const skip = (p) => (a.exclude || []).some((k) => (typeof k === 'number' ? p.num === k : nameMatches(p.name, k)));
  const members = pieces.filter((p) => (inList(p) || inRange(p)) && !skip(p));
  if (!members.length) { console.warn('[animasyon] group: eşleşen parça yok'); return; }
  const lo = new V3(Infinity, Infinity, Infinity), hi = new V3(-Infinity, -Infinity, -Infinity);
  members.forEach((p) => {
    lo.min(_spinD.copy(p.target).addScaledVector(p.size, -0.5));
    hi.max(_spinD.copy(p.target).addScaledVector(p.size, 0.5));
  });
  const center = lo.clone().add(hi).multiplyScalar(0.5);
  const size = hi.clone().sub(lo);
  const mm = Array.isArray(a.offset) ? a.offset : [0, 0, 0];
  addRig('group', members, axisOf(a.axis, thinAxis(size)), center, mm, unit, S);
}

function updateSpin(dt, speed) {
  const go = finished && animating;
  for (const rig of spinRigs) {
    if (!rig.members.every((p) => p.state === 'placed')) continue;
    rig.v = THREE.MathUtils.lerp(rig.v, go ? speed : 0, 1 - Math.exp(-dt * 1.5));
    if (Math.abs(rig.v) > 0.001) { rig.angle = (rig.angle + rig.v * dt) % (Math.PI * 2); rig.dirty = true; }
    if (!rig.dirty) continue;
    rig.dirty = false;
    // pivot etrafında döndür: yeni konum = pivot + R·(merkez − pivot), yeni yönelim = R
    _spinQ.setFromAxisAngle(rig.axis, rig.angle);
    for (const p of rig.members) {
      p.mesh.quaternion.copy(_spinQ);
      p.mesh.position.copy(p.target).sub(rig.pivot).applyQuaternion(_spinQ).add(rig.pivot);
    }
  }
}

function resetSpin() { spinRigs.forEach((r) => { r.v = 0; r.angle = 0; r.dirty = false; }); }

// Pivot aracı için: bütün parçaları anında yerleştir (bitiş durumuna geç)
function placeAllInstant() {
  if (!loaded || finished) return;
  flights.length = 0;
  pieces.forEach((p) => {
    if (p.state === 'placed') return;
    p.state = 'placed';
    p.mesh.visible = true;
    p.mesh.position.copy(p.target);
    p.mesh.quaternion.copy(IDENT);
    p.mesh.scale.setScalar(1);
    p.ghost.visible = false;
    removeCard(p);
  });
  placedCount = pieces.length;
  updateInfo();
  updateCardStates();
  finish();
}

function restart() {
  if (!loaded) return;
  finished = false;
  placedCount = 0;
  flights.length = 0;
  setAnimating(false);
  toastEl.classList.remove('show');
  controls.autoRotate = false;
  pieces.forEach((p) => {
    p.state = 'idle';
    p.mesh.visible = false;
    p.mesh.position.copy(p.target);
    p.mesh.quaternion.copy(IDENT);
    p.mesh.scale.setScalar(1);
    p.ghost.visible = true;
    p.flash = 0;
    restoreCard(p);
    renderThumb(p);
  });
  resetSpin();
  fx.reset();
  updateInfo();
  updateCardStates();
  refreshHint();
  goHome();
  ai.notify('restart');
}
$('restart').onclick = restart;
$('again').onclick = restart;

// ======================================================================
//  MODEL LİSTESİ, MODEL YÜKLEME / DEĞİŞTİRME
// ======================================================================
const gltfLoader = new GLTFLoader();
let loadToken = 0;
let extras = [];        // zemin gibi modele bağlı ek nesneler (model değişince temizlenir)

function modelName(m) {
  const n = m.name;
  if (!n) return m.id;
  if (typeof n === 'string') return n;
  return n[lang] || n[FALLBACK_LANG] || n.tr || Object.values(n)[0] || m.id;
}

// models.json'daki animation alanını tek biçime getir ({type:'spin'|'group'|'clouds'|'snow'|'ball', ...} ya da null)
function normalizeAnim(a) {
  if (!a || typeof a !== 'object') return null;
  const hasParts = Array.isArray(a.parts) && a.parts.length > 0;
  const hasRange = Array.isArray(a.range) && a.range.length === 2;
  const type = a.type || (hasParts ? 'spin' : null);
  if (!type) return null;
  if (type === 'spin' && !hasParts) return null;
  if (type === 'group' && !hasParts && !hasRange) return null;
  return { ...a, type };
}

const fx = createEffects(THREE, scene);
let fxBroken = false;
const fxCtx = {
  pieces, modelGroup,
  get modelRadius() { return modelRadius; },
  get groundY() { return groundY; },
  get extras() { return extras; },
  get isOrtho() { return isOrtho; },
};

function clearModel() {
  fx.dispose();                 // efektler önce (zemin nesnelerini geri açar)
  fxBroken = false;
  spinRigs.length = 0;
  flights.length = 0;
  hoverPiece = null;
  io.disconnect();
  pieces.forEach((p) => {
    clearTimeout(p.goneTimer); clearTimeout(p.blinkTimer);
    p.geom.dispose(); p.edgeGeom.dispose();
    p.mat.dispose(); p.thumbMat.dispose(); p.ghostMat.dispose(); p.edgeMat.dispose();
  });
  pieces.length = 0;
  extras.forEach((e) => { e.geometry.dispose(); if (e.material.map) e.material.map.dispose(); e.material.dispose(); });
  extras = [];
  while (modelGroup.children.length) modelGroup.remove(modelGroup.children[0]);
  listEl.innerHTML = '';
}

function loadModel(entry) {
  const token = ++loadToken;
  clearModel();
  currentModel = entry;
  modelAnim = normalizeAnim(entry.animation);
  loaded = false; finished = false; placedCount = 0; loadState = 'loading';
  setAnimating(false);
  toastEl.classList.remove('show');
  animBtn.hidden = !modelAnim;
  nextModelBtn.hidden = models.length < 2;
  controls.autoRotate = false;
  refreshModelUi();
  refreshHint();
  updateInfo();

  gltfLoader.load(
    MODELS_DIR + entry.file,
    (gltf) => {
      if (token !== loadToken) return;          // bu arada başka model seçildi
      try { buildModel(gltf); } catch (err) { console.error(err); loadState = 'error'; updateInfo(); }
    },
    undefined,
    (err) => {
      if (token !== loadToken) return;
      console.error(err);
      loadState = 'error';
      updateInfo();
    }
  );
}

function buildModel(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  meshes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  console.log('Parçalar:', meshes.map((m) => m.name));

  // Her parçanın geometrisini dünya konumuna pişir, bütün kutuyu bul
  const whole = new THREE.Box3();
  const rawParts = meshes.map((m) => {
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
  groundY = -(wholeSize.y * S) / 2;

  rawParts.forEach((o, i) => {
    const c = o.b.getCenter(new V3());
    const size = o.b.getSize(new V3()).multiplyScalar(S);
    const target = c.clone().sub(wholeCenter).multiplyScalar(S);

    // Geometriyi kendi merkezine al ve ölçekle
    const g = o.g;
    g.translate(-c.x, -c.y, -c.z);
    g.scale(S, S, S);
    if (!g.attributes.normal) g.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: WOOD[i % WOOD.length], roughness: 0.55 });
    // models.json → "colors": { "parca_10": "#e11d1d" } ile parçaya özel renk
    const colorKey = Object.keys(currentModel.colors || {}).find((k) => nameMatches(o.m.name, k));
    if (colorKey) mat.color.set(currentModel.colors[colorKey]);
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
    const edgeGeom = new THREE.EdgesGeometry(g, 30);
    const edges = new THREE.LineSegments(edgeGeom, edgeMat);
    edges.renderOrder = 2;
    ghost.add(edges);
    modelGroup.add(ghost);

    const spin = null;   // dönüş ayarları buildModel sonunda setupSpin() ile atanır

    const num = /parca_?(\d+)/i.exec(o.m.name);
    pieces.push({
      name: o.m.name,
      index: i + 1,
      num: num ? Number(num[1]) : null,
      geom: g, mesh, mat, ghost, ghostMat, edgeMat, edgeGeom,
      thumbMat: mat.clone(),
      target, size, radius: size.length() / 2,
      thumbQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.65 + i * 0.4, 0.1)),
      state: 'idle', flash: 0, spin, visible: true, grab: false, hintUntil: 0,
    });
  });
  maxPieceRadius = Math.max(...pieces.map((p) => p.radius));
  setupSpin(S);

  // Zemin: yumuşak gölge + model altına hafif leke
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.18 })
  );
  shadowPlane.position.y = groundY - 0.002;
  shadowPlane.receiveShadow = true;
  modelGroup.add(shadowPlane);

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
  modelGroup.add(spot);
  extras.push(shadowPlane, spot);
  fx.setup(modelAnim, fxCtx);

  // Kamera sınırları + başlangıç görünümü
  controls.minDistance = modelRadius * 0.5;
  controls.maxDistance = modelRadius * 10;
  controls.target.copy(ZERO);
  userMoved = false;
  loaded = true;
  loadState = 'ready';
  goHome(0);

  listEl.innerHTML = '';
  pieces.forEach((p) => { buildCard(p); renderThumb(p); });
  updateInfo();
  updateCardStates();
  ai.notify('modelLoaded');
}

function selectModel(m) {
  if (!m) return;
  store.set('model', m.id);
  closeMenus();
  loadModel(m);
  ai.notify('activity');
}
function nextModel() {
  const i = models.indexOf(currentModel);
  selectModel(models[(i + 1) % models.length]);
}
nextModelBtn.onclick = nextModel;

// ======================================================================
//  ÜST ÇUBUK: model ve dil menüleri
// ======================================================================
const MENUS = {
  model: { btn: $('btnModel'), menu: $('menuModel') },
  lang: { btn: $('btnLang'), menu: $('menuLang') },
};
function closeMenus() {
  Object.values(MENUS).forEach(({ btn, menu }) => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
}
function openMenu(name, toggle = false) {
  const { btn, menu } = MENUS[name];
  const wasOpen = !menu.hidden;
  closeMenus();
  if (toggle && wasOpen) return;
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}
MENUS.model.btn.onclick = () => openMenu('model', true);
MENUS.lang.btn.onclick = () => openMenu('lang', true);
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.dd')) closeMenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

function menuItem(label, on, onClick, extra = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dd-item' + (on ? ' on' : '');
  b.setAttribute('role', 'menuitem');
  b.innerHTML = `<span class="chk"></span><span class="nm"></span>${extra}`;
  b.querySelector('.nm').textContent = label;
  b.onclick = onClick;
  return b;
}

function refreshModelUi() {
  $('modelLabel').textContent = currentModel ? modelName(currentModel) : '';
  MENUS.model.menu.innerHTML = '';
  models.forEach((m) => {
    MENUS.model.menu.appendChild(
      menuItem(modelName(m), m === currentModel, () => { closeMenus(); if (m !== currentModel) selectModel(m); },
        normalizeAnim(m.animation) ? '<span class="badge">▶</span>' : '')
    );
  });
}

function buildLangMenu() {
  MENUS.lang.menu.innerHTML = '';
  Object.keys(LANGS).forEach((code) => {
    MENUS.lang.menu.appendChild(menuItem(LANGS[code].name, code === lang, () => changeLang(code)));
  });
}

function changeLang(code) {
  closeMenus();
  if (!LANGS[code] || code === lang) return;
  lang = code;
  store.set('lang', code);
  applyLang();
}

function applyLang() {
  const L = LANGS[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = L.dir || 'ltr';
  document.title = `Ankara Robotik ${t('title')}`;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const s = t(el.dataset.i18nTitle);
    el.title = s;
    el.setAttribute('aria-label', s);
  });
  $('langLabel').textContent = L.short;
  $('aiName').textContent = t('ai.name');
  $('aiRole').textContent = t('ai.role');
  $('aiFabLabel').textContent = t('ai.fab');
  $('aiClose').setAttribute('aria-label', t('ai.close'));
  refreshAnimBtn();
  buildLangMenu();
  refreshModelUi();
  refreshHint();
  updateInfo();
  updateCardStates();
  ai.refreshLang();
}

// ======================================================================
//  BUILDER AI (builder-ai.js): kural tabanlı asistan, oyunla bu arayüzle konuşur
// ======================================================================
const ai = createBuilderAI({
  els: {
    fab: $('aiFab'), panel: $('aiPanel'), body: $('aiBody'), closeBtn: $('aiClose'),
    form: $('aiForm'), input: $('aiInput'), quick: $('aiQuick'),
  },
  t, raw,
  getState: () => {
    const nx = nextPiece();
    return {
      loaded, finished,
      total: pieces.length,
      placed: placedCount,
      left: pieces.length - placedCount,
      next: nx ? pieceLabel(nx) : '',
      mode,
      model: currentModel ? modelName(currentModel) : '',
      hasAnimation: !!modelAnim,
      modelCount: models.length,
    };
  },
  actions: {
    setMode,
    highlight: () => highlightPiece(),
    restart,
    nextModel,
    openModels: () => openMenu('model'),
    openLang: () => openMenu('lang'),
  },
});
// Kullanıcı bir şeye dokundukça "takıldın mı?" sayacı sıfırlanır
document.addEventListener('pointerdown', () => ai.notify('activity'), true);


// ?pivot ile açılınca pivot ayarlama aracı yüklenir (normal kullanımda hiç yüklenmez)
if (new URLSearchParams(location.search).has('pivot')) {
  import('./pivot-tool.js')
    .then((m) => m.startPivotTool({
      THREE, scene,
      getRigs: () => spinRigs, getAnim: () => modelAnim, getModel: () => currentModel,
      getRadius: () => modelRadius, applyRig, placeAll: placeAllInstant,
      setAnimating, isAnimating: () => animating,
    }))
    .catch((err) => console.error('[pivot aracı] yüklenemedi:', err));
}

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
  const nowMs = performance.now();
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

  const spinSpeed = (modelAnim && (modelAnim.type === 'spin' || modelAnim.type === 'group') && modelAnim.speed) || DEFAULT_SPIN_SPEED;
  const fxActive = finished && animating;
  if (!fxBroken) {
    try { fx.update(dt, fxActive); } catch (err) { fxBroken = true; console.error('[efekt] devre dışı:', err); }
  }
  pieces.forEach((p) => {
    // Hayalet parlaması: üstüne gelinen / yola çıkan / ipucu verilen parça
    if (p.ghost.visible) {
      const hot = p === hoverPiece || p.state === 'flying' || p.hintUntil > nowMs;
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
  });

  updateSpin(dt, spinSpeed);

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
//  BAŞLAT: model listesini oku, dili uygula, ilk modeli yükle
// ======================================================================
// models.json'u oku; küçük biçim hatalarını (BOM, // yorumlar, sondaki fazla virgül) tolere et
function parseModelsJson(text) {
  const clean = text.replace(/^\uFEFF/, '');
  try { return JSON.parse(clean); } catch (first) {
    try {
      return JSON.parse(clean.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1'));
    } catch { throw first; }
  }
}

function showNotice(msg) {
  const el = $('notice');
  el.textContent = msg;
  el.hidden = !msg;
}

(async function init() {
  let defaultId = null;
  let problem = '';
  const tryPaths = [MODELS_INDEX, MODELS_INDEX_ALT];
  let loaded = false;
  for (const path of tryPaths) {
    try {
      const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = parseModelsJson(await res.text());
      models = (Array.isArray(data) ? data : data.models || []).filter((m) => m && m.file);
      defaultId = Array.isArray(data) ? null : data.default || null;
      if (models.length) { loaded = true; break; }
    } catch (e) { /* try next */ }
  }
  if (!loaded) {
    console.error('models.json okunamadı (models/ veya kök), yedek modeller kullanılıyor');
    problem = 'models.json bulunamadı';
    models = FALLBACK_MODELS;
  }
  models.forEach((m) => { if (!m.id) m.id = m.file; });
  const wanted = store.get('model') || defaultId;
  currentModel = models.find((m) => m.id === wanted) || models[0];
  setMode(mode);
  applyLang();
  loadModel(currentModel);
  if (problem) showNotice(t('modelsError', { msg: problem }));
})();