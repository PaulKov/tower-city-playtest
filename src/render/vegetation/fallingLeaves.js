// Лист отрывается от живой кисти конкретного дерева. Та же осенняя стадия
// определяет положение листовой пластинки на ветви и частоту отрыва.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { autumnLeafLoss } from '../../core/autumnFoliage.js';
import { autumnLeafPosition } from './maple.js';
import { dryLeafProfile, litterAtlas } from './leafLitter.js';

const CAP = 24, REACH = 25, TAU = 2 * Math.PI;
const clamp = THREE.MathUtils.clamp;
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), anchor = new THREE.Vector3();
const pos = new THREE.Vector3(), size = new THREE.Vector3(), rotation = new THREE.Euler(), q = new THREE.Quaternion(), matrix = new THREE.Matrix4();

function leafMesh() {
  const atlas = litterAtlas(), vCell = atlas.image.width / (4 * atlas.image.height);
  const g = new THREE.PlaneGeometry(1, 1, 6, 5).rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, 0.20 * dryLeafProfile(x+0.5, z+0.5, 1));
    uv.setXY(i, uv.getX(i) / 4, 1 - (1 - uv.getY(i)) * vCell);
  }
  g.computeVertexNormals();
  const cells = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aLeafCell', cells);
  const material = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide, alphaTest: 0.44 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float aLeafCell;\n' + shader.vertexShader.replace('#include <uv_vertex>',
      `#include <uv_vertex>
       vMapUv.x += mod(aLeafCell,4.0) * 0.25;
       vMapUv.y -= floor(aLeafCell/4.0) * ${vCell.toFixed(8)};`);
    // При перевороте видна выцветшая изнанка с тем же жилкованием.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      if (!gl_FrontFacing) {
        float luma = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722));
        diffuseColor.rgb = 0.91*diffuseColor.rgb + vec3(0.14,0.17,0.11)*luma;
      }`);
  };
  material.customProgramCacheKey = () => 'autumn-falling-leaves';
  const mesh = new THREE.InstancedMesh(g, material, CAP);
  mesh.name = 'autumnFallingLeaves';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = mesh.frustumCulled = mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

// Только наружные грозди с подвижными листовыми кончиками. У запасной модели
// без aTip берутся треугольники её текстурированных листьев. Список общий для экземпляров.
function emissionFaces(g) {
  const { aTint, aTip, uv } = g.attributes, faces = [];
  for (let i = 0; i < g.index.count; i += 3) {
    const j = g.index.getX(i), k = g.index.getX(i + 1), l = g.index.getX(i + 2);
    if (aTint.getX(j) < 0.5 || uv.getX(j) < 0) continue;
    if (aTip && Math.max(aTip.getX(j), aTip.getX(k), aTip.getX(l)) <= 0) continue;
    faces.push(i);
  }
  return faces;
}

function onGround(source, site, x, z) {
  const park = source.plant.litterPark;
  if (park) {
    const dx = x - park.x, dz = z - park.z;
    return Math.max(Math.abs(dx), Math.abs(dz)) <= 2.96 && dx * dx + dz * dz > 0.58;
  }
  return site.clear(x, z, 0);
}

export function createFallingLeaves(plants, site, geometryAt, seed = 10741) {
  const mesh = leafMesh(), rng = createRng(seed), sources = [], cache = new Map();
  for (const p of plants) {
    if (p.kind !== 'tree' || p.lod === 2) continue;
    const g = geometryAt(p, 0);
    if (!cache.has(g)) cache.set(g, emissionFaces(g));
    const faces = cache.get(g);
    if (!faces.length) continue;
    sources.push({ plant: p, g, faces, loss: autumnLeafLoss(p.x, p.z),
      co: Math.cos(p.ry || 0), si: Math.sin(p.ry || 0), weight: 0 });
  }
  const candidates = new Int32Array(sources.length);
  const leaves = Array.from({ length: CAP }, () => ({ source: null }));
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), lastMatrix = new THREE.Matrix4();
  const sphere = new THREE.Sphere(), eye = new THREE.Vector3(), lastEye = new THREE.Vector3(Infinity, Infinity, Infinity);
  const facing = new THREE.Vector3(), lastFacing = new THREE.Vector3();
  let n = 0, total = 0, wait = 0.16, active = false;

  function findSources(camera) {
    lastEye.copy(eye);
    lastFacing.copy(facing);
    lastMatrix.copy(camera.projectionMatrix);
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    n = 0;
    total = 0;
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i], p = source.plant;
      sphere.center.set(p.x, p.y + 2.8 * p.s, p.z);
      const d = eye.distanceTo(sphere.center);
      if (d >= REACH) continue;
      sphere.radius = 2.05 * p.s;
      if (!frustum.intersectsSphere(sphere)) continue;
      // Слабое опадание начинается с первых пожелтевших листьев, усиливается
      // на поредевших ветвях и затихает, когда листьев на них почти не осталось.
      const stage = source.loss, distance = 1 - THREE.MathUtils.smoothstep(d, 13, REACH);
      source.weight = distance * (0.14 + 1.35 * stage) * (1 - 0.79 * stage ** 4);
      total += source.weight;
      candidates[n++] = i;
    }
  }

  function detach(leaf) {
    let choice = rng.next() * total, index = 0;
    while (index + 1 < n && (choice -= sources[candidates[index]].weight) > 0) index++;
    const source = sources[candidates[index]], p = source.plant, g = source.g;
    for (let attempt = 0; attempt < 8; attempt++) {
      const k = source.faces[rng.int(0, source.faces.length - 1)];
      autumnLeafPosition(g, g.index.getX(k), source.loss, a);
      autumnLeafPosition(g, g.index.getX(k+1), source.loss, b);
      autumnLeafPosition(g, g.index.getX(k+2), source.loss, c);
      anchor.copy(a).add(b).add(c).multiplyScalar(1/3);
      if (b.sub(a).cross(c.sub(a)).lengthSq() < 0.000002) continue;
      leaf.x = p.x + p.s * (source.co * anchor.x + source.si * anchor.z);
      leaf.z = p.z + p.s * (source.co * anchor.z - source.si * anchor.x);
      if (!onGround(source, site, leaf.x, leaf.z)) continue;
      leaf.y = p.y + p.s * anchor.y;
      leaf.source = source;
      leaf.vx = leaf.vz = leaf.age = 0;
      leaf.speed = rng.uniform(0.54, 0.94);
      leaf.phase = rng.uniform(0, TAU);
      leaf.spin = rng.uniform(1.8, 3.7) * (rng.next() < 0.5 ? -1 : 1);
      leaf.width = rng.uniform(0.14, 0.20);
      leaf.cell = source.g.userData.kind === 'maple' || source.g.name.startsWith('maple:')
        ? rng.int(0, 3) : rng.int(4, 7);
      return;
    }
  }

  function update(dt, camera, windX = 0, windZ = 0) {
    if (!camera) return;
    eye.setFromMatrixPosition(camera.matrixWorld);
    facing.setFromMatrixColumn(camera.matrixWorld, 2);
    if (eye.distanceToSquared(lastEye) > 0.09 || facing.dot(lastFacing) < 0.999 ||
        !lastMatrix.equals(camera.projectionMatrix)) findSources(camera);
    if (!n) {
      if (active) for (let i = 0; i < CAP; i++) leaves[i].source = null;
      active = false;
      mesh.visible = false;
      mesh.count = 0;
      wait = 0.16;
      return;
    }
    const wind = Math.min(2.4, Math.hypot(windX, windZ)), gust = Math.min(1.45, wind);
    wait -= dt * Math.min(2.3, total * (0.51 + gust * 0.63));
    if (wait <= 0) {
      for (let i = 0; i < CAP; i++) if (!leaves[i].source) { detach(leaves[i]); break; }
      wait = rng.uniform(0.62, 1.42);
    }
    let count = 0;
    active = false;
    const cells = mesh.geometry.attributes.aLeafCell;
    for (let i = 0; i < CAP; i++) {
      const leaf = leaves[i];
      if (!leaf.source) continue;
      const p = leaf.source.plant;
      leaf.age += dt;
      const phase = leaf.phase + leaf.age * (2.3 + leaf.speed), flutter = Math.sin(phase);
      const response = Math.min(1, dt * 1.55);
      leaf.vx += (clamp(windX, -2, 2) * 0.69 + 0.32 * Math.sin(phase + leaf.phase) - leaf.vx) * response;
      leaf.vz += (clamp(windZ, -2, 2) * 0.69 + 0.27 * Math.cos(phase * 0.86) - leaf.vz) * response;
      leaf.x += leaf.vx * dt;
      leaf.z += leaf.vz * dt;
      leaf.y -= dt * leaf.speed * (0.87 + 0.18 * flutter);
      if (leaf.y <= p.y + 0.018 || !onGround(leaf.source, site, leaf.x, leaf.z)) { leaf.source = null; continue; }
      active = true;
      pos.set(leaf.x, leaf.y, leaf.z);
      if (pos.distanceToSquared(eye) > REACH * REACH || !frustum.containsPoint(pos)) continue;
      const fade = Math.min(1, (leaf.y - p.y) * 5, leaf.age * 7, Math.max(0, (pos.distanceTo(eye) - 0.7) * 1.8));
      const span = leaf.width * fade;
      rotation.set(0.30 + 0.53 * Math.sin(phase * 1.09), leaf.phase + 0.45 * leaf.age,
        leaf.spin * leaf.age + 0.62 * flutter, 'YXZ');
      q.setFromEuler(rotation);
      size.set(span, span, span * 1.09);
      mesh.setMatrixAt(count, matrix.compose(pos, q, size));
      cells.setX(count++, leaf.cell);
    }
    mesh.count = count;
    mesh.visible = count > 0;
    if (count) { mesh.instanceMatrix.needsUpdate = true; cells.needsUpdate = true; }
  }
  return { mesh, update, dispose() {
    mesh.removeFromParent();
    mesh.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  } };
}
