// Осенний клён: от низкой развилки расходятся широкие скелетные ветви. На каждой кисти
// общая масса мелкой листвы и отдельные пальчатые листья по краям. Цвет задаёт посадка.
import * as THREE from 'three';
import { bakedModel, bakedTexture } from './baked.js';
import { createRng } from '../../core/rng.js';
import { VegetationBuilder } from './geometry.js';
import { VEG_GEN, generationStamp, finishGeneration } from './atlas.js';
import { FLORA } from '../menu/floraData.js';

const cache = new Map(), TAU = Math.PI * 2;
const ROOT = new THREE.Color('#856b5c'), BARK = new THREE.Color('#b39a81');
const YOUNG_BARK = new THREE.Color('#a47355');
const P = new THREE.Vector3(), N = new THREE.Vector3(), C = new THREE.Color();
const flexAt = (y) => Math.min(1, Math.max(0, (y - 0.12) / 3.98));
const point = (x, y, z) => new THREE.Vector3(x, y, z);

/** Положение листа с учётом опадения; тот же smoothstep применяет материал. */
export function autumnLeafPosition(geometry, index, loss, out) {
  out.fromBufferAttribute(geometry.attributes.position, index);
  const target = geometry.attributes.aAutumnTarget;
  if (!target) return out;
  const rank = target.getW(index);
  const shed = THREE.MathUtils.smoothstep(loss, 0.16 + 0.43 * rank, 0.59 + 0.36 * rank);
  out.x += shed * target.getX(index);
  out.y += shed * target.getY(index);
  out.z += shed * target.getZ(index);
  return out;
}

// Положение выхода в свет, ширина плеча и подъём его кончика. У первого клёна
// нижняя ветвь тянется влево вдоль поляны, у второго эту сторону занимает вилка.
const MAPLE_ARMS = [
  [[-1.29,2.15,.14,.77,.49],[-.88,2.73,-.59,.72,.59],[.72,2.35,-.91,.77,.53],
    [1.12,2.62,.34,.83,.54],[-.22,2.47,.98,.80,.62],
    [-.72,3.30,.17,.72,.55],[.34,3.18,-.48,.71,.63],[.50,3.57,.41,.65,.58]],
  [[-.86,2.67,.75,.78,.61],[-1.18,2.31,-.33,.85,.48],[-.24,2.54,-.88,.66,.61],
    [.65,2.19,.97,.76,.55],[1.17,2.72,-.17,.78,.54],
    [.77,3.28,.29,.73,.56],[-.38,3.13,-.57,.75,.57],[-.53,3.56,.36,.65,.61]],
];

/** Все уровни берут одну и ту же развилку, концы ветвей и оттенки кистей. */
function branches(variant) {
  const rng = createRng(71289 + variant * 3023);
  return MAPLE_ARMS[variant%2].map(([x,y,z,width,height], i) => ({
    center: point(x,y,z), a: Math.atan2(z,x), tier: i<5 ? 0 : i<7 ? 1 : 2,
    rank: ((i*5+variant*3+1)%8)/7, width, height,
    hue: rng.uniform(.22,.74), phase: rng.uniform(0,TAU),
  }));
}

// Кольца одного участка ствола могут иметь разное число вершин. UV-шов замыкают
// две совпадающие вершины с одинаковой нормалью. Треугольники следуют за ближайшим углом.
function joinRings(b, lower, n, upper, m) {
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (j === m || (i < n && (i + 1) * m <= (j + 1) * n)) {
      b.idx.push(lower + i, upper + j, lower + i + 1);
      i++;
    } else {
      b.idx.push(lower + i, upper + j, upper + j + 1);
      j++;
    }
  }
}

function wood(b, path, radii, sides, phase, tipFlex = 0, smooth = false, socket = null) {
  const along = new THREE.Vector3(), right = new THREE.Vector3(), across = new THREE.Vector3();
  let previous = 0, previousCount = 0, distance = 0;
  const wraps = socket?.top ? 2 : Math.max(1, Math.round(TAU*radii[0]/.54));
  for (let j = 0; j < path.length; j++) {
    const p = path[j], start = b.count, t = j / (path.length - 1), count = Array.isArray(sides) ? sides[j] : sides;
    if (j) distance += path[j-1].distanceTo(p);
    along.subVectors(path[Math.min(path.length - 1, j + 1)], path[Math.max(0, j - 1)]).normalize();
    if (!smooth || !j) right.set(Math.abs(along.x) < 0.93 ? 1 : 0, Math.abs(along.x) < 0.93 ? 0 : 1, 0);
    right.addScaledVector(along, -right.dot(along)).normalize();
    if (socket && j < socket.skip) continue;
    across.crossVectors(right, along);
    // У дальних ветвей кончик скрыт листвой. На одну такую развилку достаточно трёх граней.
    if (j && radii[j] === 0) {
      b.push(p, along, 0.75, 0.49, b.barkCoords ? YOUNG_BARK : BARK, flexAt(p.y), 0, tipFlex);
      if (b.barkCoords) b.barkCoords.push(wraps*.5+phase/TAU,distance/.68+phase/TAU,0.06);
      for (let i = 0; i < previousCount; i++) b.idx.push(previous + i, start, previous + i + 1);
      continue;
    }
    for (let i = 0; i <= count; i++) {
      const a = TAU * i / count + phase + 0.16 * t;
      const furrow = Math.sin(3 * a + 0.8 * t) + 0.53 * Math.sin(5 * a - t);
      N.copy(right).multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a));
      P.copy(p).addScaledVector(N, radii[j] * (1 + (p.y < 0.20 ? 0.24 : 0.055) * furrow));
      P.y = Math.max(0, P.y);
      C.copy(ROOT).lerp(BARK, 0.32 + 0.29 * t + 0.17 * furrow).multiplyScalar(0.88 + 0.13 * t);
      // На защищённом молодом приросте перидерма ещё медно-коричневая и гладкая.
      const age=b.barkCoords ? THREE.MathUtils.smoothstep(radii[j],.010,.082) : 1;
      if(b.barkCoords) C.lerp(YOUNG_BARK,(1-age)*(.67+.09*Math.cos(phase+t)));
      if (smooth) {
        const k = Math.max(0, j - 1), l = Math.min(path.length-1, j+1);
        N.addScaledVector(along, (radii[k] - radii[l]) / Math.max(1e-4, path[k].distanceTo(path[l]))).normalize();
      }
      b.push(P, N, 0.65 + 0.34 * i / count, 0.01 + 0.48 * t, C, flexAt(P.y), 0, tipFlex * t * t);
      if (b.barkCoords) {
        const anchor=socket ? (socket.y ?? 2.12)/.68 : phase/TAU;
        const u = socket?.top ? 2*i/count : wraps*i/count+phase/TAU;
        b.barkCoords.push(u,distance/.68+anchor,.025+.975*age);
      }
    }
    if (socket && j === socket.skip) {
      bridgeSocket(b, socket, start, count);
      socket.distance = distance;
    }
    else if (j) joinRings(b, previous, previousCount, start, count);
    if (socket) for (let i=0; i<=count; i++) {
      const k=3*(start+i), f=i/count;
      if (socket.top) {
        b.barkCoords[k]=2*f+socket.u0;
        b.barkCoords[k+1]=2.12/.68+distance/.68;
      } else {
        b.collar[start+i]=1-THREE.MathUtils.smoothstep(distance-socket.distance,.015,.47);
      }
    }
    previous = start; previousCount = count;
  }
}

// Ось проходит через точки развилки без ломаного колена. Поперечное сечение
// переносится вдоль касательной; тонкие побеги получают меньше сторон и большую податливость.
function shoot(b, knots, widths, intervals, sides, phase, tipFlex = 0, socket = null) {
  const curve = new THREE.CatmullRomCurve3(knots), path = [], radii = [], counts = [];
  for (let i = 0; i <= intervals; i++) {
    const t = i / intervals, u = t * (knots.length - 1), k = Math.min(Math.floor(u), knots.length - 2);
    path.push(curve.getPoint(t));
    radii.push(THREE.MathUtils.lerp(widths[k], widths[k+1], u-k));
    counts.push(Math.max(3, Math.round(sides * (1 - 0.45 * t))));
  }
  if (b) wood(b, path, radii, counts, phase, tipFlex, true, socket);
  return path;
}

// Переход от комля к вершине непрерывен. Для двух старших ветвей в поверхности
// оставлены овальные отверстия: их обод переходит прямо в первое сечение ветви.
function trunkAxis(axis, y) {
  let i = 0;
  while (i < 3 && y > axis[i+1].y) i++;
  const a = axis[i], b = axis[i+1], before = axis[Math.max(0,i-1)], after = axis[Math.min(5,i+2)];
  const span = b.y-a.y, t = (y-a.y)/span;
  const s = t*t*(3-2*t), h0 = t*(1-t)*(1-t)*span, h1 = t*t*(t-1)*span;
  const at = key => a[key]+(b[key]-a[key])*s+h0*(b[key]-before[key])/(b.y-before.y)
    +h1*(after[key]-a[key])/(after.y-a.y);
  if (t > 1) return point(b.x+(after.x-a.x)/(after.y-a.y)*(y-b.y), y, b.z+(after.z-a.z)/(after.y-a.y)*(y-b.y));
  return point(at('x'), y, at('z'));
}

function bridgeSocket(b, socket, start, count) {
  const loop = socket.loop, n = loop.length;
  // Поворот шва подбирается по всем направлениям обода, включая наклонное плечо.
  let best = 0, bestCost = Infinity;
  for (let shift=0; shift<n; shift++) {
    let cost=0;
    for (let j=0;j<count;j++) {
      const a=3*loop[(shift+Math.round(j*n/count))%n], c=3*(start+j);
      cost+=(b.pos[a]-b.pos[c])**2+(b.pos[a+1]-b.pos[c+1])**2+(b.pos[a+2]-b.pos[c+2])**2;
    }
    if (cost<bestCost) { bestCost=cost; best=shift; }
  }
  const ring=[];
  for (let i=0;i<=n;i++) ring.push(loop[(best+i)%n]);

  socket.u0=b.barkCoords[3*ring[0]];
  let next=start;
  if (!socket.top) {
    // Дополнительное сечение плеча выходит по касательной из коры ствола и входит
    // по касательной в ветвь. Это задаёт пластичный воротник даже со стороны подмышки.
    next=b.count;
    const root=new THREE.Vector3(), tip=new THREE.Vector3(), lowerN=new THREE.Vector3(), upperN=new THREE.Vector3();
    const aux=new THREE.Vector3(), delta=new THREE.Vector3(), tone=new THREE.Color();
    for(let j=0;j<=count;j++) {
      const q=j*n/count, k=Math.floor(q), left=ring[k], right=ring[Math.min(n,k+1)], t=q-k;
      root.fromArray(b.pos,3*left).lerp(aux.fromArray(b.pos,3*right),t);
      lowerN.fromArray(b.nor,3*left).lerp(aux.fromArray(b.nor,3*right),t).normalize();
      tip.fromArray(b.pos,3*(start+j)); upperN.fromArray(b.nor,3*(start+j)); delta.subVectors(tip,root);
      P.copy(root).lerp(tip,.50).addScaledVector(lowerN,-.125*lowerN.dot(delta)).addScaledVector(upperN,.125*upperN.dot(delta));
      N.copy(lowerN).lerp(upperN,.5).normalize(); C.fromArray(b.col,3*left).lerp(tone.fromArray(b.col,3*(start+j)),.5);
      // Включённая кора образует короткую защемлённую складку только у верхнего
      // края развилки. Длина и направление следуют реальному ободу ответвления.
      const crotch=THREE.MathUtils.smoothstep(root.y,socket.y+.18,socket.y+.32);
      const lip=Math.pow(crotch,3)*(.73+.27*Math.cos(TAU*j/count));
      P.addScaledVector(lowerN,-.006*lip); C.multiplyScalar(1-.31*lip);
      b.push(P,N,.75,.36,C,flexAt(P.y),0);
      b.barkCoords.push(b.barkCoords[3*left],P.y/.68,1);
      b.collar[b.count-1]=1;
    }
    joinRings(b,next,count,start,count);
  }
  let i=0,j=0;
  while(i<n || j<count) {
    if (j===count || (i<n && (i+1)*count <= (j+1)*n)) {
      b.idx.push(ring[i],next+j,ring[i+1]); i++;
    } else { b.idx.push(ring[i],next+j,next+j+1); j++; }
  }
  for(const index of ring) b.seamNormals.add(index);
  for(let k=0;k<=count;k++) { b.seamNormals.add(start+k); b.seamNormals.add(next+k); }
}

function smoothSockets(b) {
  // Совпадающие вершины по обе стороны UV-шва образуют один узел освещения.
  const nodes=new Map(), lookup=new Map(), verts=[point(0,0,0),point(0,0,0),point(0,0,0)];
  const a=new THREE.Vector3(), c=new THREE.Vector3(), normal=new THREE.Vector3();
  const key=i=>Math.round(1e5*b.pos[3*i])+','+Math.round(1e5*b.pos[3*i+1])+','+Math.round(1e5*b.pos[3*i+2]);
  for(const i of b.seamNormals) nodes.set(key(i),new THREE.Vector3());
  for(let i=0;i<b.count;i++) {
    const node=nodes.get(key(i));
    if(node) lookup.set(i,node);
  }
  for(let k=0;k<b.idx.length;k+=3) {
    if(!lookup.has(b.idx[k]) && !lookup.has(b.idx[k+1]) && !lookup.has(b.idx[k+2])) continue;
    for(let j=0;j<3;j++) verts[j].fromArray(b.pos,3*b.idx[k+j]);
    normal.crossVectors(a.subVectors(verts[1],verts[0]),c.subVectors(verts[2],verts[0])).normalize();
    for(let j=0;j<3;j++) {
      const node=lookup.get(b.idx[k+j]);
      if(node) node.addScaledVector(normal,a.subVectors(verts[(j+1)%3],verts[j]).angleTo(c.subVectors(verts[(j+2)%3],verts[j])));
    }
  }
  for(const [i,node] of lookup) {
    if(node.lengthSq()>1e-8) normal.fromArray(b.nor,3*i).lerp(node.normalize(),.90).normalize().toArray(b.nor,3*i);
  }
}

function trunk(b, axis, phase, sockets) {
  const sides=36, step=TAU/sides, top=2.12;
  const heights=[0,.013,.037,.073,.125,.20,.31,.46,.63,.78,1.46,top];
  for (const site of sockets) {
    site.low=site.y-.10; site.high=site.y+.32;
    site.sector=Math.round((site.a-phase)/step);
    for(let k=0;k<=4;k++) heights.push(site.low+(site.high-site.low)*k/4);
  }
  heights.sort((a,b)=>a-b);
  const rows=heights.filter((h,i)=>!i || h-heights[i-1]>.0001);
  // Два бывших боковых побега различного возраста. Заменяем участки самой
  // оболочки, чтобы у затянувшегося сучка не было подложки и края наклейки.
  const scars=[
    {bottom:.63, top:sockets[0].low, az:sockets[0].a-1.49, span:3, width:.037, height:.080, lean:.21, closed:.23},
    {bottom:sockets[0].high, top:sockets[1].low, az:sockets[1].a+1.24, span:3, width:.022, height:.049, lean:-.28, closed:.48},
    // Узкая включённая кора поднимается от подмышки старшей ветви.
    {bottom:sockets[0].high, top:sockets[1].low, az:sockets[0].a+.12, span:1, width:.008, height:.055, lean:-.11, closed:.27, crotch:true},
  ];
  for(const scar of scars) {
    scar.low=rows.findIndex(y=>Math.abs(y-scar.bottom)<.0001);
    scar.high=rows.findIndex(y=>Math.abs(y-scar.top)<.0001);
    scar.sector=Math.round((scar.az-phase)/step);
    scar.y=scar.bottom+(scar.crotch ? .059 : (scar.top-scar.bottom)*.52);
  }
  const roots=[[.03,.36,.26,.16], [1.27,.20,.20,-.16], [2.63,.31,.23,.20], [4.02,.20,.22,.13], [5.01,.28,.24,-.20]];
  const pos=new THREE.Vector3(), tangent=new THREE.Vector3(), vertical=new THREE.Vector3(), ringStarts=[];
  const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
  function surface(y, a, out) {
    const az=phase+a, center=trunkAxis(axis,y);
    let r=.187-.035*y+.005*Math.sin(3*az+.7*y)+.003*Math.cos(5*az-1.4*y);
    r+=.058*Math.exp(-y/.26)+.012*Math.exp(-y/.060);
    for(const [bearing,reach,width,curl] of roots) {
      const dy=Math.max(0,y), t=Math.sqrt(Math.min(1,dy/.63));
      const delta=wrapAngle(a-bearing-curl*(1-t*t));
      const rib=Math.exp(-.5*(delta/(width+.12*t*t))**2);
      r+=reach*(1-t)**2.35*rib;
    }
    for(const site of sockets) {
      const arc=wrapAngle(az-site.a), ridgeY=site.y+.015+.12*Math.min(1,Math.abs(arc));
      r+=.045*Math.exp(-1.45*arc*arc-((y-ridgeY)**2)/.032);
    }
    // Небольшие продольные складки на старой коре влияют на действительную нормаль.
    r+=.0025*Math.sin(11*a+1.7*Math.sin(az+.95*y))+.0017*Math.cos(16*a-1.22*y);
    return out.set(center.x+r*Math.cos(az),y,center.z+r*Math.sin(az));
  }
  for(let row=0;row<rows.length;row++) {
    const start=b.count; ringStarts.push(start);
    for(let k=0;k<=sides;k++) {
      let a=k*step, y=rows[row];
      // Скругление углов окна ореховидной развилки; рядом сетка продолжает ход волокон.
      for(const site of sockets) {
        const edge=3*step, half=(site.high-site.low)/2, mid=site.low+half;
        const u=wrapAngle(a-site.sector*step)/edge, v=(y-mid)/half;
        if(Math.abs(u)<=1.00001 && Math.abs(v)<=1.00001) {
          a-=u*edge*(1-Math.sqrt(1-.43*v*v)); y-=v*half*(1-Math.sqrt(1-.43*u*u));
        }
      }
      surface(y,a,P); tangent.copy(surface(y,a+.004,pos)).sub(surface(y,a-.004,pos));
      vertical.copy(surface(Math.min(top+.001,y+.001),a,pos)).sub(surface(Math.max(0,y-.001),a,pos));
      N.crossVectors(vertical,tangent).normalize();
      const tone=.41+.075*Math.sin(2*a+1.1*y)+.055*Math.cos(5*a-.8*y);
      C.copy(ROOT).lerp(BARK,tone);
      b.push(P,N,.65+.34*k/sides,.01+.48*(y/top),C,flexAt(y),0);
      b.barkCoords.push(2*a/TAU,y/.68,1);
      let collar=0;
      for(const site of sockets) {
        const u=wrapAngle(a-site.sector*step)/(3*step), v=(y-(site.low+site.high)*.5)/((site.high-site.low)*.5);
        collar=Math.max(collar,1-THREE.MathUtils.smoothstep(Math.hypot(u,v),1.25,2));
      }
      b.collar[b.count-1]=collar;
    }
    if(!row) continue;
    const ym=(rows[row-1]+rows[row])*.5, prev=ringStarts[row-1];
    for(let k=0;k<sides;k++) {
      if(scars.some(scar=>row>scar.low && row<=scar.high &&
        Math.abs(wrapAngle((k+.5-scar.sector)*step))<scar.span*step)) continue;
      if(sockets.some(site=>ym>site.low && ym<site.high && Math.abs(wrapAngle((k+.5-site.sector)*step))<3*step)) continue;
      b.idx.push(prev+k,start+k,prev+k+1,prev+k+1,start+k,start+k+1);
    }
  }
  const index=(row,k)=>ringStarts[row]+((k%sides)+sides)%sides;
  for(const site of sockets) {
    const low=rows.findIndex(y=>Math.abs(y-site.low)<.00011), high=rows.findIndex(y=>Math.abs(y-site.high)<.00011);
    const left=site.sector-3, right=site.sector+3, loop=[];
    for(let k=left;k<right;k++) loop.push(index(low,k));
    for(let j=low;j<high;j++) loop.push(index(j,right));
    for(let k=right;k>left;k--) loop.push(index(high,k));
    for(let j=high;j>low;j--) loop.push(index(j,left));
    site.loop=loop; site.skip=5;
  }
  for(const scar of scars) {
    const angle=scar.sector*step, span=scar.span, perimeter=[];
    const vertex=(row,k)=>({index:index(row,k),a:k*step,y:rows[row]});
    for(let k=-span;k<span;k++) perimeter.push(vertex(scar.low,scar.sector+k));
    for(let j=scar.low;j<scar.high;j++) perimeter.push(vertex(j,scar.sector+span));
    for(let k=span;k>-span;k--) perimeter.push(vertex(scar.high,scar.sector+k));
    for(let j=scar.high;j>scar.low;j--) perimeter.push(vertex(j,scar.sector-span));
    const stemRadius=.187-.035*scar.y;
    const outer=perimeter.map(p=>p.index), count=outer.length;
    let previous=outer;
    // Большой старый рубец почти сомкнулся в короткий шов. У меньшего ещё видна
    // кромка сухой древесины. Смещение сердцевины делает оба наплыва асимметричными.
    function relief(x,y) {
      const dx=(x-scar.lean*y)/scar.width, dy=y/scar.height;
      const seam=dx+.14*Math.sin(2.3*dy)+.19*dy*dy-.11;
      const radius=Math.hypot(dx*(1+.14*dy),dy);
      const shoulder=Math.exp(-((radius-.71)**2)/.15)*(.77+.22*dx);
      const cleft=Math.exp(-((seam/scar.closed)**2)-((dy+.05)/.59)**2);
      if(scar.crotch) return .0035*Math.exp(-((Math.abs(seam)-.6)**2)/.13-.9*dy*dy)-.005*cleft;
      return .010*shoulder-.006*cleft;
    }
    function scarSurface(a,y,out) {
      const x=(a-angle)*stemRadius, h=y-scar.y;
      surface(y,a,out);
      const r=relief(x,h), az=phase+a;
      out.x+=r*Math.cos(az); out.z+=r*Math.sin(az); return out;
    }
    for(const radius of (scar.crotch ? [.82,.34,.10] : [1,.70,.36,.12])) {
      const ring=[];
      for(const edge of perimeter) {
        const theta=Math.atan2((edge.y-scar.y)/(.5*(scar.top-scar.bottom)),(edge.a-angle)/(span*step));
        const dy=radius*Math.sin(theta), dx=radius*Math.cos(theta)*(1-.13*dy);
        const h=scar.height*dy, x=scar.width*dx+scar.lean*h;
        const a=angle+x/stemRadius, y=scar.y+h;
        scarSurface(a,y,P);
        tangent.copy(scarSurface(a+.003,y,pos)).sub(scarSurface(a-.003,y,pos));
        vertical.copy(scarSurface(a,y+.0007,pos)).sub(scarSurface(a,y-.0007,pos));
        N.crossVectors(vertical,tangent).normalize();
        const seam=dx+.14*Math.sin(2.3*dy)+.19*dy*dy-.11;
        const open=Math.exp(-((seam/scar.closed)**2)-((dy+.05)/.59)**2);
        const tone=.41+.075*Math.sin(2*a+1.1*y)+.055*Math.cos(5*a-.8*y);
        C.copy(ROOT).lerp(BARK,tone).multiplyScalar(1-.39*open+.09*Math.max(0,relief(x,h)/.010));
        ring.push(b.count); b.push(P,N,.73,.30,C,flexAt(y),0);
        const wrapped=((a%TAU)+TAU)%TAU;
        // Продольные трещины огибают верх и низ раны и сходятся под ней.
        b.barkCoords.push(2*wrapped/TAU-(scar.crotch?.026:.102)*dx*Math.exp(-.54*dx*dx-.79*dy*dy),
          y/.68+.022*dy*(1-radius),1-.48*open);
      }
      for(let k=0;k<count;k++) {
        const next=(k+1)%count;
        b.idx.push(previous[k],ring[k],previous[next],previous[next],ring[k],ring[next]);
      }
      previous=ring;
    }
    const core=b.count;
    scarSurface(angle,scar.y,P);
    N.set(Math.cos(angle+phase),.02,Math.sin(angle+phase)).normalize(); C.copy(ROOT).multiplyScalar(.80);
    b.push(P,N,.73,.3,C,flexAt(scar.y),0);
    b.barkCoords.push(2*(((angle%TAU)+TAU)%TAU)/TAU,scar.y/.68,.50);
    for(let k=0;k<count;k++) b.idx.push(previous[k],core,previous[(k+1)%count]);
  }
  return {loop:Array.from({length:sides},(_,i)=>ringStarts.at(-1)+i),skip:1,top:true};
}

// Побег выходит из родительской ветви по её касательной и только затем расходится.
// Последняя треть — длинный прирост от тонкой почки, меняющий направление и гибкость.
function lateral(b, f, parent, rootT, direction, length, girth, bend, radial = 5) {
  length*=f.width/.88;
  const k = Math.max(1, Math.min(parent.length-2, Math.round(rootT*(parent.length-1))));
  const base = parent[k], tangent = parent[k+1].clone().sub(parent[k-1]).normalize();
  const toward = direction.clone().normalize(), bow = point(-toward.z, bend, toward.x);
  const at = (along, across, arc) => base.clone().addScaledVector(tangent, along*length)
    .addScaledVector(toward, across*length).addScaledVector(bow, arc*length);
  const p = shoot(b, [base, at(.19,.04,.015), at(.39,.22,.12), at(.51,.49,.17), at(.52,.88,-.11)],
    [girth, girth*.78, girth*.48, girth*.21, 0], girth < .025 ? 5 : 8, radial, f.phase+rootT, 0.05);
  f.shoots.push([p[Math.floor(.47*p.length)],p[p.length-2]]);
  return p;
}

function winterBud(b, parent, phase) {
  const k = parent.length-2, base = parent[k], direction = parent[k+1].clone().sub(parent[k-1]).normalize();
  const out = point(Math.cos(phase),.28,Math.sin(phase)).add(direction).normalize();
  const mid = base.clone().addScaledVector(out,.011), tip = base.clone().addScaledVector(out,.027);
  const start=b.count;
  wood(b,[base,mid,tip],[.003,.007,0],4,phase,.035,true);
  for(let j=start;j<b.count;j++) { b.col[3*j]*=.79; b.col[3*j+1]*=.47; b.col[3*j+2]*=.48; }
}

function nearBranches(b, design, axis, major, minor, sockets, topSocket) {
  let leaderTriangles = 0;
  const paths = [];
  // Верхние и соседние лопасти выходят из старших плеч. У ствола остаются
  // две разнесённые по высоте скелетные развилки и центральный проводник.
  const one=(major+1)%5, two=(major+2)%5, four=(major+4)%5;
  for (const i of [7,major,minor,one,four,two,5,6]) {
    const f=design[i], c=f.center, a=f.a, az=a+0.28*Math.sin(f.phase), w=f.width;
    f.shoots=[];
    const outward=point(Math.cos(az),0,Math.sin(az)), side=point(-outward.z,0,outward.x);
    const leader=i===7;
    const site = i===major ? sockets[0] : i===minor ? sockets[1] : null;
    const parent = leader || site ? null : paths[i===one||i===four ? major : i===two ? minor : 7];
    const fraction = i===one ? .26 : i===four ? .35 : i===two ? .33 : i===5 ? .19 : .33;
    const node = parent ? Math.max(1,Math.round(fraction*(parent.length-1))) : 0;
    const base = leader ? trunkAxis(axis,2.12) : site ? trunkAxis(axis,site.y) : parent[node];
    const parentDir = parent ? parent[node+1].clone().sub(parent[node-1]).normalize() : point(0,1,0);
    const girth = leader ? .101 : i===major ? .127 : i===minor ? .083 : i===one ? .065 : i===four ? .055 : i===two ? .060 : i===5 ? .069 : .049;
    const union = base.clone().addScaledVector(parentDir,leader?.13:.115).addScaledVector(outward,leader?.014:.032);
    const hip=base.clone().lerp(c,.34).addScaledVector(side,(leader?-.16:.10)*w).addScaledVector(parentDir,.045);
    hip.y-=leader?0:.052;
    const shoulder=base.clone().lerp(c,.69).addScaledVector(outward,-.12*w).addScaledVector(side,.10*w);
    const entry=c.clone().sub(shoulder).normalize();
    const neck=c.clone().addScaledVector(entry,.18*w).addScaledVector(outward,.06*w);
    const crest=c.clone().addScaledVector(outward,.43*w).addScaledVector(side,.14*w);
    crest.y+=.37*f.height;
    const upper=c.clone().addScaledVector(outward,.69*w).addScaledVector(side,.23*w);
    upper.y+=.57*f.height;
    const tip=c.clone().addScaledVector(outward,.86*w).addScaledVector(side,.36*w);
    tip.y+=(.45+.16*Math.cos(f.phase))*f.height;
    const firstTriangle = b ? b.idx.length/3 : 0;
    const centerline=shoot(b,[base,union,hip,shoulder,c,neck,crest,upper,tip],
      [1.11,1.02,.78,.54,.39,.29,.18,.073,0].map(factor=>factor*girth),22,leader?18:site?14:9,leader?design[0].phase:f.phase,.026,leader?topSocket:site);
    paths[i]=centerline;
    if (leader && b) leaderTriangles = b.idx.length/3 - firstTriangle;
    f.spine=centerline;
    f.shoots.push([centerline[16],centerline[20]]);
    // Два боковых плеча от разных узлов, с парными боковыми почками на каждом.
    for (const sign of [-1,1]) {
      const dir=outward.clone().multiplyScalar(.35).addScaledVector(side,sign*.87);
      dir.y=.15+sign*.20*Math.sin(f.phase);
      const arm=lateral(b,f,centerline,sign<0?.47:.65,dir,sign<0?.81:.70,.019+.14*girth,sign*.26,6);
      const fork=dir.clone().multiplyScalar(.47).addScaledVector(outward,-.56);
      fork.y=.45+.16*Math.cos(a);
      const offshoot=lateral(b,f,arm,.62,fork,.36,.014,-.22,4);
      if(b && sign>0 && i%2===0) winterBud(b,offshoot,f.phase);
    }
    if (i===major || i===one || i===four) {
      const off=outward.clone().multiplyScalar(.31).addScaledVector(side,.63); off.y=-.53;
      lateral(b,f,centerline,.72+.06*Math.sin(a),off,.32,.011,.23,4);
    }
    const small=outward.clone().multiplyScalar(.36).addScaledVector(side,-.80);
    small.y=.39; lateral(b,f,centerline,.79,small,.37,.014,.21,4);
    if (!f.tier && (i===major || i===minor || i===four)) {
      const dir=side.clone().multiplyScalar(-.79).addScaledVector(outward,.46); dir.y=.11;
      const low=lateral(b,f,centerline,.28,dir,.88,.052,-.22,6);
      const fork=dir.clone().addScaledVector(side,.65); fork.y=.57;
      lateral(b,f,low,.63,fork,.43,.020,.24,4);
    }
  }
  return leaderTriangles;
}

function skeleton(b, design, lod, variant) {
  const sign = variant % 2 ? -1 : 1, phase = design[0].phase;
  const axis = [point(0,0,0), point(0.015,0.18,0), point(sign*0.09,0.76,0.04),
    point(sign*0.06,1.35,0.11), point(-sign*0.13,1.98,0.09), design[7].center];
  const radii = [0.30,0.23,0.17,0.148,0.105,0.035], rings = lod===2 ? [0,2,4] : [0,2,3,4,5];
  const major=variant%2 ? 1 : 0, minor=(major+3)%5;
  const sockets = [{ y:1.05+.09*variant,a:design[major].a },{ y:1.71+.06*variant,a:design[minor].a }];
  let topSocket;
  if (lod===0) topSocket=trunk(b,axis,phase,sockets);
  else wood(b,rings.map(i=>axis[i]),rings.map(i=>radii[i]),lod===1 ? [14,13,11,9,7] : [9,7,6],phase,0,true);
  let trunkTriangles = b.idx.length/3;
  if (lod===0) trunkTriangles += nearBranches(b,design,axis,major,minor,sockets,topSocket);
  else {
    if (lod===1) nearBranches(null,design,axis,major,minor,sockets,null);
    const paths = [];
    const one = (major+1)%5, two = (major+2)%5, four = (major+4)%5;
    const heights = [1.05+.09*variant, 1.71+.06*variant];
    for (const i of [major,minor,one,four,two]) {
      const f = design[i], c = f.center, primary = i===major || i===minor;
      const parent = paths[i===two ? minor : major];
      const base = primary ? trunkAxis(axis,heights[i===major?0:1]) :
        parent[0].clone().lerp(parent[1],i===four ? .95 : .70);
      const middle = base.clone().lerp(c,.53);
      if (lod===1) {
        middle.x+=.12*Math.cos(f.a+.65); middle.z+=.12*Math.sin(f.a+.65); middle.y-=.06;
      }
      paths[i] = [base,middle];
      const girth = i===major ? .12 : i===minor ? .088 : .06;
      const upper = middle.clone().lerp(c,.59);
      upper.y += .048; upper.x -= .065*Math.sin(f.a);
      if (lod===2) wood(b,[base,middle,c],[girth,.60*girth,0],[5,4,3],f.phase,0,true);
      else wood(b,[f.spine[0],f.spine[6],f.spine[12],f.spine[21]],[girth,.71*girth,.38*girth,.08*girth],[8,7,5,4],f.phase,0,true);
    }
    for (let i=5;i<(lod===2?8:7);i++) {
      const base = i===7 || lod===2 ? axis[4] : axis[4].clone().lerp(design[7].center,i===5?.20:.37);
      const end = lod===1 ? design[i].spine[21] : design[i].center;
      wood(b,[base,end],[i===6?.05:.075,0],lod===1 ? 6 : 4,design[i].a,0,true);
    }
    if(lod===1) for(const f of design) {
      wood(b,[f.spine[10],f.shoots[1][1]],[.032,0],5,f.a,0,true);
      f.mid=true;
    }
  }
  return {trunkTriangles,branchTriangles:b.idx.length/3-trunkTriangles};
}

function leafColor(hue, value) {
  return C.setRGB((1.08 - 0.08 * hue) * value, (0.51 + 1.18 * hue) * value, (0.85 - 0.19 * hue) * value);
}

function crownNormal(f, p) {
  return N.set((p.x - f.center.x) / f.width + 0.36 * p.x, (p.y - f.center.y) / f.height + 0.30 * (p.y - 2.7),
    (p.z - f.center.z) / f.width + 0.36 * p.z).normalize();
}

// Дальняя крона — внешняя граница тех же восьми кистей. Пересечение лучей с их
// эллипсоидами служит и сетке, и развёртке: оттенки ветвей остаются на месте при обходе.
const CROWN_Y = 2.77, POLAR_SCALE = 0.73, HALF_PI = Math.PI / 2;
function canopy(variant) {
  return branches(variant).map(f => {
    const rw = f.width * (f.tier ? 1.23 : 1.36), rh = f.height * (f.tier ? 1.08 : 1.02);
    const ix = 1 / (rw * rw), iy = 1 / (rh * rh), iz = ix / (1.08 * 1.08);
    const c = f.center;
    c.x+=.12*Math.cos(f.a); c.z+=.12*Math.sin(f.a);
    return { ...f, ix, iy, iz, dx: -c.x * ix, dy: (CROWN_Y - c.y) * iy, dz: -c.z * iz,
      offset: c.x ** 2 * ix + (CROWN_Y - c.y) ** 2 * iy + c.z ** 2 * iz - 1 };
  });
}

let canopySeam = 0;
function canopyPoint(lobes, x, y, z) {
  let radius = 0, next = 0, winner = lobes[7];
  for (const f of lobes) {
    const a = x * x * f.ix + y * y * f.iy + z * z * f.iz;
    const b = f.dx * x + f.dy * y + f.dz * z, disc = b * b - a * f.offset;
    if (disc < 0) continue;
    const t = (Math.sqrt(disc) - b) / a;
    if (t > radius) { next = radius; radius = t; winner = f; }
    else next = Math.max(next, t);
  }
  // Под развилкой концы кистей окружают полость; её дно обращено внутрь полога.
  canopySeam = THREE.MathUtils.smoothstep(radius - next, 0, 0.38);
  radius = Math.max(0.72, radius - 0.16 * (1 - canopySeam));
  P.set(x * radius, CROWN_Y + y * radius, z * radius);
  return winner;
}

const FAR_W = 256, FAR_H = 128, PAD = 2;

function distantCrown(b, variant, targets) {
  const lobes = canopy(variant), phase = lobes[0].a;
  const latitudes = [-HALF_PI, -0.91, -0.47, -0.09, 0.32, 0.73, 1.10, HALF_PI], counts = [1, 5, 8, 20, 10, 10, 5, 1];
  let prev, previousCount;
  for (let j = 0; j < latitudes.length; j++) {
    const lat = latitudes[j], count = counts[j], start = b.count;
    const pole = count === 1;
    // У полюса по одной копии на сектор: меридианы смыкаются без растяжения рисунка.
    const n = pole ? counts[j === 0 ? 1 : j - 1] : count + 1;
    for (let i = 0; i < n; i++) {
      const t = pole ? (i + 0.5) / n : i / count, a = phase + t * TAU;
      const dirX = Math.cos(a) * Math.cos(lat), dirY = POLAR_SCALE * Math.sin(lat), dirZ = Math.sin(a) * Math.cos(lat);
      const f = canopyPoint(lobes, dirX, dirY, dirZ);
      const local = Math.atan2(P.z - f.center.z, P.x - f.center.x);
      const side = 1 - Math.min(1, Math.abs((P.y - f.center.y) / f.height) ** 2);
      const scallop = side * (0.12 * Math.sin(3 * local + f.phase) + 0.07 * Math.cos(5 * local - f.phase));
      // Выступы старших побегов задают неровный профиль между нижним и средним поясами.
      P.x += dirX * scallop; P.z += dirZ * scallop;
      P.y += side * (0.075 * Math.sin(2 * local - f.a) + 0.055 * Math.cos(4 * local + f.phase));
      crownNormal(f, P);
      const u = ((variant % 2) * FAR_W + PAD + (FAR_W - 2 * PAD) * t) / (2 * FAR_W);
      const v = 1 - (PAD + (FAR_H - 2 * PAD) * (0.5 - lat / Math.PI)) / (2 * FAR_H);
      const shade = 0.94 + 0.15 * Math.sin(lat);
      b.push(P, N, u, v, leafColor(f.hue, shade), flexAt(P.y), 1);
      // Связанный полог подтягивается к видимым концам ветвей. Просветы следуют запечённым кистям.
      targets.push((f.center.x - P.x) * 0.58, (f.center.y - P.y) * 0.58, (f.center.z - P.z) * 0.58, f.rank);
    }
    if (j === 1) for (let i = 0; i < count; i++) b.idx.push(prev + i, start + i, start + i + 1);
    else if (j === latitudes.length - 1) for (let i = 0; i < previousCount; i++) b.idx.push(prev + i, start + i, prev + i + 1);
    else if (j) joinRings(b, prev, previousCount, start, count);
    prev = start; previousCount = count;
  }
}

// Пять остроконечных лопастей и две короткие у черешка, выемки между ними. Координаты в плоскости листа.
// Край идёт от черешка вокруг пластинки. У основных лопастей своя пара более
// коротких зубцов; углы и размеры левой и правой половин слегка различаются.
const LEFT = [[-.17,-.54],[-.33,-.47],[-.49,-.52],[-.41,-.34],[-.32,-.27],[-.57,-.19],
  [-.76,-.24],[-.70,-.10],[-.98,.05],[-.77,.09],[-.83,.19],[-.58,.20],[-.45,.13],
  [-.53,.34],[-.71,.43],[-.61,.46],[-.76,.74],[-.54,.61],[-.53,.71],[-.35,.53],
  [-.21,.38],[-.22,.64],[-.32,.72],[-.18,.74],[-.20,.88],[-.09,.83],[.015,1.06]];
const RIGHT = [[.11,.84],[.22,.91],[.19,.72],[.31,.74],[.22,.61],[.22,.40],
  [.36,.51],[.52,.67],[.50,.57],[.81,.72],[.71,.49],[.78,.46],[.56,.35],[.46,.14],
  [.67,.22],[.64,.15],[.94,.11],[.81,-.02],[.89,-.07],[.69,-.10],[.73,-.18],[.53,-.15],
  [.35,-.25],[.48,-.38],[.51,-.50],[.32,-.46],[.16,-.55]];
const CELL = 256, BORDER = 4, ART_SCALE = 2, SINGLE = 66;
let atlas, farAtlas;

// Один мастер живёт только до сборки атласа. Размер и поворот отпечатка свободные,
// а каждый рисунок пигмента и жилок строится лишь один раз на оттенок.
const leafMasters = new Map();
// Физический период рисунка 54 × 68 см. R хранит тон коры, GB — две
// составляющие касательной нормали. Крона и дальние деревья не читают эту карту.
let barkMap;
export function mapleBarkMap() {
  const ready = bakedTexture('autumn.maple-bark', 'maple-bark-relief', { repeat: true, linear: true });
  if (ready) return ready;
  if (barkMap) return barkMap;
  const stamp = generationStamp();
  const W=768,H=1024,w=W/2,h=H/2, rng=createRng(184762);
  const wrap=(x,n)=>((x%n)+n)%n;
  function lattice(cols,rows) {
    return {cols,rows, values:Float32Array.from({length:cols*rows*3},()=>rng.uniform(.09,.91))};
  }
  const warp=lattice(9,7), plates=lattice(14,5), scales=lattice(34,15), fiber=lattice(83,39);
  function noise(grid,u,v) {
    const x=Math.floor(u*grid.cols),y=Math.floor(v*grid.rows),a=u*grid.cols-x,b=v*grid.rows-y;
    const i=wrap(x,grid.cols),j=wrap(y,grid.rows),k=(i+1)%grid.cols,l=(j+1)%grid.rows;
    const s=a*a*(3-2*a),t=b*b*(3-2*b),v0=grid.values[3*(j*grid.cols+i)],v1=grid.values[3*(j*grid.cols+k)];
    const v2=grid.values[3*(l*grid.cols+i)],v3=grid.values[3*(l*grid.cols+k)];
    return (v0+(v1-v0)*s)*(1-t)+(v2+(v3-v2)*s)*t;
  }
  // Разность расстояний до ближайших центров образует ветвящиеся швы между пластинами.
  function fissure(grid,u,v) {
    const x=u*grid.cols,y=v*grid.rows,ix=Math.floor(x),iy=Math.floor(y);
    let one=9,two=9,tone=0, firstX=0,firstY=0,nextX=0,nextY=0;
    for(let j=iy-1;j<=iy+1;j++) for(let i=ix-1;i<=ix+1;i++) {
      const k=3*(wrap(j,grid.rows)*grid.cols+wrap(i,grid.cols));
      const dx=i+grid.values[k]-x,dy=j+grid.values[k+1]-y,d=dx*dx+dy*dy;
      if(d<one) {
        two=one; nextX=firstX; nextY=firstY; one=d; firstX=dx; firstY=dy; tone=grid.values[k+2];
      } else if(d<two) { two=d; nextX=dx; nextY=dy; }
    }
    const gap=Math.sqrt(two)-Math.sqrt(one);
    const across=Math.abs(firstX-nextX), along=Math.abs(firstY-nextY);
    const split=.27+.73*across/(.001+across+.42*along);
    return (1-split*(1-THREE.MathUtils.smoothstep(gap,.008,.31)))*(.80+.20*tone);
  }
  const heights=new Float32Array(w*h), pigments=new Float32Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const u=x/w,v=y/h, broad=noise(warp,u,v), q=u+.041*(broad-.5)+.01*Math.sin(TAU*(2*v+u));
    const long=fissure(plates,q,v+.055*(noise(warp,u+.35,v+.3)-.5));
    const mid=fissure(scales,q+.011*Math.sin(TAU*(3*v-u)),v+.025*(broad-.5));
    const small=noise(fiber,q,v), k=y*w+x;
    heights[k]=.53*long+.23*mid+.075*small+.10*broad;
    pigments[k]=.18+.45*long+.18*mid+.15*broad+.04*small;
  }
  const data=new Uint8Array(W*H*4);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const i=x>>1,j=y>>1,k=j*w+i,r=j*w+(i+1)%w,d=((j+1)%h)*w+i;
    const dr=((j+1)%h)*w+(i+1)%w,tx=(x&1)*.5,ty=(y&1)*.5;
    const dx=(heights[r]-heights[k])*(1-ty)+(heights[dr]-heights[d])*ty;
    const dy=(heights[d]-heights[k])*(1-tx)+(heights[dr]-heights[r])*tx;
    const u=x/W,v=y/H,fine=noise(fiber,u+.002*Math.sin(TAU*7*v),v);
    const hair=Math.sin(TAU*(92*u+3*v+1.55*fine+.53*noise(warp,u,v)));
    const nx=-dx*w/.54*.0062+.070*hair,ny=-dy*h/.68*.0062+.022*(fine-.5),inv=1/Math.hypot(nx,ny,1);
    const gain=(1-tx)*(1-ty)*pigments[k]+tx*(1-ty)*pigments[r]+ty*((1-tx)*pigments[d]+tx*pigments[dr]);
    const out=4*(y*W+x);
    data[out]=Math.round(255*THREE.MathUtils.clamp(gain+.030*hair,0,1));
    data[out+1]=Math.round(127.5*(1+nx*inv));data[out+2]=Math.round(127.5*(1+ny*inv));data[out+3]=255;
  }
  barkMap=new THREE.DataTexture(data,W,H,THREE.RGBAFormat);
  barkMap.name='maple-bark-relief'; barkMap.wrapS=barkMap.wrapT=THREE.RepeatWrapping;
  barkMap.magFilter=THREE.LinearFilter;barkMap.minFilter=THREE.LinearMipmapLinearFilter;
  barkMap.generateMipmaps=true;barkMap.needsUpdate=true;
  finishGeneration(stamp);
  return barkMap;
}

function paintedLeaf(value, variant) {
  const key = value*2 + variant;
  if (leafMasters.has(key)) return leafMasters.get(key);
  const master = document.createElement('canvas');
  master.width = master.height = 192;
  const ctx = master.getContext('2d'), unit = master.width / 2.30;
  const gray = v => { const g = Math.round(Math.min(245,Math.max(30,v))); return `rgb(${g},${g},${g})`; };
  ctx.translate(unit*1.15,unit*1.15); ctx.scale(unit,unit);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-.058,-.98); ctx.quadraticCurveTo(-.012,-.77,0,-.48);
  ctx.lineWidth = .048; ctx.strokeStyle = gray(.65*value); ctx.stroke();
  ctx.lineWidth = .022; ctx.strokeStyle = gray(1.15*value); ctx.stroke();
  const blade = new Path2D();
  blade.moveTo(0,-.55);
  for (const [u,v] of LEFT) blade.lineTo(u,v);
  for (const [u,v] of RIGHT) blade.lineTo(u,v);
  blade.closePath();
  ctx.save(); ctx.clip(blade);
  const fold = ctx.createLinearGradient(-.87,-.10,.90,.09);
  for (const [t,gain] of [[0,.74],[.16,.94],[.32,1.09],[.455,1.14],[.50,1.00],[.54,.84],[.71,.97],[.88,1.04],[1,.77]]) {
    fold.addColorStop(t,gray(gain*value));
  }
  ctx.fillStyle = fold; ctx.fillRect(-1.1,-1.1,2.2,2.25);
  const rng = createRng(8361+753*variant);
  // Пятна пигмента имеют размер промежутка между двумя жилками. Кромка подсыхает первой.
  for (let i=0;i<19;i++) {
    const x=rng.uniform(-.85,.85), y=rng.uniform(-.46,.90), r=rng.uniform(.09,.30);
    const pigment=ctx.createRadialGradient(x,y,0,x,y,r);
    pigment.addColorStop(0,i%3===0?'rgba(39,39,39,.24)':'rgba(237,237,237,.20)');
    pigment.addColorStop(1,i%3===0?'rgba(39,39,39,0)':'rgba(237,237,237,0)');
    ctx.fillStyle=pigment;ctx.fillRect(x-r,y-r,2*r,2*r);
  }
  ctx.strokeStyle=gray(.72*value);ctx.lineWidth=.036;ctx.globalAlpha=.69;ctx.stroke(blade);ctx.globalAlpha=1;
  // Каждая боковая жила выходит из главной по касательной, разветвляется к зубцам
  // и сужается до острия. Тень и светлая сторона центральных жил выражают их рельеф.
  function vein(ax,ay,bx,by,cx,cy,width,tone) {
    const dx=cx-ax, dy=cy-ay, length=Math.hypot(dx,dy), px=-dy/length, py=dx/length;
    ctx.beginPath();ctx.moveTo(ax+px*width,ay+py*width);
    ctx.quadraticCurveTo(bx+px*width*.55,by+py*width*.55,cx,cy);
    ctx.quadraticCurveTo(bx-px*width*.45,by-py*width*.45,ax-px*width,ay-py*width);
    ctx.closePath();ctx.fillStyle=gray(tone);ctx.fill();
  }
  for (const [ex,ey] of [[.015,1.02],[-.74,.71],[.77,.69],[-.94,.06],[.89,.09],[-.46,-.47],[.47,-.46]]) {
    const dx=ex,dy=ey+.49, len=Math.hypot(dx,dy), nx=-dy/len,ny=dx/len;
    const elbow=.038*(ex<0?1:-1), mx=ex*.49+nx*elbow,my=-.49+dy*.49+ny*elbow;
    for (let j=0;j<4;j++) {
      const t=.24+.17*j, omt=1-t;
      const ax=2*omt*t*mx+t*t*ex,ay=omt*omt*(-.49)+2*omt*t*my+t*t*ey;
      for (const sign of [-1,1]) {
        const spread=len*(.145-.022*j)*(sign===1?1:.83), reach=len*(.19-.018*j);
        const bx=ax+dx/len*reach+nx*sign*spread,by=ay+dy/len*reach+ny*sign*spread;
        const hx=ax+(bx-ax)*.45+dx*.022, hy=ay+(by-ay)*.45+dy*.022;
        vein(ax,ay,hx,hy,bx,by,.012*(1-.12*j),value+31);
        vein(hx,hy,hx+(bx-hx)*.35+dx*.02,hy+(by-hy)*.35+dy*.02,
          hx+(bx-hx)*.74+dx*.041,hy+(by-hy)*.74+dy*.041,.0065,value+17);
      }
    }
    const w=.025*(.64+.36*len);
    vein(0,-.49,mx+nx*.011,my+ny*.011,ex,ey,w*1.17,.79*value);
    vein(-.004,-.49,mx-nx*.006,my-ny*.006,ex,ey,w*.72,value+46);
  }
  ctx.restore();
  leafMasters.set(key,master);
  return master;
}

function paintLeaf(ctx,x,y,size,angle,value) {
  const tone = THREE.MathUtils.clamp(Math.round(value/10)*10,70,190);
  const master = paintedLeaf(tone, (Math.round(x*5+y*3) & 1));
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);
  ctx.drawImage(master,-1.15*size,-1.15*size,2.30*size,2.30*size);
  ctx.restore();
}

/** Рисуется один раз на страницу. Верхняя левая ячейка плотно покрывает объём кроны,
 * ещё две — прозрачные кисти, последняя — серая кора с длинными трещинами и короткими чешуйками. */
export function mapleAtlas(lod = 0) {
  if (lod === 2) return distantAtlas();
  const ready = bakedTexture('autumn.maple-leaves', 'maple-leaves', { anisotropy: 4 });
  if (ready) return ready;
  if (atlas) return atlas;
  const stamp = generationStamp();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CELL * 2 * ART_SCALE;
  const ctx = canvas.getContext('2d'), rng = createRng(48313);
  ctx.scale(ART_SCALE, ART_SCALE);
  for (let cell = 0; cell < 4; cell++) {
    const x0 = (cell % 2) * CELL, y0 = (cell >> 1) * CELL;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, CELL, CELL); ctx.clip(); ctx.translate(x0, y0);
    if (cell === 0) {
      // Нахлёст двух слоёв: в глубине более мелкие и тёмные листья; рядом остаются небольшие просветы.
      for (let layer = 0; layer < 2; layer++) {
        const step = layer ? 0.90 * CELL / 15 : CELL / 17;
        for (let row = -1; row <= CELL / step + 1; row++) for (let col = -1; col <= CELL / step + 1; col++) {
          const x = (col + 0.5 * (row & 1) + rng.uniform(-0.35, 0.35)) * step, y = (row + rng.uniform(-0.37, 0.37)) * step;
          const sun = 0.5 + 0.5 * Math.sin(col * 0.74 + 0.66 * Math.sin(row * 0.92) + 0.37 * row);
          paintLeaf(ctx, x, y, rng.uniform(0.68, 1.0) * step, rng.uniform(-2.9, 2.9), Math.round((layer ? 121 : 81) + 43 * sun + rng.uniform(-12, 13)));
        }
      }
    } else if (cell === 3) {
      ctx.fillStyle = '#adadad'; ctx.fillRect(0, 0, CELL, CELL);
      for (let i = 0; i < 250; i++) {
        const x = rng.uniform(0, CELL), y = rng.uniform(-45, CELL), h = rng.uniform(8, 60), lean = rng.uniform(-4, 4);
        const lum = rng.int(70, 157);
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + lean - 2, y + h * 0.35, x + lean + 3, y + h * 0.67, x + lean, y + h);
        ctx.strokeStyle = `rgb(${lum},${lum},${lum})`; ctx.lineWidth = rng.uniform(0.8, 2.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 2, y + 3); ctx.quadraticCurveTo(x + lean + 1, y + h * 0.4, x + lean + 3, y + h * 0.6);
        ctx.strokeStyle = '#c3c3c3'; ctx.lineWidth = 1.2; ctx.stroke();
      }
    } else {
      // Супротивные пары на выгнутом побеге. Между наружными листьями видны черешки и воздух.
      const turn = rng.uniform(-0.12, 0.12);
      ctx.lineCap = 'round'; ctx.lineWidth = 2.0; ctx.strokeStyle = '#787878';
      ctx.beginPath(); ctx.moveTo(129, 239); ctx.quadraticCurveTo(119, 139, 129 + turn * 90, 48); ctx.stroke();
      for (let j = 0; j < 4; j++) for (const sign of [-1, 1]) {
        const stemY = 207 - 43 * j + rng.uniform(-6, 6), stemX = 122 + 23 * turn * j;
        const dx = sign * (58 - 7 * j) + rng.uniform(-7, 7), dy = -18 + rng.uniform(-10, 6);
        ctx.beginPath(); ctx.moveTo(stemX, stemY); ctx.quadraticCurveTo(stemX + dx * 0.55, stemY + 1, stemX + dx, stemY + dy); ctx.stroke();
        for (let k = 0; k < 2; k++) {
          const a = (sign < 0 ? 1 : -1) * (k ? 1.72 : 2.75) + rng.uniform(-0.30, 0.30);
          const s = rng.uniform(27, 39) * (1 - 0.035 * j);
          const r = k ? 1 : 0.46;
          paintLeaf(ctx, stemX + dx * r - Math.sin(a) * 0.55 * s, stemY + dy * r + Math.cos(a) * 0.55 * s, s, a,
            Math.round(123 + 18 * k + 5 * j + rng.uniform(-24, 26)));
        }
      }
      paintLeaf(ctx, 128 + turn * 90, 44, 32, 3.12 + turn, 175);
    }
    ctx.restore();
  }
  // Узкая свободная область слева от текстурного шва коры — отдельный лист для самых концов побегов.
  ctx.clearRect(CELL, CELL, SINGLE, SINGLE);
  paintLeaf(ctx, CELL + SINGLE/2, CELL + SINGLE/2 + 1, 28.6, Math.PI, 158);
  leafMasters.clear();
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.name = 'maple-leaves'; atlas.anisotropy = 4;
  finishGeneration(stamp);
  return atlas;
}

// Малые кисти и углубления между ветвями запекаются один раз в развёртку всего полога.
// От каждого текселя луч доходит до локальной поверхности; общий свет и цвет посадки остаются динамическими.
function distantAtlas() {
  const ready = bakedTexture('autumn.maple-canopies', 'maple-canopies', {});
  if (ready) return ready;
  if (farAtlas) return farAtlas;
  const stamp = generationStamp();
  const source = mapleAtlas().image, canvas = document.createElement('canvas');
  canvas.width = 2 * FAR_W; canvas.height = 2 * FAR_H;
  const ctx = canvas.getContext('2d');
  const srcCell = source.width/2;
  ctx.drawImage(source, srcCell + 72*ART_SCALE, srcCell, srcCell - 72*ART_SCALE, srcCell, FAR_W, FAR_H, FAR_W, FAR_H);
  ctx.drawImage(source, 0, 0, srcCell, srcCell, 0, 0, CELL, CELL);
  const leaf = ctx.getImageData(0, 0, CELL, CELL).data;
  const tile = ctx.createImageData(FAR_W, FAR_H);
  for (let v = 0; v < 2; v++) {
    const lobes = canopy(v), phase = lobes[0].a;
    const longitude = Array.from({ length: FAR_W }, (_, i) => {
      const a = phase + TAU * (i + 0.5 - PAD) / (FAR_W - 2 * PAD);
      return [Math.cos(a), Math.sin(a)];
    });
    for (let j = 0; j < FAR_H; j++) {
      const t = THREE.MathUtils.clamp((j + 0.5 - PAD) / (FAR_H - 2 * PAD), 0, 1);
      const lat = (0.5 - t) * Math.PI, ny = POLAR_SCALE * Math.sin(lat), r = Math.cos(lat);
      for (let i = 0; i < FAR_W; i++) {
        const nx = longitude[i][0] * r, nz = longitude[i][1] * r;
        const f = canopyPoint(lobes, nx, ny, nz);
        const dx = P.x - f.center.x, dy = P.y - f.center.y, dz = P.z - f.center.z;
        N.set(dx * f.ix, dy * f.iy, dz * f.iz).normalize();
        const side = Math.abs(N.y) < 0.65;
        const u = side ? dz * Math.cos(f.a) - dx * Math.sin(f.a) : dx;
        const s = Math.round(0.5 * CELL + 0.22 * CELL * u / f.width) & (CELL - 1);
        const k = Math.round(0.5 * CELL - 0.22 * CELL * (side ? dy : dz) / f.width) & (CELL - 1);
        const pixel = 4 * (k * CELL + s), dst = 4 * (j * FAR_W + i);
        // Собственное затенение доли. Под нависающей соседней кистью видимая доля неба мала.
        const facing = Math.max(0, nx * N.x + ny * N.y + nz * N.z);
        const relief = (0.89 + 0.15 * facing + 0.22 * N.y + 0.075 * Math.sin(8*u+5*dy+f.phase)) * (0.86 + 0.14 * canopySeam);
        const grain = leaf[pixel + 3] > 90 ? leaf[pixel] : 96;
        const value = (138 + 1.22 * (grain - 138)) * relief;
        tile.data[dst] = tile.data[dst + 1] = value;
        // Синий канал хранит стадию, когда здесь откроется просвет между соседними кистями.
        const edge = THREE.MathUtils.clamp(0.5 + (grain - 139) / 92, 0, 1);
        // Между удалёнными ветвями остаются достаточно широкие для mip-фильтра просветы.
        const breakUp = Math.sin(8*u + 5*dy + f.phase) + 0.5*Math.sin(13*dy - 4*dz);
        const open = canopySeam < 0.09 && breakUp > 0.42;
        const threshold = open ? 0 : Math.min(1, 0.40 + 0.42 * f.rank + 0.19 * edge + 0.09 * canopySeam);
        tile.data[dst + 2] = Math.round(255 * THREE.ColorManagement.workingToColorSpace(C.setRGB(threshold, threshold, threshold), THREE.SRGBColorSpace).b);
        tile.data[dst + 3] = 255;
      }
    }
    ctx.putImageData(tile, v * FAR_W, 0);
  }
  farAtlas = new THREE.CanvasTexture(canvas);
  farAtlas.name = 'maple-canopies'; farAtlas.colorSpace = THREE.SRGBColorSpace;
  finishGeneration(stamp);
  return farAtlas;
}

// Кисти продолжают живые веточки. Первая выходит из конца прошлогоднего
// прироста, две боковые сидят ниже на том же побеге и расходятся к свету.
function leafFans(b, f, lod, targets, rng) {
  const close = lod === 0, count = close ? 22 : 9;
  const n = f.shoots.length, outward = point(Math.cos(f.a),0,Math.sin(f.a));
  for (let j = 0; j < count; j++) {
    const shoot = j%n, fork = Math.floor(j/n), [from,end] = f.shoots[shoot];
    const phase = f.phase+shoot*2.17, side = fork===0 ? 0 : fork%2 ? -1 : 1;
    const root = from.clone().lerp(end,fork===0 ? .85 : .20+.28*Math.cos(phase+fork));
    const axis = end.clone().sub(from).normalize();
    const yaw = Math.atan2(axis.z+.46*outward.z,axis.x+.46*outward.x)
      +side*(.48+.19*Math.sin(phase))+.18*Math.sin(phase+fork);
    const inner = shoot===1 || shoot===2 || shoot===4 || shoot===5;
    const lift = shoot===0 && f.tier ? .74 : .16+.36*axis.y+.36*Math.sin(phase)-(inner ? .35 : .23)*fork;
    axis.set(Math.cos(yaw),lift,Math.sin(yaw)).normalize();
    const right = point(-Math.sin(yaw),0,Math.cos(yaw)).applyAxisAngle(axis,.28*side+(inner ? 1.0 : .73)*Math.sin(phase+1.54*fork));
    const facing = point(0,0,0).crossVectors(right,axis).normalize();
    const cell = 1+j%2;
    const rect = [(cell%2)*CELL+BORDER,(cell>>1)*CELL+BORDER,CELL-2*BORDER,CELL-2*BORDER];
    const start = b.count, halfLength=f.width*((inner ? .59 : .49)+.09*Math.cos(phase)+.04*Math.sin(fork));
    const halfWidth=halfLength*(close ? .66 : .86)*(inner ? 1.22 : 1)*(1+.12*Math.sin(phase+fork));
    const extent=(1.86*Math.max(0,axis.y)*halfLength+Math.abs(right.y)*halfWidth+.25*halfWidth);
    const fit=Math.max(.16,Math.min(1,(4.25-root.y)/Math.max(.01,extent),
      (2.39-Math.hypot(root.x,.78*(root.y-2.3),1.13*root.z))/Math.hypot(1.86*halfLength,halfWidth)));
    const length=halfLength*fit, width=halfWidth*fit, centre=root.clone().addScaledVector(axis,.86*length);
    const light=.89+.16*(root.y-2)+.07*Math.cos(phase);
    leafSurface(b,centre,right,axis.clone().negate(),facing,width,length,
      f.hue+rng.uniform(-.08,.08),light,rect,close ? 2 : 1,close ? .26 : 0,close && j%2===0 ? 2 : 1);
    seasonalPart(b.pos,Array.from({length:b.count-start},(_,k)=>start+k),f.center,f.rank,true,j,targets,f.shoots,f.mid);
    if (close && j%3===0) {
      // На наружной веточке видны две отдельные супротивные пластинки.
      const node = centre.clone().addScaledVector(axis,.76*length);
      for (const sign of [-1,1]) {
        const leafAxis = right.clone().multiplyScalar(sign).addScaledVector(axis,.48);
        leafAxis.y -= .34; leafAxis.normalize();
        const across = point(-leafAxis.z,0,leafAxis.x).normalize().applyAxisAngle(leafAxis,.62*sign);
        const face = point(0,0,0).crossVectors(across,leafAxis).normalize();
        const w = Math.min(.085+.024*(1+Math.sin(j+f.phase+sign)),
          (2.59-Math.hypot(node.x,node.y-2.3,node.z))/2.5), startLeaf = b.count;
        leafSurface(b,node.clone().addScaledVector(leafAxis,w),across,leafAxis.negate(),face,w,w*1.1,
          f.hue+.07*sign,1.03+.09*sign,[CELL+2,CELL+2,SINGLE-4,SINGLE-4],2,.21);
        seasonalPart(b.pos,Array.from({length:b.count-startLeaf},(_,k)=>startLeaf+k),f.center,f.rank,true,j+sign,targets,f.shoots);
      }
    }
  }
}

// На ближнем уровне средняя жилка чуть приподнята, боковые половины отогнуты
// назад, а край повёрнут вдоль побега. Нормаль меняется по производным самой поверхности.
function leafSurface(b, centre, right, axis, facing, width, height, hue, light, rect, segments, fold, rows = segments) {
  const start = b.count, twist = fold * 0.45, sag = fold * 0.65;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= segments; i++) {
    const tx = i/segments, ty = j/rows, x = 2*tx - 1, y = 2*ty - 1;
    const depth = fold*(1-x*x) + twist*x*y - sag*y*y;
    P.copy(centre).addScaledVector(right, width*x).addScaledVector(axis, height*y).addScaledVector(facing,width*depth);
    N.copy(facing).addScaledVector(right,2*fold*x-twist*y).addScaledVector(axis,(2*sag*y-twist*x)*width/height).normalize();
    const u = (rect[0]+tx*rect[2])/(2*CELL), v = 1 - (rect[1]+ty*rect[3])/(2*CELL);
    b.push(P, N, u, v, leafColor(hue, light*(0.98 + 0.045*y)), flexAt(centre.y), 1, (1-y)*height*0.40);
    if (i && j) {
      const hi = b.count-1, left = hi-1, low = hi-segments-1;
      b.idx.push(low-1, low, hi, low-1, hi, left);
    }
  }
}

function terminalLeaves(b, f, targets, rng) {
  const rect = [CELL+1,CELL+1,SINGLE-2,SINGLE-2];
  for (let i = 0; i < f.shoots.length; i++) {
    const [from,end] = f.shoots[i], angle = f.a + 2.39*i + rng.uniform(-.35,.35);
    const count = i % 3 === 0 ? 2 : 1;
    for (let leaf=0; leaf<count; leaf++) {
      const stem=from.clone().lerp(end, leaf ? .88 : rng.uniform(.28,.72));
      const az=angle+leaf*2.43, hanging=leaf || (i%4===2);
      const axis=point(Math.cos(az), hanging ? rng.uniform(-2.7,-1.4) : rng.uniform(-.62,.44),Math.sin(az)).normalize();
      const right=point(-axis.z,0,axis.x).normalize().applyAxisAngle(axis,rng.uniform(-1.18,1.16));
      const facing=point(0,0,0).crossVectors(right,axis).normalize();
      // Черешки супротивной пары выходят из разных сторон побега.
      const w=rng.uniform(.051,.086), h=1.10*w, centre=stem.clone().addScaledVector(axis,h);
      const start=b.count;
      leafSurface(b,centre,right,axis.clone().negate(),facing.clone().negate(),w,h,
        f.hue+rng.uniform(-.11,.11),rng.uniform(1.04,1.22),rect,2,rng.uniform(.15,.32));
      for(let j=start;j<b.count;j++) {
        const retain=i%3===0 ? .88 : .22+.27*f.rank, k=3*j;
        targets.push((stem.x-b.pos[k])*(1-retain),(stem.y-b.pos[k+1])*(1-retain),(stem.z-b.pos[k+2])*(1-retain),f.rank);
      }
    }
  }
}

// Масса под листьями уменьшается вокруг конца своей ветви. Из отдельных наружных кистей
// часть опадает полностью, остальные сохраняют листовые пластинки на коротких побегах.
function seasonalPart(positions, vertices, anchor, rank, card, ordinal, targets, shoots = null, mid = false) {
  const cx = anchor.x, cy = anchor.y, cz = anchor.z;
  let x = 0, y = 0, z = 0;
  if (card) {
    for (const i of vertices) { x += positions[3*i]; y += positions[3*i+1]; z += positions[3*i+2]; }
    x = x / vertices.length - cx; y = y / vertices.length - cy; z = z / vertices.length - cz;
  }
  const scatter = (ordinal * 0.61803399 + rank) % 1;
  const inner = shoots ? 0 : 0.04 + 0.38 * rank * rank;
  const remnant = card ? Math.max(0, scatter - 0.36) * (0.64 + 0.65 * rank) * (mid ? 1.68 : shoots ? 0.74 : 1) : inner;
  const extension = card ? 0.30 + 0.48 * rank : 0;
  let tx = x * extension, ty = y * extension, tz = z * extension;
  if (card && shoots) {
    // Сохранившаяся группа листьев держится у ближайшей живой веточки.
    const center = point(cx+x, cy+y, cz+z);
    let nearest = Infinity;
    for (const [base, end] of shoots) {
      N.subVectors(end, base);
      const along = THREE.MathUtils.clamp(P.subVectors(center, base).dot(N) / N.lengthSq(), 0.08, 0.98);
      P.copy(base).addScaledVector(N, along);
      const d = center.distanceToSquared(P);
      if (d < nearest) { nearest = d; tx = P.x-cx; ty = P.y-cy; tz = P.z-cz; }
    }
  }
  for (const i of vertices) {
    const dst = 4*i, src = 3*i;
    targets[dst] = (cx - positions[src]) * (1 - remnant) + tx - x * remnant;
    targets[dst+1] = (cy - positions[src+1]) * (1 - remnant) + ty - y * remnant;
    targets[dst+2] = (cz - positions[src+2]) * (1 - remnant) + tz - z * remnant;
    targets[dst+3] = shoots ? rank * (card ? 0.80 : 0.54) : rank;
  }
}

// У широколиственной соседки клёна берём авторские координаты ветвей. По связным
// участкам исходной сетки целая листовая пластинка всегда сходит к одной и той же ветви.
export function prepareAutumnBroadleaf(g, variant) {
  if (g.attributes.aAutumnTarget) return g;
  const stamp = generationStamp();
  const { position, aTint } = g.attributes, vertices = position.count;
  const parents = Int32Array.from({ length: vertices }, (_, i) => i);
  function root(i) {
    while (i !== parents[i]) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  }
  for (let j = 0; j < g.index.count; j += 3) {
    const a = g.index.getX(j);
    if (!aTint.getX(a)) continue;
    const base = root(a);
    parents[root(g.index.getX(j+1))] = base; parents[root(g.index.getX(j+2))] = base;
  }
  const components = new Map();
  for (let i = 0; i < vertices; i++) if (aTint.getX(i)) {
    const key = root(i);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(i);
  }
  const descriptor = FLORA.trees[variant].lobes;
  const scale = 4.02 / Math.max(...descriptor.map(q => q[1] + q[3]));
  const centers = descriptor.map(([x,y,z]) => point(x*scale, y*scale, z*scale));
  const targets = new Float32Array(4*vertices);
  for (const [key, part] of components) {
    const mean = point(0,0,0);
    for (const i of part) mean.add(P.fromBufferAttribute(position, i));
    mean.multiplyScalar(1 / part.length);
    let best = 0;
    for (let j = 1; j < centers.length; j++) if (mean.distanceToSquared(centers[j]) < mean.distanceToSquared(centers[best])) best = j;
    seasonalPart(position.array, part, centers[best], ((best * 7 + 1) % centers.length) / (centers.length - 1), !!g.attributes.aTip && part.some(i => g.attributes.aTip.getX(i) > 0), key, targets);
  }
  g.setAttribute('aAutumnTarget', new THREE.BufferAttribute(targets, 4));
  finishGeneration(stamp);
  return g;
}

export function mapleGeometry(variant = 0, lod = 0) {
  const key = 'maple:' + variant + ':L' + lod;
  if (lod === 0) {
    const baked = bakedModel('autumn.maple-models', key);
    if (baked) return baked;
  }
  if (cache.has(key)) return cache.get(key);
  const start = performance.now(), b = new VegetationBuilder(true), design = branches(variant);
  if(lod<2) { b.barkCoords=[]; b.collar=[]; }
  if(lod===0) b.seamNormals=new Set();
  const woodBudget = skeleton(b, design, lod, variant);
  if(lod===0) smoothSockets(b);
  const targets = Array(b.count * 4).fill(0);
  if (lod === 2) distantCrown(b, variant, targets);
  else for (const f of design) {
    const rng = createRng(Math.round(f.phase * 10000));
    leafFans(b, f, lod, targets, rng);
    if (lod === 0) terminalLeaves(b, f, targets, rng);
  }
  const g = b.build(key, { kind: 'tree', variant, lod, ...woodBudget });
  if (b.barkCoords) {
    const data=new Float32Array(4*b.count);
    for(let i=0;i<b.barkCoords.length/3;i++) {
      data[4*i]=b.barkCoords[3*i]; data[4*i+1]=b.barkCoords[3*i+1]; data[4*i+2]=b.barkCoords[3*i+2];
      data[4*i+3]=b.collar[i] ?? 0;
    }
    g.setAttribute('aMapleBark',new THREE.BufferAttribute(data,4));
  }
  g.setAttribute('aAutumnTarget', new THREE.Float32BufferAttribute(targets, 4));
  VEG_GEN.ms += performance.now() - start;
  cache.set(key, g);
  return g;
}
