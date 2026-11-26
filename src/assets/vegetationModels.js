// Архив двух неизменяемых моделей. У всех атрибутов те же Float32/Uint16 и
// индексы, что в авторской фабрике. Массивы смотрят в исходный буфер файла; распаковки в кадре нет.
import * as THREE from 'three';
import { VEG_GEN } from '../render/vegetation/atlas.js';

const ARRAY_TYPE = { Float32Array, Uint16Array, Uint32Array };
export function decodeVegetationModels(bytes) {
  const start = performance.now();
  const text = new TextDecoder(), view = new DataView(bytes);
  if (text.decode(new Uint8Array(bytes, 0, 8)) !== 'TWRFLR1\n') throw new Error('Неверный заголовок архива деревьев');
  const length = view.getUint32(8, true), body = 12 + length;
  const entries = JSON.parse(text.decode(new Uint8Array(bytes, 12, length))), models = new Map();
  for (const e of entries) {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(e.attributes)) {
      const array = new ARRAY_TYPE[a.type](bytes, body + a.offset, a.length);
      const attribute = new THREE.BufferAttribute(array, a.size);
      if (name === 'index') g.setIndex(attribute);
      else g.setAttribute(name, attribute);
    }
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(...e.center), e.radius);
    g.name = e.name; g.userData = e.meta;
    models.set(g.name, g);
  }
  // Включаем все операции от разбора заголовка до готовой геометрии, до входа в сцену.
  VEG_GEN.ms += performance.now() - start;
  return models;
}
