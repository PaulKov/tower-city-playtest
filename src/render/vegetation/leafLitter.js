// Опавшие листья. Верх атласа — отдельные листья с черешками и жилками.
// Внизу запечены те же раскладки, которые вблизи собираются из изогнутых листьев.
import * as THREE from 'three';
import { generationStamp, finishGeneration } from './atlas.js';
import { bakedTexture } from './baked.js';
import { createRng, hashSeed } from '../../core/rng.js';
import { autumnLeafLoss } from '../../core/autumnFoliage.js';

const CELL = 256,
  VARIANTS = 8,
  ATLAS_ROWS = 5,
  TAU = 2 * Math.PI;
const INKS = [
  ['#ffda36', '#eaa927', '#ac4f13', '#f6d16c'],
  ['#f58b19', '#db5519', '#ad3419', '#f7bb52'],
  ['#ff5b2e', '#d72921', '#88231a', '#e99852'],
  ['#ef4633', '#ba2028', '#732c27', '#ef945e'],
  ['#ffdc61', '#d8a731', '#ae6723', '#f5d986'],
  ['#bd7436', '#884a29', '#683825', '#dca669'],
  ['#eba832', '#bd681d', '#8e4421', '#f5c46c'],
  ['#ce793d', '#ab502b', '#78412f', '#e7b77a'],
];
const MAPLE = [
  [0, 0.28],
  [-0.17, 0.38],
  [-0.48, 0.46],
  [-0.43, 0.33],
  [-0.68, 0.29],
  [-0.63, 0.18],
  [-0.91, -0.01],
  [-0.8, -0.07],
  [-0.86, -0.24],
  [-0.64, -0.17],
  [-0.62, -0.3],
  [-0.37, -0.14],
  [-0.49, -0.57],
  [-0.36, -0.5],
  [-0.38, -0.72],
  [-0.23, -0.59],
  [-0.14, -0.45],
  [-0.15, -0.73],
  [-0.08, -0.69],
  [0, -0.97],
];
const OAK = [
  [0, 0.41],
  [-0.17, 0.45],
  [-0.3, 0.42],
  [-0.35, 0.34],
  [-0.29, 0.26],
  [-0.18, 0.19],
  [-0.34, 0.22],
  [-0.53, 0.18],
  [-0.57, 0.09],
  [-0.55, 0.02],
  [-0.31, -0.06],
  [-0.28, -0.12],
  [-0.51, -0.13],
  [-0.61, -0.22],
  [-0.58, -0.32],
  [-0.48, -0.35],
  [-0.26, -0.32],
  [-0.24, -0.4],
  [-0.38, -0.49],
  [-0.43, -0.59],
  [-0.37, -0.67],
  [-0.27, -0.66],
  [-0.16, -0.58],
  [-0.15, -0.74],
  [-0.08, -0.84],
  [0, -0.86],
];
const BIRCH = [
  [0, 0.4],
  [-0.22, 0.36],
  [-0.47, 0.23],
  [-0.54, 0.03],
  [-0.52, -0.19],
  [-0.42, -0.39],
  [-0.24, -0.6],
  [-0.13, -0.74],
  [0, -0.94],
];
const NEIGHBORING_HUES = [
  [0, 0, 4, 6, 1, 7],
  [1, 1, 0, 2, 5, 6],
  [2, 2, 3, 1, 7, 0],
  [3, 3, 2, 7, 1, 5],
  [4, 4, 0, 6, 7, 5],
  [5, 5, 7, 1, 4, 2],
  [6, 6, 4, 0, 5, 2],
  [7, 7, 5, 3, 1, 0],
];
let atlas, arrangements, heaps;
const sideOfCell = (k) => [(k % 4) * CELL, Math.floor(k / 4) * CELL];

function outline(points, serrated, rng) {
  const shape = new Path2D();
  for (let half = 0; half < 2; half++) {
    const chain = half ? points.slice().reverse() : points;
    for (let i = 0; i < chain.length; i++) {
      let [x, y] = chain[i];
      if (half) x = -x * 0.92 + 0.034 * Math.sin(y * 6);
      if (!i && !half) {
        shape.moveTo(x, y);
        continue;
      }
      if (serrated && i) {
        const [px, py] = chain[i - 1],
          ox = half ? -px * 0.92 + 0.034 * Math.sin(py * 6) : px;
        const steps = Math.floor(Math.hypot(x - ox, y - py) / 0.045);
        for (let j = 1; j <= steps; j++) {
          const t = j / (steps + 1);
          shape.lineTo(ox + (x - ox) * t + (half ? 1 : -1) * rng.uniform(0.007, 0.021), py + (y - py) * t - 0.014);
          shape.lineTo(ox + (x - ox) * (t + 0.016), py + (y - py) * t + 0.012);
        }
      }
      shape.lineTo(x, y);
    }
  }
  shape.closePath();
  return shape;
}

function paintLeaf(ctx, cell) {
  const rng = createRng(9051 + 127 * cell),
    palette = INKS[cell];
  const oak = cell === 5,
    birch = cell === 4 || cell === 6;
  const shape = outline(oak ? OAK : birch ? BIRCH : MAPLE, !oak, rng),
    [ox, oy] = sideOfCell(cell);
  ctx.save();
  ctx.translate(ox + CELL * 0.5, oy + CELL * 0.55);
  ctx.scale(119, 119);
  ctx.transform(1, rng.uniform(-0.055, 0.055), rng.uniform(-0.085, 0.085), 1, 0, 0);
  const base = oak || birch ? 0.4 : 0.28,
    tail = 0.8 + rng.uniform(-0.04, 0.035);
  ctx.lineCap = 'round';
  function stroke(a, b, bend, color, width) {
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.quadraticCurveTo((a[0] + b[0]) / 2 + bend, (a[1] + b[1]) / 2, ...b);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  // Наружная кромка общая для летящего и лежащего листа. Контактную тень
  // скопления получает его собственная раскладка у земли.
  stroke([0, base - 0.02], [0.14, tail], -0.039, palette[2], 0.022);
  stroke([-0.002, base], [0.134, tail - 0.008], -0.039, palette[3], 0.008);
  const wash = ctx.createLinearGradient(-0.74, -0.69, 0.58, 0.45);
  wash.addColorStop(0, palette[0]);
  wash.addColorStop(0.5, palette[1]);
  wash.addColorStop(0.74, palette[0]);
  wash.addColorStop(1, palette[2]);
  ctx.fillStyle = wash;
  ctx.fill(shape);
  ctx.save();
  ctx.clip(shape);
  // Выцветшие и окислившиеся участки распределены внутри листовой пластинки.
  for (let i = 0; i < 57; i++) {
    const x = rng.uniform(-0.87, 0.87),
      y = rng.uniform(-0.92, 0.45),
      r = rng.uniform(0.022, 0.22);
    const bloom = ctx.createRadialGradient(x, y, 0, x, y, r);
    bloom.addColorStop(0, i % 3 ? 'rgba(111,37,16,.23)' : 'rgba(255,225,97,.47)');
    bloom.addColorStop(1, 'rgba(171,96,24,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const fold = ctx.createLinearGradient(-0.09, 0, 0.04, 0);
  fold.addColorStop(0, 'rgba(85,29,8,0)');
  fold.addColorStop(0.63, 'rgba(82,36,15,.22)');
  fold.addColorStop(1, 'rgba(255,218,119,.12)');
  ctx.fillStyle = fold;
  ctx.fillRect(-0.13, -1, 0.17, 1.52);
  const origin = [0, base],
    axes =
      birch || oak
        ? [[0, -0.87]]
        : [
            [0, -0.95],
            [-0.38, -0.69],
            [0.37, -0.65],
            [-0.84, -0.2],
            [0.77, -0.2],
            [-0.48, 0.42],
            [0.45, 0.4],
          ];
  for (const tip of axes) {
    const dx = tip[0],
      dy = tip[1] - base,
      len = Math.hypot(dx, dy),
      side = dx < 0 ? -1 : 1;
    const bends = 0.018 * side;
    stroke(origin, tip, bends, 'rgba(111,56,22,.46)', 0.022);
    stroke(origin, tip, bends, palette[3], 0.011);
    for (let i = 1; i <= 5; i++) {
      const t = 0.13 * i,
        x = dx * t + 0.9 * bends * Math.sin(Math.PI * t),
        y = base + dy * t;
      for (const sign of [-1, 1]) {
        const width = (oak || birch ? 0.46 : 0.22) * len * (1 - t * 0.85);
        const pt = [x + dx * 0.2 - (sign * dy * width) / len, y + dy * 0.2 + (sign * dx * width) / len];
        stroke([x, y], pt, sign * 0.018, 'rgba(255,213,123,.55)', 0.007);
        const m = [x * 0.55 + pt[0] * 0.45, y * 0.55 + pt[1] * 0.45];
        stroke(m, [pt[0] * 0.92 + 0.026 * sign, pt[1] + 0.068], 0, 'rgba(108,56,20,.29)', 0.004);
      }
    }
  }
  for (let i = 0; i < 185; i++) {
    const x = rng.uniform(-0.91, 0.91),
      y = rng.uniform(-0.95, 0.46),
      r = rng.uniform(0.002, 0.014);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.uniform(0.45, 1.35), 0, 0, TAU);
    ctx.fillStyle = i % 5 ? 'rgba(87,36,15,.36)' : 'rgba(231,200,113,.73)';
    ctx.fill();
  }
  // Вода пропитывает части красной пластинки. У сухой изнанки остаются бледные
  // островки между жилками и выветренные бурые края.
  if (cell === 2 || cell === 3 || cell === 5) {
    for (let i = 0; i < 10; i++) {
      const x = rng.uniform(-0.7, 0.7),
        y = rng.uniform(-0.71, 0.3),
        r = rng.uniform(0.025, 0.12);
      ctx.beginPath();
      ctx.ellipse(x, y, r, 0.67 * r, 0.48, 0, TAU);
      ctx.fillStyle = 'rgba(91,36,20,.14)';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.91, 0.64 * r, 0.48, 0.9, 2.5);
      ctx.strokeStyle = 'rgba(250,216,156,.18)';
      ctx.lineWidth = 0.007;
      ctx.stroke();
    }
  }
  // Высохшая кромка заворачивается и открывает более светлую изнанку лопасти.
  const side = cell % 2 ? -1 : 1,
    foldX = (birch || oak ? 0.31 : 0.55) * side;
  ctx.beginPath();
  ctx.moveTo(foldX, -0.53);
  ctx.bezierCurveTo(foldX + side * 0.17, -0.22, foldX - side * 0.08, 0.12, foldX + side * 0.1, 0.41);
  ctx.lineTo(side, 0.5);
  ctx.lineTo(side, -0.65);
  ctx.closePath();
  const margin = ctx.createLinearGradient(foldX, 0, foldX + side * 0.26, 0);
  margin.addColorStop(0, 'rgba(96,47,19,.31)');
  margin.addColorStop(0.14, 'rgba(255,221,136,.22)');
  margin.addColorStop(1, 'rgba(180,108,51,.26)');
  ctx.fillStyle = margin;
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const x = rng.uniform(-0.65, 0.65),
      y = rng.uniform(-0.6, 0.32),
      r = rng.uniform(0.013, 0.039);
    ctx.beginPath();
    ctx.ellipse(x, y, r, 0.6 * r, 0.51, 0, TAU);
    ctx.fillStyle = 'rgba(103,51,21,.58)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, 0.6 * r, 0.38 * r, 0.51, 0, TAU);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(100,48,18,.49)';
  ctx.lineWidth = 0.009;
  ctx.stroke(shape);
  ctx.restore();
}

function makeArrangements() {
  if (arrangements) return arrangements;
  arrangements = Array.from({ length: VARIANTS }, (_, v) => {
    const rng = createRng(35100 + v * 139),
      leaves = [];
    const n = v % 3 === 0 ? rng.int(7, 15) : rng.int(26, 44);
    for (let i = 0; i < n; i++) {
      const a = rng.uniform(0, TAU),
        r = Math.sqrt(rng.next()) * (i < n * 0.52 ? 0.26 : 0.47);
      const x = Math.cos(a) * r - 0.035,
        z = Math.sin(a) * r * (0.46 + 0.08 * (v % 3)) + 0.2 * x + 0.16 * x * x;
      const cell = rng.pick(NEIGHBORING_HUES[v]);
      leaves.push({
        x,
        z,
        turn: rng.uniform(0, TAU),
        size: rng.uniform(0.082, 0.155) * (i % 9 === 0 ? 1.23 : 1),
        width: rng.uniform(0.79, 1.09),
        curl: rng.uniform(0.02, 0.135),
        flip: rng.next() < 0.5 ? -1 : 1,
        cell,
      });
    }
    return leaves;
  });
  return arrangements;
}

// Валик вытянут по ветру; под гребнем два неодинаковых кармана набившихся листьев.
function heapProfile(x, z, variant) {
  const ridge = z - 0.12*x - 0.041*Math.sin(7*x + variant);
  const dome = Math.max(0, 1 - ((x + 0.025) / 0.41)**2 - (ridge / 0.235)**2);
  return dome*dome * (0.87 + 0.12*Math.sin(13*x + variant) + 0.12*Math.cos(17*ridge + 4*x));
}

function heapArrangements() {
  if (heaps) return heaps;
  heaps = Array.from({ length: 4 }, (_, variant) => {
    const rng = createRng(92731 + 1213*variant), leaves = [];
    for (let layer = 0; layer < 3; layer++) {
      const count = [124, 74, 49][layer];
      for (let i = 0; i < count; i++) {
        const angle = rng.uniform(0,TAU), r = Math.sqrt(rng.next()) * (layer === 2 ? 0.87 : 1);
        const x = (0.38 + 0.032*Math.cos(3*angle + variant))*r*Math.cos(angle);
        const z = 0.12*x + 0.038*Math.sin(7*x + variant) + (0.205+0.028*Math.sin(3*angle))*r*Math.sin(angle);
        const outer = layer === 0 && i % 11 === 0;
        const hue = rng.pick(layer === 0 ? [5, 5, 7, 1, 6] : NEIGHBORING_HUES[[1, 2, 0, 7][variant]]);
        leaves.push({ x: outer ? x*1.06 : x, z: outer ? z*1.17 : z, layer, cell: hue,
          turn: rng.uniform(0, TAU), size: rng.uniform(0.094,0.164), width: rng.uniform(0.74,1.06),
          flip: rng.next() < 0.5 ? -1 : 1, curl: rng.uniform(0.055,0.205), tilt: rng.uniform(-0.14,0.20) });
      }
    }
    return leaves;
  });
  return heaps;
}

export function litterAtlas() {
  const ready = bakedTexture('autumn.litter', 'autumn-fallen-leaves', { anisotropy: 4 });
  if (ready) return ready;
  if (atlas) return atlas;
  const stamp = generationStamp();
  const c = document.createElement('canvas');
  c.width = CELL * 4;
  c.height = CELL * ATLAS_ROWS;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const blades = document.createElement('canvas');
  blades.width = c.width;
  blades.height = CELL * 2;
  const paint = blades.getContext('2d', { willReadFrequently: true });
  for (let v = 0; v < VARIANTS; v++) paintLeaf(paint, v);
  ctx.drawImage(blades, 0, 0);
  // На запечённом наносе один лист занимает 24–44 текселя. Фильтруем исходники
  // и рисуем мягкий контакт один раз на вид листа, до раскладки сотен перекрытий.
  const stamps = Array.from({ length: VARIANTS }, (_, v) => {
    const stamp = document.createElement('canvas'), [x,y] = sideOfCell(v);
    stamp.width = stamp.height = CELL/4;
    const ink = stamp.getContext('2d', { willReadFrequently: true });
    ink.shadowColor = 'rgba(46,25,12,0.53)';
    ink.shadowBlur = 2.2; ink.shadowOffsetX = 1.3; ink.shadowOffsetY = 2.5;
    ink.drawImage(blades,x,y,CELL,CELL,0,0,stamp.width,stamp.height);
    return stamp;
  });
  const clusters = [...makeArrangements(), ...heapArrangements()];
  for (let v = 0; v < clusters.length; v++) {
    const [ox, oy] = sideOfCell(8 + v);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
    for (const leaf of clusters[v]) {
      // Приближённый и обзорный ярусы делят запечённую подстилку; часть верхних
      // листьев добавлена сеткой, остальные остаются в карте даже при переходе вдаль.
      if (v >= VARIANTS && leaf.layer === 2) continue;
      const [sx, sy] = sideOfCell(leaf.cell),
        s = leaf.size * CELL;
      ctx.save();
      ctx.translate(ox + (0.5 + leaf.x) * CELL, oy + (0.5 + leaf.z) * CELL);
      ctx.rotate(leaf.turn);
      if (v >= VARIANTS) ctx.drawImage(stamps[leaf.cell], -s*leaf.width/2, -s/2, s*leaf.width, s);
      else ctx.drawImage(blades, sx, sy, CELL, CELL, (-s * leaf.width) / 2, -s / 2, s * leaf.width, s);
      ctx.restore();
    }
    ctx.restore();
  }
  atlas = new THREE.CanvasTexture(c);
  atlas.name = 'autumn-fallen-leaves';
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  finishGeneration(stamp);
  return atlas;
}

/** В парке все скопления привязаны к его собственному верху, включая асфальт внизу бордюра. */
function collectPatches(plants, site, floorAt, roadHalf) {
  const patches = [],
    parks = new Set(),
    rng = createRng(73151);
  function add(x, y, z, size, turn, variant = rng.int(0, 7), surface = null) {
    patches.push({ x, y, z, size, turn, variant, surface, near: false });
  }
  function bankAtTree(p, park, loss, local) {
    if (loss < 0.18 || (loss < 0.62 && local.next() > (loss - 0.15)*0.95)) return;
    const size = local.uniform(1.16,1.36) + 0.33*loss;
    let x, z, turn;
    if (park) {
      // Сугроб листьев остаётся на газоне в своём квадранте: с одной стороны
      // у него ствол, с другой — приподнятая граница участка. Крест дорожек свободен.
      const sx = Math.sign(p.x-park.x), sz = Math.sign(p.z-park.z);
      x = park.x + sx*Math.min(2.10, Math.abs(p.x-park.x) + 0.43);
      z = park.z + sz*Math.min(1.99, Math.abs(p.z-park.z) + local.uniform(-0.13,0.32));
      turn = Math.PI/2 + local.uniform(-0.21,0.21);
    } else {
      const a = local.uniform(0, TAU), d = local.uniform(0.36,0.62)*(p.s ?? 1);
      x = p.x + d*Math.cos(a); z = p.z + d*Math.sin(a);
      turn = a + Math.PI/2 + local.uniform(-0.34,0.34);
      if (!site.clear(x, z, size*0.60)) return;
    }
    patches.push({ x, z, y: p.y, size, turn, variant: local.int(0,3), near: false,
      height: local.uniform(0.083,0.128) + 0.147*loss });
  }
  for (const p of plants) {
    if (p.kind !== 'tree' || p.lod === 2) continue;
    const park = p.litterPark, loss = autumnLeafLoss(p.x, p.z);
    const local = createRng(hashSeed('fallen', p.x, p.z));
    if (park) {
      const sx = Math.sign(p.x - park.x),
        sz = Math.sign(p.z - park.z);
      add(p.x - 0.4 * sx, p.y, p.z + 0.22 * sz, 1.43, rng.uniform(0, TAU));
      add(p.x + 0.21 * sx, p.y, p.z - 0.57 * sz, 1.34, rng.uniform(0, TAU));
      if (loss > 0.32) add(park.x + sx * 2.4, p.y, park.z + sz * 1.34, 1.45, Math.PI / 2);
      // На кромке пешеходной дорожки и на подветренной стороне ствола.
      if (loss > 0.46) add(park.x + sx * 0.49, p.y, park.z + sz * 1.73, 1.38, Math.PI / 2 + 0.08 * sx);
      if (loss > 0.61) add(park.x + sx * 1.8, p.y, park.z + sz * 0.49, 1.24, 0.12 * sz);
      bankAtTree(p, park, loss, local);
      if (!parks.has(park)) {
        parks.add(park);
        for (const sign of [-1, 1]) {
          const along = rng.uniform(-0.55, 0.55),
            shift = rng.uniform(-1.1, 1.1);
          for (const offset of [-1.55, -0.51, 0.29, 1.38]) {
            add(
              park.x + along + offset,
              park.asphalt,
              park.z + sign * rng.uniform(3.23, 3.41),
              rng.uniform(1.15, 1.65),
              rng.uniform(-0.08, 0.08),
              offset === 0.29 || sign < 0 ? 3 : rng.int(0, 7),
            );
          }
          add(park.x + sign * 3.32, park.asphalt, park.z + shift, 1.64, Math.PI / 2, sign > 0 ? 1 : 3);
          add(park.x + sign * 3.28, park.asphalt, park.z + shift - 1.01, 1.49, Math.PI / 2, 6);
        }
      }
    } else if (Math.hypot(p.x, p.z) < (site.city ? site.city.half + 18 : 43)) {
      bankAtTree(p, null, loss, local);
      const tufts = 1 + Math.floor(5*loss);
      for (let i = 0; i < tufts; i++) {
        const a = local.uniform(0, TAU),
          d = local.uniform(0.5, 1.85) * p.s;
        const x = p.x + Math.cos(a) * d,
          z = p.z + Math.sin(a) * d;
        if (site.clear(x, z, 1.1)) add(x, 0, z, local.uniform(1.45, 2.0), a + 0.8);
      }
    }
  }
  if (!site.city) {
    for (const road of site.roads) {
      const alongX = road.along === 'x',
        other = site.roads.find((r) => r !== road);
      for (const side of [-1, 1])
        for (let u = -28 + rng.uniform(0, 2); u < 29; u += rng.uniform(1.5, 3.8)) {
          if (other && Math.abs(u - other.at) < site.band + 1.0) continue;
          // У дороги опад скапливается на асфальте у подножия бордюра и вдоль края тротуара.
          const offset = roadHalf - rng.uniform(0.23, 0.39);
          const inner = rng.next() < 0.58,
            v = road.at + side * (inner ? offset : site.band - 0.35);
          const x = alongX ? u : v,
            z = alongX ? v : u;
          if (Math.hypot(x, z) < site.plaza + 0.83) continue;
          add(
            x,
            floorAt(x, z),
            z,
            inner ? rng.uniform(1.12, 1.58) : rng.uniform(1.18, 1.45),
            (alongX ? 0 : Math.PI / 2) + rng.uniform(-0.09, 0.09),
          );
        }
    }
    // Между заносами остаются почти чистые пролёты, редкие листья зацепились дальше от каймы.
    for (const [angle, span, count] of [
      [1.1, 1.04, 11],
      [-1.6, 0.81, 7],
      [2.65, 0.57, 5],
      [-0.23, 0.44, 3],
    ]) {
      for (let i = 0; i < count; i++) {
        const a = angle + span * (i / count - 0.5) + rng.uniform(-0.035, 0.035);
        const r = site.plaza - rng.uniform(0.34, i % 4 === 0 ? 1.05 : 0.64);
        const x = r * Math.cos(a),
          z = r * Math.sin(a);
        const variant = i % 4 === 0 ? 6 : rng.int(0, 7);
        add(x, floorAt(x, z), z, rng.uniform(1.21, 1.66), a + Math.PI / 2, variant, floorAt);
      }
    }
  }
  return patches;
}

let material;
/** Поперечный сгиб вдоль жилки, закрутка одной стороны и слегка волнистые
 * кончики лопастей. u идёт поперёк, v — от вершины пластинки к черешку. */
export function dryLeafProfile(u, v, hand) {
  const across = 2*u - 1, span = Math.abs(across);
  const raisedSide = Math.max(0, hand * across);
  const blade = Math.sin(Math.PI * v);
  return 0.13 + 0.23*span + 0.49*raisedSide*raisedSide
    + 0.45*(1-v)*(1-v) + blade*(0.16 + 0.19*across*hand)
    + 0.12*span*span*Math.sin(7.4*v + 2.1*across*hand);
}

function litterMaterial() {
  if (!material)
    material = new THREE.MeshLambertMaterial({
      map: litterAtlas(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -0.7,
      polygonOffsetUnits: -1,
    });
  return material;
}

export function createLeafLitter(plants, site, floorAt, roadHalf) {
  const patches = collectPatches(plants, site, floorAt, roadHalf),
    samples = makeArrangements();
  const positions = [],
    uvs = [],
    indices = [];
  function vertex(p, co, si, x, y, z, cell, u, v) {
    const wx = p.x + co * x - si * z,
      wz = p.z + si * x + co * z;
    positions.push(wx, (p.surface ? p.surface(wx, wz) : p.y) + y, wz);
    uvs.push(((cell % 4) + u) / 4, 1 - (Math.floor(cell / 4) + v) / ATLAS_ROWS);
  }
  for (const patch of patches) {
    const { size, turn, variant } = patch,
      co = Math.cos(turn),
      si = Math.sin(turn);
    const heap = !!patch.height;
    let start = positions.length / 3;
    patch.farStart = indices.length;
    const cols = heap ? 6 : 1, rows = heap ? 4 : 1, cell = (heap ? 16 : 8) + variant;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const u = i / cols, v = heap ? 0.09 + 0.82*j/rows : j/rows;
      const rise = heap ? 0.83 * patch.height * heapProfile(u-0.5, v-0.5, variant) : 0;
      vertex(patch, co, si, (u-0.5)*size, 0.003 + rise, (v-0.5)*size, cell, u, v);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = start + j*(cols+1) + i, b = k+cols+1;
      indices.push(k, b, k+1, k+1, b, b+1);
    }
    patch.farCount = indices.length - patch.farStart;
    patch.nearStart = heap ? patch.farStart : indices.length;
    const cluster = heap ? heapArrangements()[variant] : samples[variant];
    for (let n = 0; n < cluster.length; n++) {
      const leaf = cluster[n];
      const ca = Math.cos(leaf.turn),
        sa = Math.sin(leaf.turn),
        s = leaf.size * size;
      // Нижний сухой лист прижат массой, средний сохраняет сгиб вдоль жилки,
      // верхний дополнительно поднят и свёрнут у черешка и на концах лопастей.
      const exposed = heap ? leaf.layer === 2 : leaf.curl > 0.08;
      const bladesAcross = exposed ? 4 : heap && leaf.layer === 0 ? 1 : 2;
      const bladesAlong = exposed ? 4 : heap && leaf.layer < 2 ? 1 : 2;
      start = positions.length / 3;
      for (let j = 0; j <= bladesAlong; j++)
        for (let i = 0; i <= bladesAcross; i++) {
          const u = i / bladesAcross,
            v = j / bladesAlong,
            dx = (u - 0.5) * s * leaf.width,
            dz = (v - 0.5) * s;
          const bend = dryLeafProfile(u, v, leaf.flip);
          const x = size * leaf.x + dx * ca - dz * sa, z = size * leaf.z + dx * sa + dz * ca;
          let lift = 0.0017 + (0.0019 * n) / cluster.length + leaf.curl * s * bend;
          if (heap) {
            const rise = heapProfile(x/size,z/size,variant);
            lift += patch.height*rise*(0.69+0.135*leaf.layer) + s*(0.5-v)*leaf.tilt;
            lift = Math.max(0.003, lift);
          }
          vertex(patch, co, si, x, lift, z, leaf.cell, u, v);
        }
      for (let j = 0; j < bladesAlong; j++)
        for (let i = 0; i < bladesAcross; i++) {
          const k = start + j*(bladesAcross+1) + i, b = k+bladesAcross+1;
          indices.push(k, b, k+1, k+1, b, b+1);
        }
    }
    patch.nearCount = indices.length - patch.nearStart;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const Index = positions.length / 3 > 65535 ? Uint32Array : Uint16Array,
    bank = new Index(indices);
  g.setIndex(new THREE.BufferAttribute(bank, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  // Одна группа за вызов. Обновляются только индексы при переходе между ярусами.
  const draw = new THREE.BufferAttribute(new Index(indices.length), 1).setUsage(THREE.DynamicDrawUsage);
  g.setIndex(draw);
  for (const p of patches) {
    p.bound = new THREE.Sphere(new THREE.Vector3(p.x, p.y + (p.height ?? 0.05)/2, p.z), p.size * 0.76 + 0.3);
    p.farIndices = bank.subarray(p.farStart, p.farStart + p.farCount);
    p.nearIndices = bank.subarray(p.nearStart, p.nearStart + p.nearCount);
  }
  const mesh = new THREE.Mesh(g, litterMaterial());
  mesh.name = 'autumnLeafLitter';
  mesh.receiveShadow = true;
  const updateRange = { start: 0, count: 0 };
  function reindex() {
    let count = 0;
    for (const p of patches) {
      if (p.distant) continue;
      const page = p.near ? p.nearIndices : p.farIndices;
      draw.array.set(page, count);
      count += page.length;
    }
    g.setDrawRange(0, count);
    mesh.visible = count > 0;
    if (count) {
      draw.clearUpdateRanges();
      updateRange.count = count;
      draw.updateRanges.push(updateRange);
      draw.needsUpdate = true;
    }
  }
  reindex();
  const last = new THREE.Vector3(Infinity, Infinity, Infinity),
    pose = new THREE.Quaternion();
  const frustum = new THREE.Frustum(),
    vp = new THREE.Matrix4();
  let projX = 0,
    projY = 0;
  function update(camera) {
    if (!camera) return;
    const proj = camera.projectionMatrix;
    if (
      last.distanceToSquared(camera.position) < 0.12 &&
      Math.abs(pose.dot(camera.quaternion)) > 0.99998 &&
      projX === proj.elements[0] &&
      projY === proj.elements[5]
    )
      return;
    last.copy(camera.position);
    pose.copy(camera.quaternion);
    projX = proj.elements[0];
    projY = proj.elements[5];
    frustum.setFromProjectionMatrix(vp.multiplyMatrices(proj, camera.matrixWorldInverse));
    let changed = false;
    for (const p of patches) {
      const d = last.distanceToSquared(p.bound.center);
      const near = d < (p.near ? 15 * 15 : 13 * 13),
        distant = d > 115 * 115 || !frustum.intersectsSphere(p.bound);
      if (near !== p.near || distant !== !!p.distant) {
        p.near = near;
        p.distant = distant;
        changed = true;
      }
    }
    if (changed) reindex();
  }
  return { mesh, update };
}
