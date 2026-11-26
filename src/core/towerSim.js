// Детерминированная симуляция стройки одного здания (спецификация §3).
// Без three и DOM. Внешний код читает state и слушает events. Условие-плагин opts.cond («Башня дня» §5.2): числа
// setup применяются при создании, обработчики spawn / land / miss вызываются только на событиях этажа.
import { Emitter } from './events.js';
import { createRng, hashSeed } from './rng.js';
import { W0, D0, FLOOR_H, SIM, QUICK, STEADY, STORM, specialParams } from './levels.js';
import { landFloor, createSpecialSchedule } from './towerShape.js';

const TAU = Math.PI * 2;
/** Быстрые числа, которые заменяет setup условия («Башня дня» §5.2); в городе они не действуют. */
const QUICK_KEYS = ['period', 'minPeriodFactor', 'windFrom', 'windStrength', 'ellipseFrom'];
/** ctx.addLife не даёт касок больше этого числа оставшихся («Башня дня» §5.2). */
const COND_LIVES_MAX = 3;
/** Шаг без команд: один пустой массив на модуль, а не новый на каждый шаг. */
const NO_COMMANDS = Object.freeze([]);
const FLIGHT_SEGMENTS = 16;

/** QUICK с заданными ключами setup; без них — тот же объект, без копии. */
function quickNumbers(q, setup) {
  let out = q;
  for (const k of QUICK_KEYS) {
    if (setup[k] === undefined) continue;
    if (out === q) out = { ...q };
    out[k] = setup[k];
  }
  return out;
}

export function createTowerSim(opts = {}) {
  // условие-плагин («Башня дня» §5.2): объект, не id — реестр условий симуляция не импортирует
  const cond = opts.cond || null;
  const setup = cond?.setup || {};
  const quick = opts.mode === 'quick' ? quickNumbers(opts.quick || QUICK, setup) : null;
  const storm = opts.storm === true;
  const cfg = {
    mode: quick ? 'quick' : 'city',
    calm: !storm && opts.calm === true,
    storm,
    startFloor: opts.startFloor === true,
    amp: SIM.amp, ampZ: SIM.ampZ,
    floorsTarget: quick ? Infinity : (opts.floorsTarget ?? 10),
    base: opts.base ?? (quick ? quick.base : 10),
    period: quick ? quick.period : (opts.period ?? 2.4),
    minPeriodFactor: quick ? quick.minPeriodFactor : SIM.minPeriodFactor,
    wind: storm ? STORM.wind : (opts.wind ?? 0),
    gusty: storm || !!(setup.gusty ?? opts.gusty),
    ellipse: !!opts.ellipse,
    // золотые этажи и множители условия; без условия — прежние числа, множители равны 1 точно
    goldenEvery: setup.goldenEvery ?? SIM.goldenEvery,
    goldenJitter: setup.goldenJitter ?? SIM.goldenJitter,
    perfectMul: setup.perfectMul ?? 1,
    perfectPopMul: setup.perfectPopMul ?? 1,
  };
  if (cfg.calm) {
    cfg.period = Math.max(STEADY.minPeriod, cfg.period * STEADY.periodMul);
    cfg.minPeriodFactor = STEADY.minPeriodFactor;
    cfg.amp *= STEADY.arcMul;
    cfg.ampZ *= STEADY.arcMul;
  } else if (storm) cfg.period *= STORM.periodMul;
  const periodDecay = cfg.calm ? STEADY.periodDecay : SIM.periodDecay;
  const windFall = storm ? STORM.windFall : SIM.windFall;
  const swayC = cfg.calm ? STEADY.swayC : SIM.swayC;
  const impulse = cfg.calm ? SIM.kappa * STEADY.impulseMul : SIM.kappa;
  const rng = createRng(opts.seed ?? 1);
  // Спец-этажи (спецификация «Спец-этажи» §4.3): своё расписание на своём потоке — rng не расходуется (не fork),
  // поэтому золотые этажи и ветер те же, что без спец-этажей. specialType и specialRetry — гарантия типа и повтор
  // для цели героя («Башня дня» §4.4); specialFirst, specialGap, specialType из setup — условие (§5.2).
  const schedule = opts.specials
    ? createSpecialSchedule(createRng(hashSeed('special', opts.seed ?? 1)), {
      first: setup.specialFirst, gap: setup.specialGap,
      type: setup.specialType ?? opts.specialType ?? null, retry: opts.specialRetry ?? null,
    })
    : null;
  // основание первого этажа (startW, «Башня дня» §5.2): посадка первого этажа, первый висящий этаж и расписание
  const startW = setup.startW ?? 1;
  const BASE = Object.freeze({ x: 0, z: 0, w: W0 * startW, d: D0 * startW });
  const events = new Emitter();
  const DANGER_ON = SIM.swayDanger * W0;
  const DANGER_OFF = (SIM.swayDanger - 0.03) * W0;
  const breeze = storm ? 0.25 : 1; // в просветах между штормовыми фронтами остаётся слабый фоновый ветер
  const WIND_RAMP = 0.5; // ед. силы ветра в секунду при включении в быстрой игре

  const st = {
    time: 0,
    phase: 'spawning',
    spawnTimer: SIM.spawnDelay,
    hookPhase: 0,
    ellPhase: 0,      // фаза прецессии эллипса, рад
    hook: { x: 0, z: 0, vx: 0, vz: 0, angle: 0 },
    freezeHook: false,
    ellipseK: 0,
    hanging: { w: BASE.w, d: BASE.d, golden: false, special: null },
    falling: null,
    // Готовая опора входит в силуэт и высоту. Жители и комбо появляются при сбросах игрока.
    floors: cfg.startFloor ? [{ ...BASE, golden: false, zone: 'hit', pop: 0 }] : [],
    sway: { x: 0, z: 0, vx: 0, vz: 0 },
    bias: { x: 0, z: 0 },
    combo: 0,
    bestCombo: 0,
    comboTimer: 0,
    misses: 0,
    maxMisses: setup.maxMisses ?? SIM.misses,
    population: 0,
    drops: 0,
    nextGolden: cfg.goldenEvery + rng.int(-cfg.goldenJitter, cfg.goldenJitter),
    slowLeft: 0,
    magnet: false,
    helmetUsed: false,
    comboBonusGiven: false,
    danger: false,
    finished: null,
    upcoming: null,       // тип следующего сброса (спец-этаж) или null
    windW: 0,
    stormDust: 0,
    stormRod: null,       // 'first' или 'aim' с предупреждения до посадки груза либо удара по крыше
    windBias: Math.abs(setup.windBias ?? 0), // постоянный ветер по x — доля силы ветра; знак ставит условие
  };
  // Отдельный поток случайных чисел для ветра: сбросы не влияют на порывы.
  const windRng = rng.fork(17);
  const gust = { start: -1e9, len: 1.2, lull: .5, dir: 1, amp: 0, next: storm ? -windRng.uniform(0.1, 0.8) : windRng.uniform(3, 7) };
  const windPhase = storm ? windRng.uniform(0, TAU) : 0;
  const stormRng = storm ? createRng(hashSeed('lightning', opts.seed ?? 1)) : null;
  let warningHeight = 2, strikeTime = Infinity, warningDuration = 0, nextRod = 'first';
  let hasLanded = false; // готовая опора не открывает добровольный финиш, удар молнии его не отменяет
  // Личная быстрая игра, Башня дня и вызов. Один буфер на забег; отдельный снимок остаётся только от последнего промаха.
  const flight = quick ? new Float64Array(3 * (FLIGHT_SEGMENTS + 1)) : null;
  let flightPoints = 0, nextSampleY = 0, lastMiss = null;
  // ветер шага (stepSway, stepFalling): windAcc пишет в этот объект — на шаг новых объектов нет
  const _wnd = { x: 0, z: 0 };
  // обработчики условия (§5.2): один контекст на симуляцию, вызовы только на событиях этажа
  const ctx = cond ? makeCtx() : null;
  const hooks = typeof cond?.create === 'function' ? cond.create(opts.seed ?? 1) : null;
  st.ellipseK = ellipseOn() ? 1 : 0;
  st.windW = windTarget();
  if (storm) stepWind(0);
  if (cfg.startFloor && st.floors.length >= cfg.floorsTarget) finish(false);
  else st.upcoming = pickSpecial();

  /** Тип следующего сброса (drop = st.drops + 1) по расписанию; без спец-этажей — null. Ровно раз на сброс. */
  function pickSpecial() {
    if (!schedule) return null;
    const drop = st.drops + 1, index = st.floors.length;
    return schedule.pick({
      drop, index, top: st.floors.at(-1) ?? BASE, golden: drop === st.nextGolden,
      last: cfg.mode === 'city' && index === cfg.floorsTarget - 1,
    });
  }

  function ellipseOn() {
    if (quick) return st.floors.length >= quick.ellipseFrom;
    return cfg.ellipse;
  }

  function windTarget() {
    if (storm) return cfg.wind;
    if (quick) return st.floors.length >= quick.windFrom ? quick.windStrength : 0;
    return cfg.wind;
  }

  /** Контекст обработчиков условия: чтение через геттеры и три действия; создаётся один раз. */
  function makeCtx() {
    const bias = Math.abs(setup.windBias ?? 0);
    return {
      get floors() { return st.floors.length; },
      get misses() { return st.misses; },
      get maxMisses() { return st.maxMisses; },
      get windBias() { return st.windBias; },
      /** Каска, если их осталось меньше COND_LIVES_MAX; → добавлена ли. */
      addLife() {
        if (st.maxMisses - st.misses >= COND_LIVES_MAX) return false;
        st.maxMisses += 1;
        return true;
      },
      /** Знак постоянного ветра; сила — модуль setup.windBias. */
      setWindBias(sign) { st.windBias = (sign < 0 ? -1 : 1) * bias; },
      /** Событие condition { kind, ...data } для интерфейса. */
      notice(kind, data) { events.emit('condition', { kind, ...data }); },
    };
  }

  // Плотность фронта определяет и видимость, и снос груза. В середине фронта есть короткое затишье.
  function stormPressure(t) {
    const u = (t - gust.start) / gust.len;
    if (u <= 0 || u >= 1) return 0;
    const edge = Math.min(1, u / .17, (1 - u) / .22);
    const lull = Math.max(0, 1 - Math.abs(u - gust.lull) / .17);
    const ripple = .91 + .09 * Math.sin(2.2 * t + windPhase);
    return smoothstep(edge) * (1 - .72 * smoothstep(lull)) * ripple;
  }

  function gustAt(t) {
    if (storm) return gust.dir * gust.amp * (t === st.time ? st.stormDust : stormPressure(t));
    const u = (t - gust.start) / gust.len;
    if (u < 0 || u > 1) return 0;
    const e = Math.sin(Math.PI * u);
    return gust.dir * gust.amp * e * e;
  }

  /** Ускорение ветра в момент t: { x, z }; out — запись в этот объект (шаг, кадр), без него — новый. */
  function windAcc(t = st.time, out = { x: 0, z: 0 }) {
    const W = st.windW;
    if (!(W > 0)) { out.x = 0; out.z = 0; return out; }
    const g = gustAt(t);
    if (storm) t += windPhase;
    let x = W * (breeze * (0.5 * Math.sin(0.37 * t) + 0.35 * Math.sin(1.13 * t + 1)) + g);
    // постоянный ветер условия (§5.2); при нуле выражение прежнее, побитово
    if (st.windBias !== 0) x += W * st.windBias;
    const z = st.ellipseK > 0
      ? 0.6 * W * st.ellipseK * (breeze * (0.5 * Math.sin(0.37 * t + 2) + 0.35 * Math.sin(1.13 * t + 3)) + g)
      : 0;
    out.x = x; out.z = z;
    return out;
  }

  function stepWind(dt) {
    const target = windTarget();
    st.windW += Math.sign(target - st.windW) * Math.min(Math.abs(target - st.windW), WIND_RAMP * dt);
    if (st.time >= gust.next) {
      gust.start = gust.next;
      gust.dir = windRng.next() < 0.5 ? -1 : 1;
      gust.amp = storm ? windRng.uniform(1.1, 1.65) : (cfg.gusty ? 1.0 : 0.6) * windRng.uniform(0.6, 1);
      if (storm) {
        gust.len = windRng.uniform(...STORM.gustLen);
        gust.lull = windRng.uniform(.43, .59);
      }
      const gap = storm ? windRng.uniform(...STORM.gustGap) : windRng.uniform(3, 7);
      gust.next = gust.start + gust.len + gap;
    }
    if (storm) st.stormDust = stormPressure(st.time);
  }

  function stepLightning() {
    if (st.phase !== 'hanging') return;
    if (strikeTime === Infinity) {
      if (st.floors.length < warningHeight) return;
      warningDuration = stormRng.uniform(...STORM.warning);
      strikeTime = st.time + warningDuration;
      st.stormRod = nextRod;
      events.emit('stormWarning', { seconds: warningDuration });
    } else if (st.time >= strikeTime) {
      strikeRoof();
    }
  }

  function endThreat() {
    st.stormRod = null;
    nextRod = 'aim';
    strikeTime = Infinity;
    warningHeight = st.floors.length + stormRng.int(...STORM.safeFloors);
  }

  function strikeRoof() {
    const n = st.floors.length;
    const off = topOffset(), y = topY();
    const floor = st.floors.pop();
    st.population -= floor.pop;
    st.combo = 0; st.comboTimer = 0;
    recomputeBias();
    const held = st.phase === 'hanging';
    if (schedule?.removed(st.drops + (held ? 1 : 0), floor.special, floor.zone === 'perfect')) {
      if (held) {
        // Повтор летит за уже выбранным грузом, пропуская золото. Остаётся только крыша — меняем груз на крюке.
        const retryFloor = n + (st.nextGolden === st.drops + 2 ? 2 : 1);
        if (retryFloor >= cfg.floorsTarget && st.hanging.special !== floor.special) {
          if (st.hanging.golden) st.nextGolden++;
          st.upcoming = floor.special;
          st.phase = 'spawning';
          st.spawnTimer = SIM.spawnDelay;
        }
      } else if (n === cfg.floorsTarget - 1 && st.nextGolden === st.drops + 1) {
        // Только что поставленный спецэтаж утрачен. Отдаём ему последнее место перед золотой крышей.
        st.nextGolden++;
      }
    }
    endThreat();
    events.emit('stormStrike', { index: n - 1, floor, x: floor.x + off.x, y, z: floor.z + off.z });
  }

  function landRod(f, res) {
    if (res.zone === 'miss') {
      endThreat();
      events.emit('stormDiverted', { target: 'cargo', x: f.x, y: f.y + FLOOR_H, z: f.z });
      return;
    }
    // Считаем по основанию, на которое садился груз, до среза или расширения нового этажа.
    const support = st.floors.at(-2);
    if (st.stormRod === 'aim' && res.zone !== 'perfect' &&
        (Math.abs(res.dx) > support.w * STORM.rodZone / 2 || Math.abs(res.dz) > support.d * STORM.rodZone / 2)) {
      if (st.floors.length < cfg.floorsTarget) strikeRoof();
      return;
    }
    const roof = st.floors.at(-1), off = topOffset();
    endThreat();
    events.emit('stormDiverted', { target: 'rod', x: roof.x + off.x, y: topY(), z: roof.z + off.z });
  }

  function effectivePeriod() {
    const n = st.floors.length;
    const f = Math.max(cfg.minPeriodFactor, 1 - periodDecay * n);
    return cfg.period * f * (st.slowLeft > 0 ? 2 : 1);
  }

  function topY() {
    return st.floors.length * FLOOR_H;
  }

  /** Смещение верха от раскачивания: { x, z }; out — запись в этот объект (шаг, кадр), без него — новый. */
  function topOffset(out = { x: 0, z: 0 }) {
    const k = Math.min(1, st.floors.length / SIM.heightRamp);
    out.x = st.sway.x * k; out.z = st.sway.z * k;
    return out;
  }

  function floorOffset(i) {
    const n = st.floors.length;
    if (n === 0) return { x: 0, z: 0 };
    const t = topOffset();
    const q = ((i + 1) / n) ** 2;
    return { x: t.x * q, z: t.z * q };
  }

  // --- крюк ---
  function stepHook(dt) {
    const target = ellipseOn() ? 1 : 0;
    st.ellipseK += Math.sign(target - st.ellipseK) * Math.min(Math.abs(target - st.ellipseK), dt);
    if (st.freezeHook) return;
    const T = effectivePeriod();
    const w = TAU / T;
    st.hookPhase = (st.hookPhase + w * dt) % TAU;
    const sn = Math.sin(st.hookPhase), cs = Math.cos(st.hookPhase);
    const az = cfg.ampZ * st.ellipseK;
    st.hook.x = cfg.amp * sn;
    st.hook.vx = cfg.amp * cs * w;
    // z = A_z·sin(φ + β): при β = 90° — эллипс из спецификации (z = A_z·cos φ), при β = 0 — линия
    // через центр. На одной частоте с фазой 90° ни крюк, ни точка посадки (с учётом наследования
    // скорости) не проходят над центром, поэтому β медленно ходит 0 → 90° → 0, задерживаясь у линии.
    const we = w / SIM.ellCycles;
    st.ellPhase = (st.ellPhase + we * dt) % TAU;
    const s = (1 - Math.cos(st.ellPhase)) / 2;
    const beta = (Math.PI / 2) * s * s;
    const dbeta = (Math.PI / 2) * s * Math.sin(st.ellPhase) * we;
    st.hook.z = az * Math.sin(st.hookPhase + beta);
    st.hook.vz = az * Math.cos(st.hookPhase + beta) * (w + dbeta);
    st.hook.angle = -0.22 * sn;
  }

  // --- раскачивание: пружина вокруг bias + ветер, полунеявный Эйлер ---
  function stepSway(dt) {
    const s = st.sway, b = st.bias;
    const wnd = windAcc(st.time, _wnd);
    const lim = SIM.swayMax * W0;
    const ax = -SIM.swayK * (s.x - b.x) - swayC * s.vx + wnd.x;
    s.vx += ax * dt; s.x += s.vx * dt;
    if (s.x > lim) { s.x = lim; s.vx = 0; } else if (s.x < -lim) { s.x = -lim; s.vx = 0; }
    const az = -SIM.swayK * (s.z - b.z) - swayC * s.vz + wnd.z;
    s.vz += az * dt; s.z += s.vz * dt;
    if (s.z > lim) { s.z = lim; s.vz = 0; } else if (s.z < -lim) { s.z = -lim; s.vz = 0; }
    const m = Math.max(Math.abs(s.x), Math.abs(s.z));
    const on = st.danger ? m > DANGER_OFF : m > DANGER_ON;
    if (on !== st.danger) {
      st.danger = on;
      events.emit('danger', { on });
    }
  }

  function dampSway(f) {
    const s = st.sway, b = st.bias;
    s.x = b.x + (s.x - b.x) * f; s.vx *= f;
    s.z = b.z + (s.z - b.z) * f; s.vz *= f;
  }

  function pushFloor(floor) {
    st.floors.push(floor);
    st.population += floor.pop;
    recomputeBias();
  }

  function recomputeBias() {
    let ax = 0, az = 0, a = 0;
    for (const f of st.floors) { const ar = f.w * f.d; ax += f.x * ar; az += f.z * ar; a += ar; }
    const lim = SIM.biasMax * W0;
    st.bias.x = a > 0 ? clamp(SIM.biasFactor * (ax / a), -lim, lim) : 0;
    st.bias.z = a > 0 ? clamp(SIM.biasFactor * (az / a), -lim, lim) : 0;
  }

  // --- команды ---
  function sampleFlight(f) {
    const i = 3 * flightPoints++;
    flight[i] = f.x; flight[i + 1] = f.y; flight[i + 2] = f.z;
    // При постоянном ускорении такие высоты делят полёт примерно поровну по времени, включая начало дуги.
    nextSampleY = flight[1] - SIM.dropHeight * (flightPoints / FLIGHT_SEGMENTS) ** 2;
  }

  function doDrop() {
    if (st.phase !== 'hanging') return;
    st.drops++;
    const h = st.hanging;
    st.falling = {
      x: st.hook.x, y: topY() + SIM.dropHeight, z: st.hook.z,
      vx: st.hook.vx * SIM.inherit, vy: 0, vz: st.hook.vz * SIM.inherit,
      w: h.w, d: h.d, golden: h.golden, magnet: st.magnet, special: h.special,
    };
    if (flight) {
      flightPoints = 0;
      sampleFlight(st.falling);
    }
    st.magnet = false;
    if (st.slowLeft > 0) st.slowLeft--;
    st.phase = 'falling';
    events.emit('dropped', { x: st.falling.x, z: st.falling.z });
  }

  const EPS = 1e-9;

  function canUseBonus(id) {
    if (st.phase === 'finished') return false;
    switch (id) {
      case 'magnet': return !st.magnet;
      case 'slow': return st.slowLeft === 0;
      case 'widen': {
        if (st.phase !== 'hanging' && st.phase !== 'spawning') return false;
        const top = st.floors.at(-1);
        const topSmall = !!top && (top.w < W0 - EPS || top.d < D0 - EPS);
        const hangSmall = st.phase === 'hanging' && (st.hanging.w < W0 - EPS || st.hanging.d < D0 - EPS);
        return topSmall || hangSmall;
      }
      case 'anchor': {
        const s = st.sway, b = st.bias;
        return Math.abs(s.x - b.x) + Math.abs(s.z - b.z) + Math.abs(s.vx) + Math.abs(s.vz) > 0.02;
      }
      case 'helmet': return !st.helmetUsed;
      default: return false;
    }
  }

  function useBonus(id) {
    if (!canUseBonus(id)) {
      events.emit('bonusRejected', { id });
      return;
    }
    switch (id) {
      case 'magnet': st.magnet = true; break;
      case 'slow': st.slowLeft = SIM.slowFloors; break;
      case 'widen': {
        const top = st.floors.at(-1);
        if (top) { top.w = W0; top.d = D0; recomputeBias(); }
        if (st.phase === 'hanging') { st.hanging.w = W0; st.hanging.d = D0; }
        break;
      }
      case 'anchor': {
        const s = st.sway, b = st.bias;
        s.x = b.x; s.z = b.z; s.vx = 0; s.vz = 0;
        break;
      }
      case 'helmet': st.helmetUsed = true; st.maxMisses += 1; break;
    }
    events.emit('bonusUsed', { id });
    if (id === 'widen') events.emit('widened', {});
  }

  // --- падение и приземление ---
  function stepFalling(dt) {
    const f = st.falling;
    const wnd = windAcc(st.time, _wnd);
    const sp = specialParams(f.special); // множитель 1 — точный: обычный этаж падает побитово как раньше
    f.vx += wnd.x * windFall * (sp?.windMul ?? 1) * dt;
    f.vz += wnd.z * windFall * (sp?.windMul ?? 1) * dt;
    f.vy -= SIM.g * (sp?.gMul ?? 1) * dt;
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
    if (f.y <= topY()) {
      f.y = topY();
      land();
    } else if (flight && flightPoints < FLIGHT_SEGMENTS && f.y <= nextSampleY) sampleFlight(f);
  }

  function land() {
    const f = st.falling;
    const res = resolveLanding();
    st.falling = null;
    if (res.zone === 'miss') {
      st.misses++;
      st.combo = 0;
      schedule?.missed(st.drops, f.special); // повтор спец-этажа цели (§4.4) — до выбора следующего в afterResolve
      events.emit('missed', { x: f.x, y: f.y, z: f.z, w: f.w, d: f.d, vx: f.vx, vz: f.vz, golden: f.golden, special: f.special });
      // условие (§5.2): после missed, до проверки конца игры
      if (hooks?.miss) hooks.miss(ctx);
    } else {
      hasLanded = true;
      schedule?.landed(f.special, res.zone === 'perfect');
      const index = st.floors.length - 1;
      if (res.pieces && res.pieces.length) events.emit('sliced', { pieces: res.pieces, cx: res.cx, cz: res.cz });
      events.emit('landed', {
        zone: res.zone, index, floor: st.floors[index], dx: res.dx, dz: res.dz, pop: res.pop,
        golden: f.golden, comboActive: res.comboActive, combo: st.combo,
        special: f.special, regrown: res.regrown, damped: res.damped, lx: res.lx, lz: res.lz,
      });
      if (res.zone === 'perfect') {
        events.emit('combo', { count: st.combo });
        if (st.combo >= SIM.comboBonusAt && !st.comboBonusGiven) {
          st.comboBonusGiven = true;
          events.emit('comboBonus', {});
        }
      }
      if (f.golden) events.emit(res.zone === 'perfect' ? 'goldenPerfect' : 'goldenHit', {});
      // условие (§5.2): после всех событий посадки, до проверки конца игры
      if (hooks?.land) hooks.land(ctx, { zone: res.zone, index });
    }
    if (f.golden) st.nextGolden += cfg.goldenEvery + rng.int(-cfg.goldenJitter, cfg.goldenJitter);
    if (st.stormRod) landRod(f, res);
    afterResolve();
  }

  function resolveLanding() {
    const n = st.floors.length;
    const top = n ? st.floors[n - 1] : BASE;
    const off = topOffset();
    const f = st.falling;
    const lx = f.x - off.x, lz = f.z - off.z;
    const comboActive = st.comboTimer > 0;
    const sp = specialParams(f.special);
    // геометрия посадки — в towerShape.landFloor: её же прогоняет генератор формы старых домов
    const r = landFloor(top, { x: lx, z: lz, w: f.w, d: f.d, magnet: f.magnet, special: f.special, perfectMul: cfg.perfectMul }, st.combo);
    const { dx, dz } = r;
    // лофт гасит качку (спецификация «Спец-этажи» §4.4): заметно, если амплитуда до посадки не меньше notice
    const damped = !!sp?.swayDamp && swayAmp() >= sp.notice;

    if (r.zone === 'perfect') {
      st.combo = r.combo;
      st.bestCombo = Math.max(st.bestCombo, st.combo);
      const pop = Math.round(cfg.base * Math.min(2, 1 + 0.1 * st.combo) * (comboActive ? SIM.comboMul : 1) * (sp?.popMul ?? 1) * cfg.perfectPopMul);
      pushFloor(floorOf(r, f, 'perfect', pop));
      st.comboTimer = SIM.comboTime;
      if (sp?.swayDamp) dampSway(SIM.perfectDamp * sp.swayDamp);
      else dampSway(SIM.perfectDamp);
      return { zone: 'perfect', dx, dz, pop, comboActive, regrown: r.regrown, damped, lx, lz };
    }
    if (r.zone === 'miss') {
      if (flight) {
        sampleFlight(f);
        lastMiss = {
          drop: st.drops, floor: n + 1, w: f.w, d: f.d, path: flight.slice(0, 3 * flightPoints),
          roof: { x: top.x + off.x, y: f.y, z: top.z + off.z, w: top.w, d: top.d },
        };
      }
      return { zone: 'miss', dx, dz };
    }

    // точность — по пересечению до расширения балкона (у обычного этажа ow, od — те же w, d)
    const acc = (r.ow * r.od) / (f.w * f.d);
    const pop = Math.round(cfg.base * (0.3 + 0.7 * acc) * (comboActive ? SIM.comboMul : 1) * (sp?.popMul ?? 1));
    const pieces = slicePieces(f, lx, lz, r.x0, r.x1, r.z0, r.z1, off);
    pushFloor(floorOf(r, f, 'hit', pop));
    st.combo = 0;
    if (sp?.swayDamp) {
      // лофт: сначала гасит, затем толкает сильнее; dampSway(1) у обычных не вызывается — он не тождествен побитово
      dampSway(sp.swayDamp);
      const k = impulse * (sp.kappaMul ?? 1);
      st.sway.vx += k * dx;
      if (ellipseOn()) st.sway.vz += k * dz;
    } else {
      st.sway.vx += impulse * dx;
      if (ellipseOn()) st.sway.vz += impulse * dz;
    }
    return { zone: 'hit', dx, dz, pop, comboActive, pieces, regrown: r.regrown, damped, lx, lz, cx: lx + off.x, cz: lz + off.z };
  }

  /** Этаж башни; ключ special — только у спец-этажа: от набора ключей зависит эталон GOLDEN_PRINT. */
  function floorOf(r, f, zone, pop) {
    const floor = { x: r.x, z: r.z, w: r.w, d: r.d, golden: f.golden, zone, pop };
    if (f.special) floor.special = f.special;
    return floor;
  }

  /** Амплитуда раскачивания: отклонение от bias и скорость в единицах длины (ω = √swayK). */
  function swayAmp() {
    const s = st.sway, b = st.bias, w = Math.sqrt(SIM.swayK);
    return Math.hypot(s.x - b.x, s.z - b.z, s.vx / w, s.vz / w);
  }

  // Отрезанные части в мировых координатах: слева/справа по X на всю глубину падающего, затем спереди/сзади по Z
  // на пересечении этажа с падающим. Балкон расширяет этаж за края падающего — без него max и min дают прежнее.
  function slicePieces(f, lx, lz, x0, x1, z0, z1, off) {
    const pieces = [];
    const fx0 = lx - f.w / 2, fx1 = lx + f.w / 2, fz0 = lz - f.d / 2, fz1 = lz + f.d / 2;
    const y = f.y, push = 1.2, eps = 1e-6;
    const add = (ax0, ax1, az0, az1, ox, oz) => pieces.push({
      x: (ax0 + ax1) / 2 + off.x, y, z: (az0 + az1) / 2 + off.z,
      w: ax1 - ax0, d: az1 - az0, vx: f.vx + ox * push, vz: f.vz + oz * push,
    });
    const cx0 = Math.max(x0, fx0), cx1 = Math.min(x1, fx1);
    if (x0 - fx0 > eps) add(fx0, x0, fz0, fz1, -1, 0);
    if (fx1 - x1 > eps) add(x1, fx1, fz0, fz1, 1, 0);
    if (z0 - fz0 > eps) add(cx0, cx1, fz0, z0, 0, -1);
    if (fz1 - z1 > eps) add(cx0, cx1, z1, fz1, 0, 1);
    return pieces;
  }

  function afterResolve() {
    if (st.misses >= st.maxMisses) return finish(true);
    if (st.floors.length >= cfg.floorsTarget) return finish(false);
    st.phase = 'spawning';
    st.spawnTimer = SIM.spawnDelay;
    st.upcoming = pickSpecial();
  }

  function canFinishQuick() {
    return !!quick && hasLanded && st.phase !== 'finished';
  }

  function finish(early, voluntary = false) {
    st.phase = 'finished';
    st.falling = null;
    st.stormRod = null;
    // форма — копии этажей в координатах фундамента (спецификация «Своя башня» §4.2); special — только у спец-этажей
    const shape = st.floors.map(({ x, z, w, d, golden, zone, special }) => (special ? { x, z, w, d, golden, zone, special } : { x, z, w, d, golden, zone }));
    st.finished = { floors: st.floors.length, population: st.population, early, bestCombo: st.bestCombo, misses: st.misses, shape };
    if (voluntary) st.finished.voluntary = true;
    events.emit('finished', { ...st.finished });
  }

  function spawn() {
    const n = st.floors.length;
    const top = n ? st.floors[n - 1] : BASE;
    const golden = st.drops + 1 === st.nextGolden;
    // тип выпал при переходе в spawning и до сброса не пересматривается (§4.3), «Расширитель» его не меняет
    st.hanging = { w: top.w, d: top.d, golden, special: golden ? null : st.upcoming };
    st.phase = 'hanging';
    // условие (§5.2): до события spawned — надпись и чип успевают к новому этажу
    if (hooks?.spawn) hooks.spawn(ctx);
    events.emit('spawned', { golden, special: st.hanging.special });
  }

  function step(dt, commands = NO_COMMANDS) {
    if (!(dt > 0) || (storm && st.phase === 'finished')) return;
    // по индексу: for…of создавал бы итератор на каждый шаг
    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      if (!c) continue;
      if (c.type === 'drop') doDrop();
      else if (c.type === 'bonus') useBonus(c.id);
    }
    st.time += dt;
    stepWind(dt);
    stepHook(dt);
    stepSway(dt);
    if (st.comboTimer > 0) st.comboTimer = Math.max(0, st.comboTimer - dt);
    if (st.phase === 'spawning') {
      st.spawnTimer -= dt;
      if (st.spawnTimer <= 0) spawn();
    } else if (st.phase === 'falling') {
      stepFalling(dt);
    }
    if (storm) stepLightning();
  }

  return {
    events, state: st, config: cfg,
    get lastMiss() { return lastMiss; },
    canFinishQuick,
    finishQuick() { if (canFinishQuick()) finish(true, true); },
    /** Доля предупреждения. Держится на единице, пока выпущенный груз не сядет. */
    get stormCharge() {
      if (strikeTime === Infinity || st.phase === 'finished') return 0;
      return clamp(1 - (strikeTime - st.time) / warningDuration, 0, 1);
    },
    step, topY, topOffset, floorOffset, effectivePeriod, canUseBonus, windAcc,
  };
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** Плавный переход для доли от 0 до 1. */
function smoothstep(v) {
  return v * v * (3 - 2 * v);
}
