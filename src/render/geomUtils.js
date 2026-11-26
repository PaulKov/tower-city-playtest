// Геометрические помощники: скруглённые боксы без артефактов, вершинные цвета, слияние.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MIN_SIZE = 0.002;
const MIN_RADIUS = 0.005;
const _color = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

const safe = (v) => (Number.isFinite(v) && v > MIN_SIZE ? v : MIN_SIZE);

/** Радиус фаски: не больше половины наименьшей стороны минус зазор, но не меньше MIN_RADIUS. */
export function clampRadius(w, h, d, r) {
  return Math.max(MIN_RADIUS, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
}

function withColor(geom, color) { return color === undefined ? geom : colored(geom, color); }

// Шаблоны скруглённых боксов: построение RoundedBoxGeometry дорогое (обход всех вершин),
// а детали фасадов повторяются. Наружу отдаётся копия атрибутов — её можно менять.
const RB_LIMIT = 512;
const rbCache = new Map();
export const roundedBoxCacheSize = () => rbCache.size;

export function roundedBox(w, h, d, r = 0.1, seg = 2, color) {
  w = safe(w); h = safe(h); d = safe(d);
  const rr = clampRadius(w, h, d, Number.isFinite(r) ? r : MIN_RADIUS);
  const key = `${w}|${h}|${d}|${rr}|${seg}`;
  let t = rbCache.get(key);
  if (t) { rbCache.delete(key); rbCache.set(key, t); } else {
    t = new RoundedBoxGeometry(w, h, d, seg, rr);
    rbCache.set(key, t);
    if (rbCache.size > RB_LIMIT) { const k = rbCache.keys().next().value; rbCache.get(k).dispose(); rbCache.delete(k); }
  }
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = t.getAttribute(name);
    g.setAttribute(name, new THREE.BufferAttribute(a.array.slice(), a.itemSize));
  }
  if (t.index) g.setIndex(new THREE.BufferAttribute(t.index.array.slice(), 1)); // seg = 0 — обычный бокс
  return withColor(g, color);
}
export function box(w, h, d, color) { return withColor(new THREE.BoxGeometry(safe(w), safe(h), safe(d)), color); }
export function sphere(r, ws = 12, hs = 8, color) { return withColor(new THREE.SphereGeometry(safe(r), ws, hs), color); }
export function cylinder(rt, rb, h, seg = 12, color) {
  return withColor(new THREE.CylinderGeometry(Math.max(0, rt), Math.max(0, rb), safe(h), seg), color);
}
export function cone(r, h, seg = 12, color) { return withColor(new THREE.ConeGeometry(safe(r), safe(h), seg), color); }
export function capsule(r, len, capSeg = 4, radSeg = 8, color) {
  return withColor(new THREE.CapsuleGeometry(safe(r), Math.max(0, len), capSeg, radSeg), color);
}

/** Записывает во все вершины цвет (в линейном рабочем пространстве). Меняет и возвращает geom. */
export function colored(geom, color) {
  _color.set(color);
  const n = geom.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _color.r; arr[i * 3 + 1] = _color.g; arr[i * 3 + 2] = _color.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

/** Применяет трансформацию {x,y,z, rx,ry,rz (рад), sx,sy,sz или s}. Меняет и возвращает geom. */
export function place(geom, t = {}) {
  const s = t.s ?? 1;
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _q.setFromEuler(_e.set(t.rx || 0, t.ry || 0, t.rz || 0));
  _s.set(t.sx ?? s, t.sy ?? s, t.sz ?? s);
  geom.applyMatrix4(_m.compose(_p, _q, _s));
  return geom;
}

/**
 * Box-проекция UV по доминирующей оси нормали: стены получают (x|z, y), крыши — (x, z).
 * scale — повторов текстуры на единицу длины. Меняет и возвращает geom.
 */
export function boxUv(geom, scale = 1) {
  const pos = geom.getAttribute('position'), nor = geom.getAttribute('normal');
  let uv = geom.getAttribute('uv');
  if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2); geom.setAttribute('uv', uv); }
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, x * scale, z * scale);
    else if (ax >= az) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  uv.needsUpdate = true;
  return geom;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
/** Брус толщиной t от точки a до точки b ([x,y,z]); rounded — со скруглёнными фасками. */
export function beam(a, b, t, color, rounded = false) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  if (len > 1e-9) _dir.divideScalar(len); else _dir.copy(_up);
  const g = rounded ? roundedBox(t, len, t, t * 0.4, 1, color) : box(t, len, t, color);
  _q.setFromUnitVectors(_up, _dir);
  _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.applyMatrix4(_m.compose(_p, _q, _s.set(1, 1, 1)));
  return g;
}

/** Масштабирует UV (вместо texture.repeat, чтобы общие текстуры не расходились по повторам). */
export function scaleUv(geom, su, sv = su) {
  const uv = geom.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geom;
}

/**
 * Маска для материалов с проекцией по мировым XZ (мощение): UV = (1, 0) у вершин верхних граней
 * (normal.y > 0.5), если on, у остальных (0, 0). Вызывать после place(): нужны итоговые нормали.
 * Меняет и возвращает geom.
 */
export function tileMask(geom, on = true) {
  const nor = geom.getAttribute('normal'), n = geom.getAttribute('position').count;
  const uv = new Float32Array(n * 2);
  if (on) for (let i = 0; i < n; i++) uv[i * 2] = nor.getY(i) > 0.5 ? 1 : 0;
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}

const KEEP = ['position', 'normal', 'uv', 'color'];
/** Слой материала стен (src/render/houses/walls.js): переживает слияние только по запросу. */
const LAYER = 'aLayer';

/** Пустая геометрия с теми же атрибутами, что даёт mergeColored (0 вершин); layer — и с aLayer. */
export function emptyGeometry({ layer = false } = {}) {
  const g = new THREE.BufferGeometry();
  const attrs = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]];
  if (layer) attrs.push([LAYER, 1]);
  for (const [name, size] of attrs) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(0), size));
  g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  return g;
}

// Лёгкая обёртка над атрибутами исходника, без clone(): clone() вызывает new this.constructor(),
// и для RoundedBoxGeometry это лишняя постройка бокса по умолчанию (основная цена слияния).
// Атрибуты исходника не меняются: недостающие создаются новыми, mergeGeometries копирует данные.
function normalize(src, indexed, layer, rooms) {
  let g = new THREE.BufferGeometry();
  for (const name of layer ? [...KEEP, LAYER] : KEEP) { const a = src.getAttribute(name); if (a) g.setAttribute(name, a); }
  if (src.index) g.setIndex(src.index);
  if (rooms) g.setAttribute('aRoomCoord', src.getAttribute('aRoomCoord') ?? new THREE.BufferAttribute(new Uint8Array(src.attributes.position.count), 1));
  if (!indexed && g.index) g = g.toNonIndexed();
  const n = g.getAttribute('position').count;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.getAttribute('color')) colored(g, 0xffffff);
  if (layer && !g.getAttribute(LAYER)) g.setAttribute(LAYER, new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

/**
 * Сливает геометрии в одну с атрибутами position/normal/uv/color; layer — и с aLayer (у кусков без него — 0).
 * Исходники не меняются.
 */
export function mergeColored(list, { layer = false, rooms = false } = {}) {
  const geoms = list.filter(Boolean);
  if (!geoms.length) return emptyGeometry({ layer });
  const indexed = geoms.every((g) => g.index);
  const prepared = geoms.map((g) => normalize(g, indexed, layer, rooms));
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error('mergeColored: incompatible geometries');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
