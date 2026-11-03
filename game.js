'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 카트 레이스: 화면·입력·소리. 규칙은 logic.js (LOGIC_KART).
const L = LOGIC_KART;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640, CY = H * 0.57;
const canvas = $('game'), ctx = canvas.getContext('2d');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null, engine = null;
let muted = store.get('kartraceMuted') === '1';
function ac() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); return audio; } catch (_) { return null; } }
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  try {
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function engineSound(speed, on) {                              // 달리는 소리: 속도에 따라 높아지는 낮은 톱니파
  const a = audio;
  if (!on || muted || !a) { if (engine) { try { engine.g.gain.setTargetAtTime(0, a.currentTime, 0.05); } catch (_) {} } return; }
  try {
    if (!engine) { const o = a.createOscillator(), g = a.createGain(); o.type = 'sawtooth'; g.gain.value = 0; o.connect(g).connect(a.destination); o.start(); engine = { o, g }; }
    engine.o.frequency.setTargetAtTime(48 + speed * 0.35, a.currentTime, 0.05);
    engine.g.gain.setTargetAtTime(0.012, a.currentTime, 0.1);
  } catch (_) {}
}
const sfx = {
  beep: (go) => tone(go ? 880 : 520, go ? 0.5 : 0.18, 'square', 0.05),
  pickup: () => { tone(660, 0.08, 'triangle', 0.06); setTimeout(() => tone(990, 0.1, 'triangle', 0.06), 70); },
  boost: (lv) => tone(300, 0.35 + lv * 0.08, 'sawtooth', 0.05, 700),
  driftlv: (lv) => tone(500 + lv * 200, 0.07, 'square', 0.035),
  hit: () => { tone(220, 0.35, 'sawtooth', 0.07, -160); },
  bump: () => tone(110, 0.08, 'square', 0.05, -40),
  banana: () => tone(380, 0.12, 'sine', 0.05, -120),
  rocket: () => tone(240, 0.3, 'sawtooth', 0.05, 500),
  shield: () => { tone(700, 0.1, 'triangle', 0.05); setTimeout(() => tone(1000, 0.15, 'triangle', 0.05), 80); },
  block: () => tone(1200, 0.12, 'square', 0.04, -600),
  lap: () => { tone(784, 0.1, 'triangle', 0.06); setTimeout(() => tone(1047, 0.18, 'triangle', 0.06), 100); },
  finish: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.06), i * 110)),
};

// ---------- 상태 ----------
let G = L.newGame(L.rng(1), { level: 'normal', rivals: 3 });
let state = 'title';                    // title · play · paused · over
let level = 'normal', tut = false, trackSel = 0;
let wins = Number(store.get('kartraceWins')) || 0;
let cam = { x: 0, y: 0, ang: 0, z: 1 }, parts = [], floats = [], clock = 0, shake = 0, resultShown = false, lastCount = 4, steerSig = 0, wrongWay = 0;
const held = { left: false, right: false, drift: false, brake: false, kLeft: false, kRight: false, kDrift: false };
let itemPress = false, tutBoxes = false;
const ART = {};                         // 코스 그림 (한 번 그려 두고 쓴다)

/* @test-hooks:start */
window.__kt = { get G() { return G; }, get state() { return state; }, L, step: (dt) => update(dt), held, press: () => { itemPress = true; } };
/* @test-hooks:end */

// ---------- 흐름 ----------
function showOverlay(html) {
  const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden');
  o.querySelectorAll('button[data-level]').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level); });
  o.querySelectorAll('button[data-track]').forEach((b) => { b.onclick = () => { trackSel = Number(b.dataset.track); store.set('kartraceTrack', String(trackSel)); showTitle(); }; });
  o.querySelectorAll('button[data-resume]').forEach((b) => { b.onclick = resume; });
}
function hideOverlay() { $('overlay').classList.add('hidden'); }
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>컴퓨터 5 · 느림</small></button><button data-level="normal">보통<small>컴퓨터 7 · 기록</small></button></div>`;
const trackButtons = () => `<div class="trk">${L.TRACKS.map((t, i) => `<button data-track="${i}" class="${i === trackSel ? 'on' : ''}">${t.name}</button>`).join('')}</div>`;
function onOverlayButton(lv) { start(lv); }
function showTitle() {
  state = 'title'; $('ctls').classList.add('hidden');
  showOverlay(`<h1>카트 레이스</h1><p>위에서 내려다본 서킷을 <b>3바퀴</b> 달려<br>컴퓨터 카트들과 1등을 겨뤄요!</p>
    <p class="help">커브에서 <b>드리프트</b>를 모았다가 놓으면 <b>부스터</b>!<br>아이템 상자로 부스터·바나나·로켓·방어막을 얻어요.</p>
    ${wins ? `<div class="big">보통 1등 ${wins}번</div>` : ''}<p class="note">코스</p>${trackButtons()}${lvButtons()}
    <p class="note"><span class="pc">←→ 핸들 · Space 드리프트 · X 아이템 · ↓ 브레이크</span><span class="touch">◀ ▶ 핸들 · 드리프트 · 아이템 버튼</span></p>`);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) { lv = 'easy'; trackSel = 0; }
  level = lv === 'normal' ? 'normal' : 'easy';
  const opts = tut ? { level, track: 0, rivals: 0, laps: 99, forceItem: 'booster' } : { level, track: trackSel };
  G = L.newGame(Math.random, opts);
  prepareArt(G.track.index);
  const me = G.karts[0];
  cam = { x: me.x, y: me.y, ang: me.ang, z: 1.1 };
  parts = []; floats = []; shake = 0; resultShown = false; lastCount = 4; steerSig = 0; wrongWay = 0; itemPress = false; tutBoxes = false;
  Object.keys(held).forEach((k) => { held[k] = false; });
  if (tut) G.boxes.forEach((b) => { b.t = 1e9; });                // 연습에서는 드리프트 부스터를 해 본 뒤에 상자가 나타남
  state = 'play'; hideOverlay(); $('ctls').classList.remove('hidden');
}
function finishRace() {
  state = 'over'; $('ctls').classList.add('hidden');
  const rank = L.rankOf(G, 0), me = G.karts[0];
  if (!tut && window.arcadeRun) arcadeRun({ level, bad: rank >= 4 });            // 연패 구제(로비): 4등 이하면 나쁜 판
  if (level === 'normal' && !tut && rank === 1) { wins++; store.set('kartraceWins', String(wins)); }
  setTimeout(() => {
    if (state !== 'over') return;
    const rows = L.rankOrder(G).map((k, i) => `<div class="row${k.id === 0 ? ' me' : ''}"><span>${i + 1}</span><span>${k.name}</span><span>${k.finished ? fmt(k.finishT) : '완주 못 함'}</span></div>`).join('');
    showOverlay(`<h2>${rank === 1 ? '🏆 1등!' : `${rank}등`}</h2><div class="rank">${rows}</div>
      <p>${level === 'normal' ? `보통 1등 ${wins}번` : '쉬움에서는 기록이 저장되지 않아요'} · 드리프트 ${me.drifts}번 · 맞은 횟수 ${me.hits}번</p>${trackButtons()}${lvButtons()}`);
  }, 900);
}
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function pause() { if (state !== 'play') return; state = 'paused'; engineSound(0, false); showOverlay(`<h2>일시정지</h2><button data-resume="1">계속하기</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }
function toggleMute() { muted = !muted; store.set('kartraceMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; if (muted) engineSound(0, false); }

// ---------- 입력 ----------
function bindHold(id, key) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); held[key] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = () => { held[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
bindHold('btnL', 'left'); bindHold('btnR', 'right'); bindHold('btnDrift', 'drift');
$('btnItem').addEventListener('pointerdown', (e) => { e.preventDefault(); itemPress = true; $('btnItem').classList.add('on'); });
['pointerup', 'pointercancel'].forEach((t) => $('btnItem').addEventListener(t, () => $('btnItem').classList.remove('on')));
addEventListener('keydown', (e) => {
  const c = e.code;
  if (c === 'KeyP') { if (!e.repeat) state === 'paused' ? resume() : pause(); return; }
  if (c === 'KeyM') { if (!e.repeat) toggleMute(); return; }
  let used = true;
  if (c === 'ArrowLeft' || c === 'KeyA') held.kLeft = true;
  else if (c === 'ArrowRight' || c === 'KeyD') held.kRight = true;
  else if (c === 'ArrowDown' || c === 'KeyS') held.brake = true;
  else if (c === 'Space' || c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyZ') held.kDrift = true;
  else if (c === 'KeyX' || c === 'ArrowUp' || c === 'KeyW' || c === 'Enter') { if (!e.repeat) itemPress = true; }
  else used = false;
  if (used && state === 'play') e.preventDefault();
});
addEventListener('keyup', (e) => {
  const c = e.code;
  if (c === 'ArrowLeft' || c === 'KeyA') held.kLeft = false;
  else if (c === 'ArrowRight' || c === 'KeyD') held.kRight = false;
  else if (c === 'ArrowDown' || c === 'KeyS') held.brake = false;
  else if (c === 'Space' || c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyZ') held.kDrift = false;
});
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', () => { Object.keys(held).forEach((k) => { held[k] = false; }); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').textContent = muted ? '🔇' : '🔊';
trackSel = Math.min(L.TRACKS.length - 1, Number(store.get('kartraceTrack')) || 0);

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  const me = G.karts[0];
  if (state === 'play') {
    const steer = ((held.right || held.kRight) ? 1 : 0) - ((held.left || held.kLeft) ? 1 : 0);
    me.inp.steer = me.auto ? me.inp.steer : steer;
    if (!me.auto) { me.inp.drift = held.drift || held.kDrift; me.inp.brake = held.brake; }
    if (itemPress) { itemPress = false; L.useItem(G, me); }
    if (steer !== 0 && G.phase !== 'count' && L.speedOf(me) > 40) { steerSig += dt; if (steerSig > 0.25) { steerSig = 0; tutorialSignal('steer'); } }
    L.step(G, dt);
    for (const ev of G.events) onEvent(ev);
    G.events.length = 0;
    if (G.phase === 'count') { const c = Math.ceil(G.countT); if (c !== lastCount && c > 0) { lastCount = c; sfx.beep(false); } }
    // 거꾸로 달리는지
    const tr = G.track, f = L.fwdOf(me), tdir = Math.cos(me.ang - tr.ang[me.i]);
    wrongWay = G.phase === 'race' && !me.finished && tdir < -0.3 && L.speedOf(me) > 30 ? Math.min(1, wrongWay + dt * 2) : Math.max(0, wrongWay - dt * 3);
    void f;
    engineSound(L.speedOf(me), true);
    emitParticles(dt);
    if (G.over && !resultShown) { resultShown = true; engineSound(0, false); finishRace(); }
  }
  // 카메라: 내 카트 앞쪽을 보고, 방향은 부드럽게 따라옴
  const spd = L.speedOf(me), ahead = 60 + spd * 0.15;
  const tx = me.x + Math.cos(me.ang) * ahead, ty = me.y + Math.sin(me.ang) * ahead;
  const k = Math.min(1, dt * 7);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  const want = me.ang - (me.drift ? me.drift.dir * 0.22 : 0);
  cam.ang += L.angDiff(want, cam.ang) * Math.min(1, dt * 5.5);
  const zt = 1.2 - Math.min(0.22, spd / 240 * 0.2) - (me.boostT > 0 ? 0.1 : 0);
  cam.z += (zt - cam.z) * Math.min(1, dt * 3);
  for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  parts = parts.filter((p) => p.t < p.life);
  for (const f of floats) f.t += dt; floats = floats.filter((f) => f.t < 1.1);
  shake = Math.max(0, shake - dt);
}
const DCOL = ['#ffffff', '#5ad2ff', '#ff9a2e', '#d46bff'];
function emitParticles(dt) {
  for (const k of G.karts) {
    if (!k.drift && k.boostT <= 0) continue;
    const back = [Math.cos(k.ang + Math.PI), Math.sin(k.ang + Math.PI)], side = [-Math.sin(k.ang), Math.cos(k.ang)];
    for (const s of [-1, 1]) {
      if (Math.random() > dt * 70) continue;
      const lvl = k.drift ? k.drift.level : 0;
      parts.push({ x: k.x + back[0] * 9 + side[0] * s * 5, y: k.y + back[1] * 9 + side[1] * s * 5, vx: back[0] * 60 + (Math.random() - 0.5) * 80 + k.vx * 0.2, vy: back[1] * 60 + (Math.random() - 0.5) * 80 + k.vy * 0.2, t: 0, life: 0.35, color: k.drift ? DCOL[lvl] : '#ffb347', r: 2.2 });
    }
  }
}
function onEvent(ev) {
  const me = G.karts[0];
  if (ev.type === 'go') sfx.beep(true);
  else if (ev.type === 'driftstart' && ev.kart === 0) tutorialSignal('drift');
  else if (ev.type === 'driftlevel' && ev.kart === 0) sfx.driftlv(ev.level);
  else if (ev.type === 'boost' && ev.kart === 0) { sfx.boost(ev.level); shake = 0.25; tutorialSignal('boost'); if (ev.by === 'drift') { tutorialSignal('driftboost'); if (tut && !tutBoxes) { tutBoxes = true; showTutorialBoxes(); } } }
  else if (ev.type === 'pickup' && ev.kart === 0) { sfx.pickup(); tutorialSignal('itembox'); }
  else if (ev.type === 'useitem') {
    if (ev.kart === 0) { tutorialSignal('useitem'); ({ banana: sfx.banana, rocket: sfx.rocket, shield: sfx.shield }[ev.item] || (() => {}))(); }
    else if (ev.item === 'rocket' && near(ev.kart)) sfx.rocket();
  } else if (ev.type === 'hit') {
    const k = G.karts[ev.kart];
    floats.push({ x: k.x, y: k.y, t: 0, text: ev.kind === 'rocket' ? '쾅!' : '미끌!', color: '#ff7a7a' });
    if (ev.kart === 0) { sfx.hit(); shake = 0.4; tutorialSignal('hit'); }
  } else if (ev.type === 'block') { if (ev.kart === 0) sfx.block(); floats.push({ x: G.karts[ev.kart].x, y: G.karts[ev.kart].y, t: 0, text: '막았다!', color: '#9ae6ff' }); }
  else if (ev.type === 'boom') { for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, v = 60 + Math.random() * 120; parts.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.5, color: i % 2 ? '#ffb347' : '#ff5a3a', r: 3 }); } }
  else if (ev.type === 'wall' && ev.kart === 0) { sfx.bump(); shake = Math.max(shake, 0.12); }
  else if (ev.type === 'bump') sfx.bump();
  else if (ev.type === 'lap' && ev.kart === 0) { sfx.lap(); floats.push({ x: me.x, y: me.y, t: 0, text: ev.lap + 1 >= G.laps ? '마지막 바퀴!' : `${ev.lap + 1}바퀴째`, color: '#fff6a8' }); }
  else if (ev.type === 'finish' && ev.kart === 0) sfx.finish();
}
function showTutorialBoxes() {                                     // 내 앞쪽 길 위에 상자 한 줄을 놓는다
  const me = G.karts[0], tr = G.track, i = L.nextIdx(tr, me.i, 300), a = tr.ang[i];
  G.boxes.slice(0, 3).forEach((b, q) => { const lat = (q - 1) * tr.width * 0.28; b.x = tr.x[i] - Math.sin(a) * lat; b.y = tr.y[i] + Math.cos(a) * lat; b.t = 0; });
  G.boxes.slice(3).forEach((b) => { if (b.t > 1e8) b.t = 1e9; });
}
function near(id) { const k = G.karts[id], me = G.karts[0]; return Math.hypot(k.x - me.x, k.y - me.y) < 500; }

// ---------- 코스 그림 ----------
const ART_SCALE = 0.8;
function prepareArt(ti) {
  if (ART[ti]) return;
  const tr = G.track;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < tr.n; i++) { x0 = Math.min(x0, tr.x[i]); y0 = Math.min(y0, tr.y[i]); x1 = Math.max(x1, tr.x[i]); y1 = Math.max(y1, tr.y[i]); }
  const pad = tr.width / 2 + L.P.wall + 360;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const off = document.createElement('canvas'); off.width = Math.ceil((x1 - x0) * ART_SCALE); off.height = Math.ceil((y1 - y0) * ART_SCALE);
  const c = off.getContext('2d');
  c.scale(ART_SCALE, ART_SCALE); c.translate(-x0, -y0);
  const rnd = L.rng(100 + ti);
  c.fillStyle = '#3d8c3c'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (let i = 0; i < 700; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(30,110,40,.22)' : 'rgba(120,190,80,.16)'; c.beginPath(); c.arc(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 20 + rnd() * 60, 0, 7); c.fill(); }
  const path = new Path2D();
  for (let i = 0; i < tr.n; i++) i ? path.lineTo(tr.x[i], tr.y[i]) : path.moveTo(tr.x[i], tr.y[i]);
  path.closePath();
  c.lineJoin = 'round'; c.lineCap = 'butt';
  c.strokeStyle = '#2f7a33'; c.lineWidth = tr.width + L.P.wall * 2 + 10; c.stroke(path);                        // 길 둘레 수풀 띠
  c.strokeStyle = '#fff'; c.lineWidth = tr.width + 18; c.stroke(path);                                        // 연석
  c.strokeStyle = '#e23a3a'; c.lineWidth = tr.width + 18; c.setLineDash([30, 30]); c.stroke(path); c.setLineDash([]);
  c.strokeStyle = '#555a66'; c.lineWidth = tr.width; c.stroke(path);                                          // 아스팔트
  c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 3; c.setLineDash([18, 26]); c.stroke(path); c.setLineDash([]);
  // 출발선
  { const a = tr.ang[0], nx = -Math.sin(a), ny = Math.cos(a), step = 12; c.save(); c.translate(tr.x[0], tr.y[0]); c.rotate(a);
    for (let r = 0; r < 2; r++) for (let q = 0; q * step < tr.width; q++) { c.fillStyle = (q + r) % 2 ? '#111' : '#fff'; c.fillRect(-12 + r * 12, -tr.width / 2 + q * step, 12, step); } c.restore(); void nx; void ny; }
  // 바깥 수풀 가장자리와 나무
  const edge = tr.width / 2 + L.P.wall;
  for (let i = 0; i < tr.n; i += 2) for (const s of [-1, 1]) {
    const a = tr.ang[i], px = tr.x[i] - Math.sin(a) * s * (edge + 6), py = tr.y[i] + Math.cos(a) * s * (edge + 6), r = 12 + rnd() * 8;
    c.fillStyle = '#1f6a2a'; c.beginPath(); c.arc(px, py, r, 0, 7); c.fill(); c.fillStyle = '#2f8a3a'; c.beginPath(); c.arc(px - 2, py - 3, r * 0.65, 0, 7); c.fill();
  }
  let trees = 0;
  for (let tries = 0; tries < 900 && trees < 220; tries++) {
    const i = Math.floor(rnd() * tr.n), s = rnd() < 0.5 ? -1 : 1, a = tr.ang[i], lat = s * (edge + 30 + rnd() * 320);
    const px = tr.x[i] - Math.sin(a) * lat, py = tr.y[i] + Math.cos(a) * lat;
    let ok = true; for (let j = 0; j < tr.n; j += 3) if (Math.hypot(tr.x[j] - px, tr.y[j] - py) < edge + 24) { ok = false; break; }
    if (!ok) continue;
    const r = 16 + rnd() * 16;
    c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.arc(px + 4, py + 5, r, 0, 7); c.fill();
    c.fillStyle = rnd() < 0.3 ? '#c9742a' : '#1f6a2a'; c.beginPath(); c.arc(px, py, r, 0, 7); c.fill();
    c.fillStyle = rnd() < 0.3 ? '#e39a4a' : '#35913f'; c.beginPath(); c.arc(px - r * 0.2, py - r * 0.25, r * 0.62, 0, 7); c.fill();
    trees++;
  }
  // 미니맵용 선
  const mm = { path: new Path2D(), x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
  for (let i = 0; i < tr.n; i++) { mm.x0 = Math.min(mm.x0, tr.x[i]); mm.y0 = Math.min(mm.y0, tr.y[i]); mm.x1 = Math.max(mm.x1, tr.x[i]); mm.y1 = Math.max(mm.y1, tr.y[i]); }
  ART[ti] = { off, x0, y0, w: x1 - x0, h: y1 - y0, mm };
}

// ---------- 그리기 ----------
const rot = () => -cam.ang - Math.PI / 2;
function toScreen(x, y) { const r = rot(), dx = x - cam.x, dy = y - cam.y; return [W / 2 + cam.z * (dx * Math.cos(r) - dy * Math.sin(r)), CY + cam.z * (dx * Math.sin(r) + dy * Math.cos(r))]; }
const ICON = { booster: '⚡', banana: '🍌', rocket: '🚀', shield: '🛡️' };
const ITEM_NAME = { booster: '부스터', banana: '바나나', rocket: '로켓', shield: '방어막' };

function drawKart(k) {
  ctx.save(); ctx.translate(k.x, k.y); ctx.rotate(k.ang + k.spin);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(-9, -5.5, 20, 14);
  if (k.boostT > 0) { ctx.fillStyle = Math.floor(clock * 30) % 2 ? '#ffd23a' : '#ff7a2e'; ctx.beginPath(); ctx.moveTo(-9, -3.5); ctx.lineTo(-9 - 14 - Math.random() * 6, 0); ctx.lineTo(-9, 3.5); ctx.fill(); }
  ctx.fillStyle = '#222'; for (const sx of [-6, 6]) for (const sy of [-7.5, 5.5]) ctx.fillRect(sx - 3, sy, 6, 2.5);
  ctx.fillStyle = k.color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-10, -6, 20, 12, 3) : ctx.rect(-10, -6, 20, 12); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-2, -5, 8, 4);
  ctx.fillStyle = '#1b1f2e'; ctx.beginPath(); ctx.arc(-1, 0, 3.6, 0, 7); ctx.fill();         // 운전자 머리(헬멧)
  ctx.fillStyle = k.id === 0 ? '#fff' : '#ddd'; ctx.beginPath(); ctx.arc(-1, 0, 2.6, 0, 7); ctx.fill();
  ctx.fillStyle = '#111'; ctx.fillRect(6, -4, 2.5, 8);
  if (k.shield > 0) { ctx.strokeStyle = `rgba(120,220,255,${0.5 + 0.3 * Math.sin(clock * 10)})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke(); ctx.fillStyle = 'rgba(120,220,255,.12)'; ctx.fill(); }
  ctx.restore();
}
function draw() {
  const me = G.karts[0], art = ART[G.track.index];
  ctx.fillStyle = '#2f7a33'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * shake, (Math.random() - 0.5) * 8 * shake);
  ctx.translate(W / 2, CY); ctx.rotate(rot()); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
  if (art) ctx.drawImage(art.off, art.x0, art.y0, art.w, art.h);
  // 아이템 상자
  for (const b of G.boxes) {
    if (b.t > 0) continue;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(clock * 1.6);
    const g = ctx.createLinearGradient(-9, -9, 9, 9); g.addColorStop(0, '#9be7ff'); g.addColorStop(1, '#5a8cff');
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-8, -7, 18, 18);
    ctx.fillStyle = g; ctx.fillRect(-9, -9, 18, 18); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(-9, -9, 18, 18);
    ctx.rotate(-clock * 1.6 - rot()); ctx.fillStyle = '#fff'; ctx.font = '900 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', 0, 5);
    ctx.restore();
  }
  for (const b of G.bananas) { ctx.save(); ctx.translate(b.x, b.y); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(2, 3, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(0, 0, 7, 0.4, 5.9); ctx.lineTo(0, 0); ctx.fill(); ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); }
  for (const r of G.rockets) { ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(Math.atan2(r.vy, r.vx)); ctx.fillStyle = '#ff9a2e'; ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-18 - Math.random() * 6, 0); ctx.lineTo(-8, 3); ctx.fill(); ctx.fillStyle = '#e8e8ee'; ctx.fillRect(-9, -3.5, 16, 7); ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(7, -3.5); ctx.lineTo(13, 0); ctx.lineTo(7, 3.5); ctx.fill(); ctx.restore(); }
  for (const p of parts) { ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  const order = G.karts.slice().sort((a, b) => (a.id === 0) - (b.id === 0));
  for (const k of order) drawKart(k);
  ctx.restore();
  // 화면 위 글자(카트 이름 · 앞뒤 카트 표시)
  ctx.textAlign = 'center'; ctx.font = '800 11px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)';
  for (const k of G.karts) {
    if (k.id === 0) continue;
    const [sx, sy] = toScreen(k.x, k.y);
    if (sx < -20 || sx > W + 20 || sy < 30 || sy > H) continue;
    ctx.fillStyle = k.color; ctx.strokeText(k.name, sx, sy - 18 * cam.z); ctx.fillText(k.name, sx, sy - 18 * cam.z);
  }
  for (const f of floats) { const [sx, sy] = toScreen(f.x, f.y), k = f.t / 1.1; ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.font = '900 16px sans-serif'; ctx.strokeText(f.text, sx, sy - 24 - k * 28); ctx.fillText(f.text, sx, sy - 24 - k * 28); ctx.globalAlpha = 1; }
  drawHud(me, art);
}
function drawHud(me, art) {
  ctx.textAlign = 'left';
  // 순위
  const rank = L.rankOf(G, 0);
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, W, 40);
  ctx.fillStyle = '#ffd23a'; ctx.font = '900 30px sans-serif'; ctx.fillText(`${rank}`, 10, 31);
  ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.fillText(`/ ${G.karts.length}`, 10 + ctx.measureText(`${rank}`).width * 0 + (rank >= 10 ? 36 : 22), 31);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif';
  const lapShow = tut ? '연습' : `LAP ${Math.max(1, Math.min(G.laps, me.lap + 1))}/${G.laps}`;
  ctx.fillText(lapShow, W / 2 - 4, 16); ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#ddd'; ctx.fillText(fmt(G.t), W / 2 - 4, 33);
  // 아이템 칸
  const ix = W - 58, iy = 46;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(ix, iy, 50, 50); ctx.strokeStyle = me.item ? '#ffd23a' : 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; ctx.strokeRect(ix, iy, 50, 50);
  if (me.item) { ctx.font = '28px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(ICON[me.item], ix + 25, iy + 33); ctx.font = '800 10px sans-serif'; ctx.fillText(ITEM_NAME[me.item], ix + 25, iy + 46); }
  else { ctx.font = '800 10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText('아이템', ix + 25, iy + 30); }
  // 미니맵
  if (art) {
    const mw = 78, mh = 62, mx = 8, my = 48, m = art.mm, tr = G.track;
    const sc = Math.min((mw - 8) / (m.x1 - m.x0), (mh - 8) / (m.y1 - m.y0)), ox = mx + 4 + ((mw - 8) - (m.x1 - m.x0) * sc) / 2, oy = my + 4 + ((mh - 8) - (m.y1 - m.y0) * sc) / 2;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i <= tr.n; i += 4) { const j = i % tr.n, px = ox + (tr.x[j] - m.x0) * sc, py = oy + (tr.y[j] - m.y0) * sc; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.stroke();
    for (const k of G.karts) { ctx.fillStyle = k.id === 0 ? '#fff' : k.color; ctx.beginPath(); ctx.arc(ox + (k.x - m.x0) * sc, oy + (k.y - m.y0) * sc, k.id === 0 ? 3.5 : 2.4, 0, 7); ctx.fill(); if (k.id === 0) { ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 1.5; ctx.stroke(); } }
  }
  // 속도
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.font = '900 20px sans-serif';
  const sp = `${Math.round(L.speedOf(me) * 0.6)}`; ctx.strokeText(sp, 12, H - 104); ctx.fillText(sp, 12, H - 104); ctx.font = '700 10px sans-serif'; ctx.fillText('km/h', 14 + ctx.measureText(sp).width * 2.2, H - 104);
  // 드리프트 게이지
  if (me.drift) {
    const d = me.drift, gx = W / 2 - 60, gy = H - 150, w = 120;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(gx - 2, gy - 2, w + 4, 12);
    const frac = Math.min(1, d.t / L.DRIFT_LEVELS[2]);
    ctx.fillStyle = DCOL[d.level]; ctx.fillRect(gx, gy, w * frac, 8);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; for (const t of L.DRIFT_LEVELS.slice(0, 2)) ctx.fillRect(gx + w * t / L.DRIFT_LEVELS[2] - 1, gy - 2, 2, 12);
    ctx.textAlign = 'center'; ctx.font = '800 11px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(d.level ? `놓으면 부스터 ${'★'.repeat(d.level)}` : '모으는 중…', W / 2, gy - 6);
  }
  // 카운트다운 · 안내
  ctx.textAlign = 'center';
  if (G.phase === 'count') {
    const c = Math.ceil(G.countT); ctx.font = '900 96px sans-serif'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = c <= 1 ? '#ffd23a' : '#fff';
    ctx.strokeText(String(Math.max(1, c)), W / 2, 250); ctx.fillText(String(Math.max(1, c)), W / 2, 250);
    ctx.font = '800 14px sans-serif'; ctx.lineWidth = 3; ctx.fillStyle = '#fff'; ctx.strokeText('자동으로 달려요! 신호를 기다리세요', W / 2, 290); ctx.fillText('자동으로 달려요! 신호를 기다리세요', W / 2, 290);
  } else if (G.t < 1.2) { ctx.font = '900 64px sans-serif'; ctx.fillStyle = '#7dff7d'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText('GO!', W / 2, 250); ctx.fillText('GO!', W / 2, 250); }
  if (wrongWay > 0.2) { ctx.globalAlpha = Math.min(1, wrongWay) * (0.6 + 0.4 * Math.sin(clock * 10)); ctx.font = '900 26px sans-serif'; ctx.fillStyle = '#ff5a5a'; ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.strokeText('거꾸로 달리고 있어요!', W / 2, 200); ctx.fillText('거꾸로 달리고 있어요!', W / 2, 200); ctx.globalAlpha = 1; }
  if (me.finished && state === 'play') { ctx.font = '900 34px sans-serif'; ctx.fillStyle = '#ffd23a'; ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText('결승선 통과!', W / 2, 250); ctx.fillText('결승선 통과!', W / 2, 250); }
}

let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
prepareArt(0);
showTitle();
requestAnimationFrame(frame);
