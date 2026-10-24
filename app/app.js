'use strict';

/* ---------- Small DOM helpers ---------- */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    add(el, c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const app = () => document.getElementById('app');
function add(el, ...kids) {
  el.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
  return el;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
const pct = x => Math.round((x || 0) * 100);
let uid = 0;
const nextId = () => 'u' + (++uid);

/* ---------- Progress (saved in this browser) ---------- */

const STORE_KEY = 'quebec-french-progress-v1';
function defaultState() {
  return {
    version: 1,
    placement: null,
    levels: {},
    activities: {},
    mastery: { skills: {}, tags: {}, counts: {} },
    criteriaHistory: [],
    srs: {}
  };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.version === 1) return Object.assign(defaultState(), s);
  } catch (e) { /* storage unavailable */ }
  return defaultState();
}
let S = loadState();
function saveLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
}
function save() {
  S.updatedAt = Date.now();
  saveLocal();
  cloudSchedule();
}

/* ---------- Cloud sync (claude.ai Artifact db; off anywhere else) ---------- */

const cloud = { ref: null, status: 'off', writing: false, again: false, timer: null };
function cloudBadge() {
  const el = document.getElementById('sync');
  if (!el) return;
  const t = { on: '☁ Saved to your account', saving: '☁ Saving…', error: '⚠ Not synced: saved on this device', off: '' }[cloud.status];
  el.textContent = t; el.hidden = !t;
  el.className = 'sync' + (cloud.status === 'error' ? ' bad' : '');
}
function hasProgress(st) { return !!(st.placement || Object.keys(st.activities || {}).length); }
async function cloudPull() {
  const snap = await cloud.ref.get();
  const d = snap.exists ? snap.data() : null;
  const r = d && typeof d.state === 'string' ? JSON.parse(d.state) : null;
  return r && r.version === 1 ? r : null;
}
async function cloudPush() {
  if (!cloud.ref) return;
  if (cloud.writing) { cloud.again = true; return; }
  cloud.writing = true; cloud.status = 'saving'; cloudBadge();
  try {
    do {
      cloud.again = false;
      await cloud.ref.set({ state: JSON.stringify(S), updatedAt: S.updatedAt || Date.now() });
    } while (cloud.again);
    cloud.status = 'on';
  } catch (e) {
    cloud.status = 'error';
  }
  cloud.writing = false; cloudBadge();
}
function cloudSchedule() {
  if (!cloud.ref) return;
  clearTimeout(cloud.timer);
  cloud.status = 'saving'; cloudBadge();
  cloud.timer = setTimeout(cloudPush, 1500);
}
async function cloudSync(rerender) {
  try {
    const r = await cloudPull();
    if (r && (r.updatedAt || 0) > (S.updatedAt || 0)) {
      S = Object.assign(defaultState(), r); saveLocal();
      if (rerender) rerender();
    } else if (hasProgress(S) && (!r || (S.updatedAt || 0) > (r.updatedAt || 0))) {
      await cloudPush();
    }
    if (cloud.status !== 'error') cloud.status = 'on';
  } catch (e) { cloud.status = 'error'; }
  cloudBadge();
}
async function cloudInit(rerender) {
  const db = await cap('db');
  const user = db && await cap('user');
  const uid = user && await user.id().catch(() => null);
  if (!uid) return;
  cloud.ref = db.doc('data/users/' + uid + '/progress');
  await cloudSync(rerender);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (cloud.timer) { clearTimeout(cloud.timer); cloudPush(); } }
    else if (!cloud.writing) cloudSync(() => { if (!/^#\/?(a|gate|placement)\//.test(location.hash + '/')) rerender(); });
  });
}

/* ---------- Data ---------- */

const DATA = { index: null, levels: {}, placement: null, rules: null, acts: {} };

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

async function loadData() {
  DATA.index = await getJSON('levels/index.json');
  DATA.rules = await getJSON('adaptive-rules.json');
  DATA.placement = await getJSON('placement/placement-test.json');
  await Promise.all(DATA.index.levels.filter(l => l.file).map(async l => {
    DATA.levels[l.id] = await getJSON(l.file);
  }));
  for (const [lid, lv] of Object.entries(DATA.levels)) {
    for (const ls of lv.lessons) for (const a of ls.activities) DATA.acts[a.id] = { act: a, levelId: lid, lesson: ls };
    for (const sec of lv.gateTest.sections) for (const a of sec.activities) DATA.acts[a.id] = { act: a, levelId: lid, gate: true };
  }
}

const levelMeta = id => DATA.index.levels.find(l => l.id === id);
const levelById = id => DATA.levels[id];
const levelIdByNumber = n => 'L' + String(n).padStart(2, '0');
function rubricFor(act, ctx) {
  if (act.rubric) return act.rubric;
  const src = ctx.rubrics || (ctx.levelId && levelById(ctx.levelId).rubrics) || {};
  return src[act.rubricRef];
}
function vocabFor(levelId) {
  const m = {};
  for (const v of levelById(levelId).vocabulary) m[v.id] = v;
  return m;
}
function allVocab() {
  const m = {};
  for (const id of Object.keys(DATA.levels)) Object.assign(m, vocabFor(id));
  return m;
}

/* ---------- Answer checking ---------- */

const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[«»"“”]/g, ' ')
    .replace(/œ/g, 'oe')
    .replace(/-/g, ' ')
    .replace(/[.!?,;:()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Returns { score: 0..1, note } for a typed answer. */
function checkTyped(given, accepted, strictAccents) {
  const g = norm(given);
  if (!g) return { score: 0 };
  for (const a of accepted) if (norm(a) === g) return { score: 1 };
  for (const a of accepted) {
    if (stripAccents(norm(a)) === stripAccents(g)) {
      return strictAccents
        ? { score: 0.5, note: 'Watch the accents: ' + a }
        : { score: 1, note: 'Correct, but watch the accents: ' + a };
    }
  }
  const digits = s => String(s).replace(/\D/g, '');
  for (const a of accepted) {
    if (digits(a).length >= 7 && digits(a) === digits(given)) return { score: 1 };
  }
  return { score: 0 };
}
/** Fraction of expected-phrase entries (alternatives split by " | ") found in text. */
function phraseCheck(text, entries) {
  if (!entries || !entries.length) return { frac: 1, hits: [] };
  const t = stripAccents(norm(text));
  const hits = entries.map(e => e.split('|').some(alt => {
    const a = stripAccents(norm(alt));
    return a && t.includes(a);
  }));
  return { frac: hits.filter(Boolean).length / entries.length, hits };
}

/* ---------- Speech: text-to-speech ---------- */

let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch (e) { voices = []; } }
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
function frVoices() {
  const ca = voices.filter(v => /^fr[-_]CA/i.test(v.lang));
  return ca.length ? ca : voices.filter(v => /^fr/i.test(v.lang));
}
function speak(text, opts = {}) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const vs = frVoices();
    u.lang = (opts.tts && opts.tts.lang) || 'fr-CA';
    if (vs.length) u.voice = vs[(opts.voiceIndex || 0) % vs.length];
    u.rate = (opts.tts && opts.tts.rate) || 0.9;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}
async function speakLines(lines, tts) {
  speechSynthesis.cancel();
  const speakers = [];
  for (const l of lines) {
    if (!speakers.includes(l.speaker)) speakers.push(l.speaker);
    await speak(l.fr, { tts, voiceIndex: speakers.indexOf(l.speaker) });
  }
}
function playButton(label, onPlay, maxPlays) {
  let plays = 0;
  const btn = h('button', { class: 'btn small', type: 'button' }, '▶ ' + label);
  btn.addEventListener('click', async () => {
    if (maxPlays && plays >= maxPlays) return;
    plays++;
    btn.disabled = true;
    await onPlay();
    btn.disabled = !!(maxPlays && plays >= maxPlays);
    if (maxPlays) btn.textContent = '▶ ' + label + ` (${maxPlays - plays} left)`;
  });
  if (maxPlays) btn.textContent = '▶ ' + label + ` (${maxPlays} left)`;
  return btn;
}

/* ---------- Speech: recording and recognition ---------- */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeRecording = null;
// claude.ai Artifact pages can't use the microphone, so start in say-it-aloud mode there
let micBlocked = !!(window.claude && window.claude.use);

/* claude.ai Artifact capabilities: resolve to null anywhere else */
const capCache = {};
function cap(name) {
  if (!(name in capCache)) capCache[name] = (window.claude && window.claude.use) ? Promise.resolve(window.claude.use(name)).catch(() => null) : Promise.resolve(null);
  return capCache[name];
}

async function startRecording(maxSeconds, onText) {
  const rec = { transcript: '', url: null };
  let stream = null, mr = null, chunks = [], recog = null, timer = null, stopped = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mr = new MediaRecorder(stream);
    mr.ondataavailable = e => chunks.push(e.data);
    mr.start();
  } catch (e) {
    rec.error = 'Microphone not available (' + e.message + ').';
    micBlocked = true;
  }
  if (SR) {
    try {
      recog = new SR();
      recog.lang = 'fr-CA';
      recog.continuous = true;
      recog.interimResults = true;
      let finals = '';
      recog.onresult = ev => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finals += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        rec.transcript = (finals + interim).trim();
        onText && onText(rec.transcript);
      };
      recog.onerror = ev => {
        if (ev.error !== 'no-speech' && ev.error !== 'aborted') rec.recogError = ev.error;
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { micBlocked = true; rec.stop && rec.stop(); }
      };
      recog.onend = () => { if (!stopped && !rec.recogError) { try { recog.start(); } catch (e) { /* ended */ } } };
      recog.start();
    } catch (e) { recog = null; }
  }
  const done = new Promise(resolve => {
    rec.stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      if (recog) { try { recog.stop(); } catch (e) { /* already stopped */ } }
      const finish = () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (chunks.length) rec.url = URL.createObjectURL(new Blob(chunks, { type: chunks[0].type || 'audio/webm' }));
        activeRecording = null;
        setTimeout(() => resolve(rec), 400);
      };
      if (mr && mr.state !== 'inactive') { mr.onstop = finish; mr.stop(); } else finish();
    };
  });
  timer = setTimeout(() => rec.stop(), (maxSeconds || 30) * 1000);
  rec.done = done;
  rec.hasRecognition = !!recog;
  activeRecording = rec;
  return rec;
}

/* ---------- Mini Markdown (notes) ---------- */

function inlineMd(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="say">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}
function renderMd(md) {
  const lines = md.split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      out += '<table><thead><tr>' + cells(rows[0]).map(c => '<th>' + inlineMd(c) + '</th>').join('') + '</tr></thead><tbody>';
      for (const r of rows.slice(2)) out += '<tr>' + cells(r).map(c => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>';
      out += '</tbody></table>';
      continue;
    }
    const hm = line.match(/^(#{1,4})\s+(.*)/);
    if (hm) { const n = Math.min(hm[1].length + 1, 4); out += `<h${n}>${inlineMd(hm[2])}</h${n}>`; i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      out += ordered ? '<ol>' : '<ul>';
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        out += '<li>' + inlineMd(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')) + '</li>';
        i++;
      }
      out += ordered ? '</ol>' : '</ul>';
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||#|[-*]\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
    out += '<p>' + inlineMd(para.join(' ')) + '</p>';
  }
  return out;
}
function wireSay(el, tts) {
  el.querySelectorAll('.say').forEach(s => s.addEventListener('click', () => {
    speechSynthesis.cancel();
    speak(s.textContent.replace(/[«»]/g, ''), { tts });
  }));
}

/* ---------- Results, mastery, spaced repetition ---------- */

const SKILLS = { lire: 'Lire', ecouter: 'Écouter', ecrire: 'Écrire', parler: 'Parler' };
const ALPHA = 0.3;

function ema(map, key, x) {
  map[key] = map[key] == null ? x : map[key] + ALPHA * (x - map[key]);
}
function recordResult(act, res) {
  const rec = S.activities[act.id] || { attempts: [], best: 0 };
  rec.attempts.push({ score: res.score, at: new Date().toISOString() });
  rec.best = Math.max(rec.best, res.score);
  S.activities[act.id] = rec;
  if (SKILLS[act.skill] && act.type !== 'notes' && act.type !== 'flashcards') ema(S.mastery.skills, act.skill, res.score);
  for (const it of res.items || []) {
    for (const t of it.tags || []) {
      ema(S.mastery.tags, t, it.score);
      S.mastery.counts[t] = (S.mastery.counts[t] || 0) + 1;
    }
  }
  if (res.criteria && act.type === 'writing') {
    const entry = {};
    for (const [id, c] of Object.entries(res.criteria)) entry[id] = c.max ? c.pts / c.max : 0;
    S.criteriaHistory.push(entry);
    S.criteriaHistory = S.criteriaHistory.slice(-3);
  }
  save();
}
function srsUpdate(vocabId, correct) {
  const boxes = DATA.rules.spacedRepetition.boxes;
  const cur = S.srs[vocabId] || { box: 1 };
  const box = correct ? Math.min(cur.box + 1, boxes.length) : 1;
  const days = boxes[box - 1].reviewAfterDays;
  S.srs[vocabId] = { box, due: new Date(Date.now() + days * 86400000).toISOString() };
  save();
}
function srsDue() {
  const now = Date.now();
  return Object.entries(S.srs).filter(([, v]) => new Date(v.due).getTime() <= now).map(([k]) => k);
}

/* ---------- Progress logic ---------- */

const GRADED = new Set(['quiz', 'writing', 'speaking']);

function fastTrack(lesson) {
  const quizzes = lesson.activities.filter(a => a.type === 'quiz');
  return quizzes.length > 0 && quizzes.every(a => {
    const r = S.activities[a.id];
    return r && r.attempts[0] && r.attempts[0].score >= 0.9;
  });
}
function isRequired(act, lesson) {
  if (act.required === false) return false;
  if (fastTrack(lesson) && (act.type === 'flashcards' || (act.type === 'speaking' && act.mode === 'repeat'))) return false;
  return true;
}
function actDone(act) {
  const r = S.activities[act.id];
  if (!r) return false;
  return GRADED.has(act.type) ? r.best >= 0.6 : true;
}
function needsRetry(act) {
  const r = S.activities[act.id];
  return !!r && GRADED.has(act.type) && r.best < 0.6;
}
function lessonComplete(lesson) {
  return lesson.activities.filter(a => isRequired(a, lesson)).every(actDone);
}
function levelStatus(id) { return (S.levels[id] || {}).status; }
function levelCleared(id) { const s = levelStatus(id); return s === 'passed' || s === 'testedOut'; }
function levelUnlocked(n) {
  if (n === 1) return true;
  if (levelCleared(levelIdByNumber(n))) return true;
  if (levelCleared(levelIdByNumber(n - 1))) return true;
  return !!(S.placement && S.placement.startLevel >= n);
}
function lessonUnlocked(levelId, idx) {
  const lv = levelById(levelId);
  if (!levelUnlocked(lv.number)) return false;
  if (levelStatus(levelId) === 'testedOut' || idx === 0) return true;
  return lessonComplete(lv.lessons[idx - 1]);
}
function gateUnlocked(levelId) {
  const lv = levelById(levelId);
  return levelUnlocked(lv.number) && lv.lessons.every(lessonComplete);
}
function canTestOut(levelId) {
  const lv = levelById(levelId);
  if (!lv || levelCleared(levelId)) return false;
  let highest = 1;
  for (const l of DATA.index.levels) if (levelUnlocked(l.number)) highest = l.number;
  return lv.number > highest && lv.number <= highest + 2;
}
function bridgeActivities(levelId) {
  const out = [];
  for (const ls of levelById(levelId).lessons) {
    for (const a of ls.activities) {
      if (a.type === 'notes' || a.type === 'flashcards' || a.type === 'speaking') out.push({ act: a, lesson: ls });
    }
  }
  return out;
}
function currentLevelId() {
  for (const l of DATA.index.levels) {
    if (!l.file) continue;
    if (levelUnlocked(l.number) && !levelCleared(l.id)) return l.id;
  }
  const built = DATA.index.levels.filter(l => l.file);
  return built[built.length - 1].id;
}
function nextActivity(levelId) {
  const lv = levelById(levelId);
  for (let i = 0; i < lv.lessons.length; i++) {
    const ls = lv.lessons[i];
    if (!lessonUnlocked(levelId, i)) break;
    for (const a of ls.activities) if (isRequired(a, ls) && !actDone(a)) return { act: a, lesson: ls };
  }
  return null;
}
function lessonScore(lesson) {
  const g = lesson.activities.filter(a => GRADED.has(a.type) && S.activities[a.id]);
  if (!g.length) return null;
  return g.reduce((s, a) => s + S.activities[a.id].best, 0) / g.length;
}
function driftWarning() {
  const done = [];
  for (const l of DATA.index.levels) {
    const lv = levelById(l.id);
    if (!lv) continue;
    for (const ls of lv.lessons) if (lessonComplete(ls)) done.push(ls);
  }
  const last = done.slice(-3).map(lessonScore).filter(x => x != null);
  return last.length === 3 && last.reduce((a, b) => a + b, 0) / 3 < 0.65;
}
function weakTags() {
  return Object.entries(S.mastery.tags)
    .filter(([t, m]) => (S.mastery.counts[t] || 0) >= DATA.rules.mastery.minItemsBeforeActing && m < 0.6)
    .map(([t]) => t)
    .filter(t => reviewPool(t).length >= 3);
}
function weakCriteria() {
  const hist = S.criteriaHistory.slice(-3);
  const ids = new Set(hist.flatMap(e => Object.keys(e)));
  return [...ids].filter(id => hist.filter(e => e[id] != null && e[id] < 0.5).length >= 2);
}
function focusSkills() {
  const fs = new Set((S.placement && S.placement.focusSkills) || []);
  const vals = Object.entries(S.mastery.skills);
  if (vals.length >= 3) {
    const avg = vals.reduce((s, [, v]) => s + v, 0) / vals.length;
    for (const [k, v] of vals) if (v <= avg - 0.15) fs.add(k);
  }
  return [...fs];
}
function itemTags(item, act, lesson) {
  const tags = (item.tags || act.tags || []).slice();
  if (lesson && !tags.includes('lesson:' + lesson.id)) tags.push('lesson:' + lesson.id);
  return tags;
}
function reviewPool(tag) {
  const pool = [];
  for (const lv of Object.values(DATA.levels)) {
    for (const ls of lv.lessons) {
      for (const a of ls.activities) {
        if (a.type !== 'quiz' || a.stimulus) continue;
        for (const it of a.items) if (itemTags(it, a, ls).includes(tag)) pool.push(Object.assign({}, it, { id: a.id + ':' + it.id, tags: itemTags(it, a, ls) }));
      }
    }
  }
  return pool;
}
function tagLabel(t) {
  if (t.startsWith('lesson:')) {
    const id = t.slice(7);
    for (const lv of Object.values(DATA.levels)) for (const ls of lv.lessons) if (ls.id === id) return `Leçon ${id} · ${ls.title}`;
  }
  return t.replace(/^[a-z]+:/, '').replace(/-/g, ' ');
}

/* ---------- Activity shell ---------- */

const TYPE_ICON = { notes: '📖', flashcards: '🃏', quiz: '✅', writing: '✍️', speaking: '🎙️' };

function runActivity(container, act, ctx) {
  return new Promise(resolve => {
    container.innerHTML = '';
    const players = { notes: notesPlayer, flashcards: flashPlayer, quiz: quizPlayer, writing: writingPlayer, speaking: speakingPlayer };
    add(container, 
      h('div', { class: 'row spread' },
        h('h2', {}, TYPE_ICON[act.type] + ' ' + act.title),
        SKILLS[act.skill] ? h('span', { class: 'badge accent' }, SKILLS[act.skill]) : null),
      act.instructions ? h('p', { class: 'muted' }, act.instructions) : null,
      players[act.type](act, ctx, resolve)
    );
    window.scrollTo(0, 0);
  });
}

/* Notes */
function notesPlayer(act, ctx, done) {
  const body = h('div', { class: 'card notes', html: renderMd(act.body) });
  wireSay(body, act.tts);
  return h('div', {},
    body,
    h('div', { class: 'sticky-actions' }, h('button', { class: 'btn primary', onclick: () => done({ score: 1, earned: 1, max: 1 }) }, 'Terminé'))
  );
}

/* Flashcards */
function flashPlayer(act, ctx, done) {
  const vmap = ctx.vocab || allVocab();
  let ids = act.vocabIds.filter(id => vmap[id]);
  if (ctx.qcOnly) ids = ids.filter(id => vmap[id].register === 'quebecois');
  if (!ids.length) ids = act.vocabIds.filter(id => vmap[id]);
  ids = shuffle(ids);
  let i = 0, flipped = false, known = 0;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    if (i >= ids.length) {
      add(wrap, h('div', { class: 'card' },
        h('p', {}, `Fini! You knew ${known} of ${ids.length}. Cards you missed come back sooner in Révision.`),
        h('button', { class: 'btn primary', onclick: () => done({ score: 1, earned: 1, max: 1 }) }, 'Continuer')));
      return;
    }
    const v = vmap[ids[i]];
    const card = h('div', { class: 'card flash', onclick: () => { flipped = !flipped; if (flipped) speak(v.fr.split('/')[0], { tts: act.tts }); draw(); } },
      flipped
        ? [h('div', {}, v.fr),
          v.standardEquivalent ? h('div', { class: 'sub' }, 'Standard: ' + v.standardEquivalent) : null,
          v.example ? h('div', { class: 'sub' }, v.example) : null,
          v.notes ? h('div', { class: 'sub' }, v.notes) : null,
          v.register === 'quebecois' ? h('div', { class: 'sub' }, h('span', { class: 'badge warn' }, 'Québec')) : null]
        : [h('div', {}, v.en), h('div', { class: 'sub' }, 'Say it in French, then tap to check')]);
    add(wrap, h('p', { class: 'small muted' }, `Carte ${i + 1} / ${ids.length}`), card);
    if (flipped) {
      const mark = ok => { srsUpdate(v.id, ok); if (ok) known++; i++; flipped = false; draw(); };
      add(wrap, h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => mark(true) }, '✓ Je le savais'),
        h('button', { class: 'btn', onclick: () => mark(false) }, 'Pas encore'),
        h('button', { class: 'btn small', onclick: () => speak(v.fr.split('/')[0], { tts: act.tts }) }, '🔊')));
    }
  };
  draw();
  return wrap;
}

/* Stimulus */
function stimulusEl(st, ctx) {
  if (!st) return { el: null, reveal() {} };
  const box = h('div', { class: 'stimulus' });
  if (st.title) add(box, h('h3', {}, st.title));
  const lines = st.lines || (st.text ? [{ speaker: '', fr: st.text }] : []);
  const script = h('div', {});
  const enEls = [];
  for (const l of lines) {
    const en = l.en ? h('span', { class: 'en', hidden: true }, l.en) : null;
    if (en) enEls.push(en);
    add(script, h('div', { class: 'line' },
      l.speaker ? h('span', { class: 'who' }, l.speaker + ' :') : null,
      h('span', { style: 'white-space:pre-wrap' }, l.fr), en));
  }
  const tr = st.translationEn ? h('span', { class: 'translation', hidden: true }, st.translationEn) : null;
  const hideScript = st.kind === 'audio' && st.transcript !== 'always';
  if (st.kind === 'audio') {
    const maxPlays = st.maxPlays || (ctx.mode === 'gate' || ctx.mode === 'placement' ? 2 : 0);
    add(box, h('div', { class: 'row' }, playButton('Écouter', () => speakLines(lines, st.tts), maxPlays)));
  } else if (lines.length) {
    add(box, h('div', { class: 'row', style: 'margin-bottom:6px' }, playButton('Écouter le texte', () => speakLines(lines, st.tts))));
  }
  if (hideScript) { script.hidden = true; add(box, h('p', { class: 'small muted' }, 'The transcript appears after you submit.')); }
  add(box, script);
  if (tr) add(box, tr);
  return {
    el: box,
    reveal() {
      if (st.transcript === 'never') return;
      script.hidden = false;
      enEls.forEach(e => (e.hidden = false));
      if (tr) tr.hidden = false;
    }
  };
}

/* Quiz items */
function makeItem(item, ctx) {
  const el = h('div', { class: 'q' });
  const pts = item.points || 1;
  const fb = h('div', { class: 'feedback', hidden: true });
  const showFb = (score, extra) => {
    fb.hidden = false;
    fb.className = 'feedback ' + (score >= 1 ? 'good' : 'bad');
    add(fb, score >= 1 ? '✓ Bien!' : score > 0 ? '½ Presque!' : '✗ Pas tout à fait.');
    if (extra) add(fb, ' ', extra);
    if (item.explanation) add(fb, h('span', { class: 'expl' }, item.explanation));
  };
  let grade;
  const name = nextId();

  if (item.kind === 'multiple_choice' || item.kind === 'true_false') {
    const opts = item.kind === 'true_false'
      ? [{ label: 'Vrai (true)', idx: true }, { label: 'Faux (false)', idx: false }]
      : shuffle(item.options.map((o, idx) => ({ label: o, idx })));
    if (ctx.mode === 'placement' && item.kind === 'multiple_choice') opts.push({ label: DATA.placement.dontKnowOption || 'Je ne sais pas', idx: -1 });
    add(el, h('div', { class: 'prompt' }, item.prompt));
    if (item.audioText) add(el, h('div', { class: 'row', style: 'margin-bottom:6px' }, playButton('Écouter', () => speak(item.audioText, { tts: item.tts }), ctx.mode === 'gate' || ctx.mode === 'placement' ? 2 : 0)));
    const labels = opts.map(o => {
      const inp = h('input', { type: 'radio', name, value: String(o.idx) });
      const lab = h('label', { class: 'opt' }, inp, h('span', {}, o.label));
      lab._opt = o; lab._inp = inp;
      add(el, lab);
      return lab;
    });
    grade = () => {
      const sel = labels.find(l => l._inp.checked);
      const ok = sel && sel._opt.idx === item.answer;
      labels.forEach(l => { l._inp.disabled = true; if (l._opt.idx === item.answer) l.classList.add('correct'); });
      if (sel && !ok) sel.classList.add('wrong');
      const correctLabel = labels.find(l => l._opt.idx === item.answer);
      showFb(ok ? 1 : 0, ok ? null : 'Answer: ' + correctLabel._opt.label);
      return ok ? 1 : 0;
    };
  } else if (item.kind === 'fill_blank') {
    const parts = item.prompt.split('___');
    const inputs = [];
    const p = h('div', { class: 'prompt' });
    parts.forEach((part, i) => {
      add(p, part);
      if (i < parts.length - 1) {
        const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', size: 12, 'aria-label': 'blank ' + (i + 1) });
        inputs.push(inp);
        add(p, inp);
      }
    });
    add(el, p);
    if (item.hint) add(el, h('div', { class: 'small muted' }, 'Hint: ' + item.hint));
    grade = () => {
      const notes = [];
      const scores = inputs.map((inp, i) => {
        const acc = Array.isArray(item.acceptedAnswers[i]) ? item.acceptedAnswers[i] : [item.acceptedAnswers[i]];
        const r = checkTyped(inp.value, acc, item.strictAccents || ctx.strictHalf);
        inp.classList.add(r.score >= 1 ? 'ok' : 'no');
        inp.disabled = true;
        if (r.note) notes.push(r.note);
        if (r.score < 1 && !r.note) notes.push('Answer: ' + acc[0]);
        return r.score;
      });
      const s = scores.reduce((a, b) => a + b, 0) / scores.length;
      showFb(s, notes.join(' · '));
      return s;
    };
  } else if (item.kind === 'short_answer' || item.kind === 'dictation') {
    add(el, h('div', { class: 'prompt' }, item.prompt));
    if (item.kind === 'dictation') {
      const maxPlays = ctx.mode === 'gate' || ctx.mode === 'placement' ? 2 : 0;
      add(el, h('div', { class: 'row', style: 'margin-bottom:6px' }, playButton('Écouter', () => speak(item.audioText, { tts: item.tts || { rate: 0.8 } }), maxPlays)));
    }
    const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: 'width:100%' });
    add(el, inp);
    grade = () => {
      const r = checkTyped(inp.value, item.acceptedAnswers, item.strictAccents || ctx.strictHalf);
      inp.classList.add(r.score >= 1 ? 'ok' : 'no');
      inp.disabled = true;
      showFb(r.score, r.note || (r.score < 1 ? 'Answer: ' + item.acceptedAnswers[0] : null));
      return r.score;
    };
  } else if (item.kind === 'matching') {
    add(el, h('div', { class: 'prompt' }, item.prompt));
    const rights = shuffle(item.pairs.map(p => p.right));
    const sels = item.pairs.map(p => {
      const sel = h('select', {}, h('option', { value: '' }, '…'), rights.map(r => h('option', { value: r }, r)));
      add(el, h('div', { class: 'row', style: 'margin:6px 0' }, h('span', { style: 'min-width:40%' }, p.left), sel));
      return sel;
    });
    grade = () => {
      let ok = 0;
      sels.forEach((s, i) => { const good = s.value === item.pairs[i].right; if (good) ok++; s.disabled = true; s.classList.add(good ? 'ok' : 'no'); });
      const s = ok / sels.length;
      showFb(s, s < 1 ? 'Answers: ' + item.pairs.map(p => p.left + ' → ' + p.right).join(' · ') : null);
      return s;
    };
  } else if (item.kind === 'ordering') {
    add(el, h('div', { class: 'prompt' }, item.prompt));
    let order = shuffle(item.options.map((_, i) => i));
    if (order.join() === item.answer.join() && order.length > 1) order = order.slice().reverse();
    const list = h('ol', {});
    let locked = false;
    const drawList = () => {
      list.innerHTML = '';
      order.forEach((oi, pos) => {
        add(list, h('li', { style: 'margin:6px 0' },
          h('span', {}, item.options[oi] + ' '),
          h('button', { class: 'btn small', type: 'button', disabled: locked || pos === 0, onclick: () => { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; drawList(); } }, '↑'),
          ' ',
          h('button', { class: 'btn small', type: 'button', disabled: locked || pos === order.length - 1, onclick: () => { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; drawList(); } }, '↓')));
      });
    };
    drawList();
    add(el, list);
    grade = () => {
      locked = true; drawList();
      const ok = order.join() === item.answer.join();
      showFb(ok ? 1 : 0, ok ? null : 'Order: ' + item.answer.map(i => item.options[i]).join(' → '));
      return ok ? 1 : 0;
    };
  } else {
    add(el, h('p', {}, 'Unsupported item: ' + item.kind));
    grade = () => 0;
  }
  add(el, fb);
  return { el, grade: () => grade() * pts, max: pts };
}

/* Quiz */
function quizPlayer(act, ctx, done) {
  let items = act.items.slice();
  if (act.draw && act.draw < items.length) items = shuffle(items).slice(0, act.draw);
  const stim = stimulusEl(act.stimulus, ctx);
  const made = items.map(it => ({ it, m: makeItem(it, ctx) }));
  const result = h('div');
  const submit = h('button', { class: 'btn primary' }, 'Valider');
  submit.addEventListener('click', () => {
    submit.parentElement.remove();
    let earned = 0, max = 0;
    const res = [];
    for (const { it, m } of made) {
      const s = m.grade();
      earned += s; max += m.max;
      res.push({ tags: itemTags(it, act, ctx.lesson), score: m.max ? s / m.max : 0 });
    }
    stim.reveal();
    const score = max ? earned / max : 0;
    add(result, h('div', { class: 'card' },
      h('div', { class: 'score' }, pct(score) + ' %'),
      h('p', { class: 'muted' }, `${Math.round(earned * 10) / 10} / ${max} points` + (ctx.mode === 'lesson' && score < 0.6 ? ' · Below 60%: try this one again after reviewing the notes.' : '')),
      h('button', { class: 'btn primary', onclick: () => done({ score, earned, max, items: res }) }, 'Continuer')));
  });
  return h('div', {}, stim.el, h('div', { class: 'card' }, made.map(x => x.m.el)), h('div', { class: 'sticky-actions' }, submit), result);
}

/* Claude grading prompt (copy/paste) */
function gradingPrompt(act, ctx, text, rubric) {
  const cefr = ctx.levelId ? levelById(ctx.levelId).cefr : 'placement (A1–A2)';
  return [
    `You grade French written by an adult English-speaking Canadian learning Québec conversational French at CEFR ${cefr}.`,
    'Québec forms (chu, t\'es, pis, je reste à, bienvenue, fin de semaine, ouin…) are correct, not errors, unless the task asks for formal French.',
    'Grade strictly by the rubric bands. Reply with JSON only, in this shape:',
    '{"criteria":[{"id":"…","points":n,"comment":"one sentence in English"}],"corrections":[{"original":"…","corrected":"…","why":"…"}],"encouragement":"one sentence"}',
    '',
    'TASK: ' + act.prompt + (act.promptEn ? ' (' + act.promptEn + ')' : ''),
    act.minWords ? `LENGTH: ${act.minWords}–${act.maxWords} words` : '',
    act.targetStructures ? 'TARGET STRUCTURES: ' + act.targetStructures.join('; ') : '',
    'RUBRIC: ' + JSON.stringify(rubric.criteria),
    act.modelAnswer ? 'MODEL ANSWER: ' + act.modelAnswer : '',
    '',
    'LEARNER TEXT:',
    text
  ].filter(x => x !== '').join('\n');
}

/* Rubric self-rating UI. Returns { el, get(): {pts, max, criteria} , set(id, pts) } */
function rubricRater(rubric, suggestions) {
  const el = h('div');
  const groups = {};
  for (const c of rubric.criteria) {
    const name = nextId();
    const box = h('div', { class: 'crit' }, h('strong', {}, c.name + ` (/${c.maxPoints})`), c.description ? h('div', { class: 'small muted' }, c.description) : null);
    groups[c.id] = c.bands.map(b => {
      const inp = h('input', { type: 'radio', name, value: String(b.points) });
      add(box, h('label', {}, inp, ` ${b.points} – ${b.descriptor}`));
      return inp;
    });
    add(el, box);
  }
  const set = (id, pts) => {
    const g = groups[id];
    if (!g) return;
    let best = g[0];
    for (const inp of g) if (Math.abs(+inp.value - pts) < Math.abs(+best.value - pts)) best = inp;
    best.checked = true;
  };
  for (const [id, pts] of Object.entries(suggestions || {})) set(id, pts);
  const get = () => {
    let pts = 0, max = 0, complete = true;
    const criteria = {};
    for (const c of rubric.criteria) {
      const sel = groups[c.id].find(i => i.checked);
      if (!sel) complete = false;
      const p = sel ? +sel.value : 0;
      pts += p; max += c.maxPoints;
      criteria[c.id] = { pts: p, max: c.maxPoints };
    }
    return { pts, max, criteria, complete };
  };
  return { el, get, set };
}

function copyText(text, pre, btn) {
  const fallback = () => {
    const r = document.createRange(); r.selectNodeContents(pre);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    btn.textContent = 'Selected: copy it now';
  };
  if (!navigator.clipboard) return fallback();
  navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied ✓'; }, fallback);
}

/* Writing */
function writingPlayer(act, ctx, done) {
  const rubric = rubricFor(act, ctx);
  const ta = h('textarea', { spellcheck: 'false', lang: 'fr', placeholder: 'Écris ici…' });
  const wc = h('span', { class: 'small muted' });
  const count = () => { const n = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0; wc.textContent = `${n} words` + (act.minWords ? ` (aim for ${act.minWords}–${act.maxWords})` : ''); return n; };
  ta.addEventListener('input', count);
  count();
  const after = h('div');
  const submit = h('button', { class: 'btn primary' }, 'Soumettre');
  submit.addEventListener('click', () => {
    if (!ta.value.trim()) return;
    submit.parentElement.remove();
    ta.readOnly = true;
    const pc = phraseCheck(ta.value, act.expectedPhrases);
    const sugg = {};
    const task = rubric.criteria.find(c => c.id === 'task');
    if (task && act.expectedPhrases) sugg.task = Math.round(pc.frac * task.maxPoints);
    const rater = rubricRater(rubric, sugg);
    const prompt = gradingPrompt(act, ctx, ta.value, rubric);
    const paste = h('textarea', { placeholder: "Paste Claude's JSON reply here", style: 'min-height:90px' });
    const pasteMsg = h('div', { class: 'small' });
    const corrections = h('div');
    const usePaste = () => {
      try {
        const t = paste.value;
        const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
        for (const c of j.criteria || []) rater.set(c.id, c.points);
        corrections.innerHTML = '';
        if (j.corrections && j.corrections.length) {
          add(corrections, h('h3', {}, 'Corrections'), h('ul', {}, j.corrections.map(c => h('li', {}, h('s', {}, c.original), ' → ', h('strong', {}, c.corrected), c.why ? h('span', { class: 'muted' }, ' · ' + c.why) : null))));
        }
        if (j.criteria) add(corrections, h('ul', {}, j.criteria.map(c => h('li', { class: 'small' }, `${c.id}: ${c.points} · ${c.comment || ''}`))));
        if (j.encouragement) add(corrections, h('p', {}, j.encouragement));
        pasteMsg.textContent = '✓ Grade applied below. You can still adjust it.';
      } catch (e) {
        pasteMsg.textContent = "Couldn't read that. Paste the whole reply, including the { } braces.";
      }
    };
    const promptPre = h('pre', { class: 'copy' }, prompt);
    const askMsg = h('div', { class: 'small' });
    const askBtn = h('button', { class: 'btn primary' }, 'Grade it with Claude');
    const askBox = h('div', { hidden: true, style: 'margin-bottom:10px' }, askBtn, askMsg);
    cap('sample').then(sample => {
      if (!sample) return;
      askBox.hidden = false;
      askBtn.addEventListener('click', async () => {
        askBtn.disabled = true;
        askMsg.textContent = 'Claude is reading your text…';
        try {
          const r = await sample(prompt, { cache: false });
          paste.value = r.text;
          usePaste();
          askMsg.textContent = pasteMsg.textContent.startsWith('✓') ? '✓ Claude graded it. The scores are filled in below and you can still adjust them.' : "Claude's answer couldn't be read. Try again, or rate yourself below.";
          pasteMsg.textContent = '';
          askBtn.disabled = false;
          askBtn.textContent = 'Grade it again';
        } catch (e) {
          askBtn.disabled = e.code === 'not_granted';
          askMsg.textContent = e.code === 'not_granted' ? 'Grading by Claude is turned off for this page. Use the copy option or rate yourself below.'
            : e.code === 'rate_limited' ? 'Too many requests right now. Wait a minute and try again.'
            : "Claude couldn't grade it this time. Try again, or rate yourself below.";
          if (e.code !== 'not_granted') askBtn.disabled = false;
        }
      });
    });
    const finishMsg = h('div', { class: 'small', style: 'color:var(--bad)' });
    add(after, 
      act.expectedPhrases ? h('div', { class: 'card' },
        h('h3', {}, 'Quick check'),
        h('ul', {}, act.expectedPhrases.map((p, i) => h('li', {}, (pc.hits[i] ? '✓ ' : '○ ') + p.split('|').map(s => s.trim()).join(' / '))))) : null,
      act.modelAnswer ? h('div', { class: 'card' }, h('h3', {}, 'Model answer'), h('p', { style: 'white-space:pre-wrap' }, act.modelAnswer)) : null,
      h('div', { class: 'card' },
        h('h3', {}, 'Grade it'),
        askBox,
        h('details', {},
          h('summary', {}, 'Option A: have Claude grade it (recommended)'),
          h('p', { class: 'small' }, 'Copy this, paste it into a Claude chat, then paste the reply back here.'),
          promptPre,
          h('button', { class: 'btn small', onclick: e => copyText(prompt, promptPre, e.target) }, 'Copy'),
          h('div', { style: 'margin-top:8px' }, paste),
          h('button', { class: 'btn small', onclick: usePaste }, 'Use this grade'), pasteMsg, corrections),
        h('p', { class: 'small muted' }, 'Option B: rate yourself honestly with the rubric, comparing to the model answer.'),
        rater.el),
      h('div', { class: 'sticky-actions' }, h('button', {
        class: 'btn primary', onclick: () => {
          const g = rater.get();
          if (!g.complete) { finishMsg.textContent = 'Pick a score for each criterion first.'; return; }
          done({ score: g.max ? g.pts / g.max : 0, earned: g.pts, max: g.max, criteria: g.criteria });
        }
      }, 'Enregistrer la note'), finishMsg));
    after.scrollIntoView({ behavior: 'smooth' });
  });
  return h('div', {},
    h('div', { class: 'card' },
      h('p', {}, h('strong', {}, act.prompt)),
      act.promptEn ? h('details', {}, h('summary', { class: 'small' }, 'English'), h('p', { class: 'small' }, act.promptEn)) : null,
      ta, wc),
    h('div', { class: 'sticky-actions' }, submit),
    after);
}

/* Speaking */
function speakingSteps(act) {
  if (act.mode === 'repeat') return act.expectedPhrases.map(p => ({ model: p, expected: [p] }));
  if (act.mode === 'roleplay') {
    const steps = [];
    let partner = [];
    for (const t of act.turns) {
      if (t.speaker === 'partner') partner.push(t.fr);
      else { steps.push({ partner: partner.join(' '), task: t.task, expected: t.expectedPhrases || [] }); partner = []; }
    }
    if (partner.length) steps.push({ partner: partner.join(' '), closing: true });
    return steps;
  }
  return [{ partner: act.prompt, task: act.promptEn || null, expected: act.expectedPhrases || [] }];
}
function speakingPlayer(act, ctx, done) {
  const steps = speakingSteps(act);
  const results = steps.map(() => null);
  const wrap = h('div');
  if (micBlocked) add(wrap, h('div', { class: 'notice' }, "Recording doesn't work on this page. For each part, say your answer out loud, tap “Je l'ai dit”, then tick the self-check boxes."));
  else if (!SR) add(wrap, h('div', { class: 'notice' }, 'Speech recognition isn\'t available in this browser, so you\'ll self-check instead. Chrome (desktop or Android) or Safari give you automatic transcripts.'));
  const stepsBox = h('div', { class: 'card' });
  const sayButtons = [];
  const noMic = () => sayButtons.forEach(b => { b.btn.hidden = true; b.said.classList.add('primary'); });
  steps.forEach((st, i) => {
    const box = h('div', { class: 'turn' });
    if (st.model) {
      add(box, h('div', { class: 'row' }, h('strong', {}, st.model), playButton('Modèle', () => speak(st.model, { tts: act.tts }))));
    }
    if (st.partner) {
      const text = h('span', { class: 'partner', hidden: !st.closing && act.mode !== 'respond' && act.mode !== 'describe' }, '« ' + st.partner + ' »');
      add(box, h('div', { class: 'row' },
        playButton(act.mode === 'roleplay' ? 'Partenaire' : 'Question', () => speak(st.partner, { tts: act.tts, voiceIndex: 1 })),
        text.hidden ? h('button', { class: 'btn small', type: 'button', onclick: e => { text.hidden = false; e.target.remove(); } }, 'Show text') : null,
        text));
    }
    if (st.task) add(box, h('div', { class: 'small', style: 'margin-top:6px' }, '👉 ' + st.task));
    if (!st.closing) {
      const out = h('div');
      const btn = h('button', { class: 'btn', type: 'button' }, '🎙️ Enregistrer');
      const said = h('button', { class: 'btn', type: 'button' }, '✓ Je l\'ai dit');
      said.addEventListener('click', () => {
        if (rec) return;
        speechSynthesis.cancel();
        out.innerHTML = '';
        add(out, h('div', { class: 'small good' }, '✓ Done. Say it again as many times as you like.'));
        results[i] = { transcript: null, frac: null };
      });
      sayButtons.push({ btn, said });
      let rec = null;
      btn.addEventListener('click', async () => {
        if (rec) { rec.stop(); return; }
        speechSynthesis.cancel();
        out.innerHTML = '';
        const live = h('div', { class: 'transcript' }, SR ? '…' : 'Recording…');
        add(out, live);
        rec = await startRecording(act.maxSeconds || 30, t => { live.textContent = t; });
        if (rec.error) {
          rec.stop(); await rec.done; rec = null;
          out.innerHTML = '';
          add(out, h('div', { class: 'notice' }, "Recording doesn't work on this page. Say your answer out loud, then tap “Je l'ai dit”."));
          noMic();
          return;
        }
        if (rec.error) { out.innerHTML = ''; add(out, h('div', { class: 'notice' }, rec.error)); }
        btn.textContent = '■ Arrêter';
        btn.classList.add('rec');
        const r = await rec.done;
        rec = null;
        btn.textContent = '🎙️ Recommencer';
        btn.classList.remove('rec');
        out.innerHTML = '';
        if (r.url) add(out, h('audio', { controls: true, src: r.url, style: 'width:100%;margin-top:6px' }));
        if (r.hasRecognition && !r.recogError) {
          const pc = phraseCheck(r.transcript, st.expected);
          add(out, h('div', { class: 'transcript' }, r.transcript || '(nothing recognised)'));
          if (st.expected.length) add(out, h('div', { class: 'small' }, st.expected.map((p, k) => (pc.hits[k] ? '✓ ' : '○ ') + p.split('|').map(s => s.trim()).join(' / ')).join('   ')));
          results[i] = { transcript: r.transcript, frac: pc.frac };
        } else {
          if (r.recogError) add(out, h('div', { class: 'small muted' }, 'No transcript this time (' + r.recogError + '). Use the self-check below.'));
          results[i] = { transcript: null, frac: null };
        }
      });
      add(box, h('div', { class: 'row', style: 'margin-top:8px' }, btn, said), out);
    }
    add(stepsBox, box);
  });
  const checks = (act.selfCheck || []).map(c => { const inp = h('input', { type: 'checkbox' }); return { inp, el: h('label', { class: 'opt' }, inp, h('span', {}, c)) }; });
  const rubric = rubricFor(act, ctx);
  const levelRater = ctx.mode === 'placement' && rubric ? rubricRater(rubric) : null;
  const msg = h('div', { class: 'small', style: 'color:var(--bad)' });
  let warnedSelf = false;
  const finish = h('button', {
    class: 'btn primary', onclick: () => {
      const recorded = results.filter(Boolean);
      const needed = steps.filter(s => !s.closing).length;
      if (recorded.length < needed) { msg.textContent = `Answer all ${needed} parts first: record each one, or say it out loud and tap “Je l'ai dit”.`; return; }
      if (levelRater && !levelRater.get().complete) { msg.textContent = 'Pick the level that matches what you said.'; return; }
      if (checks.length && !checks.some(c => c.inp.checked) && !warnedSelf) {
        warnedSelf = true;
        msg.textContent = 'Your score comes from the self-check. Tick each box you managed, then tap Terminer again.';
        return;
      }
      const self = checks.length ? checks.filter(c => c.inp.checked).length / checks.length : 1;
      const fr = recorded.filter(r => r.frac != null).map(r => r.frac);
      let score = fr.length ? 0.5 * (fr.reduce((a, b) => a + b, 0) / fr.length) + 0.5 * self : self;
      const res = { score, earned: score * 12, max: 12, transcripts: recorded.map(r => r.transcript) };
      if (levelRater) { const g = levelRater.get(); res.criteria = g.criteria; res.score = g.pts / g.max; res.earned = res.score * 12; }
      done(res);
    }
  }, 'Terminer');
  add(wrap, stepsBox,
    h('div', { class: 'card' },
      act.modelAnswer ? h('details', {}, h('summary', {}, 'Model answer'), h('p', {}, act.modelAnswer), playButton('Écouter', () => speak(act.modelAnswer.replace(/\s\/\s/g, '. '), { tts: act.tts }))) : null,
      checks.length ? h('h3', {}, 'Self-check') : null,
      checks.map(c => c.el),
      levelRater ? [h('h3', {}, 'Which best describes what you said?'), levelRater.el] : null),
    h('div', { class: 'sticky-actions' }, finish, msg));
  if (micBlocked) noMic();
  return wrap;
}

/* ---------- Views ---------- */

function crumbs(...parts) {
  return h('div', { class: 'crumbs' }, parts.map((p, i) => [i ? ' › ' : '', p.href ? h('a', { href: p.href }, p.label) : p.label]));
}
function skillBars() {
  return h('div', {}, Object.entries(SKILLS).map(([k, label]) => {
    const v = S.mastery.skills[k];
    return h('div', { class: 'skillrow' }, h('span', {}, label), h('div', { class: 'bar' }, h('span', { style: `width:${pct(v)}%` })), h('span', { class: 'small muted' }, v == null ? '–' : pct(v) + '%'));
  }));
}

function viewHome() {
  const root = app();
  root.innerHTML = '';
  add(root, h('h1', {}, 'Bienvenue! 👋'));
  if (!S.placement) {
    add(root, h('div', { class: 'card' },
      h('h2', {}, 'Start with the placement test'),
      h('p', {}, 'About 15 to 30 minutes. It finds your starting level and the skills that need more practice, then sets up the plan for you.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: '#/placement' }, 'Commencer le test'),
        h('a', { class: 'btn', href: '#/level/L01' }, 'Skip it and start Level 1'))));
  } else {
    const lid = currentLevelId();
    const nx = levelById(lid) && nextActivity(lid);
    const fs = focusSkills();
    const due = srsDue().length;
    add(root, h('div', { class: 'card' },
      h('h2', {}, 'Continuer'),
      nx
        ? h('p', {}, `Niveau ${levelById(lid).number} · Leçon ${nx.lesson.id} · `, h('strong', {}, nx.act.title))
        : gateUnlocked(lid) && !levelCleared(lid)
          ? h('p', {}, `All lessons done. Time for the Level ${levelById(lid).number} test!`)
          : h('p', {}, levelMeta(levelIdByNumber(S.placement.startLevel)) && !levelMeta(levelIdByNumber(S.placement.startLevel)).file
            ? `Your placement starts you at Level ${S.placement.startLevel}, which is still being written. Meanwhile, do your Québec bridge packs and review.`
            : 'Open your level to keep going.'),
      h('div', { class: 'row' },
        nx ? h('a', { class: 'btn primary', href: `#/a/${nx.act.id}` }, 'Continuer ▶') : h('a', { class: 'btn primary', href: gateUnlocked(lid) && !levelCleared(lid) ? `#/gate/${lid}` : `#/level/${lid}` }, 'Ouvrir ▶'),
        due ? h('a', { class: 'btn', href: '#/review' }, `🃏 ${due} card${due > 1 ? 's' : ''} to review`) : null)));
    const bridges = Object.keys(DATA.levels).filter(id => levelStatus(id) === 'testedOut');
    const bridgeTodo = bridges.map(id => ({ id, left: bridgeActivities(id).filter(x => !S.activities[x.act.id]).length })).filter(b => b.left);
    const notices = [];
    if (bridgeTodo.length) notices.push(h('div', { class: 'notice info' }, '🌉 Bridge pack: ', bridgeTodo.map(b => h('a', { href: `#/level/${b.id}` }, `Level ${levelById(b.id).number} (${b.left} left)`)), ' · Québec forms and speaking from levels you tested out of.'));
    if (fs.length) notices.push(h('div', { class: 'notice info' }, '🎯 Focus skills: ' + fs.map(s => SKILLS[s]).join(', ') + '. Do these activities first in each lesson.'));
    const wt = weakTags();
    if (wt.length) notices.push(h('div', { class: 'notice' }, '🔁 Review suggested: ', wt.map(t => h('a', { href: `#/practice/tag/${encodeURIComponent(t)}`, style: 'margin-right:8px' }, tagLabel(t)))));
    const wc = weakCriteria();
    const critAdvice = { spelling: h('span', {}, 'spelling & accents → ', h('a', { href: '#/practice/dictation' }, 'dictation drill')), grammar: 'grammar → re-read the notes for the structures in your last writing', vocab: 'vocabulary & register → flashcards and model answers', task: 'task completion → check every point in the prompt before submitting' };
    if (wc.length) notices.push(h('div', { class: 'notice' }, '✍️ Writing focus: ', wc.map(c => h('span', { style: 'margin-right:10px' }, critAdvice[c] || c))));
    if (driftWarning()) {
      const prev = levelById(lid).number - 1;
      notices.push(h('div', { class: 'notice' }, '📉 Your last three lessons averaged under 65%. ', prev >= 1 && levelById(levelIdByNumber(prev)) ? h('a', { href: `#/gate/${levelIdByNumber(prev)}` }, `Retake the Level ${prev} test as a checkpoint`) : 'Consider redoing the weakest activities.', '.'));
    }
    add(root, ...notices);
    add(root, h('div', { class: 'card' }, h('h2', {}, 'Tes compétences'), skillBars(),
      h('p', { class: 'small muted' }, `Placement: start Level ${S.placement.startLevel}.`)));
  }
  add(root, h('h2', {}, 'Le parcours'), h('div', { class: 'card' }, h('ul', { class: 'list' }, DATA.index.levels.map(l => {
    const st = levelStatus(l.id);
    const unlocked = levelUnlocked(l.number);
    const badge = !l.file ? h('span', { class: 'badge' }, 'Bientôt')
      : st === 'passed' ? h('span', { class: 'badge good' }, 'Réussi ✓')
        : st === 'testedOut' ? h('span', { class: 'badge good' }, 'Testé ✓')
          : unlocked ? h('span', { class: 'badge accent' }, 'Ouvert') : h('span', { class: 'badge' }, '🔒');
    const label = h('span', {}, h('strong', {}, `${l.number}. ${l.title}`), ' ', h('span', { class: 'small muted' }, l.cefr));
    return h('li', {}, l.file ? h('a', { href: `#/level/${l.id}`, class: unlocked ? '' : 'locked' }, label, badge) : h('div', { class: 'item locked' }, label, badge));
  }))));
}

function activityStatus(a, lesson) {
  const r = S.activities[a.id];
  if (needsRetry(a)) return h('span', { class: 'badge bad' }, 'À refaire');
  if (r) return h('span', { class: 'badge good' }, GRADED.has(a.type) ? `✓ ${pct(r.best)}%` : '✓');
  if (!isRequired(a, lesson)) return h('span', { class: 'badge' }, 'Optionnel');
  return null;
}

function viewLevel(levelId) {
  const lv = levelById(levelId);
  const root = app();
  root.innerHTML = '';
  if (!lv) { add(root, h('p', {}, 'This level is not written yet.')); return; }
  const unlocked = levelUnlocked(lv.number);
  const st = levelStatus(levelId);
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: `Niveau ${lv.number}` }),
    h('h1', {}, `Niveau ${lv.number} · ${lv.title}`),
    h('p', { class: 'muted' }, lv.description));
  if (!unlocked) {
    add(root, h('div', { class: 'notice' }, '🔒 Pass the previous level\'s test to unlock this level.'),
      canTestOut(levelId) ? h('div', { class: 'card' }, h('p', {}, 'Already know this material? Take the level test now. Pass it and the level is marked as tested out.'), h('a', { class: 'btn', href: `#/gate/${levelId}?testout=1` }, 'Test out')) : null);
  }
  if (st === 'testedOut') {
    const items = bridgeActivities(levelId);
    add(root, h('div', { class: 'card' },
      h('h2', {}, '🌉 Bridge pack'),
      h('p', { class: 'small muted' }, 'You tested out of this level. These activities cover the Québec forms and speaking practice from it.'),
      h('ul', { class: 'list' }, items.map(x => h('li', {}, h('a', { href: `#/a/${x.act.id}?bridge=1` }, h('span', {}, TYPE_ICON[x.act.type] + ' ' + x.lesson.id + ' · ' + x.act.title), S.activities[x.act.id] ? h('span', { class: 'badge good' }, '✓') : null))))));
  }
  add(root, h('div', { class: 'card' }, h('h2', {}, 'Leçons'), h('ul', { class: 'list' }, lv.lessons.map((ls, i) => {
    const req = ls.activities.filter(a => isRequired(a, ls));
    const doneN = req.filter(actDone).length;
    const open = lessonUnlocked(levelId, i);
    const badge = lessonComplete(ls) ? h('span', { class: 'badge good' }, fastTrack(ls) ? '⚡ Fast track ✓' : '✓') : open ? h('span', { class: 'badge accent' }, `${doneN}/${req.length}`) : h('span', { class: 'badge' }, '🔒');
    return h('li', {}, open ? h('a', { href: `#/lesson/${levelId}/${ls.id}` }, h('span', {}, h('strong', {}, ls.id + ' '), ls.title), badge) : h('div', { class: 'item locked' }, h('span', {}, h('strong', {}, ls.id + ' '), ls.title), badge));
  }))));
  const g = S.levels[levelId] || {};
  const gateOpen = gateUnlocked(levelId);
  const reviewOk = gateReviewDone(levelId);
  add(root, h('div', { class: 'card' },
    h('h2', {}, '🏁 ' + lv.gateTest.title),
    h('p', { class: 'small muted' }, `Pass: ${lv.gateTest.passRule.overallPercent}% overall and ${lv.gateTest.passRule.sectionMinPercent}% in every section.`),
    g.gate ? h('p', {}, `Last result: ${pct(g.gate.overall)}% ` , h('span', { class: 'badge ' + (g.gate.passed ? 'good' : 'bad') }, g.gate.passed ? 'Réussi' : 'Pas encore')) : null,
    g.gate && !g.gate.passed && g.gate.review ? h('div', {}, h('p', { class: 'small' }, 'Review before retaking: redo the quizzes in lessons ', g.gate.review.map(id => h('a', { href: `#/lesson/${levelId}/${id}`, style: 'margin-right:6px' }, id)), reviewOk ? '✓' : '')) : null,
    gateOpen && reviewOk ? h('a', { class: 'btn primary', href: `#/gate/${levelId}` }, st === 'passed' ? 'Retake the test' : 'Start the test')
      : h('p', { class: 'small muted' }, gateOpen ? 'Finish the review above to unlock the retake.' : 'Finish every lesson to unlock the test.')));
}
function gateReviewDone(levelId) {
  const g = (S.levels[levelId] || {}).gate;
  if (!g || g.passed || !g.review) return true;
  const lv = levelById(levelId);
  const since = new Date(g.at).getTime();
  return g.review.every(lid => {
    const ls = lv.lessons.find(l => l.id === lid);
    return ls.activities.filter(a => a.type === 'quiz').every(a => (S.activities[a.id] || { attempts: [] }).attempts.some(t => new Date(t.at).getTime() > since));
  });
}

function viewLesson(levelId, lessonId) {
  const lv = levelById(levelId);
  const ls = lv && lv.lessons.find(l => l.id === lessonId);
  const root = app();
  root.innerHTML = '';
  if (!ls) { add(root, h('p', {}, 'Lesson not found.')); return; }
  const fs = focusSkills();
  const acts = ls.activities.slice().sort((a, b) => (fs.includes(b.skill) ? 1 : 0) - (fs.includes(a.skill) ? 1 : 0));
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: `Niveau ${lv.number}`, href: `#/level/${levelId}` }, { label: ls.id }),
    h('h1', {}, `${ls.id} · ${ls.title}`),
    ls.titleEn ? h('p', { class: 'muted' }, ls.titleEn) : null,
    h('div', { class: 'card' }, h('h3', {}, 'Objectifs'), h('ul', {}, ls.objectives.map(o => h('li', {}, o)))),
    fastTrack(ls) ? h('div', { class: 'notice info' }, '⚡ Fast track: you aced the quizzes, so flashcards and repeat-after-me are now optional.') : null,
    h('div', { class: 'card' }, h('ul', { class: 'list' }, acts.map(a => h('li', {}, h('a', { href: `#/a/${a.id}` },
      h('span', {}, TYPE_ICON[a.type] + ' ' + a.title, ' ', SKILLS[a.skill] ? h('span', { class: 'badge' + (fs.includes(a.skill) ? ' warn' : '') }, SKILLS[a.skill]) : null),
      activityStatus(a, ls)))))));
}

async function viewActivity(actId, query) {
  const ref = DATA.acts[actId];
  const root = app();
  root.innerHTML = '';
  if (!ref || ref.gate) { add(root, h('p', {}, 'Activity not found.')); return; }
  const lv = levelById(ref.levelId);
  const idx = lv.lessons.indexOf(ref.lesson);
  const bridge = query.get('bridge') === '1';
  if (!bridge && !lessonUnlocked(ref.levelId, idx)) { add(root, h('p', {}, '🔒 This lesson is locked.')); return; }
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: `Niveau ${lv.number}`, href: `#/level/${ref.levelId}` }, { label: ref.lesson.id, href: `#/lesson/${ref.levelId}/${ref.lesson.id}` }));
  const box = h('div');
  add(root, box);
  const ctx = { mode: 'lesson', levelId: ref.levelId, lesson: ref.lesson, vocab: vocabFor(ref.levelId), qcOnly: bridge };
  const res = await runActivity(box, ref.act, ctx);
  recordResult(ref.act, res);
  const nx = bridge ? null : ref.lesson.activities.find(a => isRequired(a, ref.lesson) && !actDone(a));
  const lessonDone = lessonComplete(ref.lesson);
  box.innerHTML = '';
  add(box, h('div', { class: 'card' },
    h('h2', {}, needsRetry(ref.act) ? 'Presque!' : 'Bravo! 🎉'),
    GRADED.has(ref.act.type) ? h('div', { class: 'score' }, pct(res.score) + ' %') : null,
    needsRetry(ref.act) ? h('p', {}, 'Below 60%, so this one stays on your list. Review the notes and try again.') : null,
    lessonDone && !bridge ? h('p', {}, `Leçon ${ref.lesson.id} terminée ✓`) : null,
    h('div', { class: 'row' },
      needsRetry(ref.act) ? h('a', { class: 'btn', href: `#/a/${ref.act.id}?again=${Date.now()}` }, 'Réessayer') : null,
      nx ? h('a', { class: 'btn primary', href: `#/a/${nx.id}` }, 'Suivant ▶ ' + nx.title) : null,
      !nx && !bridge && lessonDone && lv.lessons[idx + 1] ? h('a', { class: 'btn primary', href: `#/lesson/${ref.levelId}/${lv.lessons[idx + 1].id}` }, 'Leçon suivante ▶') : null,
      !nx && !bridge && lessonDone && !lv.lessons[idx + 1] ? h('a', { class: 'btn primary', href: `#/level/${ref.levelId}` }, 'Vers le test du niveau ▶') : null,
      h('a', { class: 'btn', href: bridge ? `#/level/${ref.levelId}` : `#/lesson/${ref.levelId}/${ref.lesson.id}` }, 'Retour'))));
}

async function viewGate(levelId, query) {
  const lv = levelById(levelId);
  const root = app();
  root.innerHTML = '';
  if (!lv) { add(root, h('p', {}, 'Level not found.')); return; }
  const testout = query.get('testout') === '1';
  if (!testout && !(gateUnlocked(levelId) && gateReviewDone(levelId)) && !levelCleared(levelId)) { add(root, h('p', {}, '🔒 Finish the lessons (and any review) first.')); return; }
  if (testout && !canTestOut(levelId)) { add(root, h('p', {}, 'Test-out isn\'t available for this level right now.')); return; }
  const gt = lv.gateTest;
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: `Niveau ${lv.number}`, href: `#/level/${levelId}` }, { label: 'Test' }),
    h('h1', {}, gt.title + (testout ? ' (test out)' : '')));
  const box = h('div', { class: 'card' }, h('p', {}, gt.instructions), h('button', { class: 'btn primary', id: 'go' }, 'Commencer'));
  add(root, box);
  await new Promise(r => box.querySelector('#go').addEventListener('click', r));
  const ctx = { mode: 'gate', levelId, vocab: vocabFor(levelId), strictHalf: false };
  const sections = [];
  for (const sec of gt.sections) {
    let earned = 0, max = 0;
    for (const a of sec.activities) {
      box.innerHTML = '';
      box.prepend(h('p', { class: 'small muted' }, `Section : ${sec.title}`));
      const inner = h('div');
      add(box, inner);
      const res = await runActivity(inner, a, Object.assign({}, ctx, { strictHalf: sec.skill === 'ecrire' }));
      earned += res.earned; max += res.max;
      for (const it of res.items || []) for (const t of it.tags || []) { ema(S.mastery.tags, t, it.score); S.mastery.counts[t] = (S.mastery.counts[t] || 0) + 1; }
    }
    const p = max ? earned / max : 0;
    ema(S.mastery.skills, sec.skill, p);
    sections.push({ skill: sec.skill, title: sec.title, earned, max, p, review: sec.reviewLessons || [] });
  }
  const total = sections.reduce((s, x) => s + x.earned, 0) / sections.reduce((s, x) => s + x.max, 0);
  const passed = total * 100 >= gt.passRule.overallPercent && sections.every(s => s.p * 100 >= gt.passRule.sectionMinPercent);
  const weak = sections.filter(s => s.p * 100 < gt.passRule.sectionMinPercent);
  const review = [...new Set(weak.flatMap(s => s.review))].sort();
  const prev = S.levels[levelId] || {};
  S.levels[levelId] = Object.assign(prev, {
    gate: { overall: total, sections: sections.map(s => ({ skill: s.skill, p: s.p })), passed, at: new Date().toISOString(), review: passed ? null : (review.length ? review : levelById(levelId).lessons.map(l => l.id)) }
  });
  if (passed) {
    if (testout) {
      for (const l of DATA.index.levels) if (l.number <= lv.number && !levelCleared(l.id)) S.levels[l.id] = Object.assign(S.levels[l.id] || {}, { status: 'testedOut' });
      S.levels[levelId].status = 'testedOut';
    } else if (S.levels[levelId].status !== 'testedOut') S.levels[levelId].status = 'passed';
  }
  save();
  const excellent = passed && total >= 0.95 && sections.every(s => s.p >= 0.9);
  const nextLevelId = levelIdByNumber(lv.number + 1);
  box.innerHTML = '';
  add(box, 
    h('h2', {}, passed ? 'Réussi! 🎉' : 'Pas encore…'),
    h('div', { class: 'score' }, pct(total) + ' %'),
    sections.map(s => h('div', { class: 'skillrow' }, h('span', {}, s.title), h('div', { class: 'bar' }, h('span', { style: `width:${pct(s.p)}%;background:${s.p * 100 >= gt.passRule.sectionMinPercent ? 'var(--good)' : 'var(--bad)'}` })), h('span', { class: 'small' }, pct(s.p) + '%'))),
    passed
      ? h('p', {}, testout ? 'You tested out of this level. A bridge pack with its Québec forms is waiting on the level page.' : `Level ${lv.number + 1} is unlocked.`)
      : h('p', {}, `To pass you need ${gt.passRule.overallPercent}% overall and ${gt.passRule.sectionMinPercent}% in each section. ` + (testout ? 'No penalty for a test-out attempt; your results now guide your practice.' : 'Review lessons ' + S.levels[levelId].gate.review.join(', ') + ', then retake it.')),
    h('div', { class: 'row' },
      excellent && levelById(nextLevelId) && canTestOut(nextLevelId) ? h('a', { class: 'btn', href: `#/gate/${nextLevelId}?testout=1` }, `Excellent! Test out of Level ${lv.number + 1}?`) : null,
      h('a', { class: 'btn primary', href: passed && levelMeta(nextLevelId) && levelMeta(nextLevelId).file ? `#/level/${nextLevelId}` : `#/level/${levelId}` }, 'Continuer')));
}

async function viewPlacement() {
  const P = DATA.placement;
  const root = app();
  root.innerHTML = '';
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: 'Test de classement' }), h('h1', {}, P.title));
  const box = h('div', { class: 'card' }, h('p', {}, P.instructions),
    S.placement ? h('div', { class: 'notice' }, 'Retaking the placement test replaces your previous placement (your activity history stays).') : null,
    h('button', { class: 'btn primary', id: 'go' }, 'Commencer'));
  add(root, box);
  await new Promise(r => box.querySelector('#go').addEventListener('click', r));
  const rule = P.placementRule;
  const ctx = { mode: 'placement', rubrics: P.rubrics, vocab: allVocab() };
  const bands = P.bands.filter(b => b.level > 0).sort((a, b) => a.level - b.level);
  const skillAgg = {};
  const bandScores = {};
  let receptive = null;
  for (const band of bands) {
    let earned = 0, max = 0;
    for (const a of band.activities) {
      box.innerHTML = '';
      add(box, h('p', { class: 'small muted' }, `Partie ${band.level} · ${band.title}`));
      const inner = h('div');
      add(box, inner);
      const res = await runActivity(inner, a, ctx);
      earned += res.earned; max += res.max;
      const sk = skillAgg[a.skill] || (skillAgg[a.skill] = { earned: 0, max: 0, byLevel: {} });
      sk.earned += res.earned; sk.max += res.max;
      sk.byLevel[band.level] = res.max ? res.earned / res.max : 0;
      for (const it of res.items || []) for (const t of it.tags || []) { ema(S.mastery.tags, t, it.score); S.mastery.counts[t] = (S.mastery.counts[t] || 0) + 1; }
    }
    const p = max ? earned / max : 0;
    bandScores[band.level] = p;
    if (p * 100 < rule.bandPassPercent && receptive == null) receptive = band.level;
    if (p * 100 < rule.stopBelowPercent) break;
  }
  if (receptive == null) receptive = bands[bands.length - 1].level + 1;
  const prod = { ecrire: 0, parler: 0 };
  for (const band of P.bands.filter(b => b.level === 0)) {
    for (const a of band.activities) {
      box.innerHTML = '';
      add(box, h('p', { class: 'small muted' }, band.title));
      const inner = h('div');
      add(box, inner);
      const res = await runActivity(inner, a, ctx);
      const lvl = res.criteria && res.criteria.level ? res.criteria.level.pts : Math.round(res.score * 5);
      prod[a.skill] = lvl;
    }
  }
  const productionLevel = Math.floor((prod.ecrire + prod.parler) / 2);
  const maxLevel = DATA.index.levels.length;
  const startLevel = Math.max(1, Math.min(receptive, productionLevel + 1, maxLevel));
  // Skill percentages: receptive skills from their quizzes; production blends in the free tasks.
  const skills = {};
  for (const [k, v] of Object.entries(skillAgg)) skills[k] = v.max ? v.earned / v.max : 0;
  skills.parler = prod.parler / 5;
  if (skills.ecrire != null) skills.ecrire = (skills.ecrire + prod.ecrire / 5) / 2;
  const best = Math.max(...Object.values(skills));
  const focus = Object.entries(skills).filter(([, v]) => v <= best - 0.2).map(([k]) => k);
  for (const [k, v] of Object.entries(skills)) S.mastery.skills[k] = v;
  S.placement = { takenAt: new Date().toISOString(), bands: bandScores, skills, receptiveLevel: receptive, productionLevel, writingLevel: prod.ecrire, speakingLevel: prod.parler, startLevel, focusSkills: focus };
  for (const l of DATA.index.levels) {
    if (l.number < startLevel && !levelCleared(l.id)) S.levels[l.id] = Object.assign(S.levels[l.id] || {}, { status: 'testedOut' });
  }
  const known = new Set((P.priorKnowledge && P.priorKnowledge.knownVocabIds) || []);
  const box3 = DATA.rules.spacedRepetition.boxes[2];
  for (const id of known) if (!S.srs[id]) S.srs[id] = { box: 3, due: new Date(Date.now() + box3.reviewAfterDays * 86400000).toISOString() };
  save();
  box.innerHTML = '';
  const startMeta = levelMeta(levelIdByNumber(startLevel));
  add(box, 
    h('h2', {}, `Résultat : Niveau ${startLevel}`),
    h('p', {}, startMeta ? `${startMeta.title} (${startMeta.cefr})` : ''),
    h('div', {}, Object.entries(SKILLS).map(([k, label]) => h('div', { class: 'skillrow' }, h('span', {}, label), h('div', { class: 'bar' }, h('span', { style: `width:${pct(skills[k])}%` })), h('span', { class: 'small' }, skills[k] == null ? '–' : pct(skills[k]) + '%')))),
    h('ul', {},
      h('li', {}, `Reading, listening and grammar reached Level ${Math.min(receptive, maxLevel)}.`),
      h('li', {}, `Free writing: level ${prod.ecrire}/5 · free speaking: level ${prod.parler}/5.`),
      startLevel > 1 ? h('li', {}, `Levels below ${startLevel} are marked tested out, each with a short Québec bridge pack.`) : null,
      focus.length ? h('li', {}, 'Focus skills: ' + focus.map(s => SKILLS[s]).join(', ') + '. These come first in each lesson.') : null),
    startMeta && !startMeta.file ? h('div', { class: 'notice info' }, `Level ${startLevel} is still being written. Start with your bridge pack and flashcards in the meantime.`) : null,
    h('a', { class: 'btn primary', href: '#/' }, 'Voir mon plan'));
}

async function viewPractice(kind, arg) {
  const root = app();
  root.innerHTML = '';
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: 'Révision' }));
  const box = h('div');
  add(root, box);
  let act;
  if (kind === 'tag') {
    const pool = reviewPool(arg);
    act = { id: 'practice:' + arg, type: 'quiz', skill: 'ecrire', title: 'Révision · ' + tagLabel(arg), instructions: 'Mixed questions on this point.', items: pool, draw: Math.min(8, pool.length) };
  } else {
    const v = Object.values(allVocab()).filter(x => !/[\/…]/.test(x.fr) && x.fr.length < 40 && (S.srs[x.id] || x.register === 'quebecois'));
    const pick = shuffle(v).slice(0, 5);
    act = { id: 'practice:dictation', type: 'quiz', skill: 'ecouter', title: 'Dictée', instructions: 'Type what you hear. Accents count.', items: pick.map((x, i) => ({ id: 'd' + i, kind: 'dictation', prompt: 'Écris :', audioText: x.fr, acceptedAnswers: [x.fr], strictAccents: true, tags: ['practice:dictation'] })) };
  }
  if (!act.items.length) { add(box, h('p', {}, 'Nothing to practise here yet.')); return; }
  const res = await runActivity(box, act, { mode: 'practice' });
  for (const it of res.items || []) for (const t of it.tags || []) { ema(S.mastery.tags, t, it.score); S.mastery.counts[t] = (S.mastery.counts[t] || 0) + 1; }
  save();
  box.innerHTML = '';
  add(box, h('div', { class: 'card' }, h('div', { class: 'score' }, pct(res.score) + ' %'), h('a', { class: 'btn primary', href: '#/' }, 'Accueil')));
}

function viewReview() {
  const root = app();
  root.innerHTML = '';
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: 'Révision' }), h('h1', {}, 'Révision'));
  const due = srsDue();
  const vmap = allVocab();
  const box = h('div');
  add(root, box);
  if (due.length) {
    const cap = DATA.rules.spacedRepetition.dailyCap;
    const act = { id: 'srs', type: 'flashcards', skill: 'vocabulaire', title: `Cartes à revoir (${Math.min(due.length, cap)})`, instructions: 'Cards you know move to longer gaps; cards you miss come back tomorrow.', vocabIds: due.filter(id => vmap[id]).slice(0, cap) };
    runActivity(box, act, { mode: 'review', vocab: vmap }).then(() => viewReview());
  } else {
    const upcoming = Object.values(S.srs).map(v => new Date(v.due)).sort((a, b) => a - b)[0];
    add(box, h('div', { class: 'card' }, h('p', {}, 'No cards due right now. 🎉'), upcoming ? h('p', { class: 'small muted' }, 'Next card due ' + upcoming.toLocaleDateString('fr-CA')) : h('p', { class: 'small muted' }, 'Cards are added when you do flashcard activities.')));
  }
  const wt = weakTags();
  add(root, h('div', { class: 'card' }, h('h2', {}, 'Practice'),
    h('ul', { class: 'list' },
      h('li', {}, h('a', { href: '#/practice/dictation' }, '🎧 Dictée (5 words)', h('span', {}))),
      wt.map(t => h('li', {}, h('a', { href: `#/practice/tag/${encodeURIComponent(t)}` }, '🔁 ' + tagLabel(t), h('span', { class: 'badge warn' }, 'faible')))))));
}

function viewSettings() {
  const root = app();
  root.innerHTML = '';
  const vs = frVoices();
  const file = h('input', { type: 'file', accept: 'application/json' });
  const msg = h('p', { class: 'small' });
  file.addEventListener('change', async () => {
    try {
      const s = JSON.parse(await file.files[0].text());
      if (s.version !== 1) throw new Error('wrong file');
      S = Object.assign(defaultState(), s); save(); msg.textContent = '✓ Progress imported.';
    } catch (e) { msg.textContent = "That file isn't a progress export."; }
  });
  let armed = false;
  const reset = h('button', { class: 'btn' }, 'Reset all progress');
  reset.addEventListener('click', () => {
    if (!armed) { armed = true; reset.textContent = 'Click again to erase everything'; reset.classList.add('rec'); return; }
    S = defaultState(); save(); location.hash = '#/';
  });
  add(root, crumbs({ label: 'Accueil', href: '#/' }, { label: 'Réglages' }), h('h1', {}, 'Réglages'),
    h('div', { class: 'card' },
      h('h2', {}, 'Voix et micro'),
      h('p', {}, vs.length ? `French voices found: ${vs.map(v => v.name + ' (' + v.lang + ')').join(', ')}` : 'No French voice found yet. On a phone, add a French (Canada) voice in your system settings.'),
      h('p', {}, SR ? '✓ Speech recognition available.' : '✗ Speech recognition not available here. Speaking activities fall back to self-check.'),
      playButton('Tester la voix', () => speak('Allô! Comment ça va? Chu content de pratiquer avec toi!'))),
    h('div', { class: 'card' },
      h('h2', {}, 'Ta progression'),
      h('p', { class: 'small muted' }, cloud.ref ? 'Progress is saved to your claude.ai account, so it follows you to any device where you open this link signed in. Export makes an extra backup file.' : 'Progress is saved in this browser only. Export it to back it up or move it to another device.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn', onclick: () => {
            const json = JSON.stringify(S, null, 2);
            cap('downloads').then(dl => {
              if (dl) {
                dl.save({ filename: 'quebec-french-progress.json', data: json }).catch(e => {
                  if (e.code !== 'declined') msg.textContent = "Couldn't save the file here.";
                });
                return;
              }
              const a = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: 'quebec-french-progress.json' });
              add(document.body, a); a.click(); a.remove();
            });
          }
        }, 'Export'),
        h('label', { class: 'btn' }, 'Import', h('span', { hidden: true }, file)),
        h('a', { class: 'btn', href: '#/placement' }, 'Retake placement'),
        reset), msg));
}

/* ---------- Router ---------- */

function route() {
  try { speechSynthesis.cancel(); } catch (e) { /* no speech */ }
  if (activeRecording) activeRecording.stop();
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(qs || '');
  const [a, b, c] = parts;
  if (!a) return viewHome();
  if (a === 'placement') return viewPlacement();
  if (a === 'level') return viewLevel(b);
  if (a === 'lesson') return viewLesson(b, c);
  if (a === 'a') return viewActivity(b, q);
  if (a === 'gate') return viewGate(b, q);
  if (a === 'review') return viewReview();
  if (a === 'practice') return viewPractice(b, c);
  if (a === 'settings') return viewSettings();
  viewHome();
}

loadData().then(() => {
  window.addEventListener('hashchange', route);
  route();
  cloudInit(route);
}).catch(e => {
  app().innerHTML = '';
  add(app(), h('div', { class: 'notice' }, "Couldn't load the course files: " + e.message));
});
