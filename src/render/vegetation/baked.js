// Штатный переход сцены сначала завершает загрузку flora и её тематического пакета.
// При отдельном вызове фабрики без хранилища доступен тот же процедурный источник.
import * as THREE from 'three';
import { assets } from '../../assets/index.js';

export function bakedModel(asset, name) {
  return assets.tryGet(asset)?.get(name);
}

export function bakedTexture(id, name, { repeat = false, linear = false, anisotropy = 1 } = {}) {
  const t = assets.tryGet(id);
  if (!t?.image?.width || !t.image.height) return null;
  const space = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (t.name !== name || t.colorSpace !== space || t.wrapS !== wrap || t.wrapT !== wrap) {
    t.name = name;
    t.colorSpace = space;
    t.wrapS = t.wrapT = wrap;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
  return t;
}
