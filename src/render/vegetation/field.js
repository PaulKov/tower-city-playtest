// Поле растений (спецификация «Растительность» §8, §10.2): один InstancedMesh на тройку «вид × вариант × LOD» с именем
// veg:<kind>:<variant>:L<lod>; отсечение по пирамиде видимости, выбор уровня по размеру на экране и растворение при
// смене уровня — на CPU; пятна-тени растений — общий меш vegBlobs. Пересчёт идёт, только когда камера сдвинулась
// или повернулась, сменилась проекция, идут растворения или после add и configure.
import * as THREE from 'three';
import { hashSeed } from '../../core/rng.js';
import { autumnLeafLoss } from '../../core/autumnFoliage.js';
import { mat } from '../materials.js';
import { KINDS, meshName, vegTheme, GRASS } from './kinds.js';
import { projectedPx, pickLod, smallVisible, HIDE_PX, FADE_S } from './lod.js';
import { vegGeometry } from './geometry.js';
import { palmGeometry } from './palm.js';
import { mapleGeometry, mapleAtlas, prepareAutumnBroadleaf } from './maple.js';
import { cityFloraGeometry } from './cityFlora.js';
import { coastalGeometry } from './coastal.js';
import { noAlphaBefore, noAlphaAfter } from '../menu/menuFlora.js';
import { vegetationMaterial, VEG_UNIFORMS } from './material.js';
import { createGrass, grassFocus, grassMaskTexture } from './grass.js';
import { VEG_GEN } from './atlas.js';

/** Сдвиг камеры, м, и поворот, рад, после которых поле пересчитывается (спецификация §8.2). */
const MOVE = 0.2, TURN = 0.5 * Math.PI / 180;
const HIDDEN = -1, NONE = -2;
// На 62 пикселях контур двенадцатигранного сечения камня отличается от гладкого примерно на пиксель.
const ROCK_LOD = [62, -Infinity];
// За краем рощи L0 нужен вблизи. Лопастная лиственная крона сохраняет средний
// уровень дольше пальм и елей: её крупные пучки ещё различимы при размере 55–100 px.
const WOODLAND_DETAIL = 0.36, BROADLEAF_FAR_DETAIL = 0.75;
// На medium развилки небольшой кисти читаются уже в атласе. При высоте
// опорного кадра 1080 средняя сетка сохраняется примерно до 140 пикселей.
const LITE_BROADLEAF_FAR_DETAIL = 0.43;
const UNDERGROWTH_PX = 46;
const isUndergrowth = p => p.woodland && (p.kind === 'bush' || p.kind === 'drift');
// Вид дерева закреплён за местом посадки. Поле растений и точки контакта используют один вариант.
function speciesAt(theme, p) {
  if (p.kind === 'tree') {
    if (theme === 'harbor') return 'palm';
    if (theme === 'autumn' && hashSeed(Math.round(p.x * 100), Math.round(p.z * 100)) % 4 !== 0) return 'maple';
  }
  return p.kind;
}
function variantAt(theme, p, kind) {
  if (theme === 'autumn' && (kind === 'tree' || kind === 'pine')) return 0;
  return clampInt(p.variant, KINDS[p.kind].variants);
}
const isCoastalUnderstory = kind => kind === 'bush' || kind === 'hedge' || kind === 'bed' || kind === 'flowers';
function plantModel(theme, floraAtlas, kind, variant, lod) {
  if (kind === 'palm') return palmGeometry(variant, lod);
  if (kind === 'maple') return mapleGeometry(variant, lod);
  if (theme === 'harbor' && isCoastalUnderstory(kind)) return coastalGeometry(kind, variant, lod);
  const snow = vegTheme(theme).snowPines;
  const g = floraAtlas && kind !== 'drift' ? cityFloraGeometry(kind, variant, lod, snow) : vegGeometry(kind, variant, lod, { snow });
  return theme === 'autumn' && kind === 'tree' ? prepareAutumnBroadleaf(g, variant) : g;
}
export function plantGeometryAt(theme, floraAtlas, p, lod) {
  const kind = speciesAt(theme, p);
  return plantModel(theme, floraAtlas, kind, variantAt(theme, p, kind), lod);
}

/** Настройка до первого configure — как high. */
export const VEG_DEFAULT = { lod: [140, 40], lite: false, wind: true, grass: false, blobs: true };
const BLOB_PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // общий для всех полей, не освобождается
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _pm = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _sphere = new THREE.Sphere();
const _cam = new THREE.Vector3(), _camQ = new THREE.Quaternion();
const _focus = new THREE.Vector2();
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clampInt = (x, n) => Math.min(n - 1, Math.max(0, Math.floor(finite(x))));
const validPlant = (p) => !!p && Object.hasOwn(KINDS, p.kind) && [p.x, p.y, p.z, p.s].every(Number.isFinite) && p.s > 0;

/** Обёртка кэшированной геометрии: те же атрибуты и индекс, свой инстансный aFade (план, отличие 4). */
function wrap(src, cap, autumn) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.setIndex(src.index);
  const width = autumn ? 2 : 1; // На осенних деревьях второе число — доля опавших листьев.
  g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(cap * width), width).setUsage(THREE.DynamicDrawUsage));
  g.name = src.name + ':field';
  return g;
}

/** Освобождает меш поля: общие атрибуты снимаются до dispose обёртки — их GPU-буферы общие для всех сцен. */
function freeMesh(m) {
  const g = m.geometry;
  for (const k of Object.keys(g.attributes)) if (k !== 'aFade') g.deleteAttribute(k);
  g.setIndex(null);
  g.dispose();
  m.dispose();
  m.removeFromParent();
}

/**
 * Заливает на GPU первые n элементов буфера attribute. Диапазон — свой объект range буфера (а не новый объект
 * addUpdateRange на каждый пересчёт); renderer three после заливки очищает список, следующий пересчёт кладёт тот же.
 */
function markRange(attribute, range, n) {
  range.start = 0;
  range.count = n;
  attribute.clearUpdateRanges();
  attribute.updateRanges.push(range);
  attribute.needsUpdate = true;
}

/**
 * Выставляет число экземпляров и диапазоны обновления буферов. Набор экземпляров мог смениться и при том же count,
 * поэтому ограничивающие объёмы сбрасываются всегда: three пересчитает их лениво, только для луча
 * (frustumCulled = false, рендер их не читает). Объекты диапазонов — m.userData.ranges (makeMesh).
 */
function flush(m, count) {
  m.boundingSphere = null;
  m.boundingBox = null;
  m.count = count;
  m.visible = count > 0;
  if (!count) return;
  const r = m.userData.ranges;
  markRange(m.instanceMatrix, r[0], count * 16);
  markRange(m.instanceColor, r[1], count * 3);
  const fade = m.geometry.attributes.aFade;
  markRange(fade, r[2], count * fade.itemSize);
}

/**
 * Поле растений темы theme (неизвестная — долина): снежные ели в снегу; night ослабляет просвет листвы;
 * sunDir — направление на солнце (пятна-тени смещены от него, просвет — против него).
 * grassMask(x, z) — маска газонов для травы high (null — травы нет).
 */
export function createVegetationField({ theme = 'valley', night = false, sunDir = new THREE.Vector3(14, 24, 11), grassMask = null, floraAtlas = null, groveProbe = null } = {}) {
  const biome = vegTheme(theme), snow = biome.snowPines;
  const group = new THREE.Group();
  group.name = 'vegetation';
  const flatSun = new THREE.Vector2(-sunDir.x, -sunDir.z).normalize(), sunYaw = Math.atan2(flatSun.x, flatSun.y);
  VEG_UNIFORMS.uSunDir.value.copy(sunDir).normalize();
  VEG_UNIFORMS.uTrans.value = night ? 0.12 : 0.35;

  const records = [], groups = [];
  let config = { ...VEG_DEFAULT }, thr = config.lod, blobs = null;
  const broadleafLod = [thr[0] / WOODLAND_DETAIL, thr[1] / BROADLEAF_FAR_DETAIL];
  // У низкого кустарника сфера отсечения шире видимой кроны. Отдельные
  // пластинки нужны, пока их длина в несколько сантиметров различима на экране.
  const shrubLod = [1.60*thr[0],thr[1]];
  let n = 0, cx, cy, cz, rad, grp, fixed, mats, cols, leafLoss, cur, from, fadeT, seen;
  let dirty = true, fading = 0;
  let grass = null;
  const lastPos = new THREE.Vector3(), lastQuat = new THREE.Quaternion(), lastProj = new Float64Array(16);
  const stats = { cpuMs: 0, visible: 0, lod: [0, 0, 0], fading: 0, updates: 0,
    // grass — ёмкость включённого поля (§8.4). grassSubmitted — слоты, подготовленные к отрисовке из текущей камеры.
    get grass() { return grass && config.grass ? GRASS.n * GRASS.n : 0; },
    get grassSubmitted() { return group.visible && grass?.mesh.visible ? grass.mesh.geometry.instanceCount : 0; },
    get genMs() { return VEG_GEN.ms; } };
  const geometry = (kind, variant, lod) => plantModel(theme, floraAtlas, kind, variant, lod);
  const coastalUnderstory = kind => biome.coastal && isCoastalUnderstory(kind);

  function setMaterial(m) {
    const { kind, lod } = m.userData.veg;
    const palm = kind === 'palm';
    const atlas = kind === 'maple' ? mapleAtlas(lod) : floraAtlas;
    const stone = kind === 'rock' && !!atlas && lod === 0;
    const shrub = kind === 'bush' || kind === 'hedge';
    const leafy = shrub || kind === 'tree' || kind === 'pine' || kind === 'maple';
    const solid = palm || kind === 'drift' || coastalUnderstory(kind) || (atlas && ((kind === 'rock' && !stone) || (lod === 2 && !leafy)));
    m.material = vegetationMaterial({ lite: config.lite, wind: config.wind, palm, palmFar: palm && lod > 0, snowbank: kind === 'drift', solid: !!solid,
      spruce: kind === 'pine' && !!floraAtlas && lod === 0, needles: kind === 'pine' && !!floraAtlas, stone,
      shrub: !!floraAtlas && !solid && shrub,
      barkRelief: kind === 'tree' && !!floraAtlas && lod === 0,
      barkGrain: kind === 'tree' && !!floraAtlas && lod > 0,
      groveLight: !!atlas && lod > 0 && (kind === 'tree' || kind === 'maple' || kind === 'pine'),
      groveProbe: lod > 0 && (kind === 'tree' || kind === 'maple') ? groveProbe : null,
      closedCanopy: kind === 'maple' && lod === 2, mapleBark: kind === 'maple' && lod < 2, autumn: m.userData.veg.autumn,
      floraAtlas: solid ? null : atlas, floraFlowers: kind === 'flowers' || kind === 'bed' });
    // При alphaToCoverage покрытие берётся из альфы, но альфа фона (1) нужна постобработке.
    const cover = (atlas || palm) && m.material.alphaToCoverage;
    m.onBeforeRender = cover ? noAlphaBefore : THREE.Object3D.prototype.onBeforeRender;
    m.onAfterRender = cover ? noAlphaAfter : THREE.Object3D.prototype.onAfterRender;
  }

  function makeMesh(g, lod) {
    const src = geometry(g.kind, g.variant, lod);
    const m = new THREE.InstancedMesh(wrap(src, g.cap, g.autumn), null, g.cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(g.cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    m.name = meshName(g.kind, g.variant, lod);
    m.count = 0;
    m.visible = m.frustumCulled = m.castShadow = false;
    m.receiveShadow = true;
    m.userData.veg = { kind: g.kind, variant: g.variant, lod, autumn: g.autumn };
    setMaterial(m);
    // диапазоны заливки матриц, цветов и aFade (flush): по объекту на буфер на всё время жизни меша
    m.userData.ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }];
    return m;
  }

  /** Пятна-тени (спецификация §5.6): у изгороди вытянуто вдоль сегмента, у остальных — от солнца, как прежние. */
  function buildBlobs() {
    const list = [], understory = [];
    for (let i = 0; i < records.length; i++) {
      const p = records[i];
      const K = KINDS[p.kind], b = (snow && K.blobSnow) || K.blob;
      if (!b || p.blob === false) continue;
      const size = b[0] * p.s, off = b[1] * p.s;
      // У осеннего парка верх газона и дорожки общий. Поднять пятно всего на 2 мм:
      // глубину дополнительно смещает материал, а пятно на высоте 1,5 см пересекало комель.
      const lift = p.kind === 'pine' && floraAtlas ? 0.0001 : p.litterPark ? 0.002 : 0.015;
      _p.set(p.x + flatSun.x * off, p.y + lift, p.z + flatSun.y * off);
      if (K.blobLen) { _q.setFromEuler(_e.set(0, finite(p.ry), 0)); _s.set(K.blobLen * p.s, 1, size); }
      else { _q.setFromEuler(_e.set(0, sunYaw, 0)); _s.set(size, 1, size * 1.35); }
      const matrix = _m.compose(_p, _q, _s).clone();
      if (isUndergrowth(p)) understory.push({ index: i, matrix, slot: -1 });
      else list.push(matrix);
    }
    const total = list.length + understory.length;
    const m = new THREE.InstancedMesh(BLOB_PLANE, mat(floraAtlas ? 'vegetationShadow' : 'shadowBlob'), Math.max(1, total));
    if (understory.length) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.userData.understory = { base: list.length, items: understory, range: { start: 0, count: 0 } };
      understory.forEach((item, i) => {
        item.slot = list.length + i;
        m.setMatrixAt(item.slot, item.matrix);
      });
    }
    list.forEach((x, i) => m.setMatrixAt(i, x));
    m.count = total;
    m.name = 'vegBlobs';
    m.castShadow = m.receiveShadow = false;
    m.renderOrder = 1;
    m.visible = !!config.blobs && total > 0;
    m.computeBoundingSphere();
    return m;
  }

  // Постоянные тени остаются в начале буфера. Контактные тени лесного подлеска
  // используют тот же меш до конца растворения кустов. Загружаются только изменённые слоты.
  function syncUnderstoryBlobs() {
    const state = blobs.userData.understory;
    if (!state) return;
    let next = state.base, first = Infinity;
    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      if (cur[item.index] < 0 && from[item.index] < 0) {
        item.slot = -1;
      } else {
        if (item.slot !== next) {
          blobs.setMatrixAt(next, item.matrix);
          first = Math.min(first, next);
        }
        item.slot = next++;
      }
    }
    blobs.count = next;
    blobs.visible = !!config.blobs && next > 0;
    if (first < next) {
      const attribute = blobs.instanceMatrix, range = state.range;
      // Между двумя отрисовками камера может обновиться несколько раз.
      const start = attribute.updateRanges.length ? Math.min(range.start, first * 16) : first * 16;
      const end = attribute.updateRanges.length ? Math.max(range.start + range.count, next * 16) : next * 16;
      range.start = start;
      range.count = end - start;
      attribute.clearUpdateRanges();
      attribute.updateRanges.push(state.range);
      attribute.needsUpdate = true;
    }
  }

  function freeAll() {
    for (const g of groups) for (const m of g.meshes) freeMesh(m);
    groups.length = 0;
    if (blobs) { blobs.dispose(); blobs.removeFromParent(); blobs = null; }
  }

  /** Трава high (спецификация §8.5): создаётся при первом configure с grass, если у темы есть трава и задана маска. */
  function syncGrass() {
    const palette = biome.grass, want = !!config.grass && !!grassMask && !!palette;
    if (want && !grass) {
      grass = createGrass({ palette, coastal: biome.coastal, flowerRate: biome.grassFlowers, mask: grassMaskTexture(grassMask) });
      group.add(grass.mesh);
    }
    if (!grass) return;
    grass.mesh.visible = want;
    grass.configure(config.lite, config.wind);
  }

  /** Пересборка по records: массивы растений, меши групп «вид × вариант», пятна. */
  function rebuild() {
    freeAll();
    n = records.length;
    [cx, cy, cz, rad, fadeT] = [0, 0, 0, 0, 0].map(() => new Float32Array(n));
    grp = new Int16Array(n); fixed = new Int8Array(n); cur = new Int8Array(n).fill(HIDDEN); from = new Int8Array(n).fill(NONE);
    seen = new Uint8Array(n); mats = new Float32Array(n * 16); cols = new Float32Array(n * 3);
    leafLoss = theme === 'autumn' ? new Float32Array(n) : null;
    const index = new Map();
    records.forEach((p, i) => {
      const K = KINDS[p.kind], kind = speciesAt(theme, p);
      const autumn = theme === 'autumn' && p.kind === 'tree';
      if (autumn) leafLoss[i] = autumnLeafLoss(p.x, p.z);
      const v = variantAt(theme, p, kind);
      const key = kind + ':' + v;
      let gi = index.get(key);
      if (gi === undefined) {
        gi = groups.length;
        index.set(key, gi);
        const rockLod = floraAtlas && kind === 'rock';
        const shrub = floraAtlas && !biome.coastal && (kind === 'hedge' || kind === 'bush');
        groups.push({ kind, variant: v, autumn, lods: rockLod ? 2 : K.lods, thresholds: rockLod ? ROCK_LOD : shrub ? shrubLod : null,
          small: !!K.small, cap: 0, meshes: [], fill: [] });
      }
      groups[gi].cap++;
      grp[i] = gi;
      cx[i] = p.x; cy[i] = p.y + K.cy * p.s; cz[i] = p.z; rad[i] = K.r * p.s;
      fixed[i] = Number.isInteger(p.lod) ? clampInt(p.lod, groups[gi].lods) : -1;
      _q.setFromEuler(_e.set(0, finite(p.ry), 0));
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(p.s, p.s, p.s)).toArray(mats, i * 16);
      _c.set(p.color ?? '#ffffff').toArray(cols, i * 3);
    });
    for (const g of groups) {
      for (let lod = 0; lod < g.lods; lod++) {
        const m = makeMesh(g, lod);
        g.meshes.push(m);
        g.fill.push(0);
        group.add(m);
      }
    }
    blobs = buildBlobs();
    group.add(blobs);
    dirty = true;
    fading = 0;
  }

  /** Экземпляр i в меш уровня lod группы g с растворением fade. */
  function write(g, lod, i, fade) {
    const m = g.meshes[lod], k = g.fill[lod]++, a = m.instanceMatrix.array, c = m.instanceColor.array;
    for (let j = 0; j < 16; j++) a[k * 16 + j] = mats[i * 16 + j];
    c[k * 3] = cols[i * 3]; c[k * 3 + 1] = cols[i * 3 + 1]; c[k * 3 + 2] = cols[i * 3 + 2];
    const attr = m.geometry.attributes.aFade, slot = k * attr.itemSize;
    attr.array[slot] = fade;
    if (g.autumn) attr.array[slot + 1] = leafLoss[i];
  }

  /** Сдвинулась ли камера, повернулась ли, сменилась ли проекция с прошлого пересчёта (_cam и _camQ — её поза). */
  function cameraMoved(camera) {
    _cam.setFromMatrixPosition(camera.matrixWorld);
    _camQ.setFromRotationMatrix(camera.matrixWorld);
    const pe = camera.projectionMatrix.elements;
    for (let k = 0; k < 16; k++) if (lastProj[k] !== pe[k]) return true;
    return lastPos.distanceTo(_cam) > MOVE || 2 * Math.acos(Math.min(1, Math.abs(lastQuat.dot(_camQ)))) > TURN;
  }

  /**
   * Пересчёт (спецификация §8.2, §8.3): сфера против пирамиды видимости, размер на экране, уровень с запасом.
   * Смена уровня у экземпляра, видимого и в прошлый раз, растворяется FADE_S секунд: старый уровень рисует пиксели
   * с шумом ≥ t (aFade = t), новый — с шумом < t (aFade = −t). Вход в кадр и выход из него — без растворения.
   * Возврат к прежнему уровню посреди растворения не перезапускает его: уровни меняются ролями, доля пикселей сохраняется.
   */
  function recompute(dt, camera) {
    const t0 = performance.now();
    lastPos.copy(_cam); lastQuat.copy(_camQ); lastProj.set(camera.projectionMatrix.elements);
    dirty = false;
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // кадр без новых объектов: счётчики уровней — в stats.lod, обход групп по номеру
    const fov = camera.isPerspectiveCamera ? camera.getEffectiveFOV() : 35, step = dt / FADE_S, lods = stats.lod;
    const projection = projectedPx(1, 1, fov);
    lods[0] = lods[1] = lods[2] = 0;
    for (let k = 0; k < groups.length; k++) groups[k].fill.fill(0);
    let visible = 0;
    fading = 0;
    for (let i = 0; i < n; i++) {
      const g = groups[grp[i]];
      _sphere.center.set(cx[i], cy[i], cz[i]);
      _sphere.radius = rad[i];
      const inView = _frustum.intersectsSphere(_sphere);
      let target = HIDDEN;
      if (inView) {
        const px = projection * rad[i] / Math.max(1e-3, _sphere.center.distanceTo(_cam));
        if (fixed[i] >= 0) target = fixed[i];
        else {
          const woodland = records[i].woodland, undergrowth = isUndergrowth(records[i]);
          const show = undergrowth ? smallVisible(px * (HIDE_PX / UNDERGROWTH_PX), cur[i] >= 0) : !g.small || smallVisible(px, cur[i] >= 0);
          if (show) {
            const detail = woodland && !undergrowth ? px * WOODLAND_DETAIL : px;
            if (woodland && (g.kind === 'tree' || g.kind === 'maple')) target = pickLod(px, cur[i], broadleafLod);
            else target = g.lods === 1 ? 0 : pickLod(detail, cur[i], g.thresholds || thr);
          }
        }
      }
      if (!inView || !seen[i]) from[i] = NONE;
      else if (target !== cur[i]) {
        // разворот незавершённого перехода: уровни меняются ролями, доля пикселей сохраняется
        if (from[i] !== NONE && target === from[i]) fadeT[i] = 1 - fadeT[i];
        else fadeT[i] = 0;
        from[i] = cur[i];
      }
      else if (from[i] !== NONE && (fadeT[i] += step) >= 1) from[i] = NONE;
      seen[i] = inView ? 1 : 0;
      cur[i] = target;
      const fades = from[i] !== NONE;
      if (target >= 0) { write(g, target, i, fades ? -Math.max(fadeT[i], 1e-4) : 0); visible++; lods[target]++; }
      if (from[i] >= 0) write(g, from[i], i, fadeT[i]);
      if (fades) fading++;
    }
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      for (let lod = 0; lod < g.meshes.length; lod++) flush(g.meshes[lod], g.fill[lod]);
    }
    syncUnderstoryBlobs();
    stats.cpuMs = performance.now() - t0;
    stats.visible = visible;
    stats.fading = fading;
    stats.updates++;
  }

  return {
    group, stats,
    get plants() { return records; },
    get config() { return config; },
    mesh: (name) => group.getObjectByName(name),
    geometryAt: (p, lod) => plantGeometryAt(theme, floraAtlas, p, lod),
    /** Добавляет растения (записи placement); неизвестные виды и записи без чисел пропускаются. */
    add(plants) {
      const list = (plants || []).filter(validPlant);
      if (!list.length) return;
      records.push(...list);
      rebuild();
    },
    /** Блок PRESETS[*].veg и { blobs }: пороги LOD, материал, пятна. */
    configure(veg = {}) {
      config = { ...VEG_DEFAULT, ...veg };
      thr = Array.isArray(config.lod) && config.lod.length === 2 ? config.lod : VEG_DEFAULT.lod;
      shrubLod[0]=1.60*thr[0]; shrubLod[1]=thr[1];
      broadleafLod[0] = thr[0] / WOODLAND_DETAIL;
      broadleafLod[1] = thr[1] / (config.lite ? LITE_BROADLEAF_FAR_DETAIL : BROADLEAF_FAR_DETAIL);
      for (const g of groups) for (const m of g.meshes) setMaterial(m);
      if (blobs) blobs.visible = !!config.blobs && blobs.count > 0;
      syncGrass();
      dirty = true;
    },
    /** Время ветра; с камерой — фокус травы и пересчёт растений, если он нужен. */
    update(dt, t, camera, windX = 0, windZ = 0) {
      dt = Math.min(Math.max(0, finite(dt)), 0.1);
      VEG_UNIFORMS.uTime.value = Number.isFinite(t) ? t : VEG_UNIFORMS.uTime.value + dt;
      VEG_UNIFORMS.uWind.value.set(windX, windZ);
      if (!camera) return;
      camera.updateMatrixWorld();
      if (grass && config.grass && (grass.mesh.visible || grass.culled)) grass.setFocus(grassFocus(camera, _focus), camera);
      if (n && (cameraMoved(camera) || dirty || fading > 0)) recompute(dt, camera);
    },
    /** Буферы экземпляров, обёртки, пятна и трава; кэш геометрий, атлас и материалы остаются. Повторный вызов безопасен. */
    dispose() {
      freeAll();
      if (grass) { grass.dispose(); grass = null; }
      records.length = 0;
      n = 0;
    },
  };
}
