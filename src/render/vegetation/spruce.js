// Ель общая у парка меню и города. Под плотной хвоей меняется лишь поперечное
// сечение ствола. У земли наплывы корней плавно продолжают основную поверхность.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { FLORA } from '../menu/floraData.js';
import { VegetationBuilder } from './geometry.js';
import { VEG_GEN } from './atlas.js';

const cache = new Map(), TAU = 2 * Math.PI;
const pos = new THREE.Vector3(), normal = new THREE.Vector3(), color = new THREE.Color();
const white = new THREE.Color(1, 1, 1);
const FROSTED_NEEDLE = new THREE.Color(0.30, 0.345, 0.335);
const FROSTED_INTERIOR = new THREE.Color(.70,.77,.77);
const bend = (y, h) => THREE.MathUtils.clamp(y / h, 0, 1);
const BASE = new THREE.Color('#967664'), DARK = new THREE.Color('#534337'), FROST = new THREE.Color('#dde5eb');
const tangent = new THREE.Vector3(), radial = new THREE.Vector3();
const { clamp, smoothstep } = THREE.MathUtils;
const COLLAR_Y = 0.32;
const ROOT_RINGS = [0, 0.005, 0.014, 0.028, 0.047, 0.073, 0.105, 0.143, 0.185, 0.230, 0.278, 0.330, 0.39, 0.46, 0.54];
const SECTOR = 18;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const arch = (offset, width) => Math.exp(-1.58 * (offset/width)**2);

// Нижний ствол, наплывы и корни — непрерывная поверхность. Радиальные полосы
// сближаются у гребня каждого корня и огибают его по мере поворота под землёй.
function spruceTrunk(b, variant, snow) {
  const rng = createRng(672 + variant), roots = [], phase = 1.31 * variant;
  for (let i = 0; i < 5; i++) roots.push({
    a: TAU * (i + rng.uniform(-0.14, 0.14)) / 5 + phase,
    reach: rng.uniform(0.28, 0.44), width: rng.uniform(0.069, 0.099),
    lift: rng.uniform(0.114, 0.164), turn: rng.uniform(-0.44, 0.46),
    fork: i === 1 ? 0.36 : i === 3 ? -0.43 : 0,
  });
  const columns = roots.length * SECTOR;
  const collarRadius = (a) => 0.142 + 0.004 * Math.cos(3*a + phase) + 0.003 * Math.sin(5*a - phase);
  const turnAt = (root, d) => root.a + root.turn * smoothstep(d / root.reach, 0, 1.13);

  function surface(d, column) {
    const sector = Math.floor(column / SECTOR), root = roots[sector];
    const t = (column % SECTOR) / (SECTOR/2) - 1;
    const neighbor = roots[(sector + (t > 0 ? 1 : 4)) % 5];
    const center = turnAt(root, d), other = turnAt(neighbor, d);
    const spread = Math.abs(t) * (0.61 + 0.39*t*t);
    const a = center + wrap(other - center) * spread * 0.5;
    const progress = d / root.reach, r = collarRadius(a) + d;
    const width = root.width * (1 - 0.55 * smoothstep(progress, 0.05, 0.98));
    const cross = r * Math.sin(a-center);
    // Лесные ели могут раздваивать часть корней. Обе ветви постепенно уходят под грунт.
    let ridge = arch(cross, width) * (1 - smoothstep(progress, 0.49, 1.06));
    if (root.fork) {
      const fork = center + root.fork * smoothstep(progress, 0.24, 0.89);
      const branch = arch(r * Math.sin(a-fork), width*0.72) *
        smoothstep(progress, 0.19, 0.44) * (1-smoothstep(progress, 0.52, 0.90));
      ridge = Math.hypot(ridge, 0.85*branch);
    }
    const barkFoot = -0.049 + (COLLAR_Y + 0.049) * Math.exp(-d/0.018);
    const shoulder = root.lift * ridge * (1 - Math.exp(-d/0.025)) / (1 + 1.07*progress);
    const exposed = barkFoot + shoulder;
    const y = exposed * (0.84 + 0.16*smoothstep(Math.abs(exposed), 0, 0.045));
    return new THREE.Vector3(r*Math.cos(a), y, r*Math.sin(a));
  }

  const grid = ROOT_RINGS.map((d) => Array.from({ length: columns }, (_, k) => surface(d, k)));
  const index = (row, k) => row*(columns+1)+k;
  const seam = Math.atan2(grid[0][0].z, grid[0][0].x);
  for (let row = 0; row < grid.length; row++) {
    const strip = grid[row], d = ROOT_RINGS[row];
    let previous = seam;
    const shift = wrap(Math.atan2(strip[0].z, strip[0].x) - seam);
    for (let j = 0; j <= columns; j++) {
      const k = j % columns, p = strip[k];
      const a = previous + wrap(Math.atan2(p.z, p.x) - previous);
      previous = a;
      tangent.subVectors(strip[(k+1)%columns], strip[(k+columns-1)%columns]);
      radial.subVectors(grid[Math.min(row+1, grid.length-1)][k], grid[Math.max(row-1,0)][k]);
      normal.crossVectors(tangent, radial).normalize();
      const u = (a - seam - shift) / TAU;
      const y = p.y, up = clamp(normal.y, 0, 1);
      color.copy(DARK).lerp(BASE, 0.46 + 0.17 * up + 0.25 * smoothstep(y, 0.08, 0.74));
      if (snow) {
        const shelter = 0.68 + 0.18*Math.sin(3*a - 8*d) + 0.14*Math.cos(5*a + 22*d);
        const powder = (0.04 + 0.74*smoothstep(d, 0.036, 0.235)) * smoothstep(up, 0.24, 0.94);
        color.lerp(FROST, powder*shelter);
      }
      b.push(p, normal, -2-u, y-0.86*d, color, bend(y,3.85), 0);
      if (!row || !j) continue;
      // Эти ячейки с большим запасом ушли под реальную плоскость земли.
      const prev = grid[row-1];
      if (Math.max(p.y,strip[j-1].y,prev[k].y,prev[j-1].y) < -0.028) continue;
      const i = index(row-1,j-1), n = index(row,j-1);
      b.idx.push(i, i+1, n, i+1, n+1, n);
    }
  }

  // Первый ряд комля и первый ряд корней используют те же самые вершины.
  let lower = 0, lowerCount = columns;
  for (const [y, n] of [[0.45, 48], [0.74, 32], [1.18, 16], [2.05, 8], [3.18, 6]]) {
    const base = b.count;
    for (let j = 0; j <= n; j++) {
      const a = seam + TAU*j/n, c = Math.cos(a), s = Math.sin(a);
      const r = collarRadius(a) - (y-COLLAR_Y)*0.034;
      pos.set(r*c+0.012*(y-COLLAR_Y), y, r*s+0.007*(y*y-COLLAR_Y*COLLAR_Y));
      const dr = (-0.012*Math.sin(3*a + phase) + 0.015*Math.cos(5*a-phase)) / r;
      normal.set(c+s*dr, 0.034-0.012*c-0.014*y*s, s-c*dr).normalize();
      color.copy(DARK).lerp(BASE, 0.46+0.25*smoothstep(y,0.08,0.74));
      b.push(pos, normal, -2-j/n, y, color, bend(y,3.85), 0);
    }
    let i = 0, j = 0;
    while (i < lowerCount || j < n) {
      if (j < n && (i === lowerCount || (j+1)*lowerCount <= (i+1)*n)) {
        b.idx.push(lower+i, base+j, base+j+1);
        j++;
      } else {
        b.idx.push(lower+i, base+j, lower+i+1);
        i++;
      }
    }
    lower = base;
    lowerCount = n;
  }
}

// Лапа плавно опускается от ствола; снизу у прямоугольника атласа остаются отдельные кончики хвои.
// По краям под снегом проступает приглушённая серая хвоя. Блики и просветы даёт сам рисунок хвои.
function bough(b, rect, rng, y, r, a, h, lod, snow) {
  const base = b.count, across = lod === 0 ? 2 : 1, along = lod === 2 ? 1 : 2, width = rng.uniform(0.36, 0.55);
  const reach = rng.uniform(0.86, 1.07), droop = rng.uniform(0.32, 0.57);
  const cover = snow ? rng.uniform(0.36, 1) : 0, offset = rng.uniform(0,.12);
  const ca = Math.cos(a), sa = Math.sin(a);
  for (let row = 0; row <= along; row++) {
    const t = row / along, d = r * (0.035 + t * reach);
    const apex = row === 0;
    for (let col = 0; col <= (apex ? 0 : across); col++) {
      const s = apex ? 0 : col / across * 2 - 1, edge = Math.abs(s);
      const w = r * s * width * (0.60 + 0.40 * Math.sin(0.2 + 2.76 * t));
      pos.set(ca * d - sa * w, y - r * (droop * t * t + 0.10 * edge * t), sa * d + ca * w);
      normal.set(ca * t * 0.7 - sa * s * 0.35, 0.95, sa * t * 0.7 + ca * s * 0.35).normalize();
      const snowCover = cover * Math.max(0, 1 - edge * 0.38 - t * t * 0.48);
      // Лапы удерживают разное количество снега; тени на концах и внутри кроны имеют зимнюю палитру.
      if (snow) color.copy(FROSTED_NEEDLE).lerp(white, snowCover).multiplyScalar(1 + snowCover * 1.55);
      else color.copy(white);
      const u = rect[0] + (rect[2] - rect[0]) * (.5 + (offset>.06 ? .5 : -.5)*s);
      const v = rect[3] + (rect[1] - rect[3]) * (offset + (1-offset)*t);
      b.push(pos, normal, u, v, color, bend(pos.y, h), snow ? 0 : 1, r * t * t * 0.12);
    }
  }
  // Внутренние кромки лап сходятся у ствола, скрытого густой хвоей.
  // Вдали на каждую лапу здесь хватает одной вершины, концы вокруг кроны остаются на своих осях.
  for (let col = 0; col < across; col++) b.idx.push(base, base + 1 + col, base + 2 + col);
  const first = base + 1, rows = along - 1;
  for (let row = 0; row < rows; row++) for (let col = 0; col < across; col++) {
    const j = first + row * (across + 1) + col, next = j + across + 1;
    b.idx.push(j, next, j + 1, j + 1, next, next + 1);
  }
}

export function spruceGeometry(variant, lod, snow = false) {
  const key = variant + 4 * lod + (snow ? 16 : 0);
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now(), b = new VegetationBuilder(true);
  const { tiers, base_r: radius } = FLORA.conifers[variant], h = 3.85;
  const bark = new THREE.Color('#855438'), rect = FLORA.rects['conifer' + variant], rng = createRng(FLORA.conifers[variant].seed);
  if (lod === 0) spruceTrunk(b, variant, snow);
  else b.solid(new THREE.CylinderGeometry(0.045, 0.13, h * 0.82, 5, 1, true).translate(0, h * 0.41, 0), () => bark, (y) => bend(y, h), 0);
  for (let k = 0; k < tiers; k++) {
    if (lod === 2 && k % 2 && k < tiers - 1) continue;
    const t = k / (tiers - 1), r = h * (0.06 + radius * (1 - t) ** 0.95);
    const y = h * (0.29 + 0.70 * t ** 0.8), n = Math.round([13, 10, 7][lod] * (1 - 0.37 * t));
    for (let j = 0; j < n; j++) {
      const a = k * 0.77 + Math.PI * 2 * (j + rng.uniform(-0.23, 0.23)) / n;
      bough(b, FLORA.rects.spruceSpray, rng, y + rng.uniform(-0.055, 0.025), r, a, h, lod, snow);
    }
  }
  // У ближней ели живая хвоя на окраине опускается ниже центра, под осью открыт ствол.
  const foot = lod === 0 ? 0.14 * h : 0;
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI / 3, base = b.count;
    normal.set(-Math.sin(a) * 0.36, 0.93, Math.cos(a) * 0.36).normalize();
    for (const [side, t] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      const w = side * h * radius * (lod===0 ? .71 : .91);
      pos.set(Math.cos(a) * w, foot + t * (h - foot), Math.sin(a) * w);
      b.push(pos, normal, rect[side < 0 ? 0 : 2], rect[t === 0 ? 1 : 3], snow ? FROSTED_INTERIOR : white, t, snow ? 0 : 1, t * 0.04);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.cards++;
  }
  const g = b.build(`cityFlora:pine:${variant}:L${lod}${snow ? ':snow' : ''}`, { kind: 'pine', variant, lod });
  VEG_GEN.ms += performance.now() - t0;
  cache.set(key, g);
  return g;
}
