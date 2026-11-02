'use strict';
// 카트 레이스 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const race = (opts = {}) => L.newGame(L.rng(opts.seed || 3), Object.assign({ level: 'easy', rivals: 0, noCount: true }, opts));
const run = (st, sec, each) => { for (let i = 0; i < sec * 60; i++) { if (each) each(i); L.step(st, 1 / 60); } };
const clearEv = (st) => { const e = st.events.slice(); st.events.length = 0; return e; };

test('tracks: no overlapping road, no extremely sharp corner, closed loop', () => {
  L.TRACKS.forEach((d, ti) => {
    const t = L.buildTrack(ti);
    assert.ok(t.L > 3000 && t.L < 9000, d.name);
    let minSep = 1e9;
    for (let i = 0; i < t.n; i++) for (let j = i + 1; j < t.n; j++) {
      if (Math.min(j - i, t.n - (j - i)) * t.ds < 400) continue;
      minSep = Math.min(minSep, Math.hypot(t.x[i] - t.x[j], t.y[i] - t.y[j]));
    }
    assert.ok(minSep > t.width + 80, `${d.name} separation ${minSep}`);
    const closing = Math.hypot(t.x[0] - t.x[t.n - 1], t.y[0] - t.y[t.n - 1]);
    assert.ok(Math.abs(closing - t.ds) < 1.5, 'closed loop');
    let turn = 0; for (let i = 0; i < t.n; i++) turn += t.kap[i] * t.ds;
    assert.ok(Math.abs(Math.abs(turn) - Math.PI * 2) < 0.3, 'one full turn');
    const sharp = []; for (let i = 0; i < t.n; i++) if (1 / Math.abs(t.kap[i]) < 30) sharp.push(i);
    assert.strictEqual(sharp.length, 0, `${d.name} too sharp at ${sharp.slice(0, 3)}`);
  });
});

test('locate: points on the centerline have zero offset, sides have the right sign', () => {
  const t = L.buildTrack(0), i = 100, a = t.ang[i];
  const on = L.locate(t, t.x[i], t.y[i]);
  assert.ok(on.i === i && Math.abs(on.lat) < 1e-6);
  const right = L.locate(t, t.x[i] - Math.sin(a) * 30, t.y[i] + Math.cos(a) * 30);
  assert.ok(right.lat > 25 && right.lat < 35);
  const left = L.locate(t, t.x[i] + Math.sin(a) * 30, t.y[i] - Math.cos(a) * 30, i);
  assert.ok(left.lat < -25);
});

test('new game: karts behind the start line, grid in rows, me is kart 0, countdown', () => {
  const st = L.newGame(L.rng(5), { level: 'normal' });
  assert.strictEqual(st.karts.length, 1 + L.LEVELS.normal.rivals);
  assert.strictEqual(st.karts[0].name, '나');
  assert.ok(st.karts.every((k) => k.lap === -1 && k.prog < 0 && k.prog > -400));
  assert.strictEqual(st.phase, 'count');
  const before = st.karts.map((k) => [k.x, k.y]);
  run(st, 1);
  assert.deepStrictEqual(st.karts.map((k) => [k.x, k.y]), before, 'nobody moves during the countdown');
  run(st, 3);
  assert.strictEqual(st.phase, 'race');
  assert.ok(clearEv(st).some((e) => e.type === 'go'));
});

test('accelerates up to about the top speed on a straight', () => {
  const st = race({ track: 0 }); const k = st.karts[0]; k.mul = 1; k.inp.steer = 0;
  run(st, 2.5, () => { k.inp.steer = Math.max(-1, Math.min(1, L.angDiff(L.buildTrack(0).ang[k.i], k.ang) * 2)); });
  assert.ok(L.speedOf(k) > L.P.maxV * 0.85, 'speed ' + L.speedOf(k));
  assert.ok(L.speedOf(k) <= L.P.maxV * 1.02);
});

test('steering turns the kart; cannot turn while standing still', () => {
  const st = race({ track: 0 }); const k = st.karts[0];
  k.inp.steer = 1; const a0 = k.ang; L.step(st, 1 / 60);
  assert.ok(Math.abs(L.angDiff(k.ang, a0)) < 0.01, 'standing still');
  run(st, 1.5, () => { k.inp.steer = 0; }); const a1 = k.ang;
  run(st, 0.5, () => { k.inp.steer = 1; });
  assert.ok(L.angDiff(k.ang, a1) > 0.5);
});

test('driftstart needs speed and steering, charges levels, releasing gives a boost', () => {
  const st = race({ track: 0 }); const k = st.karts[0]; k.mul = 1;
  k.inp.drift = true; k.inp.steer = 1; L.step(st, 1 / 60);
  assert.strictEqual(k.drift, null, 'too slow to drift');
  // 속도를 낸 뒤 (코스를 따라 달리게 해 벽을 피함)
  const tr = L.buildTrack(0);
  const keep = () => { k.inp.steer = Math.max(-1, Math.min(1, L.angDiff(Math.atan2(tr.y[L.nextIdx(tr, k.i, 80)] - k.y, tr.x[L.nextIdx(tr, k.i, 80)] - k.x), k.ang) * 2.5)); k.inp.drift = false; };
  run(st, 2.5, keep); clearEv(st);
  k.inp.steer = 0; k.inp.drift = true; L.step(st, 1 / 60);
  assert.strictEqual(k.drift, null, 'no steering, no drift');
  k.inp.steer = 1; L.step(st, 1 / 60);
  assert.ok(k.drift && k.drift.dir === 1);
  // 모으기: 시간이 지나면 단계가 오른다 (코스에서 벗어나도 시험은 규칙만 본다)
  k.drift.t = 0; k.boostT = 0;
  for (let i = 0; i < 90 && k.drift; i++) { k.vx = Math.cos(k.ang) * 200; k.vy = Math.sin(k.ang) * 200; k.x = tr.x[k.i]; k.y = tr.y[k.i]; L.step(st, 1 / 60); }
  assert.ok(k.drift && k.drift.level >= 1, 'level after 1.5s: ' + (k.drift && k.drift.level));
  const lv = k.drift.level; k.inp.drift = false; L.step(st, 1 / 60);
  assert.strictEqual(k.drift, null);
  assert.ok(k.boostT > 0.5);
  const ev = clearEv(st);
  assert.ok(ev.some((e) => e.type === 'boost' && e.by === 'drift' && e.level === lv));
});

test('boost makes the kart faster than the normal top speed', () => {
  const st = race({ track: 0 }); const k = st.karts[0]; k.mul = 1;
  const tr = L.buildTrack(0);
  const keep = () => { const t = L.nextIdx(tr, k.i, 90); k.inp.steer = Math.max(-1, Math.min(1, L.angDiff(Math.atan2(tr.y[t] - k.y, tr.x[t] - k.x), k.ang) * 2.5)); };
  run(st, 3, keep); const v0 = L.speedOf(k);
  k.item = 'booster'; assert.ok(L.useItem(st, k));
  let vmax = 0; run(st, 1.2, () => { keep(); vmax = Math.max(vmax, L.speedOf(k)); });
  assert.ok(vmax > L.P.maxV * 1.1, `${vmax} vs ${v0}`);
});

test('grass slows the kart down; the outer wall stops it from leaving', () => {
  const st = race({ track: 0 }); const k = st.karts[0]; const tr = L.buildTrack(0);
  const i = 150, a = tr.ang[i];
  k.i = i; k.x = tr.x[i] - Math.sin(a) * (tr.width / 2 + 25); k.y = tr.y[i] + Math.cos(a) * (tr.width / 2 + 25); k.ang = a; k.mul = 1;
  let fastest = 0, frames = 0;
  run(st, 1.6, () => { k.inp.steer = 0; const l = L.locate(tr, k.x, k.y, k.i); if (Math.abs(l.lat) > tr.width / 2 + 8) { fastest = Math.max(fastest, L.speedOf(k)); frames++; } });
  assert.ok(frames > 30, 'stayed on the grass for a while');
  assert.ok(fastest < L.P.maxV * 0.6, 'on grass ' + fastest);
  // 벽 쪽으로 계속 달려도 길 밖으로 나가지 못함
  k.ang = a + Math.PI / 2; k.vx = k.vy = 0;
  run(st, 6, () => { k.inp.steer = 0; });
  const l = L.locate(tr, k.x, k.y);
  assert.ok(Math.abs(l.lat) <= tr.width / 2 + L.P.wall + 1, 'lat ' + l.lat);
});

test('laps are counted when crossing the line forward, not backward; finish after 3', () => {
  const st = race({ track: 0, laps: 3 }); const k = st.karts[0]; const tr = L.buildTrack(0);
  assert.strictEqual(k.lap, -1);
  const put = (i) => { L.placeKart(tr, k, i, 0); const lap = k.lap; k.lap = lap; };
  const cross = (from, to) => { L.placeKart(tr, k, from, 0); k.lap = k.lap; k.x = tr.x[to]; k.y = tr.y[to]; L.step(st, 1 / 600); };
  // 한 바퀴 돌았다고 가정하고 선을 넘는다
  L.placeKart(tr, k, tr.n - 3, 0); k.lap = -1;
  k.x = tr.x[2]; k.y = tr.y[2]; L.step(st, 1 / 600);
  assert.strictEqual(k.lap, 0);
  // 뒤로 넘으면 줄어든다
  k.x = tr.x[tr.n - 2]; k.y = tr.y[tr.n - 2]; L.step(st, 1 / 600);
  assert.strictEqual(k.lap, -1);
  void put; void cross;
  for (let lap = 0; lap < 4; lap++) {
    k.x = tr.x[tr.n - 3]; k.y = tr.y[tr.n - 3]; k.i = tr.n - 3; L.step(st, 1 / 600);
    k.x = tr.x[2]; k.y = tr.y[2]; L.step(st, 1 / 600);
  }
  assert.ok(k.lap >= 3 || k.finished, 'lap ' + k.lap);
  assert.strictEqual(k.finished, true);
  assert.ok(clearEv(st).some((e) => e.type === 'finish' && e.kart === 0));
});

test('item box gives an item once, then respawns later', () => {
  const st = race({ track: 0 }); const k = st.karts[0]; const b = st.boxes[0];
  k.x = b.x; k.y = b.y; L.step(st, 1 / 60);
  assert.ok(L.ITEMS.includes(k.item));
  assert.ok(b.t > 3);
  assert.ok(clearEv(st).some((e) => e.type === 'pickup'));
  const first = k.item; k.x = b.x; k.y = b.y; L.step(st, 1 / 60);
  assert.strictEqual(k.item, first, 'a kart that holds an item does not take another');
});

test('rank decides the item odds: leaders rarely get boosters, last place often does', () => {
  const st = L.newGame(L.rng(9), { level: 'normal' });
  st.karts.forEach((k, i) => { k.prog = 1000 - i * 100; });
  const count = (kart) => { const c = {}; for (let i = 0; i < 4000; i++) { const t = L.rollItem(st, kart); c[t] = (c[t] || 0) + 1; } return c; };
  const first = count(st.karts[0]), last = count(st.karts[st.karts.length - 1]);
  assert.ok((last.booster || 0) > (first.booster || 0) * 2);
  assert.ok((first.banana || 0) > (last.banana || 0) * 2);
  assert.ok(L.ITEMS.every((t) => first[t] > 0 && last[t] > 0), 'every item can appear for everyone');
});

test('banana makes a kart spin out and loses speed; shield blocks it once', () => {
  const st = race({ track: 0, rivals: 1 }); const [a, b] = st.karts;
  b.x = a.x + 300; b.y = a.y; a.vx = a.vy = 0;
  st.bananas.push({ x: a.x, y: a.y, owner: b.id, t: 1 });
  a.vx = 100; L.step(st, 1 / 60);
  assert.ok(a.stun > 0.8);
  assert.ok(L.speedOf(a) < 60);
  assert.strictEqual(st.bananas.length, 0);
  a.stun = 0; a.shield = 5;
  st.bananas.push({ x: a.x, y: a.y, owner: b.id, t: 1 }); L.step(st, 1 / 60);
  assert.strictEqual(a.stun, 0);
  assert.strictEqual(a.shield, 0);
  assert.ok(clearEv(st).some((e) => e.type === 'block'));
});

test('rocket flies forward and stuns the kart it hits (not the owner)', () => {
  const st = race({ track: 0, rivals: 1 }); const [a, b] = st.karts; const tr = L.buildTrack(0);
  L.placeKart(tr, a, 100, 0); L.placeKart(tr, b, 106, 0);          // b 가 a 앞에
  a.item = 'rocket'; assert.ok(L.useItem(st, a));
  assert.strictEqual(st.rockets.length, 1);
  run(st, 0.6);
  assert.ok(b.stun > 0 || b.hits > 0, 'target hit');
  assert.strictEqual(a.hits, 0);
});

test('karts bump into each other without overlapping', () => {
  const st = race({ track: 0, rivals: 1 }); const [a, b] = st.karts;
  b.x = a.x + 5; b.y = a.y;
  for (let i = 0; i < 20; i++) L.step(st, 1 / 60);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= L.P.radius * 2 - 1);
});

test('computer-only races finish on every track and level without stuck karts', () => {
  for (const level of ['easy', 'normal']) for (let ti = 0; ti < L.TRACKS.length; ti++) {
    const st = L.newGame(L.rng(11 + ti), { level, track: ti });
    st.karts[0].auto = true;
    let f = 0, resets = 0;
    while (!st.over && f < 60 * 300) { L.step(st, 1 / 60); f++; for (const e of st.events) if (e.type === 'reset') resets++; st.events.length = 0; }
    assert.ok(st.over, `${level} track ${ti} finished`);
    assert.ok(st.karts.filter((k) => k.finished).length >= 2, 'me and at least one more finished');
    assert.ok(resets <= 3, `resets ${resets}`);
    assert.ok(st.t > 45 && st.t < 200, `race time ${st.t}`);
  }
});

test('ranking: finished karts first by finish time, others by distance', () => {
  const st = L.newGame(L.rng(2), { level: 'easy', rivals: 3 });
  st.karts[2].finished = true; st.karts[2].finishT = 50;
  st.karts[3].finished = true; st.karts[3].finishT = 40;
  st.karts[0].prog = 500; st.karts[1].prog = 900;
  assert.deepStrictEqual(L.rankOrder(st).map((k) => k.id), [3, 2, 1, 0]);
  assert.strictEqual(L.rankOf(st, 0), 4);
});
