// ======================================================================
//  EFEKTLER  (effects.js)
//  Model bitince "Animasyonu başlat" butonuyla çalışan efektler.
//  models.json → "animation": { "type": ... }
//
//    "clouds" : yanından bulutlar geçer, model hafifçe süzülür (uçak için)
//    "snow"   : kar yağar (noel ağacı için)
//    "ball"   : bir parça (top) labirentte kendi başına gezer (labirent için)
//    "spin"   : seçilen parçalar kendi ekseninde döner (game.js içinde)
// ======================================================================

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// "parca_1" anahtarı "parca_10" ile karışmasın: anahtardan sonra rakam gelmemeli
export function nameMatches(name, key) {
  const n = String(name).toLowerCase(), k = String(key).toLowerCase();
  let i = n.indexOf(k);
  while (i !== -1) {
    const after = n[i + k.length];
    if (!after || !/[0-9]/.test(after)) return true;
    i = n.indexOf(k, i + 1);
  }
  return false;
}

// ======================================================================
//  LABİRENT: duvarları ızgaraya çevir, topun gidebileceği yolu bul
//  (saf fonksiyonlar: THREE gerekmez)
// ======================================================================
export function buildMaze({ forEachTri, minX, maxX, minZ, maxZ, cell, r, cy, startX, startZ }) {
  const nx = Math.max(2, Math.ceil((maxX - minX) / cell) + 1);
  const nz = Math.max(2, Math.ceil((maxZ - minZ) / cell) + 1);
  const raw = new Uint8Array(nx * nz);
  // Topun yüksekliğindeki ince dilim: yalnızca bu yüksekliğe değen yüzler duvardır (zemin ve tavan sayılmaz)
  const lo = cy - r * 0.35, hi = cy + r * 0.35;

  const mark = (x, z) => {
    const i = Math.floor((x - minX) / cell), j = Math.floor((z - minZ) / cell);
    if (i >= 0 && i < nx && j >= 0 && j < nz) raw[j * nx + i] = 1;
  };
  const seg = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell * 0.4)));
    for (let k = 0; k <= n; k++) mark(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
  };

  forEachTri((ax, ay, az, bx, by, bz, cx, cyy, cz) => {
    if (Math.max(ay, by, cyy) < lo || Math.min(ay, by, cyy) > hi) return;
    // Dikey yüzler yukarıdan bakınca çizgiye dönüşür → kenarları işaretle
    seg(ax, az, bx, bz); seg(bx, bz, cx, cz); seg(cx, cz, ax, az);
    // Yatay/eğik yüzler alan kaplar → içini de doldur
    const cross = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(cross) / 2 > cell * cell * 0.5) {
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
      const st = cell * 0.5;
      for (let x = x0; x <= x1; x += st) {
        for (let z = z0; z <= z1; z += st) {
          const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
          const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
          const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
          if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) mark(x, z);
        }
      }
    }
  });

  return { nx, nz, cell, minX, minZ, raw, r, blocked: new Uint8Array(nx * nz), R: 1 };
}

// Duvarları top yarıçapının "factor" katı kadar şişir: geriye topun merkezinin gidebileceği yerler kalır
export function dilate(m, factor) {
  const { nx, nz, raw } = m;
  const R = Math.max(1, Math.round((m.r * factor) / m.cell));
  const offs = [];
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (di * di + dj * dj <= R * R) offs.push([di, dj]);
  const blocked = m.blocked;
  blocked.fill(0);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!raw[j * nx + i]) continue;
      for (const [di, dj] of offs) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && ii < nx && jj >= 0 && jj < nz) blocked[jj * nx + ii] = 1;
      }
    }
  }
  m.R = R;
}

// Top koridora ne kadar sıkı otursa da çalışsın: en geniş payla başla, yol bulunamazsa payı küçült
export function prepareMaze(m, startX, startZ) {
  const need = Math.PI * (m.r / m.cell) ** 2 * 8;       // en az ~8 top alanı kadar gezilebilir yer
  let last = null;
  for (const f of [0.9, 0.78, 0.66, 0.55, 0.45, 0.35]) {
    dilate(m, f);
    const c0 = cellOf(m, startX, startZ);
    const st = nearestFree(m, c0.i, c0.j, Math.ceil(m.r / m.cell) * 2);
    if (!st) continue;
    const res = bfs(m, st.i, st.j);
    last = { factor: f, count: res.count };
    if (res.count >= need) return last;
  }
  return null;
}

export const cellOf = (m, x, z) => ({
  i: clamp(Math.floor((x - m.minX) / m.cell), 0, m.nx - 1),
  j: clamp(Math.floor((z - m.minZ) / m.cell), 0, m.nz - 1),
});

// En yakın boş hücre (başlangıçta top duvara çok yakınsa)
export function nearestFree(m, i0, j0, maxRing = 40) {
  if (!m.blocked[j0 * m.nx + i0]) return { i: i0, j: j0 };
  for (let ring = 1; ring <= maxRing; ring++) {
    let best = null, bd = Infinity;
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || i >= m.nx || j < 0 || j >= m.nz || m.blocked[j * m.nx + i]) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = { i, j }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Genişlik öncelikli arama: her hücrenin uzaklığı ve geldiği hücre
export function bfs(m, si, sj) {
  const { nx, nz, blocked } = m;
  const dist = new Int32Array(nx * nz).fill(-1);
  const parent = new Int32Array(nx * nz).fill(-1);
  const queue = new Int32Array(nx * nz);
  let head = 0, tail = 0;
  const s = sj * nx + si;
  dist[s] = 0; queue[tail++] = s;
  while (head < tail) {
    const c = queue[head++];
    const ci = c % nx, cj = (c / nx) | 0;
    for (let k = 0; k < 4; k++) {
      const ii = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), jj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (ii < 0 || ii >= nx || jj < 0 || jj >= nz) continue;
      const n = jj * nx + ii;
      if (blocked[n] || dist[n] >= 0) continue;
      dist[n] = dist[c] + 1; parent[n] = c; queue[tail++] = n;
    }
  }
  return { dist, parent, queue, count: tail, maxDist: tail ? dist[queue[tail - 1]] : 0 };
}

// Gidilecek yeri seç: uzaktaki, en az gezilmiş hücrelerden biri → yol (dünya koordinatı, yumuşatılmış)
export function planPath(m, res, visits, si, sj) {
  if (res.count < 8) return null;
  const minD = Math.max(4, Math.floor(res.maxDist * 0.35));
  let first = 0;
  while (first < res.count && res.dist[res.queue[first]] < minD) first++;
  if (first >= res.count) first = res.count - 1;
  let best = -1, bestV = Infinity;
  for (let k = 0; k < 24; k++) {
    const c = res.queue[first + Math.floor(Math.random() * (res.count - first))];
    if (visits[c] < bestV) { bestV = visits[c]; best = c; }
  }
  const cells = [];
  for (let c = best; c !== -1; c = res.parent[c]) cells.push(c);
  cells.reverse();
  let pts = cells.map((c) => ({ x: m.minX + ((c % m.nx) + 0.5) * m.cell, z: m.minZ + (((c / m.nx) | 0) + 0.5) * m.cell }));
  const w = 2, n = pts.length;
  pts = pts.map((p, k) => {
    const h = Math.min(w, k, n - 1 - k);
    if (h <= 0) return p;
    let x = 0, z = 0;
    for (let q = k - h; q <= k + h; q++) { x += pts[q].x; z += pts[q].z; }
    return { x: x / (2 * h + 1), z: z / (2 * h + 1) };
  });
  return pts;
}

function ballFx(THREE, cfg, ctx) {
  const key = cfg.part || (cfg.parts && cfg.parts[0]);
  const ball = ctx.pieces.find((p) => nameMatches(p.name, key));
  if (!ball) { console.warn(`[efekt] "${key}" adlı top parçası bulunamadı`); return null; }

  const r = Math.max(ball.size.x, ball.size.y, ball.size.z) / 2;
  const cy = ball.target.y;
  const speed = cfg.speed || 1.2;
  let maze = null, visits = null, path = null, cum = null, s = 0, v = 0, failed = false;
  let px = ball.target.x, pz = ball.target.z;
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  function build() {
    // Top dışındaki bütün parçaların üçgenlerini dünya koordinatında tara
    const walls = ctx.pieces.filter((p) => p !== ball);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    walls.forEach((p) => {
      minX = Math.min(minX, p.target.x - p.size.x / 2); maxX = Math.max(maxX, p.target.x + p.size.x / 2);
      minZ = Math.min(minZ, p.target.z - p.size.z / 2); maxZ = Math.max(maxZ, p.target.z + p.size.z / 2);
    });
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) { failed = true; return; }
    const forEachTri = (fn) => {
      walls.forEach((p) => {
        const pos = p.geom.attributes.position, idx = p.geom.index;
        const tx = p.target.x, ty = p.target.y, tz = p.target.z;
        const n = idx ? idx.count : pos.count;
        for (let k = 0; k + 2 < n; k += 3) {
          const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
          fn(pos.getX(a) + tx, pos.getY(a) + ty, pos.getZ(a) + tz,
             pos.getX(b) + tx, pos.getY(b) + ty, pos.getZ(b) + tz,
             pos.getX(c) + tx, pos.getY(c) + ty, pos.getZ(c) + tz);
        }
      });
    };
    const cell = Math.max(r / 5, Math.max(maxX - minX, maxZ - minZ) / 450);   // ince ızgara, ama aşırı büyümesin
    maze = buildMaze({ forEachTri, minX, maxX, minZ, maxZ, cell, r, cy, startX: px, startZ: pz });
    const ok = prepareMaze(maze, px, pz);
    if (!ok) { maze = null; failed = true; console.warn('[efekt] top labirentte gezecek yer bulamadı (top koridora sığmıyor olabilir)'); return; }
    visits = new Uint16Array(maze.nx * maze.nz);
  }

  function plan() {
    const c0 = cellOf(maze, px, pz);
    const f = nearestFree(maze, c0.i, c0.j);
    if (!f) { failed = true; console.warn('[efekt] top labirentte hareket edecek boş yer bulamadı'); return; }
    const res = bfs(maze, f.i, f.j);
    const pts = planPath(maze, res, visits, f.i, f.j);
    if (!pts || pts.length < 2) { failed = true; console.warn('[efekt] top kapalı bir alanda, yol bulunamadı'); return; }
    pts[0] = { x: px, z: pz };
    path = pts;
    cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    s = 0;
  }

  return {
    update(dt, active) {
      if (failed || ball.state !== 'placed') return;
      v += ((active ? speed : 0) - v) * (1 - Math.exp(-dt * 3));
      if (v < 0.005) return;
      if (!maze) { build(); if (!maze) return; }
      if (!path) { plan(); if (!path) return; }
      s = Math.min(s + v * dt, cum[cum.length - 1]);
      let k = 1;
      while (k < cum.length - 1 && cum[k] < s) k++;
      const t = (s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
      const nx = path[k - 1].x + (path[k].x - path[k - 1].x) * t;
      const nz = path[k - 1].z + (path[k].z - path[k - 1].z) * t;
      const dx = nx - px, dz = nz - pz, d = Math.hypot(dx, dz);
      px = nx; pz = nz;
      ball.mesh.position.set(px, cy, pz);
      if (d > 1e-6) {                       // dönerek ilerle: eksen = yukarı × hareket yönü
        axis.set(dz / d, 0, -dx / d);
        ball.mesh.quaternion.premultiply(q.setFromAxisAngle(axis, d / r));
        const c = cellOf(maze, px, pz);
        visits[c.j * maze.nx + c.i]++;
      }
      if (s >= cum[cum.length - 1]) path = null;   // vardı → yeni hedef seç
    },
    reset() { px = ball.target.x; pz = ball.target.z; path = null; v = 0; failed = false; if (visits) visits.fill(0); },
    dispose() {},
  };
}


// ======================================================================
//  BULUTLAR (uçak)
// ======================================================================
function cloudTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  const blobs = [[70, 98, 44], [118, 80, 54], [168, 96, 46], [100, 104, 40], [150, 106, 38], [128, 62, 36]];
  const draw = (dy, inner, outer) => {
    blobs.forEach(([x, y, r]) => {
      const gr = g.createRadialGradient(x, y + dy, 0, x, y + dy, r);
      gr.addColorStop(0, inner); gr.addColorStop(0.7, inner); gr.addColorStop(1, outer);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y + dy, r, 0, 7); g.fill();
    });
  };
  draw(7, 'rgba(120,145,200,0.55)', 'rgba(120,145,200,0)');   // hafif mavi gölge: açık zeminde de görünsün
  draw(0, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  return new THREE.CanvasTexture(c);
}

function cloudsFx(THREE, scene, cfg, ctx) {
  const dir = new THREE.Vector3(...(cfg.direction || [-1, 0, 0]));
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(-1, 0, 0);
  dir.normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
  const R = ctx.modelRadius, L = R * 3.4, speed = cfg.speed || 2.4;
  const tex = cloudTexture(THREE);
  const group = new THREE.Group();
  scene.add(group);
  const clouds = [];
  for (let i = 0; i < (cfg.count || 14); i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
    const sp = new THREE.Sprite(mat);
    const w = R * rand(0.8, 1.7);
    sp.scale.set(w, w * 0.62, 1);
    group.add(sp);
    clouds.push({ sp, mat, p: rand(-L, L), s: (i % 2 ? 1 : -1) * R * rand(0.75, 2.4), h: rand(-R * 0.9, R * 0.9), v: rand(0.7, 1.4) });
  }
  let amount = 0, t = 0;

  const restore = () => {
    ctx.extras.forEach((e) => { e.visible = true; });
    ctx.modelGroup.position.y = 0; ctx.modelGroup.rotation.set(0, 0, 0);
  };
  return {
    update(dt, active) {
      amount += ((active ? 1 : 0) - amount) * (1 - Math.exp(-dt * 2.5));
      t += dt;
      const on = amount > 0.01;
      group.visible = on;
      if (!on) { if (amount !== 0) { amount = 0; restore(); } return; }
      ctx.extras.forEach((e) => { e.visible = amount < 0.05; });   // süzülürken zemin gölgesi olmasın
      ctx.modelGroup.position.y = Math.sin(t * 1.6) * R * 0.018 * amount;
      ctx.modelGroup.rotation.set(Math.sin(t * 0.9) * 0.015 * amount, 0, Math.sin(t * 1.1) * 0.025 * amount);
      clouds.forEach((c) => {
        c.p += speed * c.v * dt;
        if (c.p > L) c.p -= 2 * L;
        c.sp.position.set(dir.x * c.p + side.x * c.s, c.h, dir.z * c.p + side.z * c.s);
        c.mat.opacity = clamp((L - Math.abs(c.p)) / (L * 0.25), 0, 1) * amount * 0.95;
      });
    },
    reset() {},
    dispose() {
      scene.remove(group);
      clouds.forEach((c) => c.mat.dispose());
      tex.dispose();
      restore();
    },
  };
}

// ======================================================================
//  KAR (noel ağacı)
// ======================================================================
function snowFx(THREE, scene, cfg, ctx) {
  const N = cfg.count || 900;
  const R = ctx.modelRadius, S = R * 1.7, top = ctx.groundY + R * 2.4, bottom = ctx.groundY;
  const pos = new Float32Array(N * 3), fall = new Float32Array(N), phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rand(-S, S); pos[i * 3 + 1] = rand(bottom, top); pos[i * 3 + 2] = rand(-S, S);
    fall[i] = rand(0.5, 1.1) * R * 0.4; phase[i] = rand(0, 6.28);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const fc = document.createElement('canvas');
  fc.width = fc.height = 64;
  { const g = fc.getContext('2d');
    g.beginPath(); g.arc(32, 32, 26, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 5; g.strokeStyle = 'rgba(110,140,205,0.9)'; g.stroke(); }
  const flake = new THREE.CanvasTexture(fc);
  const mat = new THREE.PointsMaterial({ size: R * 0.03, map: flake, transparent: true, alphaTest: 0.2, depthWrite: false, opacity: 0 });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

  // Yere hafif kar örtüsü
  const gc = document.createElement('canvas');
  gc.width = gc.height = 128;
  { const g = gc.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.9, 'rgba(150,175,225,0.35)'); gr.addColorStop(1, 'rgba(150,175,225,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const gtex = new THREE.CanvasTexture(gc);
  const gmat = new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false, opacity: 0 });
  const gmesh = new THREE.Mesh(new THREE.CircleGeometry(R * 1.25, 48).rotateX(-Math.PI / 2), gmat);
  gmesh.position.y = bottom + 0.006;
  scene.add(gmesh);

  let amount = 0, t = 0, ortho = null;
  return {
    update(dt, active) {
      amount += ((active ? 1 : 0) - amount) * (1 - Math.exp(-dt * 2));
      const on = amount > 0.01;
      pts.visible = gmesh.visible = on;
      if (!on) return;
      t += dt;
      if (ortho !== ctx.isOrtho) {      // ortografik görünümde nokta boyutu piksel olur
        ortho = ctx.isOrtho;
        mat.sizeAttenuation = !ortho; mat.size = ortho ? 6 : R * 0.03; mat.needsUpdate = true;
      }
      mat.opacity = amount; gmat.opacity = amount * 0.9;
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 1] -= fall[i] * dt;
        pos[i * 3] += Math.sin(t * 1.3 + phase[i]) * 0.25 * dt;
        pos[i * 3 + 2] += Math.cos(t * 1.1 + phase[i]) * 0.2 * dt;
        if (pos[i * 3 + 1] < bottom) {
          pos[i * 3] = rand(-S, S); pos[i * 3 + 1] = top; pos[i * 3 + 2] = rand(-S, S);
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
    reset() {},
    dispose() {
      scene.remove(pts); scene.remove(gmesh);
      geo.dispose(); mat.dispose(); flake.dispose();
      gmesh.geometry.dispose(); gmat.dispose(); gtex.dispose();
    },
  };
}

// ======================================================================
//  Yönetici
// ======================================================================
export function createEffects(THREE, scene) {
  let cur = null;
  const dispose = () => { if (cur) { cur.dispose(); cur = null; } };
  return {
    setup(anim, ctx) {
      dispose();
      if (!anim) return;
      if (anim.type === 'clouds') cur = cloudsFx(THREE, scene, anim, ctx);
      else if (anim.type === 'snow') cur = snowFx(THREE, scene, anim, ctx);
      else if (anim.type === 'ball') cur = ballFx(THREE, anim, ctx);
    },
    update(dt, active) { if (cur) cur.update(dt, active); },
    reset() { if (cur) cur.reset(); },
    dispose,
  };
}