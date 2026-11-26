// Процедурные canvas-текстуры с фиксированным зерном — маски в линейном пространстве: облака, искры, снежинки,
// мягкая тень. Стены домов — массивы слоёв (houses/walls.js), окна — геометрия этажей.
import * as THREE from 'three';
import { createRng, hashSeed } from '../core/rng.js';

export const TEXTURE_NAMES = ['cloudNoise', 'sparkle', 'snowflake', 'softShadow', 'officeInteriors', 'facadeRooms'];
export const MASK_TEXTURES = ['cloudNoise', 'sparkle', 'snowflake', 'softShadow', 'officeInteriors'];
const SPRITES = ['sparkle', 'snowflake', 'softShadow'];

const cache = new Map();
const external = new Set();
let anisotropy = 1;

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Периодический value-noise: значения 0..1, период = size пикселей. */
function noiseField(rng, size, baseCells, octaves) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
    const k = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells, c1 = (x0 + 1) % cells;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

const GEN = {
  /** 12 оконных проёмов: жилые комнаты, витрины и кабинеты. По четыре композиции на назначение здания. */
  facadeRooms() {
    const c = canvas(512), x = c.getContext('2d');
    const tones = ['#caba9b', '#afb6aa', '#b4bdc1', '#d3b297'];
    for (let tile = 0; tile < 12; tile++) {
      const k = tile % 4, floor = Math.floor(tile / 4), left = k % 2 === 0;
      x.save(); x.scale(2, 2); x.translate(k * 64, floor * 64);
      x.beginPath(); x.rect(0, 0, 64, 64); x.clip();
      const light = x.createRadialGradient(left ? 15 : 48, 15, 3, left ? 18 : 45, 21, 55);
      light.addColorStop(0, tones[k]); light.addColorStop(0.53, '#819093'); light.addColorStop(1, '#46565c');
      x.fillStyle = light; x.fillRect(0, 0, 64, 64);
      x.fillStyle = '#59676b'; x.beginPath(); x.moveTo(left ? 64 : 0, 0); x.lineTo(left ? 54 : 10, 10);
      x.lineTo(left ? 54 : 10, 54); x.lineTo(left ? 64 : 0, 64); x.fill();
      x.fillStyle = '#4e584e'; x.fillRect(0, 55, 64, 9);
      if (floor === 0) {
        const curtain = left ? 1 : 44, reach = 12 + k * 2;
        const fabric = x.createLinearGradient(curtain, 0, curtain + reach, 0);
        fabric.addColorStop(0, '#b1a796'); fabric.addColorStop(0.33, '#dfd4ba'); fabric.addColorStop(0.55, '#a0998b'); fabric.addColorStop(1, '#d0c4b1');
        x.fillStyle = fabric; x.fillRect(curtain, 0, reach, 53 - k);
        if (k === 0) {
          x.fillStyle = '#78634f'; x.fillRect(39, 39, 1.5, 10);
          x.fillStyle = '#ebd8a4'; x.beginPath(); x.moveTo(36, 33); x.lineTo(43, 33); x.lineTo(46, 40); x.lineTo(33, 40); x.fill();
          x.fillStyle = '#59656a'; x.fillRect(30, 48, 20, 2.5); x.fillRect(32, 50, 2, 7);
        } else if (k === 1) {
          x.fillStyle = '#675d50'; x.fillRect(10, 23, 20, 31);
          for (const y of [29, 37, 45]) for (let j = 0; j < 4; j++) {
            x.fillStyle = ['#9e9a81', '#917c69', '#687d75', '#b7a388'][j]; x.fillRect(12 + 4 * j, y - j % 2, 2.8, 5.2);
          }
        } else if (k === 2) {
          x.fillStyle = '#8e6c55'; x.fillRect(32, 44, 8, 9); x.fillStyle = '#576e5b';
          x.fillRect(35, 29, 1.5, 16);
          for (const [lx, ly, angle] of [[32, 38, 0.6], [39, 34, -0.6], [32, 30, 0.7], [36, 26, -1.25]]) {
            x.beginPath(); x.ellipse(lx, ly, 6.5, 2.1, angle, 0, 2 * Math.PI); x.fill();
          }
        } else {
          x.fillStyle = '#a9a08c'; x.fillRect(15, 18, 15, 12); x.fillStyle = '#738883'; x.fillRect(16, 19, 13, 10);
          x.fillStyle = '#88766a'; x.fillRect(9, 42, 28, 8); x.fillRect(7, 40, 4, 13); x.fillRect(36, 40, 4, 13);
          x.fillStyle = '#9c8d7c'; x.fillRect(11, 47, 24, 5);
        }
      } else if (floor === 1) {
        const shelf = left ? 27 : 8;
        for (const y of k === 1 ? [39] : k === 3 ? [] : [27, 40]) {
          x.fillStyle = '#626560'; x.fillRect(shelf, y, 28, 1.6);
          for (let j = 0; j < 5; j++) {
            const h = 3 + (j * 5 + k) % 6;
            x.fillStyle = ['#727a70', '#ada183', '#8b6e60'][(j + k) % 3];
            if (k === 1) { x.beginPath(); x.ellipse(shelf + j * 5 + 2, y - 1.5, 2.5, 1.8, 0, 0, Math.PI * 2); x.fill(); }
            else x.fillRect(shelf + j * 5 + 1, y - h, 3.7, h);
          }
        }
        if (k === 1) {
          x.strokeStyle = '#c5b783'; x.lineWidth = 1;
          x.beginPath(); x.moveTo(9, 36); x.lineTo(12, 31); x.lineTo(33, 31); x.lineTo(36, 36); x.stroke();
        } else if (k === 2) {
          x.fillStyle = '#7d6857'; x.fillRect(5, 34, 13, 7);
          for (const [tx, ty, tint] of [[8, 32, '#b6a763'], [12, 29, '#a27665'], [15, 32, '#b59164']]) {
            x.fillStyle = tint; x.beginPath(); x.arc(tx, ty, 3, 0, Math.PI * 2); x.fill();
          }
        } else if (k === 3) {
          x.fillStyle = '#737e74'; x.fillRect(22, 27, 1.8, 18);
          x.beginPath(); x.moveTo(23, 17); x.lineTo(18, 20); x.lineTo(15, 26); x.lineTo(18, 27);
          x.lineTo(16, 37); x.lineTo(29, 37); x.lineTo(27, 26); x.lineTo(30, 25); x.lineTo(27, 20); x.fill();
          x.fillStyle = '#aea187'; x.fillRect(36, 37, 12, 3); x.fillRect(39, 33, 9, 3);
        }
        x.fillStyle = '#ddd2ad'; x.fillRect(12 + k * 2, 7, 30, 2);
        x.fillStyle = '#828b87'; x.fillRect(0, 46, 64, 4); x.fillStyle = '#666e6c'; x.fillRect(0, 50, 64, 7);
      } else {
        const desk = k === 1 ? 7 : 13;
        if (k === 0 || k === 2) {
          x.fillStyle = '#677578'; x.fillRect(desk, 43, 39, 2.5); x.fillRect(desk + 4, 45, 2, 11); x.fillRect(desk + 32, 45, 2, 11);
        }
        x.fillStyle = '#566568';
        if (k === 0) {
          x.fillRect(desk + 10, 33, 13, 8); x.fillRect(desk + 15, 41, 2, 2);
          x.fillStyle = '#93abad'; x.fillRect(desk + 11, 34, 11, 6);
        } else if (k === 1) {
          x.fillStyle = '#747f7a'; x.fillRect(7, 25, 12, 29); x.fillRect(21, 25, 12, 29);
          x.fillStyle = '#b7b4a4'; x.fillRect(16, 35, 1, 7); x.fillRect(22, 35, 1, 7);
        } else if (k === 2) {
          x.fillRect(desk + 2, 38, 6, 9); x.fillRect(desk + 25, 38, 6, 9);
          x.fillStyle = '#cfcdc0'; x.fillRect(21, 19, 19, 10);
        } else {
          x.fillStyle = '#677c77'; x.fillRect(10, 43, 29, 10); x.fillRect(9, 40, 3, 14); x.fillRect(38, 40, 3, 14);
          x.fillStyle = '#909f94'; x.fillRect(13, 44, 24, 4); x.fillRect(17, 23, 14, 8);
        }
        x.fillStyle = '#d5d8cc'; x.fillRect(12, 6 + k, 32, 2);
        if (k % 2) { x.fillStyle = '#9caaa9'; for (let y = 0; y < 19; y += 3) x.fillRect(0, y, 64, 1.4); }
      }
      x.restore();
    }
    return c;
  },
  /** Четыре помещения. R — свет на задней стене, G/B — покрытие и свет мебели на отдельной глубине. */
  officeInteriors() {
    const c = canvas(256), foreground = canvas(256);
    const back = c.getContext('2d'), front = foreground.getContext('2d');
    for (let i = 0; i < 4; i++) {
      for (const ctx of [back, front]) {
        ctx.save(); ctx.scale(2, 2); ctx.translate((i % 2) * 64, (i >> 1) * 64);
        ctx.beginPath(); ctx.rect(0, 0, 64, 64); ctx.clip();
      }
      const lamp = [43, 19, 28, 39][i];
      const light = back.createRadialGradient(lamp, 10, 1, lamp + 2, 17, 49);
      light.addColorStop(0, '#b7b7b7'); light.addColorStop(0.32, '#777'); light.addColorStop(0.72, '#3b3b3b'); light.addColorStop(1, '#252525');
      back.fillStyle = light; back.fillRect(0, 0, 64, 64);
      back.fillStyle = '#292929'; back.fillRect(0, 59, 64, 5);
      back.fillStyle = '#a6a6a6'; back.fillRect(lamp - 8, 5, 16, 1);
      front.fillStyle = '#393939';
      if (i === 0) { // Рабочее место у правой стены.
        back.fillStyle = '#343434'; back.fillRect(6, 22, 12, 35);
        back.fillStyle = '#5d5d5d'; back.fillRect(8, 24, 8, 32);
        front.fillRect(23, 43, 37, 2); front.fillRect(26, 45, 2, 16); front.fillRect(56, 45, 2, 16);
        front.fillStyle = '#1d1d1d'; front.fillRect(39, 34, 12, 7); front.fillRect(44, 41, 2, 2);
        front.fillStyle = '#555'; front.fillRect(40, 35, 10, 4);
      } else if (i === 1) { // Шкаф и частично опущенная рулонная штора.
        back.fillStyle = '#343434'; back.fillRect(8, 22, 16, 36); back.fillStyle = '#555'; back.fillRect(9, 23, 6, 32);
        front.fillStyle = '#4a4a4a'; front.fillRect(0, 0, 64, 20);
        front.fillStyle = '#737373';
        for (let y = 3; y < 20; y += 3) front.fillRect(0, y, 64, 0.7);
      } else if (i === 2) { // Переговорная: длинный стол, две спинки и экран на дальней стене.
        back.fillStyle = '#303030'; back.fillRect(19, 20, 28, 15); back.fillStyle = '#999'; back.fillRect(20, 21, 26, 13);
        front.fillRect(9, 43, 45, 2); front.fillRect(15, 45, 2, 10); front.fillRect(47, 45, 2, 10);
        front.fillStyle = '#2e2e2e'; front.fillRect(16, 38, 6, 7); front.fillRect(39, 38, 6, 7);
      } else { // Высокое растение в холле: горшок сужается книзу, ветви выходят от стебля.
        back.fillStyle = '#666'; back.fillRect(10, 18, 12, 14); back.fillStyle = '#404040'; back.fillRect(11, 19, 10, 12);
        front.fillRect(46, 29, 2, 18); front.beginPath(); front.moveTo(40, 45); front.lineTo(53, 45);
        front.lineTo(51, 55); front.lineTo(42, 55); front.fill();
        front.fillStyle = '#454545';
        for (const [x, y, a] of [[43, 36, 0.65], [51, 32, -0.7], [43, 28, 0.62], [48, 24, -1.35]]) {
          front.beginPath(); front.ellipse(x, y, 7, 2.4, a, 0, Math.PI * 2); front.fill();
        }
      }
      back.restore(); front.restore();
    }
    const room = back.getImageData(0, 0, c.width, c.height), furniture = front.getImageData(0, 0, c.width, c.height).data;
    for (let p = 0; p < room.data.length; p += 4) {
      room.data[p + 1] = furniture[p + 3];
      room.data[p + 2] = furniture[p] * furniture[p + 3] / 255;
    }
    back.putImageData(room, 0, 0);
    return c;
  },
  cloudNoise(rng) {
    const S = 256, c = canvas(S), x = c.getContext('2d');
    const img = x.createImageData(S, S), d = img.data;
    const n = noiseField(rng, S, 4, 5);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = clamp8((n[p] - 0.5) * 1.6 * 255 + 128);
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  },
  sparkle() {
    const S = 64, c = canvas(S), x = c.getContext('2d'), m = S / 2;
    const g = x.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 4; i++) {
      x.save(); x.translate(m, m); x.rotate(i * Math.PI / 2);
      x.beginPath(); x.moveTo(0, -m + 2); x.quadraticCurveTo(3, -3, 0, 0); x.quadraticCurveTo(-3, -3, 0, -m + 2); x.fill();
      x.restore();
    }
    return c;
  },
  snowflake() {
    const S = 64, c = canvas(S), x = c.getContext('2d'), m = S / 2;
    const g = x.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2.5; x.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      x.beginPath(); x.moveTo(m, m); x.lineTo(m + Math.cos(a) * (m - 6), m + Math.sin(a) * (m - 6)); x.stroke();
    }
    return c;
  },
  softShadow() {
    const S = 128, c = canvas(S), x = c.getContext('2d');
    const img = x.createImageData(S, S), d = img.data, m = (S - 1) / 2;
    for (let y = 0; y < S; y++) for (let k = 0; k < S; k++) {
      const r = Math.min(1, Math.hypot(k - m, y - m) / m);
      const v = clamp8(Math.pow(1 - r, 1.8) * 255), i = (y * S + k) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  },
};

/** Новый canvas текстуры (без кэша) — для тестов и пересоздания. */
export function generateCanvas(name) {
  const gen = GEN[name];
  if (!gen) throw new Error('Unknown texture: ' + name);
  return gen(createRng(hashSeed('texture', name)));
}

export function getTexture(name) {
  let t = cache.get(name);
  if (t) return t;
  t = new THREE.CanvasTexture(generateCanvas(name));
  t.name = name;
  t.colorSpace = MASK_TEXTURES.includes(name) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const wrap = SPRITES.includes(name) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapS = t.wrapT = wrap;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = anisotropy;
  cache.set(name, t);
  return t;
}

/** Внешняя текстура (из ассетов) получает ту же анизотропию, что и процедурные. */
export function registerTexture(t) {
  t.anisotropy = anisotropy;
  if (!external.has(t)) {
    external.add(t);
    // освобождённая текстура уходит из реестра вместе со своим слушателем
    const onDispose = () => { t.removeEventListener('dispose', onDispose); external.delete(t); };
    t.addEventListener('dispose', onDispose);
  }
  return t;
}

/** Только для тестов: сколько внешних текстур сейчас зарегистрировано. */
export function _registeredCount() { return external.size; }

/** Анизотропия для всех текстур: максимум устройства, но не больше 8. */
export function setMaxAnisotropy(max) {
  anisotropy = Math.max(1, Math.min(8, max | 0));
  for (const t of [...cache.values(), ...external]) if (t.anisotropy !== anisotropy) { t.anisotropy = anisotropy; t.needsUpdate = true; }
}
