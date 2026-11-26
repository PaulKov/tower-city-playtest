// Башенный кран: мачта из instanced-секций, поворотная часть (стрела-ферма, противовес, кабина),
// тележка, трос, обойма с крюком и стропами, мигающие огоньки. ~8 вызовов отрисовки.
// Координаты setHook — в пространстве crane.group: точка подвеса = центр верха висящего этажа.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { W0, D0 } from '../../core/levels.js';
import * as G from '../geomUtils.js';
import { mat, customMat, standard, PALETTE } from '../materials.js';
import { finishGeometry, propFinishPatch, PROP_FINISH as F } from '../propFinishes.js';
import { forgedHook, hookLatch, rigHead, slingEnds } from './hookRig.js';

const SEG = 1.5;            // высота секции мачты
const MAX_SEG = 400;
const MAST_A = 0.45;        // полуширина мачты по осям поясов
const JIB = 12;             // длина стрелы
const CJIB = 4.5;           // длина консоли противовеса
const TURN_H = 0.3;         // поворотный круг под стрелой
const TROLLEY_DROP = 0.37;  // точка схода троса ниже нижнего пояса стрелы
const HOOK_TOP = 1.7;       // верх обоймы над точкой подвеса груза
const CABLE_REST = 3.6;     // свободный трос в покое
const CABLE_MIN = 1.2;
const CLIMB = 2.2;          // скорость подстройки высоты крана, 1/с
const BLINK = 1, BLINK_ON = 0.25;
const ON = 2.6, OFF = 0.12;
const Y = PALETTE.craneYellow, R = PALETTE.craneRed, STEEL = PALETTE.steel, DARK = PALETTE.steelDark;

function mastSegment() {
  const a = MAST_A, h = SEG, p = [];
  for (const [x, z] of [[-a, -a], [a, -a], [a, a], [-a, a]]) p.push(G.place(G.box(0.09, h, 0.09, Y), { x, y: h / 2, z }));
  for (const s of [1, -1]) {
    p.push(G.place(G.box(2 * a, 0.06, 0.06, Y), { y: 0.06, z: s * a }));
    p.push(G.place(G.box(0.06, 0.06, 2 * a, Y), { y: 0.06, x: s * a }));
  }
  p.push(G.beam([-a, 0.06, a], [a, h - 0.06, a], 0.055, Y));
  p.push(G.beam([a, 0.06, -a], [-a, h - 0.06, -a], 0.055, Y));
  p.push(G.beam([a, 0.06, a], [a, h - 0.06, -a], 0.055, Y));
  p.push(G.beam([-a, 0.06, -a], [-a, h - 0.06, a], 0.055, Y));
  return G.mergeColored(p);
}

/** Поворотная часть. Начало — центр верха мачты под стрелой, стрела вдоль +x, y = 0 — нижний пояс. */
function topGeometry(near) {
  const p = [], zc = 0.32, yt = 0.75, x0 = 0.45;
  const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), turn = new THREE.Quaternion();
  function tube(a, b, diameter) {
    axis.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const length = axis.length(), radius = diameter / 2;
    const member = G.cylinder(radius, radius, length, near ? 24 : 10, Y);
    member.applyQuaternion(turn.setFromUnitVectors(up, axis.divideScalar(length)));
    member.translate((a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2);
    return finishGeometry(member, F.paint);
  }
  const radial=near?80:32;
  p.push(G.place(finishGeometry(G.cylinder(0.69,0.69,TURN_H,radial,DARK),F.metal),{ y:-TURN_H/2 }));
  p.push(G.place(G.cylinder(0.74,0.74,0.045,radial,Y),{ y:-0.042 }));
  if (near) {
    // Открытый нижний венец с зубьями, дорожкой подшипника и анкерным кругом.
    for (const [r,y,h,color] of [[0.724,-0.087,0.021,'#666953'],[0.703,-0.144,0.014,'#a29d81'],
      [0.713,-0.231,0.021,'#565d59']]) p.push(G.place(finishGeometry(G.cylinder(r,r,h,radial,color),F.metal),{y}));
    for(let i=0;i<64;i++) {
      const a=2*Math.PI*i/64;
      const tooth=G.box(0.037,0.056,0.029,i%3===0?'#726e57':'#676755');
      p.push(G.place(finishGeometry(tooth,F.metal),{x:0.697*Math.sin(a),z:0.697*Math.cos(a),y:-0.186,ry:a}));
    }
    for(let i=0;i<20;i++) {
      const a=Math.PI*i/10;
      p.push(G.place(G.cylinder(0.021,0.023,0.018,6,STEEL),{x:0.669*Math.sin(a),z:0.669*Math.cos(a),y:-0.012,ry:a}));
    }
  }
  // стрела: треугольная ферма
  for (const s of [1, -1]) p.push(tube([x0, 0, s * zc], [JIB, 0, s * zc], 0.08));
  p.push(tube([x0, yt, 0], [JIB - 0.5, yt, 0], 0.08));
  let k = 0;
  for (let x = x0; x < JIB - 0.01; x += 1, k++) {
    const x1 = Math.min(JIB, x + 1), xt = Math.min((x + x1) / 2, JIB - 0.5);
    for (const s of [1, -1]) {
      p.push(tube([x, 0, s * zc], [xt, yt, 0], 0.05));
      p.push(tube([xt, yt, 0], [x1, 0, s * zc], 0.05));
    }
    const s = k % 2 ? 1 : -1;
    p.push(tube([x, 0, s * zc], [x1, 0, -s * zc], 0.045));
    p.push(G.beam([x, 0, -zc], [x, 0, zc], 0.05, Y));
  }
  p.push(G.beam([JIB, 0, -zc], [JIB, 0, zc], 0.06, Y));
  // консоль противовеса
  for (const s of [1, -1]) p.push(tube([-x0, 0, s * 0.4], [-CJIB, 0, s * 0.4], 0.09));
  for (let x = -x0, i = 0; x > -CJIB; x -= 0.9, i++) {
    p.push(G.beam([x, 0, -0.4], [x, 0, 0.4], 0.06, Y));
    const s = i % 2 ? 1 : -1;
    p.push(G.beam([x, 0, s * 0.4], [Math.max(-CJIB, x - 0.9), 0, -s * 0.4], 0.05, Y));
  }
  p.push(G.place(G.box(CJIB - 0.6, 0.03, 0.74, DARK), { x: -(CJIB + x0) / 2, y: 0.065 }));
  for (const x of [-CJIB + 0.35, -CJIB + 0.95]) {
    p.push(G.place(finishGeometry(G.roundedBox(0.52,1.1,0.95,0.043,near?3:1,'#b1a899'),F.mineral),{x,y:-0.3}));
    if (near) {
      // Съёмная бетонная плита висит на двух монтажных проушинах.
      for(const z of [-0.25,0.25]) {
        const eye=new THREE.TorusGeometry(0.046,0.011,10,26,Math.PI).translate(x,0.25,z);
        p.push(finishGeometry(G.colored(eye,STEEL),F.metal));
      }
      for(const z of [-0.479,0.479]) {
        p.push(G.place(G.box(0.29,0.046,0.009,'#807a6b'),{x,y:0.006,z}));
        for(const dx of [-0.098,0.098]) p.push(G.place(G.cylinder(0.008,0.008,0.012,10,'#b4ac95'),{x:x+dx,y:0.006,z,rx:Math.PI/2}));
      }
    }
  }
  // оголовок и тяги
  const ay = 2.6, f = 1.1 / ay;
  const legs = [[0.45, 0.45], [-0.45, 0.45], [-0.45, -0.45], [0.45, -0.45]];
  for (const [x, z] of legs) p.push(tube([x, 0, z], [0, ay, 0], 0.08));
  for (let i = 0; i < 4; i++) {
    const [xa, za] = legs[i], [xb, zb] = legs[(i + 1) % 4];
    p.push(G.beam([xa * (1 - f), 1.1, za * (1 - f)], [xb * (1 - f), 1.1, zb * (1 - f)], 0.05, Y));
  }
  p.push(G.place(G.roundedBox(0.22, 0.14, 0.22, 0.04, 1, R), { y: ay }));
  p.push(G.beam([0, ay, 0], [JIB * 0.62, yt, 0], 0.035, STEEL));
  for (const s of [1, -1]) p.push(G.beam([0, ay, 0], [-CJIB + 0.3, 0.05, s * 0.38], 0.035, STEEL));
  // кабина
  const enamel='#e4dfc9', rubber='#303a3d';
  p.push(G.place(G.roundedBox(0.95,0.31,0.95,0.03,1,enamel),{x:0.25,y:-1.023,z:0.95}));
  p.push(G.place(G.roundedBox(0.965,0.048,0.965,0.018,1,'#b85e41'),{x:0.25,y:-1.074,z:0.95}));
  p.push(G.place(G.box(0.048,0.58,0.94,enamel),{x:-0.20,y:-0.596,z:0.95}));
  p.push(G.place(G.box(0.94,0.58,0.046,enamel),{x:0.25,y:-0.596,z:0.498}));
  // Панель приборов и кресло видны через оба стекла, в том числе при облёте кабины.
  p.push(G.place(finishGeometry(G.roundedBox(0.31,0.31,0.065,0.028,1,'#4b5452'),F.cloth),{x:0.14,y:-0.70,z:0.77,rx:-0.12}));
  p.push(G.place(finishGeometry(G.roundedBox(0.32,0.055,0.32,0.024,1,'#525d58'),F.cloth),{x:0.14,y:-0.818,z:0.91}));
  p.push(G.place(G.box(0.56,0.115,0.12,DARK),{x:0.28,y:-0.80,z:1.30,rx:0.19}));
  p.push(G.place(G.box(0.14,0.09,0.021,'#536c70'),{x:0.27,y:-0.70,z:1.28,rx:-0.27}));
  for (const x of [-0.034,0.31]) {
    p.push(G.place(G.roundedBox(0.044,0.032,0.21,0.010,1,'#404846'),{x,y:-0.750,z:0.95}));
    p.push(G.beam([x,-0.755,1.026],[x+0.009,-0.675,1.058],0.014,STEEL));
    p.push(G.place(G.sphere(0.020,12,6,'#3e4544'),{x:x+0.009,y:-0.675,z:1.058,sy:1.20}));
  }
  for(let i=0;i<5;i++) {
    p.push(G.place(G.cylinder(0.014,0.014,0.008,12,i===4?'#ba5940':'#959782'),{x:0.07+i*0.047,y:-0.731,z:1.29}));
  }
  for (const x of [-0.205,0.704]) for(const z of [0.503,1.397]) {
    p.push(G.place(G.box(0.052,0.59,0.052,enamel),{x,y:-0.592,z}));
  }
  // Косяки утопленного остекления, внешний водоотвод и нижняя площадка кабины.
  for (const z of [0.598,1.302]) p.push(G.place(G.box(0.031,0.51,0.028,DARK),{x:0.735,y:-0.64,z}));
  for (const x of [-0.102,0.602]) p.push(G.place(G.box(0.03,0.51,0.032,DARK),{x,y:-0.64,z:1.435}));
  p.push(G.place(G.box(0.77,0.022,0.052,DARK),{x:0.25,y:-0.899,z:1.432}));
  p.push(G.place(G.box(0.053,0.022,0.77,DARK),{x:0.737,y:-0.899,z:0.95}));
  p.push(G.place(finishGeometry(G.roundedBox(1.04,0.046,1.055,0.011,2,'#b8b7a8'),F.paint),{x:0.25,y:-0.300,z:0.95}));
  p.push(G.place(G.box(0.96,0.06,0.96,rubber),{x:0.25,y:-0.346,z:0.95}));
  // Люк слегка приподнят над кровлей. Его штампованные рёбра отводят дождь к задней кромке.
  p.push(G.place(finishGeometry(G.roundedBox(0.49,0.022,0.59,0.012,2,'#a8a99d'),F.paint),{x:0.22,y:-0.266,z:0.94}));
  for(let i=0;i<5;i++) p.push(G.place(G.roundedBox(0.018,0.014,0.46,0.005,1,'#bac0b1'),{x:0.046+0.084*i,y:-0.253,z:0.94}));
  // Снаружи дверная ручка, две петли и противоскользящая подножка.
  const handle=new THREE.CatmullRomCurve3([[0.743,-0.913,1.23],[0.77,-0.913,1.23],
    [0.773,-0.913,1.136],[0.743,-0.913,1.136]].map(p=>new THREE.Vector3(...p)));
  p.push(finishGeometry(G.colored(new THREE.TubeGeometry(handle,16,0.009,10,false),STEEL),F.metal));
  for (const y of [-0.855,-1.04]) p.push(G.place(G.cylinder(0.010,0.010,0.074,12,DARK),{x:0.727,y,z:0.59}));
  p.push(G.beam([0.57,-0.887,1.438],[0.56,-0.70,1.449],0.014,rubber));
  p.push(G.beam([0.43,-0.715,1.449],[0.64,-0.688,1.449],0.014,rubber));
  for(const x of [-0.15,0.56]) p.push(G.beam([x,-0.18,0.36],[x,-1.16,0.64],0.068,DARK));
  p.push(G.place(finishGeometry(G.box(1.08,0.065,1.24,STEEL),F.metal),{x:0.21,y:-1.20,z:0.97}));
  for(const x of [-0.20,0.61]) p.push(G.place(G.box(0.025,0.125,0.032,DARK),{x,y:-1.252,z:1.43}));
  for(const z of [1.45,1.49,1.53]) p.push(G.place(finishGeometry(G.box(0.89,0.018,0.023,STEEL),F.metal),{x:0.208,y:-1.305,z}));
  for (const y of [-0.77,-0.71,-0.65,-0.59]) p.push(G.place(G.box(0.24,0.024,0.028,DARK),{x:-0.15,y,z:0.477,rx:0.21}));
  return G.mergeColored(p);
}

function cabGlass() {
  const pane=()=>new THREE.PlaneGeometry(0.702,0.48);
  return G.mergeColored([
    G.place(pane(),{x:0.737,y:-0.643,z:0.95,ry:Math.PI/2}),
    G.place(pane(),{x:0.25,y:-0.643,z:1.437}),
  ]);
}

function beaconLights(material) {
  const radius = 0.09;
  const spheres = [[JIB+0.02,0.12], [0,2.75], [-CJIB-0.02,0.12]]
    .map(([x,y]) => new THREE.Sphere(new THREE.Vector3(x,y,0),radius));
  const lamps = new THREE.InstancedMesh(G.sphere(radius,10,8,0xffffff),material,spheres.length);
  lamps.name = 'beacons';
  lamps.receiveShadow = true;
  const clip = new THREE.Matrix4(), frustum = new THREE.Frustum();
  for (let i=0; i<spheres.length; i++) lamps.setMatrixAt(i,clip.makeTranslation(spheres[i].center));
  lamps.computeBoundingSphere();
  // Общая сфера охватывает 16 м пустоты между огнями. Только когда она попала
  // в кадр, уточняем по трём сферам в местных координатах для текущего прохода.
  lamps.onBeforeRender = (_renderer,_scene,camera) => {
    clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(lamps.matrixWorld);
    frustum.setFromProjectionMatrix(clip,camera.coordinateSystem,camera.reversedDepth);
    lamps.count = spheres.length;
    while (lamps.count && !frustum.intersectsSphere(spheres[lamps.count-1])) lamps.count--;
  };
  return lamps;
}

function trolleyGeometry() {
  const p = [G.place(G.roundedBox(0.7, 0.16, 0.86, 0.04, 1, Y), { y: -0.13 })];
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    p.push(G.place(G.cylinder(0.07, 0.07, 0.06, 10, DARK), { x: sx * 0.24, y: 0.08, z: sz * 0.32, rx: Math.PI / 2 }));
  }
  p.push(G.place(G.roundedBox(0.3, 0.14, 0.24, 0.04, 1, R), { y: -0.28 }));
  return G.mergeColored(p);
}

// Щека охватывает шкив и передаёт нагрузку на палец вертлюга. Прорези сквозные.
function sheaveCheek(near) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.053, -0.221);
  shape.bezierCurveTo(-0.085,-0.21, -0.103,-0.136, -0.157,-0.076);
  shape.bezierCurveTo(-0.227,0.012, -0.176,0.169, -0.081,0.181);
  shape.quadraticCurveTo(0,0.195,0.081,0.181);
  shape.bezierCurveTo(0.176,0.169, 0.227,0.012, 0.157,-0.076);
  shape.bezierCurveTo(0.103,-0.136, 0.085,-0.21, 0.053,-0.221);
  shape.quadraticCurveTo(0,-0.24,-0.053,-0.221);
  for (const side of [-1,1]) {
    const slot = new THREE.Path();
    slot.absellipse(side*0.117,0.068,0.017,0.038,0,2*Math.PI,false,side*-0.57);
    shape.holes.push(slot);
  }
  const plate = new THREE.ExtrudeGeometry(shape,{
    depth:0.026, steps:1, curveSegments:near?28:5, bevelEnabled:true,
    bevelSegments:near?6:1, bevelSize:0.005, bevelThickness:0.005,
  });
  const { position,uv } = plate.attributes;
  for(let i=0;i<position.count;i++) uv.setXY(i,(position.getX(i)+0.21)/0.42,(position.getY(i)+0.25)/0.46);
  const capNormals=plate.attributes.normal.clone();
  const smooth=toCreasedNormals(plate,Math.PI/3), normals=smooth.attributes.normal;
  for(let i=0;i<normals.count;i++) {
    const z=capNormals.getZ(i);
    if(Math.abs(z)>.99999) normals.setXYZ(i,0,0,Math.sign(z));
  }
  return finishGeometry(G.colored(smooth,Y),F.paint);
}

// Штампованные рёбра плавно сходят в лист. На торцах высота и ширина исчезают одновременно.
function cheekBead(side, face, near) {
  const path=new THREE.CatmullRomCurve3([[.048,-.166],[.082,-.116],[.123,-.071],
    [.151,-.022],[.156,.016],[.149,.046]].map(([x,y])=>new THREE.Vector3(side*x,y,0)));
  const along=near?34:12, across=near?10:4, xyz=[], index=[], center=new THREE.Vector3(), tangent=new THREE.Vector3();
  for(let i=0;i<=along;i++) {
    const t=i/along, taper=.04+.96*Math.sin(Math.PI*t)**.56;
    path.getPointAt(t,center); path.getTangentAt(t,tangent);
    for(let j=0;j<=across;j++) {
      const u=2*j/across-1, w=.0115*taper*u;
      xyz.push(center.x-w*tangent.y,1.515+center.y+w*tangent.x,face*(.1338+.0052*taper*(1-u*u)**2));
      if(i<along && j<across) {
        const a=i*(across+1)+j,b=a+across+1;
        if(face>0) index.push(a,b,a+1,a+1,b,b+1);
        else index.push(a,a+1,b,a+1,b+1,b);
      }
    }
  }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
  g.setIndex(index); g.computeVertexNormals();
  G.boxUv(g,1.8);
  return finishGeometry(G.colored(g,Y),F.paint);
}

/** Обойма, крюк. y = 0 — точка подвеса груза, HOOK_TOP — верх обоймы. */
function hookGeometry(near) {
  const p = [], axleY=1.515;
  const wheel=(r,h,z,color,segments=near?64:24)=>G.place(finishGeometry(G.cylinder(r,r,h,segments,color),F.metal),{y:axleY,z,rx:Math.PI/2});
  const turned = (profile,color,z=0,segments=near?72:28) => G.place(finishGeometry(G.colored(new THREE.LatheGeometry(
    profile.map(([r,h])=>new THREE.Vector2(r,h)),segments),color),F.metal),{y:axleY,z,rx:Math.PI/2});
  const groove=near ? [[.067,-.093],[.073,-.088],[.073,-.061],[.145,-.055],[.158,-.034],[.160,-.020],
    [.158,-.014],[.146,-.011],[.138,-.006],[.136,0],[.138,.006],[.146,.011],[.158,.014],
    [.160,.020],[.158,.034],[.145,.055],[.073,.061],[.073,.088],[.067,.093]]
    : [[.073,-.093],[.073,-.061],[.158,-.032],[.16,-.018],[.136,0],[.16,.018],[.158,.032],[.073,.061],[.073,.093]];
  p.push(turned(groove,'#757c78',0,near?72:20));
  const plate = sheaveCheek(near);
  for (const s of [-1,1]) {
    p.push(G.place(plate.clone(),{y:axleY,z:s*0.103,ry:s>0?0:Math.PI}));
    for (const side of [-1,1]) p.push(cheekBead(side,s,near));
    const boss=[[.024,-.009],[.074,-.009],[.078,-.006],[.078,.002],[.075,.005],[.059,.007],
      [.056,.012],[.053,.014],[.027,.014],[.024,.012]];
    const seat=turned(boss,'#777b70',.144);
    if(s<0) seat.rotateY(Math.PI);
    p.push(seat);
    // Шестигранная гайка с фасками и выступающим круглым торцом оси.
    const nut=turned([[.017,-.002],[.036,-.002],[.043,.004],[.043,.019],[.036,.025],[.017,.025]],'#686d64',.156,6);
    if(s<0) nut.rotateY(Math.PI);
    p.push(nut,wheel(.019,.010,s*.182,'#959b90'));
    if(near) {
      const lock=new THREE.TorusGeometry(.052,.0025,8,72,1.86*Math.PI);
      p.push(finishGeometry(G.colored(lock,'#4c564f'),F.metal).translate(0,axleY,s*.159));
      for (let k=0;k<2;k++) {
        const a=-.34+k*1.85*Math.PI;
        p.push(wheel(.005,.003,s*.160,'#667066',16).translate(.052*Math.cos(a),.052*Math.sin(a),0));
      }
    }
    const pin = wheel(0.031,0.021,s*0.143,STEEL,near?20:10);
    p.push(pin.translate(0,-0.185,0));
    if (near) {
      for (const x of [-0.082,0.082]) {
        const cap = wheel(0.011,0.009,s*0.137,'#705a43',8);
        p.push(cap.translate(x,0.135,0));
      }
      // Нижняя поперечина удерживает вертлюг. Кромка и заклёпки шильдика выступают над эмалью.
      p.push(G.place(G.box(0.103,0.037,0.004,'#554e42'),{y:1.395,z:s*0.135}));
      for (const x of [-0.039,0.039]) p.push(wheel(0.004,0.004,s*0.139,'#bcb5a1',8).translate(x,-0.12,0));
      for (const x of [-0.019,-0.005,0.013]) p.push(G.place(G.box(0.005,0.017,0.002,'#c4b99e'),{x,y:1.396,z:s*0.139,rz:-0.21}));
    }
  }
  plate.dispose();
  p.push(G.place(finishGeometry(G.cylinder(0.041,0.041,0.23,near?24:12,DARK),F.metal),{y:1.33,rx:Math.PI/2}));
  p.push(G.place(finishGeometry(G.cylinder(0.07,0.07,0.022,near?24:12,'#aea791'),F.metal),{y:1.251}));
  p.push(G.place(finishGeometry(G.cylinder(0.063,0.053,0.13,24,STEEL),F.metal),{y:1.276}));
  p.push(forgedHook(near), ...hookLatch(near));
  // У запасованного каната две прямые ветви и непрерывная нижняя дуга в ручье шкива.
  const wrap = new THREE.Curve();
  wrap.getPoint = (t,v=new THREE.Vector3()) => v.set(-.148*Math.cos(t*Math.PI),axleY-.148*Math.sin(t*Math.PI),0);
  p.push(finishGeometry(G.colored(new THREE.TubeGeometry(wrap,near?52:20,.013,near?16:10,false),'#747b74'),F.metal));
  const bareCount = p.reduce((n,g)=>n+(g.index?.count ?? g.attributes.position.count),0);
  p.push(...rigHead(near));
  // Выдавленные пластины приходят без индексов. Сохраняем индексацию колец, канавки
  // и поковки при слиянии: одна вершина каждой сетки обслуживает соседние треугольники.
  for(const part of p) if(!part.index) {
    const count=part.attributes.position.count;
    const indices=count>65535 ? new Uint32Array(count) : new Uint16Array(count);
    for(let i=0;i<count;i++) indices[i]=i;
    part.setIndex(new THREE.BufferAttribute(indices,1));
  }
  const result=G.mergeColored(p);
  result.userData.bareCount=bareCount;
  return result;
}

function slingWire(length,near) {
  if (!near) return G.cylinder(0.010,0.010,length,12,STEEL);
  // Шесть наружных прядей обвивают сердечник. Радиус и нормаль вычисляются по одной винтовой поверхности.
  const segments=Math.ceil(length*72), wires=6, lay=2*Math.PI/0.23;
  const g=new THREE.CylinderGeometry(1,1,length,32,segments,true);
  const p=g.attributes.position, n=g.attributes.normal, rgb=[];
  const steel=new THREE.Color('#828984');
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),z=p.getZ(i),y=p.getY(i), angle=Math.atan2(x,z);
    const phi=wires*(angle-lay*y), wave=Math.cos(phi), rough=Math.sin(phi);
    const radius=0.010*(0.936+0.064*wave);
    const da=-0.010*0.064*wires*rough, dy=-lay*da;
    const nx=x-z*da/radius, nz=z+x*da/radius, inv=1/Math.hypot(nx,dy,nz);
    p.setXYZ(i,x*radius,y,z*radius);
    n.setXYZ(i,nx*inv,-dy*inv,nz*inv);
    const tone=0.89+0.11*wave;
    rgb.push(steel.r*tone,steel.g*tone,steel.b*tone);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));
  return g;
}

const WIRE_LENGTH = 2.5;

function slingGeometry(near) {
  return finishGeometry(slingWire(WIRE_LENGTH,near),F.metal);
}

function mesh(name, geom, material, cast = true) {
  const m = new THREE.Mesh(geom, material);
  m.name = name; m.castShadow = cast; m.receiveShadow = true;
  return m;
}

// Матрицы движутся у экземпляра крана. Стальные детали остаются одинаковыми во всех городах.
// После последнего выхода освобождаем буферы GPU; авторские сетки остаются готовы к повторному входу.
const equipmentShapes=new Map(), users=new WeakMap();
function equipmentLevels(name, factory, distance) {
  const lod=new THREE.LOD();
  lod.name=name+'Levels';
  for (const near of [true,false]) {
    const id=near?name:name+'Far';
    let shape=equipmentShapes.get(id);
    if (!shape) { shape=factory(near); equipmentShapes.set(id,shape); }
    users.set(shape,(users.get(shape)??0)+1);
    let part;
    if (name==='slings') {
      part=new THREE.InstancedMesh(shape,mat('toy'),slingEnds.length);
      part.name=id; part.castShadow=true; part.receiveShadow=true;
    } else {
      const material=name==='hookBlock' ? customMat('crane:forging',()=>{
        const m=standard({color:'#ffffff',vertexColors:true,roughness:.83,rim:false});
        m.defines.PROP_FORGING=1; m.onBeforeCompile=propFinishPatch;
        return m;
      }) : mat('toy');
      part=mesh(id,shape,material);
    }
    part.visible=near;
    lod.addLevel(part,near?0:distance,near?0:0.10);
  }
  return lod;
}

export function createCrane({ mastX = -5.5, mastZ = -6.5 } = {}) {
  const group = new THREE.Group();
  group.name = 'crane';
  const beaconMat = customMat('crane:beacon', () => standard({ color: '#ffe2d6', emissive: '#ff3a2a', emissiveIntensity: ON, rim: false }));

  const mast = new THREE.InstancedMesh(mastSegment(), mat('trim'), MAX_SEG);
  mast.name = 'mast';
  mast.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mast.position.set(mastX, 0, mastZ);
  mast.boundingSphere = new THREE.Sphere(); // охватывает текущее число пролётов вместе с фасками угловых стоек
  mast.castShadow = true; mast.receiveShadow = true;
  mast.count = 0;

  const top = new THREE.Group();
  top.name = 'craneTop';
  const trolley = mesh('trolley', trolleyGeometry(), mat('trim'));
  const beacons = beaconLights(beaconMat);
  const cabPane = customMat('crane:cabPane', () => standard({
    color:'#8dafa8',roughness:0.23,metalness:0.04,transparent:true,opacity:0.28,depthWrite:false,rim:false,
  }));
  top.add(equipmentLevels('jib',topGeometry,15),mesh('cabGlass',cabGlass(),cabPane,false),beacons,trolley);

  const hook = new THREE.Group();
  hook.name = 'hook';
  const slings = equipmentLevels('slings',slingGeometry,7.5);
  // Две ветви одного запасованного каната касаются ручья нижнего шкива.
  const cableBase=1.515;
  const cableGeom = G.mergeColored([-0.148,0.148].map(x=>finishGeometry(G.colored(
    new THREE.CylinderGeometry(0.013,0.013,1,14,1,true).translate(x,0.5,0),STEEL),F.metal)));
  const cable = mesh('cable', cableGeom, mat('toy'));
  cable.position.y = cableBase;
  const block=equipmentLevels('hookBlock',hookGeometry,12);
  for (const {object} of block.levels) {
    const g=object.geometry;
    // Одна сетка для прохода цвета и тени. Несколько кранов могут пользоваться общей геометрией.
    object.onBeforeRender=object.onBeforeShadow=()=>g.setDrawRange(0,slings.visible?Infinity:g.userData.bareCount);
    object.onAfterRender=object.onAfterShadow=()=>g.setDrawRange(0,Infinity);
  }
  hook.add(block,slings,cable);

  group.add(mast, top, hook);

  let jibY = 0, jibTarget = 0, started = false, mastTop = NaN, cableLen = 1, time = 0, on = true;
  const _up = new THREE.Vector3(), _m = new THREE.Matrix4();
  let sectionCount = 0;
  const mastClip = new THREE.Matrix4(), mastFrustum = new THREE.Frustum();
  function selectMastSections(camera) {
    mastClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mast.matrixWorld);
    mastFrustum.setFromProjectionMatrix(mastClip, camera.coordinateSystem, camera.reversedDepth);
    let first = 0, last = sectionCount-1;
    for (let i = 0; i < 6; i++) {
      const plane = mastFrustum.planes[i];
      const n = plane.normal, step = n.y * SEG;
      const support = (Math.abs(n.x)+Math.abs(n.z))*(MAST_A+0.046) + Math.abs(step)*0.5;
      const top = plane.constant + n.y*(mastTop - SEG/2) + support + 1e-6;
      if (step > 1e-9) last = Math.min(last, Math.floor(top / step));
      else if (step < -1e-9) first = Math.max(first, Math.ceil(top / step));
      else if (top < 0) { mast.count = 0; return; }
    }
    // Экземпляры записаны от оголовка вниз. Нижний невидимый хвост не входит в draw.
    mast.count = last < first ? 0 : last+1;
  }
  mast.onBeforeRender = (_renderer, _scene, camera) => selectMastSections(camera);
  mast.onBeforeShadow = (_renderer, _object, _camera, shadowCamera) => selectMastSections(shadowCamera);
  mast.onAfterRender = mast.onAfterShadow = () => { mast.count = sectionCount; };

  function updateMast() {
    const topY = jibY - TURN_H;
    if (Math.abs(topY - mastTop) < 1e-6) return;
    mastTop = topY;
    const n = Math.min(MAX_SEG, Math.max(1, Math.ceil(topY / SEG)));
    for (let i = 0; i < n; i++) mast.setMatrixAt(i, _m.makeTranslation(0, topY - (i + 1) * SEG, 0));
    mast.count = sectionCount = n;
    const halfHeight=n*SEG/2;
    mast.boundingSphere.center.set(0,topY-halfHeight,0);
    mast.boundingSphere.radius=Math.hypot(halfHeight+0.01,MAST_A+0.05,MAST_A+0.05);
    mast.instanceMatrix.needsUpdate = true;
  }

  function layout() {
    _up.set(0, 1, 0).applyEuler(hook.rotation);
    const minJib = hook.position.y + HOOK_TOP + CABLE_MIN + TROLLEY_DROP;
    if (jibY < minJib) jibY = minJib;
    const pivotY = jibY - TROLLEY_DROP;
    const L = (pivotY - hook.position.y) / Math.max(0.2, _up.y);
    const dx = hook.position.x + _up.x * L - mastX, dz = hook.position.z + _up.z * L - mastZ;
    top.position.set(mastX, jibY, mastZ);
    top.rotation.y = Math.atan2(-dz, dx);
    trolley.position.x = Math.min(JIB - 0.4, Math.max(1.2, Math.hypot(dx, dz)));
    cableLen = Math.max(0.05, L - HOOK_TOP);
    cable.scale.y = cableLen + HOOK_TOP-cableBase;
    updateMast();
  }

  /** Точка подвеса (центр верха груза) и наклон троса (рад, порядок XYZ). */
  function setHook(x, y, z, angleX = 0, angleZ = 0) {
    // три проверки, а не [x, y, z].every: setHook зовётся каждый кадр
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;
    hook.position.set(x, y, z);
    hook.rotation.set(Number.isFinite(angleX) ? angleX : 0, 0, Number.isFinite(angleZ) ? angleZ : 0);
    jibTarget = y + HOOK_TOP + CABLE_REST + TROLLEY_DROP;
    if (!started) { jibY = jibTarget; started = true; }
    layout();
  }

  const legDir=new THREE.Vector3(), legMid=new THREE.Vector3(), legScale=new THREE.Vector3(1,1,1);
  const legRotation=new THREE.Quaternion(), legMatrix=new THREE.Matrix4(), legUp=new THREE.Vector3(0,1,0);
  let loadWidth=NaN,loadDepth=NaN;
  /** Размер груза определяет только нижние точки четырёх канатов. Звено, коуши и диаметр каната неизменны. */
  function setLoad(w, d) {
    slings.visible=w!=null;
    if (!slings.visible || (w===loadWidth && d===loadDepth)) return;
    loadWidth=w; loadDepth=d;
    const ax=(W0/2-.3)*Math.max(.05,w/W0), az=(D0/2-.3)*Math.max(.05,d/D0);
    for (let i=0;i<slingEnds.length;i++) {
      const {root,x,z}=slingEnds[i];
      legDir.set(x*ax,.02,z*az).sub(root);
      legMid.copy(root).addScaledVector(legDir,.5);
      legScale.y=legDir.length()/WIRE_LENGTH;
      legRotation.setFromUnitVectors(legUp,legDir.normalize());
      legMatrix.compose(legMid,legRotation,legScale);
      for (let j=0;j<slings.levels.length;j++) slings.levels[j].object.setMatrixAt(i,legMatrix);
    }
    for (let j=0;j<slings.levels.length;j++) {
      const m=slings.levels[j].object;
      m.instanceMatrix.needsUpdate=true;
      m.computeBoundingSphere();
    }
  }

  function update(dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    jibY += (jibTarget - jibY) * (1 - Math.exp(-CLIMB * dt));
    time = (time + dt) % BLINK;
    on = time < BLINK_ON;
    beaconMat.emissiveIntensity = on ? ON : OFF;
    layout();
  }

  let disposed=false;
  function dispose() {
    if (disposed) return;
    disposed=true;
    group.traverse(o=>{
      if (!o.isMesh) return;
      const g=o.geometry, count=users.get(g);
      if (count!==undefined) users.set(g,count-1);
      if (count===undefined || count===1) g.dispose();
    });
    for (const {object} of slings.levels) object.dispose();
    mast.dispose();
    beacons.dispose();
  }

  /** Мгновенно поставить кран на нужную высоту (смена сцены, рестарт). */
  function snap() { jibY = jibTarget; layout(); }

  setLoad(W0,D0);
  setHook(0, 6, 0);
  started = false; // первый внешний setHook ставит кран сразу, без подъёма
  return {
    group, hook, top, setHook, setLoad, update, snap, dispose,
    jibHeight: () => jibY,
    mastSegments: () => sectionCount,
    cableLength: () => cableLen,
    beaconOn: () => on,
  };
}
