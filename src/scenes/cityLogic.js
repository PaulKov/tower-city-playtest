// Чистая логика экрана города (без three и DOM): сетка участков, вписывание камеры, жесты,
// сводка по городу и уведомления после стройки.
import { BUILDING_TYPES, CITIES, FLOOR_H, W0, isSyrnikCity } from '../core/levels.js';
import { blockedKind, canPlace, cityBuildingTypes, cityPopulation, earnedCityStars, inGrid, plotAt } from '../core/cityRules.js';
import { SLOT_IDS, kindFits } from '../core/decor.js';
import { GROUND_DECOR, ROOF_DECOR } from '../core/heroes.js';
import { cityStateFromSave } from '../core/progress.js';
import { createRng, hashSeed } from '../core/rng.js';
import { decodeShape, validShape } from '../core/towerShape.js';
import { HONEY_LIFT, TOPPINGS, toppingSpot, topCircle } from '../core/syrnikShape.js';

/** Сторона участка (с тротуаром), ширина улицы между участками и шаг сетки. */
export const PLOT = 6;
export const STREET = 2.4;
export const PITCH = PLOT + STREET;
/** Верх плитки участка, сторона корпуса здания в городе. */
export const PLOT_TOP = 0.14;
export const BUILDING_W = W0;
/** Высота крыши над последним этажом (с шпилями и трубами) — для вписывания в кадр. */
export const ROOF_TOP = { house: 1.9, shop: 1.9, office: 1.7, tower: 5.3 };
/**
 * Дом из сырников («Сладкий город» §5.6; город с floors: 'syrnik'): крыши нет, верх дома — верхний сырник. Его рант
 * стоит на 0,1 выше шага стопки (§5.1), сверху в стройке — слой пудры: SYRNIK_ROOF_TOP над верхом последнего этажа.
 * Середина верха сырника ниже ранта: место украшения — в ней, на SYRNIK_ROOF_SEAT от верха этажа (опора чуть уходит
 * в творог), а круг украшения — не шире ровной середины, SYRNIK_ROOF_FLAT наименьшей стороны верхнего этажа.
 * Числа — по дальней сетке пакета theme:sweet (тест syrnikCity.test.js сверяет их лучами по экземплярам карты).
 */
export const SYRNIK_ROOF_TOP = 0.12;
export const SYRNIK_ROOF_SEAT = -0.03;
export const SYRNIK_ROOF_FLAT = 0.3;
/** Высота декора на заблокированных клетках (деревья парка, холм). */
export const DECOR_TOP = 3.2;
/** Камера города: базовое рыскание, наклон («вид 45°»), размах поворота, наименьший предел приближения (cityZoomMax). */
export const CITY_CAM = { yaw: 30, pitch: 45, yawRange: 40, zoomMax: 2.6, yawPerPx: 0.25, wheelK: 0.0015 };
export const TAP_PX = 8;
export const TAP_MS = 500;

const DEG = Math.PI / 180;
const NEAR = 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fin = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * Участок и тип здания для стройки без выбора на карте (маршрут ?play=city&type=…): первый свободный
 * участок с самым крупным доступным типом; если свободных нет — перестройка первого подходящего участка.
 */
export function pickCityBuild(save, cityDef) {
  const cs = cityStateFromSave(save, cityDef);
  const types = cityBuildingTypes(cityDef, cs).slice().sort((a, b) => BUILDING_TYPES[b].floors - BUILDING_TYPES[a].floors);
  for (const free of [true, false]) {
    for (let y = 0; y < cityDef.size; y++) {
      for (let x = 0; x < cityDef.size; x++) {
        if (!!plotAt(cs, x, y) === free) continue;
        const typeId = types.find((t) => canPlace(cityDef, cs, x, y, t).ok);
        if (typeId) return { plot: { x, y }, typeId };
      }
    }
  }
  return null;
}

// ---------- сетка ----------

/** Центр участка (x, y) в мировых координатах; сетка отцентрована в начале координат, y сетки — ось z. */
export function plotCenter(size, x, y) {
  return { x: (x - (size - 1) / 2) * PITCH, z: (y - (size - 1) / 2) * PITCH };
}

/** Полуразмер города вместе с внешним кольцом улицы. */
export function cityHalf(size) {
  return size * PITCH / 2 + STREET / 2;
}

/** Клетка сетки под мировой точкой (половина улицы относится к соседнему участку) или null. */
export function cellAt(size, wx, wz) {
  const h = cityHalf(size);
  if (!Number.isFinite(wx) || !Number.isFinite(wz) || Math.abs(wx) > h || Math.abs(wz) > h) return null;
  const x = clamp(Math.floor(wx / PITCH + size / 2), 0, size - 1);
  const y = clamp(Math.floor(wz / PITCH + size / 2), 0, size - 1);
  return { x, y };
}

/** Координаты осевых линий улиц (одинаковы по x и z): между участками и по краю. */
export function streetCoords(size) {
  return Array.from({ length: size + 1 }, (_, i) => (i - size / 2) * PITCH);
}


/**
 * Высота верха здания над землёй: крыша типа над последним этажом, в городе из сырников (cityDef) — верхний сырник.
 * cityDef — город, чьими этажами нарисован дом; null — коробочные этажи и крыша типа.
 */
export function buildingTop(b, cityDef = null) {
  const base = PLOT_TOP + Math.max(0, b.floors | 0) * FLOOR_H;
  if (!isSyrnikCity(cityDef)) return base + (ROOF_TOP[b.type] ?? 2);
  // §4.1: верх дома — верх его начинки h · s (пудра — слой SYRNIK_ROOF_TOP; низ начинки в твороге, а сетка на столько же
  // длиннее — TOPPINGS); на золотом верхнем этаже крыша лежит на меду — выше на HONEY_LIFT; без этажей начинки нет
  const floors = houseFloors(b);
  if (!floors.length) return base + SYRNIK_ROOF_TOP;
  const t = floors[floors.length - 1], c = topCircle(floors), sp = toppingSpot(b.type, t, c.ox, c.oz);
  const rise = sp.kind === 'sugar' ? SYRNIK_ROOF_TOP : Math.max(SYRNIK_ROOF_TOP, TOPPINGS[sp.kind].h * sp.s);
  return base + (t.golden ? HONEY_LIFT : 0) + rise;
}

/**
 * Этажи дома в городе (спецификация «Своя башня» §6.1): { x, z, w, d, golden, perfect } от центра участка — из записи
 * формы, если она годится для b.floors; иначе floors ровных этажей BUILDING_W × BUILDING_W (галерея, тестовые сцены).
 */
export function houseFloors(b) {
  if (b && validShape(b.shape, b.floors)) return decodeShape(b.shape);
  const n = Math.max(0, b?.floors | 0);
  return Array.from({ length: n }, () => ({ x: 0, z: 0, w: BUILDING_W, d: BUILDING_W, golden: false, perfect: false }));
}

/** Габариты корпусов дома от центра участка { x0, x1, z0, z1 }: объединение этажей; без этажей — квадрат BUILDING_W. */
export function houseExtent(b) {
  const e = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const f of houseFloors(b)) {
    e.x0 = Math.min(e.x0, f.x - f.w / 2); e.x1 = Math.max(e.x1, f.x + f.w / 2);
    e.z0 = Math.min(e.z0, f.z - f.d / 2); e.z1 = Math.max(e.z1, f.z + f.d / 2);
  }
  return e.x0 <= e.x1 ? e : { x0: -BUILDING_W / 2, x1: BUILDING_W / 2, z0: -BUILDING_W / 2, z1: BUILDING_W / 2 };
}

/**
 * Дома города для сборки: plots — участки по индексу y · size + x → [{ x, y, cx, cz, type, floors, shape }]
 * (клетка, центр участка, тип, этажи, запись формы); пустые участки и дома без этажей пропускаются.
 */
export function houseList(cityDef, plots) {
  const size = cityDef.size, out = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const b = plots?.[y * size + x];
    if (!b || !(b.floors > 0)) continue;
    const c = plotCenter(size, x, y);
    out.push({ x, y, cx: c.x, cz: c.z, type: b.type, floors: b.floors, shape: b.shape });
  }
  return out;
}

/**
 * Город для прогрева в меню (спецификация «Своя башня» §6.3): последний открытый в сессии (lastId), иначе город
 * с самым свежим домом (наибольший at; при равенстве — дальше по CITIES); без домов — null. Сохранение не меняется.
 */
export function prewarmPick(save, lastId = null) {
  const last = CITIES.find((c) => c.id === lastId);
  if (last) return last;
  let best = null, bestAt = -Infinity;
  for (const c of CITIES) {
    const plots = save?.cities?.[c.id]?.plots;
    if (!Array.isArray(plots)) continue;
    for (const p of plots) {
      const at = Number.isFinite(p?.at) ? p.at : 0;
      if (p && p.floors > 0 && at >= bestAt) { best = c; bestAt = at; }
    }
  }
  return best;
}

// ---------- камера ----------

/** Вертикальный угол обзора: на узком экране шире, иначе город уходит слишком далеко. */
export function cityFov(aspect) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return a >= 1 ? 35 : Math.min(50, 35 + (1 - a) * 30);
}

/** Углы рыскания, при которых город обязан помещаться в кадр (весь диапазон поворота). */
export function viewYaws() {
  const out = [];
  for (let d = -CITY_CAM.yawRange; d <= CITY_CAM.yawRange; d += 5) out.push(CITY_CAM.yaw + d);
  return out;
}

/**
 * Точки, которые должны попасть в кадр: углы города на земле, верхи зданий (по габаритам корпусов) и декора.
 * houseDef — город, чьими этажами нарисованы дома (buildingTop): обычно сам cityDef, null — коробочные.
 */
export function cityFitPoints(cityDef, cityState, houseDef = cityDef) {
  const size = cityDef.size, h = cityHalf(size), pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * h, 0, sz * h]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const b = plotAt(cityState, x, y), built = b && b.floors > 0;
      const top = built ? buildingTop(b, houseDef) : blockedKind(cityDef, x, y) ? DECOR_TOP : 0;
      if (!(top > 0)) continue;
      const c = plotCenter(size, x, y);
      const e = built ? houseExtent(b) : { x0: -PLOT / 2, x1: PLOT / 2, z0: -PLOT / 2, z1: PLOT / 2 };
      for (const px of [e.x0, e.x1]) for (const pz of [e.z0, e.z1]) pts.push([c.x + px, top, c.z + pz]);
    }
  }
  return pts;
}

function basis(yaw, pitch) {
  const y = yaw * DEG, p = pitch * DEG;
  const z = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  const l = Math.hypot(z[2], z[0]) || 1;
  const x = [z[2] / l, 0, -z[0] / l];
  const u = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return { x, u, z };
}

function projectWith(p, B, focus, dist, t, aspect) {
  const ex = focus[0] + B.z[0] * dist, ey = focus[1] + B.z[1] * dist, ez = focus[2] + B.z[2] * dist;
  const vx = p[0] - ex, vy = p[1] - ey, vz = p[2] - ez;
  const depth = -(vx * B.z[0] + vy * B.z[1] + vz * B.z[2]);
  const cx = vx * B.x[0] + vy * B.x[1] + vz * B.x[2];
  const cy = vx * B.u[0] + vy * B.u[1] + vz * B.u[2];
  return [cx / (depth * t * aspect), cy / (depth * t), depth];
}

/**
 * Проекция точки в NDC камерой на орбите (как CameraRig без тряски): [x, y, глубина].
 * view = {focus:[x,y,z], dist, yaw, pitch, fov, aspect} (углы в градусах).
 */
export function projectNdc(p, view) {
  const B = basis(view.yaw, view.pitch);
  return projectWith(p, B, view.focus, view.dist, Math.tan(view.fov * DEG / 2), view.aspect);
}

/**
 * Минимальная дистанция и высота фокуса (фокус над центром города), при которых все точки при любом
 * рыскании из yaws лежат в свободной полосе экрана: insets — доли экрана под интерфейсом
 * {top, bottom, side}. По вертикали содержимое центрируется в полосе.
 */
export function fitCityView({ points, aspect, fov, pitch, yaws, insets } = {}) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const f = Number.isFinite(fov) && fov > 1 && fov < 170 ? fov : 35;
  const pt = fin(pitch, CITY_CAM.pitch);
  const ys = yaws?.length ? yaws : [CITY_CAM.yaw];
  const pts = points?.length ? points : [[0, 0, 0]];
  const ins = (k) => clamp(fin(insets?.[k], 0), 0, 0.4);
  const top = 1 - 2 * ins('top'), bot = -1 + 2 * ins('bottom'), side = 1 - 2 * ins('side');
  const band = (top + bot) / 2, t = Math.tan(f * DEG / 2);
  const bases = ys.map((y) => basis(y, pt));
  const focus = [0, 0, 0];

  const measure = (d, fy) => {
    focus[1] = fy;
    let lo = Infinity, hi = -Infinity, mx = 0, near = Infinity;
    for (const B of bases) {
      for (const p of pts) {
        const [x, y, depth] = projectWith(p, B, focus, d, t, a);
        if (depth < near) near = depth;
        if (Math.abs(x) > mx) mx = Math.abs(x);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return { lo, hi, mx, near };
  };
  const fits = (d, fy) => {
    const m = measure(d, fy);
    return m.near > NEAR && m.mx <= side && m.hi <= top && m.lo >= bot;
  };
  const search = (fy) => {
    let hi = 8;
    while (!fits(hi, fy) && hi < 1e5) hi *= 2;
    let lo = hi / 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, fy)) hi = mid; else lo = mid;
    }
    return hi;
  };

  let fy = 0, d = search(fy);
  for (let k = 0; k < 10; k++) {
    const m = measure(d, fy), c = (m.lo + m.hi) / 2;
    if (!Number.isFinite(c) || Math.abs(c - band) < 1e-4) break;
    fy += (c - band) * d * t / Math.max(0.2, Math.cos(pt * DEG));
    d = search(fy);
  }
  return { dist: Math.max(NEAR * 2, d), focusY: fy };
}

/**
 * Фокус орбиты, при котором точка target видна в точке экрана (cx, cy) NDC на той же глубине dist:
 * фокус сдвигается в плоскости экрана (панель участка закрывает часть кадра — участок уходит в свободную).
 */
export function focusForScreen(target, cx, cy, { dist, yaw, pitch, fov, aspect }) {
  const B = basis(yaw, pitch), t = Math.tan(fov * DEG / 2);
  const a = cx * dist * t * aspect, b = cy * dist * t;
  return [0, 1, 2].map((i) => target[i] - B.x[i] * a - B.u[i] * b);
}

/** Крупный план участка: наклон, ближайшая дистанция и доля свободной части кадра под участок с домом. */
export const CLOSE_PITCH = 40;
export const CLOSE_MIN = 14;
const CLOSE_FILL = 0.5;

/** Высота точки, на которую смотрит крупный план (середина дома с запасом на крышу). */
export function closeUpTargetY(top) {
  return Math.max(1.2, fin(top, 0) * 0.45);
}

/**
 * Дистанция крупного плана: участок (и дом высотой top и шириной width по габаритам корпусов) занимает долю fill
 * свободной части кадра (по умолчанию CLOSE_FILL — около половины, как у паспорта) — freeW, freeH — её доли по ширине
 * и высоте; не дальше maxDist (общего вида) и не ближе CLOSE_MIN. Дом не шире участка ничего не меняет.
 */
export function closeUpDistance({ top = 0, width = 0, fov = 35, aspect = 1, freeW = 1, freeH = 1, maxDist = Infinity, fill = CLOSE_FILL } = {}) {
  const t = Math.tan(clamp(fin(fov, 35), 5, 120) * DEG / 2);
  const a = clamp(fin(aspect, 1), 0.2, 5);
  const fw = clamp(fin(freeW, 1), 0.15, 1), fh = clamp(fin(freeH, 1), 0.15, 1), f = clamp(fin(fill, CLOSE_FILL), 0.1, 1);
  const tall = PLOT * 1.2 + Math.max(0, fin(top, 0)) * 0.75, wide = Math.max(PLOT, fin(width, 0)) * 1.5;
  const d = Math.max(tall / (2 * t * fh * f), wide / (2 * t * a * fw * f));
  const cap = Number.isFinite(maxDist) ? Math.max(CLOSE_MIN, maxDist) : Infinity;
  return clamp(d, CLOSE_MIN, cap);
}

/**
 * Уличный вид (спецификация §7.3): ближайшая дистанция, дистанция, с которой камера начинает спускаться,
 * наклон и высота фокуса у улицы; DOF ближе dofFrom, сила dof у улицы (подбирается по снимкам).
 */
export const STREET_VIEW = Object.freeze({ dist: 7, from: 16, pitch: 22, focusY: 0.8, dofFrom: 10, dof: 6 });

const smooth01 = (v) => { const t = clamp(fin(v, 0), 0, 1); return t * t * (3 - 2 * t); };

/** Предел приближения для вписанного вида: ближайшая дистанция — STREET_VIEW.dist, но не меньше CITY_CAM.zoomMax. */
export function cityZoomMax(fit) {
  return Math.max(CITY_CAM.zoomMax, fin(fit?.dist, 0) / STREET_VIEW.dist);
}

/** Вес уличного вида по дистанции: 0 при ≥ STREET_VIEW.from, 1 при ≤ STREET_VIEW.dist, между — smoothstep. */
export function streetWeight(dist) {
  return smooth01((STREET_VIEW.from - dist) / (STREET_VIEW.from - STREET_VIEW.dist));
}

/** Сила DOF у улицы (спецификация §7.4): 0 при ≥ dofFrom, STREET_VIEW.dof при ≤ STREET_VIEW.dist. */
export function streetDof(dist) {
  return STREET_VIEW.dof * smooth01((STREET_VIEW.dofFrom - dist) / (STREET_VIEW.dofFrom - STREET_VIEW.dist));
}

/**
 * Камера для состояния обзора: приближение делит дистанцию и опускает фокус к земле; ближе STREET_VIEW.from
 * наклон и высота фокуса плавно переходят к уличным (вес streetWeight).
 * out = { focus: [x, y, z], dist, yaw, pitch } — запись в него, без новых объектов (кадр города); без out — новый объект.
 */
export function viewCamera(fit, view, out = { focus: [0, 0, 0], dist: 0, yaw: 0, pitch: 0 }) {
  const z = clamp(fin(view?.zoom, 1), 1, cityZoomMax(fit));
  const dist = fit.dist / z, w = streetWeight(dist), fy = fit.focusY / z, f = out.focus;
  f[0] = fin(view?.panX, 0);
  f[1] = fy + (STREET_VIEW.focusY - fy) * w;
  f[2] = fin(view?.panZ, 0);
  out.dist = dist;
  out.yaw = CITY_CAM.yaw + fin(view?.yaw, 0);
  out.pitch = CITY_CAM.pitch + (STREET_VIEW.pitch - CITY_CAM.pitch) * w;
  return out;
}

/**
 * Точка земли (y = 0) под точкой экрана nx, ny (NDC) для камеры view = {focus, dist, yaw, pitch, fov, aspect};
 * обратная к projectNdc на земле. null — луч не идёт к земле (выше горизонта) или ввод не число.
 */
export function groundUnder(view, nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const B = basis(view.yaw, view.pitch), t = Math.tan(view.fov * DEG / 2);
  const e = [0, 1, 2].map((i) => view.focus[i] + B.z[i] * view.dist);
  const d = [0, 1, 2].map((i) => -B.z[i] + B.x[i] * nx * t * view.aspect + B.u[i] * ny * t);
  if (!(d[1] < -1e-9) || !(e[1] > 0)) return null;
  const s = -e[1] / d[1];
  return { x: e[0] + d[0] * s, z: e[2] + d[2] * s };
}

// ---------- жесты ----------

/**
 * Жесты обзора города. Один палец или ЛКМ: короткое касание — тап, перетаскивание — поворот ±yawRange.
 * Два пальца: щипок — приближение, сдвиг — панорама. Колесо — приближение к курсору. ПКМ/СКМ — панорама.
 * groundAt(x, y) → {x, z} | null — точка земли под экранной точкой (дают сцена и текущая камера).
 * groundIn(view, x, y) → {x, z} | null — то же для произвольного вида (камера viewCamera, без отставания
 * пружины). С ней приближение держит точку под указателем точно, хотя у улицы меняется наклон; без неё — гомотетия.
 * zoomMax — предел приближения: сцена задаёт cityZoomMax вписанного вида через setZoomMax.
 * Состояние: view = {yaw (смещение от базового), zoom 1..zoomMax, panX, panZ (фокус над землёй)}.
 * Режим украшения (план «Украшения за монеты», спецификация §8.2) меняет два поля экземпляра: yawRange — размах поворота
 * (по умолчанию CITY_CAM.yawRange; ±180 — вокруг дома, без перехода через ±180: пружина камеры ведёт угол как число);
 * fixedFocus — фокус закреплён: ПКМ/СКМ и сдвиг двумя пальцами поворачивают, приближение не сдвигает panX/panZ.
 */
export class OrbitInput {
  constructor({ half = 20, groundAt = null, groundIn = null, zoomMax = CITY_CAM.zoomMax } = {}) {
    this.half = half;
    this.groundAt = groundAt;
    this.groundIn = groundIn;
    this.view = { yaw: 0, zoom: 1, panX: 0, panZ: 0 };
    this.yawRange = CITY_CAM.yawRange;
    this.fixedFocus = false;
    this._p = new Map();
    this._g = null;
    this.setZoomMax(zoomMax);
  }

  get active() { return this._p.size > 0; }

  /** Предел приближения (не меньше 1); текущий вид прижимается к новому пределу. */
  setZoomMax(z) {
    this.zoomMax = Math.max(1, fin(z, CITY_CAM.zoomMax));
    if (this.view.zoom > this.zoomMax) {
      this.view.zoom = this.zoomMax;
      this._clampPan();
    }
  }

  reset() {
    this.view = { yaw: 0, zoom: 1, panX: 0, panZ: 0 };
    this.yawRange = CITY_CAM.yawRange;
    this.fixedFocus = false;
    this._p.clear();
    this._g = null;
  }

  down(e) {
    if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
    this._p.set(e.id, { x: e.x, y: e.y });
    if (this._p.size === 1) {
      const pan = !this.fixedFocus && (e.button === 1 || e.button === 2);
      this._g = { mode: pan ? 'pan' : 'rotate', multi: false, moved: false, t0: fin(e.t, 0), x0: e.x, y0: e.y, ax: e.x, yaw0: this.view.yaw };
    } else {
      this._g.multi = true;
      this._startPinch();
    }
  }

  move(e) {
    const p = e && this._p.get(e.id);
    if (!p || !Number.isFinite(e.x) || !Number.isFinite(e.y) || !this._g) return;
    const g = this._g, prev = { x: p.x, y: p.y };
    if (g.mode === 'pinch') {
      const [a0, b0] = this._two();
      const midPrev = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      p.x = e.x; p.y = e.y;
      const [a, b] = this._two();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.fixedFocus) this._turn(this.view.yaw - (mid.x - midPrev.x) * CITY_CAM.yawPerPx);
      else this._panBy(midPrev, mid);
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.spread0 > 1 && spread > 0) this._zoomAbout(mid, g.zoom0 * spread / g.spread0);
      this._clampPan();
      return;
    }
    p.x = e.x; p.y = e.y;
    if (!g.moved && Math.hypot(e.x - g.x0, e.y - g.y0) > TAP_PX) g.moved = true;
    if (g.mode === 'pan') {
      this._panBy(prev, p);
      this._clampPan();
    } else if (g.moved) {
      this._turn(g.yaw0 - (e.x - g.ax) * CITY_CAM.yawPerPx);
    }
  }

  /** Поворот в пределах ±yawRange. */
  _turn(yaw) {
    const r = this.yawRange;
    this.view.yaw = clamp(yaw, -r, r) || 0;
  }

  /** Отпускание указателя; возвращает {tap:{x,y}} для тапа, иначе null. */
  up(e) {
    if (!e || !this._p.has(e.id)) return null;
    this._p.delete(e.id);
    const g = this._g;
    if (!g) return null;
    if (this._p.size === 0) {
      this._g = null;
      const quick = fin(e.t, g.t0) - g.t0 <= TAP_MS;
      const still = Math.hypot(fin(e.x, g.x0) - g.x0, fin(e.y, g.y0) - g.y0) <= TAP_PX;
      return g.mode === 'rotate' && !g.multi && !g.moved && quick && still ? { tap: { x: e.x, y: e.y } } : null;
    }
    this._regroup();
    return null;
  }

  /** Сбросить все указатели и жест (потеря фокуса, открытая панель); вид не меняется. */
  cancelAll() {
    this._p.clear();
    this._g = null;
  }

  cancel(id) {
    if (!this._p.delete(id)) return;
    if (this._p.size === 0) this._g = null;
    else this._regroup();
  }

  /** Колесо: deltaY в пикселях (сцена приводит строки/страницы к пикселям). */
  wheel(e) {
    if (!e || !Number.isFinite(e.deltaY) || e.deltaY === 0) return;
    this._zoomAbout({ x: e.x, y: e.y }, this.view.zoom * Math.exp(-e.deltaY * CITY_CAM.wheelK));
    this._clampPan();
  }

  // ---------- внутреннее ----------

  _two() { const it = this._p.values(); return [it.next().value, it.next().value]; }

  _startPinch() {
    const [a, b] = this._two();
    Object.assign(this._g, { mode: 'pinch', spread0: Math.hypot(a.x - b.x, a.y - b.y), zoom0: this.view.zoom });
  }

  /** После отпускания одного из пальцев: оставшийся палец продолжает поворот без скачка. */
  _regroup() {
    const g = this._g;
    if (this._p.size >= 2) { this._startPinch(); return; }
    const [a] = this._two();
    if (g.mode === 'pinch') g.mode = 'rotate';
    Object.assign(g, { moved: true, ax: a.x, yaw0: this.view.yaw });
  }

  _ground(s) {
    const q = this.groundAt?.(s.x, s.y);
    return q && Number.isFinite(q.x) && Number.isFinite(q.z) ? q : null;
  }

  /** Содержимое идёт за указателем: фокус смещается на разницу точек земли (обе — по текущей камере). */
  _panBy(from, to) {
    const a = this._ground(from), b = this._ground(to);
    if (!a || !b) return;
    this.view.panX -= b.x - a.x;
    this.view.panZ -= b.z - a.z;
  }

  /** Приближение с неподвижной точкой земли под экранной точкой s. */
  _zoomAbout(s, zoom) {
    const v = this.view, z0 = v.zoom, z1 = clamp(fin(zoom, z0), 1, this.zoomMax);
    if (this.fixedFocus) { v.zoom = z1; return; } // фокус закреплён: только дистанция
    if (this.groundIn) {
      // у улицы наклон и высота фокуса зависят от приближения: сдвиг на разницу точек под s до и после
      const a = this._groundIn(s);
      v.zoom = z1;
      const b = a && this._groundIn(s);
      if (b) { v.panX += a.x - b.x; v.panZ += a.z - b.z; }
      return;
    }
    const q = this._ground(s);
    if (q) {
      v.panX = q.x + (v.panX - q.x) * z0 / z1;
      v.panZ = q.z + (v.panZ - q.z) * z0 / z1;
    }
    v.zoom = z1;
  }

  /** Точка земли под s для текущего (ещё не показанного) вида. */
  _groundIn(s) {
    const q = this.groundIn?.(this.view, s.x, s.y);
    return q && Number.isFinite(q.x) && Number.isFinite(q.z) ? q : null;
  }

  /** Фокус не уходит за город; на исходном масштабе — строго в центре. С fixedFocus сдвиг не трогается. */
  _clampPan() {
    if (this.fixedFocus) return;
    const v = this.view, lim = this.half * (1 - 1 / v.zoom);
    v.panX = lim > 0 ? clamp(fin(v.panX, 0), -lim, lim) || 0 : 0;
    v.panZ = lim > 0 ? clamp(fin(v.panZ, 0), -lim, lim) || 0 : 0;
  }
}

// ---------- состояние города ----------

/** Что на участке: empty | built (можно открыть панель), blocked (с видом декора), outside. */
export function plotStatus(cityDef, cityState, x, y) {
  if (!inGrid(cityDef, x, y)) return { ok: false, code: 'outside' };
  const kind = blockedKind(cityDef, x, y);
  if (kind) return { ok: false, code: 'blocked', kind };
  return { ok: true, code: plotAt(cityState, x, y) ? 'built' : 'empty' };
}

/**
 * Сводка для верхней панели: население, звёзды (не меньше сохранённых), порог следующей звезды
 * и доля пути к нему, число зданий и свободных участков.
 */
export function cityInfo(cityDef, cityState, savedStars = 0) {
  const pop = cityPopulation(cityState);
  const stars = earnedCityStars(cityDef, pop, savedStars);
  const next = cityDef.stars[stars] ?? null;
  const prev = stars > 0 ? cityDef.stars[stars - 1] : 0;
  const progress = next == null ? 1 : clamp((pop - prev) / (next - prev), 0, 1);
  const built = cityState.plots.filter(Boolean).length;
  const free = cityDef.size * cityDef.size - cityDef.blocked.length - built;
  return { pop, stars, next, progress, built, free };
}

/** Уведомления при возвращении в город после стройки (outcome — звёзды до/после и набор бонусов). */
export function cityNotices(cityIndex, outcome) {
  if (!outcome) return [];
  const out = [], from = outcome.starsBefore | 0, to = outcome.starsAfter | 0;
  if (to > from) out.push({ kind: 'stars', from, to });
  if (outcome.starterPack) out.push({ kind: 'starterPack' });
  if (from < 1 && to >= 1 && CITIES[cityIndex + 1]) out.push({ kind: 'cityUnlocked', city: CITIES[cityIndex + 1] });
  return out;
}

// ---------- украшения и метки героев (спецификация «Герои городов» §7.3, §7.4) ----------

/**
 * Габариты украшения в его осях (до масштаба места): наземное — коробка x ±0,42, z ±0,24, высота ≤ 1,25;
 * крышное — круг радиуса 0,35, высота ≤ 1,1 (план «Герои городов», отличие 14).
 */
export const DECOR_BOX = Object.freeze({ ground: Object.freeze({ x: 0.42, z: 0.24, h: 1.25 }), roof: Object.freeze({ r: 0.35, h: 1.1 }) });
/** Разброс наземного украшения: сдвиг вдоль стороны места и поворот (рад), ±. */
export const DECOR_JITTER = 0.08;
/**
 * Наземные места по порядку (§7.3) от центра участка; ry — поворот лицом (+z украшения) наружу. Вход — сторона +z,
 * фонарь — угол +x +z. Центры на 2,4 от центра участка: при любом разбросе след не ближе 2,1 к основанию (стены ±2),
 * в плите участка (±2,95), в 0,5 от фонаря и в 0,6 от двери (тест cityLogic.test.js). b1, b2 — задний газон между кустами.
 */
export const DECOR_SLOTS = Object.freeze([
  { id: 'f1', dx: -1.3, dz: 2.4, ry: 0 },
  { id: 'f2', dx: 1.3, dz: 2.4, ry: 0 },
  { id: 's1', dx: -2.4, dz: 0, ry: -Math.PI / 2 },
  { id: 's2', dx: 2.4, dz: 0, ry: Math.PI / 2 },
  { id: 'c', dx: -2.4, dz: 2.4, ry: -Math.PI / 4 },
  { id: 'b1', dx: -0.95, dz: -2.62, ry: Math.PI },
  { id: 'b2', dx: 0.95, dz: -2.62, ry: Math.PI },
].map((s) => Object.freeze(s)));

/** Наименьший масштаб украшения на крыше: меньше — его не разглядеть; места нет — roofSpot → null. */
export const ROOF_S_MIN = 0.15;

/** Размер крыши, как в render/models/roof.js: сотые доли, не меньше 0,05. */
const roofSize = (v) => Math.max(0.05, Math.round((Number.isFinite(v) ? v : BUILDING_W) * 100) / 100);

/**
 * Место украшения на крыше верхнего этажа top = { w, d } (план, отличие 13) в координатах крыши (начало — центр
 * низа крыши, как в roof.js): { x, y, z, s }, s — масштаб украшения. Центр крыши занят трубой, бочкой и шпилем:
 * - house — на коньке, в четверти длины от середины, против трубы; y — ось конька: опора уходит в конёк;
 * - shop — передний левый угол внутри парапета, за вывеской; x и z зажаты (clamp) так, чтобы круг украшения
 *   (радиус DECOR_BOX.roof.r · s) оставался на настиле внутри парапета, и не задевал бочку и антенну: у узкого
 *   этажа масштаб уменьшается шагами 0,01 (не ниже ROOF_S_MIN), пока круг не поместится; у широких — как есть;
 * - office — передняя правая четверть сада: дерево — сзади справа, скамейка — спереди слева;
 * - tower — уступ первого яруса короны спереди; масштаб — по ширине уступа, круг — между поясом второго яруса
 *   и краем первого.
 * null — украшению не хватает места (уступ узкого небоскрёба): крышного украшения нет.
 * Размеры повторяют roof.js; тест heroDecor.test.js сверяет место лучами по buildRoof. Неизвестный тип — как shop.
 * В городе из сырников (cityDef, §5.6) крыши нет: у магазина, офиса и небоскрёба украшение стоит в начинке (toppingSpot,
 * circle = { ox, oz } — круг верхнего этажа, topCircle), на её опоре seat · s над верхом этажа (TOPPINGS); у дома и
 * там, где начинка не влезла, — середина верхнего сырника { 0, SYRNIK_ROOF_SEAT, 0 }, масштаб урезан так, чтобы круг
 * лежал на ровной середине (SYRNIK_ROOF_FLAT). На золотом верхнем этаже (top.golden) крыша лежит на меду: опора выше
 * на HONEY_LIFT.
 */
export function roofSpot(type, top, cityDef = null, circle = null) {
  const w = roofSize(top?.w), d = roofSize(top?.d), m = Math.min(w, d), s = clamp(m / 3, 0.4, 1);
  if (isSyrnikCity(cityDef)) {
    // §4.3: на начинке украшение стоит на её опоре (seat · s), в её следе; пудра (дом, узкий верх) — середина сырника
    const tp = toppingSpot(type, top, circle?.ox ?? 0, circle?.oz ?? 0), lift = top?.golden ? HONEY_LIFT : 0;
    if (tp.kind !== 'sugar') return { x: tp.x, y: lift + TOPPINGS[tp.kind].seat * tp.s, z: tp.z, s: Math.max(ROOF_S_MIN, Math.min(s, tp.s)) };
    const ss = Math.min(s, SYRNIK_ROOF_FLAT * m / DECOR_BOX.roof.r);
    return ss >= ROOF_S_MIN ? { x: 0, y: lift + SYRNIK_ROOF_SEAT, z: 0, s: ss } : null;
  }
  if (type === 'house') {
    const along = w >= d, L = along ? w : d, S = along ? d : w;
    const H = Math.min(1.35, 0.25 + S * 0.3), y = H + 0.09 / Math.cos(Math.atan2(H, S / 2));
    // до поворота конёк вдоль x и труба в +x; конёк вдоль z — поворот на 90°: (x, z) → (z, −x)
    return along ? { x: -0.25 * L, y, z: 0, s } : { x: 0, y, z: 0.25 * L, s };
  }
  const pt = Math.min(0.1, m * 0.2);
  if (type === 'office') {
    const iw = Math.max(0.05, w - 2 * pt - 0.06), id = Math.max(0.05, d - 2 * pt - 0.06);
    return { x: 0.25 * iw, y: 0.17, z: 0.25 * id, s };
  }
  if (type === 'tower') {
    // уступ (roof.js towerRoof): пояс второго яруса — до 0,31 · d + 0,02, край первого — 0,46 · d; место — 0,39 · d
    const z = 0.39 * d, rMax = Math.min(z - (0.31 * d + 0.02), 0.46 * d - z);
    const ts = Math.min(clamp(0.17 * m, 0.25, 1), rMax / DECOR_BOX.roof.r);
    return ts >= ROOF_S_MIN ? { x: 0, y: 0.45, z, s: ts } : null;
  }
  // торговый (roof.js shopRoof): бочка — при m ≥ 1, антенна с перекладинами — при m ≥ 0,6; оба — круги препятствий
  const tank = m >= 1 ? { x: -0.22 * w, z: -0.2 * d, r: Math.min(0.42, m * 0.16) + 0.07 } : null;
  const mast = m >= 0.6 ? { x: 0.28 * w, z: -0.22 * d, r: 0.23 } : null;
  for (let k = 0, ss = s; ss >= ROOF_S_MIN - 1e-9; ss = s - 0.01 * ++k) {
    const r = DECOR_BOX.roof.r * ss, lx = w / 2 - pt - r, lz = d / 2 - pt - r;
    if (lx < 0 || lz < 0) continue;
    const x = clamp(-w / 2 + pt + 0.05 + r, -lx, lx), z = clamp(d / 2 - 0.37 - r, -lz, lz);
    if ((!tank || Math.hypot(x - tank.x, z - tank.z) >= tank.r + r) && (!mast || Math.hypot(x - mast.x, z - mast.z) >= mast.r + r)) {
      return { x, y: 0.08, z, s: ss };
    }
  }
  return null;
}

/**
 * Разброс наземного украшения на месте slot: два броска rng (сдвиг, поворот) → { x, z, ry } от центра участка.
 * Сдвиг идёт вдоль оси x украшения при повороте slot.ry: (cos ry, −sin ry). Общий для героев и игрока.
 */
function groundJitter(slot, rng) {
  const u = rng.uniform(-DECOR_JITTER, DECOR_JITTER), ry = slot.ry + rng.uniform(-DECOR_JITTER, DECOR_JITTER);
  return { x: slot.dx + u * Math.cos(slot.ry), z: slot.dz - u * Math.sin(slot.ry), ry };
}

/**
 * Украшения дома героя (§7.3): b — дом участка { type, floors, shape }, decor — открытые виды по порядку
 * (heroes.decorOf). → [{ kind, slot, x, y, z, ry, s }]: x, z — от центра участка, y — высота опоры над землёй.
 * Крышный вид — в 'roof' над верхним этажом (только первый, только у дома с этажами и только если на крыше есть
 * место: roofSpot не null); наземные — по порядку
 * в DECOR_SLOTS; лишние и неизвестные виды пропускаются. Сдвиг и поворот — hashSeed(город, герой, место): жребий
 * участка не тратится, декор соседей не сдвигается. cityDef — город, чьими этажами нарисован дом (roofSpot).
 */
export function decorPlacement(cityId, heroId, b, decor, cityDef = null) {
  if (!b || !Array.isArray(decor)) return [];
  const floors = houseFloors(b), out = [];
  let ground = 0, roof = false;
  for (const kind of decor) {
    if (ROOF_DECOR.includes(kind)) {
      if (roof || !floors.length) continue;
      roof = true;
      const t = floors[floors.length - 1], spot = roofSpot(b.type, t, cityDef, isSyrnikCity(cityDef) ? topCircle(floors) : null);
      if (!spot) continue;
      const rng = createRng(hashSeed(cityId, heroId, 'roof'));
      out.push({
        kind, slot: 'roof', x: t.x + spot.x, y: PLOT_TOP + floors.length * FLOOR_H + spot.y, z: t.z + spot.z,
        ry: rng.uniform(-Math.PI, Math.PI), s: spot.s,
      });
    } else if (GROUND_DECOR.includes(kind) && ground < DECOR_SLOTS.length) {
      const slot = DECOR_SLOTS[ground++], j = groundJitter(slot, createRng(hashSeed(cityId, heroId, slot.id)));
      out.push({ kind, slot: slot.id, x: j.x, y: PLOT_TOP, z: j.z, ry: j.ry, s: 1 });
    }
  }
  return out;
}

/**
 * Украшения игрока на участке (план «Украшения за монеты»): decor = plot.decor { [место]: { k, c } }, c — индекс цвета.
 * → [{ kind, slot, color, x, y, z, ry, s }] в порядке SLOT_IDS; x, z — от центра участка, y — высота опоры.
 * Неизвестные места, виды не по месту и крыша без места (roofSpot → null) пропускаются. Разброс — как у героев, но
 * зерно hashSeed(город, 'player', индекс участка, место). cityDef — город, чьими этажами нарисован дом (roofSpot).
 */
export function playerDecorPlacement(cityId, index, b, decor, cityDef = null) {
  if (!b || !decor || typeof decor !== 'object') return [];
  const floors = houseFloors(b), out = [];
  for (const id of SLOT_IDS) {
    const d = Object.hasOwn(decor, id) ? decor[id] : null;
    if (!d || !kindFits(id, d.k)) continue;
    const rng = createRng(hashSeed(cityId, 'player', index, id));
    if (id === 'roof') {
      if (!floors.length) continue;
      const t = floors[floors.length - 1], spot = roofSpot(b.type, t, cityDef, isSyrnikCity(cityDef) ? topCircle(floors) : null);
      if (!spot) continue;
      out.push({
        kind: d.k, slot: id, color: d.c, x: t.x + spot.x, y: PLOT_TOP + floors.length * FLOOR_H + spot.y, z: t.z + spot.z,
        ry: rng.uniform(-Math.PI, Math.PI), s: spot.s,
      });
    } else {
      const j = groundJitter(DECOR_SLOTS.find((q) => q.id === id), rng);
      out.push({ kind: d.k, slot: id, color: d.c, x: j.x, y: PLOT_TOP, z: j.z, ry: j.ry, s: 1 });
    }
  }
  return out;
}

/**
 * Точки меток мест дома от центра участка: наземные — DECOR_SLOTS на PLOT_TOP + 0,6; roof — над верхним этажом по
 * roofSpot (+0,4; cityDef — город, чьими этажами нарисован дом); нет места — нет и roof. → [{ id, roof, x, y, z }]
 * в порядке SLOT_IDS.
 */
export function decorSlotsOf(b, cityDef = null) {
  const out = [];
  for (const s of DECOR_SLOTS) out.push({ id: s.id, roof: false, x: s.dx, y: PLOT_TOP + 0.6, z: s.dz });
  const floors = b ? houseFloors(b) : [];
  if (floors.length) {
    const t = floors[floors.length - 1], spot = roofSpot(b.type, t, cityDef, isSyrnikCity(cityDef) ? topCircle(floors) : null);
    if (spot) out.push({ id: 'roof', roof: true, x: t.x + spot.x, y: PLOT_TOP + floors.length * FLOOR_H + spot.y + 0.4, z: t.z + spot.z });
  }
  return out;
}

/** Сторона DOM-метки героя в пикселях по дистанции до камеры (§7.4): 40 до 15, 28 от 75, между — линейно. */
export function markSize(dist) {
  if (!Number.isFinite(dist)) return 28;
  return Math.round(40 - 12 * clamp((dist - 15) / 60, 0, 1));
}
