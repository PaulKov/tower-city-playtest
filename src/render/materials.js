// Палитра и кэш материалов. Все стандартные материалы получают контурную (френелевую) подсветку.
import * as THREE from 'three';
import { BUILDING_TYPES } from '../core/levels.js';
import { getTexture } from './textures.js';
import { propFinishPatch } from './propFinishes.js';
import { vertexDiffuseSky } from './diffuseSky.js';

export const PALETTE = {
  house: BUILDING_TYPES.house.color,
  shop: BUILDING_TYPES.shop.color,
  office: BUILDING_TYPES.office.color,
  tower: BUILDING_TYPES.tower.color,
  white: '#fffaf2',
  cream: '#fff1d6',
  trim: '#fbf3e6',
  wood: '#b8784a',
  woodDark: '#7c4a2d',
  roofRed: '#e8644f',
  roofBlue: '#5b8fd9',
  roofGreen: '#69b86b',
  glass: '#8fc9f0',
  glassLit: '#ffcf7a',
  gold: '#ffc94a',
  goldGlow: '#ffb02e',
  craneYellow: '#ffc93c',
  craneRed: '#ef5b4b',
  steel: '#8d99a8',
  steelDark: '#5d6877',
  grass: '#8fd46a',
  grassDark: '#5fae4a',
  asphalt: '#646a73',
  sidewalk: '#e4ddd2',
  sand: '#f2d9a0',
  water: '#4fb6e8',
  leaf: '#6cc25a',
  leafAutumn: '#f39a3c',
  leafPine: '#3f9a63',
  trunk: '#8a5a3b',
  snow: '#f6fbff',
  cloud: '#ffffff',
  skin: '#ffd9bd',
  blush: '#ff9aa2',
  neonPink: '#ff4fa3',
  neonCyan: '#3ff0ff',
  skyTop: '#5fb4f2',
  skyBottom: '#d8f0ff',
};

const RIM = {
  uRimColor: { value: new THREE.Color('#fff4e0') },
  uRimPower: { value: 2.6 },
  uRimStrength: { value: 0.32 },
};
const RIM_DAY = { color: '#fff4e0', strength: 0.32 };
const RIM_NIGHT = { color: '#86b2ff', strength: 0.42 };
const RIM_DECL = '\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\n';
const RIM_CODE = 'outgoingLight += uRimColor * pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), uRimPower ) * uRimStrength;\n';

/** Вставляет контурную подсветку в шейдер (общие uniforms RIM). Для собственных onBeforeCompile. */
function applyRim(shader, condition = '') {
  Object.assign(shader.uniforms, RIM);
  let fs = shader.fragmentShader;
  fs = fs.includes('#include <common>') ? fs.replace('#include <common>', '#include <common>' + RIM_DECL) : RIM_DECL + fs;
  shader.fragmentShader = fs.replace('#include <opaque_fragment>', condition + RIM_CODE + '#include <opaque_fragment>');
}

export function rimPatch(shader) { applyRim(shader); }

/** Флаг остаётся в общем батче с обычными домами. Рамы — анодированный алюминий, панели — порошковая окраска. */
export function facadeFinish(shader, metalness, roughness) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aFacadeFinish; varying float vFacadeFinish;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacadeFinish = aFacadeFinish;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vFacadeFinish;')
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nif (vFacadeFinish > 0.5) { metalnessFactor = ${metalness}; roughnessFactor = mix(roughnessFactor, ${roughness}, 0.89); }`);
}

export function markFacadeFinish(g) {
  g.setAttribute('aFacadeFinish', new THREE.BufferAttribute(new Uint8Array(g.attributes.position.count).fill(1), 1));
  return g;
}

/** Добавляет контурную подсветку в MeshStandard/Physical-материал. Возвращает материал. */
export function addRim(material) {
  material.onBeforeCompile = rimPatch;
  material.customProgramCacheKey = () => 'rim';
  return material;
}

// ---- Отражение неба ----
// В r186 материал без своего envMap берёт силу карты из scene.environmentIntensity: material.envMapIntensity
// не действует. Блеск отдельных материалов задаёт множитель одиночного отражения карты (radiance);
// рассеянный свет карты (iblIrradiance) и многократное рассеяние он не трогает.
const REFLECT_DECL = '\nuniform float uReflect;\n';
const REFLECT_CODE = '\n#if defined( RE_IndirectSpecular )\nradiance *= uReflect;\n#endif\n';

/** Вставляет множитель отражения неба; reflect — uniform { value } материала. Для собственных onBeforeCompile. */
export function reflectPatch(shader, reflect) {
  shader.uniforms.uReflect = reflect;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + REFLECT_DECL)
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>' + REFLECT_CODE);
}

/**
 * Добавляет материалу множитель отражения неба k поверх его onBeforeCompile (rim и др.).
 * Значение — material.userData.reflect.value: его можно менять на лету, программа шейдера общая. Возвращает материал.
 */
export function addReflect(material, k) {
  if (material.userData.reflect) { material.userData.reflect.value = k; return material; } // уже отражает: только меняем множитель
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.userData.reflect = { value: k };
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    reflectPatch(shader, material.userData.reflect);
  };
  material.customProgramCacheKey = () => key + '+reflect';
  return material;
}

/** Стекло (спецификация §6.5): гладкое, отражает небо. Ночное свечение окон задаёт шейдер 'windows'. */
export const GLASS = Object.freeze({ roughness: 0.08, reflect: 3.5 });
/** Золото купола и золотых этажей: металл, отражает небо; слабое свечение держит цвет в тени и ночью. */
export const GOLD = Object.freeze({
  color: PALETTE.gold, roughness: 0.3, metalness: 1, emissive: PALETTE.goldGlow, emissiveIntensity: 0.25, reflect: 3,
});

const nightMats = [];
let night = false;
/** Общий uniform «ночь» (0/1) для шейдеров с собственной ночной логикой. */
export const NIGHT_UNIFORM = { value: 0 };

// ---- Стёкла фасадов: одна геометрия на этаж, поведение окна задаётся вершинными данными ----
// color — оттенок свечения; uv.x — яркость ночью (0..1), uv.x = 2 — неон, светится всегда;
// uv.y — доля тёплой шторы; отрицательное значение — ячейка офиса и угол плоскости в его атласе.
const WINDOW_U = {
  uNight: NIGHT_UNIFORM,
  uCurtain: { value: new THREE.Color('#ffd9a8') },
  uGlow: { value: 1.35 },
};
const WINDOW_VS_DECL = '\n#ifndef USE_COLOR\nattribute vec3 color;\n#endif\nvarying vec3 vGlowTint;\nvarying vec2 vPane;\n';
const WINDOW_FS_DECL = '\nuniform float uNight;\nuniform vec3 uCurtain;\nuniform float uGlow;\nvarying vec3 vGlowTint;\nvarying vec2 vPane;\n';

const ROOM_ADDR = `
  vGlazing = vec3(0.0);
  if (aRoomCoord > 0.0) {
    float code = aRoomCoord - 1.0, tile = floor(code * 0.25);
    vec2 corner = vec2(mod(code, 2.0), mod(floor(code * 0.5), 2.0));
    vec3 view = normalize(-(modelViewMatrix * vec4(position, 1.0)).xyz);
    vec3 across = normalize(mat3(modelViewMatrix) * vec3(normal.z, 0.0, -normal.x));
    vec2 slide = vec2(dot(view, across), dot(view, normalize(mat3(modelViewMatrix)[1]))) * 0.06;
    vGlazing = vec3((vec2(mod(tile, 4.0), 3.0 - floor(tile * 0.25)) + 0.075 + 0.85 * corner - slide) * 0.25,
                    saturate(dot(view, normalize(normalMatrix * normal))));
  }`;

// Вершины передают луч в координатах окна. Мебель и задняя стена лежат на разных глубинах.
const OFFICE_UV = `
  vRoomUv = vec2(0.0); vRoomView = vec3(0.0, 0.0, 1.0);
  if (uv.y < 0.0) {
    float code = -uv.y - 1.0, tile = floor(code * 0.25);
    vPane.y = -1.0 - tile;
    vRoomUv = vec2(mod(code, 2.0), mod(floor(code * 0.5), 2.0));
    vec3 view = normalize(-(modelViewMatrix * vec4(position, 1.0)).xyz);
    vec3 across = normalize(mat3(modelViewMatrix) * vec3(normal.z, 0.0, -normal.x));
    vec3 up = normalize(mat3(modelViewMatrix)[1]);
    vRoomView = vec3(dot(view, across), dot(view, up), dot(view, normalize(normalMatrix * normal)));
  }`;

const OFFICE_ROOM = `
  float officeLightThroughGlass() {
    float tile = floor(-vPane.y - 0.5);
    vec2 cell = vec2(mod(tile, 2.0), 1.0 - floor(tile * 0.5));
    vec2 uv = vRoomUv;
    vec2 pixelX = dFdx(uv), pixelY = dFdy(uv);
    float pixel = max(abs(pixelX.x) + abs(pixelY.x), abs(pixelX.y) + abs(pixelY.y));
    float transmission = 0.96 * (1.0 - pow(1.0 - saturate(vRoomView.z), 5.0));
    if (pixel >= 0.25) return 0.255 * transmission;
    vec2 ray = -vRoomView.xy / max(vRoomView.z, 0.075) * vec2(0.34, 0.49);
    vec2 span = mix(uv, 1.0 - uv, step(vec2(0.0), ray)) / max(abs(ray), vec2(0.0001));
    float side = min(span.x, span.y), depth = min(side, 1.0);
    vec2 hit = clamp(uv + depth * ray, 0.0, 1.0);
    vec2 address = (cell + 0.012 + 0.976 * hit) * 0.5;
    float light = textureGrad(uOfficeInteriors, address, pixelX * 0.488, pixelY * 0.488).r;
    if (side < 1.0) {
      float reach = mix(0.48, 1.0, depth);
      float skyward = step(span.y, span.x) * step(0.0, ray.y);
      float floorward = step(span.y, span.x) * step(ray.y, 0.0);
      light = mix(light * reach * 0.70, 0.18 + 0.18 * depth, skyward);
      light = mix(light, 0.048 + 0.09 * depth, floorward);
      vec2 fixture = abs(vec2(hit.x - (0.39 + 0.065 * tile), depth - 0.64));
      float aa = clamp(pixel, 0.001, 0.09);
      light += skyward * (1.0 - smoothstep(0.17 - aa, 0.17 + aa, fixture.x))
                       * (1.0 - smoothstep(0.043 - aa, 0.043 + aa, fixture.y)) * 0.88;
    }
    vec2 nearUv = uv + 0.36 * ray;
    if (depth > 0.36) {
      vec2 furniture = textureGrad(uOfficeInteriors, (cell + 0.012 + 0.976 * nearUv) * 0.5, pixelX * 0.488, pixelY * 0.488).gb;
      light = light * (1.0 - furniture.x) + furniture.y;
    }
    light = mix(light, 0.255, smoothstep(0.065, 0.25, pixel));
    return light * transmission;
  }`;

function windowGlass(offices = false) {
  const m = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.19, metalness: 0 });
  m.defaultAttributeValues = { aRoomCoord: [0] }; // круглые чердачные окна, фонари и старые меши
  m.userData.reflect = { value: 1.1 };
  m.onBeforeCompile = (shader) => {
    reflectPatch(shader, m.userData.reflect);
    Object.assign(shader.uniforms, WINDOW_U);
    shader.uniforms.uFacadeRooms = { value: getTexture('facadeRooms') };
    if (offices) shader.uniforms.uOfficeInteriors = { value: getTexture('officeInteriors') };
    const roomUv = offices ? '\nvarying vec2 vRoomUv; varying vec3 vRoomView;\n' : '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>' + WINDOW_VS_DECL + roomUv + 'attribute float aRoomCoord; varying vec3 vGlazing;\n')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlowTint = color;\nvPane = uv;\n' + ROOM_ADDR + (offices ? OFFICE_UV : ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + WINDOW_FS_DECL + 'varying vec3 vGlazing; uniform sampler2D uFacadeRooms;\n' + roomUv + (offices ? 'uniform sampler2D uOfficeInteriors;\n' + OFFICE_ROOM : ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n'
        + (offices ? 'if (vPane.y < 0.0) diffuseColor.rgb = vec3(0.013, 0.031, 0.038); else ' : '')
        + 'diffuseColor.rgb = mix( diffuseColor.rgb, uCurtain, vPane.y );\n'
        + `vec3 room = vec3(1.0);
           if (vGlazing.x > 0.0) {
             room = texture2D(uFacadeRooms, vGlazing.xy).rgb;
             diffuseColor.rgb = mix(vec3(0.11,0.19,0.24), room, 0.80 * vGlazing.z);
           }\n`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n'
        + 'float paneGlow = vPane.x > 1.5 ? mix( 0.7, 1.2, uNight ) : vPane.x * uNight;\n'
        + 'if (vGlazing.x > 0.0) paneGlow *= (0.09 + 1.1 * dot(room, vec3(0.21,0.72,0.07))) * vGlazing.z;\n'
        + (offices ? 'if (vPane.y < 0.0) paneGlow *= officeLightThroughGlass();\n' : '')
        + 'totalEmissiveRadiance += vGlowTint * uGlow * paneGlow;\n');
    if (offices) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (vPane.y < 0.0) roughnessFactor = 0.235;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (vPane.y < 0.0) metalnessFactor = 0.0;')
        .replace('radiance *= uReflect;', 'radiance *= vPane.y < 0.0 ? 0.82 : uReflect;')
        .replace('#include <opaque_fragment>', `
          #if !defined(USE_ENVMAP) && NUM_HEMI_LIGHTS > 0
            if (vPane.y < 0.0) {
              vec3 hemi = mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, smoothstep(-0.50, 0.50, -vRoomView.y));
              outgoingLight += hemi * (0.012 + 0.075 * pow(1.0 - saturate(vRoomView.z), 4.0));
            }
          #endif
          #include <opaque_fragment>`);
    }
  };
  m.customProgramCacheKey = () => offices ? 'officeWindows' : 'windows';
  return m;
}

/** Готовит кусок стекла для материала 'windows': оттенок свечения, яркость ночью, штора. */
export function windowPiece(geom, { glow = PALETTE.glassLit, lit = 1, curtain = 0, room = null, interior = null } = {}) {
  _c.set(glow);
  const n = geom.getAttribute('position').count;
  const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    uv[i * 2] = lit;
    uv[i * 2 + 1] = room === null ? curtain : -(1 + room * 4 + geom.attributes.uv.getX(i) + 2 * geom.attributes.uv.getY(i));
  }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (room === null && interior !== null) {
    const source = geom.getAttribute('uv'), coords = new Uint8Array(n);
    for (let i = 0; i < n; i++) coords[i] = 1 + interior * 4 + source.getX(i) + 2 * source.getY(i);
    geom.setAttribute('aRoomCoord', new THREE.BufferAttribute(coords, 1));
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}
const _c = new THREE.Color();

/**
 * Стандартный мультяшный материал: roughness 0.75, metalness 0, с подсветкой контура.
 * opts.rim === false — без подсветки; opts.night = {day, night} — интенсивность эмиссии днём и ночью;
 * opts.reflect — множитель отражения неба (addReflect).
 */
export function standard(opts = {}) {
  const { rim = true, night: nightCfg, map, reflect, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...rest });
  if (map) m.map = typeof map === 'string' ? getTexture(map) : map;
  if (rim) addRim(m);
  if (reflect !== undefined) addReflect(m, reflect); // после addRim: тот заменяет onBeforeCompile
  if (nightCfg) registerNight(m, nightCfg.day ?? 0, nightCfg.night ?? 1);
  return m;
}

/** Материал меняет emissiveIntensity между днём и ночью. */
export function registerNight(material, day, nightValue) {
  nightMats.push({ material, day, night: nightValue });
  material.emissiveIntensity = night ? nightValue : day;
}

export function setNightMode(on) {
  night = !!on;
  NIGHT_UNIFORM.value = night ? 1 : 0;
  for (const n of nightMats) n.material.emissiveIntensity = night ? n.night : n.day;
  const r = night ? RIM_NIGHT : RIM_DAY;
  RIM.uRimColor.value.set(r.color);
  RIM.uRimStrength.value = r.strength;
}
export const isNight = () => night;

function propMaterial(roughness) {
  const m = standard({ color: '#ffffff', vertexColors: true, roughness, rim: false });
  m.onBeforeCompile = propFinishPatch;
  m.customProgramCacheKey = () => 'propFinishes';
  return m;
}

const DEFS = {
  trim: () => {
    const m=standard({ color:'#ffffff', vertexColors:true, roughness:0.82, rim:false });
    m.onBeforeCompile=vertexDiffuseSky;
    return m;
  },
  facadeTrim: () => {
    const m = standard({ color: '#ffffff', vertexColors: true, roughness: 0.7, rim: false });
    m.onBeforeCompile = (shader) => facadeFinish(shader, 0.36, 0.68);
    m.customProgramCacheKey = () => 'facadeTrim';
    return m;
  },
  toy: () => propMaterial(0.88),
  matte: () => standard({ color: '#ffffff', vertexColors: true, roughness: 0.95, rim: false }),
  glass: () => standard({ color: PALETTE.glass, ...GLASS, emissive: PALETTE.glassLit, night: { day: 0, night: 1.25 } }),
  gold: () => standard(GOLD),
  craneYellow: () => standard({ color: PALETTE.craneYellow, roughness: 0.74, rim: false }),
  steel: () => standard({ color: PALETTE.steel, metalness: 0.62, roughness: 0.56, rim: false }),
  cloud: () => standard({ color: PALETTE.cloud, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.12, rim: false }),
  snow: () => standard({ color: PALETTE.snow, roughness: 0.94, rim: false }),
  water: () => standard({ color: PALETTE.water, roughness: 0.12 }),
  lamp: () => standard({ color: '#fffdf4', emissive: '#ffd36b', roughness: 0.22, vertexColors: true,
    transparent: true, depthWrite: false, rim: false, night: { day: 0.15, night: 2.2 } }),
  windows: windowGlass,
  officeWindows: () => windowGlass(true),
  beacon: () => standard({ color: '#ffe2d6', emissive: '#ff4a36', emissiveIntensity: 1.8, rim: false }),
  vegetationShadow: () => DEFS.shadowBlob(0),
  shadowBlob: (slopeBias = -2) => {
    const m = new THREE.MeshBasicMaterial({
      color: '#1d2a3a', alphaMap: getTexture('softShadow'), transparent: true, opacity: 0.72, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: slopeBias, polygonOffsetUnits: -2,
    });
    // У softShadow тёмное ядро крошечное (спад (1−r)^1.8) и прячется под стволом; для пятна нужен
    // пологий спад, иначе после линейного смешивания тень на экране почти не видна.
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>',
        'diffuseColor.a *= pow( texture2D( alphaMap, vAlphaMapUv ).g, 0.45 );');
    };
    m.customProgramCacheKey = () => 'shadowBlob';
    return m;
  },
};

const cache = new Map();

/** Общий материал по имени (кэшируется). */
export function mat(name) {
  let m = cache.get(name);
  if (m) return m;
  const def = DEFS[name];
  if (!def) throw new Error('Unknown material: ' + name);
  m = def();
  m.name = name;
  cache.set(name, m);
  return m;
}

/** Материал с произвольным ключом: создаётся фабрикой один раз. */
export function customMat(key, factory) {
  let m = cache.get(key);
  if (!m) { m = factory(); m.name = key; cache.set(key, m); }
  return m;
}
