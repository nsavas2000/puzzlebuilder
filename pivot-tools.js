// ======================================================================
//  PIVOT ARACI  (pivot-tool.js)  –  sayfayı  index.html?pivot  ile açınca çalışır
//
//  Dönen parçanın (ya da grubun) dönüş noktasını ekranda görerek ayarlarsın:
//   1) "Hepsini yerleştir" → model tamamlanır
//   2) Kırmızı nokta = pivot, kırmızı çizgi = dönüş ekseni
//   3) X / Y / Z kutularıyla (milimetre, parçanın merkezine göre) noktayı motor
//      dingilinin girdiği yere getir. "Açı" çubuğuyla parçayı elle çevirip kontrol et:
//      doğru pivotta parça dingil etrafında döner, kaymaz.
//   4) "JSON'u kopyala" → models.json'daki "animation" alanına yapıştır.
// ======================================================================

export function startPivotTool(api) {
  const { THREE, scene } = api;
  const V3 = THREE.Vector3;

  // ---------------------------------------------------------------- arayüz
  const css = document.createElement('style');
  css.textContent = `
    #pvTool{position:fixed;left:calc(clamp(172px,21vw,300px) + 34px);bottom:58px;z-index:80;width:292px;
      padding:12px 14px;font:600 12px/1.35 system-ui,sans-serif;color:#1c2440;background:#fff;
      border:1.5px solid #ff2d55;border-radius:14px;box-shadow:0 10px 30px rgba(28,36,64,.25);user-select:none}
    #pvTool b{font-size:13px} #pvTool small{color:#6c789a;font-weight:600}
    #pvTool .row{display:flex;gap:6px;align-items:center;margin-top:8px}
    #pvTool label{flex:1;display:flex;flex-direction:column;gap:2px;color:#6c789a;font-size:11px}
    #pvTool input[type=number],#pvTool select{width:100%;box-sizing:border-box;padding:5px 6px;font:700 13px system-ui;
      border:1.5px solid #dfe5f3;border-radius:8px;color:#1c2440;background:#f7f9fd}
    #pvTool input[type=range]{flex:1}
    #pvTool button{flex:1;padding:6px 8px;font:800 12px system-ui;color:#fff;background:#4f6bff;border:0;border-radius:9px;cursor:pointer}
    #pvTool button.alt{color:#4f6bff;background:#eef1ff}
    #pvTool textarea{width:100%;box-sizing:border-box;height:92px;margin-top:8px;padding:6px;font:11px/1.35 ui-monospace,monospace;
      border:1.5px solid #dfe5f3;border-radius:8px;resize:vertical;user-select:text;color:#1c2440}
    @media (max-height:520px){#pvTool{bottom:46px;width:250px;padding:8px 10px}#pvTool textarea{height:56px}}
  `;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'pvTool';
  box.innerHTML = `
    <b>Pivot aracı</b> <small id="pvModel"></small>
    <div class="row"><label>Parça / grup<select id="pvRig"></select></label>
      <label style="max-width:84px">Eksen<select id="pvAxis"><option>x</option><option>y</option><option>z</option></select></label></div>
    <div class="row">
      <label>X (mm)<input id="pvX" type="number" step="0.5"></label>
      <label>Y (mm)<input id="pvY" type="number" step="0.5"></label>
      <label>Z (mm)<input id="pvZ" type="number" step="0.5"></label></div>
    <div class="row"><small>Açı</small><input id="pvAngle" type="range" min="0" max="360" step="1" value="0"><small id="pvAngleTxt">0°</small></div>
    <div class="row"><button id="pvPlace" class="alt" type="button">Hepsini yerleştir</button>
      <button id="pvSpin" class="alt" type="button">▶ Döndür</button></div>
    <textarea id="pvOut" readonly></textarea>
    <div class="row"><button id="pvCopy" type="button">JSON'u kopyala</button></div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  ['pointerdown', 'pointerup', 'wheel', 'keydown'].forEach((ev) => box.addEventListener(ev, (e) => e.stopPropagation()));

  // ---------------------------------------------------------------- sahnedeki işaret (nokta + eksen çizgisi)
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2d55, depthTest: false, transparent: true }));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new V3(0, -1, 0), new V3(0, 1, 0)]),
    new THREE.LineBasicMaterial({ color: 0xff2d55, depthTest: false })
  );
  dot.renderOrder = line.renderOrder = 999;
  dot.visible = line.visible = false;
  scene.add(dot, line);

  // ---------------------------------------------------------------- yardımcılar
  const axisName = (v) => (Math.abs(v.x) > 0.5 ? 'x' : Math.abs(v.y) > 0.5 ? 'y' : 'z');
  const round = (n) => Math.round(n * 10) / 10;
  let lastRigs = [], cur = null;

  function rebuildList() {
    const rigs = api.getRigs();
    lastRigs = rigs.slice();
    $('pvModel').textContent = '· ' + (api.getModel() ? api.getModel().id : '');
    $('pvRig').innerHTML = '';
    rigs.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r.key; $('pvRig').appendChild(o); });
    cur = rigs[0] || null;
    fillInputs();
    refreshOut();
  }

  function fillInputs() {
    if (!cur) { $('pvOut').value = api.getAnim() ? 'Bu modelde "spin" ya da "group" animasyonu yok.' : 'Bu modelde animasyon yok.'; return; }
    $('pvX').value = cur.mm[0]; $('pvY').value = cur.mm[1]; $('pvZ').value = cur.mm[2];
    $('pvAxis').value = axisName(cur.axis);
    const deg = Math.round(((cur.angle * 180) / Math.PI + 360) % 360);
    $('pvAngle').value = deg; $('pvAngleTxt').textContent = deg + '°';
  }

  function refreshOut() {
    const anim = api.getAnim();
    const rigs = api.getRigs();
    if (!anim || !rigs.length) return;
    const out = { ...anim };
    if (anim.type === 'group') {
      out.axis = axisName(rigs[0].axis);
      out.offset = rigs[0].mm.map(round);
    } else {
      out.axis = {}; out.offset = {};
      rigs.forEach((r) => { out.axis[r.key] = axisName(r.axis); out.offset[r.key] = r.mm.map(round); });
    }
    $('pvOut').value = '"animation": ' + JSON.stringify(out, null, 2);
  }

  function apply() {
    if (!cur) return;
    cur.mm = [Number($('pvX').value) || 0, Number($('pvY').value) || 0, Number($('pvZ').value) || 0];
    const n = $('pvAxis').value;
    cur.axis.set(n === 'x' ? 1 : 0, n === 'y' ? 1 : 0, n === 'z' ? 1 : 0);
    // grupta tek düzen var; spin'de her parçanın kendi düzeni (şu an seçili olan değişir)
    api.applyRig(cur);
    refreshOut();
  }

  // ---------------------------------------------------------------- olaylar
  $('pvRig').onchange = () => { cur = api.getRigs()[Number($('pvRig').value)] || null; fillInputs(); };
  ['pvX', 'pvY', 'pvZ'].forEach((id) => { $(id).oninput = apply; });
  $('pvAxis').onchange = apply;
  $('pvAngle').oninput = () => {
    if (!cur) return;
    const deg = Number($('pvAngle').value);
    $('pvAngleTxt').textContent = deg + '°';
    cur.angle = (deg * Math.PI) / 180;
    cur.dirty = true;
  };
  $('pvPlace').onclick = () => api.placeAll();
  $('pvSpin').onclick = () => {
    api.placeAll();                              // bitmemişse önce tamamla
    api.setAnimating(!api.isAnimating());
    $('pvSpin').textContent = api.isAnimating() ? '■ Durdur' : '▶ Döndür';
  };
  $('pvCopy').onclick = async () => {
    const txt = $('pvOut').value;
    try { await navigator.clipboard.writeText(txt); $('pvCopy').textContent = 'Kopyalandı ✓'; }
    catch { $('pvOut').select(); document.execCommand('copy'); $('pvCopy').textContent = 'Seçildi, Ctrl+C'; }
    setTimeout(() => { $('pvCopy').textContent = "JSON'u kopyala"; }, 1800);
  };

  // ---------------------------------------------------------------- her karede: işareti pivota taşı, model değişince listeyi yenile
  let tick = 0;
  (function loop() {
    requestAnimationFrame(loop);
    const rigs = api.getRigs();
    if (++tick % 20 === 0 && (rigs.length !== lastRigs.length || rigs.some((r, i) => r !== lastRigs[i]))) rebuildList();
    if (!cur || !rigs.includes(cur)) { dot.visible = line.visible = false; return; }
    const R = api.getRadius();
    dot.visible = line.visible = true;
    dot.position.copy(cur.pivot);
    dot.scale.setScalar(R * 0.03);
    line.position.copy(cur.pivot);
    line.scale.setScalar(R * 0.55);
    line.quaternion.setFromUnitVectors(new V3(0, 1, 0), cur.axis);
    if (!api.isAnimating()) {
      const deg = Math.round(((cur.angle * 180) / Math.PI + 360) % 360);
      if (Number($('pvAngle').value) !== deg && document.activeElement !== $('pvAngle')) { $('pvAngle').value = deg; $('pvAngleTxt').textContent = deg + '°'; }
    }
  })();

  rebuildList();
  console.log('[pivot aracı] hazır: parçaları yerleştirip kırmızı noktayı dingil deliğine getir.');
}