// Слои материала стен (спецификация «Детализация домов» §4.1): кирпич, штукатурка, панели, композит, черепица.
// Чистый модуль без three. Плитка WALL_TILE × WALL_TILE м бесшовна по обеим осям; рисунок задан в долях плитки и от
// размера не зависит. Цвет — серая светлота в sRGB (RGB) и шероховатость (A); нормали OpenGL из карты высот
// центральными разностями. Средняя линейная светлота калибруется к LAYER_MEAN — тону прежних canvas-текстур.
import { createRng, hashSeed } from '../../core/rng.js';

export const WALL_TILE = 1.2;
export const WALL = Object.freeze({ brick: 0, plaster: 1, panel: 2, composite: 3, tiles: 4 });
export const WALL_LAYERS = Object.freeze(['brick', 'plaster', 'panel', 'composite', 'tiles']);
/** Средняя линейная светлота (Rec. 709) прежних canvas-текстур: замер этапа 0 (план, отличие 16). */
export const CANVAS_MEAN = Object.freeze({ brick: 0.6949, plaster: 0.8562, roofTiles: 0.5473 });
/** Цель калибровки слоя: панели и композит заменяют штукатурку офисов и быстрой игры, черепица — roofTiles. */
export const LAYER_MEAN = Object.freeze([CANVAS_MEAN.brick, CANVAS_MEAN.plaster, CANVAS_MEAN.plaster, CANVAS_MEAN.plaster, CANVAS_MEAN.roofTiles]);
/** Пределы шероховатости слоя (§4.1). */
export const LAYER_ROUGH = Object.freeze([[0.76, 0.94], [0.82, 0.92], [0.7, 0.82], [0.61, 0.78], [0.68, 0.84]].map(Object.freeze));
/** Глубина рельефа слоя, м: перепад высоты 0..1 карты — столько метров. */
const DEPTH = [0.0058, 0.0025, 0.004, 0.002, 0.018];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
/**
 * Доля текселя по положительную сторону границы: edge — расстояние от центра текселя до границы, px — ширина текселя
 * (в одних единицах). Швы шире или уже текселя дают ту же среднюю светлоту на любом размере: рисунок от размера не зависит.
 */
const cover = (edge, px) => clamp01(edge / px + 0.5);

/** Линейное → sRGB 8 бит, таблица на 4096 входов (Math.pow на тексель дорог). */
const TO_SRGB = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) {
  const c = i / 4095;
  TO_SRGB[i] = Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}
/** sRGB 8 бит → линейное. */
const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

/** Решётка периодического value-noise: cells × cells значений 0..1. */
function lattice(rng, cells) {
  const a = new Float32Array(cells * cells);
  for (let i = 0; i < a.length; i++) a[i] = rng.next();
  return { a, cells, row: new Float32Array(cells) };
}
/** Строка решётки на высоте v ∈ [0, 1): интерполяция по v один раз на строку текселей. */
function latticeRow(L, v) {
  const n = L.cells, y = v * n, y0 = Math.floor(y), sy = smooth(y - y0);
  const j0 = ((y0 % n) + n) % n, j1 = (j0 + 1) % n, a = L.a;
  for (let i = 0; i < n; i++) L.row[i] = a[j0 * n + i] + (a[j1 * n + i] - a[j0 * n + i]) * sy;
}
/** Значение строки решётки в точке u ∈ [0, 1). */
function latticeAt(L, u) {
  const n = L.cells, x = u * n, x0 = Math.floor(x), sx = smooth(x - x0);
  const i0 = x0 % n, i1 = (i0 + 1) % n;
  return L.row[i0] + (L.row[i1] - L.row[i0]) * sx;
}
/** Белый шум текселя 0..1 (целочисленный хэш): бесшовен — тексели не связаны. */
function grain(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- слои: H — высота 0..1, A — светлота (линейная, до калибровки), R — шероховатость ----------

/**
 * Кирпич: 10 рядов по 5 кирпичей, перевязка на полкирпича, шов 10 мм,
 * скруглённые кромки. Расстояния — в долях плитки.
 */
function brick(S, rng, seed, H, A, R) {
  const ROWS = 10, COLS = 5, JOINT = 0.010 / WALL_TILE, BEVEL = 0.006 / WALL_TILE, JOINT_A = 0.58, px = 1 / S;
  const tone = Array.from({ length: ROWS * COLS }, () => 0.85 + 0.15 * rng.next());
  const spots = lattice(rng, 8);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S, rv = v * ROWS, row = Math.floor(rv), fy = rv - row;
    const shift = (row % 2) * 0.5;
    latticeRow(spots, v);
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, cu = u * COLS + shift, col = Math.floor(cu), fx = cu - col, i = y * S + x;
      // расстояние до кромки кирпича: положительное — внутри кирпича
      const edge = Math.min(Math.min(fx, 1 - fx) / COLS, Math.min(fy, 1 - fy) / ROWS) - JOINT / 2;
      const g = grain(x, y, seed), n = latticeAt(spots, u), c = cover(edge, px), e = clamp01(edge / BEVEL);
      const face = tone[row * COLS + (col % COLS)] * (0.9 + 0.2 * n) * (0.95 + 0.1 * g);
      H[i] = c * e * (2 - e) * (0.86 + 0.11 * n + 0.03 * g) + (1 - c) * 0.07 * g;
      A[i] = c * face + (1 - c) * JOINT_A * (0.92 + 0.16 * g);
      R[i] = c * (0.78 + 0.06 * g) + (1 - c) * (0.9 + 0.04 * g);
    }
  }
}

/** Штукатурка: мелкая шуба и редкие пятна. */
function plaster(S, rng, seed, H, A, R) {
  const fine = lattice(rng, 64), spots = lattice(rng, 4);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    latticeRow(fine, v); latticeRow(spots, v);
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, i = y * S + x, g = grain(x, y, seed), f = latticeAt(fine, u);
      const spot = smooth(clamp01((latticeAt(spots, u) - 0.62) / 0.13));
      const drag = smooth(clamp01((f - 0.56 - spot * 0.04) * 3.8));
      H[i] = 0.42 * f + 0.30 * g + 0.28 * drag;
      A[i] = (1 - 0.095 * spot) * (0.94 + 0.05 * g + 0.075 * drag);
      R[i] = 0.84 + 0.06 * f;
    }
  }
}

/** Панели: шов 10 мм по краю плитки (вертикальный) и через 0,6 м (горизонтальные), мелкие поры. */
function panel(S, rng, seed, H, A, R) {
  const SEAM = 0.01 / WALL_TILE, BEVEL = 0.004 / WALL_TILE, px = 1 / S, low = lattice(rng, 4);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S, fy = (v * 2) % 1;
    latticeRow(low, v);
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, i = y * S + x, g = grain(x, y, seed);
      const edge = Math.min(Math.min(u, 1 - u), Math.min(fy, 1 - fy) / 2) - SEAM / 2;
      const c = cover(edge, px), pore = g < 0.02 ? 0.35 : 0;
      // Углубления от стяжек опалубки: четыре в каждом модуле, края затёрты раствором.
      const tx = Math.min(Math.abs(u - 0.105), Math.abs(u - 0.895));
      const ty = Math.min(Math.abs(fy - 0.17), Math.abs(fy - 0.83)) * 0.5;
      const socket = tx < 0.016 && ty < 0.016 ? smooth(clamp01((0.016 - Math.sqrt(tx * tx + ty * ty)) / (0.006 + px))) : 0;
      H[i] = c * clamp01(edge / BEVEL) * (1 - pore - 0.29 * socket);
      A[i] = (c * (1 - pore * 0.2 - 0.25 * socket) + (1 - c) * 0.6) * (0.95 + 0.1 * latticeAt(low, u));
      R[i] = 0.72 + 0.06 * g;
    }
  }
}

/** Композит: плиты 0,6 × 1,2 м со стыками 4 мм; у плиты свои тон и блеск. */
function composite(S, rng, seed, H, A, R) {
  const JOINT = 0.004 / WALL_TILE, px = 1 / S;
  const tone = [0.97 + 0.06 * rng.next(), 0.97 + 0.06 * rng.next()];
  const gloss = [0.62 + 0.10 * rng.next(), 0.62 + 0.10 * rng.next()];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, i = y * S + x, g = grain(x, y, seed), p = u < 0.5 ? 0 : 1, fu = (u * 2) % 1;
      const edge = Math.min(Math.min(fu, 1 - fu) / 2, Math.min(v, 1 - v)) - JOINT / 2;
      const c = cover(edge, px);
      H[i] = c * clamp01(edge / JOINT);
      A[i] = (c * tone[p] + (1 - c) * 0.6) * (0.985 + 0.03 * g);
      R[i] = c * (gloss[p] + 0.035 * g) + (1 - c) * 0.77;
    }
  }
}

/**
 * Черепица: 8 рядов по 8 плиток со сдвигом в полплитки, продольный желоб, полукруглый нижний край и тень нахлёста.
 * v растёт вниз по скату (план, Task 4: UV ската до поворота), поэтому «низ» плитки — большие v ряда.
 */
function tiles(S, rng, seed, H, A, R) {
  const ROWS = 8, COLS = 8, GAP = (0.006 / WALL_TILE) * COLS, pu = COLS / S, pv = ROWS / S;
  const tone = Array.from({ length: ROWS * COLS }, () => 0.86 + 0.14 * rng.next());
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S, rv = v * ROWS, row = Math.floor(rv), fy = rv - row, shift = (row % 2) * 0.5;
    const shade = 0.55 + 0.45 * smooth(clamp01(fy / 0.25));
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, cu = u * COLS + shift, col = Math.floor(cu), fx = cu - col, i = y * S + x;
      const g = grain(x, y, seed), t = tone[row * COLS + (col % COLS)];
      const bottom = 1 - 0.22 * (1 - Math.sqrt(Math.max(0, 1 - (2 * fx - 1) ** 2)));
      const c = cover(bottom - fy, pv) * cover(Math.min(fx, 1 - fx) - GAP / 2, pu);
      const trough = Math.abs(2 * fx - 1), flute = trough * trough;
      H[i] = c * (0.16 + 0.62 * Math.min(1, fy / bottom) + 0.2 * flute) + (1 - c) * 0.05;
      A[i] = c * t * shade * (0.85 + 0.10 * g + 0.08 * flute) + (1 - c) * 0.4 * (0.9 + 0.2 * g);
      R[i] = c * (0.69 + 0.11 * g) + (1 - c) * 0.82;
    }
  }
}

const MAKERS = [brick, plaster, panel, composite, tiles];

/** Нормали из высот (центральные разности с переносом через край), упаковка OpenGL: Y — вдоль v. */
function normals(S, H, depth, out) {
  const k = depth / (2 * (WALL_TILE / S)); // единица высоты на двух текселях → наклон, м/м
  for (let y = 0; y < S; y++) {
    const ym = ((y + S - 1) % S) * S, yp = ((y + 1) % S) * S, yr = y * S;
    for (let x = 0; x < S; x++) {
      const dx = (H[yr + (x + 1) % S] - H[yr + (x + S - 1) % S]) * k, dy = (H[yp + x] - H[ym + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), o = (yr + x) * 4;
      out[o] = ((0.5 - 0.5 * dx * inv) * 255 + 0.5) | 0;
      out[o + 1] = ((0.5 - 0.5 * dy * inv) * 255 + 0.5) | 0;
      out[o + 2] = ((0.5 + 0.5 * inv) * 255 + 0.5) | 0;
      out[o + 3] = 255;
    }
  }
}

/** Светлота A × gain → sRGB-байты в color (RGB), шероховатость R → A. → средняя линейная светлота результата. */
function encode(S, A, R, gain, rough, out) {
  const [lo, hi] = rough;
  let sum = 0;
  for (let i = 0, o = 0; i < S * S; i++, o += 4) {
    const s = TO_SRGB[(clamp01(A[i] * gain) * 4095 + 0.5) | 0];
    out[o] = out[o + 1] = out[o + 2] = s;
    out[o + 3] = ((lo + (hi - lo) * clamp01((R[i] - lo) / (hi - lo))) * 255 + 0.5) | 0;
    sum += TO_LIN[s];
  }
  return sum / (S * S);
}

/**
 * Слой k размером size² (тексели): color — RGBA (RGB — серая светлота sRGB, A — шероховатость), normal — RGBA (нормаль
 * OpenGL, A = 255). Можно передать свои массивы (подмассивы общего буфера). → { color, normal, mean }.
 */
export function generateWallLayer(k, size, color = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4)) {
  const S = size, n = S * S;
  if (!(k >= 0 && k < MAKERS.length) || !(S >= 8)) throw new Error(`wall layer ${k} of size ${S}`);
  const H = new Float32Array(n), A = new Float32Array(n), R = new Float32Array(n);
  const rng = createRng(hashSeed('wall', k));
  MAKERS[k](S, rng, hashSeed('wallGrain', k) | 0, H, A, R);
  let raw = 0;
  for (let i = 0; i < n; i++) raw += A[i];
  // калибровка: первый проход по средней светлоте до кодирования, второй — поправка на насыщение и квантование
  let gain = LAYER_MEAN[k] / Math.max(1e-6, raw / n);
  let mean = encode(S, A, R, gain, LAYER_ROUGH[k], color);
  if (Math.abs(mean - LAYER_MEAN[k]) / LAYER_MEAN[k] > 0.005) {
    gain *= LAYER_MEAN[k] / Math.max(1e-6, mean);
    mean = encode(S, A, R, gain, LAYER_ROUGH[k], color);
  }
  normals(S, H, DEPTH[k], normal);
  return { color, normal, mean };
}
