// Трава high: один меш vegGrass из изогнутых листовых лент, GRASS.n² экземпляров без матриц.
// Слот задаёт gl_InstanceID, вершинный шейдер (material.js,
// VEG_GRASS) ставит пучок в ячейку мира вокруг точки фокуса, читает маску газонов и уменьшает пучки к краю круга.
import * as THREE from 'three';
import { noAlphaBefore, noAlphaAfter } from '../menu/menuFlora.js';
import { GRASS } from './kinds.js';
import { ATLAS_RECTS, saltgrassTexture } from './atlas.js';
import { vegetationMaterial, GRASS_UNIFORMS, VEG_UNIFORMS, GRASS_TILE, GRASS_DISTANCE } from './material.js';

const TILE_METRES = GRASS_TILE * GRASS.step, TILE_SLOTS = GRASS_TILE * GRASS_TILE;
const _o = new THREE.Vector3(), _d = new THREE.Vector3();

/** Маска газонов: fn(x, z) > 0 — трава; R8 res² на ±mask м, строка — z, столбец — x, выборка в центре текселя. */
export function grassMaskTexture(fn) {
  const { res, mask } = GRASS, k = (2 * mask) / res, data = new Uint8Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    data[j * res + i] = fn(-mask + (i + 0.5) * k, -mask + (j + 0.5) * k) > 0 ? 255 : 0;
  }
  // В трёх текселях от тротуаров и гряд высота постепенно возрастает. Нулевая маска остаётся нулевой.
  for (let j = 1; j < res; j++) for (let i = 1; i < res; i++) {
    const p = j*res+i; data[p] = Math.min(data[p], data[p-1]+77, data[p-res]+77);
  }
  for (let j = res-2; j >= 0; j--) for (let i = res-2; i >= 0; i--) {
    const p = j*res+i; data[p] = Math.min(data[p], data[p+1]+77, data[p+res]+77);
  }
  const t = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  t.name = 'vegGrassMask';
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Точка фокуса травы (спецификация §8.4): пересечение луча взгляда с землёй, не дальше GRASS.far по лучу; если луч
 * землю не пересекает — GRASS.ahead перед камерой по горизонтали. Привязана к шагу решётки. Матрица камеры — актуальная.
 */
export function grassFocus(camera, out = new THREE.Vector2()) {
  const { step, far, ahead } = GRASS;
  camera.getWorldPosition(_o);
  camera.getWorldDirection(_d);
  let x, z;
  if (_d.y < -1e-6 && _o.y > 0) {
    const t = Math.min(-_o.y / _d.y, far);
    x = _o.x + _d.x * t; z = _o.z + _d.z * t;
  } else {
    const h = Math.hypot(_d.x, _d.z) || 1;
    x = _o.x + (_d.x / h) * ahead; z = _o.z + (_d.z / h) * ahead;
  }
  return out.set(Math.round(x / step) * step, Math.round(z / step) * step);
}

/** Две изогнутые ленты по три треугольника. В части ячеек вторая сужается в отдельный гладкий лист;
 * в остальных несёт поперечную группу травинок. Отрицательный U сохраняет номер ленты. */
export function tuftGeometry(coastal = false) {
  const [u0,v0,u1,v1] = coastal ? [0,0,1,1] : ATLAS_RECTS.grass;
  const h = coastal ? 0.19 : GRASS.h, w = coastal ? 0.71 : 0.64, bend = coastal ? 0.15 : 0.084;
  const pos = [], uv = [], col = [], nor = [], flex = [];
  function vertex(x,t,z,u,v,shade,normalX,normalZ,secondary=false) {
    pos.push(x,h*t,z);
    const atlasU = u0+(u1-u0)*u;
    uv.push(secondary ? -2-atlasU : atlasU,v0+(v1-v0)*v);
    nor.push(normalX,Math.sqrt(1-normalX*normalX-normalZ*normalZ),normalZ);
    col.push(shade*0.95,shade,shade*(0.78+0.16*t));
    flex.push((coastal ? 0.62 : 1)*t*t);
  }
  vertex(-w*0.5,0,-0.018,0,0,0.52,0.08,0.14);
  vertex( w*0.5,0, 0.012,1,0,0.55,-0.07,0.16);
  vertex(-w*0.43,0.54,bend*0.31,0.05,0.54,0.80,0.11,0.21);
  vertex( w*0.43,0.54,bend*0.43,0.95,0.54,0.91,-0.06,0.16);
  vertex(w*0.10,1,bend,0.56,1,1.0,-0.02,0.25);
  vertex(0.018,0,-w*0.45,0,0,0.53,0.13,-0.16,true);
  vertex(0.018,0,w*0.45,1,0,0.55,-0.08,0.20,true);
  vertex(0.018-bend*0.41,0.51,-w*0.43,0.05,0.54,0.85,-0.21,-0.12,true);
  vertex(0.018-bend*0.32,0.53,w*0.43,0.95,0.54,0.91,-0.18,0.16,true);
  vertex(0.018-bend*1.23,0.91,w*0.065,0.56,1,0.99,-0.24,0.20,true);
  const n = flex.length, g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  g.setAttribute('aFlex',new THREE.Float32BufferAttribute(flex,1));
  g.setAttribute('aTint',new THREE.Float32BufferAttribute(new Float32Array(n).fill(1),1));
  g.setAttribute('aFade',new THREE.Float32BufferAttribute(new Float32Array(n),1));
  g.setIndex([0,1,3,0,3,2,2,3,4,5,6,8,5,8,7,7,8,9]); g.instanceCount = GRASS.n*GRASS.n;
  // Начало блока меняется раз в 100 экземпляров. До первого обновления камеры доступны все исходные ячейки.
  const offsets = new Int16Array(2*g.instanceCount/TILE_SLOTS);
  let at = 0;
  for (let z = -GRASS.n/2; z < GRASS.n/2; z += GRASS_TILE) for (let x = -GRASS.n/2; x < GRASS.n/2; x += GRASS_TILE) {
    offsets[at++] = x;
    offsets[at++] = z;
  }
  g.setAttribute('aGrassTile', new THREE.InstancedBufferAttribute(offsets, 2, false, TILE_SLOTS).setUsage(THREE.DynamicDrawUsage));
  g.name = 'vegTuft'; return g;
}

// Суммы по квадратам 8×8 текселей маски дают консервативный ответ за четыре чтения (2,2 КБ на поле).
function lawnCoverage(mask) {
  const {data, width, height} = mask.image;
  const shift = 3, block = 1 << shift, cols = Math.ceil(width/block), rows = Math.ceil(height/block), pitch = cols+1;
  const sums = new Uint16Array(pitch*(rows+1));
  for (let j=0; j<height; j++) for (let i=0; i<width; i++) {
    if (data[j*width+i]) sums[(1+(j>>shift))*pitch+1+(i>>shift)] = 1;
  }
  for (let j=1; j<=rows; j++) for (let i=1; i<=cols; i++) {
    const at = j*pitch+i;
    sums[at] += sums[at-1]+sums[at-pitch]-sums[at-pitch-1];
  }
  // Полтекселя с каждой стороны учитывают линейную фильтрацию у границ газона.
  const edge = GRASS.mask, sx = width/(2*edge), sz = height/(2*edge);
  return (x,z) => {
    const left = Math.max(0,Math.floor(((x+edge)*sx-0.5)/block));
    const top = Math.max(0,Math.floor(((z+edge)*sz-0.5)/block));
    const right = Math.min(cols,1+Math.floor(((x+TILE_METRES+edge)*sx+0.5)/block));
    const bottom = Math.min(rows,1+Math.floor(((z+TILE_METRES+edge)*sz+0.5)/block));
    return right>left && bottom>top && sums[bottom*pitch+right]-sums[top*pitch+right]-sums[bottom*pitch+left]+sums[top*pitch+left]>0;
  };
}

function grassVisibility(geometry, mask) {
  const tile = geometry.attributes.aGrassTile, offsets = tile.array, hasLawn = lawnCoverage(mask);
  const planes = new THREE.Frustum(), vp = new THREE.Matrix4(), prev = new THREE.Matrix4(), box = new THREE.Box3();
  const center = new THREE.Vector2(), eye = new THREE.Vector3();
  let cached = false, lastPad = -1;
  return (focus,camera) => {
    if (camera) {
      eye.setFromMatrixPosition(camera.matrixWorld);
      if (Math.abs(eye.y) >= GRASS_DISTANCE) {
        geometry.instanceCount = 0; cached = false; return;
      }
    }
    // 0,53 м покрывают ширину и наклон ленты. Изгиб ветра ограничен 0,17 м на единицу его амплитуды.
    const pad = 0.53 + Math.ceil(VEG_UNIFORMS.uWind.value.length()*0.17);
    if (camera) {
      vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      if (cached && center.equals(focus) && vp.equals(prev) && lastPad===pad) return;
      prev.copy(vp); planes.setFromProjectionMatrix(vp);
    }
    cached = !!camera; lastPad = pad; center.copy(focus);
    const ox = Math.round(focus.x/GRASS.step)*GRASS.step, oz = Math.round(focus.y/GRASS.step)*GRASS.step;
    let count = 0, changed = false;
    for (let iz=-GRASS.n/2; iz<GRASS.n/2; iz+=GRASS_TILE) for (let ix=-GRASS.n/2; ix<GRASS.n/2; ix+=GRASS_TILE) {
      if (camera) {
        const x = ox+ix*GRASS.step, z = oz+iz*GRASS.step;
        const dx = Math.max(x-eye.x,eye.x-x-TILE_METRES,0), dz = Math.max(z-eye.z,eye.z-z-TILE_METRES,0);
        if (dx*dx+dz*dz+eye.y*eye.y>=GRASS_DISTANCE*GRASS_DISTANCE || !hasLawn(x,z)) continue;
        const fx = Math.max(x-focus.x,focus.x-x-TILE_METRES,0), fz = Math.max(z-focus.y,focus.y-z-TILE_METRES,0);
        if (fx*fx+fz*fz>=GRASS.r*GRASS.r) continue;
        box.min.set(x-pad,-0.02,z-pad); box.max.set(x+TILE_METRES+pad,0.75,z+TILE_METRES+pad);
        if (!planes.intersectsBox(box)) continue;
      }
      if (offsets[count]!==ix || offsets[count+1]!==iz) {
        offsets[count] = ix; offsets[count+1] = iz; changed = true;
      }
      count += 2;
    }
    geometry.instanceCount = count/2*TILE_SLOTS;
    if (changed) tile.needsUpdate = true;
  };
}

/**
 * Трава поля: palette — цвета пучков темы, mask — текстура grassMaskTexture (трава ею владеет). Перед кадром меш
 * выставляет общие GRASS_UNIFORMS своими маской, фокусом и палитрой. dispose освобождает геометрию и маску.
 */
export function createGrass({ palette, mask, coastal = false, flowerRate = coastal ? 0 : GRASS.flowers }) {
  const geometry = tuftGeometry(coastal), focus = new THREE.Vector2(), grassMap = coastal ? saltgrassTexture() : null;
  const updateVisibility = grassVisibility(geometry,mask);
  const material = (lite, wind) => vegetationMaterial({ lite, wind, grass: true, grassMap });
  const mesh = new THREE.Mesh(geometry, material(false, true));
  mesh.name = 'vegGrass';
  mesh.frustumCulled = mesh.castShadow = false;
  mesh.receiveShadow = true;
  const colors = GRASS_UNIFORMS.uGrassPalette.value.map((_, i) => new THREE.Color(palette[i % palette.length]));
  mesh.onBeforeRender = (renderer) => {
    if (renderer && mesh.material.alphaToCoverage) noAlphaBefore(renderer);
    GRASS_UNIFORMS.uGrassMask.value = mask;
    GRASS_UNIFORMS.uGrassFlowerRate.value = flowerRate;
    GRASS_UNIFORMS.uGrassFocus.value.copy(focus);
    const slots = GRASS_UNIFORMS.uGrassPalette.value;
    for (let i = 0; i < slots.length; i++) slots[i].copy(colors[i]);
  };
  mesh.onAfterRender = (renderer) => {
    if (renderer && mesh.material.alphaToCoverage) noAlphaAfter(renderer);
  };
  return {
    mesh, mask, focus,
    configure(lite, wind) { mesh.material = material(lite, wind); },
    get culled() { return geometry.instanceCount === 0; },
    setFocus(v,camera) {
      focus.copy(v);
      updateVisibility(focus,camera);
      mesh.visible = geometry.instanceCount > 0;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      mask.dispose();
      if (GRASS_UNIFORMS.uGrassMask.value === mask) GRASS_UNIFORMS.uGrassMask.value = null;
    },
  };
}
