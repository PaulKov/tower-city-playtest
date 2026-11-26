// Материалы земли из ассетов: трава, осенняя трава, асфальт, снег (PBR) и мощение тротуаров и площади.
// Albedo в ассетах серое и приведено к общей яркости (tools/assets/build.py, process.mean). Цвет материала —
// оттенок темы × REF_LINEAR / ALBEDO_LINEAR: средняя яркость земли остаётся как у прежних canvas-текстур.
// На medium и low земля лёгкая — Lambert с той же картой (groundMaterial(…, { lite: true })).
import * as THREE from 'three';
import { assets } from '../assets/index.js';
import { customMat, standard, PALETTE } from './materials.js';
import { getTexture } from './textures.js';
import { terrainDiffuseLight } from './diffuseSky.js';

/** Средняя линейная яркость прежней canvas-текстуры; 1 — текстуры не было (плитка, снег). */
export const REF_LINEAR = { 'ground.grass': 0.699, 'ground.asphalt': 0.573, 'ground.tiles': 1, 'ground.snow': 1 };
/** Средняя линейная яркость собранного albedo; сверяет tests/groundMaterials.test.js. */
export const ALBEDO_LINEAR = { 'ground.grass': 0.460, 'ground.asphalt': 0.467, 'ground.tiles': 0.460, 'ground.snow': 0.788 };
export const gainOf = (id) => REF_LINEAR[id] / ALBEDO_LINEAR[id];

/** Виды земли: ассет, оттенок, шероховатость; optional — ассет из пакета темы (без него — гладкая заливка). */
export const GROUND_KINDS = {
  grass: { id: 'ground.grass', color: PALETTE.grass, roughness: 0.95 },
  autumn: { id: 'ground.grass', color: '#b9c46c', roughness: 0.95 },
  mint: { id: 'ground.grass', color: '#a2f0cc', roughness: 0.95 },
  asphalt: { id: 'ground.asphalt', color: PALETTE.asphalt, roughness: 0.92 },
  snow: { id: 'ground.snow', color: '#f3f7fd', roughness: 0.9, optional: true },
};

/** Пятна против заметного повтора: шум cloudNoise по мировым XZ с периодом 40 единиц, ±7–10% по каналам. */
export const PATCH_UNIFORMS = {
  uPatchNoise: { value: null },
  uPatchScale: { value: 1 / 40 },
  uPatchAmp: { value: new THREE.Vector3(0.1, 0.09, 0.07) },
};
/**
 * Мощение: период плитки 3 единицы по Z; доля текстуры uPavingDetail (0 — гладкая заливка вершинным цветом).
 * uPavingAspect (высота / ширина albedo плитки; исходник 2:1 даёт 0.5, множитель u, чтобы камни не сплющивало)
 * общим не бывает: он свой у каждого материала (material.userData.pavingAspect).
 */
export const PAVING_UNIFORMS = { uPavingScale: { value: 1 / 3 }, uPavingDetail: { value: 1 } };

/** Замена куска шейдера; если куска нет (другая версия three) — ошибка, а не тихо неисправленный шейдер. */
function swap(src, from, to) {
  if (!src.includes(from)) throw new Error('shader patch: no ' + from);
  return src.replace(from, to);
}

export function groundPatch(shader) {
  PATCH_UNIFORMS.uPatchNoise.value ??= getTexture('cloudNoise');
  Object.assign(shader.uniforms, PATCH_UNIFORMS);
  const vs = swap(shader.vertexShader, '#include <common>', '#include <common>\nvarying vec2 vGroundXZ;\n');
  shader.vertexShader = swap(vs, '#include <project_vertex>',
    '#include <project_vertex>\nvGroundXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;\n');
  const fs = swap(shader.fragmentShader, '#include <common>',
    '#include <common>\nuniform sampler2D uPatchNoise;\nuniform float uPatchScale;\nuniform vec3 uPatchAmp;\nvarying vec2 vGroundXZ;\n');
  shader.fragmentShader = swap(fs, '#include <map_fragment>', '#include <map_fragment>\n'
    + 'diffuseColor.rgb *= 1.0 + ( texture2D( uPatchNoise, vGroundXZ * uPatchScale ).r - 0.5 ) * 2.0 * uPatchAmp;\n');
}

function pavingPatch(shader, aspect) {
  const gain = gainOf('ground.tiles').toFixed(4);
  Object.assign(shader.uniforms, PAVING_UNIFORMS);
  shader.uniforms.uPavingAspect = aspect;
  const vs = swap(shader.vertexShader, '#include <common>',
    '#include <common>\nuniform float uPavingScale;\nuniform float uPavingAspect;\nvarying float vTileMask;\n');
  shader.vertexShader = swap(vs, '#include <uv_vertex>', '#include <uv_vertex>\n'
    + 'vec3 pavingWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\n'
    + 'vec2 pavingUv = vec2( pavingWorld.x * uPavingScale * uPavingAspect, pavingWorld.z * uPavingScale );\n'
    + 'vMapUv = pavingUv;\nvNormalMapUv = pavingUv;\nvRoughnessMapUv = pavingUv;\nvTileMask = uv.x;\n');
  let fs = swap(shader.fragmentShader, '#include <common>', '#include <common>\nuniform float uPavingDetail;\nvarying float vTileMask;\n');
  fs = swap(fs, '#include <map_fragment>', 'vec4 pavingTexel = texture2D( map, vMapUv );\n'
    + `diffuseColor.rgb *= mix( vec3( 1.0 ), pavingTexel.rgb * ${gain}, vTileMask * uPavingDetail );\n`);
  fs = swap(fs, '#include <normal_fragment_maps>',
    swap(THREE.ShaderChunk.normal_fragment_maps, 'mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vTileMask;'));
  shader.fragmentShader = swap(fs, '#include <roughnessmap_fragment>',
    swap(THREE.ShaderChunk.roughnessmap_fragment, 'roughnessFactor *= texelRoughness.g;',
      'roughnessFactor *= mix( 1.0, texelRoughness.g, vTileMask );\n roughnessFactor = mix(0.56, 1.0, roughnessFactor);'));
}

/**
 * Множитель цвета лёгкого материала (medium, low) на вид земли: средний цвет на снимке medium как у high в пределах 3 %
 * (спецификация «Растительность» §9; подбор — план, Task 3).
 */
export const LITE_GAIN = { grass: 0.887, autumn: 0.905, mint: 0.887, asphalt: 1.137, snow: 1.035 };

/**
 * Лёгкая земля: MeshLambertMaterial с той же картой цвета, без пятен против повтора (замер этапа 0: пятна не укладывали
 * города в бюджет) и без карт рельефа и шероховатости.
 * Рассеянный свет неба (scene.environment) Lambert в r186 получает, теряется только зеркальная часть.
 */
function liteGround(name, def, pbr) {
  const gain = LITE_GAIN[name] ?? 1;
  const key = pbr ? `ground:${name}:lite:${pbr.albedo.uuid}` : `ground:${name}:plain:lite`;
  return customMat(key, () => {
    const m = new THREE.MeshLambertMaterial({
      color: new THREE.Color(def.color).multiplyScalar(gain * (pbr ? gainOf(def.id) : 1)),
      map: pbr?.albedo ?? null,
    });
    m.onBeforeCompile = terrainDiffuseLight;
    return m;
  });
}

/**
 * Материал земли вида kind (неизвестный — трава). Ассеты core обязательны; снег без theme:snow — гладкая заливка.
 * lite — лёгкий вариант для medium и low (liteGround).
 */
export function groundMaterial(kind, store = assets, { lite = false } = {}) {
  const name = Object.hasOwn(GROUND_KINDS, kind) ? kind : 'grass';
  const def = GROUND_KINDS[name];
  const pbr = def.optional ? store.tryGet(def.id) : store.get(def.id);
  if (lite) return liteGround(name, def, pbr);
  if (!pbr) return customMat(`ground:${name}:plain`, () => standard({ color: def.color, roughness: def.roughness, rim: false }));
  return customMat(`ground:${name}:${pbr.albedo.uuid}`, () => {
    const m = standard({
      color: new THREE.Color(def.color).multiplyScalar(gainOf(def.id)), roughness: def.roughness, rim: false,
      map: pbr.albedo, normalMap: pbr.normal, roughnessMap: pbr.roughness,
    });
    m.onBeforeCompile = shader => {
      groundPatch(shader);
      // Нижний дециль исходного скана асфальта даёт около 0,4. Микрофактура
      // сухого заполнителя сохраняется, не собирая зеркальный блик по всей улице.
      shader.fragmentShader = swap(shader.fragmentShader, '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.59, 1.0, roughnessFactor);');
    };
    m.customProgramCacheKey = () => 'groundPatch';
    return m;
  });
}

/** Минеральное мощение: плитка по мировым XZ там, где маска UV.x = 1 (G.tileMask). */
export function pavingMaterial(store = assets) {
  const pbr = store.get('ground.tiles');
  const img = pbr.albedo.image;
  const aspect = { value: img && img.width > 0 && img.height > 0 ? img.height / img.width : 1 };
  return customMat('paving:' + pbr.albedo.uuid, () => {
    const m = standard({
      color: '#ffffff', vertexColors: true, roughness: 0.95, rim: false,
      map: pbr.albedo, normalMap: pbr.normal, roughnessMap: pbr.roughness,
    });
    m.userData.pavingAspect = aspect;
    m.onBeforeCompile = (shader) => pavingPatch(shader, aspect);
    m.customProgramCacheKey = () => 'paving';
    return m;
  });
}
