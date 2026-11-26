// Своя башня (спецификация «Своя башня» §4–§5): посадка этажа, запись формы, метрики и прозвище, генератор
// правдоподобной башни, участок v2 и имя дома; спец-этажи (спецификация «Спец-этажи» §3–§5): расписание, расширение
// балкона, тип в записи формы. Чистый модуль ядра: без three, DOM, часов и Math.random.
import { W0, D0, MIN_SIZE, SIM, CITIES, BUILDING_TYPES, SPECIAL_TYPES, specialParams } from './levels.js';
import { createRng, hashSeed } from './rng.js';

/** Чисел на этаж в записи формы: x, z, w, d (сотые доли единицы) и флаги. */
export const SHAPE_STRIDE = 5;
/** Флаги этажа: бит 0 — золотой, бит 1 — идеальный сброс, биты 2–3 — код спец-этажа (индекс в SPECIAL_TYPES + 1). */
export const F_GOLDEN = 1;
export const F_PERFECT = 2;
export const F_SPECIAL_SHIFT = 2;
/** Ключи прозвищ в порядке правил (§5.2): побеждает первое подходящее. */
export const NICKS = ['gold', 'string', 'pisa', 'stairs', 'spire', 'zigzag', 'shorty', 'sturdy', 'wobbly'];
/** Пороги прозвищ (§5.2; план, отличие 3). */
export const NICK_RULES = {
  goldPerfect: 2, stringShare: 0.75, stringTaper: 0.75, pisaTilt: 1.0, stairsShare: 0.16, spireTaper: 0.2, zigzagShare: 0.24,
  sturdyTaper: 0.75, seriesMin: 3,
};
/**
 * Генератор (§4.6; план, отличие 4): «игрок» башни — доля идеальных skills (в среднем 0,45) и доля сдвигов в свою
 * сторону leans; узкий верх (сброс идеальный); сдвиги в долях ширины; доля сдвигов ещё и по z; предел центра.
 */
export const GEN = {
  skills: [0.25, 0.45, 0.65], leans: [0.5, 0.8], narrow: 1.2, smallFrom: 0.07, smallTo: 0.18, bigShare: 0.15, bigTo: 0.35,
  zShare: 0.5, center: 1,
};

const BASE = { x: 0, z: 0, w: W0, d: D0 };
/** Сдвиг центра этажа меньше этого — не сдвиг (лесенка и зигзаг). */
const STILL = 0.005;

/**
 * Посадка этажа (перенос из towerSim.resolveLanding, поведение то же). top — верхний этаж { x, z, w, d }, для
 * первого — основание { 0, 0, W0, D0 }; drop — падающий этаж { x, z, w, d, magnet, special, perfectMul? } в координатах
 * фундамента; combo — комбо до сброса. → { zone: 'perfect', x, z, w, d, dx, dz, combo, regrown },
 * { zone: 'hit', x, z, w, d, dx, dz, x0, x1, z0, z1, ow, od, combo: 0, regrown } или { zone: 'miss', dx, dz, combo: 0 }.
 * Балкон (спецификация «Спец-этажи» §4.1) расширяет perfect и hit на SPECIAL.balcony.regrow · W0 (· D0), не больше
 * W0 × D0; промах не спасает. ow, od — пересечение до расширения; regrown — этаж вырос от расширения.
 * Без балкона результат побитово прежний: ow и od — то же выражение, что w и d, regrown — false.
 * perfectMul («Башня дня» §5.2) — множитель окна идеального сброса; у магнита окно прежнее; без него (× 1) — побитово прежнее.
 */
export function landFloor(top, drop, combo = 0) {
  const dx = drop.x - top.x, dz = drop.z - top.z;
  const k = specialParams(drop.special)?.regrow ?? 0;
  const pf = drop.magnet ? SIM.magnetFrac : SIM.perfectFrac * (drop.perfectMul ?? 1);
  if (Math.abs(dx) <= pf * top.w && Math.abs(dz) <= pf * top.d) {
    const n = combo + 1;
    let w = drop.w, d = drop.d, regrown = false;
    if (n >= SIM.regrowCombo) {
      w = Math.min(W0, w + SIM.regrowFrac * W0);
      d = Math.min(D0, d + SIM.regrowFrac * D0);
    }
    if (k > 0) {
      const w1 = Math.min(W0, w + k * W0), d1 = Math.min(D0, d + k * D0);
      regrown = w1 - w > 1e-9 || d1 - d > 1e-9;
      w = w1; d = d1;
    }
    return { zone: 'perfect', x: top.x, z: top.z, w, d, dx, dz, combo: n, regrown };
  }
  let x0 = Math.max(top.x - top.w / 2, drop.x - drop.w / 2), x1 = Math.min(top.x + top.w / 2, drop.x + drop.w / 2);
  let z0 = Math.max(top.z - top.d / 2, drop.z - drop.d / 2), z1 = Math.min(top.z + top.d / 2, drop.z + drop.d / 2);
  if (!(x1 - x0 >= MIN_SIZE) || !(z1 - z0 >= MIN_SIZE)) return { zone: 'miss', dx, dz, combo: 0 };
  const ow = x1 - x0, od = z1 - z0;
  let regrown = false;
  if (k > 0) {
    [x0, x1] = grow(x0, x1, drop.x - drop.w / 2, drop.x + drop.w / 2, k * W0, W0);
    [z0, z1] = grow(z0, z1, drop.z - drop.d / 2, drop.z + drop.d / 2, k * D0, D0);
    regrown = x1 - x0 - ow > 1e-9 || z1 - z0 - od > 1e-9;
  }
  return { zone: 'hit', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, dx, dz, x0, x1, z0, z1, ow, od, combo: 0, regrown };
}

/**
 * Расширение балкона по одной оси (§4.1): [x0, x1] — пересечение, [a0, a1] — падающий этаж, add ≤ k и не шире max.
 * Срезов нет — прибавка поровну; иначе сначала в сторону большего среза, но не дальше края падающего этажа,
 * остаток — в другую сторону. → [x0', x1'].
 */
function grow(x0, x1, a0, a1, k, max) {
  const add = Math.max(0, Math.min(k, max - (x1 - x0)));
  const cl = x0 - a0, cr = a1 - x1;
  if (cl <= 1e-9 && cr <= 1e-9) return [x0 - add / 2, x1 + add / 2];
  if (cr >= cl) {
    const s = Math.min(add, cr);
    return [x0 - (add - s), x1 + s];
  }
  const s = Math.min(add, cl);
  return [x0 - s, x1 + (add - s)];
}

/**
 * Расписание спец-этажей (§3.2) на своём потоке rng ({ int, next }): первый — на сбросе first, следующий — через gap
 * сбросов (по умолчанию SIM.specialFirst и SIM.specialGap). pick вызывается ровно раз на сброс, по порядку с drop = 1
 * (промах — тоже сброс); index — этажей до сброса, top — верхний этаж { w, d } (для первого — основание), golden —
 * сброс золотой, last — последний этаж дома в городе. Этаж 0, золотой и последний переносят спец-этаж на следующий
 * сброс. next — номер ближайшего спец-сброса (план, отличие 2).
 * Гарантия типа («Башня дня» §4.4): type из SPECIAL_TYPES заменяет выпавший тип, но rng.next() тянется, как без
 * него, — моменты спец-этажей те же. retry ({ perfect }) — повтор: missed(drop, special) после промаха этажом type,
 * пока цель не выполнена, ставит next = drop + 1; landed(special, perfect) отмечает цель выполненной (при
 * retry.perfect — только идеальной посадкой). Без opts расписание побитово прежнее.
 */
export function createSpecialSchedule(rng, { first = SIM.specialFirst, gap = SIM.specialGap, type = null, retry = null } = {}) {
  const fixed = SPECIAL_TYPES.includes(type) ? type : null;
  const again = !!fixed && !!retry, perfectOnly = again && retry.perfect === true;
  let next = rng.int(...first), qualifying = 0;
  return {
    get next() { return next; },
    pick({ drop, index, top, golden, last }) {
      if (drop < next) return null;
      if (index === 0 || golden || last) { next = drop + 1; return null; }
      next = drop + rng.int(...gap);
      const t = specialFor(rng.next(), top);
      return fixed ?? t;
    },
    missed(drop, special) {
      if (again && !qualifying && special === fixed) next = drop + 1;
    },
    landed(special, perfect) {
      if (again && special === fixed && (!perfectOnly || perfect)) qualifying++;
    },
    // Уже выбранный груз на крюке — этот drop. true — потерян единственный этаж, выполнявший просьбу.
    removed(drop, special, perfect) {
      if (!again || special !== fixed || (perfectOnly && !perfect)) return false;
      if (--qualifying > 0) return false;
      next = drop + 1;
      return true;
    },
  };
}

/** Тип по ширине верха (§3.3): на полной ширине — оранжерея или лофт; на суженной — ещё и балкон. */
function specialFor(u, top) {
  const [atrium, loft, balcony] = SPECIAL_TYPES;
  const shrunk = top.w < W0 - 1e-6 || top.d < D0 - 1e-6;
  const strong = top.w < SIM.specialStrong * W0 || top.d < SIM.specialStrong * D0;
  if (!shrunk) return u < 0.5 ? atrium : loft;
  if (!strong) return u < 1 / 3 ? atrium : u < 2 / 3 ? loft : balcony;
  return u < 0.25 ? atrium : u < 0.5 ? loft : balcony;
}

const cent = (v) => Math.round(v * 100) || 0; // без -0

/**
 * Этажи { x, z, w, d, golden, zone, special? } → плоский массив целых: по SHAPE_STRIDE на этаж (§4.3). Код
 * спец-этажа («Спец-этажи» §5.1) — индекс в SPECIAL_TYPES + 1; у этажа 0, у золотого, без типа и у неизвестного — 0.
 */
export function encodeShape(floors) {
  const out = [];
  let i = 0;
  for (const f of floors || []) {
    const code = i++ > 0 && !f.golden ? SPECIAL_TYPES.indexOf(f.special) + 1 : 0;
    const flags = (f.golden ? F_GOLDEN : 0) | (f.zone === 'perfect' ? F_PERFECT : 0) | (code << F_SPECIAL_SHIFT);
    out.push(cent(f.x), cent(f.z), cent(f.w), cent(f.d), flags);
  }
  return out;
}

/**
 * Запись формы → этажи { x, z, w, d, golden, perfect, special } в единицах сцены. special — тип из битов 2–3;
 * null при коде 0, у золотого этажа (у золота приоритет) и у этажа 0.
 */
export function decodeShape(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i + SHAPE_STRIDE <= arr.length; i += SHAPE_STRIDE) {
    const f = arr[i + 4], code = (f >> F_SPECIAL_SHIFT) & 3;
    const special = code && i > 0 && !(f & F_GOLDEN) ? SPECIAL_TYPES[code - 1] : null;
    out.push({ x: arr[i] / 100, z: arr[i + 1] / 100, w: arr[i + 2] / 100, d: arr[i + 3] / 100, golden: !!(f & F_GOLDEN), perfect: !!(f & F_PERFECT), special });
  }
  return out;
}

/** Запись формы годится для дома из floors этажей (§4.4): длина, целые, пределы размеров, центра и флагов (0–15). */
export function validShape(arr, floors) {
  if (!Array.isArray(arr) || !(floors >= 1) || arr.length !== SHAPE_STRIDE * floors) return false;
  for (let i = 0; i < arr.length; i += SHAPE_STRIDE) {
    const x = arr[i], z = arr[i + 1], w = arr[i + 2], d = arr[i + 3], f = arr[i + 4];
    if (![x, z, w, d, f].every(Number.isInteger)) return false;
    if (Math.abs(x) > 1000 || Math.abs(z) > 1000 || w < 25 || w > 400 || d < 25 || d > 400 || f < 0 || f > 15) return false;
  }
  return true;
}

/** Направление сдвига центра: 0 — нет, иначе ±1 по x или ±2 по z (по большей составляющей). */
function shiftDir(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.hypot(dx, dz) < STILL) return 0;
  return Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 2 * Math.sign(dz);
}

/**
 * Метрики формы (§5.1): наклон — расстояние между центрами верхнего и нижнего этажей; сужение — площадь верхнего
 * к нижнему; доля идеальных; лесенка — самая длинная серия сдвигов центра в одну сторону; зигзаг — число смен
 * направления сдвига (сдвиги меньше STILL пропускаются); золотые и золотые идеальные; досрочно — этажей меньше target.
 */
export function shapeMetrics(shape, { target = 0 } = {}) {
  const fl = decodeShape(shape), n = fl.length;
  const m = { floors: n, tilt: 0, taper: 1, perfect: 0, perfectShare: 0, stairs: 0, zigzag: 0, golden: 0, goldenPerfect: 0, early: n < target };
  if (!n) return m;
  const a = fl[0], b = fl[n - 1];
  m.tilt = Math.hypot(b.x - a.x, b.z - a.z);
  m.taper = (b.w * b.d) / (a.w * a.d);
  for (const f of fl) {
    if (f.perfect) m.perfect++;
    if (f.golden) { m.golden++; if (f.perfect) m.goldenPerfect++; }
  }
  m.perfectShare = m.perfect / n;
  let prev = 0, run = 0;
  for (let i = 1; i < n; i++) {
    const dir = shiftDir(fl[i - 1], fl[i]);
    if (!dir) continue;
    if (dir === prev) run++;
    else { if (prev) m.zigzag++; run = 1; prev = dir; }
    m.stairs = Math.max(m.stairs, run);
  }
  return m;
}

/** Ключ прозвища по форме (§5.2; пороги — NICK_RULES). target — этажей у типа здания. */
export function nicknameFor(shape, { target = 0 } = {}) {
  const m = shapeMetrics(shape, { target }), R = NICK_RULES;
  const series = (share) => Math.max(R.seriesMin, Math.round(m.floors * share));
  if (m.goldenPerfect >= R.goldPerfect && m.goldenPerfect === m.golden) return 'gold';
  if (m.perfectShare >= R.stringShare && m.taper >= R.stringTaper) return 'string';
  if (m.tilt >= R.pisaTilt) return 'pisa';
  if (m.stairs >= series(R.stairsShare)) return 'stairs';
  if (m.taper <= R.spireTaper) return 'spire';
  if (m.zigzag >= series(R.zigzagShare)) return 'zigzag';
  if (m.early) return 'shorty';
  if (m.taper >= R.sturdyTaper) return 'sturdy';
  return 'wobbly';
}

/**
 * Сдвиг сброса от центра верхнего этажа: доля from…to его стороны side; в сторону dir с вероятностью lean;
 * центр нового этажа (c + v / 2) не дальше GEN.center — иначе сдвиг в другую сторону.
 */
function offset(rng, c, side, from, to, dir, lean) {
  let v = rng.uniform(from, to) * side * (rng.next() < lean ? dir : -dir);
  if (Math.abs(c + v / 2) > GEN.center) v = -v;
  return v;
}

/**
 * Правдоподобная башня для дома без формы (§4.6): floors «сбросов» через landFloor, детерминированно по городу,
 * типу, числу этажей и seed (индекс участка). Около 45 % идеальных; иначе сдвиг по x (у 85 % — 0,07–0,18 ширины,
 * у остальных до 0,35), по z — только в городах с эллипсом; сброс на верх уже GEN.narrow — идеальный (без «игл»);
 * золотые — каждые 7 ± 2 сброса; центр этажа не дальше ±1. Спец-этажи («Спец-этажи» §5.3) — своё расписание на
 * своём потоке; балкон, ушедший центром за GEN.center, отражает сдвиг (план, отличие 3). → { shape, best, miss }.
 */
export function plausibleTower({ type, floors, cityId, seed = 0 }) {
  const ellipse = !!CITIES.find((c) => c.id === cityId)?.ellipse;
  const target = BUILDING_TYPES[type]?.floors ?? floors;
  const rng = createRng(hashSeed('plausible', cityId, type, floors, seed));
  const specials = createSpecialSchedule(createRng(hashSeed('plausibleSpecial', cityId, type, floors, seed)));
  const skill = rng.pick(GEN.skills), lean = rng.pick(GEN.leans);
  const dirX = rng.next() < 0.5 ? -1 : 1, dirZ = rng.next() < 0.5 ? -1 : 1;
  const out = [];
  let top = BASE, combo = 0, best = 0;
  let nextGolden = SIM.goldenEvery + rng.int(-SIM.goldenJitter, SIM.goldenJitter);
  for (let drop = 1; out.length < floors; drop++) {
    const golden = drop === nextGolden;
    if (golden) nextGolden += SIM.goldenEvery + rng.int(-SIM.goldenJitter, SIM.goldenJitter);
    const special = specials.pick({ drop, index: out.length, top, golden, last: out.length === target - 1 });
    let x = top.x, z = top.z;
    if (Math.min(top.w, top.d) >= GEN.narrow && rng.next() >= skill) {
      const big = rng.next() < GEN.bigShare;
      x += offset(rng, top.x, top.w, big ? GEN.smallTo : GEN.smallFrom, big ? GEN.bigTo : GEN.smallTo, dirX, lean);
      if (ellipse && rng.next() < GEN.zShare) z += offset(rng, top.z, top.d, GEN.smallFrom, GEN.smallTo, dirZ, lean);
    }
    let r = landFloor(top, { x, z, w: top.w, d: top.d, special }, combo);
    if (special === 'balcony' && r.zone === 'hit' && (Math.abs(r.x) > GEN.center || Math.abs(r.z) > GEN.center)) {
      if (Math.abs(r.x) > GEN.center) x = 2 * top.x - x;
      if (Math.abs(r.z) > GEN.center) z = 2 * top.z - z;
      r = landFloor(top, { x, z, w: top.w, d: top.d, special }, combo);
    }
    combo = r.combo;
    best = Math.max(best, combo);
    top = { x: r.x, z: r.z, w: r.w, d: r.d };
    out.push({ ...top, golden, zone: r.zone, special });
  }
  const miss = floors < target ? SIM.misses : rng.int(0, 2);
  return { shape: encodeShape(out), best, miss };
}

/** Наибольшая длина имени дома в кодовых точках (§5.3). */
export const NAME_MAX = 24;
/** Наибольшая длина подписи вызова в кодовых точках («Башня дня» §7.4). */
export const SIGNATURE_MAX = 16;
/** Наибольший промах в записи участка: три и «Каска». */
export const MISS_MAX = SIM.misses + 1;

// Управляющие символы, символы направления текста и нулевой ширины (§5.3).
const NAME_DROP = /[\p{Cc}\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060\uFEFF]/gu;

/**
 * Имя дома от игрока (§5.3): табуляции и переводы строк — пробел; без управляющих символов, символов направления
 * текста и нулевой ширины; NFC; пробелы схлопнуты и обрезаны; не длиннее max кодовых точек (по умолчанию NAME_MAX).
 * Не строка — ''.
 */
export function cleanHouseName(s, max = NAME_MAX) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/[\t\n\r]/g, ' ').replace(NAME_DROP, '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, max).join('').trimEnd();
}

/** Подпись вызова («Башня дня» §7.4; план, отличие 2): правила имени дома, не длиннее SIGNATURE_MAX. Пустая — нет подписи. */
export const cleanSignature = (s) => cleanHouseName(s, SIGNATURE_MAX);

const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);
const targetOf = (type, floors) => BUILDING_TYPES[type]?.floors ?? floors;

/** В шторме лучшая сыгранная серия может на один превысить итоговую высоту: молния сняла верх,
 * а оставшиеся сбросы закончились промахами. По достижении цели стройка завершается до удара. */
export function cleanBestCombo(type, floors, best, miss) {
  if (best === floors + 1 && best < targetOf(type, floors) && (miss === SIM.misses || miss === MISS_MAX)) return best;
  return clampInt(best, 0, floors);
}

/** Участок v2 (§4.3) из записи формы: прозвище по форме, имя пустое. */
function plotV2({ type, pop, floors }, shape, best, miss, at) {
  const nick = nicknameFor(shape, { target: targetOf(type, floors) });
  return { type, pop, floors, shape, best: cleanBestCombo(type, floors, best, miss), miss: clampInt(miss, 0, MISS_MAX), at, nick, name: '' };
}

/**
 * Участок v2 дома без формы (§4.5): правдоподобная башня по городу, типу, этажам и индексу участка; at — время
 * миграции или постройки. city — описание города или его id.
 */
export function legacyPlot(city, index, { type, pop, floors }, now) {
  const cityId = typeof city === 'string' ? city : city.id;
  const t = plausibleTower({ type, floors, cityId, seed: index });
  return plotV2({ type, pop, floors }, t.shape, t.best, t.miss, now);
}

/**
 * Участок v2 сыгранной башни (§4.2): shape — этажи { x, z, w, d, golden, zone } из towerSim.finished; best и miss
 * ограничиваются; at — время постройки (нет — 0, sanitize при загрузке поставит время загрузки).
 * Форма не той длины или вне пределов — null.
 */
export function makePlot({ type, pop, floors, shape, best, miss, at }) {
  if (!Array.isArray(shape)) return null;
  // Каждый этаж, и пустая позиция тоже, — объект с конечными числами x, z, w, d: encodeShape не проверяет элементы.
  if (!Array.from(shape).every((f) => f !== null && typeof f === 'object' && [f.x, f.z, f.w, f.d].every((v) => typeof v === 'number' && Number.isFinite(v)))) return null;
  const enc = encodeShape(shape);
  if (!validShape(enc, floors)) return null;
  return plotV2({ type, pop, floors }, enc, best, miss, typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : 0);
}

/**
 * Числа паспорта (§7): этажи и цель типа, идеальные, золотые, лучшее комбо, промахи и силуэт — полосы этажей снизу
 * вверх, left и width в процентах общей ширины. Без годной формы — null (паспорт показывает только этажи и жителей).
 */
export function houseStats(plot) {
  if (!plot || !validShape(plot.shape, plot.floors)) return null;
  const fl = decodeShape(plot.shape);
  let lo = Infinity, hi = -Infinity, perfect = 0, golden = 0;
  for (const f of fl) {
    lo = Math.min(lo, f.x - f.w / 2);
    hi = Math.max(hi, f.x + f.w / 2);
    if (f.perfect) perfect++;
    if (f.golden) golden++;
  }
  const span = hi - lo;
  return {
    floors: fl.length, target: targetOf(plot.type, fl.length), perfect, golden,
    best: cleanBestCombo(plot.type, fl.length, plot.best, plot.miss), miss: clampInt(plot.miss, 0, MISS_MAX),
    bars: fl.map((f) => ({ left: ((f.x - f.w / 2 - lo) / span) * 100, width: (f.w / span) * 100, golden: f.golden })),
  };
}
