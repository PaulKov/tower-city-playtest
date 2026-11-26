// Геометрия растений (спецификация «Растительность» §5.4): тройка «вид × вариант × LOD» → BufferGeometry с атрибутами
// position, normal, uv (участок атласа или SOLID_UV), color, aFlex (гибкость для ветра: 0 у основания, до 1 у верхушки)
// и aTint (1 — вершину красит цвет экземпляра). Строится детерминированно из своего зерна и кэшируется на страницу;
// геометрии кэша не освобождаются (план, отличие 4). Карточки, вышедшие за габарит вида KINDS, перебрасываются (отличие 9).
// L0 — ядро из шаров и плотные карточки (прототип §3.3); L1 — карточек втрое меньше, в 1,6 раза крупнее; L2 — только ядро.
import * as THREE from 'three';
import { createRng, hashSeed } from '../../core/rng.js';
import { KINDS } from './kinds.js';
import { ATLAS_RECTS, SOLID_UV, VEG_GEN } from './atlas.js';

const TRUNK = '#8a5a3b', TRUNK_DARK = '#5e3c25', SOIL = '#7a5a3c', LEAF_DARK = '#4f9a45', ROCK = '#9a9fa6', SNOW = '#f6fbff';
const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** Гибкость: 0 ниже y0, линейно до k на y1. */
const ramp = (y0, y1, k = 1) => (y) => k * clamp01((y - y0) / (y1 - y0));
const still = () => 0;
/** Серый светлоты lo..hi по высоте y0..y1 (линейные значения, как в прототипе §3.3); оттенок даёт цвет экземпляра. */
const shade = (lo, hi, y0, y1) => (y) => { const l = lo + (hi - lo) * clamp01((y - y0) / (y1 - y0)); return new THREE.Color(l, l, l); };
const flat = (hex) => { const c = new THREE.Color(hex); return () => c; };
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _axis = new THREE.Vector3();

/** Сборщик вершин растений. withTips добавляет aTip — длину подвижного кончика листа в метрах. */
export class VegetationBuilder {
  constructor(withTips = false) {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.flex = []; this.tint = []; this.idx = [];
    this.tips = withTips ? [] : null;
    this.cards = 0;
  }

  get count() { return this.pos.length / 3; }

  push(p, n, u, v, c, flex, tint, tip = 0) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b); this.flex.push(flex); this.tint.push(tint);
    if (this.tips) this.tips.push(tip);
  }

  /** Сплошная часть из геометрии three: uv = SOLID_UV, цвет colorAt(y), гибкость flexAt(y). Источник освобождается. */
  solid(geom, colorAt, flexAt, tint) {
    const p = geom.getAttribute('position'), n = geom.getAttribute('normal'), base = this.count;
    for (let i = 0; i < p.count; i++) {
      _a.fromBufferAttribute(p, i); _b.fromBufferAttribute(n, i);
      this.push(_a, _b, SOLID_UV, SOLID_UV, colorAt(_a.y), flexAt(_a.y), tint);
    }
    if (geom.index) for (let i = 0; i < geom.index.count; i++) this.idx.push(base + geom.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    geom.dispose();
  }

  /** Карточка: углы в обходе CORNERS, нормали углов, участок атласа rect, цвета углов. */
  card(corners, normals, rect, colors, flexAt, tint) {
    const [u0, v0, u1, v1] = rect, base = this.count;
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let k = 0; k < 4; k++) this.push(corners[k], normals[k], uv[k][0], uv[k][1], colors[k], flexAt(corners[k].y), tint);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.cards++;
  }

  /** Сжатие по z (изгородь уже своих шаров); нормали — обратным сжатием, чтобы остаться перпендикулярными. */
  squashZ(k) {
    for (let i = 2; i < this.pos.length; i += 3) this.pos[i] *= k;
    for (let i = 0; i < this.nor.length; i += 3) {
      const x = this.nor[i], y = this.nor[i + 1], z = this.nor[i + 2] / k, l = Math.hypot(x, y, z) || 1;
      this.nor[i] = x / l; this.nor[i + 1] = y / l; this.nor[i + 2] = z / l;
    }
  }

  build(name, userData) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.flex, 1));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 1));
    if (this.tips) g.setAttribute('aTip', new THREE.Float32BufferAttribute(this.tips, 1));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.name = name;
    g.userData = { shared: true, cards: this.cards, ...userData };
    return g;
  }
}

/** Ближайшая к p точка отрезка axis = [[x,y,z],[x,y,z]] (общий временный вектор). */
function axisPoint([a, b], p) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? clamp01(((p.x - a[0]) * dx + (p.y - a[1]) * dy + (p.z - a[2]) * dz) / len2) : 0;
  return _axis.set(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t);
}

function randomDir(rng) {
  const d = new THREE.Vector3();
  do d.set(rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)); while (d.lengthSq() > 1 || d.lengthSq() < 1e-4);
  return d.normalize();
}

/** Угол карточки внутри габарита вида: не выше h, не ниже floor, внутри ограничивающей сферы (с запасом 1 см). */
const fits = (K, floor) => (p) => p.y <= K.h - 0.01 && p.y >= floor && Math.hypot(p.x, p.y - K.cy, p.z) <= K.r - 0.01;

/**
 * Карточка, касательная к поверхности: центр centre, внешняя нормаль d, сторона side, поворот случайный.
 * Нормали углов — 75 % от оси o.axis и 25 % вдоль d (мягкая «шаровая» светотень, §3.3).
 * Если хоть один угол не проходит o.ok — карточки нет (false).
 */
function tangentCard(b, rng, centre, d, side, o) {
  const t1 = new THREE.Vector3(0, 1, 0).cross(d);
  if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
  t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(d, t1);
  const ang = rng.uniform(0, Math.PI * 2), ca = Math.cos(ang) * side / 2, sa = Math.sin(ang) * side / 2;
  const ax = t1.clone().multiplyScalar(ca).addScaledVector(t2, sa);
  const ay = t1.clone().multiplyScalar(-sa).addScaledVector(t2, ca);
  const corners = CORNERS.map(([u, v]) => centre.clone().addScaledVector(ax, u).addScaledVector(ay, v));
  if (!corners.every(o.ok)) return false;
  const normals = corners.map((p) => p.clone().sub(axisPoint(o.axis, p)).normalize().multiplyScalar(0.75).addScaledVector(d, 0.25).normalize());
  b.card(corners, normals, o.rect, corners.map(o.colorAt), o.flexAt, o.tint);
  return true;
}

/** Карточки на шарах blobs ([x, y, z, r]): доля count по площади шара, центр на 0,72–1,0 радиуса (прототип). */
function blobCards(b, rng, blobs, count, side, o) {
  const area = blobs.reduce((s, bl) => s + bl[3] ** 2, 0);
  for (const [x, y, z, r] of blobs) {
    const n = Math.round(count * r * r / area);
    for (let i = 0; i < n; i++) for (let tries = 0; tries < 24; tries++) {
      const d = randomDir(rng);
      const centre = new THREE.Vector3(x, y, z).addScaledVector(d, r * rng.uniform(0.72, 1));
      if (tangentCard(b, rng, centre, d, side * rng.uniform(0.75, 1.25), o)) break;
    }
  }
}

/** Ядро: шары радиуса k · r с сеткой ws × hs. */
function cores(b, blobs, k, [ws, hs], colorAt, flexAt) {
  for (const [x, y, z, r] of blobs) b.solid(new THREE.SphereGeometry(r * k, ws, hs).translate(x, y, z), colorAt, flexAt, 1);
}

/** Карточек на шарах: 70 на м² квадрата радиуса при стороне 0,95 м (прототип); при меньшей стороне — больше. */
const cardCount = (blobs, side) => Math.round(70 * (0.95 / side) ** 2 * blobs.reduce((s, bl) => s + bl[3] ** 2, 0));
const span = (blobs) => [Math.min(...blobs.map((bl) => bl[1] - bl[3])), Math.max(...blobs.map((bl) => bl[1] + bl[3]))];
/** Центр кроны — средний центр шаров с весом r³. */
function centreOf(blobs) {
  const c = [0, 0, 0];
  let w = 0;
  for (const [x, y, z, r] of blobs) { const k = r ** 3; c[0] += x * k; c[1] += y * k; c[2] += z * k; w += k; }
  return c.map((v) => v / w);
}

/** Крона из шаров (дерево, куст, изгородь): ядро и карточки листвы; на L2 — только ядро с градиентом. */
function crown(b, rng, blobs, lod, { side, kind, floor, flexAt, segs, axis }) {
  const [y0, y1] = span(blobs);
  if (lod === 2) { cores(b, blobs, 1, segs[2], shade(0.6, 1, y0, y1), flexAt); return; }
  cores(b, blobs, 0.8, segs[lod], shade(0.44, 0.8, y0, y1), flexAt);
  const n0 = cardCount(blobs, side), lit = shade(0.55, 1, y0, y1);
  blobCards(b, rng, blobs, lod ? Math.round(n0 / 3) : n0, lod ? side * 1.6 : side,
    { axis, rect: ATLAS_RECTS.leaf, colorAt: (p) => lit(p.y), flexAt, tint: 1, ok: fits(KINDS[kind], floor) });
}

const TREE_BLOBS = [
  [[0, 2.75, 0, 1.05], [0.62, 2.35, 0.15, 0.78], [-0.55, 2.45, -0.25, 0.72], [0.05, 3.45, 0.1, 0.66]],
  [[0, 2.6, 0, 0.92], [0.48, 3.15, -0.12, 0.7], [-0.45, 2.95, 0.3, 0.68], [0.12, 2.2, -0.5, 0.62], [-0.05, 3.62, 0.05, 0.52]],
];

/** Ствол с корнями и веткой (L0), с тремя корнями (L1), голый (L2); не гнётся. */
function trunk(b, v, lod) {
  const dark = new THREE.Color(TRUNK_DARK), light = new THREE.Color(TRUNK);
  const col = (y) => dark.clone().lerp(light, clamp01(y / 1.4));
  b.solid(new THREE.CylinderGeometry(0.15, 0.24, 2.2, [8, 6, 5][lod], 1, true).translate(0, 1.1, 0), col, still, 0);
  const roots = [6, 3, 0][lod];
  for (let i = 0; i < roots; i++) {
    b.solid(new THREE.ConeGeometry(0.11, 0.7, lod ? 4 : 5, 1, true).rotateZ(-(Math.PI / 2 + 0.35)).translate(0.22, 0.2, 0)
      .rotateY((i / roots) * Math.PI * 2 + 0.3 + v), col, still, 0);
  }
  if (lod === 0) b.solid(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 5, 1, true).rotateZ(-0.8).translate(0.3, 2.0, 0).rotateY(v * 2.1), col, still, 0);
}

function buildTree(b, rng, v, lod) {
  const blobs = TREE_BLOBS[v], c = centreOf(blobs), axis = [c, c];
  trunk(b, v, lod);
  crown(b, rng, blobs, lod, { side: 0.95, kind: 'tree', floor: 0.5, flexAt: ramp(1.6, KINDS.tree.h), segs: [[10, 6], [8, 4], [6, 4]], axis });
  return axis;
}

const BUSH_BLOBS = [
  [[0, 0.41, 0, 0.55], [0.45, 0.3, 0.1, 0.42], [-0.4, 0.28, -0.12, 0.4]],
  [[0, 0.42, 0, 0.5], [0.38, 0.32, -0.25, 0.4], [-0.35, 0.3, 0.22, 0.42], [0.05, 0.3, 0.45, 0.34]],
];

function buildBush(b, rng, v, lod) {
  const blobs = BUSH_BLOBS[v], c = centreOf(blobs), axis = [c, c];
  crown(b, rng, blobs, lod, { side: 0.6, kind: 'bush', floor: 0.03, flexAt: ramp(0.1, KINDS.bush.h, 0.6), segs: [[8, 5], [6, 4], [6, 3]], axis });
  return axis;
}

/** Сегмент изгороди 2,5 м: пять шаров вдоль x (план, отличие 7), потом сжатие по z. */
const HEDGE_BLOBS = [-1, -0.5, 0, 0.5, 1].map((x, i) => [x, 0.39, i % 2 ? 0.04 : -0.04, 0.34]);

function buildHedge(b, rng, v, lod) {
  const axis = [[-1, 0.39, 0], [1, 0.39, 0]];
  crown(b, rng, HEDGE_BLOBS, lod, { side: 0.5, kind: 'hedge', floor: 0.05, flexAt: ramp(0.1, KINDS.hedge.h, 0.5), segs: [[8, 5], [6, 4], [6, 3]], axis });
  b.squashZ(0.6);
  return axis;
}

/** Ярусы ели: [радиус, высота, центр по y] (V0 — как прежняя pineGeometry). */
const PINE_TIERS = [
  [[1.35, 1.7, 1.45], [1.05, 1.45, 2.35], [0.72, 1.25, 3.15]],
  [[1.3, 1.5, 1.3], [1.08, 1.35, 2.0], [0.85, 1.2, 2.7], [0.6, 1.05, 3.3]],
];
const NEEDLE = 0.7, PINE_DENSITY = 46;

/** Ель: ствол, конусы ярусов (ядро) и карточки хвои; snow — белые шапки-конусы и белые карточки у вершин ярусов. */
function buildPine(b, rng, v, lod, snow) {
  const K = KINDS.pine, tiers = PINE_TIERS[v];
  const bottom = Math.min(...tiers.map(([, h, y]) => y - h / 2)), top = Math.max(...tiers.map(([, h, y]) => y + h / 2));
  const axis = [[0, bottom, 0], [0, top, 0]], flexAt = ramp(0.8, K.h, 0.9), white = flat(SNOW);
  b.solid(new THREE.CylinderGeometry(0.14, 0.2, 1.0, [8, 6, 5][lod], 1, true).translate(0, 0.5, 0), flat(TRUNK), still, 0);
  const core = shade(0.5, 0.8, bottom, top), seg = [12, 8, 8][lod];
  for (const [r, h, y] of tiers) {
    b.solid(new THREE.ConeGeometry(lod === 2 ? r : r * 0.85, h, seg).translate(0, y, 0), core, flexAt, 1);
    if (snow) b.solid(new THREE.ConeGeometry(r * 0.55 + 0.08, h * 0.5 + 0.06, [10, 8, 6][lod], 1, true).translate(0, y + h * 0.25 + 0.04, 0), white, flexAt, 0);
  }
  if (lod === 2) return axis;
  const weights = tiers.map(([r, h]) => r * Math.hypot(r, h)), total = weights.reduce((s, w) => s + w, 0);
  const n0 = Math.round(PINE_DENSITY * total), count = lod ? Math.round(n0 / 3) : n0, side = lod ? NEEDLE * 1.6 : NEEDLE;
  const lit = shade(0.6, 1, bottom, top), ok = fits(K, 0.45);
  tiers.forEach(([r, h, y], k) => {
    const n = Math.round(count * weights[k] / total);
    for (let i = 0; i < n; i++) for (let tries = 0; tries < 12; tries++) {
      const t = rng.uniform(0.15, 1), phi = rng.uniform(0, Math.PI * 2); // t — доля пути от вершины яруса к краю
      const rr = r * t * rng.uniform(0.85, 1.05);
      const centre = new THREE.Vector3(Math.cos(phi) * rr, y + h / 2 - h * t, Math.sin(phi) * rr);
      const d = new THREE.Vector3(Math.cos(phi) * h, r, Math.sin(phi) * h).normalize();
      const capped = snow && t < 0.45;
      if (tangentCard(b, rng, centre, d, side * rng.uniform(0.75, 1.25), {
        axis, rect: ATLAS_RECTS.needle, colorAt: capped ? white : (p) => lit(p.y), flexAt, tint: capped ? 0 : 1, ok,
      })) break;
    }
  });
  return axis;
}

// Единый наметённый валик с вытянутым подветренным краем. Все LOD берут высоты и нормали с одной поверхности.
function driftOutline(a) {
  return 1 + 0.075 * Math.cos(3 * a - 0.5) + 0.045 * Math.sin(2 * a + 0.2) + 0.03 * Math.sin(5 * a);
}
function driftHeight(x, z) {
  const u = x / 1.31, v = z / 0.79;
  const r = Math.hypot(u, v) / driftOutline(Math.atan2(v, u));
  const taper = Math.max(0, 1 - r * r);
  const crest = Math.exp(-3.8 * (u + 0.31) ** 2 - 4.8 * (v - 0.18 - 0.48 * u) ** 2);
  const shoulder = Math.exp(-7.2 * (u - 0.46) ** 2 - 5.0 * (v + 0.19) ** 2);
  return taper * taper * (0.23 + 0.34 * crest + 0.13 * shoulder) - 0.008;
}
function buildDrift(b, rng, variant, lod) {
  const sides = [64, 36, 20][lod], rings = [11, 6, 4][lod];
  const low = new THREE.Color('#dae4ef'), top = new THREE.Color('#fcfdff'), c = new THREE.Color();
  const p = new THREE.Vector3(), n = new THREE.Vector3(), e = 0.004;
  function vertex(x, z) {
    const y = driftHeight(x, z);
    n.set(driftHeight(x - e, z) - driftHeight(x + e, z), 2 * e, driftHeight(x, z - e) - driftHeight(x, z + e)).normalize();
    c.copy(low).lerp(top, Math.sqrt(clamp01((y + 0.008) / 0.52)));
    b.push(p.set(x, y, z), n, SOLID_UV, SOLID_UV, c, 0, 0);
  }
  vertex(0, 0);
  for (let k = 1; k <= rings; k++) {
    const row = b.count;
    for (let j = 0; j < sides; j++) {
      const a = 2 * Math.PI * j / sides, r = k / rings * driftOutline(a);
      vertex(1.31 * r * Math.cos(a), 0.79 * r * Math.sin(a));
    }
    for (let j = 0; j < sides; j++) {
      const i = row + j, next = row + (j + 1) % sides;
      if (k === 1) b.idx.push(0, next, i);
      else b.idx.push(i - sides, next, i, i - sides, next - sides, next);
    }
  }
  return [[0, -1, 0], [0, -1, 0]];
}

/**
 * Карточки пятна (листья и цветы клумб и цветочных пятен): на расстоянии r0..r1 от центра, на высоте base(ρ) + y0..y1,
 * наклон от горизонтали до 35°.
 */
function patchCards(b, rng, n, { r0 = 0, r1, y0, y1, base = () => 0, side, rect, color, tint, flexAt, ok }) {
  const axis = [[0, -1, 0], [0, -1, 0]];
  for (let i = 0; i < n; i++) for (let tries = 0; tries < 12; tries++) {
    const a = rng.uniform(0, Math.PI * 2), rr = Math.sqrt(rng.uniform(r0 * r0, r1 * r1));
    const tilt = rng.uniform(0, 0.6), az = rng.uniform(0, Math.PI * 2);
    const centre = new THREE.Vector3(Math.cos(a) * rr, base(rr) + rng.uniform(y0, y1), Math.sin(a) * rr);
    const d = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    if (tangentCard(b, rng, centre, d, side * rng.uniform(0.8, 1.2), { axis, rect, colorAt: color, flexAt, tint, ok })) break;
  }
}

/** Клумба: земляная подушка, тёмные листья по краю, белые цветы (их красит цвет экземпляра). */
function buildBed(b, rng) {
  const ok = fits(KINDS.bed, 0.02), flexAt = ramp(0.1, KINDS.bed.h, 0.5);
  const dome = (rr) => 0.3 * Math.sqrt(Math.max(0, 0.65 * 0.65 - rr * rr));
  b.solid(new THREE.SphereGeometry(0.65, 10, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1), flat(SOIL), still, 0);
  patchCards(b, rng, 22, { r0: 0.25, r1: 0.66, y0: 0.02, y1: 0.06, base: dome, side: 0.26, rect: ATLAS_RECTS.leaf, color: flat(LEAF_DARK), tint: 0, flexAt, ok });
  patchCards(b, rng, 40, { r1: 0.55, y0: 0.08, y1: 0.16, base: dome, side: 0.13, rect: ATLAS_RECTS.flower, color: flat('#ffffff'), tint: 1, flexAt, ok });
  return [[0, -1, 0], [0, -1, 0]];
}

/** Цветочное пятно: низкие листья и цветы без подушки. */
function buildFlowerPatch(b, rng) {
  const ok = fits(KINDS.flowers, 0.02), flexAt = ramp(0.05, KINDS.flowers.h, 0.6);
  patchCards(b, rng, 14, { r1: 0.45, y0: 0.06, y1: 0.14, side: 0.22, rect: ATLAS_RECTS.leaf, color: flat(LEAF_DARK), tint: 0, flexAt, ok });
  patchCards(b, rng, 28, { r1: 0.45, y0: 0.16, y1: 0.3, side: 0.12, rect: ATLAS_RECTS.flower, color: flat('#ffffff'), tint: 1, flexAt, ok });
  return [[0, -1, 0], [0, -1, 0]];
}

/** Детерминированный шум 0..1 по координатам вершины (одинаковые вершины смещаются одинаково). */
function hash01(x, y, z) {
  const s = Math.sin(Math.round(x * 1e4) * 12.9898 + Math.round(y * 1e4) * 78.233 + Math.round(z * 1e4) * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Камень: два смещённых икосаэдра с гранями, сплюснутые и чуть утопленные в землю. */
function buildRock(b) {
  const rock = new THREE.Color(ROCK);
  for (const [x, z, r] of [[0, 0, 0.45], [0.38, 0.15, 0.22]]) {
    const g = new THREE.IcosahedronGeometry(r, 0), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + 0.3 * hash01(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.62, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    b.solid(g.translate(x, r * 0.62 * 0.7, z), (y) => rock.clone().multiplyScalar(0.8 + 0.4 * clamp01(y / 0.5)), still, 0);
  }
  return [[0, -1, 0], [0, -1, 0]];
}

const BUILD = { tree: buildTree, pine: buildPine, bush: buildBush, hedge: buildHedge, drift: buildDrift, bed: buildBed, flowers: buildFlowerPatch, rock: buildRock };
const clampInt = (x, n) => Math.min(n - 1, Math.max(0, Math.floor(Number.isFinite(x) ? x : 0)));

function params(kind, variant, lod, snow) {
  if (!Object.hasOwn(KINDS, kind)) throw new Error('vegetation: unknown kind ' + kind);
  const K = KINDS[kind];
  return [clampInt(variant, K.variants), clampInt(lod, K.lods), kind === 'pine' && !!snow];
}

/** Геометрия тройки без кэша (повторяемость проверяют тесты). */
export function buildVegGeometry(kind, variant = 0, lod = 0, { snow = false } = {}) {
  const [v, l, s] = params(kind, variant, lod, snow);
  const b = new VegetationBuilder(kind === 'drift'), rng = createRng(hashSeed('veg', kind, v, l, s ? 'snow' : ''));
  const axis = BUILD[kind](b, rng, v, l, s);
  return b.build(`veg:${kind}:${v}:L${l}${s ? ':snow' : ''}`, { kind, variant: v, lod: l, snow: s, axis });
}

const cache = new Map();

/** Геометрия тройки «вид × вариант × LOD» из кэша страницы; время первой сборки идёт в VEG_GEN.ms. */
export function vegGeometry(kind, variant = 0, lod = 0, { snow = false } = {}) {
  const [v, l, s] = params(kind, variant, lod, snow);
  const key = `${kind}:${v}:${l}:${s ? 1 : 0}`;
  let g = cache.get(key);
  if (!g) {
    const t0 = performance.now();
    g = buildVegGeometry(kind, v, l, { snow: s });
    VEG_GEN.ms += performance.now() - t0;
    cache.set(key, g);
  }
  return g;
}
