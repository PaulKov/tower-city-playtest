// Прибрежный кустарник Гавайев: наупака с листьями в розетках и стелющаяся по песку ипомея.
// Обе модели окрашены по вершинам. Форму ложковидных и двулопастных листьев задаёт сама сетка.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { VegetationBuilder } from './geometry.js';
import { VEG_GEN } from './atlas.js';

const cache = new Map(), TAU = 2 * Math.PI, UP = new THREE.Vector3(0, 1, 0);
const tone = (hex) => new THREE.Color(hex);
const SHRUB = ['#517b52', '#669661', '#799e61', '#54865d', '#91a95e'].map(tone);
const VINE = ['#417d65', '#529268', '#668f64'].map(tone);
const TWIG = tone('#80785a'), RUNNER = tone('#916e63'), VEIN = tone('#a7ba7b');
const IVORY = tone('#fff6e4'), FAN_BASE = tone('#e6da9f');
const THROAT = tone('#652c81'), PLEAT = tone('#a447ad'), PETAL = tone('#eb87d6'), RAY = tone('#f6b1eb');
const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
const bend = (y) => Math.min(0.7, Math.max(0, y * 0.75));

function vertex(b, at, normal, color, flex, tip = 0) {
  b.push(at, normal, -1, -1, color, flex, 0, tip);
}

function stem(b, start, end, r, wood, lod = 0) {
  const base = b.count, axis = end.clone().sub(start).normalize();
  const side = new THREE.Vector3(axis.z, 0, -axis.x);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  if (lod === 2) {
    for (const [point, width] of [[start, r], [end, r * 0.6]]) for (const sign of [-1, 1]) {
      p.copy(point).addScaledVector(side, width * sign);
      vertex(b, p, UP, wood, bend(point.y));
    }
    b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    return;
  }
  const other = new THREE.Vector3().crossVectors(side, axis);
  const sides = lod === 0 ? 4 : 3;
  for (const [point, width] of [[start, r], [end, r * 0.66]]) for (let i = 0; i < sides; i++) {
    const a = TAU * i / sides;
    n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a));
    p.copy(point).addScaledVector(n, width);
    vertex(b, p, n, wood, bend(point.y));
  }
  for (let i = 0; i < sides; i++) {
    const x = base + i, y = base + (i + 1) % sides;
    b.idx.push(x, x + sides, y, y, x + sides, y + sides);
  }
}

// Координаты по длине и поперёк пластинки. У ипомеи выемка разделяет широкий конец на две округлые доли.
const SPOON = [[0, 0], [0.35, -0.39], [0.73, -1], [0.95, -0.63], [1, 0], [0.93, 0.67], [0.69, 0.99], [0.36, 0.43]];
const MID_SPOON = [[0, 0], [0.34, -0.42], [0.77, -1], [1, -0.29], [0.95, 0.61], [0.68, 1]];
const SIMPLE = [[0, 0], [0.68, -0.96], [1, 0], [0.70, 1]];
const ROSETTE_LEAF = [SPOON, MID_SPOON, SIMPLE];
const BILOBED = [[0, 0], [0.23, -0.76], [0.63, -1], [1, -0.57], [0.74, 0], [0.97, 0.59], [0.62, 1], [0.2, 0.72]];
function blade(b, at, angle, length, width, rise, color, outline, lod, roll) {
  const base = b.count, ca = Math.cos(angle), sa = Math.sin(angle), flex = bend(at.y);
  const point = (t, s, spine) => {
    // Светлая жилка приподнимается ближе к основанию, наружу мясистая пластинка раскрывается в чашечку.
    const cup = length * (0.13 * Math.abs(s) ** 1.5 + 0.08 * Math.sin(Math.PI * t) + roll * s);
    p.set(at.x + ca * t * length - sa * s * width, at.y + t * rise + cup, at.z + sa * t * length + ca * s * width);
    n.set(-ca * rise / length - sa * s * 0.39, 1, -sa * rise / length + ca * s * 0.39).normalize();
    c.copy(color).lerp(VEIN, spine ? 0.24 : 0.05 * t).multiplyScalar(0.76 + 0.25 * t + 0.08 * s);
    vertex(b, p, n, c, flex + 0.14 * t, length * 0.65 * t * t);
  };
  for (const [t, s] of outline) point(t, s, false);
  if (lod > 0) {
    for (let i = 1; i < outline.length - 1; i++) b.idx.push(base, base + i + 1, base + i);
  } else {
    const spine = b.count;
    point(0.47, 0, true);
    for (let i = 0; i < outline.length; i++) b.idx.push(spine, base + (i + 1) % outline.length, base + i);
  }
}

// У наупаки пять лепестков с одной стороны трубки: белый полувеер среди молодых листьев.
function fan(b, at, angle) {
  const base = b.count;
  vertex(b, at, UP, FAN_BASE, bend(at.y));
  for (let i = 0; i < 5; i++) {
    const a = angle + (i - 2) * 0.62, dx = Math.cos(a), dz = Math.sin(a), j = b.count;
    for (const [reach, side] of [[0.031, -0.012], [0.056, 0], [0.032, 0.013]]) {
      p.set(at.x + dx * reach - dz * side, at.y + reach * 0.4, at.z + dz * reach + dx * side);
      vertex(b, p, UP, IVORY, bend(at.y), reach * 0.6);
    }
    b.idx.push(base, j + 1, j, base, j + 2, j + 1);
  }
}

function rosette(b, at, seed, lod, length, flower) {
  const rng = createRng(seed), nLeaves = [7, 5, 4][lod], axis = rng.uniform(0, TAU);
  for (let j = 0; j < nLeaves; j++) {
    const a = axis + TAU * j / nLeaves + rng.uniform(-0.20, 0.20), len = length * rng.uniform(0.82, 1.09);
    const rise = len * rng.uniform(j % 3 === 0 ? 0.66 : -0.12, j % 3 === 0 ? 1.09 : 0.55);
    blade(b, at, a, len, len * rng.uniform(0.29, 0.39) * (1 + lod * 0.15), rise,
      rng.pick(SHRUB), ROSETTE_LEAF[lod], lod, rng.uniform(-0.09, 0.09));
  }
  if (flower && lod === 0) {
    const throat = at.clone().add(new THREE.Vector3(0.026, 0.045, 0.017));
    stem(b, at, throat, 0.009, FAN_BASE, 2);
    fan(b, throat, axis);
  }
}

function naupaka(b, hedge, variant, lod) {
  const nShoots = hedge ? 5 : 4, phase = variant * 1.85 + 0.24;
  for (let i = 0; i < nShoots + (hedge ? 0 : 1); i++) {
    const a = phase + TAU * i / nShoots, center = i === nShoots, ca = Math.cos(a), sa = Math.sin(a);
    const x = hedge ? (i - 2) * 0.46 : 0, side = i % 2 ? 1 : -1;
    const foot = new THREE.Vector3(x + (hedge ? 0.02 * side : 0.11 * ca), 0, hedge ? 0 : 0.10 * sa);
    const joint = new THREE.Vector3(x + (hedge ? 0.03 * side : 0.21 * ca), hedge ? 0.22 : 0.24, hedge ? side * 0.035 : 0.18 * sa);
    const top = new THREE.Vector3(x + (hedge ? 0.02 * ca : center ? 0.03 : 0.38 * ca),
      hedge ? 0.49 + 0.035 * ca : center ? 0.76 : 0.49 + 0.08 * sa, hedge ? side * 0.08 : center ? -0.045 : 0.38 * sa);
    if (center && lod > 0) stem(b, foot, top, 0.034, TWIG, lod);
    else {
      stem(b, foot, joint, 0.034, TWIG, lod);
      stem(b, joint, top, 0.029, TWIG, lod);
    }
    const seed = 832 + variant * 173 + i * 41;
    rosette(b, top, seed, lod, hedge ? 0.215 : 0.27, i % 3 === 0);
    if (center) continue;
    const sideTip = new THREE.Vector3(x + (hedge ? side * 0.18 : 0.34 * ca - 0.28 * sa), hedge ? 0.34 : 0.34 + 0.04 * ca,
      hedge ? -side * 0.15 : 0.34 * sa + 0.28 * ca);
    stem(b, joint, sideTip, 0.02, TWIG, lod);
    rosette(b, sideTip, seed + 19, lod, hedge ? 0.196 : 0.245, false);
  }
}

// Воронка ипомеи с пятью слегка отогнутыми складками: светлые лучи от тёмного зева к розово-лиловому венчику.
function trumpet(b, foot, angle, radius, detailed) {
  const base = b.count, sides = detailed ? 10 : 7, tall = radius * 1.27, dx = Math.cos(angle), dz = Math.sin(angle);
  vertex(b, foot, UP, THROAT, bend(foot.y));
  for (const rim of [false, true]) {
    for (let i = 0; i < sides; i++) {
      const a = TAU * i / sides + angle, ridge = 0.5 + 0.5 * Math.cos(5 * (a - angle));
      const reach = rim ? radius * (0.94 + 0.10 * ridge) : radius * 0.22;
      const y = rim ? tall * (0.92 + 0.08 * ridge) : tall * 0.44;
      p.set(foot.x + dx * y * 0.46 + reach * Math.cos(a), foot.y + y - 0.23 * reach * Math.cos(a - angle),
        foot.z + dz * y * 0.46 + reach * Math.sin(a));
      n.set(-Math.cos(a) * 0.45 + dx * 0.22, 1, -Math.sin(a) * 0.45 + dz * 0.22).normalize();
      c.copy(rim ? PETAL : THROAT).lerp(rim ? RAY : PLEAT, ridge * 0.62);
      vertex(b, p, n, c, bend(foot.y) + (rim ? 0.22 : 0.12), rim ? radius * 0.64 : 0);
    }
  }
  for (let i = 0; i < sides; i++) {
    const a = base + 1 + i, j = base + 1 + (i + 1) % sides;
    b.idx.push(base, j, a, a, j, a + sides, j, j + sides, a + sides);
  }
}

function morningGlory(b, bed) {
  const runners = bed ? 3 : 2, nodes = bed ? 4 : 3;
  for (let i = 0; i < runners; i++) {
    const a = i * TAU / runners + 0.23, ca = Math.cos(a), sa = Math.sin(a);
    let last = new THREE.Vector3(-ca * 0.16, 0, -sa * 0.16);
    for (let j = 0; j < nodes; j++) {
      const t = (j + 1) / nodes, reach = (bed ? 0.72 : 0.62) * t - 0.16;
      const drift = 0.06 * Math.sin(4.5 * t + i), y = 0.055 + 0.025 * Math.sin(2.8 * t + i);
      const node = new THREE.Vector3(reach * ca - drift * sa, y, reach * sa + drift * ca);
      stem(b, last, node, 0.012, RUNNER, 1);
      const leafAngle = a + (j % 2 ? 1.53 : -1.27) + 0.3 * Math.cos(i + j);
      blade(b, node, leafAngle, bed ? 0.20 : 0.17, bed ? 0.096 : 0.081, 0.052 + 0.045 * Math.cos(2 * t),
        VINE[(i + j) % VINE.length], BILOBED, 0, 0.07 * Math.sin(i + j));
      if (j === nodes - 2 && (bed || i === 0)) {
        const stalk = node.clone().add(new THREE.Vector3(0.025 * ca, bed ? 0.093 : 0.074, 0.025 * sa));
        stem(b, node, stalk, 0.012, RUNNER, 1);
        trumpet(b, stalk, a + 0.4, bed ? 0.101 : 0.089, bed);
      }
      last = node;
    }
  }
}

/** Кэш страницы: все посадки одного вида, варианта и уровня используют одну сетку. */
export function coastalGeometry(kind, variant = 0, lod = 0) {
  const key = `coastal:${kind}:${variant}:L${lod}`;
  if (cache.has(key)) return cache.get(key);
  const start = performance.now(), b = new VegetationBuilder(true), hedge = kind === 'hedge';
  if (hedge || kind === 'bush') naupaka(b, hedge, variant, lod);
  else if (kind === 'bed' || kind === 'flowers') morningGlory(b, kind === 'bed');
  else throw new Error('Неизвестное прибрежное растение: ' + kind);
  const g = b.build(key, { kind, variant, lod });
  if (hedge) g.scale(1, 1, 0.87);
  VEG_GEN.ms += performance.now() - start;
  cache.set(key, g);
  return g;
}
