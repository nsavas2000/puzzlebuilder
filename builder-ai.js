// ======================================================================
//  BUILDER AI  (builder-ai.js)
//
//  Tamamen KURAL TABANLI bir proje asistanı: internet / yapay zekâ servisi yok.
//  İki şeyle çalışır:
//   1) OYUN OLAYLARI  → game.js ai.notify('placed' | 'finished' | ...) çağırır,
//                        aşağıdaki EVENT_RULES tablosunda ilk uyan kural konuşur.
//   2) KULLANICI YAZISI → yazılan metin, dil dosyasındaki anahtar kelimelerle
//                        eşleştirilir (lang.js → ai.intents), uyan niyet cevaplanır.
//
//  Bütün cümleler lang.js içindedir; bu dosyada metin yoktur.
//  Yeni kural eklemek için: EVENT_RULES'a satır ekle (olay kuralı) ya da
//  INTENT_HANDLERS'a bir işleyici + lang.js'e anahtar kelimeler ekle (soru kuralı).
// ======================================================================

const IDLE_MS = 45000;      // bu kadar süre hiçbir şey yapılmazsa ipucu önerir
const IDLE_MAX = 3;         // arka arkaya en fazla bu kadar hatırlatma
const LOCK_COOLDOWN = 15000; // "önce sıradaki parçayı yerleştir" mesajı en sık bu aralıkla

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Yazıyı karşılaştırma için sadeleştir: küçük harf, aksansız, Arapça harf biçimleri tek tipe
export function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .normalize('NFD').replace(/\p{M}/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createBuilderAI({ els, t, raw, getState, actions }) {
  const { fab, panel, body, closeBtn, form, input, quick } = els;

  let open = false;
  let started = false;
  let gen = 0;                 // dil değişince / sıfırlanınca eski konuşmaları iptal eder
  let queue = Promise.resolve();
  let chipRow = null;
  let mem = {};                // "yarıyı geçti" gibi bir kez söylenecekler
  let idleTimer = null, idleCount = 0, lastLock = 0;

  const vars = (s) => ({ next: s.next, left: s.left, placed: s.placed, total: s.total, model: s.model });
  const enqueue = (fn) => { queue = queue.then(fn).catch((e) => console.error('[BuilderAI]', e)); return queue; };

  // ------------------------------------------------------------------ sohbet arayüzü
  function scroll() { body.scrollTop = body.scrollHeight; }

  function addMsg(text, who) {
    const d = document.createElement('div');
    d.className = `msg ${who}`;
    d.textContent = text;
    body.appendChild(d);
    scroll();
    if (who === 'bot' && !open) fab.classList.add('unread');
  }

  async function say(lines, g = gen) {
    for (const line of [].concat(lines)) {
      if (!line) continue;
      if (g !== gen) return;
      const typing = document.createElement('div');
      typing.className = 'msg bot typing';
      typing.innerHTML = '<i></i><i></i><i></i>';
      body.appendChild(typing);
      scroll();
      await wait(Math.min(900, 380 + line.length * 7));
      typing.remove();
      if (g !== gen) return;
      addMsg(line, 'bot');
      await wait(120);
    }
  }

  function clearChips() { if (chipRow) { chipRow.remove(); chipRow = null; } }

  // Seçenek butonları (engellemez; her seferinde yalnızca bir satır görünür)
  function offer(labels, onPick) {
    clearChips();
    const row = document.createElement('div');
    row.className = 'chips';
    labels.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.onclick = () => {
        if (chipRow !== row) return;
        clearChips();
        addMsg(label, 'me');
        enqueue(() => onPick(i));
        armIdle();
      };
      row.appendChild(b);
    });
    chipRow = row;
    body.appendChild(row);
    scroll();
  }

  function renderQuick() {
    quick.innerHTML = '';
    const q = raw('ai.quick') || {};
    Object.keys(q).forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qbtn';
      b.textContent = q[id];
      b.onclick = () => { addMsg(q[id], 'me'); clearChips(); enqueue(() => runIntent(id)); armIdle(); };
      quick.appendChild(b);
    });
    input.placeholder = t('ai.placeholder');
    form.querySelector('button').setAttribute('aria-label', t('ai.send'));
  }

  // ------------------------------------------------------------------ açılış konuşması
  async function onboarding(short) {
    const g = gen;
    const s = getState();
    await say(raw('ai.greet').map((l) => l.replace('{model}', s.model)), g);
    if (g !== gen) return;
    if (short) { await say(t('ai.intents.help.reply'), g); return; }
    await say(t('ai.askMode'), g);
    if (g !== gen) return;
    offer([t('ai.pickOrdered'), t('ai.pickFree')], async (i) => {
      actions.setMode(i === 0 ? 'ordered' : 'free');
      await say(t(i === 0 ? 'ai.modeOrderedReply' : 'ai.modeFreeReply'));
      await say(raw('ai.outro'));
      offer([t('ai.go')], () => setOpen(false));
    });
  }

  // ------------------------------------------------------------------ OLAY KURALLARI
  // Her olay için ilk "when" şartı sağlanan kural konuşur. once:true → bir kez.
  const EVENT_RULES = {
    modelLoaded: [
      { id: 'loaded', when: () => started, say: (s) => [t('ai.events.modelLoaded', vars(s))] },
    ],
    placed: [
      { id: 'last', when: (s) => s.left === 1, say: (s) => [t('ai.events.last', vars(s))] },
      { id: 'half', once: true, when: (s) => s.total >= 4 && s.placed >= s.total / 2, say: (s) => [t('ai.events.half', vars(s))] },
      { id: 'first', once: true, when: (s) => s.placed === 1, say: (s) => [t('ai.events.first', vars(s))] },
      { id: 'cheer', when: (s) => s.placed % 3 === 0, say: () => [pick(raw('ai.events.cheer'))] },
    ],
    finished: [
      {
        id: 'finished', when: () => true,
        say: (s) => [t('ai.events.finished', vars(s)), ...(s.hasAnimation ? [t('ai.events.finishedAnim')] : []), ...(s.modelCount > 1 ? [t('ai.events.finishedNext')] : [])],
        offer: (s) => (s.modelCount > 1 ? [[t('ai.nextModel'), () => actions.nextModel()]] : null),
      },
    ],
    restart: [
      { id: 'restart', when: () => true, say: () => [t('ai.events.restart')] },
    ],
    locked: [
      {
        id: 'locked', when: () => Date.now() - lastLock > LOCK_COOLDOWN,
        before: () => { lastLock = Date.now(); },
        say: (s) => [t('ai.events.locked', vars(s))],
        offer: () => [
          [t('ai.switchFree'), async () => { actions.setMode('free'); await say(t('ai.modeFreeReply')); }],
          [t('ai.ok'), () => {}],
        ],
      },
    ],
    idle: [
      {
        id: 'idle', when: (s) => s.loaded && !s.finished && s.left > 0,
        say: (s) => [t('ai.events.idle', vars(s))],
        offer: () => [[t('ai.show'), () => actions.highlight()]],
      },
    ],
  };

  function notify(ev, data = {}) {
    if (ev === 'activity') { idleCount = 0; armIdle(); return; }
    if (ev === 'modelLoaded' || ev === 'restart') { mem = {}; idleCount = 0; }
    if (!started) return;   // panel hiç açılmadıysa asistan kendiliğinden konuşmaz

    const s = getState();
    const rules = EVENT_RULES[ev];
    if (!rules) return;
    const rule = rules.find((r) => (!r.once || !mem[r.id]) && r.when(s, data));
    if (!rule) { armIdle(); return; }
    if (rule.once) mem[rule.id] = true;
    if (rule.before) rule.before();

    enqueue(async () => {
      await say(rule.say(s, data));
      const opts = rule.offer && rule.offer(s, data);
      if (opts) offer(opts.map((o) => o[0]), (i) => opts[i][1]());
    });
    if (ev !== 'finished') armIdle(); else clearTimeout(idleTimer);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const s = getState();
      if (idleCount >= IDLE_MAX || !s.loaded || s.finished) return;
      idleCount++;
      notify('idle');
    }, IDLE_MS);
  }

  // ------------------------------------------------------------------ SORU KURALLARI
  // Her niyet bir işleyici: { lines, after?, offer? } döndürür.
  const reply = (id, s) => t(`ai.intents.${id}.reply`, vars(s));

  const INTENT_HANDLERS = {
    hint: (s) => {
      if (!s.loaded) return { lines: [t('ai.notLoaded')] };
      if (s.finished || s.left === 0) return { lines: [t('ai.allDone')] };
      return { lines: [reply('hint', s)], after: () => actions.highlight() };
    },
    progress: (s) => {
      if (!s.loaded) return { lines: [t('ai.notLoaded')] };
      if (s.finished || s.left === 0) return { lines: [t('ai.allDone')] };
      return { lines: [reply('progress', s)] };
    },
    order: () => { actions.setMode('ordered'); return { lines: [t('ai.modeOrderedReply')] }; },
    free: () => { actions.setMode('free'); return { lines: [t('ai.modeFreeReply')] }; },
    restart: (s) => ({
      lines: [reply('restart', s)],
      offer: [[t('ai.yes'), () => actions.restart()], [t('ai.no'), () => say(t('ai.ok'))]],
    }),
    model: (s) => (s.modelCount > 1
      ? { lines: [reply('model', s)], after: () => actions.openModels() }
      : { lines: [t('ai.oneModel')] }),
    language: (s) => ({ lines: [reply('language', s)], after: () => actions.openLang() }),
    animation: (s) => ({ lines: [t(s.hasAnimation ? 'ai.animYes' : 'ai.animNo')] }),
  };

  async function runIntent(id) {
    const s = getState();
    const h = INTENT_HANDLERS[id];
    const res = h ? h(s) : { lines: [reply(id, s)] };
    await say(res.lines);
    if (res.after) res.after();
    if (res.offer) offer(res.offer.map((o) => o[0]), (i) => res.offer[i][1]());
  }

  // Yazıyı en iyi uyan niyete eşle: eşleşen en uzun anahtar kelime kazanır
  function matchIntent(text) {
    const q = norm(text);
    if (!q) return null;
    const words = q.split(' ');
    const intents = raw('ai.intents') || {};
    let best = null, bestScore = 0;
    for (const id of Object.keys(intents)) {
      for (const key of intents[id].keys || []) {
        const k = norm(key);
        if (!k) continue;
        const hit = k.length <= 3 ? words.includes(k) : q.includes(k);
        if (hit && k.length > bestScore) { best = id; bestScore = k.length; }
      }
    }
    return best;
  }

  async function answer(text) {
    const id = matchIntent(text);
    if (!id) {
      await say(pick(raw('ai.fallback')));
      offer(Object.values(raw('ai.quick')), (i) => runIntent(Object.keys(raw('ai.quick'))[i]));
      return;
    }
    await runIntent(id);
  }

  // ------------------------------------------------------------------ panel aç/kapa, form
  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    fab.classList.toggle('open', v);
    fab.classList.remove('pulse');
    if (v) fab.classList.remove('unread');
    if (v && !started) { started = true; enqueue(() => onboarding(false)); }
    if (v) scroll();
  }

  fab.onclick = () => setOpen(panel.hidden);
  closeBtn.onclick = () => setOpen(false);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg(text, 'me');
    clearChips();
    enqueue(() => answer(text));
    armIdle();
  });
  // Yazarken oyun kısayolları / sürükleme tetiklenmesin
  input.addEventListener('keydown', (e) => e.stopPropagation());

  renderQuick();
  armIdle();

  return {
    notify,
    open: () => setOpen(true),
    // Dil değişince sohbeti yeni dilde baştan kur
    refreshLang() {
      gen++;
      queue = Promise.resolve();
      clearChips();
      body.innerHTML = '';
      renderQuick();
      started = open;
      if (open) enqueue(() => onboarding(true));
    },
  };
}
