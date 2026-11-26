import { h } from '../../../src/ui/dom.js';

// Coordinates on the illustrated plans. Doors, roads, travellers and plot pins use the same space.
const W = 600,
  H = 370;
const VALLEY = {
  bridge: { number: 1, name: 'У моста', point: [108, 240] },
  orchard: { number: 2, name: 'За яблонями', point: [258, 237] },
  stalls: { number: 3, name: 'У прилавков', point: [366, 205] },
  meadow: { number: 4, name: 'На лугу', point: [188, 304] },
};
const PORT = {
  quay: { number: 1, name: 'У трапа', point: [394, 213] },
  hill: { number: 2, name: 'На террасе', point: [256, 154] },
  yard: { number: 3, name: 'У верфи', point: [257, 285] },
};
const MILL = [463, 196];
const RIDGE = [295, 119];
const WALK = '#a3382d',
  CARGO = '#855025',
  FERRY = '#13546f';
const V_ROADS = [
  ['bridge', 'ridge', [VALLEY.bridge.point, [99, 201], [130, 153], [170, 132], [220, 119], RIDGE]],
  ['ridge', 'market', [RIDGE, [370, 119], [439, 134], [476, 162], MILL]],
  ['bridge', 'orchard', [VALLEY.bridge.point, [163, 250], [207, 249], VALLEY.orchard.point], 'orchard'],
  ['orchard', 'market', [VALLEY.orchard.point, [298, 263], [391, 258], [444, 231], MILL], 'orchard'],
  ['ridge', 'stalls', [RIDGE, [320, 155], [345, 186], VALLEY.stalls.point], 'stalls'],
  ['stalls', 'market', [VALLEY.stalls.point, [413, 211], MILL], 'stalls'],
  ['orchard', 'stalls', [VALLEY.orchard.point, [310, 224], VALLEY.stalls.point], 'pair'],
  ['bridge', 'meadow', [VALLEY.bridge.point, [140, 273], VALLEY.meadow.point], 'meadow'],
  ['meadow', 'market', [VALLEY.meadow.point, [271, 325], [367, 308], [449, 266], MILL], 'meadow'],
];
const PIER = [502, 236],
  CROSSING = [416, 225],
  TURN = [320, 198];
const P_ROUTES = {
  quay: [PORT.quay.point, CROSSING, [454, 226], PIER],
  hill: [PORT.hill.point, [276, 175], TURN, [378, 226], CROSSING, [454, 226], PIER],
  yard: [PORT.yard.point, [318, 283], [381, 251], CROSSING, [454, 226], PIER],
  village: [[110, 150], [173, 157], [218, 183], [271, 178], TURN, [378, 226], CROSSING, [454, 226], PIER],
  depot: [
    [146, 277],
    [207, 301],
    [243, 293],
    PORT.yard.point,
    [318, 283],
    [381, 251],
    CROSSING,
    [454, 226],
    PIER,
  ],
};
const CYCLE = 28,
  MOORED_START = 3,
  MOORED_END = 23,
  SEATS = 30;
const num = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);
const lengthOf = (p) => p.slice(1).reduce((sum, v, i) => sum + Math.hypot(v[0] - p[i][0], v[1] - p[i][1]), 0);
const metres = (pixels) => Math.round(pixels * 0.6);

function activeRoads(houses) {
  const lots = new Set(houses.map((x) => x.lot));
  return V_ROADS.filter(
    ([, , , open]) =>
      !open || lots.has(open) || (open === 'pair' && lots.has('orchard') && lots.has('stalls')),
  );
}

function marketPath(start, roads) {
  const queue = [{ at: start, d: 0, path: [] }],
    seen = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const current = queue.shift();
    if (current.at === 'market') return current.path;
    if (seen.has(current.at)) continue;
    seen.add(current.at);
    for (const [a, b, points] of roads) {
      if (a !== current.at && b !== current.at) continue;
      const oriented = a === current.at ? points : [...points].reverse();
      queue.push({
        at: a === current.at ? b : a,
        d: current.d + lengthOf(points),
        path: [...current.path, ...oriented.slice(current.path.length ? 1 : 0)],
      });
    }
  }
  return [];
}

function trail(points) {
  const ends = [0];
  for (let i = 1; i < points.length; i++)
    ends.push(ends[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, ends, length: ends.at(-1) };
}

function valleyPlan(houses) {
  const roads = activeRoads(houses);
  const routes = houses.map((home) => ({ ...home, trail: trail(marketPath(home.lot, roads)) }));
  const population = houses.reduce((s, x) => s + x.population, 0);
  const distance = population
    ? metres(routes.reduce((s, x) => s + x.trail.length * x.population, 0) / population)
    : 0;
  return { roads, routes, population, distance };
}

// Each delivery must reach a real store before departure. Each passenger needs time to reach the gangway.
function portPlan(houses) {
  const sites = [
    { lot: 'depot', type: 'store', floors: 1 },
    { lot: 'village', type: 'home', population: 2 },
    ...houses,
  ];
  const routes = sites.map((site) => {
    const gangway =
      site.type === 'store'
        ? [
            [507, 241],
            [503, 253],
          ]
        : [
            [492, 231],
            [493, 221],
          ];
    return { ...site, trail: trail([...P_ROUTES[site.lot].slice(0, -1), ...gangway]) };
  });
  const deliveries = [],
    passengers = [];
  for (const route of routes) {
    const duration = route.trail.length / (route.type === 'store' ? 36 : 26);
    if (route.type === 'store') {
      for (let start = MOORED_START + 0.5; start + duration <= MOORED_END; start += duration * 2 + 1) {
        deliveries.push({ route, start, duration, load: Math.min(3, route.floors) });
      }
    } else {
      for (let i = 0; i < Math.min(SEATS, route.population); i++) {
        const start = MOORED_START + i * 1.35;
        if (start + duration <= MOORED_END) passengers.push({ route, start, duration });
      }
    }
  }
  passengers.sort((a, b) => a.start + a.duration - b.start - b.duration);
  passengers.splice(SEATS);
  return {
    routes,
    deliveries,
    passengers,
    boxes: deliveries.reduce((s, x) => s + x.load, 0),
    seats: passengers.length,
  };
}

function available(town, houses) {
  if (houses.length === 3) return [];
  const ids = Object.keys(town);
  return houses.length
    ? ids.slice(1).filter((id) => !houses.some((house) => house.lot === id))
    : ids.slice(0, 1);
}

// Map drawing primitives. The static paper, buildings and roads are painted once per layout or resize.
function path(c, pts, color, width, dash = []) {
  c.beginPath();
  c.moveTo(...pts[0]);
  for (let i = 1; i < pts.length; i++) c.lineTo(...pts[i]);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.setLineDash(dash);
  c.stroke();
  c.setLineDash([]);
}
function shape(c, d, color, stroke, width = 1) {
  const p = new Path2D(d);
  if (color) {
    c.fillStyle = color;
    c.fill(p);
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.stroke(p);
  }
}
function oval(c, x, y, rx, ry, color) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}
function rect(c, x, y, w, h, color) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}
function at(c, x, y, size, paint) {
  c.save();
  c.translate(x, y);
  c.scale(size, size);
  paint();
  c.restore();
}
function seeded(n) {
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
}
function tree(c, x, y, size, apple = false) {
  at(c, x, y, size, () => {
    oval(c, 4, 0, 9, 2.8, '#56804e55');
    rect(c, -1.4, -10, 2.8, 10, '#795639');
    oval(c, 0, -14, 9, 10, '#577e51');
    oval(c, -3.5, -15, 6.2, 6.6, '#79a263');
    oval(c, 1, -19, 5, 5.8, '#8eb06c');
    if (apple)
      for (const [dx, dy] of [
        [-4, -15],
        [4, -12],
        [1, -20],
      ])
        oval(c, dx, dy, 1.4, 1.6, '#bd6346');
  });
}
function palm(c, x, y, scale) {
  at(c, x, y, scale, () => {
    oval(c, 5, 0, 12, 2.4, '#64826d54');
    shape(c, 'M-2 0 Q1 -14 -3 -28 L-1 -30 Q5 -12 2 0Z', '#aa794d');
    for (const tip of [
      [-19, -14],
      [-19, -25],
      [-11, -35],
      [2, -36],
      [14, -33],
      [19, -22],
      [12, -13],
    ]) {
      const [a, b] = tip;
      shape(
        c,
        `M-2 -28 Q${a * 0.55} ${Math.min(-33, b - 5)} ${a} ${b} Q${a * 0.6} -28 -2 -27Z`,
        a < 0 ? '#52845b' : '#42795b',
      );
    }
  });
}
function building(c, x, y, kind, floors = 1, tint = '#bd694f', scale = 1) {
  at(c, x, y, scale, () => {
    const shop = kind === 'market',
      store = kind === 'store';
    const height = 13 + Math.min(4, floors - 1) * 4.5,
      half = store ? 20 : shop ? 17 : 13.5;
    oval(c, 4, -1, half + 6, 4.5, '#52634340');
    rect(c, -half, -height, half * 2, height, store ? '#caae83' : '#f6deb0');
    shape(c, `M${half} 0 l9 -5 v${-height} l-9 5Z`, '#ba9c79');
    shape(c, `M${-half - 3} ${-height} l9 -12 h${half * 2 + 5} l-10 12Z`, tint);
    shape(c, `M${half - 3} ${-height} l10 -12 l6 8 l-3 .7 l-3 -3.5 l-6 8Z`, '#7d584a');
    if (!store) {
      rect(c, half - 6, -height - 15, 3.5, 7, '#af886d');
      for (let row = 0; row < floors && row < 4; row++) {
        if (row && height - row * 4.5 < 5) continue;
        for (const a of [-half + 3, half - 7]) {
          rect(c, a, -height + 2 + row * 4.5, 3.4, 3.2, '#486673');
          rect(c, a, -height + 5.2 + row * 4.5, 4, 0.7, '#fff0d4');
        }
      }
      rect(c, -2, -7, 4.5, 7, '#725e4e');
    } else {
      rect(c, -10, -height + 3, 18, height - 3, '#886e55');
      for (let xx = -8; xx < 8; xx += 4)
        path(
          c,
          [
            [xx, -height + 4],
            [xx, -1],
          ],
          '#aa8762',
          0.7,
        );
      shape(c, 'M-9 -2 l15 -7 M6 -2 l-15 -7', null, '#c5a780', 1);
      rect(c, 12, -height + 3, 5, 4, '#4e6e71');
    }
    if (shop) {
      for (let a = -18, i = 0; i < 8; i++, a += 4.5) {
        shape(c, `M${a} -10 h4.5 l-1.5 5 h-4.5Z`, i % 2 ? '#fbebc9' : '#c4604c');
      }
      rect(c, -18, -5, 1, 6, '#8d6349');
      rect(c, 15, -5, 1, 6, '#8d6349');
      rect(c, -16, -2, 30, 3, '#aa7f52');
      for (let i = 0; i < 6; i++) oval(c, -12 + i * 4, -3, 1.8, 1.6, i % 2 ? '#ae5038' : '#d39a39');
    }
  });
}
function landMarks(c, harbor) {
  const rand = seeded(harbor ? 141 : 69);
  for (let i = 0; i < 420; i++) {
    const x = rand() * W,
      y = rand() * H;
    if (harbor ? x > 360 : x < 76) continue;
    if (i % 5)
      path(
        c,
        [
          [x, y],
          [x + 2 + rand() * 3, y - 0.5],
        ],
        harbor ? '#a5ad755e' : '#88a06666',
        0.75,
      );
    else {
      oval(c, x, y, 1.1, 0.7, '#e8da9a');
      oval(c, x + 2, y + 0.7, 1, 0.6, '#f3e3ae');
    }
  }
}
function road(c, points, narrow = false) {
  path(c, points, narrow ? '#a59567' : '#ac9e7c', narrow ? 9 : 15);
  path(c, points, narrow ? '#e2c996' : '#ead5a6', narrow ? 7 : 12.5);
  path(c, points, '#f5e3ba88', 1.1, [3, 6, 1, 4]);
}
function waterLines(c, coast, harbor) {
  c.save();
  c.clip(new Path2D(coast));
  const rand = seeded(harbor ? 449 : 108);
  for (let i = 0; i < (harbor ? 310 : 650); i++) {
    const x = rand() * W,
      y = rand() * H,
      w = 3 + rand() * 10;
    shape(c, `M${x} ${y} q${w * 0.3} -1.5 ${w * 0.55} 0 t${w * 0.45} 0`, null, '#cbe6d99e', 0.9);
  }
  c.restore();
}
function valleyTerrain(c) {
  rect(c, 0, 0, W, H, '#c1cf99');
  shape(c, 'M0 0 H600 V39 Q530 69 482 56 T353 64 Q283 49 188 68 T0 57Z', '#a5bd87');
  shape(c, 'M49 0 H600 V20 Q517 53 457 34 T282 43 Q205 31 149 49 Q90 46 49 18Z', '#94ad7f');
  shape(c, 'M410 370 Q454 287 512 280 T600 223 V370Z', '#b1c287');
  shape(c, 'M119 181 Q188 125 259 139 Q310 158 292 200 Q247 218 173 218 Q125 214 119 181Z', '#adb980');
  const river = 'M24 -10 C102 54 76 91 56 142 S14 206 27 250 S61 306 24 380 H-10 V-10Z';
  shape(c, river, '#88bbb4', '#dace9c', 9);
  shape(c, river, '#8dbcb6');
  waterLines(c, river, false);
  landMarks(c, false);
  for (const [x, y, s] of [
    [77, 59, 1],
    [95, 54, 1.3],
    [114, 62, 0.95],
    [484, 81, 1.1],
    [504, 79, 1.2],
    [527, 88, 0.8],
    [543, 299, 1.1],
    [556, 291, 1.3],
    [576, 309, 1.3],
    [82, 335, 1],
    [102, 339, 0.8],
  ])
    tree(c, x, y, s);
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 5; col++)
      tree(c, 156 + col * 25 + row * 10, 174 + row * 21 - (col % 2) * 4, 0.93, true);
  road(c, [[-15, 224], [48, 226], VALLEY.bridge.point]);
  for (let x = 8; x < 46; x += 5) rect(c, x, 216.5, 4, 15, '#b79768');
  path(
    c,
    [
      [7, 216],
      [46, 218],
    ],
    '#785f43',
    2.1,
  );
  path(
    c,
    [
      [7, 230],
      [46, 232],
    ],
    '#785f43',
    2.1,
  );
  for (let x = 7; x < 49; x += 10) rect(c, x, 213, 1.8, 5, '#735d46');
  for (const [x, y, t] of [
    [348, 74, '#9b7656'],
    [376, 79, '#bd8062'],
    [400, 68, '#8a927e'],
  ])
    building(c, x, y, 'home', 1, t, 0.78);
}
function portTerrain(c) {
  rect(c, 0, 0, W, H, '#c9cb9d');
  shape(c, 'M0 0 H411 Q383 45 281 57 Q183 52 108 86 T0 100Z', '#a7bd94');
  shape(c, 'M0 0 H336 Q306 24 206 31 Q106 41 0 68Z', '#94ae8f');
  for (let i = 0; i < 3; i++)
    shape(
      c,
      `M-20 ${83 + i * 9} Q84 ${67 + i * 9} 145 ${48 + i * 9} T 307 ${35 + i * 9}`,
      null,
      '#899d7b77',
      1.2,
    );
  landMarks(c, true);
  const sea =
    'M484 -10 C482 52 505 67 475 102 S430 152 438 185 Q452 223 419 250 Q389 279 365 306 T331 380 H610 V-10Z';
  shape(c, sea, '#87bebd', '#e1cf9e', 13);
  shape(c, sea, '#86b8bb', '#add1c4', 5);
  waterLines(c, sea, true);
  shape(c, 'M552 47 Q564 52 583 39 L608 25 L609 40 Q582 60 560 62Z', '#a4aa8e', '#b7c7ad', 3);
  at(c, 563, 56, 1, () => {
    oval(c, 2, 0, 12, 3, '#737f7266');
    shape(c, 'M-5 0 l2 -20 h5 l2 20Z', '#f7e8c7');
    shape(c, 'M-3.7 -13 h6.5 l.7 5 h-8Z', '#b6614d');
    rect(c, -3, -24, 5, 5, '#507479');
    shape(c, 'M-5 -24 l4.5 -4 4.5 4Z', '#9b5c4b');
  });
  for (const [x, y, s] of [
    [418, 88, 1.05],
    [403, 93, 0.78],
    [363, 111, 0.9],
    [69, 206, 1.15],
    [83, 211, 0.78],
    [315, 334, 1],
    [294, 344, 0.72],
  ])
    palm(c, x, y, s);
  for (const [x, y, t] of [
    [69, 131, '#bd7c58'],
    [91, 142, '#a9644e'],
    [114, 148, '#bc7959'],
    [167, 104, '#8e9b8f'],
    [190, 100, '#d09867'],
  ])
    building(c, x, y, 'home', 1, t, 0.88);
  for (const [x, y] of [
    [531, 115],
    [572, 269],
  ]) {
    oval(c, x, y + 1, 4.5, 1.5, '#cde2d4');
    shape(c, `M${x - 2} ${y} l1.4 -5 h1.2 l1.5 5Z`, '#ab6551');
  }
  at(c, 344, 309, 1, () => {
    path(
      c,
      [
        [-9, -5],
        [10, 8],
      ],
      '#ae936b',
      2,
    );
    path(
      c,
      [
        [-4, -7],
        [15, 6],
      ],
      '#ae936b',
      2,
    );
    shape(c, 'M-12 -4 Q-4 0 6 -5 L3 0 Q-5 3 -10 0Z', '#ad6950');
  });
}
function label(c, x, y, s) {
  c.font = 'bold 10px "Segoe UI", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const w = c.measureText(s).width + 14;
  c.beginPath();
  c.roundRect(x - w / 2, y - 8, w, 16, 6);
  c.fillStyle = '#fff6ddee';
  c.fill();
  c.fillStyle = '#405746';
  c.fillText(s, x, y);
}
function dock(c) {
  shape(c, 'M435 216 L514 231 L525 242 L517 251 L435 230Z', '#9b805d', '#806d53', 1.4);
  for (let i = 0; i < 17; i++)
    path(
      c,
      [
        [439 + i * 4.6, 217 + i * 0.9],
        [436 + i * 4.6, 229 + i * 0.99],
      ],
      '#c8ad83',
      2.8,
    );
  for (const x of [441, 467, 493, 516]) {
    const y = 217 + (x - 441) * 0.21;
    rect(c, x, y, 2.8, 4, '#7c6a51');
    rect(c, x - 3, y + 14, 3, 4, '#75614d');
  }
  for (const points of [
    [
      [492, 232],
      [493, 221],
    ],
    [
      [507, 240],
      [503, 253],
    ],
  ]) {
    path(c, points, '#836f54', 4.6);
    path(c, points, '#c2a47c', 3.5);
    path(c, points, '#87745a', 3.3, [0.6, 2]);
  }
}

function paper(c, harbor, houses, plan, forecast, draft) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (harbor) {
    portTerrain(c);
    Object.values(P_ROUTES).forEach((points) => road(c, points));
    dock(c);
    for (const route of plan.routes)
      path(
        c,
        route.trail.points,
        route.type === 'store' ? CARGO : FERRY,
        1.7,
        route.type === 'store' ? [2, 5] : [6, 5],
      );
    building(c, 146, 277, 'store', 1, '#7e918a');
    label(c, 143, 294, 'Старый склад');
    label(c, 106, 170, 'Слобода');
    label(c, 511, 193, 'Переправа');
  } else {
    valleyTerrain(c);
    for (const row of plan.roads) road(c, row[2], !!row[3]);
    for (const route of plan.routes) path(c, route.trail.points, WALK, 2, [3, 5]);
    building(c, MILL[0], MILL[1], 'market', 1, '#ac6950', 1.24);
    label(c, 482, 211, 'Яблочная лавка');
  }
  if (draft) {
    const preview = forecast.routes.find((route) => route.lot === draft.lot);
    if (preview) {
      c.save();
      c.translate(0, -2.7);
      path(c, preview.trail.points, '#fbf4cf', 3.1, [3, 6]);
      path(c, preview.trail.points, '#72537b', 1.4, [3, 6]);
      c.restore();
    }
  }
  const lots = harbor ? PORT : VALLEY;
  for (const house of houses) {
    const { point, number } = lots[house.lot];
    building(
      c,
      ...point,
      house.type,
      house.floors,
      house.type === 'store' ? '#77918a' : ['#b26852', '#997f5f', '#bd795c', '#8a9381'][number - 1],
      1.02,
    );
  }
}

function locate(route, distance, output) {
  const { points, ends, length } = route;
  const d = Math.max(0, Math.min(length, distance));
  let i = 1;
  while (i < ends.length - 1 && ends[i] < d) i++;
  const p = points[i - 1],
    q = points[i],
    t = (d - ends[i - 1]) / (ends[i] - ends[i - 1]);
  output[0] = p[0] + (q[0] - p[0]) * t;
  output[1] = p[1] + (q[1] - p[1]) * t;
}
const COATS = ['#ae5946', '#336b71', '#64496f', '#886538', '#466946', '#985466'];
function walker(c, x, y, i, step) {
  const swing = Math.sin(step) * 0.85;
  oval(c, x + 0.7, y, 2.8, 1, '#59654766');
  path(
    c,
    [
      [x - 1, y - 2],
      [x - 1 + swing, y],
    ],
    '#554b42',
    1.35,
  );
  path(
    c,
    [
      [x + 1, y - 2],
      [x + 1 - swing, y],
    ],
    '#554b42',
    1.35,
  );
  oval(c, x, y - 3.6, 1.8, 2.25, COATS[i % COATS.length]);
  oval(c, x, y - 6.2, 1.5, 1.6, i % 2 ? '#ba8660' : '#e0af78');
  oval(c, x - 0.15, y - 7, 1.4, 0.7, '#685746');
}
function boat(c, x, y, cargo, load) {
  at(c, x, y, 1, () => {
    shape(c, 'M-17 1 Q-16 7 -5 7 L13 5 Q22 3 24 0 Q10 5 -17 1Z', '#c8e0d3');
    shape(
      c,
      'M-20 -3 L-15 4 Q-1 7 15 2 L22 -5 Q12 -1 -20 -3Z',
      cargo ? '#7a664f' : '#466e76',
      '#526d67',
      0.8,
    );
    shape(c, 'M-20 -3 l5 -3 Q1 -8 22 -5 Q5 1 -20 -3Z', '#dfc69b');
    if (cargo) {
      rect(c, -10, -10, 9, 5, '#ede0bd');
      rect(c, -11, -12, 11, 2, '#b16b51');
      rect(c, -7, -9, 3, 2, '#698e90');
      for (let i = 0; i < Math.min(load, 3); i++)
        rect(c, 1 + i * 4, -8, 3.8, 3.8, i % 2 ? '#bf986b' : '#b48556');
    } else {
      shape(c, 'M-12 -5 l2 -7 h19 l4 6Z', '#faf0ce');
      rect(c, -11, -13, 21, 2, '#af674d');
      for (const a of [-7, -2, 3, 8]) rect(c, a, -10, 2.7, 3, '#648d92');
      for (let i = 0; i < Math.min(load, 4); i++)
        oval(c, -5.6 + i * 5, -8.2, 0.85, 1, i % 2 ? '#c68d65' : '#f5c899');
    }
  });
}

// Prepaint the small moving illustrations at the largest map scale. The animation only blits them.
function sprite(width, height, originX, originY, paint) {
  const image = document.createElement('canvas');
  image.width = width * 4;
  image.height = height * 4;
  const c = image.getContext('2d');
  c.setTransform(4, 0, 0, 4, originX * 4, originY * 4);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  paint(c);
  return { image, width, height, originX, originY };
}
let mapSprites;
function sprites() {
  if (mapSprites) return mapSprites;
  const people = COATS.map((_, i) =>
    Array.from({ length: 4 }, (_, frame) =>
      sprite(9, 12, 4, 9, (c) => walker(c, 0, 0, i, (frame * Math.PI) / 2)),
    ),
  );
  const hulls = (cargo, count) =>
    Array.from({ length: count }, (_, load) => sprite(51, 24, 23, 15, (c) => boat(c, 0, 0, cargo, load)));
  const carts = Array.from({ length: 4 }, (_, load) =>
    sprite(8, 10, 1, 6, (c) => {
      rect(c, 0, 0, 5, 2, '#725641');
      for (let i = 0; i < load; i++) rect(c, i === 1 ? 2.5 : 0, i === 2 ? -4 : -2, 2.6, 2.2, '#bb905b');
      oval(c, 0.5, 2, 0.8, 0.8, '#574c41');
      oval(c, 4.5, 2, 0.8, 0.8, '#574c41');
    }),
  );
  mapSprites = { people, cargo: hulls(true, 4), ferry: hulls(false, 5), carts };
  return mapSprites;
}
function stamp(c, s, x, y) {
  c.drawImage(s.image, x - s.originX, y - s.originY, s.width, s.height);
}
function traffic(c, harbor, plan, seconds, graphics, pt, voyage) {
  const frame = Math.floor(seconds * 7);
  if (!harbor) {
    for (let ri = 0; ri < plan.routes.length; ri++) {
      const r = plan.routes[ri],
        count = Math.min(8, r.population),
        span = r.trail.length;
      for (let i = 0; i < count; i++) {
        const moved = (seconds * 15 + ((i + 0.35) * span * 2) / count + ri * 14) % (span * 2);
        locate(r.trail, moved <= span ? moved : span * 2 - moved, pt);
        stamp(
          c,
          graphics.people[(i + ri) % COATS.length][(frame + i) % 4],
          pt[0],
          pt[1] + (moved > span ? 1.4 : -1.1),
        );
      }
    }
    return;
  }
  const t = seconds % CYCLE;
  let unloaded = 0,
    boarded = 0;
  for (let i = 0; i < plan.deliveries.length; i++) {
    const job = plan.deliveries[i];
    if (t >= job.start + job.duration) unloaded += job.load;
  }
  for (let i = 0; i < plan.passengers.length; i++) {
    const job = plan.passengers[i];
    if (t >= job.start + job.duration) boarded++;
  }
  const travel =
    t < MOORED_START
      ? (MOORED_START - t) / MOORED_START
      : Math.max(0, (t - MOORED_END) / (CYCLE - MOORED_END));
  stamp(c, graphics.ferry[Math.min(4, boarded)], 493 + travel * 160, 221 - travel * 63);
  stamp(c, graphics.cargo[Math.min(3, plan.boxes - unloaded)], 501 + travel * 102, 256 + travel * 63);
  for (let i = 0; i < plan.deliveries.length; i++) {
    const job = plan.deliveries[i],
      q = (t - job.start) / job.duration;
    if (q < 0 || q >= 2) continue;
    locate(job.route.trail, job.route.trail.length * Math.abs(1 - q), pt);
    stamp(c, graphics.people[3][frame % 4], pt[0] - 2, pt[1] + 2);
    stamp(c, graphics.carts[q < 1 ? job.load : 0], pt[0] + 1, pt[1]);
  }
  for (let i = 0; i < plan.passengers.length; i++) {
    const job = plan.passengers[i],
      q = (t - job.start) / job.duration;
    if (q < 0 || q >= 1) continue;
    locate(job.route.trail, q * job.route.trail.length, pt);
    stamp(c, graphics.people[i % COATS.length][(frame + i) % 4], pt[0], pt[1] - 0.8);
  }
  const phase = t < MOORED_START ? 0 : t > MOORED_END ? 2 : 1;
  if (voyage.phase !== phase || voyage.unloaded !== unloaded || voyage.boarded !== boarded) {
    voyage.phase = phase;
    voyage.unloaded = unloaded;
    voyage.boarded = boarded;
    const label = phase === 0 ? 'Суда подходят' : phase === 2 ? 'Суда отошли' : 'Идёт посадка и разгрузка';
    voyage.node.textContent = label + ' · ящиков ' + unloaded + ' · пассажиров ' + boarded;
  }
}
function sketch(canvas, harbor, houses, plan, forecast, draft, motion, status) {
  const c = canvas.getContext('2d'),
    sheet = document.createElement('canvas'),
    graphics = harbor || houses.length ? sprites() : null,
    pt = [0, 0];
  const voyage = { node: status };
  let raf = 0,
    previous = 0,
    disposed = false;
  function draw() {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(sheet, 0, 0);
    c.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    traffic(c, harbor, plan, motion.seconds, graphics, pt, voyage);
  }
  function resize() {
    const box = canvas.getBoundingClientRect(),
      dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = sheet.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = sheet.height = Math.max(1, Math.round(box.height * dpr));
    const bg = sheet.getContext('2d');
    bg.setTransform(sheet.width / W, 0, 0, sheet.height / H, 0, 0);
    paper(bg, harbor, houses, plan, forecast, draft);
    draw();
  }
  function frame(now) {
    if (disposed) return;
    if (previous) motion.seconds += (now - previous) / 1000;
    previous = now;
    draw();
    raf = requestAnimationFrame(frame);
  }
  function activity() {
    cancelAnimationFrame(raf);
    previous = 0;
    if ((harbor || houses.length) && !motion.paused && !document.hidden) raf = requestAnimationFrame(frame);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  document.addEventListener('visibilitychange', activity);
  activity();
  return {
    activity,
    stop() {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', activity);
    },
  };
}

function metric(name, value) {
  return h('div', { class: 'district-metric' }, h('dt', {}, name), h('dd', {}, value));
}
function button(text, cls, handler, attrs = {}) {
  return h('button', { type: 'button', class: cls, onClick: handler, ...attrs }, text);
}
function formChoices(title, items, selected, select, attr) {
  return h(
    'fieldset',
    { class: 'district-field' },
    h('legend', {}, title),
    h(
      'div',
      { class: 'district-options' },
      items.map(([key, title]) =>
        button(title, 'district-choice', () => select(key), {
          ['data-' + attr]: key,
          'aria-pressed': String(selected === key),
        }),
      ),
    ),
  );
}
function effect(harbor, oldPlan, newPlan, house, town) {
  if (harbor) {
    const store = house.type === 'store';
    return (
      town[house.lot].name +
      ' · ' +
      (store
        ? 'ящиков за стоянку ' + oldPlan.boxes + ' → ' + newPlan.boxes
        : 'пассажиров за рейс ' + oldPlan.seats + ' → ' + newPlan.seats) +
      '.'
    );
  }
  const first = newPlan.routes[0],
    before = oldPlan.routes[0];
  if (!before)
    return (
      'Жители вышли из дома. Через верхнюю дорогу до яблочной лавки ' + metres(first.trail.length) + ' м.'
    );
  if (first.trail.length < before.trail.length - 0.01)
    return (
      'От первого дома открылась короткая дорога. До лавки ' +
      metres(before.trail.length) +
      ' → ' +
      metres(first.trail.length) +
      ' м.'
    );
  return (
    'К лавке добавился поток с участка «' +
    town[house.lot].name +
    '». Путь от нового дома — ' +
    metres(newPlan.routes.at(-1).trail.length) +
    ' м.'
  );
}

export function showDistrict({ city, panel, state, save, build }) {
  const harbor = city === 'harbor',
    town = harbor ? PORT : VALLEY,
    calculate = harbor ? portPlan : valleyPlan;
  state.houses ??= [];
  if (state.result) {
    const job = state.pending,
      result = state.result,
      lots = available(town, state.houses);
    if (job && lots.includes(job.lot)) {
      if (result.floors > 0) {
        const house = {
          lot: job.lot,
          type: job.type,
          floors: result.floors,
          population: num(result.population, result.floors * 2),
        };
        const previous = calculate(state.houses);
        state.houses.push(house);
        state.message = effect(harbor, previous, calculate(state.houses), house, town);
        delete state.selection;
      } else state.message = 'Первый этаж упал. Участок свободен, можно попробовать снова.';
    }
    delete state.pending;
    delete state.result;
    save();
  }
  const motion = {
    paused: state.mapPaused ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    seconds: state.mapTime ?? (harbor ? 5.2 : 0),
  };
  let drawing,
    submitted = false;
  function render(focus) {
    drawing?.stop();
    const houses = state.houses,
      lots = available(town, houses),
      done = !lots.length;
    const selected = lots.includes(state.selection?.lot) ? state.selection.lot : lots[0];
    const type = harbor && state.selection?.type !== 'home' ? 'store' : 'home';
    const candidate = done ? null : { lot: selected, type, floors: 3, population: 6 };
    const plan = calculate(houses),
      forecast = candidate ? calculate([...houses, candidate]) : plan;
    const select = (lot, role, key) => {
      state.selection = { lot, type: role };
      state.mapTime = motion.seconds;
      save();
      render(key);
    };
    const canvas = h('canvas', {
      class: 'district-paper',
      'aria-label': harbor
        ? 'Два судна у причала, тележки и пассажиры на дорогах'
        : 'Дома, яблочная лавка и пешеходные маршруты',
      role: 'img',
    });
    const map = h('div', { class: 'district-map' }, canvas);
    for (const id of lots) {
      const plot = town[id];
      map.append(
        button(String(plot.number), 'district-pin', () => select(id, type, 'pin-' + id), {
          style: { left: (plot.point[0] / W) * 100 + '%', top: ((plot.point[1] - 6) / H) * 100 + '%' },
          title: 'Участок ' + plot.number + ' · ' + plot.name,
          'aria-label': 'Выбрать участок ' + plot.number + ' «' + plot.name + '»',
          'aria-pressed': String(id === selected),
          'data-pin': id,
          'data-focus': 'pin-' + id,
        }),
      );
    }
    const voyage = h('p', { class: 'district-voyage' });
    const pause = button(
      motion.paused ? 'Оживить карту' : 'Пауза',
      'district-pause',
      () => {
        motion.paused = !motion.paused;
        state.mapPaused = motion.paused;
        state.mapTime = motion.seconds;
        save();
        pause.textContent = motion.paused ? 'Оживить карту' : 'Пауза';
        pause.setAttribute('aria-pressed', String(motion.paused));
        drawing.activity();
      },
      { 'aria-label': 'Пауза движения на карте', 'aria-pressed': String(motion.paused) },
    );
    const legend = h(
      'div',
      { class: 'district-legend' },
      harbor
        ? [
            h('span', { class: 'district-key district-ferry' }, 'Пассажиры'),
            h('span', { class: 'district-key district-cargo' }, 'Груз'),
          ]
        : houses.length
          ? h('span', { class: 'district-key district-walk' }, 'Путь к лавке')
          : null,
      candidate ? h('span', { class: 'district-key district-draft' }, 'Проект пути') : null,
      harbor || houses.length ? pause : null,
    );
    const metrics = h(
      'dl',
      { class: 'district-metrics' },
      harbor
        ? [
            metric('Ящиков за стоянку', String(plan.boxes)),
            metric('Пассажиров за рейс', plan.seats + ' из ' + SEATS),
          ]
        : [
            metric('Жителей', String(plan.population)),
            metric('Средний путь к лавке', houses.length ? plan.distance + ' м' : '—'),
          ],
    );
    const board = h('div', { class: 'district-board' }, map, legend, metrics, harbor ? voyage : null);
    const title = harbor ? 'Место у причала' : 'Рыночная улица';
    const brief =
      harbor && houses.length
        ? 'У трапа уже стоит ' +
          (houses[0].type === 'store' ? 'склад' : 'дом') +
          '. Дальше от воды тележка успеет сделать меньше ходок, а пассажирам понадобится больше времени до посадки.'
        : harbor
          ? 'У трапа поместится одно здание. Склад примет ящики с лодки, а из жилого дома люди пойдут на паром.'
          : !houses.length
            ? 'Поставьте первый дом у моста. Его жители покажут дорогу к яблочной лавке.'
            : 'Выберите, где пройдёт улица. Соседние дома за яблонями и у прилавков откроют сквозной проход к лавке.';
    const side = h(
      'div',
      { class: 'district-side' },
      h(
        'p',
        { class: 'district-location' },
        (harbor ? 'Морская гавань' : 'Долина') +
          ' · ' +
          (done ? '3 постройки' : 'Постройка ' + (houses.length + 1) + ' из 3'),
      ),
      h('h2', { class: 'district-title' }, title),
      h(
        'p',
        { class: 'district-intro' },
        done
          ? harbor
            ? 'Застройка набережной завершена. Посмотрите, сколько груза и людей успеют за стоянку.'
            : 'Три дома заселены. На карте виден путь от каждого крыльца до лавки.'
          : brief,
      ),
      state.message
        ? h('p', { class: 'district-result', role: 'status', 'data-outcome': '' }, state.message)
        : null,
    );
    if (!done) {
      if (lots.length > 1)
        side.append(
          formChoices(
            'Свободные участки',
            lots.map((id) => [id, town[id].number + ' · ' + town[id].name]),
            selected,
            (id) => select(id, type, 'lot-' + id),
            'lot',
          ),
        );
      else
        side.append(
          h(
            'p',
            { class: 'district-site' },
            'Участок ' + town[selected].number + ' · ' + town[selected].name,
          ),
        );
      if (harbor)
        side.append(
          formChoices(
            'Что построить',
            [
              ['store', 'Склад'],
              ['home', 'Жилой дом'],
            ],
            type,
            (value) => select(selected, value, 'role-' + value),
            'role',
          ),
        );
      const route = forecast.routes.find((r) => r.lot === selected);
      const preview = harbor
        ? (type === 'store' ? 'Путь тележки до склада — ' : 'От крыльца до трапа — ') +
          metres(route.trail.length) +
          ' м.'
        : 'От нового дома до лавки — ' + metres(route.trail.length) + ' м.';
      side.append(
        h('p', { class: 'district-preview', 'data-preview': '' }, preview),
        button(
          type === 'store' ? 'Строить склад' : 'Строить дом',
          'district-action',
          () => {
            if (submitted) return;
            submitted = true;
            state.pending = { lot: selected, type };
            state.selection = { lot: selected, type };
            state.mapTime = motion.seconds;
            save();
            build({
              label: (type === 'store' ? 'Склад' : 'Дом') + ' · ' + town[selected].name,
              floorsTarget: 3,
              buildingType: type === 'store' ? 'warehouse' : 'house',
            });
          },
          { 'data-build': '' },
        ),
      );
    } else {
      side.append(
        button(
          'Попробовать другую планировку',
          'district-action',
          () => {
            state.houses = [];
            motion.seconds = harbor ? 5.2 : 0;
            delete state.mapTime;
            delete state.selection;
            delete state.pending;
            delete state.message;
            save();
            render('replay');
          },
          { 'data-replay': '' },
        ),
      );
    }
    panel.replaceChildren(
      h(
        'div',
        { class: 'district-shell' + (harbor ? ' district-harbor' : ''), 'data-houses': houses.length },
        board,
        side,
      ),
    );
    drawing = sketch(canvas, harbor, houses, plan, forecast, candidate, motion, voyage);
    if (focus) {
      const target =
        focus === 'replay'
          ? side.querySelector('[data-build]')
          : focus.startsWith('pin-')
            ? map.querySelector('[data-focus="' + focus + '"]')
            : side.querySelector(
                '[data-' + (focus.startsWith('lot-') ? 'lot' : 'role') + '="' + focus.split('-')[1] + '"]',
              );
      target?.focus({ preventScroll: true });
    }
  }
  render();
  return () => drawing?.stop();
}
