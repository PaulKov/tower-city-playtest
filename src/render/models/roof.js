// Процедурные крыши. Начало координат — центр низа крыши (верх последнего этажа).
// Черепица, фронтоны, настилы и парапеты — на материале стен (меш walls, спецификация «Детализация домов» §5.5).
// Геометрия кэшируется в общем LRU этажей и крыш (floor.cachedGeometry, предел по байтам) и принадлежит кэшу.
import * as THREE from 'three';
import { createRng, hashSeed } from '../../core/rng.js';
import * as G from '../geomUtils.js';
import { mat, PALETTE, windowPiece, markFacadeFinish } from '../materials.js';
import { floorBodyColor, DOWNPIPE, cachedGeometry, shopLettering } from './floor.js';
import { WALL, LAYER_MEAN, asWall, mergeWalls, wallMaterial } from '../houses/walls.js';

export const ROOF_STYLES = ['house', 'shop', 'office', 'tower'];
const FOR_STYLE = { quick0: 'house', quick1: 'house', quick2: 'shop', quick3: 'tower', nightTower: 'tower' };
/** Стили, у которых фронтон двускатной крыши свой (цвет корпуса этажа); остальные берут цвет house. */
const GABLE_STYLES = new Set(['house', 'quick0', 'quick1']);
/**
 * Цвет настила и парапета на слое панелей: делённый на среднюю светлоту слоя. Раньше они были отделкой без текстуры,
 * так их средний тон не меняется.
 */
const panelTone = (c) => new THREE.Color(c).multiplyScalar(1 / LAYER_MEAN[WALL.panel]);

/** Ветровая доска: толщина и спуск ниже плиты черепицы; радиус полутрубы водостока (§5.5). */
const BARGE_W = 0.03, BARGE_DROP = 0.06, GUTTER_R = 0.06;

/** Размеры двускатной крыши: конёк вдоль длинной стороны L, пролёт S, высота H, свес o, толщина плиты t, уклон a. */
function pitch(w, d) {
  const along = w >= d, L = along ? w : d, S = along ? d : w;
  const H = Math.min(1.35, 0.25 + S * 0.3), o = Math.min(0.14, S * 0.1 + 0.02), t = 0.09;
  const a = Math.atan2(H, S / 2), hyp = Math.hypot(S / 2, H);
  return { along, L, S, H, o, t, a, hyp, ridgeY: H + t / Math.cos(a) };
}

/**
 * Водосток у свеса +z (координаты до поворота): z — верхняя кромка свеса (ось желоба), y — верх желоба на 4 мм ниже
 * нижней кромки плиты, half — полудлина (торцы на 5 мм внутри торцов плиты).
 */
function gutterAt(p) {
  const len = p.hyp + p.o;
  const low = p.ridgeY - len * Math.sin(p.a) - p.t * Math.cos(p.a);
  return { z: len * Math.cos(p.a), y: low - 0.004, half: p.L / 2 + p.o - 0.005 };
}

/** Коробки обоих водостоков двускатной крыши w × d в её координатах (после поворота). */
export function houseGutters(w, d) {
  w = round2(w); d = round2(d);
  const p = pitch(w, d), g = gutterAt(p);
  return [1, -1].map((s) => {
    const min = new THREE.Vector3(-g.half, g.y - GUTTER_R, s * g.z - GUTTER_R);
    const max = new THREE.Vector3(g.half, g.y, s * g.z + GUTTER_R);
    // поворот на 90° (конёк вдоль z) меняет x и z местами: диапазон по x симметричен
    if (!p.along) { [min.x, min.z] = [min.z, min.x]; [max.x, max.z] = [max.z, max.x]; }
    return new THREE.Box3(min, max);
  });
}

/** Тип крыши для стиля этажа. */
export function roofStyleFor(style) {
  return ROOF_STYLES.includes(style) ? style : FOR_STYLE[style] || 'shop';
}

// ---------- house: скатная черепичная крыша с фронтонами и трубой ----------
function houseRoof(w, d, style) {
  const p = pitch(w, d), { along, L, S, H, o, t, a, hyp, ridgeY } = p;
  const walls = [], trim = [], glass = [];
  for (const ry of [0, Math.PI]) {
    const len = hyp + o;
    const g = G.place(G.roundedBox(L + 2 * o, t, len, 0.035, 1), { z: len / 2, y: -t / 2 });
    asWall(g, WALL.tiles, PALETTE.roofRed); // UV до поворота: v растёт от конька вниз по скату (Task 2)
    G.place(g, { rx: a });
    walls.push(G.place(g, { y: ridgeY, ry }));
  }
  // ветровые доски (§5.5): снаружи торцов плиты с зазором 0,004, от конька до свеса; доски второго ската — ещё
  // на 0,004 дальше: у конька доски сходятся, и их грани не совпадают
  for (const [k, ry] of [[0, 0], [1, Math.PI]]) for (const s of [-1, 1]) {
    const len = hyp + o, bh = t + BARGE_DROP + 0.01;
    const g = G.place(G.box(BARGE_W, bh, len, PALETTE.white), { x: s * (L / 2 + o + 0.004 * (k + 1) + BARGE_W / 2), y: 0.01 - bh / 2, z: len / 2 });
    G.place(g, { rx: a });
    trim.push(G.place(g, { y: ridgeY, ry }));
  }
  // водостоки: полутрубы под капельником вдоль обоих свесов, сверху — тёмная «вода»; труба этажа (downpipeAt) входит в них
  const gu = gutterAt(p);
  for (const s of [1, -1]) {
    const len = 2 * gu.half;
    const half = new THREE.CylinderGeometry(GUTTER_R, GUTTER_R, len, 16, 1, false, Math.PI, Math.PI);
    trim.push(G.place(G.colored(half, DOWNPIPE), { y: gu.y, z: s * gu.z, rz: Math.PI / 2 }));
    trim.push(G.place(G.colored(new THREE.PlaneGeometry(len, 2 * GUTTER_R - 0.004), '#4a525c'), { y: gu.y - 0.006, z: s * gu.z, rx: -Math.PI / 2 }));
  }
  const shape = new THREE.Shape([new THREE.Vector2(-S / 2, 0), new THREE.Vector2(S / 2, 0), new THREE.Vector2(0, H)]);
  const gable = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
  G.place(gable, { z: -L / 2 });
  G.place(gable, { ry: Math.PI / 2 });
  walls.push(asWall(gable, WALL.plaster, floorBodyColor(style))); // фронтон — штукатурка цвета корпуса (отличие 6)
  const ridge = L + 2 * o + 0.02, caps = Math.max(1, Math.round(ridge / 0.32)), capLength = ridge / caps;
  for (let i = 0; i < caps; i++) {
    const cap = G.colored(new THREE.CylinderGeometry(0.079, 0.062, capLength + (i > 0 ? 0.015 : 0), 12, 1, true, 0, Math.PI), i % 3 === 1 ? '#b95040' : '#c65a47');
    trim.push(G.place(cap, { x: -ridge / 2 + (i + 0.5) * capLength, y: ridgeY, rz: Math.PI / 2 }));
  }
  if (S >= 1.4 && H >= 0.6) {
    const r = Math.min(0.2, H * 0.25), y = H * 0.36;
    for (const s of [1, -1]) {
      const x = s * L / 2;
      trim.push(G.place(G.cylinder(r + 0.05, r + 0.05, 0.03, 16, PALETTE.white), { x: x + s * 0.025, y, rz: Math.PI / 2 }));
      trim.push(G.place(G.box(0.012, r * 2, 0.04, PALETTE.white), { x: x + s * 0.052, y }));
      trim.push(G.place(G.box(0.012, 0.04, r * 2, PALETTE.white), { x: x + s * 0.052, y }));
      glass.push(windowPiece(G.place(G.cylinder(r, r, 0.01, 16), { x: x + s * 0.045, y, rz: Math.PI / 2 }), { lit: 0.9 }));
    }
  }
  if (L >= 1.2 && S >= 1.2) {
    const cz = S * 0.2, cx = L * 0.22;
    const surf = H * (1 - (2 * cz) / S);
    const top = H + 0.35, bottom = surf - 0.2;
    const flashing = G.place(G.box(0.45, 0.021, 0.47, '#787b78'), { rx: a });
    trim.push(G.place(flashing, { x: cx, y: surf + 0.105 / Math.cos(a), z: cz }));
    trim.push(G.place(G.roundedBox(0.34, top - bottom, 0.34, 0.04, 1, '#c4654f'), { x: cx, y: (top + bottom) / 2, z: cz }));
    trim.push(G.place(G.roundedBox(0.44, 0.08, 0.44, 0.03, 1, '#6f4a3c'), { x: cx, y: top + 0.03, z: cz }));
    trim.push(G.place(G.box(0.24, 0.02, 0.24, '#2e2420'), { x: cx, y: top + 0.075, z: cz }));
  }
  const rot = along ? 0 : Math.PI / 2;
  const turn = (g) => (rot ? G.place(g, { ry: rot }) : g);
  return [
    { name: 'walls', geom: mergeWalls(walls.map(turn)), mat: 'walls' },
    { name: 'trim', geom: G.mergeColored(trim.map(turn)), mat: 'trim' },
    glass.length && { name: 'glass', geom: G.mergeColored(glass.map(turn)), mat: 'windows', cast: false },
  ];
}

// ---------- общий плоский настил с парапетом (слой панелей) ----------
function flatBase(walls, w, d, deck, parapet) {
  const pt = Math.min(0.1, Math.min(w, d) * 0.2), dc = panelTone(deck), pc = panelTone(parapet);
  walls.push(asWall(G.place(G.roundedBox(w, 0.08, d, 0.03, 1), { y: 0.04 }), WALL.panel, dc));
  for (const s of [1, -1]) {
    walls.push(asWall(G.place(G.roundedBox(w + 0.04, 0.26, pt, 0.025, 1), { y: 0.13, z: s * (d / 2 + 0.02 - pt / 2) }), WALL.panel, pc));
    // боковые стенки чуть ниже и чуть внутри торцов передней/задней — без совпадающих граней
    walls.push(asWall(G.place(G.roundedBox(pt, 0.25, d + 0.04 - pt, 0.025, 1), { y: 0.125, x: s * (w / 2 + 0.014 - pt / 2) }), WALL.panel, pc));
  }
  return pt;
}

// ---------- shop: плоская крыша, бочка для воды, антенна, вывеска ----------
function shopRoof(w, d) {
  const walls = [], trim = [], m = Math.min(w, d);
  flatBase(walls, w, d, '#d9d2c5', PALETTE.white);
  if (m >= 1.0) {
    const R = Math.min(0.42, m * 0.16), cx = -w * 0.22, cz = -d * 0.2;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      trim.push(G.beam([cx + sx * R * 0.7, 0.08, cz + sz * R * 0.7], [cx + sx * R * 0.6, 0.56, cz + sz * R * 0.6], 0.06, PALETTE.woodDark));
    }
    trim.push(G.place(G.cylinder(R + 0.04, R + 0.04, 0.06, 16, PALETTE.woodDark), { x: cx, y: 0.56, z: cz }));
    const shell = G.cylinder(R, R, 0.8, 32, PALETTE.wood);
    const stave = shell.getAttribute('color'), uv = shell.getAttribute('uv');
    for (let i = 0; i < stave.count; i++) {
      const board = Math.round(uv.getX(i) * 32), shade = [0.81, 1.02, 0.86, 1.07, 0.94][board % 32 % 5];
      stave.setXYZ(i, stave.getX(i) * shade, stave.getY(i) * shade, stave.getZ(i) * shade);
    }
    trim.push(G.place(shell, { x: cx, y: 0.99, z: cz }));
    for (const y of [0.76, 1.01, 1.25]) {
      const band = G.colored(new THREE.CylinderGeometry(R + 0.008, R + 0.008, 0.031, 32, 1, true), '#596063');
      trim.push(G.place(band, { x: cx, y, z: cz }));
    }
    trim.push(G.place(G.cone(R + 0.07, 0.36, 16, PALETTE.woodDark), { x: cx, y: 1.57, z: cz }));
    trim.push(G.place(G.sphere(0.05, 8, 6, PALETTE.woodDark), { x: cx, y: 1.77, z: cz }));
  }
  if (m >= 0.6) {
    const ax = w * 0.28, az = -d * 0.22; // сзади, подальше от вывески
    trim.push(G.beam([ax, 0.08, az], [ax, 1.35, az], 0.035, PALETTE.steel));
    for (const [y, l] of [[0.9, 0.42], [1.12, 0.3]]) trim.push(G.place(G.box(l, 0.025, 0.025, PALETTE.steel), { x: ax, y, z: az }));
    trim.push(G.place(G.sphere(0.05, 8, 6, PALETTE.craneRed), { x: ax, y: 1.38, z: az }));
  }
  if (w >= 1.2) {
    const sw = Math.min(w * 0.6, 2.4), sz = d / 2 - 0.28;
    for (const s of [-1, 1]) trim.push(G.beam([s * sw * 0.32, 0.08, sz], [s * sw * 0.32, 0.5, sz], 0.05, PALETTE.steelDark));
    trim.push(G.place(G.roundedBox(sw, 0.45, 0.07, 0.03, 1, '#fff6e8'), { y: 0.7, z: sz }));
    trim.push(G.place(G.roundedBox(sw - 0.1, 0.35, 0.08, 0.025, 1, PALETTE.shop), { y: 0.7, z: sz }));
    trim.push(shopLettering('ЛАВКА', sw - 0.18, Math.min(0.23, sw * 0.15), 0.7, sz + 0.043, '#fff1d8'));
  }
  return [{ name: 'walls', geom: mergeWalls(walls), mat: 'walls' }, { name: 'trim', geom: G.mergeColored(trim), mat: 'trim' }];
}

// ---------- office: сад на крыше ----------
function officeRoof(w, d) {
  const walls = [], trim = [], rng = createRng(hashSeed('roof', 'office', w.toFixed(2), d.toFixed(2)));
  const pt = flatBase(walls, w, d, '#cfd6dd', '#dfe6ee');
  const iw = Math.max(0.05, w - 2 * pt - 0.06), id = Math.max(0.05, d - 2 * pt - 0.06);
  trim.push(G.place(G.roundedBox(iw, 0.1, id, 0.03, 1, PALETTE.grass), { y: 0.12 }));
  const maxR = Math.max(0.05, Math.min(0.32, Math.min(iw, id) * 0.25));
  const count = Math.max(1, Math.min(10, Math.round(iw * id * 0.9)));
  const colors = [PALETTE.leaf, PALETTE.grassDark, PALETTE.leafPine];
  for (let i = 0; i < count; i++) {
    const r = rng.uniform(maxR * 0.6, maxR);
    const x = rng.uniform(-iw / 2 + r, iw / 2 - r), z = rng.uniform(-id / 2 + r, id / 2 - r);
    trim.push(G.place(G.sphere(r, 10, 8, rng.pick(colors)), { x, y: 0.17 + r * 0.6, z }));
    if (rng.next() < 0.4) trim.push(G.place(G.sphere(r * 0.22, 6, 4, rng.pick(['#ff6f91', '#ffd166', '#ffffff'])), { x: x + r * 0.5, y: 0.17 + r * 1.2, z: z + r * 0.4 }));
  }
  if (Math.min(iw, id) >= 1.6) {
    const tx = iw * 0.25, tz = -id * 0.2;
    trim.push(G.place(G.cylinder(0.07, 0.1, 0.8, 8, PALETTE.trunk), { x: tx, y: 0.57, z: tz }));
    trim.push(G.place(G.sphere(0.45, 12, 9, PALETTE.leaf), { x: tx, y: 1.15, z: tz }));
    trim.push(G.place(G.sphere(0.32, 10, 8, PALETTE.grassDark), { x: tx + 0.3, y: 0.98, z: tz + 0.1 }));
    const bx = -iw * 0.15, bz = id * 0.25;
    for (const [k, tone] of ['#a57752', '#b4865b', '#a77b55'].entries()) {
      trim.push(G.place(G.roundedBox(0.7, 0.045, 0.072, 0.006, 1, tone), { x: bx, y: 0.36, z: bz + (k - 1) * 0.082 }));
    }
    for (const s of [-1, 1]) trim.push(G.place(G.box(0.05, 0.2, 0.2, PALETTE.steelDark), { x: bx + s * 0.28, y: 0.24, z: bz }));
  }
  return [{ name: 'walls', geom: mergeWalls(walls), mat: 'walls' }, { name: 'trim', geom: G.mergeColored(trim), mat: 'trim' }];
}

// ---------- tower: ступенчатая корона, золотой шпиль, огонёк ----------
function towerRoof(w, d, style) {
  const trim = [], gold = [], glass = [], m = Math.min(w, d);
  const night = style === 'nightTower';
  const tiers = [[0.92, 0.45], [0.62, 0.5], [0.36, 0.4]];
  let y = 0;
  tiers.forEach(([k, h], i) => {
    const tw = w * k, td = d * k;
    // Верхнее оборудование утоплено за отливом. На уступе под ним roofSpot оставляет 20 мм на вылет от грани яруса.
    const inset = night && i > 0 ? Math.min(0.041, tw * 0.15, td * 0.15) : 0;
    trim.push(G.place(G.roundedBox(tw - 2 * inset, h, td - 2 * inset, 0.012, 1, night ? '#657078' : '#fff1d0'), { y: y + h / 2 }));
    if (night) trim.push(G.place(G.box(tw + 0.036, 0.024, td + 0.036, '#a6987f'), { y: y + h - 0.022 }));
    else {
      trim.push(G.place(G.box(tw + 0.024, 0.022, td + 0.024, '#816f54'), { y: y + h - 0.045 }));
      trim.push(G.place(G.roundedBox(tw + 0.036, 0.036, td + 0.036, 0.005, 1, '#c6ab71'), { y: y + h - 0.022 }));
    }
    if (i === 0 && h > 0.3) {
      for (const [len, dist, ry] of [[tw, td / 2, 0], [td, tw / 2, Math.PI / 2], [tw, td / 2, Math.PI], [td, tw / 2, -Math.PI / 2]]) {
        if (len < 0.4) continue;
        const bays = Math.ceil((len - 0.24) / (night ? 0.67 : 0.59)), step = (len - 0.24) / bays;
        for (let j = 0; j < bays; j++) {
          const g = G.place(new THREE.PlaneGeometry(step * 0.90, 0.18), { x: (j + 0.5 - bays / 2) * step, y: y + 0.2, z: 0.012 });
          glass.push(G.place(windowPiece(g, night ? { glow: '#e1caad', lit: j % 3 === 1 ? 0.15 : 0.44, room: 1 } : { lit: j % 3 === 1 ? 0.13 : 0.84, interior: 8 + j % 4 }), { x: dist * Math.sin(ry), z: dist * Math.cos(ry), ry }));
        }
      }
    }
    if (night && i > 0) {
      for (const [len, dist, ry] of [[tw, td / 2, 0], [td, tw / 2, Math.PI / 2], [tw, td / 2, Math.PI], [td, tw / 2, -Math.PI / 2]]) {
        if (len < 0.45) continue;
        const face = { x: (dist - inset) * Math.sin(ry), z: (dist - inset) * Math.cos(ry), ry };
        const panel = G.place(G.box(len * 0.72, h * 0.54, 0.028, '#283e50'), { y: y + h * 0.45, z: 0.006 });
        trim.push(G.place(panel, face));
        for (const level of [0.32, 0.47, 0.62]) {
          const slat = G.place(G.box(len * 0.71, 0.027, 0.046, '#738695'), { y: y + h * level, z: 0.03, rx: -0.24 });
          trim.push(G.place(slat, face));
        }
      }
    }
    y += h;
  });
  if (night) {
    // Техническая надстройка с опорой и телескопической мачтой. Уступ для крышного украшения остаётся на 0,45.
    const radius = Math.min(0.21, m * 0.128), mast = 0.92 + m * 0.32;
    trim.push(G.place(G.cylinder(radius * 0.64, radius, 0.42, 12, '#758896'), { y: y + 0.21 }));
    trim.push(G.place(G.cylinder(radius * 0.39, radius * 0.59, mast * 0.55, 12, '#aab9bc'), { y: y + 0.42 + mast * 0.275 }));
    trim.push(G.place(G.cylinder(radius * 0.12, radius * 0.38, mast * 0.45, 10, '#c6c9bd'), { y: y + 0.42 + mast * 0.775 }));
    const beaconRadius = Math.min(0.072, Math.max(0.025, radius * 0.5));
    return [
      { name: 'trim', geom: markFacadeFinish(G.mergeColored(trim)), mat: 'facadeTrim' },
      { name: 'beacon', geom: G.place(G.sphere(beaconRadius, 12, 8), { y: y + 0.42 + mast }), mat: 'beacon', cast: false },
      glass.length && { name: 'glass', geom: G.mergeColored(glass), mat: 'officeWindows', cast: false },
    ];
  }
  // луковица, воротник (прячет стык), игла
  const r = Math.max(0.06, m * 0.13), R = r * 1.15, sh = 1.2 + m * 0.35;
  const yc = y + R * 0.8, yk = yc + R * 0.92;
  // Медная выкружка с двенадцатью стоячими фальцами; швы сходятся у воротника шпиля.
  const dome = new THREE.SphereGeometry(R, 48, 14);
  const p = dome.getAttribute('position'), uv = dome.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const seam = Math.round(uv.getX(i) * 48) % 4 === 0 ? 1.04 : 1;
    p.setXYZ(i, p.getX(i) * seam, p.getY(i), p.getZ(i) * seam);
  }
  dome.computeVertexNormals();
  gold.push(G.place(dome, { y: yc }));
  gold.push(G.place(G.cylinder(r * 0.5, r * 0.56, 0.08, 16), { y: yk }));
  gold.push(G.place(G.cone(r * 0.45, sh, 16), { y: yk + 0.04 + sh / 2 }));
  const beacon = G.place(G.sphere(0.1, 12, 8), { y: yk + 0.04 + sh + 0.04 });
  return [
    { name: 'trim', geom: G.mergeColored(trim), mat: 'trim' },
    { name: 'gold', geom: G.mergeColored(gold), mat: 'gold' },
    { name: 'beacon', geom: beacon, mat: 'beacon', cast: false },
    glass.length && { name: 'glass', geom: G.mergeColored(glass, { rooms: true }), mat: 'windows', cast: false },
  ];
}

const BUILDERS = { house: houseRoof, shop: shopRoof, office: officeRoof, tower: towerRoof };
const roofGeoms = (parts) => parts.map((p) => p.geom);

const round2 = (v) => Math.max(0.05, Math.round((Number.isFinite(v) ? v : 4) * 100) / 100);

const material = (key) => (key === 'walls' ? wallMaterial() : mat(key));

/** Крыша для стиля этажа (house|shop|office|tower или quick0..3). */
export function buildRoof(style, w, d) {
  const type = roofStyleFor(style);
  w = round2(w); d = round2(d);
  // у двускатной крыши цвет фронтона — цвет корпуса стиля, он в геометрии: стиль входит в ключ (отличие 6)
  const body = type === 'house' ? (GABLE_STYLES.has(style) ? style : 'house') : style === 'nightTower' ? style : '';
  const parts = cachedGeometry(`roof|${type}|${w.toFixed(2)}|${d.toFixed(2)}|${body}`, () => BUILDERS[type](w, d, body).filter(Boolean), roofGeoms);
  const group = new THREE.Group();
  group.name = 'roof';
  for (const p of parts) {
    const m = new THREE.Mesh(p.geom, material(p.mat));
    m.name = p.name;
    m.castShadow = p.cast !== false;
    m.receiveShadow = true;
    group.add(m);
  }
  group.userData = { style: type, w, d };
  return group;
}
