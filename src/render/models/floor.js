// Процедурный этаж: корпус (body), слитая вершинно-окрашенная отделка (trim) и слитые стёкла (glass).
// Два уровня (спецификация «Детализация домов» §5.1): L0 — стройка, меню и галерея; L1 — дома города: те же окна
// и вход, проще детали, тело с общими вершинами, вылет деталей не больше L1_MAX_OUT.
// Спец-этажи (спецификация «Спец-этажи» §6) — свой раздел: вид типа не зависит от стиля и варианта.
// Начало координат — центр низа этажа. Геометрия кэшируется (LRU) и принадлежит кэшу: не освобождать.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOOR_H, W0, D0, SPECIAL_TYPES } from '../../core/levels.js';
import { createRng, hashSeed } from '../../core/rng.js';
import * as G from '../geomUtils.js';
import { mat, PALETTE, windowPiece, markFacadeFinish } from '../materials.js';
import { WALL, asWall, wallLayerOf, wallMaterial } from '../houses/walls.js';

export const FLOOR_STYLES = ['house', 'shop', 'office', 'tower', 'quick0', 'quick1', 'quick2', 'quick3'];
/** Предел общего кэша геометрии этажей и крыш — байты вершинных данных (спецификация «Своя башня» §6.2; план, отличие 6). */
export const GEOMETRY_CACHE_BYTES = 32 * 1024 * 1024;

const BODY_R = 0.08;
const CORNICE_Y = FLOOR_H - 0.06; // карниз 1.09..1.19
const WHITE = new THREE.Color('#ffffff');
const light = (c, t) => '#' + new THREE.Color(c).lerp(WHITE, t).getHexString();

/** Цвет водосточных труб этажей и водостоков двускатных крыш (roof.js). */
export const DOWNPIPE = '#9aa3ad';
const PIPE_R = 0.035, PIPE_OUT = 0.085;
/** Труба — только на этажах не уже 0,8 м: у более узкого верхнего этажа водосток крутой крыши короче и выше её конца. */
const PIPE_MIN_SIDE = 0.8;

/** Водосточная труба этажа (§5.2): у внешнего угла +x +z, снаружи угловых камней (план, отличие 9). */
export function downpipeAt(w, d) {
  return { x: w / 2 + PIPE_OUT, z: d / 2 + PIPE_OUT, r: PIPE_R };
}

/** Число окон на стороне длиной len: max(1, floor((len−0.5)/1.05)); уже 0.6 — окон нет. */
export function windowCount(len) {
  if (!(len >= 0.6)) return 0;
  return Math.max(1, Math.floor((len - 0.5) / 1.05));
}

/**
 * Вход (§5.3): полотно, низ (верх ступеньки), верх, рама; дверь — на стороне не короче DOOR_MIN_SIDE.
 * Вылеты козырька и ступеньки; цоколь входного этажа — высота, выступ, цвет.
 */
export const DOOR_Y0 = 0.085, DOOR_TOP = 0.9; // низ и верх полотна; по низу ночная раскладка города узнаёт стекло двери
const DOOR_W = 0.7, DOOR_BAR = 0.06, DOOR_MIN_SIDE = 1.2;
const CANOPY_D = 0.4, STEP_D = 0.3;
const PLINTH_H = 0.08, PLINTH_OUT = 0.03, PLINTH = '#b8b0a3';
/** L1 (§5.1): наибольший вылет деталей от стены; вылет балкона, козырька и ступеньки; глубина маркизы (конец — 0,239). */
export const L1_MAX_OUT = 0.25;
const L1_OUT = 0.24, L1_AWNING = 0.22;

// door — деревянная или стеклянная дверь входа, doorFrame — цвет её рамы, doorTop — верх (у магазина ниже вывески),
// awning — над дверью маркиза, как над витринами; quoins — цвет угловых камней (рустовка и водосточная труба).
const STYLES = {
  house: { body: light(PALETTE.house, 0.2), cornice: PALETTE.cream, build: buildHouse, quoins: '#f1e6d2', door: 'wood', doorFrame: PALETTE.trim },
  shop: { body: light(PALETTE.shop, 0.3), cornice: PALETTE.white, build: buildShop, door: 'glass', doorFrame: '#fdf7ee', doorTop: 0.78, awning: true },
  office: { body: light(PALETTE.office, 0.3), cornice: '#dfe6ee', build: buildOffice, door: 'glass', doorFrame: '#9aa6b4' },
  tower: { body: light(PALETTE.tower, 0.45), cornice: PALETTE.gold, build: buildTower, door: 'glass', doorFrame: PALETTE.gold },
  nightTower: { body: '#55616a', cornice: '#859092', build: buildNightTower, door: 'glass', doorFrame: '#ad9d80' },
  quick0: { body: '#d98a62', cornice: '#efe2c8', build: buildOld, quoins: '#efe2c8', door: 'wood', doorFrame: '#6b4430' },
  quick1: { body: '#f2deb6', cornice: PALETTE.white, build: buildClassic, door: 'wood', doorFrame: PALETTE.white },
  quick2: { body: '#bfc6ce', cornice: PALETTE.steel, build: buildModern, door: 'glass', doorFrame: '#3c4552' },
  quick3: { body: '#f3f7fb', cornice: '#ffffff', build: buildFuture, door: 'glass', doorFrame: '#ffffff' },
};

/** Цвет корпуса стиля: вершинный цвет стен этажа и фронтонов крыш (roof.js); неизвестный стиль — house. */
export function floorBodyColor(style) {
  return (Object.hasOwn(STYLES, style) ? STYLES[style] : STYLES.house).body;
}

// ---------- примитивы в координатах фасада: x вдоль стены, y вверх, z наружу (стена — z = 0) ----------

function slab(x0, x1, y0, y1, z0, z1, color, r = 0) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = r > 0 ? G.roundedBox(w, h, d, r, 1, color) : G.box(w, h, d, color);
  return G.place(g, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 });
}

/** Шаблон бокса без задней грани: первые 20 вершин и 30 индексов единичного BoxGeometry (грань −z — последняя). */
let facadeTpl = null;

/** Брус L1 без задней грани (−z, она у стены): 10 треугольников вместо 12 у slab. */
function facadeBox(x0, x1, y0, y1, z0, z1, color) {
  if (!facadeTpl) {
    const b = new THREE.BoxGeometry(1, 1, 1);
    facadeTpl = { pos: b.getAttribute('position').array.slice(0, 60), nor: b.getAttribute('normal').array.slice(0, 60), index: b.index.array.slice(0, 30) };
    b.dispose();
  }
  const sx = Math.max(0.002, x1 - x0), sy = Math.max(0.002, y1 - y0), sz = Math.max(0.002, z1 - z0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, pos = facadeTpl.pos.slice();
  for (let i = 0; i < 60; i += 3) {
    pos[i] = cx + pos[i] * sx; pos[i + 1] = cy + pos[i + 1] * sy; pos[i + 2] = cz + pos[i + 2] * sz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(facadeTpl.nor.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(facadeTpl.index.slice(), 1));
  return G.colored(g, color);
}

/** Плоскость L1 от x0 до x1 и от y0 до y1 на высоте z над стеной: лицо детали без боков (2 треугольника). */
const FACE_NORMAL = new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3);
const FACE_UV = new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2);
const FACE_INDEX = new THREE.BufferAttribute(new Uint16Array([0, 2, 1, 2, 3, 1]), 1);
function faceQuad(x0, x1, y0, y1, z) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x0, y1, z, x1, y1, z, x0, y0, z, x1, y0, z]), 3));
  g.setAttribute('normal', FACE_NORMAL.clone()); // поворот стороны меняет нормали
  g.setAttribute('uv', FACE_UV);
  g.setIndex(FACE_INDEX);
  return g;
}
function quad(x0, x1, y0, y1, z, color) {
  return G.colored(faceQuad(x0, x1, y0, y1, z), color);
}

/** Объёмная деталь: slab на L0; брус без задней грани на L1 (скругление r — только L0). */
function solid(ctx, x0, x1, y0, y1, z0, z1, color, r = 0) {
  return ctx.lod ? facadeBox(x0, x1, y0, y1, z0, z1, color) : slab(x0, x1, y0, y1, z0, z1, color, r);
}

/** Плоская деталь: slab на L0; на L1 — только её лицо на внешней глубине z1. */
function plate(ctx, x0, x1, y0, y1, z0, z1, color, r = 0) {
  return ctx.lod ? quad(x0, x1, y0, y1, z1, color) : slab(x0, x1, y0, y1, z0, z1, color, r);
}

function pane(x0, x1, y0, y1, z, opts) {
  return windowPiece(faceQuad(x0, x1, y0, y1, z), opts);
}

/** Верхний паз затеняет стекло, нижний штапик ловит свет отлива (только L0). */
function glazingBead(out, cx, y0, ww, wh) {
  out.push(quad(cx - ww / 2, cx + ww / 2, y0 + wh - 0.017, y0 + wh, 0.019, '#536369'));
  out.push(quad(cx - ww / 2, cx + ww / 2, y0, y0 + 0.012, 0.019, '#788684'));
}

/** Окно: рама из четырёх брусков (L1 — одна плоскость за стеклом), переплёт, подоконник и штапик вокруг стекла. */
function windowUnit(ctx, cx, y0, ww, wh, o = {}) {
  const { frame = ctx.golden ? '#fff1c2' : PALETTE.trim, bar = 0.05, cross = true, crossV = cross, sill = true, room = 0.09 } = o;
  const T = ctx.trim, x0 = cx - ww / 2, x1 = cx + ww / 2, y1 = y0 + wh, z0 = 0.01, z1 = 0.06;
  if (ctx.lod) T.push(quad(x0 - bar, x1 + bar, y0 - bar, y1 + bar, 0.008, frame));
  else {
    T.push(slab(x0 - bar, x0, y0 - bar, y1 + bar, z0, z1, frame));
    T.push(slab(x1, x1 + bar, y0 - bar, y1 + bar, z0, z1, frame));
    T.push(slab(x0, x1, y1, y1 + bar, z0, z1, frame));
    T.push(slab(x0, x1, y0 - bar, y0, z0, z1, frame));
  }
  const mb = bar * 0.55;
  if (crossV) T.push(plate(ctx, cx - mb / 2, cx + mb / 2, y0 - 0.01, y1 + 0.01, 0.025, 0.045, frame));
  // L1: поперечный переплёт на 2 мм впереди продольного — плоскости не совпадают в месте пересечения
  if (cross) T.push(plate(ctx, x0 - 0.01, x1 + 0.01, y0 + wh * 0.62 - mb / 2, y0 + wh * 0.62 + mb / 2, 0.025, ctx.lod ? 0.047 : 0.045, frame));
  if (sill) {
    const ext = Math.max(0, Math.min(0.09, room - 0.02));
    T.push(solid(ctx, x0 - bar - ext, x1 + bar + ext, y0 - bar - 0.045, y0 - bar + 0.005, 0.01, 0.11, o.sillColor || frame));
  }
  if (!ctx.lod) glazingBead(T, cx, y0, ww, wh);
  ctx.glass.push(pane(x0, x1, y0, y1, 0.015, ctx.paneOpts(o)));
}

/** Ставни по бокам окна; на L1 — плоскости без планок. → ширина створки. */
function shutters(ctx, cx, y0, ww, wh, bar, color) {
  const sw = Math.min(0.17, ww * 0.42), slat = light(color, 0.25);
  for (const s of [-1, 1]) {
    const xa = cx + s * (ww / 2 + bar + 0.012), xb = xa + s * sw;
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    ctx.trim.push(plate(ctx, lo, hi, y0 - bar * 0.5, y0 + wh + bar * 0.5, 0.012, 0.042, color));
    if (ctx.lod) continue;
    for (let k = 0; k < 6; k++) {
      const y = y0 + wh * (0.13 + k * 0.14);
      ctx.trim.push(G.place(G.box(hi - lo - 0.023, 0.019, 0.031, slat), { x: (lo + hi) / 2, y, z: 0.045, rx: 0.36 }));
    }
  }
  return sw;
}

let petalTemplate;
function flowerHead(color) {
  if (!petalTemplate) {
    // Пять венчиков с чашевидной серединой. Плоскость лепестков наклонена к свету и слегка наружу.
    const pos = [0, 0, -0.012], index = [], segments = 20;
    for (let i = 0; i < segments; i++) {
      const a = 2 * Math.PI * i / segments, r = 0.028 + 0.012 * Math.cos(5 * a);
      pos.push(r * Math.cos(a), r * Math.sin(a), 0.009);
      index.push(0, i + 1, (i + 1) % segments + 1);
    }
    petalTemplate = new THREE.BufferGeometry();
    petalTemplate.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    petalTemplate.setIndex(index); petalTemplate.computeVertexNormals();
    petalTemplate.rotateX(-0.65);
  }
  const g = G.colored(petalTemplate.clone(), color);
  g.getAttribute('color').setXYZ(0, 0.87, 0.56, 0.12);
  return g;
}

/** Ящик цветов под окном; на L1 — брус и зелёная полоса, расход rng одинаков на обоих уровнях. */
function flowerBox(ctx, cx, yTop, ww) {
  const rng = ctx.rng, x0 = cx - ww / 2 - 0.02, x1 = cx + ww / 2 + 0.02;
  ctx.trim.push(solid(ctx, x0, x1, yTop - 0.135, yTop - 0.005, 0.02, 0.17, PALETTE.wood, 0.02));
  if (ctx.lod) ctx.trim.push(quad(x0 + 0.03, x1 - 0.03, yTop - 0.02, yTop + 0.05, 0.12, PALETTE.leaf));
  const k = Math.max(2, Math.round(ww / 0.14));
  for (let i = 0; i < k; i++) {
    if (ctx.lod) { rng.pick(ctx.flowers); rng.uniform(-0.02, 0.02); continue; }
    const x = x0 + 0.06 + (x1 - x0 - 0.12) * (i / (k - 1));
    ctx.trim.push(G.place(G.sphere(0.055, 6, 4, i % 2 ? PALETTE.leaf : PALETTE.grassDark), { x, y: yTop + 0.018, z: 0.1, sx: 0.57, sy: 0.94, sz: 0.42, rz: i % 2 ? -0.65 : 0.7 }));
    ctx.trim.push(G.place(flowerHead(rng.pick(ctx.flowers)), { x: x + rng.uniform(-0.02, 0.02), y: yTop + 0.064, z: 0.122, rz: i * 1.9 }));
  }
}

function balcony(ctx, cx, y0, bw) {
  const T = ctx.trim, x0 = cx - bw / 2, x1 = cx + bw / 2, ys = y0 - 0.1, rail = ctx.golden ? '#fff1c2' : PALETTE.white;
  if (ctx.lod) {
    // L1: плита, перила и боковины — брусья, ограждение — одна плоскость вместо балясин; вылет L1_OUT (42 треугольника)
    T.push(facadeBox(x0, x1, ys - 0.06, ys, 0.01, L1_OUT, PALETTE.cream));
    T.push(facadeBox(x0, x1, ys + 0.3, ys + 0.34, L1_OUT - 0.04, L1_OUT, rail));
    T.push(facadeBox(x0, x0 + 0.04, ys + 0.3, ys + 0.34, 0.01, L1_OUT - 0.04, rail));
    T.push(facadeBox(x1 - 0.04, x1, ys + 0.3, ys + 0.34, 0.01, L1_OUT - 0.04, rail));
    T.push(quad(x0 + 0.02, x1 - 0.02, ys, ys + 0.3, L1_OUT - 0.02, rail));
    return;
  }
  T.push(slab(x0, x1, ys - 0.06, ys, 0.01, 0.38, PALETTE.cream, 0.02));
  T.push(slab(x0, x1, ys + 0.3, ys + 0.34, 0.33, 0.37, rail));
  T.push(slab(x0, x0 + 0.04, ys + 0.3, ys + 0.34, 0.01, 0.33, rail));
  T.push(slab(x1 - 0.04, x1, ys + 0.3, ys + 0.34, 0.01, 0.33, rail));
  const k = Math.max(3, Math.round(bw / 0.12));
  for (let i = 0; i <= k; i++) {
    T.push(G.place(G.cylinder(0.016, 0.016, 0.3, 5, rail), { x: x0 + 0.03 + (bw - 0.06) * (i / k), y: ys + 0.15, z: 0.35 }));
  }
}

/** Кондиционер: корпус, решётка, вентилятор (только L0). */
function acUnit(ctx, cx, y0) {
  const T = ctx.trim;
  T.push(solid(ctx, cx - 0.17, cx + 0.17, y0, y0 + 0.22, 0.01, 0.22, '#e8ecef', 0.02));
  T.push(plate(ctx, cx - 0.15, cx + 0.03, y0 + 0.03, y0 + 0.19, 0.22, 0.232, '#7d8794'));
  if (!ctx.lod) T.push(G.place(G.cylinder(0.065, 0.065, 0.014, 10, '#59626e'), { x: cx + 0.085, y: y0 + 0.11, z: 0.228, rx: Math.PI / 2 }));
}

/**
 * Ленточное остекление: рейки сверху/снизу, импосты по границам слотов, стекло по слотам. Слот ctx.skip (дверь)
 * разрывает ленту на отрезки до и после него; их торцевые импосты стоят на границах слота. Без двери (skip = -1)
 * вывод и расход rng — прежние. На L1 рейки — брусья, стойки и импосты — плоскости, бликов нет.
 * Возвращает отрезки [[xa, xb], …] без торцевых импостов (для отлива).
 */
function ribbon(ctx, { y0, y1, frame, mull = 0.06, inset = 0.18, cool = 0.3 }) {
  const { len, n, slot, skip } = ctx, T = ctx.trim;
  const ranges = skip < 0 ? [[0, n - 1]] : [[0, skip - 1], [skip + 1, n - 1]].filter(([a, b]) => a <= b);
  const parts = [];
  for (const [s0, s1] of ranges) {
    const xa = s0 === 0 ? -len / 2 + inset : -len / 2 + s0 * slot + mull / 2;
    const xb = s1 === n - 1 ? len / 2 - inset : -len / 2 + (s1 + 1) * slot - mull / 2;
    T.push(solid(ctx, xa - mull, xb + mull, y1, y1 + mull, 0.01, 0.07, frame));
    T.push(solid(ctx, xa - mull, xb + mull, y0 - mull, y0, 0.01, 0.08, frame));
    const pz = ctx.lod ? 0.072 : 0.07; // L1: стойки и импосты на 2 мм впереди верхней рейки (она на 0,07) — грани не совпадают
    T.push(plate(ctx, xa - mull, xa, y0 - 0.01, y1 + 0.01, 0.01, pz, frame));
    T.push(plate(ctx, xb, xb + mull, y0 - 0.01, y1 + 0.01, 0.01, pz, frame));
    const bounds = [xa];
    for (let k = s0 + 1; k <= s1; k++) bounds.push(-len / 2 + k * slot);
    bounds.push(xb);
    for (let k = 1; k < bounds.length - 1; k++) T.push(plate(ctx, bounds[k] - mull / 2, bounds[k] + mull / 2, y0 - 0.01, y1 + 0.01, 0.01, pz, frame));
    for (let k = 0; k < bounds.length - 1; k++) {
      const p0 = bounds[k] + (k > 0 ? mull / 2 : 0), p1 = bounds[k + 1] - (k < bounds.length - 2 ? mull / 2 : 0);
      if (p1 - p0 < 0.05) continue;
      ctx.glass.push(pane(p0, p1, y0, y1, 0.015, ctx.paneOpts({ cool })));
      if (!ctx.lod) glazingBead(T, (p0 + p1) / 2, y0, p1 - p0, y1 - y0);
    }
    parts.push([xa, xb]);
  }
  return parts;
}

/** Неоновая полоса на высоте y от x0 до x1 (по умолчанию — вдоль всей стороны без краёв по 0,13). */
function neon(ctx, y, color, x0, x1) {
  if (x0 === undefined) { const h = Math.max(0.025, (ctx.len - 0.26) / 2); x0 = -h; x1 = h; }
  const g = G.place(G.box(x1 - x0, 0.035, 0.03), { x: (x0 + x1) / 2, y, z: 0.025 });
  ctx.glass.push(windowPiece(g, { glow: ctx.golden ? PALETTE.goldGlow : color, lit: 2 }));
}

// ---------- новые детали L0 (§5.2); на L1 — часть из них, проще ----------

/** Наибольший |x| отделки фасада в его координатах: до него доходят окна, ставни и ящики цветов. */
function usedHalf(list) {
  let m = 0;
  for (const g of list) {
    g.computeBoundingBox();
    m = Math.max(m, -g.boundingBox.min.x, g.boundingBox.max.x);
  }
  return m;
}

/**
 * Рустовка углов (координаты этажа, только L0): по камню на угол в каждом из 5 рядов кирпича. Длинный и короткий
 * камни чередуются по рядам и заходят за угол; камень — один брус, его внутренняя часть скрыта в теле. edge — свободный
 * край каждой стороны: камни не ближе GAP к её отделке. Верхний ряд кончается под карнизом. → число камней.
 */
function quoins(out, w, d, edge, color) {
  const LONG = 0.12, SHORT = 0.07, T = 0.025, GAP = 0.015, ROW = FLOOR_H / 5;
  const a = Math.min(LONG, Math.min(edge.front, edge.back) - GAP); // вдоль передней и задней стен
  const b = Math.min(LONG, Math.min(edge.left, edge.right) - GAP); // за углом, вдоль боковых
  if (a < 0.04 || b < 0.04) return 0;
  let k = 0;
  for (let r = 0; r < 5; r++) {
    const y0 = r * ROW + 0.012, y1 = Math.min((r + 1) * ROW - 0.012, CORNICE_Y - 0.054);
    const ax = r % 2 ? Math.min(SHORT, a) : a, bz = r % 2 ? b : Math.min(SHORT, b);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(G.place(G.box(ax + T, y1 - y0, bz + T, color), { x: sx * (w / 2 + (T - ax) / 2), y: (y0 + y1) / 2, z: sz * (d / 2 + (T - bz) / 2) }));
      k++;
    }
  }
  return k;
}

/** Водосточная труба (координаты этажа, только L0): открытый цилиндр во всю высоту этажа; два хомута к углу. */
function downpipe(out, w, d, color) {
  const p = downpipeAt(w, d);
  out.push(G.place(G.colored(new THREE.CylinderGeometry(p.r, p.r, FLOOR_H, 8, 1, true), color), { x: p.x, y: FLOOR_H / 2, z: p.z }));
  for (const y of [0.3, 0.9]) {
    out.push(G.place(G.box(PIPE_OUT * Math.SQRT2, 0.025, 0.02, color), { x: w / 2 + PIPE_OUT / 2, y, z: d / 2 + PIPE_OUT / 2, ry: -Math.PI / 4 }));
  }
}

/** Каменная перемычка над окном дома: над рамой, чуть шире и глубже её. */
function lintel(ctx, cx, yTop, ww) {
  ctx.trim.push(plate(ctx, cx - ww / 2 - 0.09, cx + ww / 2 + 0.09, yTop + 0.005, yTop + 0.085, 0.005, 0.065, ctx.stone));
  ctx.count('lintels');
}

/** Пилястры между витринами магазина, с капителью на L0; room — место от витрины или маркизы до границы слота. */
function shopPilasters(ctx, room) {
  const hp = Math.min(0.06, room - 0.01), hc = Math.min(hp + 0.02, room - 0.005);
  if (hp < 0.02) return;
  const color = ctx.golden ? '#fff1c2' : '#fdf7ee';
  for (let k = 1; k < ctx.n; k++) {
    const b = -ctx.len / 2 + k * ctx.slot;
    ctx.trim.push(plate(ctx, b - hp, b + hp, 0.03, 0.84, 0.005, 0.045, color));
    ctx.count('pilasters');
    if (ctx.lod) continue;
    ctx.trim.push(slab(b - hc, b + hc, 0.84, 0.88, 0.005, 0.065, color));
    ctx.count('capitals');
  }
}

/**
 * Консольная вывеска магазина (только L0): на боковой стороне у переднего угла, над маркизами; справа при чётном
 * варианте, слева при нечётном. Передний угол — x = −len/2 у правой стороны и +len/2 у левой (поворот toFace).
 */
function bladeSign(ctx) {
  if (ctx.lod) return;
  const side = ctx.variant % 2 ? 'left' : 'right';
  if (ctx.face.side !== side || ctx.len < 1.2) return;
  const x = (side === 'right' ? -1 : 1) * (ctx.len / 2 - 0.25);
  ctx.trim.push(slab(x - 0.015, x + 0.015, 1.04, 1.065, 0.005, 0.44, PALETTE.steelDark)); // кронштейн
  ctx.trim.push(slab(x - 0.025, x + 0.025, 0.87, 1.035, 0.1, 0.42, ctx.golden ? '#fff1c2' : '#fff6e8'));
  ctx.trim.push(slab(x - 0.033, x + 0.033, 0.895, 1.01, 0.13, 0.39, ctx.golden ? PALETTE.gold : ctx.drng.pick(ctx.letters)));
  ctx.count('sign');
}

/** Ламели перед внутренними импостами ленты (исходная спецификация §7.2): по границам слотов. */
function louvers(ctx, y0, y1, color) {
  for (let k = 1; k < ctx.n; k++) {
    const b = -ctx.len / 2 + k * ctx.slot;
    ctx.trim.push(solid(ctx, b - 0.015, b + 0.015, y0 - 0.05, y1 + 0.05, 0.075, 0.2, color));
    ctx.count('louvers');
  }
}

/** Отлив под каждым отрезком ленты [xa, xb] (ribbon), ниже нижней рейки. */
function ribbonSill(ctx, parts, y0, mull, color) {
  for (const [xa, xb] of parts) {
    ctx.trim.push(solid(ctx, xa - mull - 0.03, xb + mull + 0.03, y0 - mull - 0.035, y0 - mull - 0.005, 0.005, 0.12, color));
    ctx.count('sills');
  }
}

/** Модульоны под карнизом с шагом 0,25 м, кроме мест над пилястрами (их центры — pilasters); только L0. */
function modillions(ctx, pilasters, color) {
  if (ctx.lod) return;
  const step = 0.25, k = Math.floor((ctx.len - 0.3) / step) + 1;
  for (let i = 0; i < k; i++) {
    const x = (i - (k - 1) / 2) * step;
    if (pilasters.some((b) => Math.abs(x - b) < 0.1)) continue;
    ctx.trim.push(slab(x - 0.025, x + 0.025, 1.035, 1.086, 0.005, 0.035, color));
    ctx.count('modillions');
  }
}

// ---------- вход (§5.3) ----------

/** Отрезки [x0, x1] без проёма двери ctx.doorGap: сплошные пояса фасада разрываются у входа. */
function spans(ctx, x0, x1) {
  const g = ctx.doorGap;
  if (!g) return [[x0, x1]];
  return [[x0, Math.min(x1, g[0])], [Math.max(x0, g[1]), x1]].filter(([a, b]) => b - a > 0.02);
}

/**
 * Фонарь у деревянной двери. L0: кронштейн, колпак, светящийся корпус (материал окон — горит ночью), основание.
 * L1: колпак и тёплая плоскость в отделке — не в стекле: ночная раскладка города перебирает стёкла (Task 12).
 */
function lantern(ctx, x) {
  const T = ctx.trim, dark = '#3a3f47';
  ctx.count('lantern');
  if (ctx.lod) {
    T.push(facadeBox(x - 0.06, x + 0.06, 0.74, 0.77, 0.005, 0.21, dark));
    T.push(quad(x - 0.04, x + 0.04, 0.625, 0.74, 0.19, PALETTE.goldGlow));
    return;
  }
  T.push(slab(x - 0.015, x + 0.015, 0.745, 0.765, 0.005, 0.11, dark));
  T.push(slab(x - 0.06, x + 0.06, 0.74, 0.77, 0.09, 0.21, dark));
  T.push(slab(x - 0.05, x + 0.05, 0.6, 0.62, 0.1, 0.2, dark));
  ctx.glass.push(windowPiece(G.place(G.box(0.08, 0.115, 0.08), { x, y: 0.68, z: 0.15 }), { glow: ctx.golden ? PALETTE.goldGlow : PALETTE.glassLit, lit: 1 }));
}

/**
 * Дверь вместо окна ctx.skip передней стороны: рама, полотно (дерево с филёнками и фонарём или стекло с планкой и
 * поручнем), над ней козырёк (у магазина — маркиза, как над витринами), перед ней ступенька.
 * L1: рама — одна плоскость за полотном, полотно — плоскость, без филёнок и ручки; козырёк и ступенька — L1_OUT.
 */
function entryDoor(ctx, cx, S) {
  const T = ctx.trim, g = ctx.golden, fb = DOOR_BAR;
  const top = S.doorTop ?? DOOR_TOP, ft = top + fb, x0 = cx - DOOR_W / 2, x1 = cx + DOOR_W / 2;
  const frame = g ? '#fff1c2' : S.doorFrame;
  if (ctx.lod) T.push(quad(x0 - fb, x1 + fb, DOOR_Y0, ft, 0.008, frame));
  else {
    T.push(slab(x0 - fb, x0, DOOR_Y0, ft, 0.005, 0.06, frame));
    T.push(slab(x1, x1 + fb, DOOR_Y0, ft, 0.005, 0.06, frame));
    T.push(slab(x0, x1, top, ft, 0.005, 0.06, frame));
  }
  if (S.door === 'wood') {
    T.push(plate(ctx, x0, x1, DOOR_Y0, top, 0.005, 0.03, g ? '#e0b84a' : PALETTE.woodDark));
    if (!ctx.lod) {
      for (const [a, b] of [[DOOR_Y0 + 0.08, DOOR_Y0 + 0.34], [DOOR_Y0 + 0.42, top - 0.08]]) {
        T.push(slab(x0 + 0.07, x1 - 0.07, a, b, 0.03, 0.04, g ? '#ffe08a' : PALETTE.wood));
      }
      T.push(slab(x1 - 0.11, x1 - 0.07, 0.47, 0.51, 0.03, 0.06, PALETTE.gold)); // ручка
    }
    lantern(ctx, x1 + fb + 0.12);
  } else {
    ctx.glass.push(pane(x0, x1, DOOR_Y0, top, 0.015, ctx.paneOpts({ noCurtain: true })));
    T.push(plate(ctx, x0, x1, DOOR_Y0, DOOR_Y0 + 0.1, 0.02, 0.04, frame)); // нижняя планка
    T.push(plate(ctx, x0 + 0.08, x1 - 0.08, 0.45, 0.48, 0.04, 0.06, frame)); // поручень
  }
  if (S.awning) awning(ctx, cx, ft + 0.005, Math.min(DOOR_W + 2 * fb + 0.16, ctx.slot - 0.04), ctx.skip);
  else T.push(solid(ctx, x0 - fb - 0.12, x1 + fb + 0.12, ft + 0.005, ft + 0.045, 0.005, ctx.lod ? L1_OUT : CANOPY_D, g ? '#fff1c2' : S.door === 'wood' ? PALETTE.woodDark : frame));
  T.push(solid(ctx, x0 - 0.12, x1 + 0.12, 0, DOOR_Y0, 0.005, ctx.lod ? L1_OUT : STEP_D, g ? '#e9d9a6' : '#cfc8bb'));
  ctx.count('door');
}

/** Цоколь входного этажа (координаты этажа): кольцо вокруг низа тела; низ на 4 мм ниже этажа — без общей грани с дном. */
function plinth(out, w, d, color) {
  const h = PLINTH_H + 0.004;
  out.push(G.place(G.box(w + 2 * PLINTH_OUT, h, d + 2 * PLINTH_OUT, color), { y: PLINTH_H - h / 2 }));
}

// ---------- стили ----------

function buildHouse(ctx) {
  const { face, n, slot, centers, rng } = ctx;
  const ww = Math.min(0.6, slot - 0.3), wh = 0.6, y0 = 0.3, bar = 0.05;
  centers.forEach((cx, i) => {
    if (i === ctx.skip) return; // слот двери (entryDoor)
    const room = slot / 2 - ww / 2 - bar;
    const bw = ww + 0.5;
    const hasBalcony = face.side === 'front' && n >= 3 && i === (n >> 1) && ctx.variant % 2 === 0 && bw / 2 <= slot / 2 - 0.03;
    windowUnit(ctx, cx, y0, ww, wh, { room, sill: !hasBalcony });
    lintel(ctx, cx, y0 + wh + bar, ww);
    if (hasBalcony) balcony(ctx, cx, y0, bw);
    else if (rng.next() < 0.4) flowerBox(ctx, cx, y0 - bar - 0.045, ww);
    if (ctx.variant !== 3 && room >= Math.min(0.17, ww * 0.42) + 0.04) shutters(ctx, cx, y0, ww, wh, bar, ctx.shutter);
  });
}

// Вывески эмалью. Точки литеры на сетке 2×4, соседние точки образуют мазок.
const SHOP_SIGNS = ['ЛАВКА', 'ХЛЕБ', 'ЧАЙ', 'МОДА'];
const SIGN_STROKES = {
  Л: ['04102024'], А: ['041024', '0323'], В: ['0400202102222404'], К: ['0004', '200224'],
  Х: ['0024', '2004'], Е: ['20000424', '0222'], Б: ['200004242202'],
  Ч: ['000222', '2024'], Й: ['01042124', '001020'], М: ['0400122024'],
  О: ['0004242000'], Д: ['0403102023', '0323', '2324'],
};
/** Объединённые лицевые мазки, ширина и высота в метрах. Вывеску крыши читает камера сверху. */
export function shopLettering(word, width, height, y, z, color) {
  const spacing = Math.min(width / word.length, height * 1.35), sx = spacing * 0.33, sy = height * 0.25;
  const points = [], indices = [], stroke = height * 0.065;
  for (let i = 0; i < word.length; i++) {
    const x = (i - (word.length - 1) * 0.5) * spacing - sx;
    for (const path of SIGN_STROKES[word[i]]) {
      for (let j = 2; j < path.length; j += 2) {
        const x0 = x + Number(path[j - 2]) * sx, y0 = y + (2 - Number(path[j - 1])) * sy;
        const x1 = x + Number(path[j]) * sx, y1 = y + (2 - Number(path[j + 1])) * sy;
        const dx = x1 - x0, dy = y1 - y0, k = stroke / Math.hypot(dx, dy), nx = -dy * k, ny = dx * k;
        const v = points.length / 3;
        points.push(x0 + nx, y0 + ny, z, x0 - nx, y0 - ny, z, x1 + nx, y1 + ny, z, x1 - nx, y1 - ny, z);
        indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setIndex(indices); g.computeVertexNormals();
  return G.colored(g, color);
}

function buildShop(ctx) {
  const { face, len, slot, centers } = ctx;
  const ww = Math.max(0.24, Math.min(1.0, slot - 0.26)), wh = 0.58, y0 = 0.14, bar = 0.055;
  const kick = ctx.golden ? '#e0b84a' : '#8a6f7f', aw = Math.min(ww + 0.16, slot - 0.04);
  centers.forEach((cx, i) => {
    if (i === ctx.skip) return; // слот двери (entryDoor)
    windowUnit(ctx, cx, y0, ww, wh, { frame: ctx.golden ? '#fff1c2' : '#fdf7ee', bar, cross: false, crossV: ww > 0.6, sill: false, noCurtain: true });
    ctx.trim.push(plate(ctx, cx - ww / 2 - bar, cx + ww / 2 + bar, 0.03, y0 - bar - 0.002, 0.01, 0.05, kick));
    awning(ctx, cx, y0 + wh + bar + 0.07, aw, i);
  });
  shopPilasters(ctx, slot / 2 - Math.max(ww / 2 + bar, aw / 2));
  if (face.side === 'front' && len >= 1.2) {
    const sw = Math.min(len * 0.55, 1.8);
    ctx.trim.push(solid(ctx, -sw / 2, sw / 2, 0.9, 1.06, 0.01, 0.055, '#fff6e8', 0.02));
    const k = Math.floor((sw - 0.16) / 0.11);
    for (let j = 0; j < k; j++) ctx.rng.pick(ctx.letters); // ночная заселённость других сторон хранит прежнюю последовательность
    ctx.trim.push(shopLettering(SHOP_SIGNS[ctx.variant], sw - 0.14, 0.105, 0.981, 0.058, ctx.golden ? '#856738' : '#53695f'));
  }
  bladeSign(ctx);
}

/**
 * Маркиза над витриной: полосы двух цветов, наклон ang, клапан на конце. L1: полотно одним брусом цвета c1 глубиной
 * L1_AWNING, светлые полосы — плоскости на 3 мм над ним (не больше трёх), клапан — одна плоскость.
 */
function awning(ctx, cx, yh, aw, i) {
  const depth = ctx.lod ? L1_AWNING : 0.4, ang = 0.42, k = Math.max(3, Math.round(aw / 0.16)), sw = aw / k;
  const c1 = ctx.golden ? PALETTE.gold : ctx.awnings[(i + ctx.variant) % ctx.awnings.length], c2 = '#fffaf2';
  const ey = yh - depth * Math.sin(ang), ez = 0.03 + depth * Math.cos(ang);
  if (ctx.lod) {
    const cloth = G.place(facadeBox(-aw / 2, aw / 2, -0.0125, 0.0125, 0, depth, c1), { rx: ang });
    ctx.trim.push(G.place(cloth, { x: cx, y: yh, z: 0.03 }));
    for (let j = 1; j < k && j < 7; j += 2) {
      const s = G.place(G.colored(new THREE.PlaneGeometry(sw, depth), c2), { x: -aw / 2 + sw * (j + 0.5), y: 0.0155, z: depth / 2, rx: -Math.PI / 2 });
      ctx.trim.push(G.place(G.place(s, { rx: ang }), { x: cx, y: yh, z: 0.03 }));
    }
    ctx.trim.push(quad(cx - aw / 2, cx + aw / 2, ey - 0.08, ey, ez + 0.008, c1));
    return;
  }
  for (let j = 0; j < k; j++) {
    const x = cx - aw / 2 + sw * (j + 0.5), color = j % 2 ? c2 : c1;
    const points = [], index = [];
    for (let l = 0; l <= 4; l++) {
      const t = l * 0.25, top = yh - depth * Math.sin(ang) * t - 0.019 * Math.sin(Math.PI * t);
      const z = 0.03 + depth * Math.cos(ang) * t;
      points.push(x - sw / 2, top, z, x + sw / 2, top, z);
      if (l) { const a = (l - 1) * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    for (let l = 0; l <= 6; l++) {
      const t = l / 6, X = x + (t - 0.5) * sw;
      points.push(X, ey + 0.001, ez + 0.002, X, ey - 0.047 - 0.032 * Math.sin(Math.PI * t), ez + 0.005);
      if (l) { const a = 10 + (l - 1) * 2; index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    }
    for (let l = 0; l < 10; l++) points.push(points[l * 3], points[l * 3 + 1] - 0.004, points[l * 3 + 2]);
    for (let l = 0; l < 24; l += 3) index.push(24 + index[l], 24 + index[l + 2], 24 + index[l + 1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setIndex(index); g.computeVertexNormals();
    ctx.trim.push(G.colored(g, color));
  }
  for (const side of [-1, 1]) {
    const x = cx + side * (aw * 0.46);
    ctx.trim.push(G.beam([x, yh - 0.17, 0.035], [x, ey - 0.008, ez - 0.02], 0.014, '#69756e'));
  }
}

function buildOffice(ctx) {
  const g = ctx.golden;
  const parts = ribbon(ctx, { y0: 0.3, y1: 0.98, frame: g ? '#fff1c2' : '#9aa6b4', cool: 0.45 });
  for (const [a, b] of spans(ctx, -ctx.len / 2 + 0.12, ctx.len / 2 - 0.12)) ctx.trim.push(plate(ctx, a, b, 0.1, 0.16, 0.01, 0.05, g ? '#fff1c2' : '#e9eef3'));
  const side = ctx.face.side === 'left' || ctx.face.side === 'right';
  // порядок вызовов основного rng — прежний: окна прежних этажей не меняются
  const ac = side && ctx.rng.next() < 0.5 && ctx.len >= 1.2;
  if (ac) { acUnit(ctx, ctx.rng.pick(ctx.centers), 0.03); ctx.count('ac'); }
  louvers(ctx, 0.3, 0.98, g ? '#fff1c2' : '#c3ccd6');
  if (!ac) ribbonSill(ctx, parts, 0.3, 0.06, g ? '#fff1c2' : '#d5dce4'); // кондиционер стоит на месте отлива
}

function buildTower(ctx) {
  const { len, n, slot, centers } = ctx;
  const gold = ctx.golden ? '#fff3c4' : PALETTE.gold, panel = ctx.golden ? '#fff3c4' : '#e6edf5', y0 = 0.12, y1 = 1.02;
  centers.forEach((cx, i) => {
    if (i === ctx.skip) return; // слот двери (entryDoor)
    const ww = Math.max(0.24, slot - 0.18);
    ctx.glass.push(pane(cx - ww / 2, cx + ww / 2, y0, y1, 0.015, ctx.paneOpts({ cool: 0.5 })));
    if (!ctx.lod) glazingBead(ctx.trim, cx, y0, ww, y1 - y0);
    ctx.trim.push(plate(ctx, cx - ww / 2 - 0.01, cx + ww / 2 + 0.01, 0.74, 0.77, 0.022, 0.045, '#e6edf5'));
    // панель перед низом стекла, 1,5 см (§5.2); уже рамы, чтобы торцы не совпали с крайними пилястрами
    ctx.trim.push(plate(ctx, cx - ww / 2 - 0.005, cx + ww / 2 + 0.005, y0, 0.3, 0.02, 0.035, panel));
    ctx.count('panels');
  });
  const lim = len / 2 - 0.12;
  for (let k = 0; k <= n; k++) {
    const b = Math.max(-lim, Math.min(lim, -len / 2 + k * slot));
    ctx.trim.push(solid(ctx, b - 0.04, b + 0.04, 0.03, 1.07, 0.01, 0.09, gold, 0.02));
    if (ctx.lod) continue;
    ctx.trim.push(slab(b - 0.06, b + 0.06, 0.99, 1.075, 0.005, 0.11, gold)); // золотая капитель
    ctx.count('capitals');
  }
  for (const [a, b] of spans(ctx, -lim, lim)) ctx.trim.push(plate(ctx, a, b, 0.05, 0.1, 0.01, 0.07, gold));
}

/** Свет включённых и пустых офисов. Карта перерисовывает занятость для каждого участка в тех же пределах. */
export const officeLight = (rng, golden = false) => golden ? rng.uniform(0.65, 1) : rng.next() < 0.57 ? rng.uniform(0.43, 0.94) : rng.uniform(0.01, 0.055);
const OFFICE_TINT = ['#ffe0ab', '#f8d6a1', '#d3e6ed', '#b8d9ed'];

/** Секционный навесной фасад. Крупные рёбра стоят на стыках модулей, тонкие импосты делят остекление. */
function buildNightTower(ctx) {
  const { len, centers, slot, lod, drng, golden } = ctx;
  const edge = len / 2 - 0.085;
  for (const [i, cx] of centers.entries()) {
    if (i === ctx.skip) continue;
    const x0 = Math.max(-edge, cx - slot / 2 + 0.039), x1 = Math.min(edge, cx + slot / 2 - 0.039);
    ctx.glass.push(pane(x0 + 0.012, x1 - 0.012, 0.202, 1.055, 0.014, {
      glow: golden ? '#ffcb7d' : drng.pick(OFFICE_TINT), lit: officeLight(drng, golden), room: drng.int(0, 3),
    }));
    if (ctx.bare) {
      if (x1 - x0 > 0.72) ctx.trim.push(quad(cx - 0.014, cx + 0.014, 0.183, 1.071, 0.051, '#697473'));
      continue;
    }
    ctx.trim.push(quad(x0 - 0.007, x1 + 0.007, 0.182, 1.073, 0.009, '#222a2b'));
    if (x1 - x0 > 0.72) ctx.trim.push(plate(ctx, cx - 0.014, cx + 0.014, 0.182, 1.073, 0.016, 0.051, '#66716f'));
    if (!lod) ctx.trim.push(facadeBox(x0, x1, 0.885, 0.900, 0.015, 0.044, '#646d70'));
    // Перед каждым торцом перекрытия своя кассета. Между соседними кассетами остаётся монтажный шов.
    ctx.trim.push(plate(ctx, x0, x1, 0.024, 0.177, 0.008, 0.032, golden ? '#cfaa66' : '#647079'));
    if (!lod) ctx.trim.push(G.place(G.box(x1 - x0, 0.016, 0.064, '#98a09e'), { x: (x0 + x1) / 2, y: 0.18, z: 0.043, rx: 0.11 }));
  }
  for (let i = 0; i <= ctx.n; i++) {
    const outer = i === 0 || i === ctx.n;
    const x = outer ? (i === 0 ? -edge : edge) : -len / 2 + slot * i;
    const half = outer ? 0.037 : 0.026, depth = outer ? 0.088 : 0.063;
    const frame = golden ? '#dfba73' : outer ? '#8e9695' : '#747f80';
    if (ctx.bare || (lod && !outer)) ctx.trim.push(quad(x - half, x + half, 0.006, 1.109, depth, frame));
    else ctx.trim.push(facadeBox(x - half, x + half, 0.006, 1.109, 0.004, depth, frame));
  }
}

function buildOld(ctx) {
  const { slot, centers, rng } = ctx;
  const ww = Math.max(0.2, Math.min(0.4, slot - 0.36)), wh = 0.64, y0 = 0.24, bar = 0.05, y1 = y0 + wh;
  const stone = ctx.golden ? '#fff1c2' : '#efe2c8';
  centers.forEach((cx, i) => {
    if (i === ctx.skip) return; // слот двери (entryDoor)
    const room = slot / 2 - ww / 2 - bar;
    windowUnit(ctx, cx, y0, ww, wh, { frame: ctx.golden ? '#fff1c2' : '#6b4430', sillColor: stone, room });
    // перемычка и замковый камень; на L1 — плоскости на 1,5 см друг от друга
    ctx.trim.push(plate(ctx, cx - ww / 2 - Math.min(0.1, room), cx + ww / 2 + Math.min(0.1, room), y1 + bar, y1 + bar + 0.1, 0.01, 0.07, stone, 0.015));
    ctx.trim.push(plate(ctx, cx - 0.05, cx + 0.05, y1 + bar - 0.02, y1 + bar + 0.13, 0.02, 0.085, light(stone, 0.4), 0.01));
    if (room >= Math.min(0.17, ww * 0.42) + 0.04) shutters(ctx, cx, y0, ww, wh, bar, '#4f7d55');
    if (rng.next() < 0.25) flowerBox(ctx, cx, y0 - bar - 0.045, ww);
  });
}

function buildClassic(ctx) {
  const { face, n, len, slot, centers, rng } = ctx;
  const ww = Math.max(0.2, Math.min(0.5, slot - 0.4)), wh = 0.62, y0 = 0.28, bar = 0.05, y1 = y0 + wh;
  const pil = ctx.golden ? '#fff1c2' : '#fbf1dc', lim = len / 2 - 0.14, bs = [];
  for (let k = 0; k <= n; k++) {
    const b = Math.max(-lim, Math.min(lim, -len / 2 + k * slot));
    ctx.trim.push(plate(ctx, b - 0.06, b + 0.06, 0.02, 1.07, 0.01, 0.05, pil, 0.015));
    bs.push(b);
  }
  centers.forEach((cx, i) => {
    if (i === ctx.skip) return; // слот двери (entryDoor)
    const room = slot / 2 - ww / 2 - bar - 0.06;
    const bw = ww + 0.4;
    const hasBalcony = face.side === 'front' && i === (n >> 1) && ctx.variant >= 2 && bw / 2 <= slot / 2 - 0.08;
    windowUnit(ctx, cx, y0, ww, wh, { frame: ctx.golden ? '#fff1c2' : PALETTE.white, room, sill: !hasBalcony });
    ctx.trim.push(plate(ctx, cx - ww / 2 - Math.min(0.1, room), cx + ww / 2 + Math.min(0.1, room), y1 + bar + 0.02, y1 + bar + 0.08, 0.01, 0.09, pil, 0.015));
    if (hasBalcony) balcony(ctx, cx, y0, bw);
    else if (rng.next() < 0.3) flowerBox(ctx, cx, y0 - bar - 0.045, ww);
  });
  modillions(ctx, bs, pil);
}

function buildModern(ctx) {
  const g = ctx.golden;
  const parts = ribbon(ctx, { y0: 0.28, y1: 1.0, frame: g ? '#fff1c2' : '#3c4552', cool: 0.5 });
  const spots = ctx.centers.filter((_, i) => i !== ctx.skip); // не перед дверью; без двери — те же центры и тот же rng
  const ac = ctx.rng.next() < 0.5 && ctx.len >= 1.2 && spots.length > 0;
  if (ac) { acUnit(ctx, ctx.rng.pick(spots), 0.02); ctx.count('ac'); }
  louvers(ctx, 0.28, 1.0, g ? '#fff1c2' : '#59626e');
  if (!ac) ribbonSill(ctx, parts, 0.28, 0.06, g ? '#fff1c2' : '#6b7480');
}

function buildFuture(ctx) {
  ribbon(ctx, { y0: 0.3, y1: 0.96, frame: ctx.golden ? '#fff1c2' : '#ffffff', mull: 0.04, cool: 0.7 });
  const c = ctx.variant % 2 ? PALETTE.neonPink : PALETTE.neonCyan, h = Math.max(0.025, (ctx.len - 0.26) / 2);
  for (const [a, b] of spans(ctx, -h, h)) neon(ctx, 0.13, c, a, b); // нижний неон разрывается у двери
  neon(ctx, 1.035, c);
}

function sparkles(ctx) {
  const { rng, len } = ctx, k = Math.max(1, Math.min(6, Math.round(len * 1.5)));
  for (let i = 0; i < k; i++) {
    const r = rng.uniform(0.035, 0.07);
    const g = G.colored(new THREE.OctahedronGeometry(r, 0), '#fffbe8');
    G.place(g, { rx: rng.uniform(0, 1), ry: rng.uniform(0, 1) });
    ctx.trim.push(G.place(g, { x: rng.uniform(-len / 2 + 0.15, len / 2 - 0.15), y: rng.uniform(0.1, 1.0), z: 0.012 + r }));
  }
}

// ---------- спец-этажи (спецификация «Спец-этажи» §6) ----------

/** Ночной свет окон спец-этажа (§6.1, §8): доля освещённых и пределы яркости; штор нет. Его же берёт город (relight). */
export const SPECIAL_NIGHT = Object.freeze({ share: 0.9, lo: 0.7, hi: 1 });
/** Консольная плита балкона (§6.4): низ и верх, вылет на L0 и на L1, заход в стену. */
const SLAB_Y0 = 0.08, SLAB_Y1 = 0.15, SLAB_OUT = 0.34, SLAB_OUT_L1 = 0.24, SLAB_IN = 0.05;
/** Цветы оранжереи (§6.2) — по кругу, без rng: расход генератора окон не зависит от отделки и bare. */
const BLOOMS = ['#ff6f91', '#ffd166', '#ff9248', '#c38bff'];
const GREENS = ['#429b46', '#68c15f', '#2f7d38'];

/**
 * Вид спец-этажа (§6.2–§6.4): слой и цвет корпуса, карниз, свечение окон, стекло [низ, верх, доля слота], сборка сторон.
 * Стекло не шире slot − 0,2: у углов остаётся место колоннам (план, отличие 4).
 */
const SPECIAL_LOOK = {
  atrium: { layer: WALL.composite, body: '#d4ece2', cornice: '#3d6b60', glow: '#b8f5e8', glass: [0.16, 1.04, 0.86], build: buildAtrium },
  loft: { layer: WALL.brick, body: '#8c4a3b', cornice: '#2b313a', glow: '#ffcf7c', glass: [0.22, 0.98, 0.72], build: buildLoft },
  balcony: { layer: WALL.plaster, body: '#f5e8d0', cornice: '#e2c799', glow: PALETTE.glassLit, glass: [0.16, 0.98, 0.6], build: buildBalcony },
};

/** Стёкла стороны (по одному 4-вершинному квадру на окно, §6.1) и блики L0 → окна [{ cx, x0, x1, y0, y1 }]. */
function specialPanes(ctx) {
  const [y0, y1, share] = ctx.look.glass, out = [];
  for (const cx of ctx.centers) {
    const gw = Math.min(share * ctx.slot, ctx.slot - 0.2), x0 = cx - gw / 2, x1 = cx + gw / 2;
    ctx.glass.push(pane(x0, x1, y0, y1, 0.015, ctx.paneOpts()));
    if (!ctx.lod && !ctx.offices) glazingBead(ctx.trim, cx, y0, gw, y1 - y0);
    out.push({ cx, x0, x1, y0, y1 });
  }
  return out;
}

/** Рама окна: четыре бруска на L0, одна плоскость за стеклом на L1 (как windowUnit). */
function specialFrame(ctx, p, bar, color, z1 = 0.06) {
  const T = ctx.trim;
  if (ctx.lod) { T.push(quad(p.x0 - bar, p.x1 + bar, p.y0 - bar, p.y1 + bar, 0.008, color)); return; }
  T.push(slab(p.x0 - bar, p.x0, p.y0 - bar, p.y1 + bar, 0.01, z1, color));
  T.push(slab(p.x1, p.x1 + bar, p.y0 - bar, p.y1 + bar, 0.01, z1, color));
  T.push(slab(p.x0, p.x1, p.y1, p.y1 + bar, 0.01, z1, color));
  T.push(slab(p.x0, p.x1, p.y0 - bar, p.y0, 0.01, z1, color));
}

/** Точки с шагом около step между a и b (концы включены); на отрезке короче step — середина. */
function steps(a, b, step) {
  const k = Math.round((b - a) / step);
  if (!(k >= 1)) return [(a + b) / 2];
  return Array.from({ length: k + 1 }, (_, i) => a + ((b - a) * i) / k);
}

const AT_DARK = '#2b4c43', AT_LIGHT = '#487a6d', POT = '#9c5a3c';

/** Подоконный выступ, кадки, зелень и цветы под витражом (§6.2); на L1 — брус кадки и полоса зелени. */
function atriumPlanters(ctx, p, bar) {
  const T = ctx.trim, ww = p.x1 - p.x0, top = p.y0 - bar;
  if (ctx.lod) {
    T.push(facadeBox(p.x0 - 0.03, p.x1 + 0.03, 0.05, top + 0.08, 0.005, 0.2, POT));
    T.push(quad(p.x0 + 0.02, p.x1 - 0.02, top + 0.08, top + 0.19, 0.16, GREENS[0]));
    ctx.count('planters');
    return;
  }
  T.push(slab(p.x0 - 0.06, p.x1 + 0.06, top - 0.04, top, 0.005, 0.22, AT_LIGHT));
  const k = Math.max(1, Math.floor(ww / 0.45));
  for (let i = 0; i < k; i++) {
    const x = p.x0 + (ww * (i + 0.5)) / k, y = top + 0.06;
    T.push(G.place(G.cylinder(0.08, 0.06, 0.12, 8, POT), { x, y, z: 0.12 }));
    T.push(G.place(G.sphere(0.075, 6, 4, GREENS[0]), { x: x - 0.05, y: y + 0.13, z: 0.12 }));
    T.push(G.place(G.sphere(0.065, 6, 4, GREENS[1]), { x: x + 0.045, y: y + 0.12, z: 0.13 }));
    T.push(G.place(G.sphere(0.06, 6, 4, GREENS[2]), { x, y: y + 0.18, z: 0.11 }));
    const blooms = [[-0.07, 0.17, 0.17], [0, 0.23, 0.15], [0.06, 0.16, 0.18], [-0.02, 0.12, 0.2], [0.08, 0.1, 0.16]];
    for (let j = 0; j < 4 + (i % 2); j++) {
      const [bx, by, bz] = blooms[j];
      T.push(G.place(G.sphere(0.028, 4, 2, BLOOMS[(i * 2 + j) % BLOOMS.length]), { x: x + bx, y: y + by, z: bz }));
    }
    ctx.count('planters');
  }
}

/**
 * «Стеклянная оранжерея» (§6.2): витражи почти во всю высоту, рама, фрамуга, импосты и косынки (L0), стойки между
 * витражами, фриз под карнизом, подоконные кадки с зеленью (без bare). Угловые колонны — atriumCorners.
 */
function buildAtrium(ctx) {
  const T = ctx.trim, bar = 0.045;
  for (const p of specialPanes(ctx)) {
    specialFrame(ctx, p, bar, AT_DARK);
    T.push(plate(ctx, p.x0, p.x1, 0.85, 0.875, 0.02, ctx.lod ? 0.03 : 0.05, AT_LIGHT)); // фрамуга
    if (!ctx.lod) {
      const ww = p.x1 - p.x0, lights = Math.max(1, Math.round(ww / 0.4));
      for (let j = 1; j < lights; j++) {
        const x = p.x0 + (ww * j) / lights;
        T.push(slab(x - 0.012, x + 0.012, p.y0, p.y1, 0.02, 0.045, AT_LIGHT));
        ctx.count('mullions');
      }
      // косынки — диагонали под 45° в верхних углах (план, отличие 5)
      const g = Math.min(0.14, ww / 4);
      T.push(G.beam([p.x0, p.y1 - g, 0.035], [p.x0 + g, p.y1, 0.035], 0.022, AT_LIGHT));
      T.push(G.beam([p.x1, p.y1 - g, 0.035], [p.x1 - g, p.y1, 0.035], 0.022, AT_LIGHT));
    }
    if (!ctx.bare) atriumPlanters(ctx, p, bar);
  }
  for (let k = 1; k < ctx.n; k++) {
    const b = -ctx.len / 2 + k * ctx.slot;
    T.push(solid(ctx, b - 0.04, b + 0.04, 0.06, 1.085, 0.005, 0.075, AT_DARK));
    ctx.count('posts');
  }
  if (ctx.len > 0.3) T.push(solid(ctx, -ctx.len / 2 + 0.05, ctx.len / 2 - 0.05, 1.045, 1.085, 0.005, 0.05, AT_LIGHT)); // фриз
}

/** Угловые колонны оранжереи (координаты этажа): квадратный брус 0,1 м на каждом углу корпуса, до карниза. */
function atriumCorners(out, w, d) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(G.place(G.box(0.1, CORNICE_Y - 0.05, 0.1, AT_DARK), { x: sx * w / 2, y: (CORNICE_Y - 0.05) / 2, z: sz * d / 2 }));
}

const LF_IRON = '#323942', LF_STEEL = '#454e59', LF_RIVET = '#9aa5b4';

/** Заклёпки с шагом около 0,25 м на высоте y и глубине z, от a до b (только L0). */
function rivets(ctx, a, b, y, z) {
  for (const x of steps(a, b, 0.25)) {
    ctx.trim.push(G.place(G.sphere(0.012, 4, 2, LF_RIVET), { x, y, z }));
    ctx.count('rivets');
  }
}

/**
 * «Чугунный лофт» (§6.3): фабричные окна в стальной раме с подоконником, переплёт 3×3 (L1 — крест; без bare),
 * клёпаные косынки (L0), двутавровые колонны у углов, цокольный рельс, подкарнизная балка, X-раскосы демпфера в
 * простенках не уже 0,3 м (L0).
 */
function buildLoft(ctx) {
  const T = ctx.trim, { len, lod } = ctx, bar = 0.04;
  const panes = specialPanes(ctx);
  for (const p of panes) {
    specialFrame(ctx, p, bar, LF_IRON, 0.055);
    T.push(solid(ctx, p.x0 - bar - 0.02, p.x1 + bar + 0.02, p.y0 - bar - 0.035, p.y0 - bar, 0.005, lod ? 0.09 : 0.1, LF_STEEL));
    if (!ctx.bare) {
      const ww = p.x1 - p.x0, hh = p.y1 - p.y0, cuts = lod ? [0.5] : [1 / 3, 2 / 3];
      // горизонтальные планки на 1 мм впереди вертикальных: лица не совпадают в перекрестьях (план, отличие 6)
      for (const t of cuts) T.push(plate(ctx, p.x0 + ww * t - 0.011, p.x0 + ww * t + 0.011, p.y0, p.y1, 0.015, 0.035, LF_IRON));
      for (const t of cuts) T.push(plate(ctx, p.x0, p.x1, p.y0 + hh * t - 0.011, p.y0 + hh * t + 0.011, 0.015, 0.036, LF_IRON));
      ctx.count('muntins');
    }
    if (!lod) {
      for (const [x, y, sx, sy] of [[p.x0 - bar, p.y0 - bar, 1, 1], [p.x1 + bar, p.y0 - bar, -1, 1], [p.x0 - bar, p.y1 + bar, 1, -1], [p.x1 + bar, p.y1 + bar, -1, -1]]) {
        T.push(slab(Math.min(x, x + sx * 0.08), Math.max(x, x + sx * 0.08), Math.min(y, y + sy * 0.08), Math.max(y, y + sy * 0.08), 0.055, 0.065, LF_STEEL));
        T.push(G.place(G.sphere(0.011, 4, 2, LF_RIVET), { x: x + sx * 0.04, y: y + sy * 0.04, z: 0.07 }));
      }
      ctx.count('gussets', 4);
    }
  }
  const col = len >= 0.5, lim = col ? len / 2 - 0.13 : len / 2 - 0.02;
  if (col) {
    for (const s of [-1, 1]) {
      const x = s * (len / 2 - 0.08);
      if (lod) T.push(facadeBox(x - 0.05, x + 0.05, 0, CORNICE_Y - 0.05, 0.005, 0.085, LF_IRON));
      else {
        T.push(slab(x - 0.05, x + 0.05, 0, CORNICE_Y - 0.05, 0.06, 0.085, LF_IRON)); // полка
        T.push(slab(x - 0.015, x + 0.015, 0, CORNICE_Y - 0.05, 0.005, 0.06, LF_IRON)); // стенка
      }
      ctx.count('columns');
    }
  }
  if (lim > 0.03) {
    T.push(solid(ctx, -lim, lim, 0.03, 0.11, 0.005, 0.06, LF_STEEL)); // цокольный рельс
    if (lod) T.push(facadeBox(-lim, lim, 1.025, 1.085, 0.005, 0.07, LF_STEEL));
    else {
      T.push(slab(-lim, lim, 1.025, 1.04, 0.005, 0.08, LF_STEEL)); // подкарнизная балка: полки и стенка
      T.push(slab(-lim, lim, 1.04, 1.07, 0.005, 0.05, LF_STEEL));
      T.push(slab(-lim, lim, 1.07, 1.085, 0.005, 0.08, LF_STEEL));
      rivets(ctx, -lim + 0.05, lim - 0.05, 0.07, 0.064);
      rivets(ctx, -lim + 0.05, lim - 0.05, 1.055, 0.054);
    }
  }
  if (lod) return;
  for (let k = 1; k < panes.length; k++) {
    const a = panes[k - 1].x1 + bar, b = panes[k].x0 - bar, pier = panes[k].x0 - panes[k - 1].x1;
    if (pier < 0.3) continue;
    const c = (a + b) / 2, h = (b - a) / 2 - 0.03;
    T.push(G.beam([c - h, 0.27, 0.03], [c + h, 0.93, 0.03], 0.024, LF_STEEL));
    T.push(G.beam([c + h, 0.27, 0.03], [c - h, 0.93, 0.03], 0.024, LF_STEEL));
    T.push(G.place(G.cylinder(0.038, 0.038, 0.03, 10, LF_RIVET), { x: c, y: 0.6, z: 0.045, rx: Math.PI / 2 })); // демпфер
    ctx.count('braces');
  }
}

const BL_FRAME = '#fffaf0', BL_STONE = '#e2c799', BL_SLAB = '#ece0c8', BL_BRACKET = ['#c8a675', '#7c5c3e'], BL_TOPIARY = '#58b44f';

/**
 * «Консольный балкон» (§6.4): французские окна-двери с импостом и фрамугой (без bare) и сандриками (L0); консольная
 * плита во всю сторону (угловые квадраты вылета пусты); L0 — балюстрада с тумбами и топиариями, ступенчатые
 * кронштейны (план, отличие 7); L1 — сплошной парапет и два кронштейна; bare — только плита.
 */
function buildBalcony(ctx) {
  const T = ctx.trim, { len, lod } = ctx, out = lod ? SLAB_OUT_L1 : SLAB_OUT;
  for (const p of specialPanes(ctx)) {
    specialFrame(ctx, p, 0.05, BL_FRAME);
    if (!ctx.bare) {
      T.push(plate(ctx, p.cx - 0.015, p.cx + 0.015, p.y0, p.y1, 0.02, 0.045, BL_FRAME));
      T.push(plate(ctx, p.x0, p.x1, 0.765, 0.795, 0.02, lod ? 0.047 : 0.045, BL_FRAME));
    }
    if (!lod) {
      T.push(slab(p.x0 - 0.09, p.x1 + 0.09, 1.03, 1.055, 0.005, 0.075, BL_STONE)); // сандрик
      T.push(slab(p.x0 - 0.11, p.x1 + 0.11, 1.055, 1.075, 0.005, 0.095, BL_STONE));
      ctx.count('hoods');
    }
  }
  T.push(solid(ctx, -len / 2, len / 2, SLAB_Y0, SLAB_Y1, -SLAB_IN, out, BL_SLAB));
  ctx.count('slab');
  if (ctx.bare) return;
  if (lod) {
    T.push(facadeBox(-len / 2 + 0.01, len / 2 - 0.01, SLAB_Y1, 0.4, out - 0.04, out, BL_FRAME)); // парапет
    for (const x of [-len / 4, len / 4]) T.push(facadeBox(x - 0.03, x + 0.03, 0.01, SLAB_Y0, 0.005, 0.18, BL_BRACKET[0]));
    ctx.count('brackets', 2);
    return;
  }
  const zr = out - 0.035, posts = len >= 0.4, xe = len / 2 - 0.08;
  T.push(slab(-len / 2 + 0.02, len / 2 - 0.02, 0.39, 0.425, zr - 0.025, zr + 0.025, BL_FRAME)); // поручень
  if (posts) {
    for (const s of [-1, 1]) {
      T.push(slab(s * xe - 0.045, s * xe + 0.045, SLAB_Y1, 0.44, zr - 0.045, zr + 0.045, BL_STONE)); // тумба
      T.push(G.place(G.sphere(0.07, 8, 6, BL_TOPIARY), { x: s * xe, y: 0.515, z: zr }));
      T.push(slab(s * xe - 0.015, s * xe + 0.015, 0.39, 0.425, 0.005, zr - 0.045, BL_FRAME)); // поручень к стене
      ctx.count('topiaries');
    }
  }
  const bx = posts ? xe - 0.09 : len / 2 - 0.05;
  for (const x of steps(-bx, bx, 0.12)) {
    const g = G.colored(new THREE.CylinderGeometry(0.014, 0.02, 0.24, 6, 1, true), BL_FRAME);
    T.push(G.place(g, { x, y: SLAB_Y1 + 0.12, z: zr }));
    ctx.count('balusters');
  }
  for (const x of steps(-len / 2 + 0.15, len / 2 - 0.15, 0.5)) {
    T.push(slab(x - 0.03, x + 0.03, 0.045, SLAB_Y0, 0.005, out - 0.06, BL_BRACKET[0]));
    T.push(slab(x - 0.025, x + 0.025, 0.01, 0.045, 0.005, (out - 0.06) * 0.55, BL_BRACKET[1]));
    ctx.count('brackets');
  }
}

/**
 * Спец-этаж (§6.1): корпус на материале стен со слоем и цветом типа, карниз типа, стороны типа, у оранжереи угловые
 * колонны, труба — только при pipe (стиль соседей с трубой, L0). Без rng в отделке: стекло одно при bare и без него.
 */
// Межэтажный шов утоплен между плоским фартуком и узким выносным носиком. Углы полос состыкованы по периметру.
function floorCourse(w, d, lod, color, facade) {
  if (!facade) return [G.place(lod ? G.box(w + 0.08, 0.082, d + 0.08, color) : G.roundedBox(w + 0.08, 0.082, d + 0.08, 0.012, 1, color), { y: CORNICE_Y })];
  return [
    G.place(G.box(w + 0.024, 0.064, d + 0.024, '#333c40'), { y: 1.137 }),
    G.place(G.box(w + 0.068, 0.022, d + 0.068, color), { y: 1.164 }),
  ];
}

function buildSpecial({ special, style, w, d, lod, bare, pipe }) {
  const look = SPECIAL_LOOK[special];
  const body = floorBody(w, d, BODY_R, lod, look.layer, look.body);
  const trim = floorCourse(w, d, lod, look.cornice, style === 'nightTower');
  const glass = [], windows = {}, details = {};
  const rng = createRng(hashSeed('floorSpecial', special));
  const shared = {
    lod, bare, look, offices: style === 'nightTower',
    count(k, m = 1) { details[k] = (details[k] || 0) + m; },
    paneOpts() {
      const lit = rng.next() < SPECIAL_NIGHT.share ? rng.uniform(SPECIAL_NIGHT.lo, SPECIAL_NIGHT.hi) : 0.05;
      return { glow: look.glow, lit, curtain: 0, room: style === 'nightTower' ? (special === 'atrium' ? 3 : rng.int(0, 3)) : null,
        interior: special === 'atrium' ? 3 : special === 'loft' ? 9 : 1 };
    },
  };
  for (const f of faces(w, d)) {
    const n = windowCount(f.len), slot = n ? f.len / n : f.len;
    const ctx = { ...shared, face: f, len: f.len, n, slot, trim: [], glass: [] };
    ctx.centers = Array.from({ length: n }, (_, i) => -f.len / 2 + slot * (i + 0.5));
    look.build(ctx);
    windows[f.side] = n;
    for (const g of ctx.trim) trim.push(toFace(g, f));
    for (const g of ctx.glass) glass.push(toFace(g, f));
  }
  if (special === 'atrium') { atriumCorners(trim, w, d); shared.count('columns', 4); }
  if (pipe) { downpipe(trim, w, d, DOWNPIPE); shared.count('downpipe'); }
  return { body, trim: G.mergeColored(trim), glass: G.mergeColored(glass, { rooms: true }), windows, details, door: null };
}

// ---------- сборка ----------

function faces(w, d) {
  return [
    { side: 'front', len: w, dist: d / 2, ry: 0 },
    { side: 'right', len: d, dist: w / 2, ry: Math.PI / 2 },
    { side: 'back', len: w, dist: d / 2, ry: Math.PI },
    { side: 'left', len: d, dist: w / 2, ry: -Math.PI / 2 },
  ];
}
const toFace = (g, f) => G.place(g, { x: f.dist * Math.sin(f.ry), z: f.dist * Math.cos(f.ry), ry: f.ry });

// Вершины скруглённой коробки лежат у восьми углов. Их перенос сохраняет радиус и нормали;
// UV проецируются уже на итоговый размер. У узкого обломка свой, ограниченный шириной, радиус.
const indexedBodies = new Map();
function floorBody(w, d, radius, lod, layer, color, plain = false) {
  if (lod && !plain && Math.min(w, d) >= 2 * (radius + 0.011)) {
    let source = indexedBodies.get(radius);
    if (!source) {
      const template = G.place(G.roundedBox(1, FLOOR_H, 1, radius, 1), { y: FLOOR_H / 2 });
      source = mergeVertices(G.boxUv(template, 1));
      indexedBodies.set(radius, source);
    }
    const g = source.clone(), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setXYZ(i, x + Math.sign(x) * (w - 1) / 2, p.getY(i), z + Math.sign(z) * (d - 1) / 2);
    }
    return asWall(g, layer, color);
  }
  const shell = plain ? G.box(w, FLOOR_H, d) : G.roundedBox(w, FLOOR_H, d, radius, lod ? 1 : 2);
  const g = asWall(G.place(shell, { y: FLOOR_H / 2 }), layer, color);
  return lod ? mergeVertices(g) : g;
}

function buildGeometry(spec) {
  if (spec.special) return buildSpecial(spec);
  const { style, w, d, variant, golden, lod, entry, bare = false } = spec;
  const S = STYLES[style];
  const family = style === 'shop' ? 4 : ['office', 'tower', 'quick2', 'quick3'].includes(style) ? 8 : 0;
  let paneIndex = variant;
  const rng = createRng(hashSeed('floor', style, variant, golden ? 1 : 0));
  // тело на материале стен (§4.3): слой стиля, цвет корпуса — вершинный; у золотого — штукатурка и белый (отличие 7).
  // L1 (§5.1): скругление в один сегмент, общие вершины слиты — 56 вершин вместо 324
  const nightTower = style === 'nightTower';
  const body = floorBody(w, d, nightTower ? 0.012 : BODY_R, lod, golden ? WALL.plaster : wallLayerOf(style),
    golden ? '#ffffff' : S.body, nightTower && bare);
  const cornice = golden ? '#ffe08a' : S.cornice;
  const trim = floorCourse(w, d, lod, cornice, style === 'nightTower');
  const glass = [];
  const windows = {};
  const edge = {}, details = {};
  let door = null;
  const shared = {
    rng, variant, golden, lod, bare,
    drng: createRng(hashSeed('detail', style, variant, golden ? 1 : 0)), // детали — свой генератор, rng окон прежний
    stone: golden ? '#fff1c2' : S.quoins || PALETTE.cream,
    count(k, m = 1) { details[k] = (details[k] || 0) + m; },
    shutter: rng.pick(['#5aa0d8', '#7cc47a', '#e8a04a', '#d86a6a']),
    flowers: ['#ff6f91', '#ffd166', '#ffffff', '#ff8c42', '#c38bff'],
    letters: ['#ff6f61', '#3fa7d6', '#59c36a', '#ffb347', '#9b6bd6'],
    awnings: [PALETTE.shop, '#3fa7d6', '#59c36a'],
    paneOpts(o = {}) {
      const interior = family + (paneIndex++ % 4);
      if (golden) return { glow: PALETTE.goldGlow, lit: 1, curtain: 0, interior };
      const lit = rng.next() < 0.72 ? rng.uniform(0.55, 1) : 0.05;
      const cool = rng.next() < (o.cool ?? 0.15);
      const curtain = rng.next() < 0.3 && !o.noCurtain ? rng.uniform(0.35, 0.6) : 0;
      return { glow: cool ? '#c4e4ff' : PALETTE.glassLit, lit, curtain, interior };
    },
  };
  for (const f of faces(w, d)) {
    const n = windowCount(f.len);
    const ctx = { ...shared, face: f, len: f.len, n, skip: -1, doorGap: null, trim: [], glass: [] };
    if (n > 0) {
      ctx.slot = f.len / n;
      ctx.centers = Array.from({ length: n }, (_, i) => -f.len / 2 + ctx.slot * (i + 0.5));
      if (entry && f.side === 'front' && f.len >= DOOR_MIN_SIDE) {
        ctx.skip = n >> 1; // дверь вместо среднего окна (§5.3)
        const cx = ctx.centers[ctx.skip], half = DOOR_W / 2 + DOOR_BAR + 0.03;
        ctx.doorGap = [cx - half, cx + half];
        door = 'front';
      }
      // рычаг 2 (§8.3, отличие 18): отделка стиля строится ради расхода rng (стекло и ночные окна те же) и отбрасывается
      if (bare) ctx.count = () => {};
      S.build(ctx);
      if (bare) {
        if (style !== 'nightTower') ctx.trim.length = 0;
        ctx.count = shared.count;
      }
      if (ctx.skip >= 0) entryDoor(ctx, ctx.centers[ctx.skip], S);
    }
    windows[f.side] = n - (ctx.skip >= 0 ? 1 : 0);
    if (S.quoins && !lod) edge[f.side] = f.len / 2 - usedHalf(ctx.trim); // до блёсток золотого этажа
    if (golden && style !== 'nightTower' && f.len >= 0.45) sparkles(ctx);
    for (const g of ctx.trim) trim.push(toFace(g, f));
    for (const g of ctx.glass) glass.push(toFace(g, f));
  }
  if (S.quoins && !lod) { // рустовка и водосточная труба — только L0 (§5.1)
    const k = quoins(trim, w, d, edge, shared.stone);
    if (k) shared.count('quoins', k);
    if (Math.min(w, d) >= PIPE_MIN_SIDE) {
      downpipe(trim, w, d, golden ? '#ffe08a' : DOWNPIPE);
      shared.count('downpipe');
    }
  }
  if (entry) {
    plinth(trim, w, d, golden ? '#e0b84a' : PLINTH);
    shared.count('plinth');
  }
  return { body, trim: G.mergeColored(trim), glass: G.mergeColored(glass, { rooms: true }), windows, details, door };
}

/** Байты вершинных данных геометрии: массивы атрибутов и индекса. */
export function geometryBytes(g) {
  let n = g.index ? g.index.array.byteLength : 0;
  for (const a of Object.values(g.attributes)) n += a.array.byteLength;
  return n;
}

// Общий LRU-кэш геометрии этажей и крыш (спецификация «Своя башня» §6.2): ключ → { value, geoms, bytes }.
const cache = new Map();
let cacheBytes = 0, cacheLimit = GEOMETRY_CACHE_BYTES;
/** Записей в общем кэше (этажи и крыши). */
export const floorCacheSize = () => cache.size;
/** Байты вершинных данных всех записей общего кэша. */
export const geometryCacheBytes = () => cacheBytes;

/** Вытесняет самые давние записи, пока кэш больше предела; keep не трогается. Вытеснённая геометрия освобождается. */
function evict(keep) {
  for (const [k, e] of cache) {
    if (cacheBytes <= cacheLimit) break;
    if (k === keep) continue;
    cache.delete(k);
    cacheBytes -= e.bytes;
    // Если вытеснённая геометрия ещё на сцене, three.js загрузит её в GPU заново.
    for (const g of e.geoms) g.dispose();
  }
}

/** Только для тестов: предел кэша в байтах (null — GEOMETRY_CACHE_BYTES); лишнее вытесняется сразу. */
export function _setGeometryCacheLimit(bytes) {
  cacheLimit = bytes ?? GEOMETRY_CACHE_BYTES;
  evict(null);
}

/**
 * Запись общего кэша: make() строит значение, geoms(value) — его геометрии (по ним считаются байты, их освобождает
 * вытеснение). Новая запись не вытесняется сразу, даже если одна больше предела.
 */
export function cachedGeometry(key, make, geoms) {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit.value; }
  const value = make();
  const list = geoms(value);
  const e = { value, geoms: list, bytes: list.reduce((s, g) => s + geometryBytes(g), 0) };
  cache.set(key, e);
  cacheBytes += e.bytes;
  evict(key);
  return value;
}

const floorGeoms = (e) => [e.body, e.trim, e.glass];

function floorParts(spec) {
  const e = buildGeometry(spec);
  if (spec.style === 'nightTower') { markFacadeFinish(e.body); markFacadeFinish(e.trim); }
  return e;
}

/** Освобождает геометрию всех записей общего кэша — этажей и крыш — и очищает его (замер города с холодного кэша). */
export function clearFloorCache() {
  for (const e of cache.values()) for (const g of e.geoms) g.dispose();
  cache.clear();
  cacheBytes = 0;
}

const round2 = (v, def) => Math.max(0.01, Math.round((Number.isFinite(v) ? v : def) * 100) / 100);

/**
 * Нормализованные параметры этажа и ключ кэша: размеры до сотых, вариант seed % 4, lod — 1 или 0, bare — только у L1.
 * special («Спец-этажи» §6.1) — тип спец-этажа или null: вне SPECIAL_TYPES, у золотого и у этажа с входом — null.
 * Спец-этаж не зависит от стиля и варианта: ключ sp:тип|w|d|lod, плюс |bare и |pipe (труба — L0 у стиля с трубой,
 * сторона не меньше PIPE_MIN_SIDE; план, отличие 8). Ключи обычных этажей — прежние.
 */
function floorSpec({ style = 'house', w = W0, d = D0, seed = 0, golden = false, lod = 0, entry = false, bare = false, special = null } = {}) {
  if (!STYLES[style]) style = 'house';
  w = round2(w, W0); d = round2(d, D0);
  const variant = ((Math.trunc(Number.isFinite(seed) ? seed : 0) % 4) + 4) % 4;
  golden = !!golden; entry = !!entry; lod = lod === 1 ? 1 : 0;
  bare = !!bare && lod === 1; // рычаг 2 (§8.3): только этажи L1 города; ключи без него — прежние
  special = !golden && !entry && SPECIAL_TYPES.includes(special) ? special : null;
  if (special) {
    const pipe = lod === 0 && !!STYLES[style].quoins && Math.min(w, d) >= PIPE_MIN_SIDE;
    const key = `sp:${special}|${w.toFixed(2)}|${d.toFixed(2)}|${lod}` + (bare ? '|bare' : '') + (pipe ? '|pipe' : '') + (style === 'nightTower' ? '|offices' : '');
    return { style, w, d, variant, golden, lod, entry, bare, special, pipe, key };
  }
  const key = `${style}|${w.toFixed(2)}|${d.toFixed(2)}|${variant}|${golden ? 1 : 0}|${lod}|${entry ? 1 : 0}` + (bare ? '|bare' : '');
  return { style, w, d, variant, golden, lod, entry, bare, special, pipe: false, key };
}

/**
 * Геометрия этажа из кэша: { body, trim, glass, windows, details, door } — параметры как у buildFloorMeshes.
 * Общая: не менять и не освобождать (дома города копируют её в свои слитые меши, Task 12).
 */
export function floorGeometry(opts) {
  const s = floorSpec(opts);
  return cachedGeometry(s.key, () => floorParts(s), floorGeoms);
}

function mesh(name, geom, material, cast, receive) {
  const m = new THREE.Mesh(geom, material);
  m.name = name; m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/**
 * Этаж из трёх мешей: body, trim, glass. Геометрия общая (кэш), материалы общие.
 * entry — этаж с входом (§5.3): дверь на передней стороне не короче 1,2 м, цоколь. lod: 1 — уровень L1 (§5.1).
 * bare (только lod 1) — рычаг 2: без отделки стиля; остаются карниз этажа, вход и цоколь.
 * special — тип спец-этажа («Спец-этажи» §6): свой вид, не зависящий от стиля; у золотого и у входного — обычный этаж.
 * cache: false — собственная геометрия вне кэша (обломки уникальных размеров);
 * её освобождает владелец, в userData.owned = true.
 */
export function buildFloorMeshes({ cache: useCache = true, ...opts } = {}) {
  const s = floorSpec(opts);
  const e = useCache === false ? floorParts(s) : cachedGeometry(s.key, () => floorParts(s), floorGeoms);
  const group = new THREE.Group();
  group.name = 'floor';
  const glass = mesh('glass', e.glass, mat(s.style === 'nightTower' ? 'officeWindows' : 'windows'), false, true);
  glass.visible = e.glass.getAttribute('position').count > 0;
  const facade = s.style === 'nightTower';
  group.add(mesh('body', e.body, wallMaterial({ golden: s.golden, facade }), true, true), mesh('trim', e.trim, mat(facade ? 'facadeTrim' : 'trim'), true, true), glass);
  group.userData = { style: s.style, w: s.w, d: s.d, golden: s.golden, lod: s.lod, entry: s.entry, special: s.special, door: e.door, windows: { ...e.windows }, details: { ...e.details } };
  if (useCache === false) group.userData.owned = true;
  return group;
}
