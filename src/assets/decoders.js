// Декодирование ассетов в объекты three: текстуры PBR, картинки, glTF, двоичные данные.
import * as THREE from 'three';
import { ROLES } from './manifest.js';
import { LoadError } from './loader.js';
import { registerTexture } from '../render/textures.js';

const LINEAR_ROLES = new Set(['normal', 'roughness']);
let forceImageElement = false;
let gltfLoader = null;

/** Только для тестов: декодировать через <img> вместо createImageBitmap. */
export function _forceImageElement(on) { forceImageElement = on; }

/** flip — перевернуть по вертикали (WebP-текстуры игры); glTF-картинки не переворачиваются (flipY=false в GLTFLoader). */
async function decodeBlob(blob, flip) {
  if (!forceImageElement && typeof createImageBitmap === 'function') {
    try {
      const opts = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
      if (flip) opts.imageOrientation = 'flipY';
      return { image: await createImageBitmap(blob, opts), flipY: false };
    } catch { /* createImageBitmap упал — пробуем <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { image, flipY: flip };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const decodeImage = (buf) => decodeBlob(new Blob([buf], { type: 'image/webp' }), true);

function makeTexture(name, role, { image, flipY }) {
  const t = new THREE.Texture(image);
  t.name = name;
  t.flipY = flipY;
  t.colorSpace = LINEAR_ROLES.has(role) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return registerTexture(t);
}

async function texture(id, role, buf) {
  let decoded;
  try { decoded = await decodeImage(buf); } catch (e) { throw new LoadError('decode', id, { cause: e }); }
  return makeTexture(`${id}.${role}`, role, decoded);
}

function getGltfLoader() {
  gltfLoader ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]);
    await MeshoptDecoder.ready;
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(embeddedImages);
  })().catch((e) => { gltfLoader = null; throw e; });
  return gltfLoader;
}

function releaseTexture(t) {
  t.dispose();
  if (typeof t.image?.close === 'function') t.image.close();
}

/**
 * Картинки из bufferView — без blob URL (через ImageBitmap), а запасной <img> освобождает URL и при сбое.
 * GLTFLoader в loadImageSource создаёт blob URL и при сбое загрузки его не освобождает.
 * Кэш и клоны — как в оригинале: первый вызов получает текстуру, повторные — клон.
 */
function embeddedImages(parser) {
  const original = parser.loadImageSource;
  parser.loadImageSource = function (sourceIndex, loader) {
    const def = this.json.images?.[sourceIndex];
    if (def?.bufferView === undefined) return original.call(this, sourceIndex, loader);
    if (this.sourceCache[sourceIndex] !== undefined) return this.sourceCache[sourceIndex].then((t) => t.clone());
    const promise = this.getDependency('bufferView', def.bufferView)
      .then((view) => decodeBlob(new Blob([view], { type: def.mimeType }), false))
      .then(({ image }) => {
        const t = new THREE.Texture(image);
        t.needsUpdate = true;
        t.userData.mimeType = def.mimeType;
        return t;
      });
    this.sourceCache[sourceIndex] = promise;
    return promise;
  };
  return { name: 'TOWER_embedded_images' };
}

/**
 * Освобождает всё, что разобрал GLTFLoader: геометрии и материалы всех сцен, все декодированные текстуры
 * (в том числе не используемые материалами) и их изображения — каждый объект один раз.
 */
async function disposeGltf(gltf) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const scene of gltf.scenes ?? [gltf.scene]) {
    scene.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      for (const m of [o.material].flat()) if (m) materials.add(m);
    });
  }
  for (const m of materials) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
  // getDependency кэширует результат парсера: повторный вызов отдаёт уже декодированные текстуры
  const count = (gltf.parser.json.textures ?? []).length;
  const settled = await Promise.allSettled(Array.from({ length: count }, (_, i) => gltf.parser.getDependency('texture', i)));
  for (const s of settled) if (s.status === 'fulfilled' && s.value) textures.add(s.value);
  const images = new Set();
  for (const t of textures) {
    t.dispose();
    if (typeof t.image?.close === 'function') images.add(t.image);
  }
  for (const image of images) image.close();
  for (const m of materials) m.dispose();
  for (const g of geometries) g.dispose();
}

async function parseGltf(loader, id, buf) {
  let gltf;
  try { gltf = await loader.parseAsync(buf, ''); } catch (e) { throw new LoadError('decode', id, { cause: e }); }
  await assertGltfTexturesDecoded(id, gltf);
  return gltf;
}

/** GLTFLoader превращает сбой загрузки текстуры в null, а parseAsync всё равно успешен. */
async function assertGltfTexturesDecoded(id, gltf) {
  const count = (gltf.parser.json.textures ?? []).length;
  // getDependency может бросить синхронно — превращаем это в отказ, чтобы allSettled дождался остальных
  const settled = await Promise.allSettled(Array.from({ length: count }, (_, i) => Promise.resolve().then(() => gltf.parser.getDependency('texture', i))));
  let cause = null;
  settled.forEach((s, i) => {
    if (cause) return;
    if (s.status === 'rejected') cause = s.reason;
    else if (!s.value) cause = new Error(`glTF texture ${i} failed to decode`);
  });
  if (!cause) return;
  const closable = new Set(); // одна картинка может быть общей для нескольких текстур
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !s.value) continue;
    s.value.dispose();
    if (typeof s.value.image?.close === 'function') closable.add(s.value.image);
  }
  for (const image of closable) image.close();
  throw new LoadError('decode', id, { cause });
}

export async function decodeAsset(id, entry, buffers) {
  switch (entry.type) {
    case 'pbr': {
      const roles = ROLES.pbr;
      const settled = await Promise.allSettled(roles.map((role) => texture(id, role, buffers[role])));
      const failed = settled.find((s) => s.status === 'rejected');
      if (failed) {
        for (const s of settled) if (s.status === 'fulfilled') releaseTexture(s.value);
        throw failed.reason;
      }
      return Object.fromEntries(roles.map((role, i) => [role, settled[i].value]));
    }
    case 'texture':
      return texture(id, 'image', buffers.image);
    case 'gltf': {
      const loader = await getGltfLoader();
      const gltf = await parseGltf(loader, id, buffers.model);
      if (buffers.far) {
        try { gltf.far = await parseGltf(loader, id, buffers.far); } catch (e) { await disposeGltf(gltf).catch(() => {}); throw e; } // сбой очистки не маскирует причину
      }
      return gltf;
    }
    case 'binary':
      if (id === 'flora.tree-models' || id === 'harbor.palm-models' || id === 'autumn.maple-models') {
        const { decodeVegetationModels } = await import('./vegetationModels.js');
        return decodeVegetationModels(buffers.data);
      }
      return buffers.data;
    default:
      throw new LoadError('decode', id);
  }
}
