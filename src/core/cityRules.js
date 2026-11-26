// Правила города: участки, соседство, разблокировки, звёзды (спецификация §4).
import { BUILDING_TYPES, CITIES, RULE_TEXT, TYPE_ORDER } from './levels.js';

export function createCityState(cityDef) {
  return { size: cityDef.size, plots: new Array(cityDef.size * cityDef.size).fill(null) };
}

export function inGrid(cityDef, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < cityDef.size && y < cityDef.size;
}

export function isBlocked(cityDef, x, y) {
  return cityDef.blocked.some(([bx, by]) => bx === x && by === y);
}

export function blockedKind(cityDef, x, y) {
  const b = cityDef.blocked.find(([bx, by]) => bx === x && by === y);
  return b ? (b[2] || 'park') : null;
}

export function neighbors(cityDef, x, y) {
  const out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inGrid(cityDef, nx, ny)) out.push({ x: nx, y: ny });
  }
  return out;
}

export function plotAt(cityState, x, y) {
  return cityState.plots[y * cityState.size + x] ?? null;
}

export function placeBuilding(cityState, x, y, building) {
  const { type, pop, floors } = building;
  // поля участка v2 (спецификация «Своя башня» §4.3) — только вместе с формой
  cityState.plots[y * cityState.size + x] = Array.isArray(building.shape)
    ? { type, pop, floors, shape: building.shape, best: building.best, miss: building.miss, at: building.at, nick: building.nick, name: building.name ?? '' }
    : { type, pop, floors };
}

export function demolish(cityState, x, y) {
  cityState.plots[y * cityState.size + x] = null;
}

export function cityPopulation(cityState, exceptX = -1, exceptY = -1) {
  let sum = 0;
  const skip = exceptY * cityState.size + exceptX;
  cityState.plots.forEach((p, i) => { if (p && i !== skip) sum += p.pop || 0; });
  return sum;
}

export function starsFor(cityDef, pop) {
  let n = 0;
  for (const t of cityDef.stars) if (pop >= t) n++;
  return n;
}

/** Уже полученные звёзды остаются у города после перестройки с меньшим населением. */
export function earnedCityStars(cityDef, pop, savedStars = 0) {
  return Math.max(starsFor(cityDef, pop), Math.min(cityDef.stars.length, savedStars | 0));
}

export function cityBuildingTypes(cityDef, cityState) {
  return cityState.authorMode ? TYPE_ORDER : cityDef.types;
}

export function typeUnlocked(cityDef, cityState, typeId) {
  const t = BUILDING_TYPES[typeId];
  if (!t || !cityBuildingTypes(cityDef, cityState).includes(typeId)) return false;
  return cityState.authorMode || cityPopulation(cityState) >= t.unlockPop;
}

export function canPlace(cityDef, cityState, x, y, typeId) {
  if (!inGrid(cityDef, x, y)) return { ok: false, code: 'outside', reason: RULE_TEXT.outside };
  if (isBlocked(cityDef, x, y)) return { ok: false, code: 'blocked', reason: RULE_TEXT.blocked };
  const t = BUILDING_TYPES[typeId];
  if (!t || !cityBuildingTypes(cityDef, cityState).includes(typeId)) return { ok: false, code: 'unavailable', reason: RULE_TEXT.unavailable };
  if (cityState.authorMode) return { ok: true };
  // Перестройка: здание на самом участке не учитывается.
  const pop = cityPopulation(cityState, x, y);
  if (pop < t.unlockPop) return { ok: false, code: 'locked', reason: RULE_TEXT.locked(t.unlockPop), need: t.unlockPop };
  const around = new Set(neighbors(cityDef, x, y).map(n => plotAt(cityState, n.x, n.y)?.type).filter(Boolean));
  const missing = t.needs.filter(n => !around.has(n));
  if (missing.length) {
    return { ok: false, code: 'needs', reason: RULE_TEXT.needs(missing.map(m => BUILDING_TYPES[m].name)), missing };
  }
  return { ok: true };
}

/** Есть ли в записи города хоть один построенный дом (для метки «Новинка» на карте). */
export function cityHasBuilt(rec) {
  return !!rec?.plots?.some(Boolean);
}

export function cityIsUnlocked(index, saveCities, authorMode = false) {
  if (authorMode) return Number.isInteger(index) && index >= 0 && index < CITIES.length;
  if (index === 0) return true;
  const prev = CITIES[index - 1];
  if (!prev || !saveCities) return false;
  return (saveCities[prev.id]?.stars ?? 0) >= 1;
}
