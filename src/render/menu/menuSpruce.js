// Полные ели видны при подходе к их основанию. В общей панораме все экземпляры
// остаются в существующем поле импостеров, дополнительного вызова отрисовки нет.
import * as THREE from 'three';
import { spruceGeometry } from '../vegetation/spruce.js';
import { vegetationMaterial } from '../vegetation/material.js';

export function menuSpruceDetail(items, sprites, group, terrainSurface) {
  const slots = [], up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), scale = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.sprite.startsWith('conifer')) continue;
    const h = it.h / 1.04, y = it.y + 0.05 * h;
    p.set(it.x, y, it.z); scale.set(it.w / 1.30, h / 3.85, it.w / 1.30);
    q.setFromAxisAngle(up, (it.x + 2.1 * it.z) % 6.28);
    const matrix = new THREE.Matrix4().compose(p, q, scale), center = p.clone();
    if (terrainSurface) {
      // Сохраняем вертикаль ствола; его нижнее сечение ложится на касательную
      // к настоящим треугольникам холма. Подкроновые лапы повторяют слабый уклон.
      const e = 0.24 * it.w;
      const sx = (terrainSurface(it.x+e,it.z) - terrainSurface(it.x-e,it.z)) / (2*e);
      const sz = (terrainSurface(it.x,it.z+e) - terrainSurface(it.x,it.z-e)) / (2*e);
      const m = matrix.elements;
      m[1] = sx*m[0] + sz*m[2];
      m[9] = sx*m[8] + sz*m[10];
      m[13] = center.y = terrainSurface(it.x, it.z);
    }
    center.y += h * 0.37;
    slots.push({ i, w: it.w, h, matrix, color: new THREE.Color('#48855f'), sphere: new THREE.Sphere(center, h * 0.7), share: 0 });
  }
  if (!slots.length) return null;
  const src = spruceGeometry(0, 0), g = new THREE.BufferGeometry();
  g.attributes = { ...src.attributes };
  g.setIndex(src.index);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(slots.length), 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aFade', fade);
  const m = new THREE.InstancedMesh(g, null, slots.length);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(slots.length * 3), 3).setUsage(THREE.DynamicDrawUsage);
  m.name = 'menu:spruce:near'; m.count = 0; m.visible = m.frustumCulled = false; m.receiveShadow = true;
  m.onBeforeRender = sprites.onBeforeRender; m.onAfterRender = sprites.onAfterRender;
  group.add(m);
  const half = sprites.geometry.attributes.aHalf; half.setUsage(THREE.DynamicDrawUsage);
  return {
    configure(config, atlas) {
      if (atlas) m.material = vegetationMaterial({ ...config, floraAtlas: atlas, spruce: true });
    },
    update(eye, frustum) {
      let dirty = false;
      for (const s of slots) {
        const d = s.sphere.center.distanceTo(eye) / s.h;
        const share = s.i < sprites.count && d < 2.7 && frustum.intersectsSphere(s.sphere) ? 1 - THREE.MathUtils.smoothstep(d, 1.9, 2.7) : 0;
        if (share === s.share) continue;
        s.share = share; dirty = true;
        half.setX(s.i, share === 1 ? 0 : s.w);
        half.setZ(s.i, share > 0 && share < 1 ? -1 - share : 0.1);
      }
      if (!dirty) return;
      let n = 0;
      for (const s of slots) if (s.share > 0) {
        m.setMatrixAt(n, s.matrix); m.setColorAt(n, s.color);
        fade.setX(n++, s.share === 1 ? 0 : -s.share);
      }
      half.needsUpdate = true; m.count = n; m.visible = n > 0;
      fade.needsUpdate = m.instanceMatrix.needsUpdate = m.instanceColor.needsUpdate = m.visible;
    },
    dispose() { g.dispose(); m.dispose(); m.removeFromParent(); },
  };
}
