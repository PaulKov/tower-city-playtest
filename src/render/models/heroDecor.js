// Украшения у дома героя (спецификация «Герои городов» §6.3, §7.3): 18 процедурных видов из простых тел с вершинными
// цветами; карта сливает их в cityDecor (материал mat('toy')). Начало координат — середина следа на опоре, лицо — +z.
// Наземные помещаются в коробку x ±0,42, z ±0,24, высота ≤ 1,25; крышные — в круг радиуса 0,35, высота ≤ 1,1
// (DECOR_BOX в scenes/cityLogic.js). Каждый вызов строит новую геометрию: карта сливает её и освобождает.
// Порядок DECOR_KINDS — GROUND_DECOR, затем ROOF_DECOR ядра (тест heroDecor.test.js); модуль ядро не импортирует.
import * as THREE from 'three';
import * as G from '../geomUtils.js';
import { PALETTE } from '../materials.js';
import { PROP_FINISH as F, finishU, finishGeometry } from '../propFinishes.js';
import { streetPlank } from './streetFurniture.js';
import { pumpkinGeometry } from './seasonalProps.js';

export const DECOR_KINDS = Object.freeze(['mailbox', 'bench', 'flowerbed', 'lantern', 'pottedTree', 'parasol', 'birdhouse',
  'crates', 'barrel', 'snowman', 'pumpkins', 'lifebuoy', 'easel', 'skis', 'flag', 'vane', 'neon', 'telescope']);

const DARK = '#2e3440', SOIL = '#6b4a32', ORANGE = '#ff8a3d', BOARD = '#2a2f3a';

/** Опора крышного украшения: низкая шайба; на доме она уходит в конёк (roofSpot). */
const foot = () => G.place(G.cylinder(0.08, 0.1, 0.04, 16, PALETTE.steelDark), { y: 0.02 });

function clothFlag(c,near) {
  const g = new THREE.PlaneGeometry(0.30, 0.19, near?32:12, near?10:3);
  const a = g.getAttribute('position');
  for (let i = 0; i < a.count; i++) {
    const t = (a.getX(i)+0.15)/0.30, across = a.getY(i)/0.19;
    a.setXYZ(i,0.016+0.30*t-0.012*t*Math.sin(t*5.2)**2,0.90+across*0.19-0.028*t*t,
      t*(0.048*Math.sin(t*8.3+across*1.35)+0.013*Math.sin(t*4.1-0.7*across)));
  }
  g.computeVertexNormals();
  const back = g.clone(), idx = back.index.array;
  for (let i=0; i<idx.length; i+=3) [idx[i],idx[i+2]]=[idx[i+2],idx[i]];
  back.computeVertexNormals();
  return G.colored(G.mergeColored([g,back]),c);
}

function flower(c,x,y,z) {
  const pos=[], idx=[];
  for(let i=0;i<5;i++){
    const a=i*2*Math.PI/5, dx=Math.cos(a), dz=Math.sin(a), j=pos.length/3;
    const point=(r,w,h)=>[x+r*dx-w*dz,y+h,z+r*dz+w*dx];
    pos.push(...point(0.003,0,0),...point(0.031,-0.016,0.010),...point(0.052,0,0.021),
      ...point(0.031,0.016,0.010),...point(0.028,0,0.004));
    idx.push(j,j+3,j+4,j+3,j+2,j+4,j+2,j+1,j+4,j+1,j,j+4);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx); g.computeVertexNormals(); G.boxUv(g,12);
  return G.colored(g,c);
}

function finished(g) { g.userData.finished=true; return g; }

function sapling(c) {
  const pieces = [];
  const pot = new THREE.LatheGeometry([[0.13,0],[0.15,0.012],[0.155,0.04],[0.195,0.263],
    [0.209,0.27],[0.216,0.28],[0.216,0.307],[0.210,0.315],[0.19,0.315],[0.182,0.28]]
    .map(([r,y])=>new THREE.Vector2(r,y)),40);
  pieces.push(G.colored(pot,c),G.place(G.cylinder(0.185,0.185,0.013,32,SOIL),{y:0.28}));
  pieces.push(G.place(G.cylinder(0.029,0.043,0.49,20,PALETTE.trunk),{y:0.521,rz:0.035}));
  // Листья парами отходят от побегов. Центральная складка даёт объём даже в тени.
  for(let i=0;i<14;i++) {
    const a=i*2.39996, h=0.58+i*0.023, reach=0.084+0.12*Math.sin((i+1)*Math.PI/17);
    const x=Math.cos(a)*reach, z=Math.sin(a)*reach*0.80;
    const path=new THREE.CatmullRomCurve3([[0,h,0],[x*0.45,h+0.04,z*0.45],[x,h+0.11,z]].map(p=>new THREE.Vector3(...p)));
    pieces.push(G.colored(new THREE.TubeGeometry(path,9,0.006,6,false),PALETTE.trunk));
    for(let j=0;j<7;j++) {
      const t=0.34+0.10*j, base=path.getPointAt(t), angle=a+(j%2?1:-1)*0.78;
      const leaf=new THREE.PlaneGeometry(1,1,2,5), pos=leaf.attributes.position;
      for (let k=0;k<pos.count;k++) {
        const along=pos.getY(k)+0.5, width=pos.getX(k)*0.054*Math.sin(Math.PI*along);
        pos.setXYZ(k,width,0.094*along,0.015*Math.sin(Math.PI*along)*(1-Math.abs(pos.getX(k)))+0.022*along*along);
      }
      leaf.computeVertexNormals();
      const material=j%3===0 ? PALETTE.grassDark : PALETTE.leaf;
      pieces.push(G.place(G.colored(leaf,material),{x:base.x,y:base.y,z:base.z,ry:Math.PI/2-angle,rx:0.93}));
    }
  }
  return pieces;
}

function parasolCloth(c) {
  const cap=new THREE.SphereGeometry(1,72,12,0,2*Math.PI,0,Math.PI/2);
  const p=cap.attributes.position;
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i), z=p.getZ(i), rho=Math.hypot(x,z), rib=(1+Math.cos(10*Math.atan2(z,x)))*0.5;
    p.setXYZ(i,0.40*x,1.111-0.22*rho**1.6-0.016*(1-rib)*rho**5,0.231*z);
  }
  cap.computeVertexNormals();
  return G.colored(cap,c);
}

function crateBoards(size,x,y,z,angle,binding,near) {
  const p=[], base=(g,at)=>G.place(G.place(g,at),{x,y,z,ry:angle}), h=size*0.88;
  const floor=G.box(size-0.018,0.022,size-0.018,PALETTE.woodDark);
  floor.setIndex(Array.from(floor.index.array.slice(12,24)));
  p.push(base(floor,{y:0.011}));
  for(let face=0;face<4;face++){
    const a=face*Math.PI/2, r=(size-0.012)/2;
    for(let row=0;row<3;row++){
      // Бруски в углах закрывают торцы. У каждой планки видны лицо, оборот и верхняя кромка.
      const color=row===1 ? binding : PALETTE.wood;
      const plank=near ? finished(streetPlank(size-0.012,h*0.27,0.012,color,face*3+row,true))
        : G.box(size-0.012,h*0.27,0.012,color);
      if (!near) {
        const ix=plank.index.array;
        plank.setIndex([...ix.slice(12,18),...ix.slice(24,36)]);
      }
      p.push(base(plank,{x:r*Math.sin(a),y:h*(0.18+row*0.33),z:r*Math.cos(a),ry:a}));
      if (near) for (const side of [-1,1]) {
        const end=side*(size/2-0.029);
        const nail=G.colored(new THREE.CircleGeometry(0.0037,8),'#51483c');
        p.push(base(nail,{x:(r+0.0063)*Math.sin(a)+end*Math.cos(a),y:h*(0.18+row*0.33),
          z:(r+0.0063)*Math.cos(a)-end*Math.sin(a),ry:a}));
      }
    }
    const post=G.box(0.022,h,0.022,PALETTE.woodDark), half=size/2-0.022;
    const ends=post.index.array;
    post.setIndex([...ends.slice(0,18),...ends.slice(24)]);
    p.push(base(post,{x:(face<2 ? 1 : -1)*half,y:h/2,z:(face%3 ? -1 : 1)*half}));
  }
  return p;
}

function benchFrame(x, points, steps, thickness, near) {
  const curve = new THREE.CatmullRomCurve3(points.map(([z,y])=>new THREE.Vector3(x,y,z)));
  return G.colored(new THREE.TubeGeometry(curve,near?steps*3:steps,thickness,near?12:5,false),PALETTE.steelDark);
}

function orchardFruit(x,y,z,i) {
  const g=G.sphere(0.048,20,14,['#bf4835','#c99a46','#bf5d39','#a5563a'][i%4]);
  const {position, color}=g.attributes;
  for(let v=0;v<position.count;v++) {
    const px=position.getX(v), py=position.getY(v)/0.048, pz=position.getZ(v);
    const lobe=1+0.045*Math.cos(5*Math.atan2(pz,px)+i)*py*py+0.06*py;
    const h=0.045*py-0.012*Math.max(0,py)**10+0.006*Math.max(0,-py)**9;
    position.setXYZ(v,px*lobe,h,pz*lobe);
    const blush=0.88+0.12*Math.sin(i+px*43+pz*36);
    color.setXYZ(v,color.getX(v)*blush,color.getY(v)*blush,color.getZ(v)*blush);
  }
  g.computeVertexNormals();
  return [g.translate(x,y,z),G.place(G.cylinder(0.002,0.003,0.023,7,PALETTE.woodDark),{x:x+0.002,y:y+0.043,z,rz:-0.21})];
}

function cooperedBarrel(accent,near) {
  // Каждая клёпка расширяется к середине. Поверхность за узким стыком остаётся тёмной.
  const radiusAt=h=>0.154+0.042*Math.sin(Math.PI*h/0.54)**0.86;
  const profile = near ? Array.from({length:13},(_,i)=>[radiusAt(i*0.045),i*0.045])
    : [[0.154,0],[0.172,0.070],[0.190,0.165],[0.196,0.273],[0.182,0.429],[0.154,0.54]];
  const staves = 12, cuts = near ? [0,0.017,0.16,0.33,0.5,0.67,0.84,0.983,1] : [0,0.5,1];
  const stride=cuts.length, pos=[], nor=[], tex=[], rgb=[], ix=[];
  const wood = new THREE.Color(PALETTE.wood);
  for (let i=0; i<staves; i++) {
    const tone = 0.8+0.24*(0.5+0.5*Math.cos(i*2.39)), start=pos.length/3;
    const slice = (i*0.37)%0.57;
    for (let row=0; row<profile.length; row++) {
      const [radius,h] = profile[row], lo=profile[Math.max(0,row-1)], hi=profile[Math.min(row+1,profile.length-1)];
      const slope=(lo[0]-hi[0])/(hi[1]-lo[1]), unit=1/Math.hypot(1,slope);
      for (let k=0; k<stride; k++) {
        const t=cuts[k], edge=near && (k===0 || k===stride-1);
        const a=(i+t)*Math.PI*2/staves, sin=Math.sin(a), cos=Math.cos(a);
        const r=radius-(edge?0.0011:0);
        pos.push(r*sin,h,r*cos);
        nor.push(sin*unit,slope*unit,cos*unit);
        tex.push(finishU(F.wood,h/0.54),slice+0.37*t);
        const surface=tone*(edge?0.45:1);
        rgb.push(wood.r*surface,wood.g*surface,wood.b*surface);
        if (row && k) {
          const j=start+row*stride+k;
          ix.push(j-stride-1,j-stride,j,j-stride-1,j,j-1);
        }
      }
    }
  }
  const shell = new THREE.BufferGeometry();
  for(const [name,data,size] of [['position',pos,3],['normal',nor,3],['uv',tex,2],['color',rgb,3]]) {
    shell.setAttribute(name,new THREE.Float32BufferAttribute(data,size));
  }
  shell.setIndex(ix);
  shell.userData.finished=true;
  const radial=near?72:24;
  const head = G.colored(new THREE.CircleGeometry(0.154,radial).rotateX(-Math.PI/2).translate(0,0.534,0),PALETTE.wood);
  const parts = [shell,head];
  for (const [y,top,bottom,h,color] of [[0.06,0.175,0.169,0.026,PALETTE.steelDark],
    [0.270,0.198,0.198,0.025,accent],[0.483,0.167,0.175,0.027,PALETTE.steelDark]]) {
    const rt=near?radiusAt(y+h/2)+0.002:top, rb=near?radiusAt(y-h/2)+0.002:bottom;
    parts.push(G.place(G.colored(new THREE.CylinderGeometry(rt,rb,h,radial,1,true),color),{y}));
    if (near) {
      for (const [r,edge] of [[rt,h/2],[rb,-h/2]]) {
        const roll=new THREE.TorusGeometry(r,0.0013,5,radial).rotateX(Math.PI/2).translate(0,y+edge,0);
        parts.push(G.colored(roll,color));
      }
      const lap = (rt+rb)/2+0.001;
      parts.push(G.place(G.box(0.030,h*0.82,0.0035,color),{y,z:lap}));
      for (const x of [-0.008,0.008]) parts.push(G.place(G.sphere(0.0034,9,5,PALETTE.steel),{x,y,z:lap+0.002,sz:0.57}));
    }
  }
  if (near) {
    const rim = G.colored(new THREE.RingGeometry(0.147,0.154,radial).rotateX(-Math.PI/2).translate(0,0.54,0),PALETTE.wood);
    parts.push(finished(finishGeometry(rim,F.endgrain)));
    const lip=new THREE.CylinderGeometry(0.147,0.147,0.006,radial,1,true).scale(-1,1,1).translate(0,0.537,0);
    parts.push(G.colored(lip,PALETTE.woodDark));
  }
  // Дно бочки утоплено в утор. Отдельные линии стыков заканчиваются у внутренней стенки.
  for (const z of [-0.075,-0.003,0.073]) {
    const chord=2*Math.sqrt(0.15**2-z*z);
    parts.push(G.colored(new THREE.PlaneGeometry(chord,0.0023).rotateX(-Math.PI/2).translate(0,0.5342,z),PALETTE.woodDark));
  }
  parts.push(G.colored(new THREE.CircleGeometry(0.021,10).rotateX(-Math.PI/2).translate(0.066,0.5344,0.038),PALETTE.woodDark));
  return parts;
}

// Номинальный размер сохраняется на обеих сетках. Видимая обработанная кромка занимает не более 7 мм.
function edgeBox(near,w,h,d,color) {
  const edge=Math.min(w,h,d);
  return near && edge>=0.022 ? G.roundedBox(w,h,d,Math.min(0.007,edge*0.16),1,color) : G.box(w,h,d,color);
}

const BUILDERS = {
  mailbox: (c,near) => [
    G.place(edgeBox(near,0.2, 0.04, 0.2, PALETTE.steelDark), { y: 0.02 }),
    G.place(edgeBox(near,0.07, 0.6, 0.07, PALETTE.woodDark), { y: 0.34 }),
    G.place(edgeBox(near,0.34, 0.2, 0.24, c), { y: 0.74 }),
    G.place(G.cylinder(0.12, 0.12, 0.34,near?48:24, c), { y: 0.84, rz: Math.PI / 2 }),
    G.place(edgeBox(near,0.21, 0.012, 0.032, PALETTE.steel), { y: 0.826, z: 0.134, rx: 0.14 }),
    G.place(G.cylinder(0.012, 0.012, 0.12,near?16:8, PALETTE.steelDark), { y: 0.65, z: 0.117, rz: Math.PI/2 }),
    G.place(edgeBox(near,0.18, 0.03, 0.012, DARK), { y: 0.8, z: 0.126 }),              // щель
    G.place(edgeBox(near,0.02, 0.18, 0.03, PALETTE.craneRed), { x: 0.18, y: 0.86 }),     // флажок
    G.place(edgeBox(near,0.02, 0.06, 0.1, PALETTE.craneRed), { x: 0.18, y: 0.92, z: 0.05 }),
  ],
  bench: (c,near) => {
    const plank=(h,d,color,seed)=>near ? finished(streetPlank(0.8,h,d,color,seed)) : G.box(0.8,h,d,color);
    return [
    ...[-1,0,1].map((i) => G.place(plank(0.045,0.09,PALETTE.wood,4+i), { y: 0.422, z: i*0.104 })),
    G.place(plank(0.1,0.04,c,11), { y: 0.56, z: -0.13, rx: -0.12 }),
    G.place(plank(0.1,0.04,c,9), { y: 0.7, z: -0.145, rx: -0.12 }),
    ...[-1, 1].flatMap((s) => [
      benchFrame(s*0.325,[[0.146,0.012],[0.12,0.11],[0.096,0.36],[0.053,0.399],[-0.103,0.399],[-0.13,0.35],[-0.137,0.11],[-0.159,0.012]],9,0.017,near),
      benchFrame(s*0.325,[[-0.13,0.35],[-0.12,0.43],[-0.14,0.57],[-0.166,0.74]],4,0.014,near),
      benchFrame(s*0.325,[[0.088,0.395],[0.104,0.533],[0.083,0.557],[-0.034,0.564],[-0.135,0.581]],5,0.011,near),
      ...[0.56,0.70].map((y)=>G.colored(new THREE.CircleGeometry(0.008,6).translate(s*0.325,y,y<0.6?-0.109:-0.124),PALETTE.steelDark)),
      ...(near ? [0.146,-0.159].map(z=>G.place(G.cylinder(0.026,0.030,0.010,16,PALETTE.steelDark),{x:s*0.325,y:0.005,z,sz:1.25})) : []),
      ...(near ? [-1,0,1].map(i=>G.colored(new THREE.CircleGeometry(0.005,10).rotateX(-Math.PI/2).translate(s*0.325,0.4448,i*0.104),PALETTE.steelDark)) : []),
    ]),
    ];
  },
  flowerbed: (c,near) => {
    const p = [
      G.place(edgeBox(near,0.8, 0.16, 0.42, PALETTE.woodDark), { y: 0.08 }),
      G.place(edgeBox(near,0.72, 0.02, 0.34, SOIL), { y: 0.165 }),
    ];
    const blooms = [c, PALETTE.white, PALETTE.gold];
    for (let i = 0; i < 6; i++) {
      const x = -0.28 + i * 0.112, z = i % 2 ? -0.07 : 0.07, h = 0.12 + (i % 3) * 0.03;
      p.push(G.place(edgeBox(near,0.015, h, 0.015, PALETTE.leafPine), { x, y: 0.17 + h / 2, z }));
      p.push(flower(blooms[i%3],x,0.17+h,z));
      p.push(G.place(G.sphere(0.014,6,3,PALETTE.gold),{x,y:0.179+h,z}));
    }
    for (const x of [-0.2, 0.05, 0.27]) p.push(G.place(G.sphere(0.09,near?16:6,near?10:3, PALETTE.leaf), { x, y: 0.19, sy: 0.6 }));
    return p;
  },
  lantern: (c,near) => [
    G.place(edgeBox(near,0.18, 0.06, 0.18, PALETTE.steelDark), { y: 0.03 }),
    G.place(G.cylinder(0.03, 0.04, 0.78,near?16:8, PALETTE.steelDark), { y: 0.45 }),
    G.place(edgeBox(near,0.22, 0.03, 0.22, c), { y: 0.855 }),
    G.place(edgeBox(near,0.16, 0.2, 0.16, PALETTE.glassLit), { y: 0.97 }),               // плафон (без свечения, §7.3)
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => G.place(edgeBox(near,0.025, 0.2, 0.025, PALETTE.steelDark), { x: sx * 0.085, y: 0.97, z: sz * 0.085 })),
    G.place(G.cone(0.17, 0.12, 4, c), { y: 1.13, ry: Math.PI / 4 }),
    G.place(G.sphere(0.03,near?24:12,near?12:6, c), { y: 1.21 }),
  ],
  pottedTree: (c,near) => near ? sapling(c) : [
    G.place(G.cylinder(0.2, 0.15, 0.3, 10, c), { y: 0.15 }),
    G.place(G.cylinder(0.22, 0.22, 0.05, 10, PALETTE.white), { y: 0.3 }),
    G.place(G.cylinder(0.03, 0.05, 0.42, 6, PALETTE.trunk), { y: 0.52 }),
    G.place(G.sphere(0.22, 10, 7, PALETTE.leaf), { y: 0.86 }),
    G.place(G.sphere(0.14, 8, 5, PALETTE.grassDark), { x: 0.15, y: 0.76, z: 0.05 }),
  ],
  parasol: (c,near) => [
    G.place(G.cylinder(0.13, 0.15, 0.06,near?20:10, PALETTE.steelDark), { y: 0.03 }),
    G.place(G.cylinder(0.018, 0.018, 1.0,near?16:6, PALETTE.white), { y: 0.56 }),
    G.place(G.cylinder(0.2, 0.2, 0.03,near?20:10, PALETTE.white), { y: 0.55 }),          // столик
    near ? parasolCloth(c) : G.place(G.cone(0.4, 0.22, 12, c), { y: 1.0, sz: 0.58 }),                      // овальный купол
    G.place(G.sphere(0.03,near?16:6,near?10:3, PALETTE.white), { y: 1.13 }),
  ],
  birdhouse: (c,near) => [
    G.place(edgeBox(near,0.16, 0.04, 0.16, PALETTE.steelDark), { y: 0.02 }),
    G.place(edgeBox(near,0.06, 0.78, 0.06, PALETTE.woodDark), { y: 0.43 }),
    G.place(edgeBox(near,0.18, 0.03, 0.18, PALETTE.wood), { y: 0.815 }),
    G.place(edgeBox(near,0.22, 0.24, 0.2, c), { y: 0.95 }),
    ...[-1, 1].map((s) => G.place(edgeBox(near,0.17, 0.025, 0.26, PALETTE.roofRed), { x: s * 0.068, y: 1.11, rz: -s * 0.6 })),
    G.place(edgeBox(near,0.034, 0.026, 0.267, PALETTE.woodDark), { y: 1.157 }),
    G.place(G.cylinder(0.045, 0.045, 0.012,near?48:24, DARK), { y: 0.97, z: 0.101, rx: Math.PI / 2 }),
    G.place(G.cylinder(0.008, 0.008, 0.07,near?16:4, PALETTE.woodDark), { y: 0.9, z: 0.135, rx: Math.PI / 2 }), // жёрдочка
  ],
  crates: (c,near) => {
    return [
      ...crateBoards(0.34, -0.2, 0, 0.02, 0.05, PALETTE.woodDark,near),
      ...crateBoards(0.32, 0.2, 0, -0.03, -0.08, PALETTE.woodDark,near),
      ...crateBoards(0.3, 0.02, 0.299, 0, 0.3, c,near),
      G.place(G.box(0.238,0.08,0.238,'#765535'),{x:0.02,y:0.475,ry:0.3}),
      ...(near ? [[-0.045,0.025],[0.050,-0.028],[0.064,0.074],[-0.038,-0.066],[0.119,-0.022]]
        .flatMap(([x,z],i)=>orchardFruit(x,0.54+0.004*Math.cos(i),z,i)) :
        [[-0.036,0.023],[0.072,-0.028],[0.052,0.071]].map(([x,z])=>G.place(G.sphere(0.048,6,3,PALETTE.craneRed),{x,y:0.545,z}))),
    ];
  },
  barrel: cooperedBarrel,
  snowman: (c,near) => [
    G.place(G.sphere(0.22,near?20:10,near?12:6, PALETTE.snow), { y: 0.22 }),
    G.place(G.sphere(0.16,near?16:8,near?12:6, PALETTE.snow), { y: 0.55 }),
    G.place(G.sphere(0.11,near?16:8,near?10:5, PALETTE.snow), { y: 0.8 }),
    G.place(G.cylinder(0.095, 0.115, 0.07,near?20:10, c), { y: 0.7 }),                     // шарф
    G.place(edgeBox(near,0.05, 0.16, 0.02, c), { x: 0.07, y: 0.6, z: 0.15, rz: 0.15 }),
    G.place(G.cylinder(0.12, 0.12, 0.02,near?16:8, DARK), { y: 0.9 }),                     // шляпа
    G.place(G.cylinder(0.075, 0.08, 0.12,near?16:8, DARK), { y: 0.97 }),
    G.place(G.cone(0.022, 0.1, 6, ORANGE), { y: 0.8, z: 0.15, rx: Math.PI / 2 }),   // нос
    ...[-1, 1].map((s) => G.place(G.sphere(0.016,near?16:4,near?10:2, DARK), { x: s * 0.04, y: 0.84, z: 0.098 })),
    ...[0.5, 0.6].map((y) => G.place(G.sphere(0.02,near?16:4,near?10:2, DARK), { y, z: 0.15 })),
    ...[-1, 1].map((s) => G.beam([s * 0.14, 0.58, 0], [s * 0.36, 0.74, 0.02], 0.025, PALETTE.trunk)),
  ],
  pumpkins: (c,near) => near ? [
    G.place(G.roundedBox(0.50,0.18,0.28,0.023,2,PALETTE.sand),{x:0.12,y:0.09,z:-0.09}),
    ...[[-0.22,0.001,0.06,0.41],[0.12,0.001,0.11,0.32],[0.22,0.18,-0.1,0.26]].map(([x,y,z,s],i)=>
      G.place(finished(pumpkinGeometry(i===0)),{x,y,z,s,ry:i*1.4})),
    G.place(G.box(0.10,0.035,0.035,c),{x:-0.22,y:0.212,z:0.063,ry:0.4}),
  ] : [
    G.place(G.box(0.5, 0.18, 0.28, PALETTE.sand), { x: 0.12, y: 0.09, z: -0.09 }),  // тюк сена
    G.place(G.sphere(0.15, 10, 6, ORANGE), { x: -0.22, y: 0.113, z: 0.06, sy: 0.75 }),
    G.place(G.sphere(0.12, 9, 6, PALETTE.leafAutumn), { x: 0.12, y: 0.091, z: 0.11, sy: 0.75 }),
    G.place(G.sphere(0.1, 8, 5, ORANGE), { x: 0.22, y: 0.245, z: -0.1, sy: 0.75 }),
    G.place(G.cylinder(0.014, 0.02, 0.07, 5, PALETTE.leafPine), { x: -0.22, y: 0.25, z: 0.06 }),
    G.place(G.cylinder(0.012, 0.018, 0.06, 5, PALETTE.leafPine), { x: 0.12, y: 0.2, z: 0.11 }),
    G.place(G.cylinder(0.01, 0.016, 0.05, 5, PALETTE.leafPine), { x: 0.22, y: 0.335, z: -0.1 }),
    G.place(G.box(0.1, 0.035, 0.035, c), { x: -0.22, y: 0.235, z: 0.06, ry: 0.4 }), // бантик
  ],
  lifebuoy: (c,near) => {
    const p = [
      G.place(edgeBox(near,0.2, 0.05, 0.2, PALETTE.steelDark), { y: 0.025, z: -0.08 }),
      G.place(edgeBox(near,0.06, 0.95, 0.06, PALETTE.wood), { y: 0.525, z: -0.08 }),
      G.place(edgeBox(near,0.03, 0.03, 0.08, PALETTE.steelDark), { y: 0.87, z: -0.03 }),  // крючок
      G.place(G.colored(new THREE.TorusGeometry(0.17, 0.05, near?14:6, near?64:14), c), { y: 0.7 }), // круг в плоскости XY, лицом +z
    ];
    for (let i = 0; i < 4; i++) {
      p.push(G.place(G.colored(new THREE.TorusGeometry(0.17, 0.053, near?14:6, near?7:2, 0.36), PALETTE.white), { y: 0.7, rz: Math.PI / 4 + i * Math.PI / 2 - 0.18 }));
    }
    return p;
  },
  easel: (c,near) => {
    const canvas = (g, x, y, z) => G.place(G.place(g, { x, y, z }), { y: 0.73, z: 0.06, rx: -0.13 });
    return [
      ...[-1, 1].map((s) => G.beam([s * 0.25, 0.01, 0.13], [s * 0.05, 1.12, -0.02], 0.035, PALETTE.wood)),
      G.beam([0, 0.01, -0.2], [0, 1.0, -0.04], 0.03, PALETTE.wood),
      G.place(edgeBox(near,0.52, 0.035, 0.07, PALETTE.wood), { y: 0.5, z: 0.085, rx: -0.13 }),
      canvas(edgeBox(near,0.48, 0.4, 0.02, PALETTE.white), 0, 0, 0),
      canvas(edgeBox(near,0.4, 0.2, 0.006, c), 0, 0.06, 0.013),                              // картина цвета героя
      canvas(edgeBox(near,0.4, 0.1, 0.008, PALETTE.grass), 0, -0.09, 0.014),
      canvas(G.sphere(0.035,near?16:6,near?10:3, PALETTE.gold), 0.12, 0.1, 0.02),
    ];
  },
  skis: (c,near) => {
    const ski = (x) => [
      G.place(edgeBox(near,0.08, 1.12, 0.02, c), { x, y: 0.556, z: -0.015, rx: -0.206 }),
      G.place(edgeBox(near,0.08, 0.12, 0.02, c), { x, y: 1.159, z: -0.106, rx: 0.4 }),       // загнутый носок
      G.place(edgeBox(near,0.09, 0.05, 0.04, DARK), { x, y: 0.56, z: 0.005, rx: -0.206 }),   // крепление
    ];
    const pole = (x) => [
      G.beam([x, 0.01, 0.1], [x, 1.0, -0.15], 0.02, PALETTE.steel),
      G.place(G.cylinder(0.04, 0.04, 0.01,near?16:6, DARK), { x, y: 0.1, z: 0.075 }),
      G.place(edgeBox(near,0.03, 0.08, 0.03, DARK), { x, y: 0.96, z: -0.14 }),
    ];
    return [
      ...[-1, 1].map((s) => G.place(edgeBox(near,0.05, 0.95, 0.05, PALETTE.woodDark), { x: s * 0.3, y: 0.475, z: -0.17 })),
      G.place(edgeBox(near,0.66, 0.06, 0.06, PALETTE.wood), { y: 0.88, z: -0.17 }),
      ...ski(-0.1), ...ski(0.06), ...pole(0.2), ...pole(0.26),
    ];
  },
  flag: (c,near) => [
    foot(),
    G.place(G.cylinder(0.013, 0.019, 1.0, 12, PALETTE.white), { y: 0.54 }),
    G.place(G.sphere(0.031, 10, 5, PALETTE.gold), { y: 1.055 }),
    G.place(G.cylinder(0.0026,0.0026,0.61,5,PALETTE.woodDark),{x:0.021,y:0.49}),
    ...[0.816,0.980].map(y=>G.place(G.colored(new THREE.CylinderGeometry(0.019,0.019,0.012,10,1,true),PALETTE.gold),{y})),
    G.place(G.box(0.012,0.19,0.005,'#d8ceac'),{x:0.024,y:0.90,z:0.003}),
    clothFlag(c,near),
  ],
  vane: (c,near) => [
    foot(),
    G.place(G.cylinder(0.015, 0.015, 0.82,near?16:6, PALETTE.steelDark), { y: 0.45 }),
    G.place(edgeBox(near,0.34, 0.012, 0.012, PALETTE.steelDark), { y: 0.6 }),
    G.place(edgeBox(near,0.012, 0.012, 0.34, PALETTE.steelDark), { y: 0.6 }),
    ...[[0.17, 0], [-0.17, 0], [0, 0.17], [0, -0.17]].map(([x, z]) => G.place(G.sphere(0.022,near?16:6,near?10:3, PALETTE.gold), { x, y: 0.6, z })),
    G.place(edgeBox(near,0.4, 0.016, 0.016, PALETTE.steelDark), { y: 0.8 }),              // стрелка
    G.place(G.cone(0.045, 0.1, 4, PALETTE.steelDark), { x: 0.25, y: 0.8, rz: -Math.PI / 2 }),
    G.place(edgeBox(near,0.12, 0.1, 0.012, c), { x: -0.2, y: 0.83 }),                      // хвост цвета героя
    G.place(G.sphere(0.035,near?16:6,near?10:4, PALETTE.gold), { y: 0.88 }),
  ],
  neon: (c,near) => [
    foot(),
    G.place(G.cylinder(0.025, 0.025, 0.48,near?16:6, PALETTE.steelDark), { y: 0.28 }),
    G.place(edgeBox(near,0.58, 0.34, 0.05, BOARD), { y: 0.69 }),
    G.place(edgeBox(near,0.62, 0.03, 0.06, c), { y: 0.875 }),                              // рамка цвета героя
    G.place(edgeBox(near,0.62, 0.03, 0.06, c), { y: 0.505 }),
    ...[-1, 1].map((s) => G.place(edgeBox(near,0.03, 0.34, 0.06, c), { x: s * 0.295, y: 0.69 })),
    G.place(G.colored(new THREE.TorusGeometry(0.085, 0.014, 4, 12), PALETTE.neonPink), { x: -0.13, y: 0.69, z: 0.03 }),
    G.place(edgeBox(near,0.03, 0.12, 0.02, PALETTE.neonCyan), { x: 0.1, y: 0.73, z: 0.03, rz: -0.5 }), // молния
    G.place(edgeBox(near,0.1, 0.03, 0.02, PALETTE.neonCyan), { x: 0.13, y: 0.685, z: 0.03 }),
    G.place(edgeBox(near,0.03, 0.12, 0.02, PALETTE.neonCyan), { x: 0.16, y: 0.64, z: 0.03, rz: -0.5 }),
  ],
  telescope: (c,near) => {
    // ось трубы — от вертикали к +z на 0,9 рад, вокруг шарнира на высоте 0,62
    const tilt = (g, y) => G.place(G.place(g, { y }), { y: 0.62, rx: 0.9 });
    return [
      foot(),
      G.place(G.cylinder(0.03, 0.035, 0.54,near?16:8, PALETTE.steelDark), { y: 0.31 }),
      G.place(G.sphere(0.05,near?16:6,near?10:4, PALETTE.steelDark), { y: 0.62 }),
      tilt(G.cylinder(0.065, 0.05, 0.46,near?48:24, c), 0.05),
      tilt(G.cylinder(0.07, 0.07, 0.03,near?36:18, PALETTE.gold), 0.28),
      tilt(G.cylinder(0.055, 0.055, 0.004,near?32:16, PALETTE.glass), 0.297),
      tilt(G.cylinder(0.02, 0.02, 0.1,near?24:12, DARK), -0.22),
    ];
  },
};

/**
 * Геометрия украшения kind (DECOR_KINDS) с цветом героя color: позиция, нормаль, uv и вершинный цвет. Неизвестный
 * вид — пустая геометрия тех же атрибутов. Каждый вызов — новая геометрия.
 */
const MARK = '#010203';
const _mark = new THREE.Color(MARK);
const _surface = new THREE.Color();
const paletteFinish = new Map([
  [PALETTE.wood,F.wood],[PALETTE.woodDark,F.wood],[PALETTE.trunk,F.wood],
  [PALETTE.steel,F.metal],[PALETTE.steelDark,F.metal],[PALETTE.gold,F.metal],
  [PALETTE.leaf,F.foliage],[PALETTE.grassDark,F.foliage],[PALETTE.leafPine,F.foliage],
  [PALETTE.snow,F.mineral],[SOIL,F.mineral],[PALETTE.sand,F.mineral],
  [PALETTE.glass,F.glass],[PALETTE.glassLit,F.glass],
].map(([hex,id]) => [new THREE.Color(hex).getHex(),id]));
const accentFinish = { bench:F.wood, birdhouse:F.wood, flowerbed:F.foliage, flag:F.cloth,
  parasol:F.cloth, snowman:F.cloth, easel:F.cloth, pottedTree:F.mineral, barrel:F.metal };

// Направление волокон следует длинной стороне детали. На срезе стойки или торце планки видны годичные кольца.
function woodUV(g) {
  g.computeBoundingBox();
  const {min,max} = g.boundingBox, extent = [max.x-min.x,max.y-min.y,max.z-min.z];
  const grain = extent.indexOf(Math.max(...extent)), start = min.toArray();
  const a = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const at = (i, axis) => (a.array[i*3+axis]-start[axis])/Math.max(extent[axis],0.001);
  for (let i = 0; i < a.count; i++) {
    const b=(grain+1)%3, c=(grain+2)%3;
    if (Math.abs(n.array[i*3+grain]) > 0.89) uv.setXY(i,finishU(F.endgrain,at(i,b)),at(i,c));
    else uv.setXY(i,finishU(F.wood,at(i,grain)),at(i,Math.abs(n.array[i*3+b]) > Math.abs(n.array[i*3+c]) ? c : b));
  }
}

// Разделяем по исходному назначению до перекраски. Даже если игрок выбрал цвет стали,
// ткань остаётся тканью и хромированные крепления сохраняют собственный материал.
function buildParts(kind, accentColor, near = false) {
  const parts = { base: [], accent: [], all: [] };
  if (typeof kind !== 'string' || !Object.hasOwn(BUILDERS,kind)) return parts;
  for (const g of BUILDERS[kind](MARK,near)) {
    _surface.fromBufferAttribute(g.attributes.color,0);
    const accent = Math.abs(_surface.r-_mark.r)<1e-7 && Math.abs(_surface.g-_mark.g)<1e-7 && Math.abs(_surface.b-_mark.b)<1e-7;
    const finish = accent ? accentFinish[kind] ?? F.paint : paletteFinish.get(_surface.getHex()) ?? F.paint;
    if (!g.userData.finished) {
      if (finish === F.wood) woodUV(g); else finishGeometry(g,finish);
    }
    if (accent) G.colored(g,accentColor);
    (accent ? parts.accent : parts.base).push(g);
    parts.all.push(g);
  }
  return parts;
}

export function heroDecorGeometry(kind, color = '#ff6b6b') {
  return G.mergeColored(buildParts(kind,color).all);
}

export function heroDecorNearGeometry(kind, color = '#ff6b6b') {
  return G.mergeColored(buildParts(kind,color,true).all);
}

/**
 * Украшение kind двумя геометриями тех же атрибутов: base - всё, что не цвета героя; accent - тела цвета героя,
 * построенные белым (его перекрашивает цвет экземпляра). Неизвестный вид - две пустые. Каждый вызов - новые геометрии.
 */
function colorParts(kind, near) {
  const { base, accent } = buildParts(kind,'#ffffff',near);
  const out = { base: G.mergeColored(base), accent: G.mergeColored(accent) };
  for (const g of base) g.dispose();
  for (const g of accent) g.dispose();
  return out;
}

export function decorParts(kind) { return colorParts(kind,false); }
export function decorPartsNear(kind) { return colorParts(kind,true); }
