// Раскладка растений (спецификация «Растительность» §6): участок site собирает environment.js (vegSite), здесь —
// правила видов. Растение — { kind, variant, x, y, z, ry, s, color, lod?, blob? }: lod — закреплённый уровень,
// blob: false — без пятна-тени. Чистый модуль: без three, window, document и Math.random.
import { KINDS, PINE_FROM, vegTheme, GRASS } from './kinds.js';
import { landHeight } from '../../core/landform.js';

/** Случайные точки в кольце rMin..rMax с минимальным зазором gap, прошедшие проверку ok. */
export function scatter(rng, n, rMin, rMax, gap, ok) {
  const out = [];
  for (let k = 0; k < n * 40 && out.length < n; k++) {
    const a = rng.uniform(0, Math.PI * 2), r = Math.sqrt(rng.uniform(rMin * rMin, rMax * rMax));
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (!ok(x, z)) continue;
    if (out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < gap * gap)) continue;
    out.push({ x, z });
  }
  return out;
}

const variantOf = (rng, kind) => rng.int(0, KINDS[kind].variants - 1);

/** Радиус следа вида на земле при s = 1, м (у изгороди — полуширина сегмента): растения не ставятся друг в друга. */
export const FOOT = { tree: 0.6, pine: 0.6, bush: 0.9, drift: 1.0, hedge: 0.35, bed: 0.8, flowers: 0.5, rock: 0.5 };

/** Расстояние от точки (x, z) до отрезка (ax, az)–(bx, bz). */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Расстояние до ближайшего маршрута жителей site.walkways (ломаные точек { x, z }); без маршрутов — Infinity. */
export function walkwayDistance(site, x, z) {
  let d = Infinity;
  for (const path of site.walkways ?? []) {
    for (let i = 1; i < path.length; i++) d = Math.min(d, segDist(x, z, path[i - 1].x, path[i - 1].z, path[i].x, path[i].z));
  }
  return d;
}

/** Концы сегмента изгороди p: вдоль локальной оси x, повёрнутой на ry (как матрица экземпляра поля), [ax, az, bx, bz]. */
function hedgeEnds(p) {
  const h = (HEDGE.len / 2) * p.s, c = Math.cos(p.ry), s = Math.sin(p.ry);
  return [p.x - c * h, p.z + s * h, p.x + c * h, p.z - s * h];
}

/** Не задевает ли круг (x, z, r) следы растений list. */
function freeCircle(list, x, z, r) {
  for (const p of list) {
    const f = FOOT[p.kind] * p.s + r;
    if (p.kind === 'hedge' ? segDist(x, z, ...hedgeEnds(p)) < f : (p.x - x) ** 2 + (p.z - z) ** 2 < f * f) return false;
  }
  return true;
}

/** Не задевает ли отрезок (ax, az)–(bx, bz) толщины r следы растений list; изгороди между собой разводят правила линий. */
function freeSegment(list, ax, az, bx, bz, r) {
  for (const p of list) if (p.kind !== 'hedge' && segDist(p.x, p.z, ax, az, bx, bz) < FOOT[p.kind] * p.s + r) return false;
  return true;
}

/**
 * Деревья и кусты (сугробы) на местах прежнего buildTrees (план, отличие 10): места, повороты, масштабы и цвета —
 * из rng той же последовательностью. Выбор елей дальше PINE_FROM и варианты — из rng.fork(1) после неё.
 * Кусты в секторе камеры отбрасываются (спецификация §6.4), остальные стоят на прежних местах.
 */
function placeTreesAndBushes(site, rng, V, out) {
  const [t0, t1] = site.rings.tree, [b0, b1] = site.rings.bush;
  const pts = scatter(rng, V.trees, t0, t1, 3.2, (x, z) => site.clear(x, z, 1.4) && site.outOfView(x, z));
  const trees = pts.map(({ x, z }) => ({ x, z, ry: rng.uniform(0, Math.PI * 2), s: rng.uniform(0.8, 1.35) }));
  const leaves = V.leaves.length ? trees.map(() => rng.pick(V.leaves)) : null;
  const bushPts = scatter(rng, 44, b0, b1, 1.6, (x, z) => site.clear(x, z, 0.7));
  const bushes = bushPts.map(({ x, z }) => ({ x, z, ry: rng.uniform(0, Math.PI * 2), s: rng.uniform(0.7, 1.3) }));
  const bushColors = bushes.map(() => rng.pick(V.bushes));
  const pr = rng.fork(1);
  trees.forEach((it, i) => {
    const pine = V.pineShare >= 1 || (V.pineShare > 0 && Math.hypot(it.x, it.z) > PINE_FROM && pr.next() < V.pineShare);
    const kind = pine ? 'pine' : 'tree';
    out.push({ kind, variant: variantOf(pr, kind), x: it.x, y: 0, z: it.z, ry: it.ry, s: it.s, color: pine ? pr.pick(V.pines) : leaves[i] });
  });
  const kind = V.bushKind;
  bushes.forEach((it, i) => {
    const variant = variantOf(pr, kind);
    if (site.outOfView(it.x, it.z)) out.push({ kind, variant, x: it.x, y: 0, z: it.z, ry: it.ry, s: it.s, color: bushColors[i] });
  });
}

/**
 * Изгородь (план, отличие 7): сегмент len при s = 1, шаг step; линия — off за наружным краем тротуара, до reach от центра.
 * Отрезки по run сегментов, между ними случайный разрыв gap. Разрывы у перекрёстка (crossGap за линией другой дороги),
 * у площади (plazaGap), у фонарей своей стороны (lampGap от торца), у маршрутов жителей (walk), у деревьев и кустов.
 * Торцы у препятствий закрывают круглые кусты масштаба end: endGap за торцом, endOut дальше от дороги, не ближе capLamp
 * к фонарю и только вне сектора камеры (кусты выше газона, спецификация §6.4).
 */
export const HEDGE = {
  len: 2.5, step: 2.4, off: 0.6, reach: 40, run: [3, 5], gap: [1.5, 2.5], s: [0.92, 1.12],
  crossGap: 1.5, plazaGap: 1.5, lampGap: 0.6, walk: 0.9, end: [0.55, 0.68], endGap: 0.35, endOut: 0.15, capLamp: 1.0,
};

/** Изгороди вдоль обеих сторон каждой дороги участка (спецификация §6.1). */
function placeHedges(site, rng, V, out) {
  if (!V.hedges) return;
  const line = site.band + HEDGE.off, reach = Math.min(site.reach, HEDGE.reach);
  for (const road of site.roads) for (const side of [-1, 1]) {
    const ax = road.along === 'x', w0 = road.at + side * line, ry0 = ax ? 0 : Math.PI / 2;
    /** Точка линии: u — вдоль дороги, dw — дальше от дороги. */
    const at = (u, dw = 0) => (ax ? [u, w0 + side * dw] : [w0 + side * dw, u]);
    const lamps = site.lamps.map((l) => (ax ? [l.x, l.z] : [l.z, l.x]))
      .filter(([, w]) => Math.abs(w - road.at) < site.band && Math.sign(w - road.at) === side).map(([u]) => u);
    const fits = (u, s) => {
      const half = (HEDGE.len / 2) * s;
      if (lamps.some((lu) => Math.abs(lu - u) < half + HEDGE.lampGap)) return false;
      for (const k of [-1, 0, 1]) {
        const [x, z] = at(u + k * half);
        if (!site.clear(x, z, FOOT.hedge) || Math.hypot(x, z) < site.plaza + HEDGE.plazaGap) return false;
        if (site.roads.some((o) => o !== road && Math.abs((o.along === 'x' ? z : x) - o.at) < line + HEDGE.crossGap)) return false;
        if (walkwayDistance(site, x, z) < HEDGE.walk) return false;
      }
      return freeSegment(out, ...at(u - half), ...at(u + half), FOOT.hedge * s);
    };
    /** Куст у торца сегмента seg = { u, s } со стороны dir (−1 — начало, +1 — конец). */
    const cap = (seg, dir) => {
      const s = rng.uniform(...HEDGE.end), u = seg.u + dir * ((HEDGE.len / 2) * seg.s + HEDGE.endGap);
      const [x, z] = at(u, HEDGE.endOut);
      if (lamps.some((lu) => Math.abs(lu - u) < HEDGE.capLamp) || !site.clear(x, z, 0.7) || !site.outOfView(x, z)) return;
      if (!freeCircle(out.filter((o) => o.kind !== 'hedge'), x, z, FOOT.bush * s)) return;
      out.push({ kind: 'bush', variant: variantOf(rng, 'bush'), x, y: 0, z, ry: rng.uniform(0, Math.PI * 2), s, color: rng.pick(V.bushes) });
    };
    let left = 0, last = null, opened = true; // opened — следующий сегмент начинает изгородь после препятствия
    for (let u = -reach + HEDGE.step / 2; u <= reach - HEDGE.step / 2;) {
      if (!left) left = rng.int(...HEDGE.run);
      const s = rng.uniform(...HEDGE.s);
      if (fits(u, s)) {
        const [x, z] = at(u);
        out.push({ kind: 'hedge', variant: 0, x, y: 0, z, ry: ry0 + (rng.next() < 0.5 ? 0 : Math.PI), s, color: rng.pick(V.hedges) });
        last = { u, s };
        if (opened) { cap(last, -1); opened = false; }
        u += HEDGE.step;
        if (--left === 0) u += rng.uniform(...HEDGE.gap);
      } else {
        if (last) cap(last, 1);
        last = null;
        opened = true;
        left = 0;
        u += HEDGE.step;
      }
    }
    if (last) cap(last, 1);
  }
}

/** Клумбы (спецификация §6.1): n штук на кольцах rings вокруг площади с шагом step, за линиями изгородей (margin). */
const BEDS = { n: [6, 10], rings: [9.3, 10.8, 12.3], step: Math.PI / 12, gap: 2.6, margin: 1.9, walk: 1.25, s: [0.85, 1.05] };

function placeBeds(site, rng, V, out) {
  if (!V.hedges || !site.plaza) return;
  const n = rng.int(...BEDS.n), a0 = rng.uniform(0, BEDS.step), beds = [];
  for (const R of BEDS.rings) for (let a = a0; a < Math.PI * 2 && beds.length < n; a += BEDS.step) {
    const x = Math.sin(a) * R, z = Math.cos(a) * R, s = rng.uniform(...BEDS.s);
    if (!site.clear(x, z, BEDS.margin) || walkwayDistance(site, x, z) < BEDS.walk) continue;
    if (beds.some((b) => Math.hypot(b.x - x, b.z - z) < BEDS.gap) || !freeCircle(out, x, z, FOOT.bed * s)) continue;
    const p = { kind: 'bed', variant: 0, x, y: 0, z, ry: rng.uniform(0, Math.PI * 2), s, color: rng.pick(V.flowers) };
    beds.push(p);
    out.push(p);
  }
}

/** Цветочные пятна (спецификация §6.1): до r от центра — маршруты жителей тянутся на ±30 м; в виде города — до city за краем. */
const FLOWERS = { r: 30, city: 12, gap: 1.2, margin: 1.4, s: [0.55, 1.1] };

function placeFlowers(site, rng, V, out) {
  if (!V.flowers) return;
  const r0 = site.city ? site.city.half : site.plaza + 0.8, r1 = site.city ? r0 + FLOWERS.city : FLOWERS.r;
  const foot = FOOT.flowers * FLOWERS.s[1]; // масштаб ещё не выбран — след наибольшего пятна
  const pts = scatter(rng, rng.int(...V.flowerPatches), r0, r1, FLOWERS.gap, (x, z) => site.clear(x, z, FLOWERS.margin) && freeCircle(out, x, z, foot));
  for (const { x, z } of pts) {
    out.push({ kind: 'flowers', variant: 0, x, y: 0, z, ry: rng.uniform(0, Math.PI * 2), s: rng.uniform(...FLOWERS.s), color: rng.pick(V.flowers) });
  }
}

/**
 * Камни (спецификация §6.1): группы по group штук; первый камень группы крупнее (big), остальные — в spread от него (small).
 * Кольцо r от центра, в виде города — city за краем города; tries — попыток начать группу на камень цели, misses — промахов внутри группы.
 */
const ROCKS = {
  r: [12, 40], city: [2, 30], group: [2, 3], spread: [0.8, 1.4], margin: 1.5, walk: 1,
  big: [0.7, 0.95], small: [0.4, 0.7], tries: 30, misses: 12,
};

function placeRocks(site, rng, V, out) {
  const [r0, r1] = site.city ? ROCKS.city.map((d) => site.city.half + d) : ROCKS.r;
  const n = rng.int(...V.rocks);
  const ok = (x, z, s) => site.clear(x, z, ROCKS.margin) && walkwayDistance(site, x, z) >= ROCKS.walk && freeCircle(out, x, z, FOOT.rock * s);
  const rock = (x, z, s) => out.push({ kind: 'rock', variant: 0, x, y: 0, z, ry: rng.uniform(0, Math.PI * 2), s, color: '#ffffff' });
  let count = 0;
  for (let t = 0; t < ROCKS.tries * n && count < n; t++) {
    const a = rng.uniform(0, Math.PI * 2), r = Math.sqrt(rng.uniform(r0 * r0, r1 * r1));
    const cx = Math.sin(a) * r, cz = Math.cos(a) * r, k = Math.min(rng.int(...ROCKS.group), n - count), s0 = rng.uniform(...ROCKS.big);
    if (!ok(cx, cz, s0)) continue;
    rock(cx, cz, s0);
    count++;
    for (let i = 1, miss = 0; i < k && miss < ROCKS.misses;) {
      const b = rng.uniform(0, Math.PI * 2), d = rng.uniform(...ROCKS.spread), s = rng.uniform(...ROCKS.small);
      const x = cx + Math.sin(b) * d, z = cz + Math.cos(b) * d;
      if (ok(x, z, s)) { rock(x, z, s); count++; i++; } else miss++;
    }
  }
}

/**
 * Высота поверхности над точкой (x, z) или −Infinity вне её основания.
 * Новые хребты содержат карту вершин; поддерживаются также аналитические участки vegSite без сетки.
 */
export function hillSurface(hill, x, z) {
  if (hill.table) return landHeight(hill, x, z);
  const dx = x - hill.x, dz = z - hill.z;
  if (hill.cone) {
    const d = Math.hypot(dx, dz);
    return d < hill.base ? hill.y + hill.h * (1 - d / hill.base) : -Infinity;
  }
  const c = Math.cos(hill.a), s = Math.sin(hill.a);
  const u = (dx * c - dz * s) / hill.sx, w = (dx * s + dz * c) / hill.sz, q = u * u + w * w;
  return q < 1 ? hill.y + hill.h * Math.sqrt(1 - q) : -Infinity;
}

/**
 * Рощи (спецификация §6.1, план, отличие 6): n крупных деревьев масштаба s на склоне каждого холма ближнего кольца,
 * обращённом к центру: направление на центр ± spread рад, доля rho эллипса основания. Дерево ставится, только если в этой
 * точке его холм выше соседних, и не ближе gap к другим деревьям рощ. Уровень закреплён на L2, пятен нет; посадка на sink
 * ниже грани, чтобы низ корневой лапы входил в почву. tries — попыток на дерево.
 */
const GROVE = { n: [6, 8], s: [0.88, 1.52], rho: [0.25, 0.8], spread: 1.2, gap: 3, sink: 0.18, tries: 12 };

function placeGroves(site, rng, V, out) {
  const top = (x, z) => Math.max(...site.hills.map((h) => hillSurface(h, x, z)));
  const groves = [];
  for (const hill of site.hills) {
    if (hill.ring !== 0 || hill.cone) continue;
    const n = rng.int(...GROVE.n), c = Math.cos(hill.a), sn = Math.sin(hill.a);
    for (let t = 0, placed = 0; t < n * GROVE.tries && placed < n; t++) {
      const th = Math.atan2(-hill.x, -hill.z) + rng.uniform(-GROVE.spread, GROVE.spread), rho = rng.uniform(...GROVE.rho);
      const dx = Math.sin(th), dz = Math.cos(th);
      const d = rho / Math.hypot((dx * c - dz * sn) / hill.sx, (dx * sn + dz * c) / hill.sz); // точка на доле rho эллипса
      const x = hill.x + dx * d, z = hill.z + dz * d, y = hillSurface(hill, x, z);
      if (!Number.isFinite(y) || y < 0.2 || y < top(x, z) || groves.some((g) => Math.hypot(g.x - x, g.z - z) < GROVE.gap)) continue;
      const kind = V.pineShare >= 1 || rng.next() < V.pineShare ? 'pine' : 'tree';
      const p = {
        kind, variant: variantOf(rng, kind), x, y: y - GROVE.sink, z, ry: rng.uniform(0, Math.PI * 2), s: rng.uniform(...GROVE.s),
        color: rng.pick(kind === 'pine' ? V.pines : V.leaves), lod: 2, blob: false,
      };
      groves.push(p);
      out.push(p);
      placed++;
    }
  }
}

/** Большие просветы и сцепленные кроны задаются общей картой плотности.
 * Пространственный индекс нужен только в момент посадки, в кадре работают батчи поля. */
function placeWoodlandEdges(site, rng, V, out) {
  const [inner, treeLimit] = site.rings.tree;
  // Травянистые мысы гавани выступают за окружность старого плоского острова.
  const outer = site.island ? site.island + 24 : treeLimit;
  const phases = Array.from({length: 4}, () => rng.uniform(0, Math.PI * 2));
  const stride = site.island ? 3.45 : 4.65;
  const period = site.island ? 8.4 : 11.8;
  // У уровня со стройкой взгляд проходит сквозь стволы к горизонту.
  // Дополнительные поляны открывают ночной силуэт города и цветущие кроны за башней.
  const threshold = 0.60 + (V.woodlandOpening ?? 0) + (site.city ? 0 : V.buildWoodlandOpening ?? 0);
  const grid = new Map(), cell = 8;
  const key = (i,j) => i * 65536 + j;
  const isTree = kind => kind === 'tree' || kind === 'pine';
  function insert(p) {
    const k = key(Math.floor(p.x/cell), Math.floor(p.z/cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  for (const p of out) insert(p);
  function free(x, z, kind, scale) {
    const ix = Math.floor(x/cell), iz = Math.floor(z/cell), foot = FOOT[kind]*scale;
    for (let j=iz-1; j<=iz+1; j++) for (let i=ix-1; i<=ix+1; i++) {
      const nearby = grid.get(key(i,j));
      if (!nearby) continue;
      for (const p of nearby) {
        if (p.kind === 'hedge') {
          if (segDist(x,z,...hedgeEnds(p)) < foot + FOOT.hedge*p.s) return false;
        } else {
          const gap = isTree(kind) && isTree(p.kind) ? (site.island ? 0.76 : 0.93)*(p.s+scale) : foot + FOOT[p.kind]*p.s;
          if ((x-p.x)**2 + (z-p.z)**2 < gap*gap) return false;
        }
      }
    }
    return true;
  }
  const massAt = (x,z) => {
    const u = x/period, v = z/period;
    return 0.61 + 0.32*Math.sin(u + phases[0] + 0.7*Math.sin(v + phases[1]))
      + 0.24*Math.cos(1.21*v - 0.49*u + phases[2]) + 0.10*Math.sin(1.83*u + v + phases[3]);
  };
  const rows = Math.ceil(outer / stride) + 1;
  for (let j=-rows; j<=rows; j++) for (let i=-rows; i<=rows; i++) {
    // Волнистые ряды с независимым смещением каждой ячейки разбивают регулярность стволов.
    const x = (i + (j & 1)*0.5 + 0.49*Math.sin(0.65*j + phases[1]) + rng.uniform(-0.41,0.41))*stride;
    const z = (j + 0.45*Math.cos(0.54*i + phases[3]) + rng.uniform(-0.41,0.41))*stride;
    const d = Math.hypot(x,z);
    if (d < inner || d >= outer || !site.outOfView(x,z)) continue;
    const edge = Math.max(0, 1 - (outer-d)/7);
    const mass = massAt(x,z) + (site.island ? 0.11 : 0) - 0.48*edge;
    // На опушке просвет занимает несколько крон. Низкие растения следуют
    // за краем рощи, а середина поляны остаётся открытой до следующей группы.
    const tall = mass > threshold + rng.uniform(-0.09,0.09);
    if (!tall && (mass < 0.32 || rng.next() > 0.24)) continue;
    const kind = tall ? (V.pineShare === 1 || d>PINE_FROM && rng.next()<V.pineShare ? 'pine' : 'tree') : V.bushKind;
    const mature = Math.max(0, Math.min(1, mass));
    const s = tall ? rng.uniform(1.05,1.54) + 0.42*mature : rng.uniform(0.72,1.04);
    const margin = tall ? Math.max(1.4,1.43*s) : Math.max(0.7,FOOT[kind]*s);
    let y = site.coastalLawn ? site.coastalLawn(x,z,margin) : 0;
    if (!Number.isFinite(y) || (!site.island && !site.clear(x,z,margin))) continue;
    if (walkwayDistance(site,x,z) <= 1.3 || !free(x,z,kind,s)) continue;
    for (const h of site.hills) {
      const reach = h.base ?? Math.max(h.sx,h.sz);
      if (Math.abs(x-h.x) <= reach && Math.abs(z-h.z) <= reach) y = Math.max(y,hillSurface(h,x,z)-0.07);
    }
    const palette = tall ? (kind === 'pine' ? V.pines : V.leaves) : V.bushes;
    const plant = {kind, variant: variantOf(rng,kind), x,y,z,s, ry: rng.uniform(0,2*Math.PI), color: rng.pick(palette), woodland:true};
    insert(plant);
    // Оставляем луг для облёта нижних этажей. Слот занимает площадь в раскладке,
    // поэтому соседний ряд не заполняет просвет и не сдвигаются дальние рощи.
    const buildClearing = !site.city && tall && d < 21 + 1.5*s + 1.2*Math.cos(0.18*x);
    if (!buildClearing) out.push(plant);
  }
}

/**
 * Растения окружения темы site.theme. rng — генератор раскладки (в environment.js — rng.fork(3), как у прежнего
 * buildTrees). Каждый следующий вид берёт свой rng.fork(k), k ≥ 4, в каждой теме: добавление видов не сдвигает прежние.
 */
export function placeEnvironment(site, rng) {
  const V = vegTheme(site.theme), out = [];
  placeTreesAndBushes(site, rng, V, out);
  placeHedges(site, rng.fork(4), V, out);
  placeBeds(site, rng.fork(5), V, out);
  placeFlowers(site, rng.fork(6), V, out);
  placeRocks(site, rng.fork(7), V, out);
  placeGroves(site, rng.fork(8), V, out);
  placeWoodlandEdges(site, rng.fork(9), V, out);
  return out;
}

/**
 * Маска травы (спецификация §6.3, §8.4; план, отличие 3): 1 на газоне, 0 на дорогах и тротуарах, площади, у крана,
 * на берегу и в воде острова, в квадрате города (site.clear) и на клумбах beds — всё с запасом GRASS.margin.
 */
export function grassMask(site, beds, x, z) {
  const m = GRASS.margin;
  if (!site.clear(x, z, m)) return 0;
  for (const b of beds) if ((x - b.x) ** 2 + (z - b.z) ** 2 < (FOOT.bed * b.s + m) ** 2) return 0;
  return 1;
}
