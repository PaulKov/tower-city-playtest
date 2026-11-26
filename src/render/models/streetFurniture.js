// Уличная мебель из меню. Для фонарей и скамеек на участках используется сетка с меньшим числом граней.
import * as THREE from 'three';
import * as G from '../geomUtils.js';
import { finishU, finishGeometry, PROP_FINISH as F } from '../propFinishes.js';

const IRON = '#364044', WOOD = '#b07a4a', WOOD_DARK = '#8a5a34';
const v3 = (q) => new THREE.Vector3(q[0], q[1], q[2]);
/** Трубка вдоль сглаженной кривой через точки pts, радиус r (кованые детали). */
function ironTube(pts, r, seg, radial, compact) {
  const curve = new THREE.CatmullRomCurve3(pts.map(v3));
  const steps = compact === 'far' ? Math.round(seg / 5) : compact ? Math.round(seg / 2) : seg;
  return G.colored(new THREE.TubeGeometry(curve, steps, r, compact === 'far' ? 3 : compact ? 4 : radial, false), IRON);
}

/**
 * Нормали точёного тела (LatheGeometry с segments секторами) после смещения вершин: computeVertexNormals считает
 * первую и последнюю копию вершин шва по разным граням — вдоль шва шла светлая линия. Пары шва — общая нормаль.
 */
function latheNormals(g, segments) {
  g.computeVertexNormals();
  const n = g.getAttribute('normal'), P = g.getAttribute('position').count / (segments + 1), v = new THREE.Vector3();
  for (let j = 0; j < P; j++) {
    const a = j, b = segments * P + j;
    v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}

const HEAD_X = 0.66, EDGE = '#626963', BRASS = '#877650', DARK = '#303a3e';
const lathe = (profile, sectors, color, x = 0) => G.colored(new THREE.LatheGeometry(
  profile.map(([r, y]) => new THREE.Vector2(r, y)), sectors).translate(x, 0, 0), color);
const tube = (curve, radius, steps, sides, color = IRON) => G.colored(new THREE.TubeGeometry(curve, steps, radius, sides), color);
const curve = (a, b, c, d) => new THREE.CubicBezierCurve3(v3(a), v3(b), v3(c), v3(d));

/** Круглый чугунный столб, плавный дуговой вынос и завиток снизу. Корпус и остекление
 * собраны в местных координатах одного фонаря. На каждом уровне детализации у улицы два батча. */
export function lampGeometry(compact = false) {
  const far = compact === 'far', radial = far ? 8 : compact ? 16 : 30;
  const profile = far ? [[0.17, 0], [0.17, 0.07], [0.14, 0.10], [0.14, 0.17], [0.10, 0.23],
    [0.059, 0.49], [0.049, 1.22], [0.045, 2.82], [0.056, 2.88], [0.041, 3.0], [0.054, 3.06], [0, 3.20]] :
    [[0.162, 0], [0.174, 0.015], [0.174, 0.047], [0.164, 0.065], [0.143, 0.078], [0.141, 0.15],
    [0.134, 0.176], [0.113, 0.198], [0.106, 0.213], [0.116, 0.225], [0.119, 0.243], [0.111, 0.260],
    [0.094, 0.282], [0.078, 0.328], [0.062, 0.414], [0.074, 0.438], [0.075, 0.45], [0.060, 0.47],
    [0.054, 0.52], [0.050, 1.145], [0.062, 1.166], [0.064, 1.193], [0.057, 1.21], [0.049, 1.237],
    [0.044, 2.815], [0.061, 2.844], [0.062, 2.875], [0.046, 2.907], [0.044, 2.974],
    [0.033, 3.010], [0.051, 3.035], [0.059, 3.064], [0.055, 3.087], [0.04, 3.107], [0.024, 3.117], [0, 3.216]];
  const post = lathe(profile, radial, IRON), pos = post.attributes.position, colors = post.attributes.color;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x);
    // Тонкая каннелюра на шейке и видимой части стержня, гладко входит в профилированные воротники.
    if (!far && y >= 0.28 && y < 2.84) {
      const flute = Math.cos(6 * a) * 0.040;
      pos.setXYZ(i, x * (1 + flute), y, z * (1 + flute));
    }
    const band = (y > 0.21 && y < 0.26) || (y > 1.16 && y < 1.205) || (y > 2.84 && y < 2.88);
    c.set(band ? EDGE : IRON);
    if (!band) c.multiplyScalar(0.94 + 0.06 * Math.cos(5 * a));
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  latheNormals(post, radial);
  const parts = [post];
  const sides = far ? 4 : compact ? 6 : 9;
  // У подвеса касательная вертикальна. Один непрерывный радиус изгиба доходит до шейки колпака.
  const arm = curve([0.01, 2.862, 0], [0.19, 3.147, 0], [HEAD_X, 3.349, 0], [HEAD_X, 3.102, 0]);
  parts.push(tube(arm, 0.024, far ? 11 : compact ? 23 : 34, sides));
  const joint = arm.getPoint(0.59), control = joint.clone().addScaledVector(arm.getTangent(0.59), -0.12);
  const brace = new THREE.CubicBezierCurve3(v3([0.027, 2.593, 0]), v3([0.16, 2.604, 0]), control, joint);
  parts.push(tube(brace, 0.014, far ? 5 : compact ? 12 : 20, sides));
  // Конец раскован в плавно сходящийся завиток с круглым завальцованным зерном.
  const curl = [], weld = brace.getPoint(0.48), tangent = brace.getTangent(0.48);
  const a0 = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
  const cx = weld.x - 0.096 * Math.cos(a0), cy = weld.y - 0.096 * Math.sin(a0);
  for (let j = 0; j <= 14; j++) {
    const t = j / 14, a = a0 + 6.4 * t, r = 0.096 - 0.065 * t;
    curl.push(new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), 0));
  }
  const spiral = new THREE.CatmullRomCurve3(curl);
  parts.push(tube(spiral, 0.010, far ? 8 : compact ? 19 : 29, far ? 3 : sides, EDGE));
  if (!far) parts.push(G.place(G.sphere(0.013, compact ? 7 : 10, 4, EDGE), { x: curl.at(-1).x, y: curl.at(-1).y }));
  // Купольная крыша с закатанной кромкой, вогнутой шейкой и бронзовой втулкой подвеса.
  const cap = far ? [[0.121,2.987],[0.163,2.994],[0.170,3.006],[0.132,3.028],[0.088,3.063],[0.047,3.085],[0.027,3.105]] :
    [[0.118,2.987],[0.153,2.987],[0.168,2.992],[0.173,2.999],[0.171,3.006],[0.160,3.013],
      [0.144,3.018],[0.129,3.027],[0.110,3.043],[0.093,3.061],[0.073,3.076],[0.052,3.084],[0.038,3.086],[0.030,3.093]];
  parts.push(lathe(cap, far ? 12 : compact ? 20 : 32, DARK, HEAD_X));
  if (!far) parts.push(lathe([[0.029,3.087],[0.037,3.091],[0.038,3.098],[0.030,3.105],[0.025,3.115]], radial, BRASS, HEAD_X));
  const basket = far ? [[0,2.726],[0.044,2.749],[0.086,2.768],[0.100,2.786],[0.085,2.794]] :
    [[0,2.719],[0.022,2.728],[0.026,2.743],[0.052,2.752],[0.080,2.761],[0.094,2.773],[0.101,2.780],[0.100,2.787],[0.088,2.796]];
  parts.push(lathe(basket, radial, IRON, HEAD_X));
  // Четыре гнутые стойки оставляют стороны окна открытыми даже у маленького плафона на карте.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * (i * 0.5 + 0.25), v = (r, y) => [HEAD_X + r * Math.cos(a), y, r * Math.sin(a)];
    parts.push(tube(curve(v(0.088,2.782), v(0.120,2.811), v(0.146,2.935), v(0.140,2.994)),
      far ? 0.007 : 0.009, far ? 2 : compact ? 5 : 8, far ? 3 : sides, EDGE));
  }
  if (!far) parts.push(lathe([[0.022,2.921],[0.027,2.929],[0.028,2.947],[0.024,2.956],[0.020,2.991]], radial, BRASS, HEAD_X));
  if (compact) for (const part of parts) finishGeometry(part,F.metal);
  return G.mergeColored(parts);
}

/** Молочная лампочка и внешнее выдувное стекло. Лампочка рисуется первой, затем полупрозрачное стекло
 * поверх неё в том же вызове. Оправу рисует непрозрачный батч корпуса. */
export function lampHeadGeometry(compact = false) {
  const far = compact === 'far', n = far ? 8 : compact ? 16 : 24;
  const bulb = lathe(far ? [[0,2.831],[0.045,2.862],[0.041,2.893],[0.022,2.931]] :
    [[0,2.831],[0.024,2.837],[0.040,2.851],[0.046,2.871],[0.044,2.890],
    [0.036,2.903],[0.023,2.915],[0.022,2.931]], n, '#fff4cb', HEAD_X);
  const glassProfile = far ? [[0.083,2.774],[0.108,2.807],[0.136,2.925],[0.135,2.996]] :
    [[0.083,2.774],[0.096,2.786],[0.108,2.809],[0.121,2.848],[0.131,2.893],[0.138,2.941],[0.139,2.973],[0.136,2.996]];
  const g = G.mergeColored([bulb, lathe(glassProfile, n, '#e7f2e8', HEAD_X)]);
  const pos = g.attributes.position, rgb = g.attributes.color, rgba = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i) - HEAD_X, pos.getZ(i));
    rgba[4 * i] = rgb.getX(i); rgba[4 * i + 1] = rgb.getY(i); rgba[4 * i + 2] = rgb.getZ(i);
    rgba[4 * i + 3] = r < 0.070 ? 1 : 0.25 + 0.12 * Math.abs(pos.getY(i) - 2.885) / 0.112;
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return g;
}

/** Две дистанции уличного фонаря. Корпус и стекло каждого уровня используют один буфер матриц.
 * Буферы меняются только при переходе фонаря через границу с гистерезисом. */
export function streetLampBatches(bodyName, headName, bodyMaterial, glassMaterial, spots, cast) {
  const count = spots.length, capacity = Math.max(1, count), matrices = new Float32Array(count * 16);
  const transform = new THREE.Matrix4(), levels = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = spots[i];
    transform.makeRotationY(p.ry || 0).setPosition(p.x, p.y, p.z).toArray(matrices, i * 16);
  }
  function pair(detail, suffix) {
    const body = new THREE.InstancedMesh(lampGeometry(detail), bodyMaterial, capacity);
    const head = new THREE.InstancedMesh(lampHeadGeometry(detail), glassMaterial, capacity);
    body.name = bodyName + suffix; head.name = headName + suffix;
    body.castShadow = cast; head.receiveShadow = body.receiveShadow = true;
    head.instanceMatrix = body.instanceMatrix;
    body.instanceMatrix.array.set(matrices);
    body.count = head.count = count;
    body.computeBoundingSphere(); head.computeBoundingSphere();
    return { body, head };
  }
  const far = pair('far', ''), near = pair(true, 'Near');
  near.body.count = near.head.count = 0;
  near.body.visible = near.head.visible = false;
  far.body.visible = far.head.visible = count > 0;
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  return {
    meshes: [far.body, far.head, near.body, near.head],
    update(camera) {
      const eye = camera?.position;
      if (!eye || last.distanceToSquared(eye) < 0.16) return;
      last.copy(eye);
      let changed = false;
      for (let i = 0; i < count; i++) {
        const p = spots[i], dx = eye.x - p.x, dy = eye.y - p.y - 2, dz = eye.z - p.z;
        const lod = dx * dx + dy * dy + dz * dz < (levels[i] ? 18 * 18 : 16 * 16) ? 1 : 0;
        if (lod !== levels[i]) { levels[i] = lod; changed = true; }
      }
      if (!changed) return;
      let n = 0, f = 0;
      for (let i = 0; i < count; i++) {
        const mesh = levels[i] ? near.body : far.body, slot = levels[i] ? n++ : f++;
        transform.fromArray(matrices, i * 16); mesh.setMatrixAt(slot, transform);
      }
      near.body.count = near.head.count = n; far.body.count = far.head.count = f;
      near.body.visible = near.head.visible = n > 0; far.body.visible = far.head.visible = f > 0;
      far.body.instanceMatrix.needsUpdate = near.body.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Сухая доска с фрезерованной кромкой. Торцевой спил имеет свою развёртку:
 * годичные кольца поперёк доски, волокна на пласти и длинной кромке вдоль неё. */
export function streetPlank(w,h,d,color,seed,close = true) {
  const b = Math.min(0.012,h*0.16,d*0.16), positions=[], uv=[], index=[];
  const offset=(seed*0.179)%0.60, ends=(seed*0.057)%0.16;
  const grainStart=0.025+(seed*0.173)%0.26, span=0.96-grainStart;
  const profile=(x,inset) => {
    const y=h/2-inset, z=d/2-inset, r=close ? b*0.85 : 0;
    const yz=close ? [[y-r,-z],[y,-z+r],[y,z-r],[y-r,z],[-y+r,z],[-y,z-r],[-y,-z+r],[-y+r,-z]]
      : [[y,-z],[y,z],[-y,z],[-y,-z]];
    return yz.map(([py,pz])=>[x,py,pz]);
  };
  const face=(points,end,top=false) => {
    const first=positions.length/3;
    for (let i=0;i<points.length;i++) {
      const [x,y,z]=points[i];positions.push(x,y,z);
      const u=end ? 0.46+ends+z/d*0.42 : grainStart+span*(0.5+(seed%2 ? 1 : -1)*x/w);
      uv.push(finishU(end?F.endgrain:F.wood,u),end ? 0.38+y/h*0.4 : 0.20+offset+(top?z/d:y/h)*0.32);
      if(i>=2) index.push(first,first+i-1,first+i);
    }
  };
  const rings=close ? [profile(-w/2,b*0.6),profile(-w/2+b,0),profile(w/2-b,0),profile(w/2,b*0.6)]
    : [profile(-w/2,0),profile(w/2,0)];
  for(let j=1;j<rings.length;j++) for(let i=0;i<rings[j].length;i++) {
    const k=(i+1)%rings[j].length, a=rings[j-1], c=rings[j];
    face([a[i],a[k],c[k],c[i]],false,Math.abs(a[i][2]-a[k][2])>Math.abs(a[i][1]-a[k][1]));
  }
  face(rings[0].slice().reverse(),true);face(rings.at(-1),true);
  const board=new THREE.BufferGeometry();
  board.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  board.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  board.setIndex(index);board.computeVertexNormals();
  return G.colored(board,color);
}

/** Скамейка: скруглённые рейки сиденья и спинки, чугунные боковины с подлокотником-завитком. */
export function benchGeometry(compact = false) {
  const p = [];
  let board=0;
  const slat = (h, d, r, color) => compact ? streetPlank(1.6,h,d,color,++board,compact !== 'far') : G.roundedBox(1.6,h,d,r,3,color);
  for (let i = 0; i < 3; i++) p.push(G.place(slat(0.05, 0.12, 0.018, i % 2 ? WOOD_DARK : WOOD), { y: 0.45, z: -0.16 + i * 0.14 }));
  for (let i = 0; i < 3; i++) p.push(G.place(slat(0.1, 0.04, 0.015, i % 2 ? WOOD : WOOD_DARK), { y: 0.62 + i * 0.13, z: -0.25 - i * 0.02, rx: -0.14 }));
  for (const x of [-0.72, 0.72]) {
    const first=p.length;
    p.push(ironTube([[x, 0, 0.18], [x, 0.22, 0.12], [x, 0.43, 0.06], [x, 0.43, -0.18], [x, 0.0, -0.22]], 0.022, 24, 8, compact));
    p.push(ironTube([[x, 0.43, -0.2], [x, 0.66, -0.26], [x, 0.98, -0.32]], 0.02, 16, 8, compact));
    p.push(ironTube([[x, 0.43, 0.14], [x, 0.6, 0.12], [x, 0.64, -0.02], [x, 0.62, -0.2]], 0.018, 20, 8, compact));
    if (compact) {
      for (let j=first;j<p.length;j++) finishGeometry(p[j],F.metal);
      if (compact !== 'far') {
        for (const z of [-0.22,0.18]) p.push(G.place(finishGeometry(G.box(0.092,0.016,0.075,IRON),F.metal),{x,y:0.008,z}));
        for(let i=0;i<3;i++) {
          const head = () => finishGeometry(G.colored(new THREE.CircleGeometry(0.017,7), '#5b5850'),F.metal);
          p.push(G.place(head(),{x,y:0.477,z:-0.16+i*0.14,rx:-Math.PI/2}),
            G.place(head(),{x,y:0.62+i*0.13,z:-0.228-i*0.02,rx:-0.14}));
        }
      }
    }
  }
  return G.mergeColored(p);
}

/** Урна: точёный корпус с ободом и крышкой. */
export function binGeometry() {
  const prof = [[0, 0], [0.17, 0], [0.18, 0.03], [0.17, 0.05], [0.19, 0.58], [0.21, 0.6], [0.21, 0.64], [0.19, 0.66], [0.12, 0.7], [0.03, 0.72], [0, 0.73]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 28), bp = body.getAttribute('position');
  for (let i = 0; i < bp.count; i++) { // рейки корпуса
    const y = bp.getY(i);
    if (y > 0.06 && y < 0.57) { const x = bp.getX(i), z = bp.getZ(i), k = 1 + 0.03 * Math.cos(Math.atan2(z, x) * 14); bp.setXYZ(i, x * k, y, z * k); }
  }
  latheNormals(body, 28);
  return G.mergeColored([G.colored(body, '#5b6a5c')]);
}

/** Вазон с цветами на площади: ящик из скруглённых досок с угловыми стойками и земля (цветы — спрайты). */
export function planterGeometry() {
  const p = [];
  for (let k = 0; k < 3; k++) {
    const y = 0.07 + k * 0.11, c = k % 2 ? WOOD_DARK : WOOD;
    p.push(G.place(G.roundedBox(1.0, 0.1, 0.04, 0.012, 2, c), { y, z: 0.23 }), G.place(G.roundedBox(1.0, 0.1, 0.04, 0.012, 2, c), { y, z: -0.23 }));
    p.push(G.place(G.roundedBox(0.04, 0.1, 0.46, 0.012, 2, c), { x: 0.48, y }), G.place(G.roundedBox(0.04, 0.1, 0.46, 0.012, 2, c), { x: -0.48, y }));
  }
  for (const x of [-0.49, 0.49]) for (const z of [-0.24, 0.24]) p.push(G.place(G.roundedBox(0.07, 0.4, 0.07, 0.015, 2, '#7a4a28'), { x, y: 0.2, z }));
  p.push(G.place(G.box(0.92, 0.04, 0.42, '#5a3d2a'), { y: 0.35 }));
  return G.mergeColored(p);
}
