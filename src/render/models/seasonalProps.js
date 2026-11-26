// Сезонный реквизит на карте и стройке. Ближняя и дальняя сетки занимают один батч.
import * as THREE from 'three';
import * as G from '../geomUtils.js';
import { finishGeometry, PROP_FINISH as F } from '../propFinishes.js';

const TAU = Math.PI*2;
const finish = (g, surface) => finishGeometry(g,surface);
const vector = a => new THREE.Vector3(...a);

// У сферы шов и полюса имеют по несколько вершин с одной позицией. После изменения
// формы нормали по обе стороны шва снова совпадают; узкая полоска не ловит боковой свет.
function sphereNormals(g, sides, rows) {
  g.computeVertexNormals();
  const n = g.attributes.normal, v = new THREE.Vector3();
  for (let j=0; j<=rows; j++) {
    const i = j*(sides+1), b = i+sides;
    if (!j || j===rows) {
      for (let k=i; k<=b; k++) n.setXYZ(k,0,j===0 ? 1 : -1,0);
    } else {
      v.set(n.getX(i)+n.getX(b),n.getY(i)+n.getY(b),n.getZ(i)+n.getZ(b)).normalize();
      n.setXYZ(i,v.x,v.y,v.z); n.setXYZ(b,v.x,v.y,v.z);
    }
  }
}

function stem(close) {
  const count = close ? 28 : 8, points = [], colors = [], uv = [], index = [];
  const rings = [[0.374,0.072,0,0],[0.405,0.053,0,0],[0.466,0.041,0.012,-0.002],
    [0.527,0.033,0.034,-0.011],[0.576,0.031,0.040,-0.025],[0.593,0.027,0.038,-0.030]];
  const cork = new THREE.Color('#95845a'), groove = new THREE.Color('#59603b'), c=new THREE.Color();
  for(let j=0;j<rings.length;j++) for(let i=0;i<=count;i++) {
    const [y,r,x,z] = rings[j], a=TAU*i/count, grain = (1+Math.cos(5*a+j*0.095))*0.5;
    const rad=r*(0.77+0.27*grain);
    points.push(x+rad*Math.cos(a),y+(j===rings.length-1 ? 0.007*Math.sin(3*a) : 0),z+rad*Math.sin(a));
    uv.push(j/(rings.length-1),i/count);
    c.copy(groove).lerp(cork,0.15+0.73*grain).toArray(colors,colors.length);
    if(j && i) {
      const k=j*(count+1)+i, l=k-count-1;
      index.push(l-1,k-1,k,l-1,k,l);
    }
  }
  const cap=(rings.length-1)*(count+1);
  for(let i=1;i<count-1;i++) index.push(cap,cap+i+1,cap+i);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(points,3)); g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();
  return finish(g,F.wood);
}

export function pumpkinGeometry(close) {
  const sides = close ? 72 : 24, rows = close ? 24 : 8;
  const body = new THREE.SphereGeometry(1,sides,rows), pos=body.attributes.position, uvBody=body.attributes.uv, colors=[];
  const recess=new THREE.Color('#a64c20'), skin=new THREE.Color('#e7822c'), soil=new THREE.Color('#99713a'), c=new THREE.Color();
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i), a=Math.atan2(z,x), polar=Math.max(0,y);
    const lobe=0.5+0.5*Math.cos(8*a+0.36*Math.sin(3*a)+y*0.28);
    const radius=0.355*(0.83+0.19*Math.pow(lobe,0.47))*(1+0.032*Math.sin(3*a+0.5*y));
    const height=Math.max(-0.002,0.218+0.245*y-0.086*polar**8-0.012*(1-lobe)*polar**3);
    pos.setXYZ(i,x*radius,height,z*radius*0.95);
    uvBody.setY(i,0.06+0.36*uvBody.getY(i));
    const streak=0.5+0.5*Math.cos(17*a+0.7*Math.sin(5*a-7*y)+0.4*y);
    const speck=0.5+0.5*Math.sin(39*x+24*y-17*z)*Math.cos(26*z+12*y);
    const groundStain=Math.max(0,(-y-0.55)*0.77+0.045*Math.cos(5*a));
    c.copy(recess).lerp(skin,0.16+0.67*lobe+0.12*streak).lerp(soil,groundStain)
      .multiplyScalar(0.87+0.07*Math.cos(6*a+5*y)+0.08*streak+0.08*speck).toArray(colors,colors.length);
  }
  body.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); sphereNormals(body,sides,rows);
  const parts=[finish(body,F.foliage),stem(close)];
  // Звёздчатая сухая чашечка лежит по долькам у основания плодоножки.
  for(let j=0;j<5;j++) {
    const a=TAU*j/5, p=[], uv=[], idx=[0,2,1,1,2,3,2,4,3], c=Math.cos(a),s=Math.sin(a);
    for(const [r,across,y] of [[0.024,0,0.392],[0.053,-0.018,0.393],[0.057,0.018,0.401],[0.083,-0.005,0.407],[0.106,0.010,0.413]]) {
      p.push(r*c-across*s,y,r*s+across*c);uv.push(r*7,0.5+across*10);
    }
    const blade=new THREE.BufferGeometry();
    blade.setAttribute('position',new THREE.Float32BufferAttribute(p,3));blade.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    blade.setIndex(idx);blade.computeVertexNormals();
    parts.push(finish(G.colored(blade,'#797044'),F.foliage));
  }
  return G.mergeColored(parts);
}

function rolledSnow(radius, center, seed, close) {
  const sides=close ? 32 : 12, rows=close ? 20 : 7, snow=new THREE.SphereGeometry(1,sides,rows);
  const p=snow.attributes.position, colors=[], c=new THREE.Color();
  const compact=new THREE.Color('#cbcfd2'), powder=new THREE.Color('#f4f7f7');
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
    const lump=Math.sin(4*x+5*z+seed)*Math.cos(5*y-3*z)+0.57*Math.sin(9*y+3*x+4*z+seed);
    const r=radius*(1+0.028*lump), height=Math.max(0,center[1]+y*r*0.98);
    p.setXYZ(i,center[0]+x*r,height,center[2]+z*r);
    c.copy(compact).lerp(powder,THREE.MathUtils.clamp(0.58+0.18*lump+0.20*y,0.03,1)).toArray(colors,colors.length);
  }
  snow.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));sphereNormals(snow,sides,rows);
  return finish(snow,F.mineral);
}

export function snowmanGeometry(close) {
  const parts=[rolledSnow(0.55,[0,0.47,0],1,close),rolledSnow(0.405,[0.014,1.18,-0.012],5,close),
    rolledSnow(0.29,[-0.013,1.72,0.014],8,close)];
  const add=(g,pose,id) => parts.push(G.place(finish(g,id),pose));
  const coal=(r,x,y,z) => add(G.sphere(r,close?7:6,close?4:3,'#343533'),{x,y,z,sz:0.66,ry:3*y},F.mineral);
  coal(0.042,-0.106,1.79,0.265);coal(0.042,0.086,1.8,0.271);
  coal(0.053,0.03,1.27,0.386);coal(0.05,0.018,1.07,0.378);
  const carrot=new THREE.LatheGeometry([[0.02,0],[0.06,0.015],[0.063,0.044],[0.051,0.082],[0.052,0.095],
    [0.031,0.18],[0.025,0.22],[0.009,0.271],[0,0.28]].map(([r,y])=>new THREE.Vector2(r,y)),close ? 16 : 8);
  add(G.colored(carrot,'#d97831'),{x:-0.012,y:1.717,z:0.252,rx:1.67,rz:0.10},F.foliage);
  const dark='#414441', hat=new THREE.LatheGeometry([[0,0],[0.185,0],[0.225,0.015],[0.226,0.027],
    [0.211,0.036],[0.152,0.035],[0.147,0.066],[0.14,0.247],[0.128,0.268],[0,0.271]]
    .map(([r,y])=>new THREE.Vector2(r,y)),close ? 32 : 12);
  add(G.colored(hat,dark),{x:-0.028,y:1.948,z:0.011,rz:0.10},F.cloth);
  add(G.cylinder(0.150,0.155,0.048,close ? 32 : 10,'#69594b'),{x:-0.035,y:2.019,z:0.011,rz:0.10},F.cloth);
  const scarf='#ac443d', band=new THREE.LatheGeometry([[0.249,0],[0.282,0.009],[0.293,0.034],
    [0.30,0.103],[0.292,0.131],[0.262,0.144]].map(([r,y])=>new THREE.Vector2(r,y)),close ? 32 : 10);
  add(G.colored(band,scarf),{y:1.435,rz:0.07},F.cloth);
  for(let end=0;end<2;end++) {
    const points=[],uv=[],idx=[],rows=close?12:5;
    for(let j=0;j<=rows;j++) {
      const t=j/rows, x=0.175-end*0.085+t*(end?0.015:0.065), y=1.51-t*(end?0.225:0.36);
      const bodyR=Math.sqrt(Math.max(0,0.405**2-(y-1.18)**2));
      const front=Math.sqrt(Math.max(0,bodyR**2-(x-0.014)**2));
      const z=Math.max(0.215,front)+0.019+end*0.008;
      for(const k of [-1,0,1]) {points.push(x+k*0.043,y+k*0.005,z+(1-Math.abs(k))*0.014-k*0.018);uv.push(t,(k+1)*0.5);}
      if(j) {const i=j*3;idx.push(i-3,i,i-2,i-2,i,i+1,i-2,i+1,i-1,i-1,i+1,i+2);}
    }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
    parts.push(finish(G.colored(g,end?'#b84e42':scarf),F.cloth));
  }
  for(const side of [-1,1]) {
    const limb=(path,r) => {
      const c=new THREE.CatmullRomCurve3(path.map(([x,y,z])=>vector([side*x,y,z])));
      parts.push(finish(G.colored(new THREE.TubeGeometry(c,close?9:4,r,close?7:4,false),'#75614e'),F.wood));
    };
    limb([[0.32,1.23,-0.01],[0.47,1.31,0.01],[0.61,1.36,-0.015],[0.79,1.49,0.01]],0.020);
    limb([[0.59,1.36,-0.012],[0.64,1.455,-0.02],[0.65,1.52,-0.046]],0.012);
  }
  return G.mergeColored(parts);
}

/** Один draw на украшения сезона. Вдали используется простая сетка; буфер матриц
 * переписывается лишь при изменении видимого набора. Свет и раскладка не зависят от LOD. */
export function seasonalLod(mesh, makeGeometry, radius, midHeight) {
  const far=mesh.geometry;
  let near=null, detailed=false;
  const matrices=mesh.instanceMatrix.array.slice(), count=mesh.count;
  const frustum=new THREE.Frustum(), clip=new THREE.Matrix4(), last=new THREE.Matrix4(), m=new THREE.Matrix4();
  const sphere=new THREE.Sphere(), flags=new Uint8Array(count).fill(1);
  return {
    mesh,
    update(camera) {
      if (!camera?.isCamera) return;
      camera.updateWorldMatrix(true,false);mesh.updateWorldMatrix(true,false);
      clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(mesh.matrixWorld);
      if(last.equals(clip)) return;
      last.copy(clip);frustum.setFromProjectionMatrix(clip,camera.coordinateSystem,camera.reversedDepth);
      const limit=(detailed ? 8.2 : 7.1)*camera.projectionMatrix.elements[5];
      let changed=false, close=false;
      for(let i=0;i<count;i++) {
        m.fromArray(matrices,i*16);
        sphere.center.set(0,midHeight,0).applyMatrix4(m);sphere.radius=radius*m.getMaxScaleOnAxis();
        const visible=frustum.intersectsSphere(sphere)?1:0;
        if(flags[i]!==visible) {flags[i]=visible;changed=true;}
        if(visible && sphere.center.applyMatrix4(mesh.matrixWorld).distanceToSquared(camera.position)<limit*limit) close=true;
      }
      if(changed) {
        let n=0;
        for(let i=0;i<count;i++) if(flags[i]) mesh.setMatrixAt(n++,m.fromArray(matrices,i*16));
        mesh.count=n;mesh.visible=n>0;mesh.instanceMatrix.needsUpdate=true;
      }
      if(close!==detailed) {detailed=close;mesh.geometry=close?(near??=makeGeometry(true)):far;}
    },
    dispose() { if(mesh.geometry!==far) far.dispose(); if(near && mesh.geometry!==near) near.dispose(); },
  };
}
