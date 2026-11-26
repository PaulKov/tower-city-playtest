// Материал стен домов (спецификация «Детализация домов» §4): два массива DataArrayTexture по 5 слоёв — цвет
// с шероховатостью и нормали, — MeshStandardMaterial с патчем шейдера (слой — атрибут aLayer, цвет стиля — вершинный)
// и помощники геометрии стен: UV в метрах, атрибут слоя, слияние. Слои считает wallLayers.js: порциями во время
// загрузки core (prepareWallTextures из main.js), недостающие — синхронно при первой компиляции материала.
// Данные слоёв хранятся всё время: новый контекст WebGL (смена пресета, восстановление) загружает их заново.
import * as THREE from 'three';
import { assetVersion } from '../../assets/index.js';
import * as G from '../geomUtils.js';
import { customMat, reflectPatch, facadeFinish, GOLD } from '../materials.js';
import { registerTexture } from '../textures.js';
import { WALL, WALL_LAYERS, WALL_TILE, LAYER_MEAN, generateWallLayer } from './wallLayers.js';

export { WALL, WALL_TILE, LAYER_MEAN };

/** Сторона слоя в текселях: full и lite (§4.2). */
export const WALL_SIZE = Object.freeze({ full: 512, lite: 256 });
/** Генерация слоёв на странице: время, мс (его читают load_check и perf_check), размер слоя, число посчитанных слоёв. */
export const HOUSE_GEN = { ms: 0, size: 0, layers: 0 };
/** Слой стен стиля этажа (§4.1). */
export const STYLE_LAYER = Object.freeze({
  house: WALL.brick, quick0: WALL.brick,
  shop: WALL.plaster, tower: WALL.plaster, quick1: WALL.plaster,
  office: WALL.panel, quick2: WALL.panel,
  quick3: WALL.composite, nightTower: WALL.composite,
});

/** Слой стиля; неизвестный стиль — кирпич, как у house. */
export const wallLayerOf = (style) => (Object.hasOwn(STYLE_LAYER, style) ? STYLE_LAYER[style] : WALL.brick);
/** Размер слоя по версии ассетов (manifest.pickVersion): lite — 256, иначе 512. */
export const wallTextureSize = (version) => (version === 'lite' ? WALL_SIZE.lite : WALL_SIZE.full);

const N = WALL_LAYERS.length;
/** { size, color, normal, done[], textures, promise } — один на страницу (тесты сбрасывают _resetWallTextures). */
let state = null;

function ensureState(size) {
  if (!state) {
    const bytes = size * size * 4 * N;
    state = { size, color: new Uint8Array(bytes), normal: new Uint8Array(bytes), done: new Array(N).fill(false), textures: null, promise: null };
    HOUSE_GEN.size = size;
  }
  return state;
}

function makeLayer(s, k) {
  const bytes = s.size * s.size * 4, t0 = performance.now();
  generateWallLayer(k, s.size, s.color.subarray(k * bytes, (k + 1) * bytes), s.normal.subarray(k * bytes, (k + 1) * bytes));
  s.done[k] = true;
  HOUSE_GEN.layers++;
  HOUSE_GEN.ms += performance.now() - t0;
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Генерация слоёв порциями: перед каждым слоем — уступка потока (сеть и разбор модулей идут дальше).
 * Один промис на страницу; размер задаёт первый вызов prepareWallTextures или wallTextures.
 */
export function prepareWallTextures({ size = wallTextureSize(assetVersion) } = {}) {
  const s = ensureState(size);
  s.promise ??= (async () => {
    for (let k = 0; k < N; k++) {
      await yieldToBrowser();
      if (state === s && !s.done[k]) makeLayer(s, k);
    }
  })();
  return s.promise;
}

function arrayTexture(data, size, colorSpace, name) {
  const t = new THREE.DataArrayTexture(data, size, size, N);
  t.name = name;
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = colorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return registerTexture(t); // анизотропия игры (setMaxAnisotropy)
}

/** Массивы цвета (sRGB, A — шероховатость) и нормалей; недостающие слои досчитываются сразу. → { color, normal } */
export function wallTextures() {
  const s = ensureState(wallTextureSize(assetVersion));
  for (let k = 0; k < N; k++) if (!s.done[k]) makeLayer(s, k);
  s.textures ??= {
    color: arrayTexture(s.color, s.size, THREE.SRGBColorSpace, 'wallColor'),
    normal: arrayTexture(s.normal, s.size, THREE.NoColorSpace, 'wallNormal'),
  };
  return s.textures;
}

/** Только для тестов: забыть слои и текстуры; следующий вызов начнёт заново со своим размером. */
export function _resetWallTextures() {
  if (state?.textures) { state.textures.color.dispose(); state.textures.normal.dispose(); }
  state = null;
  HOUSE_GEN.ms = 0; HOUSE_GEN.size = 0; HOUSE_GEN.layers = 0;
}

// ---------- материал ----------

/** Массивы для шейдера: общие uniforms обоих вариантов, значения ставит wallPatch. */
const WALL_U = { uWallColor: { value: null }, uWallNormal: { value: null } };
let blankMap = null, blankNormal = null;

function blank(rgba, name) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** Замена куска шейдера; если куска нет (другая версия three) — ошибка, а не тихо неисправленный шейдер. */
function patch(src, from, to) {
  if (!src.includes(from)) throw new Error('wall shader patch: no ' + from);
  return src.replace(from, to);
}

/**
 * Слой aLayer; цвет и шероховатость из массива цвета вместо map; нормаль из массива нормалей вместо normalMap.
 * Пустые map и normalMap включают vMapUv, vNormalMapUv и касательные по производным экрана (план, отличие 1).
 */
function wallPatch(shader) {
  const t = wallTextures();
  WALL_U.uWallColor.value = t.color;
  WALL_U.uWallNormal.value = t.normal;
  Object.assign(shader.uniforms, WALL_U);
  const vs = patch(shader.vertexShader, '#include <common>', '#include <common>\nattribute float aLayer;\nvarying float vWallLayer;\n');
  shader.vertexShader = patch(vs, '#include <uv_vertex>', '#include <uv_vertex>\nvWallLayer = aLayer;\n');
  let fs = patch(shader.fragmentShader, '#include <common>', '#include <common>\n'
    + 'uniform highp sampler2DArray uWallColor;\nuniform highp sampler2DArray uWallNormal;\nvarying float vWallLayer;\nfloat wallRough = 1.0;\n');
  fs = patch(fs, '#include <map_fragment>', 'vec4 wallTexel = texture( uWallColor, vec3( vMapUv, vWallLayer ) );\n'
    + 'diffuseColor.rgb *= wallTexel.rgb;\nwallRough = wallTexel.a;\n');
  fs = patch(fs, '#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= wallRough;\n');
  // в onBeforeCompile чанки ещё не развёрнуты: подставляем текст чанка с выборкой из массива (все вхождения)
  const sample = 'texture2D( normalMap, vNormalMapUv )';
  const normals = patch(THREE.ShaderChunk.normal_fragment_maps, sample, sample)
    .replaceAll(sample, 'texture( uWallNormal, vec3( vNormalMapUv, vWallLayer ) )');
  shader.fragmentShader = patch(fs, '#include <normal_fragment_maps>', normals);
}

/**
 * Материал стен (§4.3): обычный — белый, цвет стиля даёт вершинный цвет; золотой — металл и свечение GOLD
 * (вершинный цвет белый, слой — штукатурка; план, отличие 7). Кэшируется; программа у вариантов общая (отличие 2),
 * различаются uniforms. Слои считает первая компиляция, а не создание материала.
 */
export function wallMaterial({ golden = false, facade = false } = {}) {
  return customMat((golden ? 'wall:golden' : 'wall') + (facade ? ':facade' : ''), () => {
    blankMap ??= blank([255, 255, 255, 255], 'wallBlankMap');
    blankNormal ??= blank([128, 128, 255, 255], 'wallBlankNormal');
    const m = new THREE.MeshStandardMaterial(golden
      ? { color: GOLD.color, roughness: GOLD.roughness, metalness: GOLD.metalness, emissive: GOLD.emissive, emissiveIntensity: GOLD.emissiveIntensity }
      : { color: '#ffffff', roughness: 1, metalness: 0 });
    m.vertexColors = true;
    m.map = blankMap;
    m.normalMap = blankNormal;
    m.userData.reflect = { value: golden && !facade ? GOLD.reflect : 1 };
    m.onBeforeCompile = (shader) => {
      if (facade) facadeFinish(shader, golden ? 0.56 : 0.13, golden ? 0.56 : 0.81);
      reflectPatch(shader, m.userData.reflect);
      wallPatch(shader);
    };
    m.customProgramCacheKey = () => facade ? 'wallArray:facade:' + golden : 'wallArray';
    return m;
  });
}

// ---------- геометрия ----------

/**
 * Готовит геометрию для материала стен: вершинный цвет color, слой layer (атрибут aLayer) и, если uv, UV в метрах —
 * проекция на доминирующую ось нормали: стены (x | z, y) / WALL_TILE, горизонтальные грани (x, z) / WALL_TILE.
 * uv: false — свои UV (черепица считает их до поворота ската). Меняет и возвращает geom.
 */
export function asWall(geom, layer, color, { uv = true } = {}) {
  if (uv) G.boxUv(geom, 1 / WALL_TILE);
  G.colored(geom, color);
  const n = geom.getAttribute('position').count;
  geom.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(n).fill(layer), 1));
  return geom;
}

/** Сливает геометрии стен: position, normal, uv, color, aLayer. */
export const mergeWalls = (list) => G.mergeColored(list, { layer: true });
