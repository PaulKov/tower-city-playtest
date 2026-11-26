// Дома города (спецификация «Детализация домов» §6): этажи L1 (floor.js) и крыши (roof.js) всех зданий, слитые
// по материалам — стены (cityBuildings), отделка (cityTrim), стекло (cityGlass) и прочие крыши (cityRoof:<материал>).
// Этажи — точно как сложил игрок (спецификация «Своя башня» §6.1): размер и сдвиг из записи формы, золотые — цветом
// стен, крыша — по верхнему этажу. Геометрия этажей и крыш копируется из общего кэша со сдвигом; кэш здесь не
// освобождается. Ночные окна у каждого здания свои: свет и штора стекла — из хэша города, участка, этажа и окна.
// Коробки выбора — для plotAt карты. createPrewarm — пошаговый прогрев общего кэша в простое (§6.3).
import * as THREE from 'three';
import { FLOOR_H, cityBuildingStyle } from '../../core/levels.js';
import { createRng, hashSeed } from '../../core/rng.js';
import { PLOT_TOP, BUILDING_W, buildingTop, houseFloors } from '../../scenes/cityLogic.js';
import { mat, PALETTE } from '../materials.js';
import { floorGeometry, DOOR_Y0, L1_MAX_OUT, SPECIAL_NIGHT, officeLight } from '../models/floor.js';
import { buildRoof } from '../models/roof.js';
import { WALL, wallMaterial } from './walls.js';

/** Сборки домов: общее и последнее время, мс; байты вершинных данных последней; число сборок (perf_check). */
export const CITY_GEN = { ms: 0, last: 0, bytes: 0, builds: 0 };
/** Полусторона коробки выбора ровного дома: корпус 4 м и вылет деталей L1 (L1_MAX_OUT). */
export const PICK_HALF = BUILDING_W / 2 + L1_MAX_OUT;
/** Стены золотого этажа в городе: слой штукатурки и вершинный цвет золота (§6.1; план, отличие 8). */
export const GOLD_WALL = Object.freeze({ layer: WALL.plaster, color: new THREE.Color(PALETTE.gold) });

const WALLS = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['aLayer', 1]];
const TRIM = [['position', 3], ['normal', 3], ['color', 3]];
const GLASS = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['aRoomCoord', 1]];

/** Корзина по материалу: стены, отделка, стекло — постоянные части, прочие — крыши со своим материалом. */
function bucket(buckets, material) {
  const name = material === wallMaterial() ? 'cityBuildings' : material === mat('trim') || material.name === 'facadeTrim' ? 'cityTrim'
    : material === mat('windows') || material.name === 'officeWindows' ? 'cityGlass' : 'cityRoof:' + (material.name || material.uuid);
  let b = buckets.get(name);
  if (!b) buckets.set(name, (b = { name, material, attrs: null, cast: false, items: [], verts: 0, indices: 0 }));
  return b;
}

/**
 * Кусок геометрии g со сдвигом (x, y, z) в корзину b; night — ночные окна этажа { city, x, y, floor, shop, special };
 * paint — { layer, color } вместо слоя и вершинного цвета стен (золотой этаж).
 */
function add(b, g, x, y, z, cast, night = null, paint = null) {
  const n = g.getAttribute('position').count;
  if (!n) return;
  b.attrs ??= WALLS.filter(([name]) => g.getAttribute(name));
  b.items.push({ g, x, y, z, night, paint });
  b.verts += n;
  b.indices += g.index ? g.index.count : n;
  b.cast ||= cast;
}

/**
 * Свет и штора каждого стекла этажа (4 вершины, uv с вершины v): свои у города, участка, этажа и окна, доли как
 * у paneOpts (floor.js); у спец-этажа — SPECIAL_NIGHT и без штор («Спец-этажи» §8). Неон (uv.x = 2, бокс из 24
 * вершин) и стекло двери (низ на DOOR_Y0) — как у этажа.
 */
function relight(uv, v, g, nt) {
  const pos = g.getAttribute('position'), n = pos.count;
  for (let i = 0, k = 0; i < n; k++) {
    if (uv[(v + i) * 2] === 2) { i += 24; continue; }
    const low = Math.min(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2), pos.getY(i + 3));
    if (low > DOOR_Y0 + 0.01) {
      const r = createRng(hashSeed(nt.city, nt.x, nt.y, nt.floor, k));
      const office = uv[(v + i) * 2 + 1] < 0;
      const lit = nt.special
        ? (r.next() < SPECIAL_NIGHT.share ? r.uniform(SPECIAL_NIGHT.lo, SPECIAL_NIGHT.hi) : 0.05)
        : office ? officeLight(r, nt.golden) : (r.next() < 0.72 ? r.uniform(0.55, 1) : 0.05);
      const curtain = !office && !nt.special && !nt.shop && r.next() < 0.3 ? r.uniform(0.35, 0.6) : 0;
      for (let j = 0; j < 4; j++) {
        uv[(v + i + j) * 2] = lit;
        if (!office) uv[(v + i + j) * 2 + 1] = curtain;
      }
    }
    i += 4;
  }
}

/** Слитая геометрия корзины: атрибуты b.attrs, индекс 16- или 32-битный; пустая — 0 вершин и нулевые границы. */
function merge(b) {
  const g = new THREE.BufferGeometry();
  const arrays = b.attrs.map(([name, size]) => {
    const a = name === 'aRoomCoord' ? new Uint8Array(b.verts) : new Float32Array(b.verts * size);
    g.setAttribute(name, new THREE.BufferAttribute(a, size));
    return a;
  });
  const index = b.verts > 65535 ? new Uint32Array(b.indices) : new Uint16Array(b.indices);
  const finish = b.items.some((it) => it.g.hasAttribute('aFacadeFinish')) ? new Uint8Array(b.verts) : null;
  if (finish) g.setAttribute('aFacadeFinish', new THREE.BufferAttribute(finish, 1));
  const pos = arrays[0], uvAt = b.attrs.findIndex(([name]) => name === 'uv');
  const colorAt = b.attrs.findIndex(([name]) => name === 'color'), layerAt = b.attrs.findIndex(([name]) => name === 'aLayer');
  let v = 0, k = 0;
  for (const it of b.items) {
    const src = it.g, n = src.getAttribute('position').count;
    if (finish && src.hasAttribute('aFacadeFinish')) finish.fill(1, v, v + n);
    b.attrs.forEach(([name, size], a) => {
      const s = src.getAttribute(name);
      if (s) arrays[a].set(s.array.length === n * size ? s.array : s.array.subarray(0, n * size), v * size);
      else if (name === 'color') arrays[a].fill(1, v * size, (v + n) * size);
    });
    for (let i = v * 3; i < (v + n) * 3; i += 3) { pos[i] += it.x; pos[i + 1] += it.y; pos[i + 2] += it.z; }
    if (it.night) relight(arrays[uvAt], v, src, it.night);
    if (it.paint && colorAt >= 0 && layerAt >= 0) {
      const c = it.paint.color, col = arrays[colorAt];
      for (let i = v; i < v + n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      arrays[layerAt].fill(it.paint.layer, v, v + n);
    }
    if (src.index) {
      const s = src.index.array;
      for (let i = 0; i < s.length; i++) index[k + i] = s[i] + v;
      k += s.length;
    } else {
      for (let i = 0; i < n; i++) index[k + i] = v + i;
      k += n;
    }
    v += n;
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  if (b.verts) { g.computeBoundingBox(); g.computeBoundingSphere(); } else {
    g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  }
  return g;
}

/**
 * Дома города: list — [{ x, y, cx, cz, type, floors, shape }] (клетка сетки, центр участка, тип, этажи, запись формы).
 * Этаж i — houseFloors(b)[i]: стиль type, его w × d, вариант i % 4, вход у этажа 0, тип спец-этажа из записи формы
 * («Спец-этажи» §6.1: свой вид и ночные окна SPECIAL_NIGHT), низ на PLOT_TOP + i · FLOOR_H,
 * центр — центр участка плюс сдвиг этажа; золотой — стены GOLD_WALL. Крыша — buildRoof(type) по верхнему этажу.
 * Без годной формы — ровные этажи BUILDING_W. Коробка выбора — габариты этажей плюс L1_MAX_OUT, от земли до крыши.
 * bare — рычаг 2 (§8.3): голые этажи L1 (floor.js), стекло и ночные окна те же.
 * → { parts: [{ name, geometry, material, cast }], boxes: [{ x, y, box }], bytes, ms, dispose() }. Части всегда
 * начинаются с cityBuildings, cityTrim и cityGlass (пустые — 0 вершин), затем крыши cityRoof:<материал>.
 */
export function buildCityBuildings(cityId, list, { bare = false } = {}) {
  const t0 = performance.now();
  const buckets = new Map(), boxes = [];
  let officeGlass = false;
  for (const [material, attrs] of [[wallMaterial(), WALLS], [mat('trim'), TRIM], [mat('windows'), GLASS]]) bucket(buckets, material).attrs = attrs;
  for (const b of list) {
    if (!b || !(b.floors > 0)) continue;
    const floors = houseFloors(b);
    const style = cityBuildingStyle(cityId, b.type);
    officeGlass ||= style === 'nightTower';
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    floors.forEach((f, i) => {
      const e = floorGeometry({ style, w: f.w, d: f.d, seed: i, lod: 1, entry: i === 0, bare, special: f.special, golden: style === 'nightTower' && f.golden });
      const x = b.cx + f.x, y = PLOT_TOP + i * FLOOR_H, z = b.cz + f.z;
      add(bucket(buckets, wallMaterial()), e.body, x, y, z, true, null, f.golden ? GOLD_WALL : null);
      add(bucket(buckets, mat('trim')), e.trim, x, y, z, true);
      add(bucket(buckets, mat('windows')), e.glass, x, y, z, false, { city: cityId, x: b.x, y: b.y, floor: i, shop: b.type === 'shop', special: !!f.special, golden: f.golden });
      x0 = Math.min(x0, x - f.w / 2); x1 = Math.max(x1, x + f.w / 2);
      z0 = Math.min(z0, z - f.d / 2); z1 = Math.max(z1, z + f.d / 2);
    });
    const t = floors[floors.length - 1], top = PLOT_TOP + floors.length * FLOOR_H;
    for (const m of buildRoof(style, t.w, t.d).children) add(bucket(buckets, m.material), m.geometry, b.cx + t.x, top, b.cz + t.z, m.castShadow);
    const pad = L1_MAX_OUT;
    const box = new THREE.Box3(new THREE.Vector3(x0 - pad, 0, z0 - pad), new THREE.Vector3(x1 + pad, buildingTop(b), z1 + pad));
    boxes.push({ x: b.x, y: b.y, box });
  }
  if (officeGlass) {
    buckets.get('cityBuildings').material = wallMaterial({ facade: true });
    buckets.get('cityTrim').material = mat('facadeTrim');
    buckets.get('cityGlass').material = mat('officeWindows');
  }
  const parts = [...buckets.values()].map((b) => ({ name: b.name, geometry: merge(b), material: b.material, cast: b.name !== 'cityGlass' && b.cast }));
  let bytes = 0;
  for (const p of parts) {
    for (const a of Object.values(p.geometry.attributes)) bytes += a.array.byteLength;
    bytes += p.geometry.index.array.byteLength;
  }
  const ms = performance.now() - t0;
  CITY_GEN.ms += ms; CITY_GEN.last = ms; CITY_GEN.bytes = bytes; CITY_GEN.builds++;
  return { parts, boxes, bytes, ms, dispose() { for (const p of parts) p.geometry.dispose(); } };
}

/** Предел шага прогрева, мс (спецификация «Своя башня» §6.3, §8). */
export const PREWARM_STEP_MS = 8;

/**
 * Пошаговый прогрев общего кэша геометрии для домов города (§6.3; план, отличие 2). Работы — этажи и крыша каждого
 * дома list в том виде, в каком их возьмёт buildCityBuildings с тем же bare. step(budgetMs) выполняет работы, пока
 * прошедшее время и оценка следующей укладываются в min(budgetMs, PREWARM_STEP_MS), но не меньше одной за шаг.
 * Оценка — затухающий максимум длительности работы, начальная 1 мс. key — город, bare и дома (тип, этажи, форма):
 * та же сборка — тот же ключ. now — часы (тесты). syrnik — дома города из сырников («Сладкий город» §5.6): их
 * строит houses/syrnikCity.js из сетки хранилища, без общего кэша, — работ коробочных домов нет. jobs — ещё работы
 * в ту же очередь, после домов (срезы сырников, syrnikHouseJobs; шаг Б §7.3); их число — в ключе: та же сборка с
 * другими работами — другая задача.
 * → { key, step(budgetMs) → выполнено работ, done, left }.
 */
export function createPrewarm(cityId, list, { bare = false, syrnik = false, jobs: extra = [], now = () => performance.now() } = {}) {
  const jobs = [], sig = [];
  for (const b of list) {
    if (!b || !(b.floors > 0)) continue;
    const floors = houseFloors(b);
    if (!syrnik) {
      const style = cityBuildingStyle(cityId, b.type);
      floors.forEach((f, i) => jobs.push(() => floorGeometry({ style, w: f.w, d: f.d, seed: i, lod: 1, entry: i === 0, bare, special: f.special, golden: style === 'nightTower' && f.golden })));
      const t = floors[floors.length - 1];
      jobs.push(() => buildRoof(style, t.w, t.d));
    }
    sig.push(`${b.x},${b.y},${b.type},${floors.length},${Array.isArray(b.shape) ? b.shape.join(':') : ''};`);
  }
  for (const job of extra) jobs.push(job);
  let next = 0, est = 1;
  return {
    key: `${cityId}|${bare ? 'bare' : 'full'}|${hashSeed(...sig)}${extra.length ? '|+' + extra.length : ''}`,
    get done() { return next >= jobs.length; },
    get left() { return jobs.length - next; },
    step(budgetMs) {
      const budget = Math.min(PREWARM_STEP_MS, budgetMs > 0 ? budgetMs : 0);
      const t0 = now();
      let t = t0, n = 0;
      while (next < jobs.length && (n === 0 || t - t0 + est <= budget)) {
        jobs[next++]();
        const t1 = now();
        est = Math.max(t1 - t, est * 0.9);
        t = t1;
        n++;
      }
      return n;
    },
  };
}
