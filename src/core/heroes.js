// Герои городов (спецификация «Герои городов» §3–§6): данные 15 героев, условия просьб, состояние в сохранении,
// правила цепочки и ежедневных просьб. Чистый модуль ядра: без three, DOM, часов и Math.random — сутки приходят
// параметром. progress.js не импортируется (он импортирует этот модуль): участки города читаются здесь же.
import { BUILDING_TYPES, TYPE_ORDER, SPECIAL_TYPES } from './levels.js';
import { neighbors, blockedKind, plotAt, inGrid, canPlace, cityPopulation } from './cityRules.js';
import { NICKS, MISS_MAX, houseStats, decodeShape } from './towerShape.js';
import { createRng, hashSeed } from './rng.js';

/** Просьб в цепочке, украшений у героя, украшений за сердечки, сердечек на украшение, предел сердечек (§3, §5.1). */
export const CHAIN_LEN = 5;
export const DECOR_LEN = 8;
export const EXTRA_DECOR = 3;
export const HEARTS_PER_DECOR = 3;
export const HEARTS_MAX = 1e6;
/**
 * Поля условия просьбы в каноническом порядке (§4.2): в нём идут части проверки и ключи очищенного условия.
 * special и specialPerfect — спец-этаж в доме («Башня дня» §4.1), дописаны в конец.
 */
export const REQ_FIELDS = ['type', 'near', 'at', 'floors', 'full', 'nick', 'perfect', 'combo', 'golden', 'misses', 'special', 'specialPerfect'];
export const NATURE = ['park', 'lake', 'pier', 'hill'];
export const PLACES = ['edge', 'corner', 'center'];
/** Украшения для крыши и для земли (§6.3). */
export const ROOF_DECOR = ['flag', 'vane', 'neon', 'telescope'];
export const GROUND_DECOR = ['mailbox', 'bench', 'flowerbed', 'lantern', 'pottedTree', 'parasol', 'birdhouse', 'crates', 'barrel',
  'snowman', 'pumpkins', 'lifebuoy', 'easel', 'skis'];
/** Шаблоны ежедневных просьб; в этом же порядке записаны веса вкусов героя (§4.4, §6.1; «Башня дня» §4.5). */
export const TEMPLATES = ['place', 'shape', 'mastery', 'tall', 'special'];
/** Наибольшее число в условиях мастерства — этажей у небоскрёба. */
const STAT_MAX = 25;

const hero = (id, city, order, species, variant, fem, tastes, fav, chain, decor) => Object.freeze({
  id, city, order, species, variant, fem,
  tastes: Object.freeze(Object.fromEntries(TEMPLATES.map((k, i) => [k, tastes[i]]))),
  fav, // любимый тип спец-этажа — шаблон special («Башня дня» §4.5)
  chain: Object.freeze(chain.map((r) => Object.freeze(r))),
  decor: Object.freeze(decor),
});

/** 18 героев (§6.1–§6.3; «Башня дня» §4.5–§4.6); условия цепочек записаны в порядке REQ_FIELDS. */
export const HEROES = Object.freeze([
  hero('ponchik', 'valley', 1, 0, 0, false, [3, 1, 1, 1, 1], 'loft',
    [{ type: 'house', at: 'center' }, { type: 'shop', near: 'home' }, { nick: 'sturdy' }, { combo: 4 }, { type: 'house', full: true, golden: 1 }],
    ['mailbox', 'crates', 'flag', 'parasol', 'bench', 'flowerbed', 'lantern', 'pottedTree']),
  hero('morkovkina', 'valley', 2, 5, 0, true, [2, 2, 1, 0, 3], 'atrium',
    [{ type: 'house', at: 'corner' }, { type: 'house', at: 'edge', floors: 8 }, { nick: 'stairs' }, { special: 'atrium' }, { type: 'shop', near: 'home', perfect: 6 }],
    ['mailbox', 'flowerbed', 'birdhouse', 'vane', 'flowerbed', 'barrel', 'bench', 'pottedTree']),
  hero('tim', 'valley', 3, 3, 1, false, [1, 1, 2, 2, 1], 'balcony',
    [{ type: 'shop', at: 'edge' }, { type: 'shop', full: true }, { nick: 'spire' }, { perfect: 8 }, { near: 'home:morkovkina', combo: 5 }],
    ['mailbox', 'flag', 'crates', 'bench', 'lantern', 'birdhouse', 'pottedTree', 'parasol']),
  hero('plavnik', 'harbor', 1, 6, 0, false, [3, 1, 1, 1, 2], 'balcony',
    [{ type: 'house', near: 'pier' }, { type: 'office', near: 'pier' }, { special: 'balcony' }, { floors: 10, misses: 0 }, { type: 'house', near: 'home', full: true }],
    ['mailbox', 'lifebuoy', 'barrel', 'flag', 'crates', 'bench', 'lantern', 'pottedTree']),
  hero('rakushka', 'harbor', 2, 4, 1, true, [2, 2, 2, 0, 2], 'atrium',
    [{ type: 'shop', near: 'park' }, { type: 'house', near: 'pier' }, { nick: 'stairs' }, { combo: 6 }, { type: 'shop', full: true }],
    ['mailbox', 'parasol', 'flowerbed', 'flag', 'bench', 'crates', 'lantern', 'lifebuoy']),
  hero('fonarik', 'harbor', 3, 7, 1, false, [1, 2, 1, 3, 2], 'loft',
    [{ type: 'office', at: 'edge', floors: 15 }, { nick: 'spire' }, { perfect: 10 }, { type: 'office', near: 'home:plavnik' }, { type: 'office', full: true, golden: 2 }],
    ['mailbox', 'lantern', 'lifebuoy', 'telescope', 'barrel', 'bench', 'crates', 'lantern']),
  hero('bambuk', 'autumn', 1, 0, 1, false, [1, 3, 1, 1, 1], 'balcony',
    [{ type: 'office', near: 'park' }, { nick: 'pisa' }, { nick: 'zigzag' }, { type: 'tower', floors: 20 }, { nick: 'gold' }],
    ['mailbox', 'easel', 'vane', 'pumpkins', 'bench', 'lantern', 'pottedTree', 'flowerbed']),
  hero('tykvina', 'autumn', 2, 2, 2, true, [2, 2, 1, 1, 2], 'atrium',
    [{ type: 'house', near: 'hill' }, { type: 'shop', near: 'home' }, { nick: 'sturdy' }, { type: 'shop', perfect: 7 }, { type: 'tower', near: 'park' }],
    ['mailbox', 'pumpkins', 'barrel', 'flag', 'crates', 'bench', 'pumpkins', 'lantern']),
  hero('listik', 'autumn', 3, 1, 1, false, [1, 3, 2, 0, 2], 'loft',
    [{ type: 'shop', at: 'corner' }, { golden: 2 }, { special: 'loft', specialPerfect: true }, { combo: 7 }, { type: 'tower', full: true }],
    ['mailbox', 'easel', 'flowerbed', 'flag', 'bench', 'pumpkins', 'lantern', 'birdhouse']),
  hero('snezhok', 'snow', 1, 3, 3, false, [1, 0, 3, 2, 1], 'balcony',
    [{ type: 'house', near: 'hill' }, { misses: 0 }, { type: 'shop', near: 'lake' }, { combo: 6 }, { type: 'tower', floors: 20, misses: 1 }],
    ['mailbox', 'skis', 'snowman', 'flag', 'lantern', 'bench', 'skis', 'snowman']),
  hero('pelmen', 'snow', 2, 0, 2, false, [3, 1, 1, 1, 2], 'loft',
    [{ type: 'shop', near: 'lake' }, { type: 'house', near: 'home' }, { special: 'loft' }, { perfect: 8 }, { type: 'office', near: 'park' }],
    ['mailbox', 'bench', 'lantern', 'vane', 'barrel', 'snowman', 'crates', 'pottedTree']),
  hero('aisberg', 'snow', 3, 6, 2, false, [2, 1, 2, 1, 1], 'balcony',
    [{ type: 'office', near: 'lake' }, { nick: 'string' }, { golden: 2 }, { type: 'office', full: true }, { type: 'tower', near: 'lake' }],
    ['mailbox', 'lifebuoy', 'snowman', 'flag', 'barrel', 'bench', 'lantern', 'skis']),
  hero('neonych', 'night', 1, 7, 3, false, [1, 1, 3, 2, 2], 'loft',
    [{ type: 'tower', at: 'center' }, { combo: 8 }, { nick: 'zigzag' }, { golden: 3 }, { type: 'tower', full: true, combo: 6 }],
    ['mailbox', 'lantern', 'neon', 'crates', 'bench', 'lantern', 'barrel', 'parasol']),
  hero('luna', 'night', 2, 2, 3, true, [1, 2, 1, 3, 2], 'balcony',
    [{ type: 'house', near: 'lake' }, { special: 'balcony' }, { type: 'office', at: 'edge', floors: 18 }, { perfect: 12 }, { type: 'tower', near: 'home' }],
    ['mailbox', 'telescope', 'lantern', 'flowerbed', 'bench', 'birdhouse', 'lantern', 'pottedTree']),
  hero('sonya', 'night', 3, 0, 3, true, [2, 2, 2, 0, 2], 'atrium',
    [{ type: 'house', near: 'park' }, { nick: 'sturdy' }, { misses: 0 }, { type: 'shop', near: 'home' }, { nick: 'gold' }],
    ['mailbox', 'bench', 'lantern', 'vane', 'flowerbed', 'pottedTree', 'birdhouse', 'lantern']),
  // «Сладкий город» — сложнее «Ночного»: combo и perfect выше, небоскрёбы в просьбах
  hero('izumchik', 'sweet', 1, 1, 4, false, [3, 1, 2, 1, 1], 'loft',
    [{ type: 'house', at: 'center' }, { type: 'shop', near: 'home' }, { nick: 'sturdy' }, { perfect: 11 }, { type: 'tower', full: true, combo: 7 }],
    ['mailbox', 'crates', 'flag', 'bench', 'flowerbed', 'lantern', 'barrel', 'pottedTree']),
  hero('vatrushka', 'sweet', 2, 5, 4, true, [2, 2, 1, 3, 2], 'balcony',
    [{ type: 'house', near: 'lake' }, { type: 'office', near: 'lake', floors: 15 }, { special: 'balcony', specialPerfect: true }, { combo: 9 }, { type: 'tower', near: 'lake', misses: 1 }],
    ['mailbox', 'flowerbed', 'parasol', 'vane', 'birdhouse', 'bench', 'pottedTree', 'lantern']),
  hero('sakharok', 'sweet', 3, 7, 4, false, [1, 1, 2, 3, 2], 'atrium',
    [{ type: 'office', near: 'hill' }, { golden: 3 }, { type: 'tower', floors: 22 }, { perfect: 14 }, { nick: 'gold' }],
    ['mailbox', 'lantern', 'telescope', 'crates', 'bench', 'barrel', 'birdhouse', 'pottedTree']),
]);

const BY_ID = new Map(HEROES.map((h) => [h.id, h]));
const BY_CITY = new Map();
for (const h of HEROES) BY_CITY.set(h.city, [...(BY_CITY.get(h.city) ?? []), h]);
for (const [id, list] of BY_CITY) BY_CITY.set(id, Object.freeze(list.sort((a, b) => a.order - b.order)));
const NONE = Object.freeze([]);

/** Герои города по порядку приезда. */
export function heroesOf(cityId) {
  return BY_CITY.get(cityId) ?? NONE;
}

export function heroById(id) {
  return BY_ID.get(id) ?? null;
}

/** Приехавшие герои (§3.1): герой N — при N звёздах города. */
export function arrived(save, cityDef) {
  const stars = save?.cities?.[cityDef.id]?.stars | 0;
  return heroesOf(cityDef.id).filter((h) => h.order <= stars);
}

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const has = (o, k) => isObj(o) && Object.hasOwn(o, k);
/** Дом героя id из словаря домов { heroId: { x, y } } (ключи прототипа — не дома). */
export const homeAt = (homes, id) => (has(homes, id) ? homes[id] : null);
export const maxFloors = (cityDef) => Math.max(...cityDef.types.map((t) => BUILDING_TYPES[t].floors));
/** Виды природы, которые есть в городе (§6.2). */
export const natureOf = (cityDef) => NATURE.filter((k) => cityDef.blocked.some((b) => (b[2] || 'park') === k));

function nearValid(v, cityDef, heroId) {
  if (typeof v !== 'string') return false;
  if (NATURE.includes(v)) return natureOf(cityDef).includes(v);
  if (TYPE_ORDER.includes(v)) return cityDef.types.includes(v);
  if (v === 'home') return true;
  if (!v.startsWith('home:')) return false;
  const other = heroById(v.slice(5)), self = heroId ? heroById(heroId) : null;
  return !!other && other.city === cityDef.id && (!self || other.order < self.order);
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Белый список условия (§4.2): поля — в порядке REQ_FIELDS, неизвестные отброшены. Значение вне списка или пустое
 * условие → null. near 'home:<id>' — герой этого города; если задан heroId — только приехавший раньше него.
 * special — тип из SPECIAL_TYPES; specialPerfect — только true и только с годным special в том же условии («Башня дня» §4.1).
 */
export function cleanRequest(req, cityDef, heroId = null) {
  if (!isObj(req)) return null;
  const out = {};
  for (const key of REQ_FIELDS) {
    if (!Object.hasOwn(req, key)) continue;
    const v = req[key];
    let ok = false;
    if (key === 'type') ok = cityDef.types.includes(v);
    else if (key === 'near') ok = nearValid(v, cityDef, heroId);
    else if (key === 'at') ok = PLACES.includes(v);
    else if (key === 'floors') ok = isInt(v, 1, maxFloors(cityDef));
    else if (key === 'full') ok = v === true;
    else if (key === 'nick') ok = NICKS.includes(v);
    else if (key === 'misses') ok = isInt(v, 0, MISS_MAX);
    else if (key === 'special') ok = SPECIAL_TYPES.includes(v);
    else if (key === 'specialPerfect') ok = v === true && Object.hasOwn(req, 'special') && SPECIAL_TYPES.includes(req.special);
    else ok = isInt(v, 1, STAT_MAX); // perfect, combo, golden
    if (!ok) return null;
    out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Место участка (§4.2): край — x или y на границе сетки, угол — оба, центр — ни один. */
export function atOk(at, cityDef, x, y) {
  const last = cityDef.size - 1;
  const ex = x === 0 || x === last, ey = y === 0 || y === last;
  return at === 'edge' ? ex || ey : at === 'corner' ? ex && ey : !ex && !ey;
}

/** Сосед по стороне (§4.2): природа этого вида, участок этого типа, свой дом героя или дом героя <id>. */
export function nearOk(near, { cityDef, cs, x, y, homes, heroId }) {
  const around = neighbors(cityDef, x, y);
  if (near === 'home' || near.startsWith('home:')) {
    const h = homeAt(homes, near === 'home' ? heroId : near.slice(5));
    return !!h && around.some((n) => n.x === h.x && n.y === h.y);
  }
  return around.some((n) => blockedKind(cityDef, n.x, n.y) === near || plotAt(cs, n.x, n.y)?.type === near);
}

/** Числовые условия (§4.2) и поле статистики стройки { floors, perfect, best, golden, misses }, с которым они сравниваются. */
const STAT_OF = { floors: 'floors', perfect: 'perfect', combo: 'best', golden: 'golden', misses: 'misses' };

/**
 * Единое правило числовых условий — его делят проверка готового участка и прогресс HUD: floors, perfect, combo, golden —
 * «не меньше» (have ≥ need), misses — «не больше» (have ≤ need). stats === null (участок без формы) условие не
 * выполняет: have = 0, ok = false.
 */
function numericPart(key, need, stats) {
  const have = stats ? stats[STAT_OF[key]] : 0;
  const ok = !!stats && (key === 'misses' ? have <= need : have >= need);
  return { key, ok, have, need };
}

/**
 * Спец-этажи по типам («Башня дня» §4.2, §4.3): всего и идеальных. floors — этажи decodeShape ({ special, perfect })
 * или этажи симуляции ({ special, zone }); неизвестные типы и пустые элементы пропускаются.
 */
export function specialCounts(floors) {
  const special = { atrium: 0, loft: 0, balcony: 0 }, specialPerfect = { atrium: 0, loft: 0, balcony: 0 };
  for (const f of Array.isArray(floors) ? floors : []) {
    const t = f?.special;
    if (!SPECIAL_TYPES.includes(t)) continue;
    special[t]++;
    if (f.perfect === true || f.zone === 'perfect') specialPerfect[t]++;
  }
  return { special, specialPerfect };
}

/** Часть special (§4.2): have — этажей типа need (при perfect — идеальных) по картам counts { atrium, … }; need — 1. */
function specialPart(need, perfect, counts) {
  const m = counts && (perfect ? counts.specialPerfect : counts.special);
  const have = isObj(m) && Object.hasOwn(m, need) ? m[need] | 0 : 0;
  return { key: 'special', ok: have >= 1, have, need: 1 };
}

/**
 * Проверка готового участка (§4.2). ctx = { cityDef, cs, x, y, plot, homes, heroId }: plot — участок после установки,
 * homes — дома героев города. → { ok, parts } — части в порядке REQ_FIELDS; have / need — числа прогресса или null.
 * Участок без формы (houseStats → null) просьбу не выполняет. special — по записи формы: этажи типа, при
 * specialPerfect — идеальные («Башня дня» §4.2); ключ specialPerfect своей части не даёт.
 */
export function check(req, ctx) {
  const { cityDef, x, y, plot } = ctx;
  const st = houseStats(plot);
  const stats = st && { floors: st.floors, perfect: st.perfect, best: st.best, golden: st.golden, misses: st.miss };
  const parts = [];
  const add = (key, ok, have = null, need = null) => parts.push({ key, ok, have, need });
  for (const key of REQ_FIELDS) {
    if (!Object.hasOwn(req, key) || key === 'specialPerfect') continue;
    const need = req[key];
    if (key === 'type') add(key, plot?.type === need);
    else if (key === 'near') add(key, nearOk(need, ctx));
    else if (key === 'at') add(key, atOk(need, cityDef, x, y));
    else if (key === 'full') {
      const target = BUILDING_TYPES[plot?.type]?.floors ?? 0;
      add(key, !!st && st.floors === target, st?.floors ?? 0, target);
    } else if (key === 'nick') add(key, !!st && plot.nick === need);
    else if (key === 'special') parts.push(specialPart(need, req.specialPerfect === true, st && specialCounts(decodeShape(plot.shape))));
    else parts.push(numericPart(key, need, stats));
  }
  return { ok: !!st && parts.every((p) => p.ok), parts };
}

/**
 * Прогресс стройки для HUD (§8.3): части условия без типа и места. live = { floors, perfect, best, misses, golden,
 * target } — статистика текущей стройки, target — этажей у типа. У прозвища прогресса нет: ok = null.
 * live.special и live.specialPerfect — карты liveStats; без них часть special не выполнена.
 */
export function liveProgress(req, live) {
  const parts = [];
  const add = (key, ok, have, need) => parts.push({ key, ok, have, need });
  for (const key of REQ_FIELDS) {
    if (!Object.hasOwn(req, key) || key === 'type' || key === 'near' || key === 'at' || key === 'specialPerfect') continue;
    const need = req[key];
    if (key === 'full') add(key, live.floors >= live.target, live.floors, live.target);
    else if (key === 'nick') add(key, null, null, need);
    else if (key === 'special') parts.push(specialPart(need, req.specialPerfect === true, live));
    else parts.push(numericPart(key, need, live));
  }
  return parts;
}

/** Открытых украшений (§5.1): по одному за шаг цепочки, после неё — по одному за HEARTS_PER_DECOR сердечек. */
export function decorCount(step, hearts) {
  if (!(step >= CHAIN_LEN)) return Math.max(0, step | 0);
  return CHAIN_LEN + Math.min(EXTRA_DECOR, Math.floor(Math.max(0, hearts) / HEARTS_PER_DECOR));
}

/** Местные календарные сутки (§4.1): tzOffsetMin — Date.getTimezoneOffset() (UTC+3 → −180). Нет часов — NaN. */
export function localDay(ms, tzOffsetMin) {
  return Math.floor((ms - tzOffsetMin * 60000) / 86400000);
}

/** Запись героя по умолчанию (§5.1): home — индекс участка y·size + x или −1. */
export function defaultHeroState() {
  return { met: false, step: 0, home: -1, hearts: 0, daily: null };
}

/** Записи трёх героев города по умолчанию — по порядку. */
export function defaultHeroes(cityId) {
  const out = {};
  for (const h of heroesOf(cityId)) out[h.id] = defaultHeroState();
  return out;
}

const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);

/**
 * Очистка записей героев города (§5.2; план, отличие 7). plots — очищенные участки города. Неизвестные герои
 * отбрасываются, недостающие — по умолчанию. home — только после шага 1, на застроенном участке, не занятом героем
 * выше по порядку (природа и пустые клетки после очистки участков — null). daily — только при step 5, целом day
 * и годном req; done и met — только true.
 */
export function cleanHeroes(raw, cityDef, plots) {
  const out = defaultHeroes(cityDef.id);
  if (!isObj(raw)) return out;
  const used = new Set();
  for (const h of heroesOf(cityDef.id)) {
    if (!has(raw, h.id) || !isObj(raw[h.id])) continue;
    const r = raw[h.id], d = out[h.id];
    d.met = r.met === true;
    d.step = clampInt(r.step, 0, CHAIN_LEN);
    d.hearts = clampInt(r.hearts, 0, HEARTS_MAX);
    const home = r.home;
    if (d.step >= 1 && Number.isInteger(home) && home >= 0 && home < plots.length && plots[home] && !used.has(home)) {
      d.home = home;
      used.add(home);
    }
    if (d.step === CHAIN_LEN && isObj(r.daily) && Number.isInteger(r.daily.day)) {
      const req = cleanRequest(r.daily.req, cityDef, h.id);
      if (req) d.daily = { day: r.daily.day, req, done: r.daily.done === true };
    }
  }
  return out;
}

const FROZEN_HERO = Object.freeze(defaultHeroState());
const xyOf = (cityDef, i) => ({ x: i % cityDef.size, y: Math.floor(i / cityDef.size) });

/** Участки города из сохранения — только чтение; испорченная запись — пустой город. */
function cityOf(save, cityDef) {
  const n = cityDef.size * cityDef.size, plots = save?.cities?.[cityDef.id]?.plots;
  return { size: cityDef.size, plots: Array.isArray(plots) && plots.length === n ? plots : new Array(n).fill(null) };
}

/** Запись героя без изменения сохранения: нет записи — замороженное умолчание. */
export function readHero(save, cityDef, heroId) {
  const rec = save?.cities?.[cityDef.id]?.heroes;
  return has(rec, heroId) && isObj(rec[heroId]) ? rec[heroId] : FROZEN_HERO;
}

/**
 * Запись героя для изменения (§4.1): недостающая создаётся по умолчанию. Только для героя этого города: чужой или
 * неизвестный id (в том числе '__proto__', который присваиванием сменил бы прототип словаря) — ошибка вызывающего.
 */
export function heroState(save, cityDef, heroId) {
  if (heroById(heroId)?.city !== cityDef.id) throw new Error(`heroState: ${String(heroId)} is not a hero of ${cityDef.id}`);
  const c = save.cities[cityDef.id];
  if (!isObj(c.heroes)) c.heroes = {};
  if (!has(c.heroes, heroId) || !isObj(c.heroes[heroId])) c.heroes[heroId] = defaultHeroState();
  return c.heroes[heroId];
}

/** Знакомство показано (§3.1). → true, если запись изменилась. */
export function markMet(save, cityDef, heroId) {
  if (heroById(heroId)?.city !== cityDef.id || readHero(save, cityDef, heroId).met) return false;
  heroState(save, cityDef, heroId).met = true;
  return true;
}

/** Индекс дома героя или −1 (§3.6): дом есть только после шага 1 и только на застроенном участке. */
function homeIndex(cs, st) {
  const i = st.home;
  return st.step >= 1 && Number.isInteger(i) && i >= 0 && i < cs.plots.length && cs.plots[i] ? i : -1;
}

/** Дома героев города: { heroId: { x, y } } — ctx.homes условий (§4.1). */
export function homesOf(save, cityDef) {
  const cs = cityOf(save, cityDef), out = {};
  for (const h of heroesOf(cityDef.id)) {
    const i = homeIndex(cs, readHero(save, cityDef, h.id));
    if (i >= 0) out[h.id] = xyOf(cityDef, i);
  }
  return out;
}

const ownerAt = (homes, x, y) => Object.keys(homes).find((id) => homes[id].x === x && homes[id].y === y) ?? null;

/** Кто из героев живёт на участке (§8.2), или null. */
export function residentOf(save, cityDef, x, y) {
  return ownerAt(homesOf(save, cityDef), x, y);
}

/**
 * Активная просьба приехавшего героя (§3.2, §3.3, §3.6): бездомный — «дом» (условие шага 1, step 0), иначе шаг
 * цепочки, после неё — невыполненная ежедневная. → { kind: 'home' | 'chain' | 'daily', step, req } или null.
 */
export function activeRequest(save, cityDef, heroId) {
  const h = heroById(heroId);
  if (!h || h.city !== cityDef.id || h.order > (save?.cities?.[cityDef.id]?.stars | 0)) return null;
  const st = readHero(save, cityDef, heroId);
  if (homeIndex(cityOf(save, cityDef), st) < 0) return { kind: 'home', step: 0, req: h.chain[0] };
  if (st.step < CHAIN_LEN) return { kind: 'chain', step: st.step, req: h.chain[st.step] };
  if (isObj(st.daily) && !st.daily.done && isObj(st.daily.req)) return { kind: 'daily', step: CHAIN_LEN, req: st.daily.req };
  return null;
}

/** Активные просьбы приехавших героев: { heroId: activeRequest } — снимок до стройки (§4.3). */
export function activeRequests(save, cityDef) {
  const out = {};
  for (const h of arrived(save, cityDef)) {
    const a = activeRequest(save, cityDef, h.id);
    if (a) out[h.id] = a;
  }
  return out;
}

/** Место просьбы на участке (§4.5): в сетке, не природа, near и at выполнены; для «дома» — не дом другого героя. */
export function placeOk(req, cityDef, cs, x, y, { heroId = null, homes = null, home = false } = {}) {
  if (!inGrid(cityDef, x, y) || blockedKind(cityDef, x, y)) return false;
  if (home && isObj(homes)) {
    const owner = ownerAt(homes, x, y);
    if (owner && owner !== heroId) return false;
  }
  if (has(req, 'near') && !nearOk(req.near, { cityDef, cs, x, y, homes, heroId })) return false;
  return !has(req, 'at') || atOk(req.at, cityDef, x, y);
}

/** Тип и место стройки подходят под просьбу (§8.3, цели HUD стройки); opts — как у placeOk. */
export function staticOk(req, cityDef, cs, x, y, typeId, opts = {}) {
  return (!has(req, 'type') || req.type === typeId) && placeOk(req, cityDef, cs, x, y, opts);
}

/**
 * Кандидаты просьбы (§4.5; USER DECISION «Кандидаты без соседства»): placeOk и есть тип (req.type или любой тип
 * города), открытый населением без самого участка. Правила соседства кандидата не исключают: ok — canPlace даёт ok
 * хотя бы для одного такого типа. Порядок: ok, свободные, меньше жителей, индекс. → [{ x, y, free, ok, pop }].
 */
export function candidates(req, cityDef, cs, opts = {}) {
  const types = has(req, 'type') ? [req.type] : cityDef.types;
  const out = [];
  for (let i = 0; i < cityDef.size * cityDef.size; i++) {
    const { x, y } = xyOf(cityDef, i);
    if (!placeOk(req, cityDef, cs, x, y, opts)) continue;
    const others = cityPopulation(cs, x, y);
    const open = types.filter((t) => cityDef.types.includes(t) && others >= BUILDING_TYPES[t].unlockPop);
    if (!open.length) continue;
    const plot = cs.plots[i];
    out.push({ x, y, free: !plot, ok: open.some((t) => canPlace(cityDef, cs, x, y, t).ok), pop: plot ? plot.pop || 0 : 0, i });
  }
  out.sort((a, b) => (b.ok - a.ok) || (b.free - a.free) || (a.pop - b.pop) || (a.i - b.i));
  return out.map(({ x, y, free, ok, pop }) => ({ x, y, free, ok, pop }));
}

function fitsReadyHouse(req, cityDef, cs, x, y, homes, heroId) {
  const plot = plotAt(cs, x, y);
  return !!plot && placeOk(req, cityDef, cs, x, y, { heroId, homes, home: true })
    && check(req, { cityDef, cs, x, y, plot, homes, heroId }).ok;
}

/** Готовые дома под просьбу «дом» (§3.2): застроены, подходят под условие, в них не живёт другой герой. */
export function readyHouses(save, cityDef, heroId) {
  const a = activeRequest(save, cityDef, heroId);
  if (!a || a.kind !== 'home') return [];
  const cs = cityOf(save, cityDef), homes = homesOf(save, cityDef), out = [];
  for (let i = 0; i < cs.plots.length; i++) {
    const { x, y } = xyOf(cityDef, i);
    if (fitsReadyHouse(a.req, cityDef, cs, x, y, homes, heroId)) out.push({ x, y });
  }
  return out;
}

/** Кого можно поселить в готовый дом (§8.2): первого по порядку приехавшего бездомного, которому он подходит. */
export function settlerFor(save, cityDef, x, y) {
  const cs = cityOf(save, cityDef), homes = homesOf(save, cityDef);
  for (const h of arrived(save, cityDef)) {
    const a = activeRequest(save, cityDef, h.id);
    if (a?.kind === 'home' && fitsReadyHouse(a.req, cityDef, cs, x, y, homes, h.id)) return h.id;
  }
  return null;
}

/** Открытые украшения героя по порядку (§6.3); у бездомного — ни одного. */
export function decorOf(save, cityDef, heroId) {
  const h = heroById(heroId), st = readHero(save, cityDef, heroId);
  if (!h || homeIndex(cityOf(save, cityDef), st) < 0) return [];
  return h.decor.slice(0, decorCount(st.step, st.hearts));
}

// Элемент результата (§4.3): decor — индекс нового украшения, title — новый шаг; возвращение домой — без них.
function outcome(heroId, kind, st, prevStep, prevCount, back = false) {
  const count = decorCount(st.step, st.hearts);
  return {
    heroId, kind, step: st.step,
    decor: !back && count > prevCount ? count - 1 : null,
    title: !back && st.step > prevStep ? st.step : null,
  };
}

// Переезд в дом index: первый дом — шаг 1; бездомный возвращается без роста шага и украшений (§3.6).
function moveIn(st, heroId, index) {
  const prevStep = st.step, prevCount = decorCount(st.step, st.hearts), back = st.step >= 1;
  st.home = index;
  if (!back) st.step = 1;
  return outcome(heroId, 'home', st, prevStep, prevCount, back);
}

/** «Поселить сюда» (§3.2, §8.2): дом из readyHouses. → элемент результата или null. */
export function settle(save, cityDef, heroId, x, y) {
  if (!readyHouses(save, cityDef, heroId).some((p) => p.x === x && p.y === y)) return null;
  return moveIn(heroState(save, cityDef, heroId), heroId, y * cityDef.size + x);
}

/**
 * Стройка на (x, y) уже записана в сохранение (§4.3; план, отличие 1); before — activeRequests до установки.
 * 1) Герой, чей дом опустел, становится бездомным. 2) Если участок застроен, просьбы из before проверяются по
 * порядку героев: «дом» — переезд (дом другого героя не подходит; двум бездомным — первому), «цепочка» — step + 1,
 * «ежедневная» — hearts + 1 и done. → [{ heroId, kind, step, decor, title }].
 */
export function afterBuild(save, cityDef, x, y, before) {
  const cs = cityOf(save, cityDef), index = y * cityDef.size + x, plot = cs.plots[index];
  for (const h of heroesOf(cityDef.id)) {
    const st = readHero(save, cityDef, h.id);
    if (st.home !== -1 && homeIndex(cs, st) < 0) heroState(save, cityDef, h.id).home = -1;
  }
  const out = [];
  if (!plot || !isObj(before)) return out;
  const homes = homesOf(save, cityDef);
  let owner = ownerAt(homes, x, y);
  for (const h of heroesOf(cityDef.id)) {
    const a = has(before, h.id) ? before[h.id] : null;
    if (!a || !check(a.req, { cityDef, cs, x, y, plot, homes, heroId: h.id }).ok) continue;
    const st = heroState(save, cityDef, h.id), home = homeIndex(cs, st) >= 0;
    if (a.kind === 'home') {
      if (home || (owner && owner !== h.id)) continue;
      owner = h.id;
      out.push(moveIn(st, h.id, index));
    } else if (a.kind === 'chain') {
      if (!home || st.step !== a.step) continue;
      const prev = decorCount(st.step, st.hearts);
      st.step += 1;
      out.push(outcome(h.id, 'chain', st, a.step, prev));
    } else if (a.kind === 'daily') {
      if (!home || !isObj(st.daily) || st.daily.done) continue;
      const prev = decorCount(st.step, st.hearts);
      st.hearts = Math.min(HEARTS_MAX, st.hearts + 1);
      st.daily.done = true;
      out.push(outcome(h.id, 'daily', st, st.step, prev));
    }
  }
  return out;
}

/** Попыток жребия ежедневной просьбы и запасной вариант (§4.4). */
export const DAILY_TRIES = 8;
export const DAILY_FALLBACK = Object.freeze({ perfect: 3 });

/** Ступень ежедневных по сердечкам (§4.4): < 5 — 0, < 15 — 1, иначе 2. */
const tierOf = (hearts) => (hearts < 5 ? 0 : hearts < 15 ? 1 : 2);
const tallestType = (cityDef) =>
  cityDef.types.reduce((a, t) => (BUILDING_TYPES[t].floors > BUILDING_TYPES[a].floors ? t : a), cityDef.types[0]);
const MASTERY = { perfect: [4, 6, 8], combo: [3, 5, 7] };
const SHAPES = [['stairs', 'sturdy', 'zigzag', 'pisa'], ['spire'], ['string', 'gold']];
const TALL = [['shop', 'office'], ['office', 'tower'], ['tower']];

/** Шаблоны (§4.4): условие до очистки; золото (golden 2, gold) — только в городах с типом от 20 этажей (§6.2). */
const MAKE = {
  place(rng, cityDef, tier) {
    const type = rng.pick(cityDef.types);
    const spots = [...natureOf(cityDef).map((k) => ({ near: k })), ...cityDef.types.map((t) => ({ near: t })), { near: 'home' },
      ...PLACES.map((a) => ({ at: a }))];
    const req = { type, ...rng.pick(spots) };
    if (tier === 1) req.floors = Math.round(0.6 * (BUILDING_TYPES[type]?.floors ?? 0));
    if (tier === 2) req.full = true;
    return req;
  },
  shape(rng, cityDef, tier) {
    const gold = maxFloors(cityDef) >= 20;
    return { nick: rng.pick(SHAPES.slice(0, tier + 1).flat().filter((k) => k !== 'gold' || gold)) };
  },
  mastery(rng, cityDef, tier) {
    const kind = rng.pick(['perfect', 'combo', 'misses', 'golden']);
    if (kind === 'misses') return tier === 2 ? { floors: 10, misses: 0 } : { misses: tier === 0 ? 1 : 0 };
    if (kind === 'golden') return { golden: tier === 2 && maxFloors(cityDef) >= 20 ? 2 : 1 };
    return { [kind]: MASTERY[kind][tier] };
  },
  tall(rng, cityDef, tier) {
    const list = TALL[tier].filter((t) => cityDef.types.includes(t));
    return { type: list.length ? rng.pick(list) : tallestType(cityDef), full: true };
  },
  /** Спец-этаж любимого типа героя («Башня дня» §4.5): ступень 1 — идеально, ступень 2 — ещё и не больше одного промаха. */
  special(rng, cityDef, tier, hero) {
    const req = { special: hero.fav };
    if (tier >= 1) req.specialPerfect = true;
    if (tier === 2) req.misses = 1;
    return req;
  },
};

/** Шаблон по весам вкусов героя (§6.1). */
function pickTemplate(rng, tastes) {
  let r = rng.next() * TEMPLATES.reduce((s, k) => s + tastes[k], 0);
  for (const k of TEMPLATES) {
    if (r < tastes[k]) return k;
    r -= tastes[k];
  }
  return TEMPLATES.find((k) => tastes[k] > 0);
}

/**
 * Ежедневная просьба героя на сутки day (§4.4): rng — hashSeed('heroDaily', город, герой, day, hearts); шаблон по
 * вкусам, ступень по сердечкам. Негодная, без кандидата с ok или та же, что прошлая, — новый жребий, до DAILY_TRIES
 * раз; иначе DAILY_FALLBACK (ему повтор допустим). Сохранение не меняется.
 */
export function dailyRequest(save, cityDef, heroId, day) {
  const h = heroById(heroId);
  if (!h) return { ...DAILY_FALLBACK };
  const st = readHero(save, cityDef, heroId), tier = tierOf(st.hearts);
  const rng = createRng(hashSeed('heroDaily', cityDef.id, heroId, day, st.hearts));
  const prev = isObj(st.daily) ? JSON.stringify(st.daily.req) : null;
  const cs = cityOf(save, cityDef), homes = homesOf(save, cityDef);
  for (let t = 0; t < DAILY_TRIES; t++) {
    const req = cleanRequest(MAKE[pickTemplate(rng, h.tastes)](rng, cityDef, tier, h), cityDef, heroId);
    if (!req || JSON.stringify(req) === prev) continue;
    if (candidates(req, cityDef, cs, { heroId, homes }).some((c) => c.ok)) return req;
  }
  return { ...DAILY_FALLBACK };
}

// Ежедневная выдаётся (§3.3): целые сутки, цепочка пройдена, герой дома, просьбы нет или прежняя выполнена раньше day.
function dailyDue(cs, st, day) {
  if (!Number.isInteger(day) || st.step < CHAIN_LEN || homeIndex(cs, st) < 0) return false;
  return !isObj(st.daily) || (st.daily.done === true && day > st.daily.day);
}

/** Новые ежедневные просьбы на сутки day (§3.3, §8.5): мутирует save. → id героев, которым выдана просьба. */
export function refreshDaily(save, cityDef, day) {
  const cs = cityOf(save, cityDef), out = [];
  for (const h of arrived(save, cityDef)) {
    if (!dailyDue(cs, readHero(save, cityDef, h.id), day)) continue;
    const req = dailyRequest(save, cityDef, h.id, day);
    heroState(save, cityDef, h.id).daily = { day, req, done: false };
    out.push(h.id);
  }
  return out;
}

/** Просьбы для значка на карте городов (§8.4): активные и ежедневные, которые выдадутся при входе. Save не меняется. */
export function pendingCount(save, cityDef, day) {
  const cs = cityOf(save, cityDef);
  return arrived(save, cityDef)
    .filter((h) => activeRequest(save, cityDef, h.id) || dailyDue(cs, readHero(save, cityDef, h.id), day)).length;
}

/**
 * Тестовая застройка героев (perf_check, снимки): три звезды, записи героев заново — met, step, hearts (после
 * цепочки), daily: null; дом — первый застроенный кандидат условия дома, иначе любой застроенный участок без героя.
 */
export function fillHeroes(save, cityDef, { step = CHAIN_LEN, hearts = 0, met = true } = {}) {
  const c = save.cities[cityDef.id];
  c.stars = 3;
  c.heroes = defaultHeroes(cityDef.id);
  const cs = cityOf(save, cityDef);
  for (const h of heroesOf(cityDef.id)) {
    const st = Object.assign(c.heroes[h.id], { met, step, hearts: step >= CHAIN_LEN ? hearts : 0 });
    if (step < 1) continue;
    const homes = homesOf(save, cityDef);
    const taken = new Set(Object.values(homes).map((p) => p.y * cityDef.size + p.x));
    const best = candidates(h.chain[0], cityDef, cs, { heroId: h.id, homes, home: true }).find((k) => !k.free);
    const i = best ? best.y * cityDef.size + best.x : cs.plots.findIndex((p, j) => p && !taken.has(j));
    if (i >= 0) st.home = i;
  }
  return save;
}
