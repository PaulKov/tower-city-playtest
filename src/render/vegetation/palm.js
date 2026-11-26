// Перистая пальма Морской гавани. Лист состоит из черешка и двух смещённых рядов
// узких складчатых листочков; их свободные концы изгибаются независимо от черешка.
import * as THREE from 'three';
import { bakedModel, bakedTexture } from './baked.js';
import { createRng } from '../../core/rng.js';
import { VegetationBuilder } from './geometry.js';
import { VEG_GEN, generationStamp, finishGeneration } from './atlas.js';

const cache = new Map();
const TAU = 2 * Math.PI, GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const UP = new THREE.Vector3(0, 1, 0);
const bark = new THREE.Color('#a39988'), barkFoot = new THREE.Color('#918674');
const sheathBase = new THREE.Color('#a1a05b'), sheathTop = new THREE.Color('#789742');
const ribBase = new THREE.Color('#a5ab53'), ribTip = new THREE.Color('#729644');
// Возраст листа меняет цвет: старые длинные вайи темнее, новые в середине светлее.
const leaves = ['#39794c', '#4f9254', '#77a95b'].map(c => new THREE.Color(c));

let frondMask;
let fiberTexture;

// Развёртка живого ствола вокруг его оси. Карта хранит высоту продольных
// волокон и рубчиков от проводящих пучков. На одном обороте 480 отдельных волокон.
export function palmFiberTexture() {
  const ready = bakedTexture('harbor.palm-fibers', 'palm:stem-fibers', { repeat: true, linear: true, anisotropy: 4 });
  if (ready) return ready;
  if (fiberTexture) return fiberTexture;
  const stamp = generationStamp();
  const size = 1024, rng = createRng(442901);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gray = n => `rgb(${n},${n},${n})`;
  ctx.fillStyle = gray(127);
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  // Штрихи пересекают границы тайла. Повторяем только ту часть, которая
  // пересекла шов; карта и её аппаратные mip-уровни замыкаются по обеим осям.
  function strand(x, y, length, sway, width, value) {
    const drift = sway * 0.61;
    ctx.lineWidth = width;
    ctx.strokeStyle = gray(value);
    for (const dx of (x < 12 ? [0,size] : x > size-12 ? [-size,0] : [0])) {
      for (const dy of (y+length+width >= size ? [0,-size] : y < width ? [0,size] : [0])) {
        ctx.beginPath();
        ctx.moveTo(x+dx, y+dy);
        ctx.bezierCurveTo(x+dx+sway, y+dy+0.34*length, x+dx-drift, y+dy+0.79*length, x+dx+drift, y+dy+length);
        ctx.stroke();
      }
    }
  }
  // Пучки выступают из более тёмного межволоконного слоя. Длина и сохранность
  // отдельной нити меняются вдоль ствола, её кромка ловит свет при облёте.
  for (let bundle=0; bundle<83; bundle++) {
    const x = (bundle+rng.next())*size/83, y=rng.next()*size;
    strand(x,y,rng.uniform(135,465),rng.uniform(-8,8),rng.uniform(3,8),rng.int(92,118));
  }
  for (let fiber=0; fiber<480; fiber++) {
    const axis=(fiber+rng.next())*size/480;
    for (let segment=0;segment<5;segment++) {
      const y=(segment+rng.next())*size/5, x=(axis+size+rng.uniform(-2,2))%size;
      const length=rng.uniform(28,208), sway=rng.uniform(-3.8,3.8), width=rng.uniform(.75,2.10);
      strand(x,y,length,sway,width,rng.int(56,119));
      strand(x+width*.60,y+1,length*.87,sway*.90,width*.69,rng.int(149,212));
    }
  }
  for (let i=0;i<480;i++) {
    const x=rng.uniform(4,size-4), y=rng.uniform(3,size-3);
    ctx.fillStyle=gray(rng.int(77,113)); ctx.beginPath();
    ctx.ellipse(x,y,rng.uniform(.8,2.4),rng.uniform(.55,1.0),rng.uniform(-.4,.4),0,TAU);ctx.fill();
  }
  fiberTexture = new THREE.CanvasTexture(canvas);
  fiberTexture.name = 'palm:stem-fibers';
  fiberTexture.wrapS = fiberTexture.wrapT = THREE.RepeatWrapping;
  fiberTexture.anisotropy = 4;
  finishGeneration(stamp);
  return fiberTexture;
}

/** Одна маска целой вайи. Mip-уровни сохраняют среднее покрытие узких кончиков при удалении камеры. */
export function palmFrondMask() {
  const ready = bakedTexture('harbor.palm-frond', 'palm:frond', { linear: true, anisotropy: 4 });
  if (ready) return ready;
  if (frondMask) return frondMask;
  const stamp = generationStamp();
  const w = 128, h = 256, pixels = new Uint8Array(w * h * 4);
  const smooth = THREE.MathUtils.smoothstep;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = (y + 0.5) / h, s = Math.abs(2 * (x + 0.5) / w - 1);
    const phase = 16 * t + (x >= w / 2 ? 0.46 : 0) - 1.25 * s * s + 0.14 * Math.sin(24 * t + 3.5 * s);
    const k = Math.floor(phase + 0.5), d = Math.abs(phase - k), pinna = Math.sin(2.39 * k);
    const tip = 0.91 + 0.08 * pinna, width = (0.155 + 0.17 * Math.sin(Math.PI * s)) * (1 - smooth(s, 0.52, tip));
    const feather = (1 - smooth(d, width - 0.04, width + 0.04)) * (1 - smooth(s, tip - 0.1, tip));
    const rib = 1 - smooth(s, 0.014, 0.06), i = 4 * (y * w + x);
    pixels[i] = Math.round(255 / 1.28 * (0.85 + 0.15 * s + 0.11 * pinna + 0.18 * Math.exp(-12 * d)));
    pixels[i + 1] = Math.round(255 * rib);
    pixels[i + 2] = 0;
    pixels[i + 3] = Math.round(255 * Math.max(rib, feather));
  }
  frondMask = new THREE.DataTexture(pixels, w, h);
  frondMask.name = 'palm:frond';
  frondMask.generateMipmaps = true;
  frondMask.minFilter = THREE.LinearMipmapLinearFilter;
  frondMask.anisotropy = 4;
  frondMask.magFilter = THREE.LinearFilter;
  frondMask.needsUpdate = true;
  finishGeneration(stamp);
  return frondMask;
}

function vertex(b, p, c, flex = 0, tip = 0, u = -2, v = -2) {
  b.push(p, UP, u, v, c, flex, 0, tip);
}

// Кольца замкнуты по индексу: после расчёта нормалей на округлом стволе и черешке нет шва.
function joinRings(b, lower, upper, sides) {
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    b.idx.push(lower + i, upper + i, lower + next, lower + next, upper + i, upper + next);
  }
}

function stemAxis(y, variant) {
  const t = y / 3.03;
  return new THREE.Vector3(variant ? -0.53 * t * t + 0.15 * Math.sin(Math.PI * t) : 0.32 * t * t,
    y, variant ? 0.13 * t * t : -0.13 * Math.sin(Math.PI * t) + 0.07 * t);
}

const smooth = THREE.MathUtils.smoothstep;
const SHEATH_PROFILE = [[2.61, 0.113], [2.67, 0.125], [2.78, 0.143], [2.92, 0.147], [3.00, 0.122], [3.10, 0.018]];

/** Плавно расширяющийся комель, узкая вершина ствола и опоясывающие её молодые черешки. */
function stemRadius(y) {
  if (y < 2.61) return 0.146 - 0.033 * smooth(y, 0, 2.61) + 0.063 * Math.exp(-4.6 * y);
  for (let i = 1; i < SHEATH_PROFILE.length; i++) {
    const [ya, ra] = SHEATH_PROFILE[i - 1], [yb, rb] = SHEATH_PROFILE[i];
    if (y <= yb) return ra + (rb - ra) * smooth(y, ya, yb);
  }
  return 0.018;
}

/** Горизонтальное сечение круглое; только у земли видны два мягких асимметричных наплыва. */
function stemPoint(y, a, variant, near = false) {
  const base = Math.exp(-5.1 * y);
  const ripple = 0.032 * Math.cos(2 * a - 0.68) + 0.014 * Math.sin(3 * a + 1.4);
  let r = stemRadius(y) * (1 + base * ripple + 0.008 * Math.cos(a + y * 1.6));
  if (near) {
    // У пальмы у основания находится пояс зачаточных корней. Его наплывы
    // сходят на нет выше почвы; выше на стволе выступают края листовых рубцов.
    const phase = a + variant*1.8;
    const toes = Math.max(0, 0.5+0.5*Math.sin(5*phase+.68*Math.cos(2*phase)+1.4*y))**3;
    r += (0.004+0.021*toes) * Math.exp(-6.8*y);
    // Часть корневых зачатков ещё выступает из нижнего пояса ствола. Ряды
    // сдвинуты по окружности и сходят на нет на разных высотах.
    if (y < .29) {
      const row = y - .065 - .018*Math.sin(3*phase);
      const oval = (.5+.5*Math.cos(9*phase+.39*Math.sin(2*phase)))**5;
      r += .013*oval*Math.exp(-790*row*row);
      const upper = y - .143 - .025*Math.cos(2*phase+.4);
      const small = (.5+.5*Math.cos(11*phase+1.72))**6;
      r += .008*small*Math.exp(-1050*upper*upper);
    }
    const scar = Math.cos(TAU*5.74*y + .40*Math.sin(2*phase + 1.1*y) + .18*Math.cos(3*phase-y));
    r += 0.0038*(scar*.5+.5)**3 * (1-smooth(y,2.50,2.65));
  }
  const p = stemAxis(y, variant);
  p.x += r * Math.cos(a); p.z += r * Math.sin(a);
  return p;
}

function trunk(b, variant, lod) {
  // У комля L0 44 стороны, расстояние до следующего кольца здесь меньше трёх сантиметров.
  const sides = [44, 10, 5][lod];
  const rings = lod === 2 ? [0, 1.35, 2.61, 3.10]
    : lod === 1 ? [0, 0.15, 0.47, 1.32, 2.13, 2.61, 2.90, 3.10]
    : [0, .021, .052, .092, .143, .203, .279, .37, .476, .60, .742, .893, 1.052, 1.217, 1.38, 1.55,
      1.73, 1.905, 2.09, 2.277, 2.445, 2.548, 2.61, 2.67, 2.72, 2.78, 2.85, 2.92, 2.96, 3.00, 3.04, 3.08, 3.10];
  const offset = b.count, color = new THREE.Color();
  for (let row = 0; row < rings.length; row++) {
    const y = rings[row], stem = barkFoot.clone().lerp(bark, smooth(y, 0, 0.90));
    const sheath = sheathBase.clone().lerp(sheathTop, smooth(y, 2.62, 3.05));
    stem.lerp(sheath, smooth(y, 2.53, 2.73));
    for (let i = 0; i <= sides; i++) {
      const a = TAU * (i % sides) / sides, p = stemPoint(y, a, variant, lod === 0);
      // Производные самой поверхности дают плавные нормали, в том числе с двух сторон шва UV
      // и у почвы, где одностороннее усреднение треугольников давало плоскую тёмную кромку.
      const dy = stemPoint(y + 0.001, a, variant, lod === 0).sub(stemPoint(Math.max(0, y - 0.001), a, variant, lod === 0));
      const da = stemPoint(y, a + 0.004, variant, lod === 0).sub(stemPoint(y, a - 0.004, variant, lod === 0));
      const normal = dy.cross(da).normalize();
      color.copy(stem).multiplyScalar(1 + 0.024 * Math.sin(a * 2 - y * 0.55) + 0.015 * Math.cos(a * 3 + y));
      b.push(p, normal, i / sides + 0.375 * variant, -3 - y, color, 0.25 * (y / 3.03) ** 2, 0);
      if (row > 0 && i < sides) {
        const j = offset + (row - 1) * (sides + 1) + i, up = j + sides + 1;
        b.idx.push(j, up, j + 1, j + 1, up, up + 1);
      }
    }
  }
  return b.count;
}

function frondLayout(variant) {
  const rng = createRng(18623 + variant * 907);
  const n = variant ? 17 : 16, fronds = [];
  for (let i = 0; i < n; i++) {
    const layer = i < 6 ? 0 : i < 12 ? 1 : 2;
    const a = 0.4 * variant + i * GOLDEN_ANGLE + rng.uniform(-0.12, 0.12);
    fronds.push({ i, layer, azimuth: a, twist: rng.uniform(-0.21, 0.21), roll: rng.uniform(-0.22, 0.22),
      y: 2.90 + 0.07 * layer + rng.uniform(-0.035, 0.035),
      reach: [1.73, 1.47, 0.95][layer] * rng.uniform(0.88, 1.05),
      lift: [0.69, 1.02, 1.30][layer] * rng.uniform(0.91, 1.03),
      drop: [1.13, 0.79, 0.32][layer] * rng.uniform(0.83, 1.18),
      width: [0.54, 0.48, 0.36][layer] * rng.uniform(0.94, 1.12),
      tone: rng.uniform(0.82, 1.12) });
  }
  return fronds;
}

// Положение и локальный базис вдоль рахиса. Первые сантиметры идут вверх, внешняя треть плавно поникает.
function ribFrame(f, origin, t) {
  const a = f.azimuth + f.twist * t, ca = Math.cos(a), sa = Math.sin(a);
  const r = 0.045 + f.reach * t * (1.12 - 0.12 * t), dr = f.reach * (1.12 - 0.24 * t);
  const y = f.y + f.lift * (2 * t - t * t) - f.drop * t ** 2.55;
  const dy = 2 * f.lift * (1 - t) - 2.55 * f.drop * t ** 1.55;
  const p = new THREE.Vector3(origin.x + r * ca, y, origin.z + r * sa);
  const forward = new THREE.Vector3(dr * ca - r * sa * f.twist, dy, dr * sa + r * ca * f.twist).normalize();
  const side = new THREE.Vector3(-forward.z, 0, forward.x).normalize().applyAxisAngle(forward, f.roll * (0.3 + 0.7 * t));
  const normal = new THREE.Vector3().crossVectors(side, forward);
  return { p, forward, side, normal };
}

const ribFlex = (t) => 0.25 + 0.63 * t;
function rachis(b, f, origin) {
  const steps = 10, sides = 5, p = new THREE.Vector3(), color = new THREE.Color();
  let prev = -1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, frame = ribFrame(f, origin, t), start = b.count;
    const r = 0.003 + 0.029 * (1 - t) ** 1.48;
    for (let k = 0; k < sides; k++) {
      const a = k * TAU / sides;
      p.copy(frame.p).addScaledVector(frame.side, r * Math.cos(a)).addScaledVector(frame.normal, 0.70 * r * Math.sin(a));
      color.copy(ribBase).lerp(ribTip, t).multiplyScalar(f.tone * (0.90 + 0.12 * Math.sin(a)));
      vertex(b, p, color, ribFlex(t));
    }
    if (prev >= 0) joinRings(b, prev, start, sides);
    prev = start;
  }
}

// x текстурной координаты идёт поперёк пластинки (−1..1), y от основания до кончика (0..1).
// Жилка внутри листочка тоньше пикселя уже в нескольких метрах; материал вычисляет её ширину в пикселях.
function leaflet(b, f, origin, t, sign, seed) {
  const rng = createRng(seed), frame = ribFrame(f, origin, t), base = b.count;
  const span = f.width * (0.23 + 0.77 * Math.sin(t ** 0.87 * Math.PI) ** 0.70) * rng.uniform(0.89, 1.08);
  const sweep = 0.20 + 0.70 * t + rng.uniform(-0.09, 0.12);
  const lift = [0.05, 0.21, 0.37][f.layer] + rng.uniform(-0.12, 0.20);
  const drop = [0.85, 0.70, 0.50][f.layer] + rng.uniform(-0.10, 0.14);
  const side = frame.side.multiplyScalar(sign);
  const bladeDir = side.clone().addScaledVector(frame.forward, sweep);
  const cross = new THREE.Vector3(bladeDir.z, 0, -bladeDir.x).normalize();
  const baseColor = leaves[f.layer].clone().multiplyScalar(f.tone * rng.uniform(0.83, 1.12));
  const color = new THREE.Color(), p = new THREE.Vector3(), center = new THREE.Vector3(), widthAxis = new THREE.Vector3();
  const twist = rng.uniform(-0.34, 0.34), height = ribFlex(t);
  const centerAt = (u) => center.copy(frame.p).addScaledVector(side, span * u * (1 - 0.25 * u))
    .addScaledVector(frame.forward, span * u * (sweep + 0.22 * u))
    .addScaledVector(frame.normal, span * (lift * Math.sin(u * Math.PI * 0.81) - drop * u * u));
  vertex(b, centerAt(0), baseColor, height, 0, 0, 0);
  for (const u of [0.19, 0.45, 0.72]) {
    centerAt(u);
    widthAxis.copy(cross).addScaledVector(frame.normal, twist * (0.2 + u)).normalize();
    const w = span * 0.071 * Math.sin(Math.PI * u ** 0.68);
    for (const k of [-1, 1]) {
      p.copy(center).addScaledVector(widthAxis, k * w);
      color.copy(baseColor).multiplyScalar(0.84 + 0.19 * u + 0.06 * k);
      vertex(b, p, color, height + 0.06 * u, 0.62 * span * u * u, k, u);
    }
  }
  vertex(b, centerAt(1), baseColor, height + 0.06, 0.62 * span, 0, 1);
  b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4,
    base + 3, base + 5, base + 4, base + 4, base + 5, base + 6, base + 5, base + 7, base + 6);
}

// Изогнутый размах вайи воспроизводит концы тех же листочков. На удалении разрезы, продольные
// складки и тонкий рахис рисуются внутри этой поверхности; силуэт остаётся ажурным между ветвями.
function feather(b, f, origin, lod) {
  const steps = lod === 1 ? 5 : 3;
  let previous = b.count;
  const p = new THREE.Vector3(), c = leaves[f.layer].clone().multiplyScalar(f.tone);
  for (let j = 0; j <= steps; j++) {
    const t = j / steps, frame = ribFrame(f, origin, t);
    const span = f.width * Math.sin(Math.PI * t) ** 0.66;
    const start = b.count, tip = j === 0 || j === steps;
    for (let k = tip ? 0 : -1; k <= (tip ? 0 : 1); k++) {
      const u = Math.abs(k);
      p.copy(frame.p).addScaledVector(frame.side, Math.sign(k) * span * u * (1 - 0.25 * u))
        .addScaledVector(frame.forward, span * u * (0.20 + 0.70 * t + 0.22 * u))
        .addScaledVector(frame.normal, span * ((0.11 + 0.12 * f.layer) * Math.sin(u * Math.PI * 0.81) - (0.86 - 0.16 * f.layer) * u * u));
      vertex(b, p, c, ribFlex(t) + 0.06 * u, 0.62 * span * u * u, k, 2 + t);
    }
    // У основания и острия маска сходится к рахису: одна вершина заменяет две почти нулевые грани.
    if (j === 1) b.idx.push(previous, start + 1, start, previous, start + 2, start + 1);
    else if (j === steps) b.idx.push(previous, previous + 1, start, previous + 1, previous + 2, start);
    else if (j > 0) for (let col = 0; col < 2; col++) {
      const a = previous + col, next = start + col;
      b.idx.push(a, a + 1, next, a + 1, next + 1, next);
    }
    previous = start;
  }
}

// Один ещё не раскрывшийся центральный лист. Узкая косая «стрела» среди изогнутых вай
// состоит из двух сложенных вдоль жилки половинок, постепенно расходящихся наверху.
function spear(b, variant, lod) {
  const origin = stemAxis(3.0, variant), start = b.count, steps = [12, 6, 2][lod];
  const a = variant ? 2.5 : -0.8, along = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const across = new THREE.Vector3(-along.z, 0, along.x);
  const c = new THREE.Color(), young = new THREE.Color('#93ac54'), light = new THREE.Color('#bec876');
  const p = new THREE.Vector3(), axis = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, w = 0.006 + 0.07 * Math.sin(Math.PI * t) ** 0.82;
    axis.copy(origin).addScaledVector(along, 0.05 + 0.37 * t * t).addScaledVector(UP, 1.32 * t);
    for (const side of [-1, 0, 1]) {
      p.copy(axis).addScaledVector(across, side * w * (0.15 + 0.85 * t))
        .addScaledVector(along, Math.abs(side) * w * 0.95);
      vertex(b, p, c.copy(young).lerp(light, side === 0 ? 0.64 : 0.08), 0.25 + 0.58 * t, t * t * 0.11);
    }
    if (i > 0) {
      const j = start + (i - 1) * 3;
      b.idx.push(j, j + 3, j + 1, j + 1, j + 3, j + 4, j + 1, j + 4, j + 2, j + 2, j + 4, j + 5);
    }
  }
}

/** Ярус L0, L1 или L2 одного из двух вариантов. Все размеры в метрах при s = 1. */
export function palmGeometry(variant = 0, lod = 0) {
  const key = 'palm:' + variant + ':L' + lod;
  if (lod === 0) {
    const baked = bakedModel('harbor.palm-models', key);
    if (baked) return baked;
  }
  if (cache.has(key)) return cache.get(key);
  const start = performance.now(), b = new VegetationBuilder(true);
  const trunkEnd = trunk(b, variant, lod);
  for (const f of frondLayout(variant)) {
    const origin = stemAxis(f.y, variant);
    if (lod > 0) {
      feather(b, f, origin, lod);
      continue;
    }
    rachis(b, f, origin);
    const pairs = 22 - f.layer;
    for (let k = 0; k < pairs; k++) for (const sign of [-1, 1]) {
      const stagger = (sign === 1 ? 0.7 : 0.25) + 0.16 * Math.sin(2.4 * k + f.i + sign);
      const t = 0.095 + 0.89 * (k + stagger) / pairs;
      leaflet(b, f, origin, t, sign, 63 + variant * 2003 + f.i * 147 + k * 2 + (sign > 0 ? 1 : 0));
    }
  }
  spear(b, variant, lod);
  const g = b.build(key, { kind: 'tree', variant, lod });
  g.computeVertexNormals();
  g.attributes.normal.array.set(b.nor.slice(0, 3 * trunkEnd));
  if(lod===0) {
    // Две половины кожистой пластинки наклонены от продольного киля.
    // Локальная поперечная касательная следует закручиванию каждого листочка.
    const {position,normal,uv}=g.attributes;
    const wing=new THREE.Vector3(), n=new THREE.Vector3(), other=new THREE.Vector3();
    for(let i=trunkEnd;i<position.count;i++) {
      const u=uv.getX(i), t=uv.getY(i);
      if(t<=0 || t>=1 || Math.abs(u)!==1) continue;
      n.fromBufferAttribute(normal,i);
      wing.fromBufferAttribute(position,i).sub(other.fromBufferAttribute(position,i-Math.sign(u)));
      wing.addScaledVector(n,-wing.dot(n)).normalize();
      n.addScaledVector(wing,.30+.16*Math.sin(t*Math.PI)).normalize();
      normal.setXYZ(i,n.x,n.y,n.z);
    }
  }
  VEG_GEN.ms += performance.now() - start;
  cache.set(key, g);
  return g;
}
