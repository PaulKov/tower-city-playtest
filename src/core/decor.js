// Украшения за монеты: виды, цены, цвета и места (план «Украшения за монеты»). Только данные, без three и DOM.
import { GROUND_DECOR, ROOF_DECOR, residentOf, homesOf } from './heroes.js';

/** Все виды: сначала наземные, потом крышные, как в списках героев. */
export const DECOR_KINDS = Object.freeze([...GROUND_DECOR, ...ROOF_DECOR]);

/** Цена вида в монетах. */
export const DECOR_PRICE = Object.freeze({
  crates: 20, barrel: 20, mailbox: 25, birdhouse: 25, flowerbed: 30, pumpkins: 35, pottedTree: 40, lifebuoy: 40,
  bench: 45, snowman: 45, skis: 45, lantern: 50, parasol: 55, easel: 60, flag: 60, vane: 80, neon: 120, telescope: 150,
});

/** Цвета украшения по индексу. */
export const DECOR_COLORS = Object.freeze(['#ef5b4b', '#ff8a3d', '#ffc94a', '#69b86b', '#4fb6e8', '#5b8fd9', '#ff4fa3', '#fffaf2']);

/** Места участка: семь наземных и крыша. */
export const SLOT_IDS = Object.freeze(['f1', 'f2', 's1', 's2', 'c', 'b1', 'b2', 'roof']);

/** Предел склада одного вида для показа и предел при сохранении. */
export const STOCK_MAX = 99;
export const STOCK_CAP = 9999;

/** Наземный вид подходит наземному месту, крышный — только месту roof. */
export function kindFits(slot, kind) {
  if (!SLOT_IDS.includes(slot)) return false;
  return slot === 'roof' ? ROOF_DECOR.includes(kind) : GROUND_DECOR.includes(kind);
}

/** Пустой склад: по нулю на каждый вид. */
export function defaultDecorStock() {
  const out = {};
  for (const k of DECOR_KINDS) out[k] = 0;
  return out;
}

export const validColor = (color) => Number.isInteger(color) && color >= 0 && color < DECOR_COLORS.length;
const knownKind = (kind) => typeof kind === 'string' && Object.hasOwn(DECOR_PRICE, kind);
const stockOf = (save, kind) => (Object.hasOwn(save?.decorStock ?? {}, kind) ? save.decorStock[kind] | 0 : 0);

// Одна штука вида на склад: предел только STOCK_CAP, STOCK_MAX проверяет лишь покупка.
function addStock(save, kind) {
  const st = save.decorStock;
  if (st === null || typeof st !== 'object' || Array.isArray(st)) save.decorStock = defaultDecorStock();
  save.decorStock[kind] = Math.min(STOCK_CAP, stockOf(save, kind) + 1);
}

// Участок (x, y) города без записи в сохранение; вне сетки или пустой — null.
function plotOf(save, cityDef, x, y) {
  const size = cityDef.size;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) return null;
  return save?.cities?.[cityDef.id]?.plots?.[y * size + x] ?? null;
}

/** Можно ли украшать участок: построенный дом (этаж ≥ 1), в котором не живёт герой. */
export function canDecorate(save, cityDef, x, y) {
  return decorReason(save, cityDef, x, y) === null;
}

function decorReason(save, cityDef, x, y) {
  const plot = plotOf(save, cityDef, x, y);
  if (!plot || !(plot.floors >= 1)) return 'house';
  return residentOf(save, cityDef, x, y) !== null ? 'hero' : null;
}

// Все проверки установки, кроме склада; → причина отказа или null.
function placeReason(save, cityDef, x, y, slot, kind, color) {
  const r = decorReason(save, cityDef, x, y);
  if (r) return r;
  if (typeof slot !== 'string' || !SLOT_IDS.includes(slot)) return 'slot';
  if (!knownKind(kind) || !kindFits(slot, kind)) return 'kind';
  if (!validColor(color)) return 'color';
  return null;
}

const buyReason = (save, kind) => {
  if (!knownKind(kind)) return 'unknown';
  if (stockOf(save, kind) >= STOCK_MAX) return 'max';
  return (save.coins | 0) < DECOR_PRICE[kind] ? 'coins' : null;
};

/** Покупка одной штуки на склад: за монеты, до STOCK_MAX на вид. */
export function buyDecor(save, kind) {
  const reason = buyReason(save, kind);
  if (reason) return { ok: false, reason };
  save.coins = (save.coins | 0) - DECOR_PRICE[kind];
  if (!save.decorStock) save.decorStock = defaultDecorStock();
  save.decorStock[kind] = stockOf(save, kind) + 1;
  return { ok: true };
}

/**
 * Установка со склада на место участка. Тот же вид на месте — только цвет; другой вид — прежний уходит на склад.
 * Любой отказ оставляет сохранение нетронутым.
 */
export function placeDecor(save, cityDef, x, y, slot, kind, color) {
  const reason = placeReason(save, cityDef, x, y, slot, kind, color);
  if (reason) return { ok: false, reason };
  const plot = plotOf(save, cityDef, x, y), old = plot.decor && Object.hasOwn(plot.decor, slot) ? plot.decor[slot] : null;
  const same = old && old.k === kind;
  if (!same && stockOf(save, kind) < 1) return { ok: false, reason: 'stock' };
  if (!same) {
    save.decorStock[kind] -= 1;
    if (old && knownKind(old.k)) addStock(save, old.k);
  }
  if (!plot.decor) plot.decor = {};
  plot.decor[slot] = { k: kind, c: color };
  save.decorColor = color;
  return { ok: true };
}

/** Купить и поставить разом: все проверки до первого изменения. */
export function buyAndPlace(save, cityDef, x, y, slot, kind, color) {
  const reason = placeReason(save, cityDef, x, y, slot, kind, color) ?? buyReason(save, kind);
  if (reason) return { ok: false, reason };
  buyDecor(save, kind);
  return placeDecor(save, cityDef, x, y, slot, kind, color);
}

// Украшение на месте участка или null.
function decorAt(save, cityDef, x, y, slot) {
  if (decorReason(save, cityDef, x, y) || typeof slot !== 'string') return null;
  const d = plotOf(save, cityDef, x, y).decor;
  return d && Object.hasOwn(d, slot) ? d[slot] : null;
}

/**
 * Перекраска поставленного украшения; цвет запоминается для следующей установки. → true, если цвет сменился (§4);
 * тот же цвет, пустое место или неверный цвет — false, сохранение не меняется.
 */
export function recolorDecor(save, cityDef, x, y, slot, color) {
  const d = decorAt(save, cityDef, x, y, slot);
  if (!d || !validColor(color) || d.c === color) return false;
  d.c = color;
  save.decorColor = color;
  return true;
}

/** Снятие на склад; пустой plot.decor удаляется. */
export function removeDecor(save, cityDef, x, y, slot) {
  const d = decorAt(save, cityDef, x, y, slot);
  if (!d) return false;
  const plot = plotOf(save, cityDef, x, y);
  if (knownKind(d.k)) addStock(save, d.k);
  delete plot.decor[slot];
  if (Object.keys(plot.decor).length === 0) delete plot.decor;
  return true;
}

/** Очистка украшений участка: только свои места из SLOT_IDS, вид подходит месту, цвет 0…7; ничего не осталось — undefined. */
export function cleanPlotDecor(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  let n = 0;
  for (const slot of SLOT_IDS) {
    if (!Object.hasOwn(raw, slot)) continue;
    const d = raw[slot];
    if (d === null || typeof d !== 'object' || Array.isArray(d)) continue;
    if (!knownKind(d.k) || !kindFits(slot, d.k) || !validColor(d.c)) continue;
    out[slot] = { k: d.k, c: d.c };
    n++;
  }
  return n ? out : undefined;
}

/** Склад из сохранения: известные виды, целые 0…STOCK_CAP, остальное — 0. */
export function cleanDecorStock(raw) {
  const out = defaultDecorStock();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of DECOR_KINDS) {
    const v = Object.hasOwn(raw, k) ? raw[k] : 0;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(STOCK_CAP, Math.max(0, Math.round(v)));
  }
  return out;
}

/** Все украшения участка — на склад (без предела STOCK_MAX), поле decor удаляется. → число штук. */
export function releaseDecor(save, cityDef, x, y) {
  const plot = plotOf(save, cityDef, x, y);
  if (!plot || plot.decor === null || typeof plot.decor !== 'object' || Array.isArray(plot.decor)) return 0;
  let n = 0;
  for (const slot of Object.keys(plot.decor)) {
    const d = plot.decor[slot];
    if (d && knownKind(d.k)) { addStock(save, d.k); n++; }
  }
  delete plot.decor;
  return n;
}

/** Украшения со всех домов героев города — на склад. → число штук. */
export function releaseHeroHomes(save, cityDef) {
  let n = 0;
  const homes = homesOf(save, cityDef);
  for (const id of Object.keys(homes)) n += releaseDecor(save, cityDef, homes[id].x, homes[id].y);
  return n;
}
