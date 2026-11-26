// Гаванный катер с транцевой кормой, гнутой палубой и застеклённой рубкой.
// Нос направлен вдоль +X, вода на y=0. Все части объединены в одну индексированную сетку.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from '../geomUtils.js';

const PAINT = 0, WOOD = 1, GLASS = 2, METAL = 3, RUBBER = 4;
const IVORY = '#e9dfc5', TEAK = '#a97648', MAHOGANY = '#78503a', CHROME = '#b9c4bd';
const BRASS = '#bf9959', SEAL = '#303e40', PANE = '#304d57';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), cache = [];

// Шпангоуты от транца до форштевня: x, полуширина у планширя, высота борта, глубина киля.
const OFFSETS = [
  [-1.29, 0.300, 0.272, -0.116], [-1.16, 0.343, 0.261, -0.144],
  [-0.94, 0.386, 0.246, -0.177], [-0.66, 0.410, 0.237, -0.202],
  [-0.30, 0.423, 0.240, -0.217], [0.07, 0.422, 0.252, -0.223],
  [0.39, 0.397, 0.272, -0.219], [0.67, 0.346, 0.294, -0.200],
  [0.90, 0.269, 0.326, -0.164], [1.07, 0.176, 0.354, -0.124],
  [1.20, 0.082, 0.376, -0.082], [1.29, 0.004, 0.387, -0.052],
];
const COCKPIT_AFT = -1.08, COCKPIT_END = -0.46, COCKPIT_FRAC = 0.70;
const LERP = THREE.MathUtils.lerp;

// Кубическая интерполяция ординат по продольным станциям. Вид сбоку и полушироты сходятся к одному штевню.
function station(x) {
  let j = 0;
  while (j + 2 < OFFSETS.length && OFFSETS[j + 1][0] < x) j++;
  const p = OFFSETS[j], q = OFFSETS[j + 1], a = OFFSETS[Math.max(0, j - 1)], b = OFFSETS[Math.min(OFFSETS.length - 1, j + 2)];
  const dx = q[0] - p[0], t = THREE.MathUtils.clamp((x - p[0]) / dx, 0, 1), t2 = t * t, t3 = t2 * t;
  const at = k => (2 * t3 - 3 * t2 + 1) * p[k] + (-2 * t3 + 3 * t2) * q[k]
    + (t3 - 2 * t2 + t) * dx * (q[k] - a[k]) / (q[0] - a[0])
    + (t3 - t2) * dx * (b[k] - p[k]) / (b[0] - p[0]);
  return { x, beam: at(1), sheer: at(2), keel: at(3) };
}

function deckPoint(st, frac, lift = 0) {
  return V(st.x, st.sheer + 0.020 * (1 - frac * frac) + lift, frac * st.beam);
}

function shell(st, y, side) {
  const above = THREE.MathUtils.clamp((y - st.keel) / (st.sheer - st.keel), 0, 1);
  const beam = st.beam * (1 - (1 - above) ** 3.15) ** 0.76;
  const rake = 0.11 * THREE.MathUtils.smoothstep(st.x, 0.64, 1.29) - 0.050 * (1 - THREE.MathUtils.smoothstep(st.x, -1.29, -1.02));
  return V(st.x - rake * (1 - above), y, side * Math.max(0.002, beam));
}

// Поверхность на прямоугольной сетке. Независимые материалы и острые швы используют отдельные поверхности.
function patch(columns, rows, at, reverse = false) {
  const pos = [], uv = [], index = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const p = at(i, j);
    pos.push(p.x, p.y, p.z); uv.push(p.x, p.z);
    if (i && j) {
      const d = j * columns + i, c = d - 1, b = d - columns, a = b - 1;
      if (reverse) index.push(a, c, b, c, d, b);
      else index.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  return g;
}

const quad = (a, b, c, d, reverse = false) => patch(2, 2, (i, j) => j ? (i ? c : d) : (i ? b : a), reverse);

class Boat {
  constructor(lod) {
    this.close = lod === 0;
    this.parts = [];
  }
  add(g, color, layer) {
    G.colored(g, color);
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(layer), 1));
    this.parts.push(g);
  }
  box(w, h, d, x, y, z, color, layer, rotation = {}) {
    this.add(G.place(G.boxUv(G.box(w, h, d)), { x, y, z, ...rotation }), color, layer);
  }
  cushion(w, h, d, x, y, z, color, rz = 0) {
    const g = this.close ? mergeVertices(G.roundedBox(w, h, d, 0.013, 1)) : G.box(w, h, d);
    this.add(G.place(g, { x, y, z, rz }), color, RUBBER);
  }
  rod(a, b, radius, color, layer, top = radius, sides = this.close ? 8 : 5) {
    const direction = b.clone().sub(a), length = direction.length();
    const g = G.cylinder(top, radius, length, sides);
    if (layer === WOOD) {
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getY(i), uv.getX(i) * 2 * Math.PI * radius);
    }
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.divideScalar(length)));
    const center = a.clone().lerp(b, 0.5);
    this.add(g.translate(center.x, center.y, center.z), color, layer);
  }
  tube(points, radius, color, layer, steps, sides = this.close ? 6 : 4) {
    const curve = new THREE.CatmullRomCurve3(points);
    this.add(new THREE.TubeGeometry(curve, steps, radius, sides, false), color, layer);
  }
}

function stations(close) {
  const x = OFFSETS.map(s => s[0]);
  if (close) for (let i = 1; i < OFFSETS.length; i++) x.push((OFFSETS[i - 1][0] + OFFSETS[i][0]) / 2);
  x.push(COCKPIT_AFT, COCKPIT_END);
  return x.sort((a, b) => a - b).map(station);
}

function hull(b, sts) {
  // Подводная медно-красная окраска, узкая светлая полоса у ватерлинии, тёмная эмаль борта.
  const rows = [
    [s => s.keel, s => s.keel * 0.70, s => s.keel * 0.34, () => 0.013],
    [() => 0.013, () => 0.030],
    [() => 0.030, s => s.sheer * 0.50, s => s.sheer * 0.78, s => s.sheer],
  ], colors = ['#9c5443', '#d7c8a3', '#244852'];
  for (let k = 0; k < rows.length; k++) {
    const levels = rows[k];
    for (const side of [-1, 1]) {
      b.add(patch(sts.length, levels.length, (i, j) => shell(sts[i], levels[j](sts[i]), side), side < 0), colors[k], PAINT);
    }
    for (const [st, reverse] of [[sts[0], true], [sts.at(-1), false]]) {
      b.add(patch(2, levels.length, (i, j) => shell(st, levels[j](st), i ? -1 : 1), reverse), colors[k], PAINT);
    }
  }
  // Гребень киля соединяет края днища, у носа видна обратная сторона наклонного штевня.
  b.add(patch(sts.length, 2, (i, j) => shell(sts[i], sts[i].keel, j ? 1 : -1)), '#703e34', PAINT);
  for (const side of [-1, 1]) {
    const edging = sts.map(st => deckPoint(st, side, -0.014));
    b.tube(edging, 0.022, MAHOGANY, WOOD, b.close ? 30 : 10);
    if (b.close) {
      b.tube(edging.map(p => V(p.x, p.y + 0.001, p.z + side * 0.016)), 0.006, BRASS, METAL, 28, 5);
      b.add(patch(sts.length, 2, (i, j) => {
        const p = shell(sts[i], sts[i].sheer - (j ? 0.047 : 0.057), side);
        p.z += side * 0.0018;
        return p;
      }, side < 0), '#c9b27e', PAINT);
    }
  }
}

function deck(b, sts) {
  const palette = ['#b98c5e', '#c0946a', '#ab8055', '#bf9365', '#b78c62'];
  const planks = b.close ? 10 : 3;
  for (let k = -planks; k < planks; k++) {
    // Центральный настил прерывается кокпитом; боковые проходы непрерывны от кормы до носа.
    const inside = Math.abs((k + 0.5) / planks) < COCKPIT_FRAC;
    const runs = inside ? [sts.filter(s => s.x <= COCKPIT_AFT), sts.filter(s => s.x >= COCKPIT_END)] : [sts];
    for (const run of runs) {
      const start = k / planks, seam = start + (b.close ? 0.004 : 0);
      if (b.close) b.add(patch(run.length, 2, (i, j) => deckPoint(run[i], j ? seam : start), true), '#57493a', WOOD);
      b.add(patch(run.length, 2, (i, j) => deckPoint(run[i], j ? (k + 1) / planks : seam), true), palette[Math.abs(k + 1) % palette.length], WOOD);
    }
  }
  const aft = station(COCKPIT_AFT), front = station(COCKPIT_END);
  const half = b.close ? COCKPIT_FRAC : 2 / 3;
  const opening = [deckPoint(aft, -half), deckPoint(aft, half), deckPoint(front, half), deckPoint(front, -half)];
  for (let i = 0; i < 4; i++) {
    const a = opening[i], c = opening[(i + 1) % 4], d = V(a.x, 0.105, a.z), e = V(c.x, 0.105, c.z);
    b.add(quad(a, c, e, d), '#c9b79a', PAINT);
    b.rod(a, c, 0.013, MAHOGANY, WOOD);
  }
  b.add(quad(...opening.map(p => V(p.x, 0.108, p.z))), '#71543d', WOOD);
  if (b.close) for (let j = 0; j < 7; j++) {
    const t0 = j / 7 + 0.004, t1 = (j + 1) / 7 - 0.004;
    const floor = [opening[0].clone().lerp(opening[1], t0), opening[0].clone().lerp(opening[1], t1),
      opening[3].clone().lerp(opening[2], t1), opening[3].clone().lerp(opening[2], t0)];
    b.add(quad(...floor.map(p => V(p.x, 0.110, p.z))), palette[j % palette.length], WOOD);
  }
  const seatW = station(-0.980).beam * 2 * half - 0.045;
  b.box(0.15, 0.099, seatW, -0.980, 0.159, 0, '#b5a789', PAINT);
  b.cushion(0.158, 0.038, seatW + 0.006, -0.980, 0.224, 0, '#c9ad85');
  b.cushion(0.046, 0.114, 0.418, -1.056, 0.254, 0, '#bfa582', 0.09);
  // Низкий бортовой рундук оставляет свободный проход к двери рубки.
  b.box(0.340, 0.089, 0.123, -0.676, 0.156, -0.192, IVORY, PAINT);
  b.box(0.344, 0.018, 0.132, -0.676, 0.208, -0.192, TEAK, WOOD);
}

// Ходовая рубка в плане обходится по контуру против часовой стрелки при взгляде сверху.
function cabinSection(t, roof = false) {
  const z = LERP(0.320, 0.292, t) + (roof ? 0.033 : 0);
  const aft = -0.445 - (roof ? 0.047 : 0), nose = LERP(0.554, 0.394, t) + (roof ? 0.041 : 0);
  const shoulder = nose - 0.101, y = LERP(0.251, 0.774, t);
  return [[aft, -z + 0.026], [aft + 0.032, -z], [shoulder, -z], [nose, -z * 0.65], [nose + 0.023, 0],
    [nose, z * 0.65], [shoulder, z], [aft + 0.032, z], [aft, z - 0.026]].map(([x, s]) => V(x, y, s));
}

function wallPoint(t, face, u) {
  const rim = cabinSection(t);
  return rim[face].lerp(rim[(face + 1) % rim.length], u);
}

function cabinWindow(b, face, u0, u1, t0, t1) {
  const a = wallPoint(t0, face, u0), c = wallPoint(t0, face, u1), d = wallPoint(t1, face, u0);
  const out = d.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const width = a.distanceTo(c) / (u1 - u0), sections = b.close ? 3 : 1;
  const contour = (margin, lift) => {
    const du = Math.min(0.15 * (u1 - u0), margin / width), dt = margin / 0.52;
    const r = Math.min(0.016, (u1 - u0 - 2 * du) * width * 0.15);
    const ru = r / width, rt = r / 0.52, left = u0 + du + ru, right = u1 - du - ru;
    const low = t0 + dt + rt, high = t1 - dt - rt, pts = [];
    for (const [corner, [u, t]] of [[left, low], [left, high], [right, high], [right, low]].entries()) {
      for (let j = 0; j <= sections; j++) {
        const angle = (3 - corner - j / sections) * Math.PI * 0.5;
        pts.push(wallPoint(t + rt * Math.sin(angle), face, u + ru * Math.cos(angle)).addScaledVector(out, lift));
      }
    }
    return pts;
  };
  // Деревянный штапик выступает над стеклом. Наружная фаска, резина и стекло имеют общий контур.
  const mount = contour(0, 0.003), rebate = contour(0.014, 0.010), seal = contour(0.018, 0.007), n = seal.length;
  const frame = (outer, inner, color, layer) => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.add(G.boxUv(quad(outer[i], outer[j], inner[j], inner[i])), color, layer);
    }
  };
  if (b.close) {
    const bevel = contour(0.004, 0.014);
    frame(mount, bevel, TEAK, WOOD); frame(bevel, rebate, MAHOGANY, WOOD); frame(rebate, seal, SEAL, RUBBER);
  } else frame(mount, seal, MAHOGANY, WOOD);
  const index = [];
  for (let i = 0; i < n; i++) index.push(i, (i + 1) % n, n);
  const g = new THREE.BufferGeometry().setFromPoints([...seal, wallPoint((t0 + t1) / 2, face, (u0 + u1) / 2).addScaledVector(out, 0.007)]);
  g.setIndex(index); g.computeVertexNormals();
  b.add(g, PANE, GLASS);
}

function cabinRoof(b) {
  const corners = cabinSection(1, true), n = corners.length, rim = [];
  for (let i = 0; i < n; i++) {
    const p = corners[i], prev = corners[(i + n - 1) % n], next = corners[(i + 1) % n];
    const a = p.clone().lerp(prev, Math.min(0.32, 0.029 / p.distanceTo(prev)));
    const c = p.clone().lerp(next, Math.min(0.32, 0.029 / p.distanceTo(next)));
    const curve = new THREE.QuadraticBezierCurve3(a, p, c);
    rim.push(...curve.getPoints(b.close ? 3 : 1));
  }
  const topY = z => 0.809 + 0.028 * (1 - (z / 0.327) ** 2);
  const top = rim.map(p => V(p.x * 0.992, topY(p.z * 0.983), p.z * 0.983));
  const lower = rim.map(p => V(p.x, p.y + 0.012, p.z));
  // Боковая окантовка подходит вплотную к выпуклой панели.
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    b.add(quad(rim[i], lower[i], lower[j], rim[j]), '#425951', PAINT);
    b.add(quad(lower[i], top[i], top[j], lower[j]), '#cdcaba', PAINT);
  }
  const position = [], uv = [], index = [], m = top.length;
  for (const scale of [1, 0.6]) for (const p of top) {
    const x = p.x * scale, z = p.z * scale;
    position.push(x, topY(z), z); uv.push(x, z);
  }
  position.push(0, topY(0), 0); uv.push(0, 0);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    index.push(i, i + m, j, j, i + m, j + m, i + m, 2 * m, j + m);
  }
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  cap.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cap.setIndex(index); cap.computeVertexNormals();
  b.add(cap, '#e7e1cf', PAINT);
}

function cabin(b) {
  const lower = cabinSection(0), upper = cabinSection(1), n = lower.length;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    b.add(quad(lower[i], upper[i], upper[next], lower[next]), IVORY, PAINT);
  }
  for (const face of [1, 6]) {
    cabinWindow(b, face, 0.064, 0.47, 0.38, 0.94);
    cabinWindow(b, face, 0.50, 0.94, 0.38, 0.94);
  }
  for (const face of [2, 3, 4, 5]) cabinWindow(b, face, 0.05, 0.95, 0.39, 0.94);
  // Сдвижная кормовая дверь и низкая деревянная отбортовка.
  b.box(0.022, 0.40, 0.228, -0.452, 0.491, -0.020, TEAK, WOOD);
  b.box(0.010, 0.174, 0.171, -0.468, 0.607, -0.020, SEAL, RUBBER);
  b.box(0.008, 0.156, 0.151, -0.475, 0.607, -0.020, PANE, GLASS);
  if (b.close) {
    b.rod(V(-0.479, 0.435, 0.067), V(-0.479, 0.466, 0.067), 0.006, BRASS, METAL);
    for (const s of [-1, 1]) {
      const z = 0.313 * s;
      b.rod(V(-0.42, 0.407, z), V(0.395, 0.407, z), 0.010, TEAK, WOOD);
    }
  }
  cabinRoof(b);
}

function porthole(b, x, side) {
  const y = 0.171, st = station(x), center = shell(st, y, side);
  const dx = shell(station(x + 0.002), y, side).sub(shell(station(x - 0.002), y, side));
  const dy = shell(st, y + 0.002, side).sub(shell(st, y - 0.002, side));
  const outward = dx.cross(dy).normalize().multiplyScalar(side), q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), outward);
  center.addScaledVector(outward, 0.0045);
  b.add(new THREE.CircleGeometry(0.029, 18).applyQuaternion(q).translate(center.x, center.y, center.z), PANE, GLASS);
  center.addScaledVector(outward, 0.001);
  b.add(new THREE.TorusGeometry(0.029, 0.006, 6, 18).applyQuaternion(q).translate(center.x, center.y, center.z), BRASS, METAL);
}

function lifebuoy(b) {
  // Уложен за мачтой и прихвачен к рымам; четыре светлые перевязи видны и с берега.
  const r = 0.082, tube = 0.023;
  for (let i = 0; i < 4; i++) {
    const angle = 0.21 + i * Math.PI / 2;
    for (const [start, length, color] of [[angle, 0.37, '#e6dac0'], [angle + 0.37, Math.PI / 2 - 0.37, '#b94f32']]) {
      const g = new THREE.TorusGeometry(r, tube, b.close ? 8 : 4, Math.max(2, Math.ceil(length * (b.close ? 8 : 2.4))), length);
      g.rotateZ(start).rotateX(-Math.PI / 2).translate(-0.309, 0.854, 0.046);
      b.add(g, color, RUBBER);
    }
  }
  if (b.close) for (const s of [-1, 1]) {
    b.tube([V(-0.329, 0.840, 0.046 + s * 0.115), V(-0.328, 0.873, 0.046 + s * 0.088),
      V(-0.328, 0.870, 0.046 + s * 0.070), V(-0.330, 0.841, 0.046 + s * 0.050)], 0.0042, '#a49675', RUBBER, 6, 4);
  }
}

function fittings(b) {
  // Невысокий носовой релинг оставляет проход вдоль рубки. Обе дуги соединены над форштевнем.
  for (const s of [-1, 1]) {
    const rail = [];
    for (const x of [0.13, 0.53, 0.87, 1.09, 1.24]) {
      const w = station(x), p = deckPoint(w, s * 0.94);
      const head = V(p.x + 0.014, p.y + 0.166, p.z);
      rail.push(head);
      if (x !== 1.09) b.rod(p, head, b.close ? 0.006 : 0.009, CHROME, METAL);
    }
    rail.push(V(1.267, 0.539, 0));
    b.tube(rail, 0.010, CHROME, METAL, b.close ? 15 : 7);
    if (b.close) {
      porthole(b, 0.69, s);
      // Два подвесных кранца на каждой стороне, с концами, заведёнными за привальный брус.
      for (const x of [-0.73, 0.18]) {
        const st = station(x), z = s * (st.beam + 0.032), y = st.sheer - 0.070;
        const fender = G.capsule(0.026, 0.086, 4, 10, '#c5c2ad');
        b.add(G.place(fender, {x, y, z, rz: x < 0 ? 0.19 : -0.14}), '#c5c2ad', RUBBER);
        b.rod(V(x, y + 0.046, z), V(x + 0.018, st.sheer + 0.014, s * (st.beam - 0.022)), 0.0052, '#c5bda5', RUBBER, 0.0052, 5);
      }
      // Ручни на крыше и цветные ходовые огни в тёмных кожухах.
      const z = s * 0.20;
      b.tube([V(-0.33, 0.832, z), V(-0.30, 0.872, z), V(-0.23, 0.879, z), V(0.18, 0.879, z), V(0.24, 0.867, z), V(0.25, 0.832, z)], 0.008, CHROME, METAL, 14);
      b.box(0.064, 0.025, 0.025, 0.20, 0.817, 0.307 * s, SEAL, RUBBER);
      b.box(0.039, 0.021, 0.016, 0.20, 0.833, 0.310 * s, s > 0 ? '#397e68' : '#aa4836', PAINT);
    }
  }
  // Световой люк на баке и короткая мачта с топовым огнём.
  const hatchY = station(0.72).sheer + 0.030;
  b.box(0.226, 0.031, 0.224, 0.72, hatchY, 0, MAHOGANY, WOOD, {rz: 0.09});
  b.box(0.185, 0.019, 0.187, 0.72, hatchY + 0.019, 0, '#405b62', GLASS, {rz: 0.09});
  b.rod(V(-0.13, 0.837, 0), V(-0.176, 1.187, 0), 0.018, TEAK, WOOD, 0.009);
  b.rod(V(-0.176, 1.185, 0), V(-0.177, 1.208, 0), 0.016, '#eadfc4', GLASS, 0.014);
  lifebuoy(b);
  // Палубные утки сидят на ножках, рожки выступают с обоих концов.
  for (const [x, z] of [[-1.16, 0.205], [-1.16, -0.205], [1.055, 0]]) {
    const st = station(x), y = deckPoint(st, z / st.beam).y + 0.004;
    b.box(0.104, 0.009, 0.038, x, y, z, CHROME, METAL);
    if (b.close) for (const k of [-0.022, 0.022]) b.rod(V(x + k, y, z), V(x + k, y + 0.028, z), 0.010, CHROME, METAL);
    else b.box(0.040, 0.025, 0.016, x, y + 0.014, z, CHROME, METAL);
    b.rod(V(x - 0.071, y + 0.029, z), V(x + 0.071, y + 0.029, z), 0.011, CHROME, METAL);
  }
  if (!b.close) return;
  for (const z of [-0.063, 0.063]) b.box(0.035, 0.009, 0.014, 0.815, hatchY + 0.036, z, BRASS, METAL);
  const vent = deckPoint(station(0.53), 0.5);
  b.rod(vent, V(vent.x, vent.y + 0.046, vent.z), 0.020, BRASS, METAL);
  b.rod(V(vent.x, vent.y + 0.035, vent.z), V(vent.x, vent.y + 0.052, vent.z), 0.039, BRASS, METAL, 0.024, 14);
  b.rod(V(-0.145, 0.985, -0.060), V(-0.145, 0.985, 0.060), 0.007, BRASS, METAL);
  // Лобовые дворники и небольшой латунный прожектор.
  for (const face of [3, 4]) {
    const a = wallPoint(0.88, face, 0.31), e = wallPoint(0.51, face, 0.67);
    a.x += 0.014; e.x += 0.014;
    b.rod(a, e, 0.0042, SEAL, RUBBER, 0.0042, 5);
  }
  const light = V(0.245, 0.877, -0.091);
  b.rod(V(light.x, 0.836, light.z), light, 0.013, BRASS, METAL);
  b.rod(V(light.x - 0.025, light.y, light.z), V(light.x + 0.034, light.y, light.z), 0.027, BRASS, METAL, 0.036, 12);
  b.rod(V(light.x + 0.034, light.y, light.z), V(light.x + 0.037, light.y, light.z), 0.029, '#e7e1c2', GLASS, 0.029, 12);
}

/** Одна неизменяемая модель для всех причалов. L0 для улицы, L1 для дальнего плана. */
export function harborBoatGeometry(lod = 0) {
  const level = lod ? 1 : 0;
  if (cache[level]) return cache[level];
  const b = new Boat(level), sts = stations(b.close);
  hull(b, sts); deck(b, sts); cabin(b); fittings(b);
  const g = G.mergeColored(b.parts, { layer: true });
  for (const p of b.parts) p.dispose();
  g.name = 'harbor:boat:L' + level;
  g.userData.shared = true;
  return cache[level] = g;
}
