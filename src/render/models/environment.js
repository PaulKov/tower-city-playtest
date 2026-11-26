// Окружение города: небо (шейдерный купол за камерой), туман, солнце с устойчивой тенью,
// земля, дороги с тротуарами, растительность, фонари и тематический декор.
// Статичное слито в немногие меши, повторяющееся — в InstancedMesh: не больше 28 объектов отрисовки без растений.
// Растения — поле vegetation/field.js (env.vegetation, спецификация «Растительность»).
// Ночь — флаг для любой темы: меняет небо и свет, декор остаётся. Ночной режим материалов
// (setNightMode) включает вызывающий код по env.night.
import * as THREE from 'three';
import { assets } from '../../assets/index.js';
import * as G from '../geomUtils.js';
import { lampGeometry, lampHeadGeometry, streetLampBatches } from './streetFurniture.js';
import { patchWater } from './waterDetail.js';
import { CLEAR_SKY_GLSL, STORM_LIGHT_GLSL, COAST_QUALITY, coastSeaMaterial, moonVisibility } from './coastSea.js';
import { createWaterContacts } from './waterContacts.js';
import { buildSkyline } from './nightSkyline.js';
import { pumpkinGeometry, snowmanGeometry, seasonalLod } from './seasonalProps.js';
import { curbRun } from './parkSurface.js';
import {
  ISLAND_R, BEACH_W, BEACH_DROP, WATER_Y, SHORE_R, OCEAN_TIME, OCEAN_WIND, BOAT_SPOTS, OCEAN_PIER,
  islandGroundGeometry, islandLawnHeight, beachFloor, beachBank, coastDistance, addDunePlants,
  oceanGeometry, beachGeometry, beachMaterial, oceanCulling, sampleOcean,
} from './oceanSurface.js';
import { harborBoatGeometry } from './harborBoat.js';
import { harborMaterial, offshorePierGeometry } from './harborDock.js';
import { mat, customMat, standard, PALETTE, NIGHT_UNIFORM } from '../materials.js';
import { getTexture } from '../textures.js';
import { groundMaterial, pavingMaterial } from '../groundMaterials.js';
import { DEFAULT_EXPOSURE, GRADE_NEUTRAL } from '../grade.js';
import { createRng, hashSeed } from '../../core/rng.js';
import { createLandform } from '../../core/landform.js';
import { horizonCulling, landformGeometry, landformMaterial, shadeGroveFloor } from './landform.js';
import { placeEnvironment, scatter, grassMask, FOOT, HEDGE } from '../vegetation/placement.js';
import { createVegetationField, plantGeometryAt } from '../vegetation/field.js';
import { trunkContact } from '../vegetation/trunkContact.js';
import { ResidentGround } from '../residents/ground.js';
import { walkSurface } from '../residents/walkSurface.js';
import { W0, D0 } from '../../core/levels.js';
import { createLeafLitter } from '../vegetation/leafLitter.js';
import { createFallingLeaves } from '../vegetation/fallingLeaves.js';

export { lampGeometry, lampHeadGeometry };
export const ENV_THEMES = ['valley', 'harbor', 'autumn', 'snow', 'night', 'sweet'];
/** Полуширина ортокамеры тени по умолчанию (в мировых единицах). */
export const SHADOW_HALF = 11;
export const FOG_NEAR = 60, FOG_FAR = 220;
/** Площадь под башней: радиус и высота верха плитки. */
export const PLAZA_R = 7.2, PLAZA_TOP = 0.08;
/** Высота верха тротуаров и асфальта. */
export const WALK_TOP = 0.1, ROAD_Y = 0.025;

const SUN_DIR = new THREE.Vector3(14, 24, 11).normalize();
const SUN_DIST = 50;
const FOCUS_STEP = 1 / 16;
/** Дороги: ось A (вдоль x) на z = ROAD_A_Z, ось B (вдоль z) на x = ROAD_B_X; полуширина, тротуар и бордюр (м). */
export const ROAD_A_Z = 9, ROAD_B_X = -12, ROAD_HALF = 1.5, WALK_W = 1.5, CURB_W = 0.2;
const CRANE_X = -5.5, CRANE_Z = -6.5;
const CAMERA_YAW = 30 * Math.PI / 180;
const GROUND_R = 240;
const HALO_DIR = new THREE.Vector3(-0.48, 0.11, -0.87).normalize();
const MOON_DIR = new THREE.Vector3(-0.42, 0.17, -0.89).normalize();
/**
 * Доля полусферного света, которая остаётся рядом с картой окружения (спецификация §6.1).
 * 0,4 — потолок подбора (Task 14, Step 13): принято пользователем, хотя chroma тёплых тем ниже допуска плана.
 */
export const HEMI_KEEP = 0.4;
/** Общая поправка яркости карты окружения: купол неба темнее цвета неба полусферного света. Подобрана по снимкам (Task 14, Step 13);
 * итог принят пользователем, хотя chroma valley/harbor/autumn (−10…−25 %) и luma night-street (−8 %) вне допусков плана.
 * Окончательно вид одобряется в Task 19. */
export const ENV_GAIN = 1.45;
/** Диск земли в сцене захвата: радиус и глубина под камерой захвата. */
const CAPTURE_GROUND_R = 400, CAPTURE_GROUND_DROP = 2;

// grade — окраска high, exposure — экспозиция на любом пресете, только если тема отличается от DEFAULT_EXPOSURE
// (спецификация §6.4). Ночь любой темы берёт их из NIGHT. Подобраны по снимкам (Task 16, Step 12).
const THEMES = {
  valley: {
    sky: { top: '#3f9be6', horizon: '#cfeaff', halo: '#fff0c8' },
    sun: ['#fff0d4', 2.4], hemi: ['#cfe9ff', '#9a8a6a', 1.1], fill: ['#9ec9ff', 0.45],
    grade: { contrast: 1.04, saturation: 1.05, warmth: 0.02, lift: 0.01 },
    ground: 'grass',
    hills: [['#5fa94e', '#8fd06e'], ['#6aae5c', '#a2d47f'], ['#7fae7c', '#b8d8a4']],
    clouds: ['#d9e4f2', '#ffffff'], cloudCount: 12,
  },
  harbor: {
    sky: { top: '#349df0', horizon: '#c8f0ff', halo: '#fff8dc' },
    sun: ['#fff4dc', 2.5], hemi: ['#d0efff', '#a89a72', 1.15], fill: ['#a5d6ff', 0.45],
    grade: { contrast: 1.04, saturation: 1.06, lift: 0.01 },
    ground: 'grass',
    hills: [['#5fa94e', '#8fd06e'], ['#6aae5c', '#a2d47f'], ['#7fae7c', '#b8d8a4']],
    clouds: ['#d9e6f4', '#ffffff'], cloudCount: 12,
  },
  autumn: {
    sky: { top: '#6d9dd0', horizon: '#f1dcc2', halo: '#ffd59a' },
    sun: ['#ffd9a8', 2.1], hemi: ['#f0dcc4', '#8a6a4a', 1.0], fill: ['#b8c6ff', 0.4],
    grade: { contrast: 1.05, saturation: 1.04, warmth: 0.03, lift: 0.015 },
    ground: 'autumn',
    hills: [['#b0802f', '#e0b25a'], ['#a8763a', '#d8a866'], ['#a08a6a', '#d2bf9c']],
    clouds: ['#e2d8cc', '#fff7ee'], cloudCount: 13,
  },
  snow: {
    sky: { top: '#7fb3e3', horizon: '#e9f2ff', halo: '#ffffff' },
    sun: ['#f6f9ff', 2.0], hemi: ['#e2efff', '#b9c8dc', 1.25], fill: ['#c4dcff', 0.5],
    grade: { contrast: 1.05, warmth: -0.01 },
    ground: 'snow',
    hills: [['#c9d8ec', '#ffffff'], ['#7d8fa8', '#ffffff'], ['#8d9db6', '#ffffff']],
    clouds: ['#d2dcea', '#ffffff'], cloudCount: 12,
  },
  // Сладкий город: весенняя кондитерская — розово-лиловое «леденцовое» небо со светлым горизонтом, мятная трава, холмы
  // взбитых сливок. Свет почти нейтральный, тёплое — только в куполе неба: тёплый свет на тёплом сырнике давал
  // оранжевый бок вместо сливочного (ревью вида задачи 11, находки 1 и 8; подбор по syrnik-game.jpg — бок s 0,54–0,60).
  // fog — свой туман дальше общего: тёплая дымка съедала холмы и деревья.
  sweet: {
    sky: { top: '#e9bce0', horizon: '#fff3ec', halo: '#fff8e8' },
    sun: ['#fff8f0', 2.5], hemi: ['#f0f0ff', '#cfc8bc', 1.15], fill: ['#eaeeff', 0.5],
    grade: { contrast: 1.03, saturation: 1, warmth: 0, lift: 0.02 },
    ground: 'mint',
    hills: [['#f1ddd4', '#fff9f4'], ['#f4d7e1', '#fff5f8'], ['#ecdfe8', '#fffbfd']],
    clouds: ['#f4e4ef', '#ffffff'], cloudCount: 12,
    fog: [110, 360],
  },
  night: {
    sky: { top: '#081230', horizon: '#2a396a', halo: '#5866aa' },
    sun: ['#a8bcff', 0.85], hemi: ['#4c5fa0', '#24203a', 0.55], fill: ['#6d84ff', 0.2],
    ground: 'grass',
    hills: [['#3f6a52', '#5f8a6a'], ['#3f5f5a', '#5f7f78'], ['#3f5266', '#5d7088']],
    clouds: ['#2c3558', '#55628f'], cloudCount: 7,
  },
};
const OVERCAST = {
  sky: { top: '#303c49', horizon: '#767573', rim: '#78858b' },
  sun: ['#b7cad9', 0.78], hemi: ['#d5deeb', '#8e8783', 1.25], fill: ['#b7c5cf', 0.46],
  fog: [17, 201], grade: { contrast: 1.02, saturation: 0.8, vignette: 0.25 }, exposure: 0.95,
};
const OVERCAST_NIGHT = {
  sky: { top: '#172031', horizon: '#484655', rim: '#525e74' },
  sun: ['#9daccf', 0.55], hemi: ['#8e9bbb', '#514958', 0.70], fill: ['#99a7c5', 0.29],
  fog: [22, 207], grade: { saturation: 0.85, vignette: 0.25 },
};

const NIGHT = {
  sky: { top: '#081230', horizon: '#2a396a', halo: '#5866aa' },
  sun: ['#a8bcff', 0.85], hemi: ['#4c5fa0', '#24203a', 0.55], fill: ['#6d84ff', 0.2],
  clouds: ['#2c3558', '#55628f'],
  grade: { contrast: 1.06, saturation: 1.0, warmth: -0.01, lift: 0.01, vignette: 0.26 },
  envGain: 1.15, // множитель к ENV_GAIN для ночи (Task 14, Step 13; ночные кадры чуть темнее «до»)
};

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
const _c = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3();

/**
 * Базис плоскости тени для направления на источник dir — как у Matrix4.lookAt (up = +y):
 * right = up × dir, up' = dir × right. Проекции на right/up — экранные оси карты теней.
 */
export function shadowBasis(dir, right = new THREE.Vector3(), up = new THREE.Vector3()) {
  _z.copy(dir);
  if (_z.lengthSq() === 0) _z.z = 1;
  _z.normalize();
  right.crossVectors(WORLD_UP, _z);
  if (right.lengthSq() === 0) { _z.z += 0.0001; _z.normalize(); right.crossVectors(WORLD_UP, _z); }
  right.normalize();
  up.crossVectors(_z, right);
  return { right, up };
}

/** Высота поверхности под точкой (площадь, тротуары, асфальт, земля) — для обломков и жителей. */
export function groundHeight(x, z) {
  const da = Math.abs(z - ROAD_A_Z), db = Math.abs(x - ROAD_B_X);
  if (da >= ROAD_HALF && db >= ROAD_HALF && Math.min(da, db) <= ROAD_HALF + WALK_W) return WALK_TOP;
  if (x * x + z * z <= PLAZA_R * PLAZA_R) return PLAZA_TOP;
  if (da <= ROAD_HALF || db <= ROAD_HALF) return ROAD_Y;
  return 0;
}

/** Непроходимые полосы асфальта оставляют открытыми зебры; испуганный зритель может выйти на газон. */
export function streetGround(lamps, reach, island = 0) {
  const shore = island ? (x, z, r) => x * x + z * z <= (island - r) ** 2 : null;
  const ground = new ResidentGround(groundHeight, shore);
  for (const [a, b] of [[-reach, -8.2 - 0.8], [-8.2 + 0.8, 6 - 0.8], [6 + 0.8, reach]]) {
    ground.box((a + b) / 2, ROAD_A_Z, (b - a) / 2, ROAD_HALF, 0, -Infinity, Infinity, true);
  }
  const offset = ROAD_HALF + WALK_W / 2, innerZ = ROAD_A_Z - offset, outerZ = ROAD_A_Z + offset;
  for (const [a, b] of [[-reach, innerZ - 0.7], [innerZ + 0.7, outerZ - 0.7], [outerZ + 0.7, reach]]) {
    ground.box(ROAD_B_X, (a + b) / 2, ROAD_HALF, (b - a) / 2, 0, -Infinity, Infinity, true);
  }
  ground.box(0, 0, W0 / 2, D0 / 2);
  ground.box(CRANE_X, CRANE_Z, 1.2, 1.2);
  for (const p of lamps) addLampCollider(ground, p.x, p.y, p.z, p.ry);
  return ground;
}

/** Уровень первых крупных ветвей и радиус нижней части ствола соответствуют фабрикам
 * cityFlora, maple, palm и spruce. У низкой ели ветви начинаются на высоте плеч.
 * Находим свободную сторону от видимой коры до места, где зверь стоит перед подходом. */
export function treeNatureSite(theme, p, scale, floor, clear, floraAtlas) {
  const pine = p.kind === 'pine', palm = theme === 'harbor';
  const radius = (pine ? .13 : palm ? .145 : theme === 'autumn' ? .17 : .195) * p.s;
  const fork = (pine ? .78 : palm ? 2.61 : theme === 'autumn' ? 1.05 : 1.17) * p.s;
  const rise = Math.min(fork - .25 * scale, (palm ? 1.16 : 1.35) * p.s);
  if (radius < .072 * scale || rise < .27 * scale) return null;
  const body = .44 * scale, start = radius + body + .48, height = .75 * scale;
  const mesh = plantGeometryAt(theme, floraAtlas, p, 0), point = {}, previous = {};
  for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const yaw = CAMERA_YAW + turn * Math.PI / 4, nx = Math.sin(yaw), nz = Math.cos(yaw);
    const x = p.x + nx * start, z = p.z + nz * start;
    const dry = floor(x, z);
    if (Math.abs(dry - p.y) > .25) continue;
    const contactAt = trunkContact(mesh, p, nx, nz, radius);
    contactAt(0, scale, previous);
    if (!clear(x, z, previous.x, previous.z, body, Math.min(dry, p.y), Math.max(dry, p.y) + height)) continue;
    let reachable = true;
    const steps = Math.ceil(rise / .09);
    for (let i = 1; i <= steps; i++) {
      const level = rise * i / steps;
      contactAt(level, scale, point);
      if (!clear(previous.x, previous.z, point.x, point.z, body, p.y + rise * (i - 1) / steps, p.y + level + height)) {
        reachable = false; break;
      }
      previous.x = point.x; previous.z = point.z;
    }
    if (!reachable) continue;
    return { kind: 'climb', x: p.x, z: p.z, y: p.y, nx, nz, radius, rise, floor, clear, contact: contactAt };
  }
  return null;
}

/** Один экземпляр уже посаженного взрослого дерева переносится на свободный газон слева от площади.
 * Выбор предшествует сборке теней, буферов растений, опада и коллайдеров. */
function activityTree(plants, theme) {
  const pine = theme === 'snow', kind = pine ? 'pine' : 'tree';
  let tree;
  if (theme === 'harbor') {
    // Пересаживаем пальму перед бухтой: между двумя рощами открывается вид
    // на пловца и с низкой широкой камеры, и с более дальней портретной.
    let nearest = Infinity;
    for (const p of plants) {
      if (p.kind !== 'tree' || p.lod || p.y !== 0 || p.s < .95) continue;
      const d = (p.x + 5) ** 2 + (p.z + 19) ** 2;
      if (d < nearest) { nearest = d; tree = p; }
    }
  } else tree = plants.find(p => p.kind === kind && !p.lod && p.y === 0 && p.s >= (pine ? 1.4 : 1.14));
  if (!tree) return null;
  for (const [x, z] of [[-7.7, -2.45], [-7.95, -2.30], [-8.15, -2.30], [-7.45, -3.05]]) {
    if (plants.some(p => p !== tree && p.kind !== 'flowers' && Math.hypot(x - p.x, z - p.z) < FOOT[p.kind] * p.s + .72)) continue;
    tree.x = x; tree.z = z;
    return tree;
  }
  return null;
}

/** В месте наложения площади и тротуара опад лежит на верхней из двух плит. */
export function litterGroundHeight(x, z) {
  const radius = Math.hypot(x, z), da = Math.abs(z - ROAD_A_Z), db = Math.abs(x - ROAD_B_X);
  const road = Math.min(da, db);
  const pavement = road <= ROAD_HALF ? ROAD_Y
    : road < ROAD_HALF + CURB_W ? WALK_TOP + 0.012 : road <= ROAD_HALF + WALK_W ? WALK_TOP : 0;
  // Десятимиллиметровые полосы по верху площади пересекают край листа.
  return Math.max(radius <= PLAZA_R ? PLAZA_TOP + 0.010 : 0, pavement);
}

/** Вершинный цвет-градиент по высоте: c0 внизу (y0), c1 вверху (y1). Меняет и возвращает geom. */
function gradientY(geom, c0, c1, y0, y1, power = 1) {
  const pos = geom.getAttribute('position'), n = pos.count, arr = new Float32Array(n * 3);
  const a = new THREE.Color(c0), b = new THREE.Color(c1), c = new THREE.Color();
  const span = Math.max(1e-6, y1 - y0);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(THREE.MathUtils.clamp((pos.getY(i) - y0) / span, 0, 1), power);
    c.copy(a).lerp(b, t).toArray(arr, i * 3);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

function mesh(name, geom, material, { cast = false, receive = true } = {}) {
  const m = new THREE.Mesh(geom, material);
  m.name = name; m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/** InstancedMesh по списку {x,y,z, rx,ry,rz, s|sx,sy,sz}; colors — цвета экземпляров (необязательно). */
function instanced(name, geom, material, items, { colors = null, cast = true, receive = true } = {}) {
  const n = items.length;
  const m = new THREE.InstancedMesh(geom, material, Math.max(1, n));
  m.name = name; m.count = n; m.castShadow = cast; m.receiveShadow = receive;
  for (let i = 0; i < n; i++) {
    const it = items[i], s = it.s ?? 1;
    _q.setFromEuler(_e.set(it.rx || 0, it.ry || 0, it.rz || 0));
    _s.set(it.sx ?? s, it.sy ?? s, it.sz ?? s);
    m.setMatrixAt(i, _m.compose(_p.set(it.x || 0, it.y || 0, it.z || 0), _q, _s));
    if (colors) m.setColorAt(i, _c.set(colors[i]));
  }
  m.visible = n > 0;
  m.computeBoundingSphere();
  return m;
}

// ---------- Раскладка участка ----------

/** city — {half, height}: квадрат города вместо площади, дорог и крана (их рисует карта города). */
function layout(theme, city = null) {
  const island = theme === 'harbor' ? ISLAND_R : 0;
  return { island, reach: island ? island - 3 : 200, city };
}

/** Вне квадрата города (по Чебышёву) с запасом m; +0.5 — пятна теней смещены от объекта. */
const outsideCity = (L, x, z, m) => Math.max(Math.abs(x), Math.abs(z)) >= L.city.half + m + 0.5;

/** Точка свободна от дорог, тротуаров, площади, крана (и берега на острове) с запасом m. */
function clearOf(L, x, z, m) {
  if (L.island && Math.hypot(x, z) > L.island - 1.5 - m) return false;
  return clearBuildings(L, x, z, m);
}

function clearBuildings(L, x, z, m) {
  if (L.city) return outsideCity(L, x, z, m);
  const band = ROAD_HALF + WALK_W + m;
  if (Math.abs(z - ROAD_A_Z) < band && Math.abs(x) < L.reach + m) return false;
  if (Math.abs(x - ROAD_B_X) < band && Math.abs(z) < L.reach + m) return false;
  if (Math.hypot(x, z) < PLAZA_R + m) return false;
  if (Math.hypot(x - CRANE_X, z - CRANE_Z) < 1.8 + m) return false;
  return true;
}

/** Угол точки от направления камеры по умолчанию (рыскание 30°), −π..π. */
function fromCamera(x, z) {
  const d = Math.atan2(x, z) - CAMERA_YAW;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/**
 * Высокие объекты не ставим в секторе между камерой и башней. В городе камера ходит ±40° и смотрит
 * под 45°: со стороны камеры деревья держим дальше от края, чтобы они не закрывали крайние участки.
 */
function outOfView(L, x, z) {
  if (L.city) return Math.abs(fromCamera(x, z)) > 1.35 || Math.max(Math.abs(x), Math.abs(z)) > L.city.half + 7;
  if (Math.hypot(x, z) > 48) return true;
  return Math.abs(fromCamera(x, z)) > 0.7;
}

/** Квадрат города {half, height} по параметрам createEnvironment или null. */
function cityLayout(cityHalf, cityHeight) {
  return Number.isFinite(cityHalf) && cityHalf > 0
    ? { half: cityHalf, height: Number.isFinite(cityHeight) && cityHeight > 0 ? cityHeight : 36 } : null;
}

/** Участок для раскладки растений (vegetation/placement.js) по раскладке L темы theme. */
function siteOf(theme, L, hills = []) {
  const town = !L.city; // дороги, площадь, фонари и маршруты жителей есть только вне вида города
  return {
    theme, city: L.city, island: L.island,
    clear: (x, z, m) => clearOf(L, x, z, m),
    coastalLawn: L.island ? (x,z,m) => {
      if (!clearBuildings(L,x,z,m) || (z < -L.reach && Math.abs(x-ROAD_B_X) < 1.4+m)) return -Infinity;
      return islandLawnHeight(L.island,SHORE_R,x,z,m);
    } : null,
    outOfView: (x, z) => outOfView(L, x, z),
    rings: {
      tree: [L.city ? L.city.half : 12, L.island ? L.island - 2 : L.city ? Math.max(70, L.city.half + 40) : 70],
      bush: [L.city ? L.city.half : PLAZA_R + 1, L.island ? L.island - 2 : 60],
    },
    roads: town ? [{ along: 'x', at: ROAD_A_Z }, { along: 'z', at: ROAD_B_X }] : [],
    band: ROAD_HALF + WALK_W, reach: L.reach, plaza: town ? PLAZA_R : 0,
    lamps: town ? lampSpots(L).map(({ x, z }) => ({ x, z })) : [],
    walkways: town ? walkways(L) : [],
    hills,
  };
}

/**
 * Участок раскладки растений темы (неизвестная — долина) → { theme, city, island, clear, outOfView, rings, roads, band,
 * reach, plaza, lamps, walkways, hills }. cityHalf — раскладка вида города, как у createEnvironment; hills — параметры
 * холмов (buildHills) для рощ.
 */
export function vegSite(theme = 'valley', { cityHalf = 0, hills = [] } = {}) {
  if (!ENV_THEMES.includes(theme)) theme = 'valley';
  return siteOf(theme, layout(theme, cityLayout(cityHalf)), hills);
}

// ---------- Небо ----------

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * vec4( cameraPosition + position, 1.0 );
  #ifdef USE_REVERSED_DEPTH_BUFFER
    gl_Position.z = 0.0;
  #else
    gl_Position.z = gl_Position.w;
  #endif
}`;
const SKY_FS = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uHalo;
uniform vec3 uHaloDir;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uTime;
uniform float uMarineSky;
varying vec3 vDir;
${CLEAR_SKY_GLSL}
float hash13( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 col = clearSkyRadiance(d,uTop,uHorizon,uHalo,uHaloDir,uMarineSky);
  if ( uNight > 0.5 ) {
    vec3 p = d * 120.0;
    vec3 c = floor( p );
    float r = hash13( c );
    vec3 o = vec3( hash13( c + 17.1 ), hash13( c + 3.7 ), hash13( c + 41.3 ) ) - 0.5;
    float s = smoothstep( 0.2, 0.02, length( fract( p ) - 0.5 - o * 0.5 ) ) * step( 0.94, r );
    float tw = 0.6 + 0.4 * sin( uTime * ( 1.3 + r * 2.7 ) + r * 61.0 );
    col += vec3( 0.85, 0.9, 1.0 ) * s * tw * ( 0.6 + ( r - 0.94 ) * 25.0 ) * smoothstep( 0.04, 0.3, h );
    float m = dot( d, uMoonDir );
    vec3 mt = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );
    vec3 mb = cross( mt, uMoonDir );
    vec2 q = vec2( dot( d, mt ), dot( d, mb ) ) / 0.032;
    float disc = ( 1.0 - smoothstep( 0.88, 1.05, length( q ) ) ) * step( 0.0, m );
    float crater = smoothstep( 0.28, 0.2, length( q - vec2( 0.32, 0.25 ) ) )
      + smoothstep( 0.2, 0.13, length( q - vec2( -0.35, -0.2 ) ) )
      + smoothstep( 0.14, 0.08, length( q - vec2( 0.05, -0.5 ) ) );
    vec3 moon = vec3( 1.0, 0.96, 0.86 ) * ( 1.12 - 0.2 * crater - 0.12 * dot( q, vec2( 0.6, -0.4 ) ) );
    col = mix( col, moon, disc );
    col += vec3( 0.45, 0.55, 1.0 ) * ( pow( max( m, 0.0 ), 900.0 ) * 0.35 + pow( max( m, 0.0 ), 60.0 ) * 0.08 ) * ( 1.0 - disc );
  }
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Грозовой вал окружает площадку на конечном расстоянии за зоной видимости деревьев.
// Поэтому при подъёме камера проходит вдоль его лицевой стороны, а вдали мгла закрывает холмы.
const STORM_RADIUS = 246;
const STORM_SKY_VS = `
varying vec3 vDir;
varying vec2 vCloudUv;
void main() {
  vDir = position;
  vCloudUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
}`;
const STORM_SKY_FS = `
uniform sampler2D uCloud;
uniform vec3 uTop, uHorizon, uRim;
uniform float uTime, uPulse, uCharge;
uniform vec3 uStormAt;
varying vec3 vDir;
varying vec2 vCloudUv;
${STORM_LIGHT_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y + min(cameraPosition.y / ${STORM_RADIUS.toFixed(1)}, 1.0);
  float u = vCloudUv.x + uTime * 0.00075;
  // Крупные валы идут вдоль горизонта; под ними провисают рваные клочья и полосы дождевой мглы.
  float swell = texture2D(uCloud, vec2(u * 2.0, 0.37 + h * 0.23)).r;
  vec2 p = vec2(u * 4.0, h * 1.45 + swell * 0.28);
  float bank = texture2D(uCloud, p).r;
  float curls = texture2D(uCloud, p * vec2(3.0, 2.7) + vec2(bank * 0.21, swell * 0.15)).r;
  float grain = texture2D(uCloud, p * vec2(9.0, 6.4) + curls * 0.17).r;
  float relief = bank * 0.50 + curls * 0.34 + grain * 0.16;
  float lip = h - 0.113 - 0.041 * d.x - (swell - 0.5) * 0.16 - (relief - 0.5) * 0.16;
  float wall = smoothstep(-0.021, 0.019, lip);
  float roll = smoothstep(-0.010, 0.031, lip) * (1.0 - smoothstep(0.037, 0.14, lip));
  float upperRoll = smoothstep(0.13, 0.20, lip) * (1.0 - smoothstep(0.21, 0.34, lip));
  float lit = smoothstep(0.25, 0.78, relief);
  vec3 deck = mix(uTop * 0.48, uRim, 0.10 + lit * (0.37 + 0.53 * roll + 0.20 * upperRoll));
  float rain = texture2D(uCloud, vec2(u * 9.0 + h * 0.82, 0.34 + h * 0.38)).r;
  float veil = smoothstep(-0.20, 0.016, lip) * (0.12 + smoothstep(0.20, 0.79, rain) * 0.73);
  vec3 dust = mix(uHorizon * vec3(1.09, 1.01, 0.92), uTop, veil);
  vec3 col = mix(dust, deck, wall);
  if (uCharge + uPulse > 0.0) {
    // Подсветка собирается в облаках за башней. При контакте свет рассеивается и по краям грозового вала.
    col += stormLight(d.xz,uStormAt.xz-cameraPosition.xz,swell,veil,lit,wall,uPulse,uCharge);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Three смешивает туман с материалами уже в выходном цветовом пространстве.
  gl_FragColor.rgb = mix(linearToOutputTexel(vec4(uHorizon, 1.0)).rgb, gl_FragColor.rgb, smoothstep(0.002, 0.136, h));
}`;

function stormSkyMaterial(cols) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(cols.top) }, uHorizon: { value: new THREE.Color(cols.horizon) },
      uRim: { value: new THREE.Color(cols.rim) }, uCloud: { value: getTexture('cloudNoise') },
      uTime: { value: 0 }, uPulse: { value: 0 }, uCharge: { value: 0 }, uStormAt: { value: new THREE.Vector3() },
    },
    vertexShader: STORM_SKY_VS, fragmentShader: STORM_SKY_FS,
    side: THREE.BackSide, fog: false, depthWrite: false,
  });
}

/** Купол идёт последним среди непрозрачных. Ясное небо лежит на дальней плоскости,
 * грозовой вал сохраняет собственную глубину. Вода, блики и частицы рисуются поверх. */
function buildSky(cols, night, storm, marine) {
  const material = storm ? stormSkyMaterial(cols) : new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(cols.top) },
      uHorizon: { value: new THREE.Color(cols.horizon) },
      uHalo: { value: new THREE.Color(cols.halo) },
      uHaloDir: { value: (night ? MOON_DIR : marine ? SUN_DIR : HALO_DIR).clone() },
      uMoonDir: { value: MOON_DIR.clone() },
      uNight: { value: night ? 1 : 0 },
      uMarineSky: { value: marine ? 1 : 0 },
      uTime: { value: 0 },
    },
    vertexShader: SKY_VS, fragmentShader: SKY_FS,
    side: THREE.BackSide, fog: false, depthWrite: false,
  });
  material.name = 'env:sky';
  const sky = new THREE.Mesh(new THREE.SphereGeometry(storm ? STORM_RADIUS : 250, 32, 16), material);
  sky.name = 'sky';
  sky.renderOrder = 2;
  sky.frustumCulled = false;
  return sky;
}

/**
 * Сцена для карты окружения (GameRenderer.applyEnv → PMREMGenerator.fromScene): тот же купол неба и диск земли
 * цвета отражённого света под горизонтом. Без диска низ карты был бы цвета горизонта (SKY_FS при h < 0).
 * В грозу у купола свой материал с нулевой вспышкой, чтобы не запекать её при смене качества.
 */
function buildCapture(sky, groundColor, material = sky.material) {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(sky.geometry, material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(CAPTURE_GROUND_R, 48),
    new THREE.MeshBasicMaterial({ color: groundColor, fog: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -CAPTURE_GROUND_DROP;
  scene.add(dome, disc);
  return {
    scene, near: 0.1, far: CAPTURE_GROUND_R * 2,
    dispose() {
      disc.geometry.dispose(); disc.material.dispose();
      if (material !== sky.material) material.dispose();
    },
  };
}

// Диффузный свет ясного купола для матовых ветвей. Интегрируем те же цвета,
// направление ореола и диск земли, что и в captureScene, один раз на палитру.
// Четыре косинусных интеграла дают верх, низ и две стороны от ореола.
const groveSkies = new Map();
function groveSky(key, sky, ground) {
  if (groveSkies.has(key)) return groveSkies.get(key);
  const u = sky.material.uniforms, halo = u.uHaloDir.value;
  const across = new THREE.Vector3(halo.x,0,halo.z).normalize();
  const axes = [new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),across,across.clone().negate()];
  const values = axes.map(() => new THREE.Vector3()), dir = new THREE.Vector3(), color = new THREE.Color();
  const samples = 256;
  for (let i=0; i<samples; i++) {
    const y = 1-2*(i+0.5)/samples, radius = Math.sqrt(1-y*y), angle = i*2.39996323;
    dir.set(radius*Math.cos(angle),y,radius*Math.sin(angle));
    if (y < -CAPTURE_GROUND_DROP/CAPTURE_GROUND_R) color.copy(ground);
    else {
      color.copy(u.uHorizon.value).lerp(u.uTop.value,Math.max(y,0)**0.55);
      const g = Math.max(0,dir.dot(halo)), glow = (0.3*g**6+0.35*g**40)*THREE.MathUtils.smoothstep(y,0,0.1);
      color.r += glow*u.uHalo.value.r; color.g += glow*u.uHalo.value.g; color.b += glow*u.uHalo.value.b;
    }
    for (let j=0; j<axes.length; j++) {
      const weight = 4*Math.PI/samples*Math.max(0,dir.dot(axes[j]));
      values[j].x += weight*color.r; values[j].y += weight*color.g; values[j].z += weight*color.b;
    }
  }
  const [top,bottom,front,back] = values, horizon = front.clone().lerp(back,0.5);
  const coeff = [horizon, top.clone().sub(bottom).multiplyScalar(.5),
    top.clone().lerp(bottom,.5).sub(horizon), front.clone().sub(back).multiplyScalar(.5)];
  const result = { key, coeff, across };
  groveSkies.set(key,result);
  return result;
}

// ---------- Свет ----------

function buildLights(cfg, extent) {
  const hemi = new THREE.HemisphereLight(cfg.hemi[0], cfg.hemi[1], cfg.hemi[2] * HEMI_KEEP);
  hemi.name = 'hemi';
  const sun = new THREE.DirectionalLight(cfg.sun[0], cfg.sun[1]);
  sun.name = 'sun';
  sun.target.name = 'sunTarget';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 110 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const fill = new THREE.DirectionalLight(cfg.fill[0], cfg.fill[1]);
  fill.name = 'fill';
  fill.position.set(-12, 8, -6);
  return { hemi, sun, fill };
}

// ---------- Земля, дороги, мощение ----------

function buildGround(T, L) {
  const g = L.island ? islandGroundGeometry(L.island, SHORE_R)
    : G.scaleUv(new THREE.CircleGeometry(GROUND_R,96).rotateX(-Math.PI/2), (2*GROUND_R)/6);
  const ground = mesh('ground', g, groundMaterial(T.ground));
  ground.renderOrder = 1; // Листва с alphaTest, здания и мощение уже закрывают свои пиксели.
  return ground;
}

function buildRoads(L) {
  const parts = [];
  const strip = (len, cx, cz, alongZ) => {
    const g = G.scaleUv(new THREE.PlaneGeometry(len, ROAD_HALF * 2).rotateX(-Math.PI / 2), len / 6, 0.5);
    parts.push(G.place(g, { x: cx, y: ROAD_Y, z: cz, ry: alongZ ? Math.PI / 2 : 0 }));
  };
  const R = L.reach;
  strip(2 * R, 0, ROAD_A_Z, false);
  const z0 = ROAD_A_Z - ROAD_HALF, z1 = ROAD_A_Z + ROAD_HALF;
  strip(z0 + R, ROAD_B_X, (z0 - R) / 2, true);
  strip(R - z1, ROAD_B_X, (z1 + R) / 2, true);
  return mesh('roads', G.mergeColored(parts), groundMaterial('asphalt'));
}

const WALK = '#e7dfd2', CURB = '#cdc3b4', MARK = '#f7f4ec', PLAZA = '#efe7da';

/** Тротуары, бордюры, разметка, площадь под башней и площадка крана — одним мешем. */
function buildPaving(L) {
  const p = [], R = L.reach;
  const push = (g, tiled = false) => p.push(G.tileMask(g, tiled));
  const slab = (x0, x1, z0, z1, top, color, tiled = false) => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    push(G.place(G.box(x1 - x0, top + 0.05, z1 - z0, color), { x: (x0 + x1) / 2, y: (top - 0.05) / 2, z: (z0 + z1) / 2 }), tiled);
  };
  const flat = (w, d, x, z, color, y = ROAD_Y + 0.012) => push(G.place(G.colored(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), color), { x, y, z }));
  // На обозримом участке — отдельные камни с 18-мм фаской, швами и тёмной постелью,
  // слитые с тем же тротуаром. За второй линией улицы отдельный стык уже меньше пикселя.
  const curb = (lo,hi,at,alongZ,outer) => {
    const nearLo=Math.max(lo,-32), nearHi=Math.min(hi,32);
    const backing = (a,b,height,color) => alongZ ?
      slab(at-CURB_W/2,at+CURB_W/2,a,b,height,color) : slab(a,b,at-CURB_W/2,at+CURB_W/2,height,color);
    if (lo<nearLo) backing(lo,nearLo,WALK_TOP+0.012,CURB);
    if (nearHi<hi) backing(nearHi,hi,WALK_TOP+0.012,CURB);
    if (nearHi<=nearLo) return;
    backing(nearLo,nearHi,WALK_TOP-0.018,'#958b7c');
    const mid=(nearLo+nearHi)/2;
    push(curbRun(alongZ?at:mid,alongZ?mid:at,nearHi-nearLo,WALK_TOP+0.009,CURB_W,outer,alongZ,'street'));
  };
  const aIn = ROAD_A_Z - ROAD_HALF, aOut = ROAD_A_Z + ROAD_HALF; // края дороги A по z
  const bL = ROAD_B_X - ROAD_HALF, bR = ROAD_B_X + ROAD_HALF; // края дороги B по x
  // тротуары и бордюры вдоль дороги A, разрезанные дорогой B
  for (const [x0, x1] of [[-R, bL], [bR, R]]) {
    slab(x0, x1, aIn - WALK_W, aIn - CURB_W, WALK_TOP, WALK, true);
    curb(x0,x1,aIn-CURB_W/2,false,1);
    slab(x0, x1, aOut + CURB_W, aOut + WALK_W, WALK_TOP, WALK, true);
    curb(x0,x1,aOut+CURB_W/2,false,-1);
  }
  // вдоль дороги B, разрезанные тротуарами дороги A
  for (const [z0, z1] of [[-R, aIn - WALK_W], [aOut + WALK_W, R]]) {
    slab(bL - WALK_W, bL - CURB_W, z0, z1, WALK_TOP, WALK, true);
    curb(z0,z1,bL-CURB_W/2,true,-1);
    slab(bR + CURB_W, bR + WALK_W, z0, z1, WALK_TOP, WALK, true);
    curb(z0,z1,bR+CURB_W/2,true,1);
  }
  // осевая разметка
  const reachMarks = Math.min(R, 90);
  for (let x = -reachMarks + 1; x < reachMarks - 1; x += 3.6) {
    if (Math.abs(x - ROAD_B_X) < 3.4 || Math.abs(x - 6) < 1.6 || Math.abs(x + 8.2) < 1.6) continue;
    flat(1.8, 0.14, x, ROAD_A_Z, MARK);
  }
  for (let z = -reachMarks + 1; z < reachMarks - 1; z += 3.6) {
    if (Math.abs(z - ROAD_A_Z) < 4.6) continue;
    flat(0.14, 1.8, ROAD_B_X, z, MARK);
  }
  // переходы: через дорогу A и через дорогу B по линиям тротуаров A
  for (const cx of [-8.2, 6]) for (let z = aIn + 0.35; z < aOut - 0.2; z += 0.7) flat(1.6, 0.36, cx, z, MARK);
  for (const cz of [aIn - WALK_W / 2, aOut + WALK_W / 2]) for (let x = bL + 0.35; x < bR - 0.2; x += 0.7) flat(0.36, 1.4, x, cz, MARK);
  // площадь: плита, кайма, кольцо узора и лучи
  push(G.cylinder(PLAZA_R, PLAZA_R + 0.04, PLAZA_TOP * 2, 72, PLAZA), true);
  const ring = (r0, r1, color) => push(G.place(G.colored(new THREE.RingGeometry(r0, r1, 72).rotateX(-Math.PI / 2), color), { y: PLAZA_TOP + 0.01 }));
  ring(PLAZA_R - 0.32, PLAZA_R - 0.06, '#d6cab8');
  ring(4.3, 4.56, '#dccdb6');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = (4.56 + PLAZA_R - 0.32) / 2;
    push(G.place(G.colored(new THREE.PlaneGeometry(0.1, PLAZA_R - 0.32 - 4.56).rotateX(-Math.PI / 2), '#e0d4c2'),
      { x: Math.sin(a) * r, y: PLAZA_TOP + 0.01, z: Math.cos(a) * r, ry: a }));
  }
  // площадка крана
  push(G.place(G.roundedBox(2.4, 0.24, 2.4, 0.06, 1, '#c8c1b5'), { x: CRANE_X, z: CRANE_Z }));
  return mesh('paving', G.mergeColored(p), pavingMaterial());
}

/** Пути для гуляющих жителей вдоль тротуаров (точки {x,y,z}). */
function walkways(L) {
  const R = Math.min(L.reach - 1, 30), y = WALK_TOP;
  const zi = ROAD_A_Z - ROAD_HALF - WALK_W / 2, zo = ROAD_A_Z + ROAD_HALF + WALK_W / 2, xb = ROAD_B_X + ROAD_HALF + WALK_W / 2;
  return [
    [{ x: -R, y, z: zi }, { x: R, y, z: zi }],
    [{ x: R, y, z: zo }, { x: -R, y, z: zo }],
    [{ x: xb, y, z: -R }, { x: xb, y, z: zi }],
  ];
}

// ---------- Облака и дальний план ----------

function buildClouds(rng, count, cols, night) {
  const p = [];
  for (let i = 0; i < count; i++) {
    const a = rng.uniform(0, Math.PI * 2), r = rng.uniform(70, 170), y = rng.uniform(28, 60);
    const cx = Math.sin(a) * r, cz = Math.cos(a) * r, yaw = rng.uniform(0, Math.PI), size = rng.uniform(0.8, 1.5);
    const puffs = rng.int(5, 8), parts = [];
    for (let k = 0; k < puffs; k++) {
      const t = puffs > 1 ? k / (puffs - 1) - 0.5 : 0;
      const pr = (3.2 - Math.abs(t) * 2.6 + rng.uniform(-0.4, 0.6)) * size;
      parts.push(G.place(G.sphere(pr, 12, 8), { x: t * 9 * size, y: pr * 0.25 + rng.uniform(0, 0.8), z: rng.uniform(-1.2, 1.2) * size, sy: 0.72 }));
    }
    const cl = G.mergeColored(parts);
    cl.computeBoundingBox();
    gradientY(cl, cols[0], cols[1], cl.boundingBox.min.y, cl.boundingBox.max.y, 0.7);
    p.push(G.place(cl, { x: cx, y, z: cz, ry: yaw }));
  }
  const material = night
    ? customMat('env:clouds:night', () => standard({ color: '#ffffff', vertexColors: true, roughness: 1, emissive: '#1a2444', emissiveIntensity: 1, fog: false }))
    : customMat('env:clouds', () => standard({ color: '#ffffff', vertexColors: true, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.16, fog: false }));
  const m = mesh('clouds', G.mergeColored(p), material, { receive: false });
  m.frustumCulled = false;
  return m;
}

/** Ложе дальней дороги и плавный выход обочины на склон. По высотам выемки затем сажаются и рощи. */
function roadPass(hill, reach) {
  const { x, z, sx, sz, ca, sa, nx, nz, table } = hill;
  const band = ROAD_HALF + WALK_W + Math.hypot(sx / nx, sz / nz)*1.4;
  const reachOfSlope = Math.max(sx,sz) + band + 19;
  if (Math.abs(x-ROAD_B_X) > reachOfSlope && Math.abs(z-ROAD_A_Z) > reachOfSlope) return;
  for (let j=0; j<=nz; j++) for (let i=0; i<=nx; i++) {
    const k=j*(nx+1)+i;
    if (table[k]<=0) continue;
    const u=(2*i/nx-1)*sx, v=(2*j/nz-1)*sz;
    const px=x+u*ca+v*sa, pz=z-u*sa+v*ca;
    const toA=Math.hypot(pz-ROAD_A_Z,Math.max(0,Math.abs(px)-reach));
    const toB=Math.hypot(px-ROAD_B_X,Math.max(0,Math.abs(pz)-reach));
    const edge = Math.min(toA,toB)-band;
    const blend = THREE.MathUtils.smoothstep(edge,0,14+3*Math.sin(0.11*(px+pz)+hill.phase));
    table[k] *= blend;
    if (hill.exposures) hill.exposures[k] *= blend;
  }
}

/** Седловины, каменные отроги и прибрежные низины; у растительности та же сетка высот, что у меша. */
function buildHills(rng, theme, T, L) {
  const pieces = [], hills = [], sea = theme === 'harbor', snow = theme === 'snow';
  let vertexStart = 0;
  const horizon = new THREE.Color(T.sky.horizon);
  const rings = sea ? [[115, 7, 0.05], [161, 11, 0.24]]
    : theme === 'night' ? [[150, 26, 0.2], [185, 30, 0.35]] : [[110, 22, 0], [145, 26, 0.18], [180, 30, 0.36]];
  rings.forEach(([radius, count, haze], ring) => {
    const [lo, hi] = T.hills[Math.min(ring, 2)];
    const ground = new THREE.Color(sea ? '#557453' : lo).lerp(horizon, haze);
    const crest = new THREE.Color(sea ? '#86a46f' : hi).lerp(horizon, haze);
    const crag = new THREE.Color(sea ? '#878175' : snow ? '#758294' : theme === 'sweet' ? '#bd919a' :
      theme === 'autumn' ? '#a28c70' : theme === 'night' ? '#5b6b73' : '#9b998b').lerp(horizon, haze);
    for (let i = 0; i < count; i++) {
      const angle = (i + rng.uniform(-0.29, 0.29)) / count * Math.PI * 2, radiusHere = radius + rng.uniform(-8, 8);
      const alpine = snow && ring > 0;
      const width = rng.uniform(sea ? 21 : 18, sea ? 41 : 31) * (1 + ring * 0.13);
      const height = rng.uniform(alpine ? 15 : sea ? 6 : 7, alpine ? 31 : sea ? 17 : 13) * (1 + ring * 0.12);
      const hill = createLandform({
        x: Math.sin(angle) * radiusHere, z: Math.cos(angle) * radiusHere,
        y: sea ? -1.6 : -1.45, h: height, sx: width * (sea ? 1 : 1.23), sz: width * rng.uniform(sea ? 0.42 : 0.61, 0.93),
        a: angle + rng.uniform(-0.85, 0.85), seed: rng.int(1, 0x7fffffff),
        kind: sea ? 'island' : alpine ? 'alpine' : theme === 'sweet' ? 'cream' : 'upland',
        nx: sea && !ring ? 49 : ring === 0 ? 39 : ring === 1 ? 26 : 20,
        nz: sea && !ring ? 29 : ring === 0 ? 26 : ring === 1 ? 17 : 13,
      });
      if (!L.city && !sea) roadPass(hill,L.reach);
      hill.ring = ring;
      hill.vertexStart = vertexStart;
      vertexStart += hill.table.length;
      pieces.push(landformGeometry(hill, ground, crest, crag, snow));
      // У островов нет рощ; альпийские вершины всё равно участвуют в проверке перекрытия ближних холмов.
      if (!sea) hills.push(hill);
    }
  });
  const terrain = mesh('hills', G.mergeColored(pieces), landformMaterial(theme), { receive: false });
  terrain.renderOrder = 0.5; // склоны за городом проверяют глубину после зданий и растительности, перед дальней землёй
  return { mesh: terrain, hills, update: horizonCulling(terrain, pieces, theme) };
}

// ---------- Пятна-тени декора ----------

// Декор не отбрасывает настоящих теней: карта теней покрывает лишь ±SHADOW_HALF у башни и резала бы их
// прямой границей. Вместо этого — мягкие пятна, вытянутые от солнца (одним InstancedMesh).
const SHADOW_FLAT = new THREE.Vector2(-SUN_DIR.x, -SUN_DIR.z).normalize();
const SHADOW_YAW = Math.atan2(SHADOW_FLAT.x, SHADOW_FLAT.y);
/** Пятно под объектом: size — поперёк, длиннее вдоль тени; offset — сдвиг от солнца. */
function blob(x, z, size, offset = size * 0.3) {
  return { x: x + SHADOW_FLAT.x * offset, y: 0.015, z: z + SHADOW_FLAT.y * offset, ry: SHADOW_YAW, sx: size, sy: 1, sz: size * 1.35 };
}
function buildBlobs(items) {
  const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const m = instanced('blobs', g, mat('shadowBlob'), items, { cast: false, receive: false });
  m.renderOrder = 1;
  return m;
}

// ---------- Фонари ----------

export function addLampCollider(ground, x, y, z, yaw) {
  const dx = Math.cos(yaw), dz = -Math.sin(yaw);
  ground.disc(x, z, 0.17, y, y + 3.24);
  ground.box(x + 0.33 * dx, z + 0.33 * dz, 0.36, 0.06, yaw, y + 2.6, y + 3.2);
  ground.disc(x + 0.66 * dx, z + 0.66 * dz, 0.2, y + 2.7, y + 3.2);
}

/** Места фонарей у бордюров; плафон смотрит на проезжую часть. Перед камерой — не ставим. */
function lampSpots(L) {
  const out = [], R = Math.min(L.reach - 2, 66);
  const blocked = (x, z) => {
    let d = Math.atan2(x, z) - CAMERA_YAW;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.hypot(x, z) < 25 && Math.abs(d) < 0.4;
  };
  const push = (x, z, ry) => { if (!blocked(x, z)) out.push({ x, y: WALK_TOP, z, ry }); };
  const aIn = ROAD_A_Z - ROAD_HALF - 0.4, aOut = ROAD_A_Z + ROAD_HALF + 0.4;
  for (let x = -R + 6.5; x <= R; x += 13) {
    if (Math.abs(x - ROAD_B_X) > 4) push(x, aIn, -Math.PI / 2);
    if (x + 6.5 <= R && Math.abs(x + 6.5 - ROAD_B_X) > 4) push(x + 6.5, aOut, Math.PI / 2);
  }
  const bL = ROAD_B_X - ROAD_HALF - 0.4, bR = ROAD_B_X + ROAD_HALF + 0.4;
  for (let z = -R; z <= R; z += 13) {
    if (Math.abs(z - ROAD_A_Z) > 4.5) push(bR, z, Math.PI);
    if (z + 6.5 <= R && Math.abs(z + 6.5 - ROAD_A_Z) > 4.5) push(bL, z + 6.5, 0);
  }
  return out;
}

function buildLamps(spots, night) {
  const lamps = streetLampBatches('lamps', 'lampHeads', mat('toy'), mat('lamp'), spots, false);
  if (night) {
    const p = spots.map((s) => G.place(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2),
      { x: s.x + Math.cos(s.ry) * 0.66, y: WALK_TOP + 0.03, z: s.z - Math.sin(s.ry) * 0.66 }));
    const material = customMat('env:lampPool', () => new THREE.MeshBasicMaterial({
      color: '#ffc46b', alphaMap: getTexture('softShadow'), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const pools = mesh('lampPools', G.mergeColored(p), material, { receive: false });
    pools.renderOrder = 1;
    lamps.meshes.push(pools);
  }
  return lamps;
}

// ---------- Осень, зима ----------

function buildPumpkins(rng, L, blobs, ground) {
  const r0 = L.city ? L.city.half : PLAZA_R + 0.7;
  const pts = scatter(rng, 18, r0, L.city ? r0 + 11 : 22, 1.1, (x, z) => clearOf(L, x, z, 0.5));
  const items = pts.map(({ x, z }) => ({ x, z, ry: rng.uniform(0, Math.PI * 2), s: rng.uniform(0.8, 1.45) }));
  for (const it of items) {
    blobs.push(blob(it.x, it.z, 1.2 * it.s, 0.08 * it.s));
    ground?.disc(it.x, it.z, 0.4 * it.s, 0, 0.6 * it.s);
  }
  return seasonalLod(instanced('pumpkins', pumpkinGeometry(false), mat('toy'), items, { cast: false }), pumpkinGeometry, 0.47, 0.28);
}

function buildSnowmen(L, blobs, ground) {
  const cam = L.city ? [Math.sin(CAMERA_YAW) * 120, Math.cos(CAMERA_YAW) * 120] : [8.7, 15];
  const r = L.city ? L.city.half + 3.2 : 0;
  const spots = L.city ? [[r, r * 0.35], [-r * 0.3, r], [-r, -r * 0.4], [r * 0.5, -r]] : [[9.6, 3.4], [-8.6, 2.2], [12.5, -6], [-2.6, -11.5]];
  const items = spots.map(([x, z]) => ({ x, z, ry: Math.atan2(cam[0] - x, cam[1] - z), s: 0.95 }));
  for (const it of items) {
    blobs.push(blob(it.x, it.z, 2.1, 0.2));
    ground?.disc(it.x, it.z, 0.55 * it.s, 0, 2.25 * it.s);
  }
  return seasonalLod(instanced('snowmen', snowmanGeometry(false), mat('toy'), items, { cast: false }), snowmanGeometry, 1.34, 1.10);
}

// ---------- Гавань ----------

const WATER_TIME = OCEAN_TIME;

/**
 * Множитель цвета лёгкой воды (medium, low), как LITE_GAIN у земли: средний цвет воды на снимке medium как у high в пределах 3 %
 * (спецификация «Растительность» §9; подбор — план, Task 3).
 */
export const WATER_LITE_GAIN = 1.286;
/** Цвет воды по умолчанию; у тем карты города (cityMap.js, поле water) свой. */
export const WATER_COLOR = '#3fb0e6';

/** Вид воды поверх шейдера Standard и Lambert: пена у берега, рябь нормали, блики. Время ведёт env.update. */
function waterPatch(shader, lite, sand, jam) {
  patchWater(shader, { time: WATER_TIME, shore: SHORE_R, night: NIGHT_UNIFORM, gain: lite ? WATER_LITE_GAIN : 1, sand, jam });
}

/**
 * Анимированная вода (рябь, блики, пена у берега острова); время ведёт env.update. Общая с картой города.
 * lite — вода для medium и low: Lambert с тем же видом (waterPatch) и множителем WATER_LITE_GAIN; PBR-вода с roughness 0.2
 * не укладывала кадр гавани в бюджет (спецификация «Растительность» §9, отличие 19 плана).
 */
export function waterMaterial({ lite = false, color = WATER_COLOR } = {}) {
  const sand = color === WATER_COLOR ? assets.tryGet('terrain.sand')?.albedo : null;
  const tag = (color === WATER_COLOR ? '' : ':' + color) + (sand ? ':' + sand.uuid : '');
  if (lite) {
    return customMat('env:water:lite' + tag, () => {
      const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(WATER_LITE_GAIN), transparent: true });
      m.defines = color === WATER_COLOR ? { WATER_LITE: '' } : { WATER_LITE: '', WATER_JAM: '' };
      if (sand) m.defines.WATER_SAND = 1;
      m.onBeforeCompile = (shader) => waterPatch(shader, true, sand, color !== WATER_COLOR);
      m.customProgramCacheKey = () => 'env-water-lite';
      return m;
    });
  }
  return customMat('env:water' + tag, () => {
    const m = standard({ color, roughness: 0.2, metalness: 0, rim: false });
    m.transparent = true; // струи фонтана просвечивают, поверхность водоёма пишет глубину и полную альфу
    if (color !== WATER_COLOR) m.defines = { ...m.defines, WATER_JAM: '' };
    if (sand) m.defines = { ...m.defines, WATER_SAND: 1 };
    m.onBeforeCompile = (shader) => waterPatch(shader, false, sand, color !== WATER_COLOR);
    m.customProgramCacheKey = () => 'env-water';
    return m;
  });
}

function buildHarbor(L, sky, sun, night, storm, islands) {
  const moonMask=night && !storm ? moonVisibility(islands,MOON_DIR) : null;
  const beach = mesh('beach', beachGeometry(ISLAND_R, BEACH_W, BEACH_DROP, WATER_Y), beachMaterial());
  const high = oceanGeometry(SHORE_R,WATER_Y), lite = oceanGeometry(SHORE_R,WATER_Y,true);
  const highFar = oceanGeometry(SHORE_R,WATER_Y,false,true), liteFar = oceanGeometry(SHORE_R,WATER_Y,true,true);
  const coastNear = beach.geometry, coastFar = beachGeometry(ISLAND_R,BEACH_W,BEACH_DROP,WATER_Y,true);
  const materials = new Map(), contacts = createWaterContacts();
  const sand = assets.tryGet('terrain.sand')?.albedo;
  const seaMaterial = (level, overview) => {
    const key = COAST_QUALITY[level]+(overview ? 4 : 0);
    if (!materials.has(key)) materials.set(key,coastSeaMaterial({ level, overview, sand, sky,
      sunDirection:SUN_DIR, sunColor:sun.color, sunlight:night||storm ? 0 : Math.min(1,sun.intensity/2.5), contacts, moonMask }));
    return materials.get(key);
  };
  const water = mesh('water', high, seaMaterial('high',false), { receive:false });
  water.renderOrder = 1;
  let nearShore = true, lowCost = false, birdseye = false, level = 'high', explicitQuality = false;
  function setSeaGeometry() {
    const liteSea = COAST_QUALITY[level]<COAST_QUALITY.high;
    water.geometry = nearShore ? (liteSea ? lite : high) : (liteSea ? liteFar : highFar);
    water.material = seaMaterial(level,birdseye);
    beach.material = beachMaterial(assets,!birdseye && !liteSea);
  }
  const cull = oceanCulling(SHORE_R, WATER_Y);

  // причал продолжает дорогу B в сторону моря
  const x = ROAD_B_X, z0 = -L.reach + 0.5, z1 = -58;
  water.onBeforeRender = () => OCEAN_PIER.value.set(x, z0, z1, 0.28 - WATER_Y);
  const deckNear = offshorePierGeometry(x,z0,z1,WATER_Y,true), deckFar = offshorePierGeometry(x,z0,z1,WATER_Y,false);
  const pier = mesh('pier', deckFar, harborMaterial());

  const hulls = [harborBoatGeometry(0), harborBoatGeometry(1)];
  const boats = instanced('boats', hulls[1], harborMaterial(), BOAT_SPOTS.map(([bx, bz, ry]) => ({ x: bx, y: WATER_Y, z: bz, ry })), { cast: false });
  boats.userData.hulls = hulls;
  boats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return {
    meshes: [beach, water, pier, boats], boats, contacts,
    setQuality(quality) {
      if (!Object.hasOwn(COAST_QUALITY,quality)) return;
      explicitQuality = true;
      if (quality !== level) { level = quality; setSeaGeometry(); }
    },
    setLite(on) {
      lowCost = on;
      if (!explicitQuality) { level = on ? 'low' : 'high'; setSeaGeometry(); }
      pier.material = harborMaterial(on && pier.geometry===deckFar);
      boats.userData.lowCost = on;
      boats.material = harborMaterial(on && boats.geometry===hulls[1]);
    },
    update(camera) {
      if (!camera?.position) return;
      const p = camera.position;
      const coastD2 = coastDistance(SHORE_R,p.x,p.z)**2 + (p.y-WATER_Y)**2;
      const next = coastD2 < (nearShore ? 31*31 : 26*26);
      const above = p.y-WATER_Y > (birdseye ? 29 : 35);
      if (next !== nearShore || above !== birdseye) {
        nearShore = next; birdseye = above; setSeaGeometry(); beach.geometry = nearShore ? coastNear : coastFar;
      }
      cull(water, camera);
      const eye=camera.position, pz=THREE.MathUtils.clamp(eye.z,z1,z0), distance=pier.geometry===deckNear ? 28 : 24;
      const nextDeck=(eye.x-x)**2+(eye.z-pz)**2+(eye.y-0.4)**2 < distance*distance ? deckNear : deckFar;
      if(pier.geometry!==nextDeck) { pier.geometry=nextDeck; pier.material=harborMaterial(lowCost && nextDeck===deckFar); }
    },
    dispose() {
      for (const material of materials.values()) material.dispose();
      moonMask?.dispose();
      for (const g of [high,lite,highFar,liteFar]) if (g!==water.geometry) g.dispose();
      (beach.geometry === coastNear ? coastFar : coastNear).dispose();
      (pier.geometry === deckNear ? deckFar : deckNear).dispose();
    },
  };
}

const boatWave = new THREE.Vector4();
const boatFrustum = new THREE.Frustum(), boatCameraMatrix = new THREE.Matrix4();
const boatBounds = new THREE.Sphere(new THREE.Vector3(),1.78);

function updateBoats(boats, t, camera) {
  const near = boats.geometry === boats.userData.hulls[0], threshold = near ? 24 * 24 : 20 * 20;
  let close = false, visible = 0;
  if (camera?.isCamera) {
    boatCameraMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    boatFrustum.setFromProjectionMatrix(boatCameraMatrix,camera.coordinateSystem,camera.reversedDepth);
  }
  for (let i = 0; i < BOAT_SPOTS.length; i++) {
    const b = BOAT_SPOTS[i], x = b[0], z = b[1], ry = b[2], c = Math.cos(ry), s = Math.sin(ry);
    boatBounds.center.set(x,WATER_Y+0.45,z);
    if (camera?.isCamera && !boatFrustum.intersectsSphere(boatBounds)) continue;
    sampleOcean(x, z, t, SHORE_R, OCEAN_WIND.value.x, OCEAN_WIND.value.y, boatWave);
    // Нос смотрит вдоль локального +X; дифферент и крен следуют наклону воды в осях корпуса.
    const pitch = Math.atan(boatWave.y*c - boatWave.z*s);
    const roll = -Math.atan(boatWave.y*s + boatWave.z*c);
    _q.setFromEuler(_e.set(roll, ry, pitch, 'YXZ'));
    boats.setMatrixAt(visible++, _m.compose(_p.set(x, WATER_Y + boatWave.x, z), _q, _s.set(1, 1, 1)));
    if (camera && (camera.position.x - x) ** 2 + (camera.position.z - z) ** 2 + (camera.position.y - WATER_Y) ** 2 < threshold) close = true;
  }
  boats.count = visible;
  boats.visible = visible > 0;
  if (visible) boats.instanceMatrix.needsUpdate = true;
  const hull = boats.userData.hulls[close ? 0 : 1];
  if (boats.geometry !== hull) { boats.geometry = hull; boats.material = harborMaterial(!!boats.userData.lowCost && !close); }
}

// ---------- Сборка ----------

/** Полуразмер рамки теней, вмещающей коробку города (центр — середина по высоте) с запасом в метр. */
function cityShadowExtent(city) {
  const { right, up } = shadowBasis(SUN_DIR);
  let e = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [-1, 1]) {
    _p.set(sx * city.half, sy * city.height / 2, sz * city.half);
    e = Math.max(e, Math.abs(_p.dot(right)), Math.abs(_p.dot(up)));
  }
  return Math.ceil(e + 1);
}

/**
 * createEnvironment(theme, {night, storm, floraAtlas, cityPlants, shadowExtent, seed, cityHalf, cityHeight}) →
 * { group, fog, fogNear, fogFar, sun, lights, blobs, vegetation, night, theme, walkways, envKey, envIntensity, exposure, grade, captureScene(), update(dt, time, camera?), setFocus(y, x?, z?), setShadowExtent(half), setGroundLite(on), setStormPulse(intensity), dispose() }.
 * vegetation — поле растений (vegetation/field.js); update с камерой пересчитывает его отсечение и LOD.
 * Неизвестная тема — 'valley'; тема 'night' всегда ночная. group содержит и свет (с целью солнца).
 * envKey и captureScene — для карты окружения (GameRenderer.applyEnv); envIntensity — её сила в scene.environmentIntensity.
 * exposure и grade — вид темы (GameRenderer.applyEnv): экспозиция на любом пресете, окраска на high.
 * cityHalf > 0 — раскладка вида города: без площади, дорог, фонарей и крана, декор вне квадрата ±cityHalf,
 * тень покрывает весь город до высоты cityHeight (фокус — середина по высоте). Туман настраивает сцена.
 */
export function createEnvironment(theme = 'valley', { night = false, storm = false, floraAtlas = null, cityPlants = null,
  shadowExtent = SHADOW_HALF, seed, cityHalf = 0, cityHeight = 36, buildActivities = false } = {}) {
  if (!ENV_THEMES.includes(theme)) theme = 'valley';
  const T = THEMES[theme], isNight = !!night || theme === 'night';
  const C = storm ? { ...T, ...(isNight ? OVERCAST_NIGHT : OVERCAST) } : isNight ? { ...T, ...NIGHT } : T;
  const city = cityLayout(cityHalf, cityHeight);
  const L = layout(theme, city);
  const rng = createRng(Number.isFinite(seed) ? seed : hashSeed('env', theme));
  const group = new THREE.Group();
  group.name = 'environment';
  const add = (...objs) => { for (const o of objs) group.add(o); };

  const sky = buildSky(C.sky, isNight, storm, theme === 'harbor');
  add(sky);
  const [fogNear, fogFar] = C.fog ?? [FOG_NEAR, FOG_FAR];
  const fog = new THREE.Fog(new THREE.Color(C.sky.horizon), fogNear, fogFar);
  const defaultExtent = city ? cityShadowExtent(city) : SHADOW_HALF;
  const extent = !city && Number.isFinite(shadowExtent) && shadowExtent > 0 ? shadowExtent : defaultExtent;
  const { hemi, sun, fill } = buildLights(C, extent);
  if (storm) sun.castShadow = false;
  add(hemi, sun, sun.target, fill);

  const cloudRng = rng.fork(1); // одинаковая раскладка холмов и деревьев в обеих погодах
  const clouds = storm ? null : buildClouds(cloudRng, T.cloudCount, C.clouds, isNight);
  if (clouds) add(clouds);
  const hills = buildHills(rng.fork(2), theme, storm ? C : T, L);
  add(hills.mesh);
  const ground = buildGround(T, L), roads = city ? null : buildRoads(L);
  add(ground);
  const paving = roads ? buildPaving(L) : null;
  if (roads) add(roads, paving);
  const supportAt = roads ? walkSurface([roads.geometry, paving.geometry]) : null;
  const blobs = [];
  const site = siteOf(theme, L, hills.hills), plants = placeEnvironment(site, rng.fork(3)); // fork(3), как у прежнего buildTrees
  const climbingTree = buildActivities && !city ? activityTree(plants, theme) : null;
  shadeGroveFloor(hills.mesh.geometry, hills.hills, plants);
  if (L.island) addDunePlants(plants, L.island, SHORE_R);
  const beds = plants.filter((p) => p.kind === 'bed');
  // трава high: маска газонов по участку и клумбам; строится лениво, при первом configure с grass
  const vegetation = createVegetationField({ theme, floraAtlas, night: isNight || storm, sunDir: SUN_DIR,
    groveProbe: storm || !floraAtlas ? null : groveSky(theme+(isNight ? ':night' : ':day'),sky,hemi.groundColor),
    grassMask: (x, z) => grassMask(site, beds, x, z) });
  if (cityPlants) plants.push(...cityPlants); // один комплект буферов для парков и окружающих рощ
  const litter = theme === 'autumn' ? createLeafLitter(plants, site, supportAt ?? litterGroundHeight, ROAD_HALF) : null;
  if (litter) add(litter.mesh);
  vegetation.add(plants);
  add(vegetation.group);
  const falling = theme === 'autumn' ? createFallingLeaves(plants, site, vegetation.geometryAt, seed) : null;
  if (falling) add(falling.mesh);
  const lamps = city ? [] : lampSpots(L);
  const residentGround = city ? null : streetGround(lamps, L.reach, L.island);
  if (residentGround) residentGround.supportAt = supportAt;
  let climbCollider = null;
  if (residentGround) for (const p of plants) {
    if (p.kind === 'hedge') residentGround.box(p.x, p.z, HEDGE.len * p.s / 2, FOOT.hedge * p.s, p.ry);
    else if (p.kind !== 'flowers') {
      const shape = residentGround.disc(p.x, p.z, FOOT[p.kind] * p.s);
      if (p === climbingTree) climbCollider = shape;
    }
  }
  const streetLamps = city ? null : buildLamps(lamps, isNight);
  if (streetLamps) add(...streetLamps.meshes);
  const seasonal = theme === 'autumn' ? buildPumpkins(rng.fork(5), L, blobs, residentGround)
    : theme === 'snow' ? buildSnowmen(L, blobs, residentGround) : null;
  if (seasonal) add(seasonal.mesh);
  const blobMesh = buildBlobs(blobs);
  add(blobMesh);
  const harbor = theme === 'harbor' ? buildHarbor(L, sky, sun, isNight, storm, hills.mesh.geometry) : null, boats = harbor?.boats;
  if (harbor) add(...harbor.meshes);
  const natureSites = [];
  if (climbingTree) {
    const clear = (ax, az, bx, bz, r, low, high) => residentGround.clearStep(ax, az, bx, bz, r, r, low, high, false, climbCollider);
    const tree = treeNatureSite(theme, climbingTree, 1, supportAt, clear, floraAtlas);
    if (tree) natureSites.push(tree);
  }
  if (buildActivities && !city && harbor) {
    // Этот песчаный берег виден между пальмами справа от башни, вдали от каменных мысов.
    const bank = beachBank(SHORE_R, -112.5 * Math.PI / 180);
    const solid = new ResidentGround(), z0 = -L.reach + .5, z1 = -58;
    solid.box(ROAD_B_X, (z0 + z1) / 2, 1.35, (z0 - z1) / 2);
    for (const [x, z, yaw] of BOAT_SPOTS) solid.box(x, z, 1.61, .57, yaw);
    const wave = new THREE.Vector4();
    const sand = (x, z) => beachFloor(ISLAND_R, SHORE_R, BEACH_DROP, WATER_Y, x, z);
    natureSites.push({ kind: 'swim', ...bank, y: WATER_Y, width: 1.8, depth: 6.4, floor: sand, bed: sand,
      waterY: (x, z) => WATER_Y + sampleOcean(x, z, WATER_TIME.value, SHORE_R, OCEAN_WIND.value.x, OCEAN_WIND.value.y, wave).x,
      clear: (ax, az, bx, bz, r, low, high) => residentGround.clearStep(ax, az, bx, bz, r, r, low, high, false) &&
        solid.clearStep(ax, az, bx, bz, r, r, low, high),
    });
  }
  const skyline = theme === 'night' ? buildSkyline(rng.fork(6)) : null;
  if (skyline) add(...skyline.meshes);

  const right = new THREE.Vector3(), up = new THREE.Vector3(), base = new THREE.Vector3();
  let time = 0;

  /** Цель солнца — у фокуса по высоте; проекции на оси карты теней кратны текселю (тень не «ползёт»). */
  function setFocus(y, x = 0, z = 0) {
    const qz = (v) => Math.round(finite(v) / FOCUS_STEP) * FOCUS_STEP;
    const cam = sun.shadow.camera;
    const texel = (cam.right - cam.left) / Math.max(1, sun.shadow.mapSize.x);
    shadowBasis(SUN_DIR, right, up);
    base.set(qz(x), qz(y), qz(z));
    const a = Math.round(base.dot(right) / texel) * texel, b = Math.round(base.dot(up) / texel) * texel;
    sun.target.position.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(SUN_DIR, base.dot(SUN_DIR));
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, SUN_DIST);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  setFocus(city ? city.height / 2 : 0);

  /** Полуразмер рамки теней (финиш: всё здание и его тень на земле); некорректное — по умолчанию. */
  function setShadowExtent(half) {
    const e = Number.isFinite(half) && half > 0 ? half : defaultExtent;
    const cam = sun.shadow.camera;
    if (cam.right === e) return;
    Object.assign(cam, { left: -e, right: e, top: e, bottom: -e });
    cam.updateProjectionMatrix();
  }

  let groundLite = false;
  /** Лёгкая земля (medium, low): Lambert у земли и асфальта, упрощённые причал и катера. */
  function setGroundLite(on) {
    on = !!on;
    if (on === groundLite) return;
    groundLite = on;
    ground.material = groundMaterial(T.ground, undefined, { lite: on });
    if (roads) roads.material = groundMaterial('asphalt', undefined, { lite: on });
    harbor?.setLite(on);
  }

  function setStormPulse(intensity, charge = 0, at = null) {
    if (!storm) return;
    const pulse = THREE.MathUtils.clamp(finite(intensity), 0, 1);
    const skyLight = sky.material.uniforms;
    skyLight.uPulse.value = pulse;
    skyLight.uCharge.value = THREE.MathUtils.clamp(finite(charge), 0, 1);
    if (at && (pulse > 0 || skyLight.uCharge.value > 0)) skyLight.uStormAt.value.copy(at);
    hemi.intensity = C.hemi[2] * HEMI_KEEP + pulse * 0.82;
    fill.intensity = C.fill[1] + pulse * 0.38;
  }

  return {
    group, fog, fogNear, fogFar, sun, lights: [hemi, sun, fill], night: isNight, theme, sky,
    envKey: `${theme}:${isNight ? (storm ? 'night-storm' : 'night') : (storm ? 'storm' : 'day')}`,
    envIntensity: C.hemi[2] * (1 - HEMI_KEEP) / Math.PI * ENV_GAIN * (C.envGain ?? 1),
    captureScene: () => buildCapture(sky, hemi.groundColor, storm ? stormSkyMaterial(C.sky) : sky.material),
    exposure: C.exposure ?? DEFAULT_EXPOSURE,
    grade: { ...GRADE_NEUTRAL, ...C.grade },
    blobs: blobMesh,
    vegetation,
    walkways: city ? [] : walkways(L), residentGround, natureSites,
    setFocus,
    setShadowExtent,
    setGroundLite,
    setCoastQuality: harbor?.setQuality,
    coastContacts: harbor?.contacts,
    setStormPulse,
    update(dt, t, camera, windX = 0, windZ = 0) {
      dt = Math.min(Math.max(0, finite(dt)), 0.1);
      time = Number.isFinite(t) ? t : time + dt;
      if (clouds) clouds.rotation.y += dt * 0.004;
      sky.material.uniforms.uTime.value = time;
      WATER_TIME.value = time; // общая вода: гавань и водоёмы карты города
      OCEAN_WIND.value.set(finite(windX),finite(windZ));
      hills.update(camera);
      skyline?.update(camera);
      seasonal?.update(camera);
      if (harbor) { harbor.update(camera); updateBoats(boats, time, camera); }
      streetLamps?.update(camera);
      litter?.update(camera);
      vegetation.update(dt, time, camera, windX, windZ);
      falling?.update(dt, camera, windX, windZ);
    },
    dispose() {
      harbor?.dispose();
      falling?.dispose();
      seasonal?.dispose();
      vegetation.dispose(); // первым: меши поля уходят из группы, общие геометрии не освобождаются
      group.traverse((o) => {
        if (o.geometry && o !== boats) o.geometry.dispose(); // корпуса катеров принадлежат кэшу моделей
        if (o.isInstancedMesh) o.dispose();
      });
      sky.material.dispose();
      for (const l of [hemi, sun, fill]) l.dispose();
    },
  };
}
