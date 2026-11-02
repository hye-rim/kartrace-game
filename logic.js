'use strict';
// 카트 레이스: 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 위에서 내려다본 서킷을 3바퀴 도는 카트 경주. 커브에서 드리프트를 모아 부스터, 아이템 상자(부스터·바나나·로켓·방어막), 컴퓨터 카트.
(function (root) {
  const STEP = 10;                       // 코스 중심선 점 간격
  const P = {
    maxV: 240, accel: 175, brakeA: 320, turn: 2.35, grip: 10, driftGrip: 1.7,
    grassMul: 0.5, wall: 70, driftMinV: 0.55, boostMul: 1.3, boostAccel: 520,
    radius: 9,                           // 카트 충돌 반지름
  };
  const DRIFT_LEVELS = [0.7, 1.4, 2.2];  // 드리프트 모은 시간(초): 이 시간을 넘으면 1·2·3단계
  const BOOST_TIME = [0, 0.7, 1.1, 1.6]; // 단계별 부스터 시간(초)
  const ITEMS = ['booster', 'banana', 'rocket', 'shield'];
  const COUNTDOWN = 3;
  const LEVELS = {
    easy: { rivals: 5, speed: 0.84, drift: false, noise: 0.35, rubber: 0.07 },
    normal: { rivals: 7, speed: 0.92, drift: true, noise: 0.12, rubber: 0.05 },
  };
  const NAMES = ['번개', '토끼', '곰돌이', '불꽃', '구름', '초코', '별똥', '바람'];

  // 코스: 중심선이 지나는 점(닫힌 곡선), 길 너비, 아이템 상자 줄 위치(한 바퀴 중 0~1)
  const TRACKS = [
    { name: '초원 서킷', width: 130, pts: [[600, 300], [1300, 260], [1900, 330], [2250, 720], [2050, 1150], [1500, 1280], [1100, 1030], [700, 1230], [300, 1080], [250, 650]], rows: [0.07, 0.3, 0.55, 0.8] },
    { name: '산길 S', width: 120, scale: 0.85, pts: [[500, 300], [1100, 240], [1500, 520], [1950, 300], [2400, 520], [2450, 1000], [2000, 1200], [1700, 950], [1300, 1250], [1450, 1650], [850, 1700], [350, 1450], [250, 900]], rows: [0.06, 0.28, 0.5, 0.74, 0.92] },
    { name: '도심 헤어핀', width: 115, scale: 0.85, pts: [[400, 300], [1300, 260], [2200, 300], [2450, 600], [2200, 900], [1500, 900], [1400, 1200], [2000, 1400], [2300, 1700], [1400, 1800], [700, 1650], [300, 1300], [250, 800]], rows: [0.06, 0.25, 0.48, 0.7, 0.9] },
  ];

  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  // ---------- 코스 만들기 ----------
  function cr(p0, p1, p2, p3, t) {      // 캣멀-롬 곡선
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
  }
  const cache = {};
  function buildTrack(index) {
    if (cache[index]) return cache[index];
    const def = TRACKS[index], sc = def.scale || 1, pts = def.pts.map((p) => [p[0] * sc, p[1] * sc]), m = pts.length, raw = [];
    for (let k = 0; k < m; k++) {
      const p0 = pts[(k - 1 + m) % m], p1 = pts[k], p2 = pts[(k + 1) % m], p3 = pts[(k + 2) % m];
      const steps = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4));
      for (let j = 0; j < steps; j++) raw.push(cr(p0, p1, p2, p3, j / steps));
    }
    // 일정한 간격으로 다시 뽑기
    const cum = [0];
    for (let i = 1; i <= raw.length; i++) { const a = raw[i - 1], b = raw[i % raw.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[raw.length], n = Math.round(total / STEP), ds = total / n;
    const x = new Float64Array(n), y = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = i * ds;
      while (cum[j + 1] < d) j++;
      const a = raw[j], b = raw[(j + 1) % raw.length], f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      x[i] = a[0] + (b[0] - a[0]) * f; y[i] = a[1] + (b[1] - a[1]) * f;
    }
    const ang = new Float64Array(n), kap = new Float64Array(n);
    for (let i = 0; i < n; i++) { const a = (i + n - 1) % n, b = (i + 1) % n; ang[i] = Math.atan2(y[b] - y[a], x[b] - x[a]); }
    for (let i = 0; i < n; i++) { const a = (i + n - 1) % n, b = (i + 1) % n; kap[i] = angDiff(ang[b], ang[a]) / (2 * ds); }
    const boxes = [];
    for (const f of def.rows) for (const lat of [-0.28, 0, 0.28]) { const i = Math.round(f * n) % n; boxes.push({ idx: i, lat: lat * def.width }); }
    const tr = { index, name: def.name, width: def.width, n, ds, L: total, x, y, ang, kap, boxes };
    cache[index] = tr;
    return tr;
  }
  // 좌표 → 중심선 위 가장 가까운 점과 옆으로 벗어난 거리(오른쪽이 +)
  function locate(tr, px, py, hint) {
    const { n, x, y, ang } = tr;
    let best = -1, bd = 1e18;
    const lo = hint === undefined ? -n : -30, hi = hint === undefined ? n : 30;
    for (let o = lo; o < hi; o++) {
      const i = hint === undefined ? ((o % n) + n) % n : (hint + o + n * 4) % n;
      const dx = px - x[i], dy = py - y[i], d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (hint !== undefined && bd > 120 * 120) return locate(tr, px, py);
    const a = ang[best], dx = px - x[best], dy = py - y[best];
    return { i: best, lat: -dx * Math.sin(a) + dy * Math.cos(a), dist: Math.sqrt(bd) };
  }
  const nextIdx = (tr, i, dist) => (i + Math.round(dist / tr.ds)) % tr.n;

  // ---------- 게임 만들기 ----------
  function makeKart(id, name, color, ai) {
    return { id, name, color, ai, x: 0, y: 0, ang: 0, vx: 0, vy: 0, spin: 0, steerS: 0, inp: { steer: 0, drift: false, brake: false },
      drift: null, boostT: 0, stun: 0, shield: 0, item: null, i: 0, lap: -1, prog: 0, finished: false, finishT: 0, best: 0,
      lane: 0, mul: 1, mistake: 0, stuck: 0, auto: false, aiThink: 0, hold: 0, lastLat: 0, bumps: 0, hits: 0, drifts: 0 };
  }
  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const lv = LEVELS[opts.level] ? opts.level : 'normal';
    const params = Object.assign({}, LEVELS[lv]);
    if (opts.rivals !== undefined) params.rivals = opts.rivals;
    const tr = buildTrack(clamp(opts.track | 0, 0, TRACKS.length - 1));
    const laps = opts.laps || 3;
    const N = 1 + params.rivals;
    const st = { rand, level: lv, params, track: tr, laps, karts: [], boxes: [], bananas: [], rockets: [], phase: opts.noCount ? 'race' : 'count', countT: opts.noCount ? 0 : COUNTDOWN, t: 0, over: false, events: [], tutorial: !!opts.tutorial, forceItem: opts.forceItem || null, doneT: 0 };
    const colors = ['#ff4d4d', '#3aa0ff', '#ffd23a', '#52d65a', '#c46bff', '#ff8a3a', '#2fd6c8', '#ff7ac8'];
    const names = NAMES.slice().sort(() => rand() - 0.5);
    const slot = N > 1 ? Math.min(N - 1, 2 + Math.floor(rand() * Math.max(1, N - 2))) : 0;   // 내 출발 자리(뒤쪽 절반)
    let ni = 0;
    for (let k = 0; k < N; k++) {
      const isMe = k === slot;
      const kart = makeKart(isMe ? 0 : 0, '', '', !isMe);
      kart.color = colors[k % colors.length];
      if (isMe) { kart.name = '나'; } else { kart.name = names[ni++ % names.length]; }
      // 격자: 두 줄씩, 출발선 뒤쪽
      const row = Math.floor(k / 2), side = k % 2 ? 1 : -1;
      const idx = ((tr.n - 5 - row * 3) % tr.n + tr.n) % tr.n;
      placeKart(tr, kart, idx, side * tr.width * 0.2);
      kart.lane = (rand() - 0.5) * tr.width * 0.4;
      kart.mul = params.speed * (0.97 + rand() * 0.06);
      st.karts.push(kart);
    }
    // 0번을 항상 나로 (자리만 다름)
    const meIdx = st.karts.findIndex((k) => k.name === '나');
    [st.karts[0], st.karts[meIdx]] = [st.karts[meIdx], st.karts[0]];
    st.karts.forEach((k, i) => { k.id = i; k.ai = i !== 0; });
    st.karts[0].mul = 1;
    for (const b of tr.boxes) st.boxes.push({ x: tr.x[b.idx] + -Math.sin(tr.ang[b.idx]) * b.lat, y: tr.y[b.idx] + Math.cos(tr.ang[b.idx]) * b.lat, t: 0 });
    return st;
  }
  function placeKart(tr, k, idx, lat) {
    const a = tr.ang[idx];
    k.x = tr.x[idx] - Math.sin(a) * lat; k.y = tr.y[idx] + Math.cos(a) * lat; k.ang = a; k.vx = k.vy = 0; k.i = idx; k.lap = -1;
    k.prog = k.lap * tr.L + idx * tr.ds; k.drift = null; k.boostT = 0; k.stun = 0; k.spin = 0; k.steerS = 0;
  }

  // ---------- 한 걸음 ----------
  const fwdOf = (k) => k.vx * Math.cos(k.ang) + k.vy * Math.sin(k.ang);
  const speedOf = (k) => Math.hypot(k.vx, k.vy);

  function stepKart(st, k, dt) {
    const tr = st.track, h = [Math.cos(k.ang), Math.sin(k.ang)];
    const inp = k.inp, raceOn = st.phase !== 'count';
    k.boostT = Math.max(0, k.boostT - dt); k.shield = Math.max(0, k.shield - dt);
    const loc = locate(tr, k.x, k.y, k.i);
    const onRoad = Math.abs(loc.lat) <= tr.width / 2 + 4;
    let fw = k.vx * h[0] + k.vy * h[1];
    if (k.stun > 0) {
      k.stun -= dt; k.spin += dt * 14;
      const f = Math.exp(-1.6 * dt); k.vx *= f; k.vy *= f;
      if (k.drift) k.drift = null;
    } else if (raceOn) {
      k.spin *= 0.8;
      k.steerS += (inp.steer - k.steerS) * Math.min(1, dt * 11);
      // 드리프트 시작 · 유지 · 끝
      if (inp.drift && !k.drift && fw > P.maxV * P.driftMinV && Math.abs(inp.steer) > 0.3 && onRoad) {
        k.drift = { dir: Math.sign(inp.steer), t: 0, level: 0 }; k.drifts++;
        st.events.push({ type: 'driftstart', kart: k.id });
      }
      if (k.drift) {
        if (!inp.drift || fw < P.maxV * 0.4) endDrift(st, k);
        else {
          k.drift.t += dt;
          const lv = k.drift.t >= DRIFT_LEVELS[2] ? 3 : k.drift.t >= DRIFT_LEVELS[1] ? 2 : k.drift.t >= DRIFT_LEVELS[0] ? 1 : 0;
          if (lv > k.drift.level) { k.drift.level = lv; st.events.push({ type: 'driftlevel', kart: k.id, level: lv }); }
        }
      }
      // 방향
      const sf = Math.min(1, Math.abs(fw) / 70) * (1 - 0.25 * Math.min(1, Math.abs(fw) / P.maxV));
      let rate;
      if (k.drift) rate = P.turn * (k.drift.dir * 0.35 + k.steerS * 0.8) * 1.15;      // 안쪽으로 꺾으면 급하게, 반대로 꺾으면 펴짐
      else rate = P.turn * k.steerS * sf * (fw < 0 ? -1 : 1);
      k.ang += rate * dt;
      // 가속 · 브레이크
      const vmax = P.maxV * k.mul * (k.boostT > 0 ? P.boostMul : 1) * (onRoad ? 1 : P.grassMul);
      const hh = [Math.cos(k.ang), Math.sin(k.ang)];
      fw = k.vx * hh[0] + k.vy * hh[1];
      if (inp.brake) { const sp = speedOf(k); if (sp > 1) { const d = Math.min(sp, P.brakeA * dt); k.vx -= k.vx / sp * d; k.vy -= k.vy / sp * d; } }
      else if (fw < vmax) { const a = k.boostT > 0 ? P.boostAccel : P.accel; k.vx += hh[0] * a * dt; k.vy += hh[1] * a * dt; }
      if (fw > vmax) { const f = Math.exp(-(onRoad ? 1.5 : 3.5) * dt); k.vx *= f; k.vy *= f; }
      // 옆으로 미끄러짐 줄이기 (드리프트 중에는 덜 잡아 줌)
      const fw2 = k.vx * hh[0] + k.vy * hh[1], lx = k.vx - hh[0] * fw2, ly = k.vy - hh[1] * fw2;
      const g = Math.exp(-(k.drift ? P.driftGrip : P.grip) * dt);
      k.vx = hh[0] * fw2 + lx * g; k.vy = hh[1] * fw2 + ly * g;
    }
    // 움직이기
    k.x += k.vx * dt; k.y += k.vy * dt;
    // 길 가장자리 벽
    const l2 = locate(tr, k.x, k.y, loc.i), limit = tr.width / 2 + P.wall;
    if (Math.abs(l2.lat) > limit) {
      const a = tr.ang[l2.i], nx = -Math.sin(a), ny = Math.cos(a), s = Math.sign(l2.lat), over = Math.abs(l2.lat) - limit;
      k.x -= nx * s * over; k.y -= ny * s * over;
      const vn = (k.vx * nx + k.vy * ny) * s;
      if (vn > 0) { k.vx -= nx * s * vn * 1.3; k.vy -= ny * s * vn * 1.3; k.vx *= 0.85; k.vy *= 0.85; if (vn > 60) { k.bumps++; st.events.push({ type: 'wall', kart: k.id, v: vn }); } }
      if (k.drift) endDrift(st, k, true);
    }
    // 바퀴 수 · 진행도
    const prev = k.i, now = l2.i;
    if (prev > tr.n * 0.75 && now < tr.n * 0.25) { k.lap++; onLap(st, k); }
    else if (prev < tr.n * 0.25 && now > tr.n * 0.75) k.lap--;
    k.i = now; k.lastLat = l2.lat;
    k.prog = k.lap * tr.L + now * tr.ds;
    // 막혀서 못 움직이면 길 한가운데로
    if (raceOn && !k.finished && speedOf(k) < 14) k.stuck += dt; else k.stuck = 0;
    if (k.stuck > 2.6) { k.stuck = 0; const lap = k.lap; placeKart(tr, k, k.i, 0); k.lap = lap; k.prog = lap * tr.L + k.i * tr.ds; st.events.push({ type: 'reset', kart: k.id }); }
  }

  function endDrift(st, k, cancel) {
    const d = k.drift; k.drift = null;
    if (!d || cancel) return;
    if (d.level > 0) { k.boostT = Math.max(k.boostT, BOOST_TIME[d.level]); st.events.push({ type: 'boost', kart: k.id, level: d.level, by: 'drift' }); }
  }
  function onLap(st, k) {
    if (k.lap < 0) return;
    if (k.lap >= 1) st.events.push({ type: 'lap', kart: k.id, lap: k.lap });
    if (k.lap >= st.laps && !k.finished) {
      k.finished = true; k.finishT = st.t; k.auto = true;
      st.events.push({ type: 'finish', kart: k.id, t: st.t, place: st.karts.filter((o) => o.finished).length });
    }
  }

  // ---------- 아이템 ----------
  function rollItem(st, k) {
    if (st.forceItem) return st.forceItem;
    const order = rankOrder(st), pos = order.indexOf(k) / Math.max(1, order.length - 1);   // 0 = 1등, 1 = 꼴찌
    const w = { booster: 1 + 3 * pos, banana: 3 - 2.5 * pos, rocket: 1 + 3.5 * pos, shield: 2.5 - 1.5 * pos };
    let sum = 0; for (const t of ITEMS) sum += w[t];
    let r = st.rand() * sum;
    for (const t of ITEMS) { r -= w[t]; if (r <= 0) return t; }
    return 'booster';
  }
  function useItem(st, k) {
    if (!k.item || k.stun > 0 || st.phase === 'count') return false;
    const t = k.item; k.item = null;
    const h = [Math.cos(k.ang), Math.sin(k.ang)];
    if (t === 'booster') { k.boostT = Math.max(k.boostT, 1.6); k.vx += h[0] * 40; k.vy += h[1] * 40; st.events.push({ type: 'boost', kart: k.id, level: 2, by: 'item' }); }
    else if (t === 'banana') st.bananas.push({ x: k.x - h[0] * 24, y: k.y - h[1] * 24, owner: k.id, t: 0 });
    else if (t === 'rocket') st.rockets.push({ x: k.x + h[0] * 16, y: k.y + h[1] * 16, vx: h[0] * 520 + k.vx * 0.3, vy: h[1] * 520 + k.vy * 0.3, owner: k.id, t: 0 });
    else if (t === 'shield') k.shield = 8;
    st.events.push({ type: 'useitem', kart: k.id, item: t });
    return true;
  }
  function hit(st, k, by, kind) {
    if (k.shield > 0) { k.shield = 0; st.events.push({ type: 'block', kart: k.id, by, kind }); return false; }
    if (k.stun > 0) return false;
    k.stun = kind === 'rocket' ? 1.3 : 1.0; k.hits++; k.spin = 0;
    const f = kind === 'rocket' ? 0.2 : 0.35; k.vx *= f; k.vy *= f;
    if (k.drift) k.drift = null;
    st.events.push({ type: 'hit', kart: k.id, by, kind });
    return true;
  }
  function stepItems(st, dt) {
    for (const b of st.boxes) {
      if (b.t > 0) { b.t -= dt; continue; }
      for (const k of st.karts) {
        if (k.item || Math.hypot(k.x - b.x, k.y - b.y) > 20) continue;
        k.item = rollItem(st, k); b.t = 4; k.hold = 0;
        st.events.push({ type: 'pickup', kart: k.id, item: k.item });
        break;
      }
    }
    for (let i = st.bananas.length - 1; i >= 0; i--) {
      const b = st.bananas[i]; b.t += dt; let gone = b.t > 25;
      for (const k of st.karts) {
        if (Math.hypot(k.x - b.x, k.y - b.y) < 14 && !(k.id === b.owner && b.t < 0.7)) { hit(st, k, b.owner, 'banana'); gone = true; break; }
      }
      if (gone) st.bananas.splice(i, 1);
    }
    for (let i = st.rockets.length - 1; i >= 0; i--) {
      const r = st.rockets[i]; r.t += dt;
      // 앞에 있는 가장 가까운 카트를 향해 살짝 꺾임
      let tgt = null, td = 320; const ra = Math.atan2(r.vy, r.vx);
      for (const k of st.karts) {
        if (k.id === r.owner) continue;
        const d = Math.hypot(k.x - r.x, k.y - r.y), a = Math.abs(angDiff(Math.atan2(k.y - r.y, k.x - r.x), ra));
        if (d < td && a < 0.7) { td = d; tgt = k; }
      }
      if (tgt) { const want = Math.atan2(tgt.y - r.y, tgt.x - r.x), na = ra + clamp(angDiff(want, ra), -2.2 * dt, 2.2 * dt), sp = Math.hypot(r.vx, r.vy); r.vx = Math.cos(na) * sp; r.vy = Math.sin(na) * sp; }
      r.x += r.vx * dt; r.y += r.vy * dt;
      let gone = r.t > 2.6;
      const l = locate(st.track, r.x, r.y);
      if (Math.abs(l.lat) > st.track.width / 2 + P.wall) gone = true;
      for (const k of st.karts) {
        if (k.id === r.owner) continue;
        if (Math.hypot(k.x - r.x, k.y - r.y) < 14) { hit(st, k, r.owner, 'rocket'); gone = true; st.events.push({ type: 'boom', x: r.x, y: r.y }); break; }
      }
      if (gone) st.rockets.splice(i, 1);
    }
  }

  // ---------- 컴퓨터 운전 ----------
  function aiControl(st, k, dt) {
    const tr = st.track, p = st.params, inp = k.inp;
    k.aiThink -= dt;
    // 나 대신 달리는 자동 운전(결승선을 지난 뒤)은 늘 안전하게
    const fw = fwdOf(k);
    const la = 60 + Math.max(0, fw) * 0.32;
    const ti = nextIdx(tr, k.i, la), a = tr.ang[ti];
    const lane = k.auto ? 0 : k.lane + (k.mistake > 0 ? Math.sin(st.t * 3 + k.id) * tr.width * 0.35 : 0);
    const tx = tr.x[ti] - Math.sin(a) * lane, ty = tr.y[ti] + Math.cos(a) * lane;
    const err = angDiff(Math.atan2(ty - k.y, tx - k.x), k.ang);
    let steer = clamp(err * 2.2, -1, 1);
    // 앞쪽 커브 크기
    let kmax = 0, ksign = 0;
    const cnt = Math.round((90 + Math.max(0, fw) * 0.45) / tr.ds);
    for (let j = 1; j <= cnt; j++) { const v = tr.kap[(k.i + j) % tr.n]; if (Math.abs(v) > kmax) { kmax = Math.abs(v); ksign = Math.sign(v); } }
    inp.brake = false; inp.drift = false;
    if (k.aiThink <= 0) { k.aiThink = 0.5; if (!k.auto) k.mistake = st.rand() < p.noise * 0.12 ? 0.8 : 0; }
    k.mistake = Math.max(0, k.mistake - dt);
    const need = Math.max(0, fw) * kmax;                      // 이 커브를 돌려면 필요한 회전 속도
    const canTurn = P.turn * 0.78;
    if (k.drift) {
      inp.drift = true;
      steer = clamp(err * 3, -1, 1);                          // 드리프트 중에도 길을 보며 안쪽·바깥쪽으로 조절
      if (kmax * Math.max(1, fw) < 0.9 || k.drift.t > 2.35 || kmax < 0.002 || ksign * k.drift.dir < 0) inp.drift = false;      // 커브 끝: 놓아서 부스터
    } else if ((p.drift || k.expert) && (!k.auto || k.expert) && need > canTurn * 1.05 && fw > P.maxV * 0.62 && k.stun <= 0 && ksign !== 0 && Math.abs(err) < 0.6) {
      inp.drift = true; steer = ksign * 0.9;
    } else if (need > canTurn * 1.15 && fw > 60) {
      inp.brake = need > canTurn * 1.5;
    }
    inp.steer = steer;
    // 아이템 쓰기
    if (k.item && k.stun <= 0 && st.phase !== 'count') {
      k.hold += dt;
      const t = k.item;
      const ahead = st.karts.some((o) => o !== k && o.prog > k.prog && o.prog - k.prog < 260 && Math.hypot(o.x - k.x, o.y - k.y) < 300 && Math.abs(angDiff(Math.atan2(o.y - k.y, o.x - k.x), k.ang)) < 0.5);
      const behind = st.karts.some((o) => o !== k && o.prog < k.prog && k.prog - o.prog < 170 && Math.hypot(o.x - k.x, o.y - k.y) < 190);
      if ((t === 'booster' && kmax < 0.004 && k.boostT <= 0) || (t === 'shield' && k.hold > 1.5) || (t === 'rocket' && ahead) || (t === 'banana' && behind) || k.hold > 9) useItem(st, k);
    }
  }

  function step(st, dt) {
    if (st.over) return;
    if (st.phase === 'count') {
      st.countT -= dt;
      if (st.countT <= 0) { st.phase = 'race'; st.events.push({ type: 'go' }); }
    } else st.t += dt;
    const sub = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / sub;
    const me = st.karts[0];
    const leader = Math.max(...st.karts.map((k) => k.prog));
    for (let s = 0; s < sub; s++) {
      for (const k of st.karts) {
        if (k.ai || k.auto) {
          aiControl(st, k, h);
          if (k.ai && !k.auto) k.mul = st.params.speed * (0.97 + (k.id % 3) * 0.02) * (1 + clamp((me.prog - k.prog) / st.track.L, -1, 1) * st.params.rubber);
        }
        stepKart(st, k, h);
      }
      // 카트끼리 부딪힘
      const ks = st.karts;
      for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
        const A = ks[a], B = ks[b], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), min = P.radius * 2;
        if (d < min && d > 0.01) {
          const nx = dx / d, ny = dy / d, push = (min - d) / 2;
          A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
          const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
          if (rv < 0) { const j = -rv * 0.6; A.vx -= nx * j; A.vy -= ny * j; B.vx += nx * j; B.vy += ny * j; if (-rv > 40 && (a === 0 || b === 0)) st.events.push({ type: 'bump', v: -rv }); }
        }
      }
      stepItems(st, h);
    }
    // 끝: 내가 들어오고 다 들어오거나 12초가 지나면
    if (me.finished) {
      st.doneT += dt;
      if (st.karts.every((k) => k.finished) || st.doneT > 12) { st.over = true; st.phase = 'done'; st.events.push({ type: 'over' }); }
    }
    void leader;
  }

  // 순위: 들어온 순서 먼저, 못 들어온 카트는 달린 거리 순
  function rankOrder(st) {
    return st.karts.slice().sort((a, b) => (a.finished && b.finished ? a.finishT - b.finishT : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog) || a.id - b.id);
  }
  const rankOf = (st, id) => rankOrder(st).findIndex((k) => k.id === id) + 1;

  const api = { STEP, P, DRIFT_LEVELS, BOOST_TIME, ITEMS, COUNTDOWN, LEVELS, NAMES, TRACKS, rng, clamp, angDiff, buildTrack, locate, nextIdx, newGame, step, useItem, rollItem, rankOrder, rankOf, fwdOf, speedOf, placeKart, aiControl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_KART = api;
})(typeof window !== 'undefined' ? window : globalThis);
