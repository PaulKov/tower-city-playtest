// Атлас масок растительности (спецификация «Растительность» §5.3; план, отличие 2): canvas 512², четыре квадранта
// по 256² — листва, хвоя, цветы, трава. RGB — светлота детали (0,8–1,0), A — маска; края квадрантов прозрачны (PAD).
// Сплошные части (ядра, стволы, подушки, камни) получают uv = SOLID_UV, шейдер подставляет белый тексель.
// Атлас один на страницу; время построения копится в VEG_GEN.ms вместе с геометриями.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';

export const ATLAS_SIZE = 512;
const Q = ATLAS_SIZE / 2, PAD = 6;
/** Время генерации растительности на странице, мс (атлас и геометрии); его читают load_check и perf_check. */
export const VEG_GEN = { ms: 0 };

/** Работа синхронной фабрики может включать другую такую же фабрику (например опад для клёна). */
export function generationStamp() { return { total: VEG_GEN.ms, start: performance.now() }; }
export function finishGeneration(stamp) { VEG_GEN.ms = stamp.total + (performance.now() - stamp.start); }
/** uv сплошных частей. */
export const SOLID_UV = -1;

/** Квадранты: [столбец, строка] сверху слева. */
const QUADS = { leaf: [0, 0], needle: [1, 0], flower: [0, 1], grass: [1, 1] };
/** Прямоугольники uv [u0, v0, u1, v1] без отступа; flipY: верх canvas — v = 1. */
export const ATLAS_RECTS = Object.fromEntries(Object.entries(QUADS).map(([k, [qx, qy]]) => [k, [
  (qx * Q + PAD) / ATLAS_SIZE, 1 - ((qy + 1) * Q - PAD) / ATLAS_SIZE,
  ((qx + 1) * Q - PAD) / ATLAS_SIZE, 1 - (qy * Q + PAD) / ATLAS_SIZE,
]]));

const grey = (l) => { const g = Math.round(255 * l); return `rgb(${g},${g},${g})`; };

/** Листва: 70 перекрывающихся листьев в рваном круге, своя светлота у каждого (маска прототипа, §3.3). */
function drawLeaves(x, r) {
  for (let i = 0; i < 70; i++) {
    const a = r.uniform(0, Math.PI * 2), d = Math.sqrt(r.next()) * 0.36 * Q;
    x.save();
    x.translate(Q / 2 + Math.cos(a) * d, Q / 2 + Math.sin(a) * d);
    x.rotate(a + r.uniform(-0.45, 0.45));
    x.fillStyle = grey(r.uniform(0.8, 1));
    x.beginPath();
    x.ellipse(0, 0, Q * r.uniform(0.075, 0.105), Q * r.uniform(0.04, 0.055), 0, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.12)';
    x.lineWidth = 1.5;
    x.stroke();
    x.restore();
  }
}

/** Хвоя: три веточки веером, иглы в обе стороны под углом вверх. */
function drawNeedles(x, r) {
  x.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    x.save();
    x.translate(Q / 2 + (k - 1) * 40, Q - 24);
    x.rotate((k - 1) * 0.35);
    x.strokeStyle = grey(0.82);
    x.lineWidth = 4;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -180); x.stroke();
    for (let i = 0; i < 26; i++) {
      const t = 10 + i * 6.6, len = 34 * (1 - i / 34) + r.uniform(0, 6), side = i % 2 ? 1 : -1;
      x.strokeStyle = grey(r.uniform(0.8, 1));
      x.lineWidth = 3;
      x.beginPath(); x.moveTo(0, -t); x.lineTo(side * len * 0.8, -t - len * 0.6); x.stroke();
    }
    x.restore();
  }
}

/** Ромашка на газоне: краевые язычковые цветки в два ряда, жёлтая корзинка и стебель. */
function drawFlower(x, r) {
  const cx=Q*.51, cy=Q*.41;
  x.beginPath(); x.moveTo(cx,cy); x.quadraticCurveTo(cx+19,181,cx-3,Q);
  x.strokeStyle='#668850'; x.lineWidth=5; x.stroke();
  for (let k=0;k<2;k++) for(let i=0;i<13;i++) {
    const a=(i+.48*k)*Math.PI*2/13+r.uniform(-.06,.06);
    const length=r.uniform(60,78)*(1-.19*k), width=r.uniform(8.5,13);
    x.save();
    x.translate(cx,cy); x.scale(1,.82);
    x.rotate(a);
    const fold=x.createLinearGradient(0,-width,1,width);
    fold.addColorStop(0,grey(.83)); fold.addColorStop(.42,grey(.97));
    fold.addColorStop(.57,grey(.90)); fold.addColorStop(1,grey(.76+.10*k));
    x.fillStyle=fold;
    x.beginPath(); x.moveTo(11,0);
    x.bezierCurveTo(30,-.48*width,length*.72,-1.22*width,length,-.53*width);
    x.quadraticCurveTo(length+4,-.16*width,length-1.5,0);
    x.quadraticCurveTo(length+1,.88*width,length-7,.86*width);
    x.bezierCurveTo(.56*length,.72*width,26,.28*width,11,0); x.fill();
    x.beginPath(); x.moveTo(17,0); x.quadraticCurveTo(.62*length,-1.1,length-6,-width*.14);
    x.strokeStyle=grey(.78+.09*k); x.lineWidth=1; x.stroke();
    x.restore();
  }
  x.fillStyle='#bf9142'; x.beginPath(); x.ellipse(cx,cy,20,16,-.13,0,Math.PI*2); x.fill();
  for(let i=0;i<83;i++){
    const a=i*2.39996, rad=Math.sqrt(i/83)*18;
    x.fillStyle=i%4 ? '#eabe59' : '#aa7736';
    x.beginPath(); x.arc(cx+rad*Math.cos(a),cy+.78*rad*Math.sin(a),r.uniform(.8,1.8),0,Math.PI*2); x.fill();
  }
}

/** Листья злаков ослабевают у кончика и отгибаются в разные стороны от узлов кущения. */
function drawGrass(x, r) {
  const bottom = Q-PAD;
  for (const crown of [24,43,70,79,108,129,147,169,187,211,232]) {
    const direction = r.uniform(-15,15), count = 4 + Math.floor(r.next()*3);
    for (let leaf=0;leaf<count;leaf++) {
      const bx=crown+r.uniform(-6,6), by=bottom+r.uniform(0,7);
      const length=r.uniform(0.25,1.02)*(228-0.77*Math.abs(bx-138)), width=r.uniform(3.4,8.3);
      const dx=direction+r.uniform(-58,53), top=by-length, tipY=top+length*r.uniform(0.02,0.26);
      const gradient=x.createLinearGradient(0,by,0,top);
      gradient.addColorStop(0,grey(0.8)); gradient.addColorStop(0.59,grey(r.uniform(0.87,0.98)));
      gradient.addColorStop(1,grey(r.uniform(0.91,1))); x.fillStyle=gradient;
      x.beginPath(); x.moveTo(bx-0.13*width,by);
      x.bezierCurveTo(bx+dx*0.04-width*0.77,by-length*0.42,bx+dx*0.59-width*0.54,top-0.08*length,bx+dx,tipY);
      x.bezierCurveTo(bx+dx*0.52+width*0.67,top-0.025*length,bx+dx*0.04+width*0.8,by-length*0.42,bx+width*0.18,by);
      x.closePath(); x.fill();
      x.beginPath(); x.moveTo(bx,by);
      x.bezierCurveTo(bx+dx*.04,by-length*.42,bx+dx*.58,top-.04*length,bx+dx,tipY);
      x.bezierCurveTo(bx+dx*.52+width*.67,top-.025*length,bx+dx*.04+width*.8,by-length*.42,bx+width*.18,by);
      x.fillStyle='rgba(41,51,33,.25)'; x.fill();
    }
  }
  // Узкая лента геометрии читает эту же складку в середине газонного пучка.
  const fold=x.createLinearGradient(119,0,136,0);
  for(const [u,l] of [[0,.63],[.43,.94],[.52,1],[.58,.78],[1,.64]]) fold.addColorStop(u,grey(l));
  x.fillStyle=fold; x.beginPath(); x.moveTo(122,bottom); x.quadraticCurveTo(116,91,129,10);
  x.quadraticCurveTo(139,101,133,bottom); x.closePath(); x.fill();
}

const DRAW = { leaf: drawLeaves, needle: drawNeedles, flower: drawFlower, grass: drawGrass };
let atlas = null;
let saltgrass = null;

/** ʻАкиʻаки: из узлов прижатого к песку стебля выходят короткие побеги с узкими двурядными листьями.
 * Отдельная маска занимает всю карточку. Её создаёт только гавань, при первой отрисовке травы high. */
export function saltgrassTexture() {
  if (saltgrass) return saltgrass;
  const t0 = performance.now(), cv = document.createElement('canvas');
  cv.width = cv.height = Q;
  const x = cv.getContext('2d'), rng = createRng(295);
  const baseY = (u) => 239 - 6 * Math.sin(u * 0.037) + 2.2 * Math.sin(u * 0.083);
  x.lineCap = x.lineJoin = 'round';
  x.beginPath();
  for (let u = 14; u <= 242; u += 3) {
    if (u === 14) x.moveTo(u, baseY(u));
    else x.lineTo(u, baseY(u));
  }
  x.strokeStyle = '#b9ac85'; x.lineWidth = 4.5; x.stroke();
  for (const [root, lean, height] of [[34, -12, 80], [77, 24, 127], [119, -8, 95], [160, -19, 141], [208, 19, 84]]) {
    const y0 = baseY(root), at = (t) => root + lean * t + 4 * Math.sin(t * Math.PI);
    x.beginPath(); x.moveTo(root, y0); x.quadraticCurveTo(at(0.48), y0 - 0.48 * height, at(1), y0 - height);
    x.strokeStyle = grey(rng.uniform(0.74, 0.86)); x.lineWidth = 4; x.stroke();
    for (let i = 0; i < 6; i++) {
      const t = 0.14 + i * 0.132, u = at(t), v = y0 - t * height;
      const dx = (i % 2 ? 1 : -1) * rng.uniform(21, 39) * (1.1 - 0.35 * t);
      const dy = rng.uniform(22, 46) + t * 12;
      x.beginPath(); x.moveTo(u - 2, v + 1);
      x.quadraticCurveTo(u + dx * 0.46, v - 0.78 * dy, u + dx, v - dy);
      x.quadraticCurveTo(u + dx * 0.51, v - 0.35 * dy, u + 2, v - 2);
      x.fillStyle = grey(rng.uniform(0.81, 1)); x.fill();
    }
    if (height < 125) continue;
    // Узкая метёлка над листовой частью, с серо-соломенными колосками.
    const y = y0 - height;
    x.beginPath(); x.moveTo(at(1), y); x.lineTo(at(1) + 5, y - 25);
    x.strokeStyle = '#e8d5aa'; x.lineWidth = 2; x.stroke();
    for (let j = 1; j < 6; j++) {
      x.beginPath(); x.ellipse(at(1) + j + (j % 2 ? 1.7 : -1.7), y - j * 4, 1.9, 4, j % 2 ? 0.42 : -0.42, 0, Math.PI * 2);
      x.fillStyle = '#e8d5aa'; x.fill();
    }
  }
  saltgrass = new THREE.CanvasTexture(cv);
  saltgrass.name = 'akiakiGrass';
  saltgrass.colorSpace = THREE.SRGBColorSpace;
  saltgrass.anisotropy = 4;
  VEG_GEN.ms += performance.now() - t0;
  return saltgrass;
}

/** Атлас масок; создаётся при первом вызове, дальше тот же объект. */
export function vegetationAtlas() {
  if (atlas) return atlas;
  const t0 = performance.now();
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_SIZE;
  const ctx = cv.getContext('2d');
  for (const [k, [qx, qy]] of Object.entries(QUADS)) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(qx * Q + PAD, qy * Q + PAD, Q - 2 * PAD, Q - 2 * PAD);
    ctx.clip();
    ctx.translate(qx * Q, qy * Q);
    DRAW[k](ctx, createRng(11 + qx + 2 * qy));
    ctx.restore();
  }
  atlas = new THREE.CanvasTexture(cv);
  atlas.name = 'vegetationAtlas';
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  VEG_GEN.ms += performance.now() - t0;
  return atlas;
}
