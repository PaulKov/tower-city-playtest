// Городские посадки используют те же проекты, ветви и атлас, что и парк в меню.
// Плоскости листьев разворачиваются по поверхности кроны один раз при сборке.
import * as THREE from 'three';
import { bakedModel } from './baked.js';
import { createRng } from '../../core/rng.js';
import { FLORA } from '../menu/floraData.js';
import { treeGeometry, rockGeometry } from '../menu/menuFlora.js';
import { VegetationBuilder } from './geometry.js';
import { VEG_GEN } from './atlas.js';
import { spruceGeometry } from './spruce.js';
import { KINDS } from './kinds.js';

// Стороны и продольные сегменты ствола, корней и ветвей. Форма осей и развилки общая для всех расстояний.
const TREE_DETAIL = [
  { trunk: [16, 12, 6, 4, 8, 5], rootReach: 0.76, branchDetail: 1, cover: 0 },
  { rootReach: 0.76, branchDetail: 4, cover: 0 },
  { rootReach: 0.76, branchDetail: 5, cover: 0 },
];
const cache = new Map();
const pos = new THREE.Vector3(), normal = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
const radial = new THREE.Vector3();
// Атлас содержит три отдельных побега с прозрачными просветами между листьями.
const SHOOTS = [FLORA.rects.sprayA, FLORA.rects.sprayB, FLORA.rects.sprayC];
// Верх, низ и левая/правая границы двух строк. Запас в девять текселей
// вокруг альфы сохраняет фильтрацию краёв со средней дистанции.
const SHOOT_BOUNDS = [
  [0.055,0.976,0.000,0.128,0.796,0.998], [0.055,0.964,0.128,0.001,1.000,0.991],
  [0.055,0.986,0.011,0.104,0.917,1.000],
];
const color = new THREE.Color(), white = new THREE.Color(1, 1, 1);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));
const gray = (v) => color.setRGB(v, v, v);
const bend = (y, height) => clamp(y / height, 0, 1);

/** Перенос сетки меню в одно поле с городским материалом. Кора и камень сохраняют цвет модели.
 * Цвет крон и глубину просветов задают светлота вершины и палитра экземпляра. */
function appendMenu(b, g, kind, scale = 1, trimTree = false) {
  const { position, normal: normals, color: colors, uv, aCorner, aRot, aLift, aDome } = g.attributes;
  const base = b.count, k = KINDS[kind];
  for (let i = 0; i < position.count; i++) {
    pos.fromBufferAttribute(position, i);
    normal.fromBufferAttribute(normals, i);
    color.fromBufferAttribute(colors, i);
    let u = uv.getX(i), v = uv.getY(i);
    const card = u >= 0 && kind !== 'rock';
    const flex = kind === 'rock' ? 0 : bend(scale * pos.y, k.h);
    let tip = 0;
    if (card) {
      right.set(normal.z, 0, -normal.x);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      up.crossVectors(normal, right);
      const x = aCorner.getX(i), y = aCorner.getY(i);
      const a = aRot.getX(i), c = Math.cos(a), s = Math.sin(a);
      pos.addScaledVector(right, c * x - s * y).addScaledVector(up, s * x + c * y).addScaledVector(normal, 0.42 * aLift.getX(i));
      if (aDome.getW(i) > 0) {
        radial.set(aDome.getX(i), aDome.getY(i), aDome.getZ(i)).sub(pos).normalize().negate();
        normal.lerp(radial, 0.8).normalize();
      }
      tip = y < 0 ? -2 * y * scale : 0;
      if (aCorner.getX(i) > 0 && aCorner.getY(i) > 0) b.cards++;
    } else if (kind === 'tree') {
      // Отрицательная область UV зарезервирована для коры. Окружность и дуга
      // следуют местной оси ветви вплоть до самого тонкого прироста.
      u = -2 - aCorner.getX(i);
      v = aCorner.getY(i);
      // Положительное aTip принадлежит листьям. На древесине тот же канал
      // хранит молодость побега, а отдельное значение отмечает ствол с рубцом.
      const youth = aRot.getX(i);
      tip = youth < 0 ? -2 : -youth;
      // Широкие волокна вдоль ствола и ветвей, по их местной нормали. Рисунок остаётся на коре при облёте.
      const angle = Math.atan2(normal.z, normal.x), grain = Math.cos(3 * angle + 0.85 * pos.y);
      color.multiplyScalar(0.95 + 0.13 * grain);
    }
    pos.multiplyScalar(scale);
    if (card) gray(0.21*color.r+0.72*color.g+0.07*color.b);
    b.push(pos, normal, u, v, color, flex, card ? 1 : 0, tip);
  }
  for (let i = 0; i < g.index.count; i += 3) {
    const a = g.index.getX(i), d = g.index.getX(i + 1), e = g.index.getX(i + 2);
    if (trimTree && uv.getX(a) < 0) {
      // Последнее кольцо каждой ветви сходится в точку. Удаляем половину
      // треугольников этого кольца, у которых совпадают концы.
      pos.fromBufferAttribute(position, a);
      right.fromBufferAttribute(position, d).sub(pos);
      up.fromBufferAttribute(position, e).sub(pos);
      if (right.cross(up).lengthSq() < 1e-12) continue;
    }
    b.idx.push(base + a, base + d, base + e);
  }
  g.dispose();
}

// Прикреплённая пластинка или облиственный побег. Поворот вокруг черешка
// открывает оборотную сторону, средняя жилка задаёт поперечную складку.
function bladeStrip(b, root, axis, across, length, width, rect, light, curved, fold, bounds = null) {
  const start = b.count, steps = curved ? 2 : 1;
  const face = new THREE.Vector3().crossVectors(across, axis).normalize();
  if (face.y < 0) face.negate();
  for (let row = 0; row <= steps; row++) {
    const t = bounds ? bounds[row] : row/steps;
    for (let col = 0; col <= steps; col++) {
      const u = bounds ? bounds[2+col*2+row] : col/steps;
      const side = 2*u-1;
      pos.copy(root).addScaledVector(axis,t*length).addScaledVector(across,side*width);
      pos.y -= length*t*(curved ? t : 1)*0.24;
      if (curved) pos.addScaledVector(face, width*fold*(1-Math.abs(side))*Math.sin(Math.PI*(0.14+0.72*t)));
      radial.set(pos.x*0.56,(pos.y-1.8)*0.68,pos.z*0.56).normalize();
      normal.copy(radial).multiplyScalar(0.60).addScaledVector(face,0.58).addScaledVector(across,side*fold*0.5).normalize();
      b.push(pos,normal,rect[0]+u*(rect[2]-rect[0]),rect[3]+t*(rect[1]-rect[3]),
        gray(light*(0.87+0.13*t+0.04*side)),bend(pos.y,KINDS.tree.h),1,row===steps ? 0.26*length : 0);
      if (row && col) {
        const i = b.count-1, prev = i-steps-1;
        b.idx.push(prev-1,prev,i-1, i-1,prev,i);
      }
    }
  }
  b.cards++;
}

// Последнее сечение каждого сука сходится к одной вершине. В этих точках
// древесина переходит в облиственный прирост, в том числе при осеннем поредении.
export function broadleafTips(model, scale = 1) {
  const {position,aTint} = model.attributes;
  const {start,count} = model.userData.branchIndices ?? {start:0,count:model.index.count};
  const tips = [];
  let previous=-1;
  for (let k=start+3; k<start+count; k+=3) {
    const tip=model.index.getX(k+2);
    if (aTint?.getX(tip)) break;
    if (tip===previous || tip!==model.index.getX(k-1) || model.index.getX(k)!==model.index.getX(k-2)) continue;
    tips.push(new THREE.Vector3().fromBufferAttribute(position,tip).multiplyScalar(scale));
    previous=tip;
  }
  return tips;
}

// Три концевых прироста: продолжение сука и два неодинаковых боковых ответвления.
// Остальные кисти сидят вдоль этих трёх осей. Общий рисунок сохраняется вдали.
function leafyBoughs(b, design, scale, lod, variant, tips) {
  const count = [17,6,3][lod], root = new THREE.Vector3(), axis = new THREE.Vector3(), across = new THREE.Vector3();
  const leader = variant%2 ? -.52 : .57;
  for (let i = 0; i < design.lobes.length; i++) {
    const [x, y, z, radius, sprite, tone] = design.lobes[i], r = radius*scale;
    const y0=y*scale, crown=THREE.MathUtils.smoothstep(y0,2.15,3.45);
    const bearing=Math.atan2(z*scale+.18*crown,x*scale+leader*crown)+.32*Math.sin(i*1.97);
    const centre=new THREE.Vector3(x*scale+leader*crown,y0+.17*Math.sin(i*2.26),z*scale+.22*crown);
    const outward=new THREE.Vector3(Math.cos(bearing),0,Math.sin(bearing));
    const side=new THREE.Vector3(-outward.z,0,outward.x);
    const target=centre.clone().addScaledVector(outward,.56*r);
    target.y+=r*(.42+.30*crown+.16*Math.cos(i));
    const seat=centre.clone().addScaledVector(outward,-.43*r); seat.y-=.44*r;
    let nearest=tips[0];
    for (const tip of tips) if (tip.distanceToSquared(seat)<nearest.distanceToSquared(seat)) nearest=tip;
    const main=target.clone().sub(nearest);
    const stems=[];
    for (let k=0; k<3; k++) {
      const fork=k===0 ? 0 : k===1 ? -1.04 : .95, along=k===0 ? 0 : k===1 ? .19 : .48;
      const anchor=nearest.clone().addScaledVector(main,along);
      anchor.y-=.16*along*main.length();
      const shoot=main.clone().multiplyScalar(1-along).addScaledVector(side,fork*r);
      if(k===1) shoot.addScaledVector(outward,-.36*r);
      shoot.y+=k===1 ? -.57*r : k===2 ? .27*r : 0;
      stems.push({anchor,shoot});
    }
    for (let j = 0; j < count; j++) {
      const {anchor,shoot}=stems[j%3], twig=Math.floor(j/3);
      const along=twig ? (lod===1 ? .57 : .21+.15*(twig-1))+.068*Math.sin(i+j) : 0;
      root.copy(anchor).addScaledVector(shoot,along);
      root.y-=.16*along*shoot.length();
      axis.copy(shoot).normalize();
      if (twig) {
        const turn=(twig%2 ? -1 : 1)*(.82+.41*Math.sin(i+j*1.76));
        axis.multiplyScalar(.70).addScaledVector(side,turn);
        axis.addScaledVector(outward,twig%3===1 ? -.42 : .18);
        axis.y+=.60*Math.cos(i+1.7*j)-.34; axis.normalize();
      }
      across.set(-axis.z,0,axis.x).normalize().applyAxisAngle(axis,1.12*Math.sin(i*2.24+j*1.38));
      const length=twig ? r*(.98+.14*Math.cos(i+j)) : Math.max(.58*r,shoot.length())*1.08;
      const width=r*[.47,.63,.76][lod]*(twig ? .90 : 1)*(1+.16*Math.sin(i+3*j));
      const light=(.71+.18*tone+.08*crown)*(1+.14*Math.sin(i+2.3*j));
      const tile = (sprite+j)%3;
      const fan = lod === 2 && (j+i)%3 !== 0;
      bladeStrip(b,root,axis,across,length,width,fan ? FLORA.rects.branchFan : SHOOTS[tile],light,lod===0,0.24,
        lod && !fan ? SHOOT_BOUNDS[tile] : null);
      if (lod===0 && j%3===0) {
        root.addScaledVector(axis,0.93*length); root.y -= 0.21*length;
        axis.applyAxisAngle(across,0.78*Math.sin(i+j)-0.24);
        bladeStrip(b,root,axis,across,0.32*r,0.14*r,FLORA.rects.leafBlade,light*1.06,true,0.38);
      }
    }
  }
}

function tree(b, variant, lod) {
  const design = FLORA.trees[variant];
  const top = Math.max(...design.lobes.map(l => l[1]+l[3])), scale = 4.02/top;
  const model = treeGeometry(variant, 1, TREE_DETAIL[lod]);
  const tips = broadleafTips(model, scale);
  if (lod === 0) b.branchIndices = model.userData.branchIndices;
  appendMenu(b, model, 'tree', scale, lod > 0);
  leafyBoughs(b, design, scale, lod, variant, tips);
}

// Куст имеет общее разветвлённое основание. Стриженый ряд сохраняет длинные бока,
// но концы, плечи и верх закругляются вокруг отдельных групп побегов.
const TAU = 2*Math.PI;
function shrubPoint(p, u, v, hedge, variant) {
  const a=u*TAU, lat=(v-.5)*Math.PI, ring=Math.cos(lat), h=Math.sin(lat);
  if (!hedge) {
    const arms=.5+.5*Math.cos(3*a+1.40*v+.7*variant);
    const hollow=.5+.5*Math.sin(5*a+4*v+variant)*Math.cos(5*v-1.3*a);
    const swell=.62+.46*arms+.084*Math.sin(5*a-2.7*v+variant)+.07*hollow;
    const shoulder=ring*Math.exp(-((v-.72)**2)/.052);
    const rise=(.13*Math.sin(a+.7)-.08)*ring+(.48*arms-.18)*shoulder;
    const skirt=.13*ring*(1-v)*(.75+.25*Math.cos(2*a+variant));
    return p.set((variant ? .70 : .77)*ring*swell*Math.cos(a)+.13*v*v,
      Math.max(.025,.04+(.70-.07*variant)*(.5+.49*h+rise*v)-skirt),
      (.57+.06*variant)*ring*swell*Math.sin(a)-.08*v*v);
  }
  // Два прямых участка и две полукруглые оконечности, равные шаги по длине ряда.
  const radius=.32, straight=1.78, arc=Math.PI*radius, total=2*(straight+arc);
  const shift=u+.5*straight/total;
  let d=(shift-Math.floor(shift))*total, x, nx, nz;
  if (d<straight) { x=straight*.5-d; nx=0; nz=1; }
  else if ((d-=straight)<arc) { x=-straight*.5; nx=-Math.sin(d/radius); nz=Math.cos(d/radius); }
  else if ((d-=arc)<straight) { x=d-straight*.5; nx=0; nz=-1; }
  else { d-=straight; x=straight*.5; nx=Math.sin(d/radius); nz=-Math.cos(d/radius); }
  const skirt=.83*(1-THREE.MathUtils.smoothstep(v,0,.39));
  const side=radius*Math.max(skirt,ring**.47)*(1+.09*Math.sin(6*x+1.7*nz)+.045*Math.sin(10*x+3*v));
  const height=.70+.031*Math.sin(4.9*x+.52*nz*ring)+.018*Math.cos(8.3*x-1.3*nz*ring);
  return p.set(1.10*x+nx*side*.68,-.010+height*(.5+.5*h),nz*side+.012*ring*Math.sin(3.9*x));
}

function shrub(b, variant, lod, hedge) {
  const sides=(hedge ? [22,18,12] : [23,16,14])[lod], bands=[hedge ? 5 : 6,hedge ? 4 : 5,4][lod];
  const height=hedge ? KINDS.hedge.h : KINDS.bush.h;
  const point=new THREE.Vector3(), du=new THREE.Vector3(), dv=new THREE.Vector3(), tmp=new THREE.Vector3();
  const sample=(p,u,v) => shrubPoint(p,u,v,hedge,variant);
  const surface=(u,v) => {
    sample(point,u,v);
    sample(du,u+.001,v).sub(sample(tmp,u-.001,v)).normalize();
    sample(dv,u,v+.001).sub(sample(tmp,u,v-.001)).normalize();
    normal.crossVectors(dv,du).normalize();
  };
  const flex=y=>.48*bend(y,height);
  const row=sides+1, shell=[];
  for(let j=0;j<=bands;j++) for(let i=0;i<=sides;i++){
    const u=i/sides,v=j/bands;
    surface(u,clamp(v,.003,.997));
    sample(point,u,v);
    const canopy=.5+.5*Math.sin(u*TAU*(hedge ? 5 : 3)+1.6*v);
    // Экран объёма лежит в глубине под побегами. Разрывы между листочками открывают тень ветвей.
    const pocket=(hedge ? .013 : .020) + (hedge ? .012 : .022)*(1-canopy);
    point.addScaledVector(normal,-pocket*Math.sin(Math.PI*v)**.65);
    const light=.32+.26*v+.18*canopy;
    color.setRGB(light*(.75+.12*canopy),light,light*(1.38+.28*(1-canopy)));
    shell.push({p:point.clone(),n:normal.clone(),c:color.clone()});
  }
  // Грани, ориентированные вверх, имеют горизонтальную, бока — вертикальную
  // проекцию. В точке схода сетки сохраняется физический размер листовой пластинки.
  const repeatsPerMetre=hedge ? 5.4 : 4.6, verts=new Map();
  for(let j=0;j<bands;j++) for(let i=0;i<sides;i++){
    const a=j*row+i, c=a+row, quad=[a,a+1,c,c+1];
    surface((i+.5)/sides,(j+.5)/bands);
    const top=Math.abs(normal.y),x=Math.abs(normal.x),z=Math.abs(normal.z);
    const plane=top>Math.max(x,z) ? 1 : x>z ? 2 : 0;
    const at=quad.map(k=>{
      const key=k*3+plane;
      if(verts.has(key)) return verts.get(key);
      const {p,n,c}=shell[k], index=b.count;
      const s=plane===2 ? p.z : p.x,t=plane===1 ? p.z : p.y;
      b.push(p,n,16+s*repeatsPerMetre,t*repeatsPerMetre,c,flex(p.y),1);
      verts.set(key,index);return index;
    });
    // На полюсах круглого куста нижняя или верхняя кромка сходится в точку.
    if(hedge || j>0) b.idx.push(at[0],at[2],at[1]);
    if(hedge || j<bands-1) b.idx.push(at[1],at[2],at[3]);
  }
  if(lod===2) return;
  const shoots=(hedge ? [195,55] : [155,52])[lod],rng=createRng((hedge ? 1697 : 891)+variant);
  const anchor=new THREE.Vector3(), axis=new THREE.Vector3(), width=new THREE.Vector3(), facing=new THREE.Vector3();
  for(let i=0;i<shoots;i++){
    const u=(i*.61803399+.11*rng.next())%1;
    const v=.15+.79*(i+rng.next())/shoots;
    surface(u,v);
    const tilt=rng.uniform(-.87,.87);
    axis.copy(dv).multiplyScalar(Math.cos(tilt)).addScaledVector(du,Math.sin(tilt));
    axis.addScaledVector(normal,rng.uniform(.08,.36)).normalize();
    width.crossVectors(axis,normal).normalize();
    const size=(hedge ? .190 : .244)*rng.uniform(.76,1.14)*(lod ? 1.44 : 1);
    // Верхушечный прирост идёт вдоль стрижки, нижний не уходит под землю.
    const headroom=Math.max(.004,Math.min(height-point.y,point.y));
    const liftY=Math.max(.01, .63*Math.abs(axis.y)+.43*Math.abs(width.y)+.16*Math.abs(normal.y));
    const span=Math.min(size,headroom/liftY);
    const half=span*rng.uniform(.38,.53), lift=span*rng.uniform(.025,.10);
    anchor.copy(point).addScaledVector(axis,-.54*span).addScaledVector(normal,.006*rng.next());
    // Верхний контур стрижки следует высоте самой секции у этого побега.
    const topY=hedge ? sample(tmp,u,.998).y+.012 : height;
    const index=i%3,rect=SHOOTS[index],base=b.count;
    for(let row=0;row<2;row++) for(let col=0;col<2;col++){
      const t=row, x=col,side=2*x-1;
      pos.copy(anchor).addScaledVector(axis,span*t).addScaledVector(width,side*half)
        .addScaledVector(normal,lift*(.3+1.6*t+.55*side));
      pos.y=clamp(pos.y,.008,topY);
      facing.copy(normal).addScaledVector(width,side*.19).addScaledVector(axis,.10).normalize();
      const young=.5+.5*Math.sin(u*TAU*(hedge ? 5 : 3)+v+1.6*i);
      const tone=(.53+.16*v+.20*young)*(.83+.17*t);
      color.setRGB(tone*(.78+.27*young),tone,tone*(1.65-.42*young));
      b.push(pos,facing,rect[0]+x*(rect[2]-rect[0]),rect[3]+t*(rect[1]-rect[3]),
        color,flex(pos.y),1,row*.10*span);
    }
    b.idx.push(base,base+1,base+2,base+2,base+1,base+3);b.cards++;
    if(lod===0 && i%(hedge ? 11 : 16)===0){
      // На периферии куста две небольшие супротивные пластинки. Изгиб и
      // средняя жилка сформированы вершинами, углы плоскости срезаны по силуэту.
      const leaf=FLORA.rects.leafBlade;
      for(const sign of [-1,1]){
        const tip=b.count, length=(hedge ? .035 : .048)*(1+.17*Math.sin(i*2));
        facing.copy(axis).multiplyScalar(.64).addScaledVector(width,.76*sign).normalize();
        tmp.crossVectors(normal,facing).normalize();
        for(const [t,side,lift] of [[0,0,0],[.45,-1,.06],[.45,0,.19],[.45,1,.06],[1,0,-.10]]){
          pos.copy(anchor).addScaledVector(axis,span*(.76+.06*sign))
            .addScaledVector(normal,.08*span+length*lift).addScaledVector(facing,t*length).addScaledVector(tmp,side*.36*length);
          radial.copy(normal).addScaledVector(tmp,side*.27).normalize();
          const tone=.61+.16*v+.13*t;
          b.push(pos,radial,leaf[0]+(.5+.34*side)*(leaf[2]-leaf[0]),leaf[3]-(.10+.82*t)*(leaf[3]-leaf[1]),
            color.setRGB(tone*.89,tone,tone*1.21),flex(pos.y),1,t*.013);
        }
        b.idx.push(tip,tip+2,tip+1,tip,tip+3,tip+2,tip+1,tip+2,tip+4,tip+2,tip+3,tip+4);
      }
    }
  }
  // Нижние стебли расходятся от корневой шейки. Сквозь основание видны
  // короткие участки древесины, выше их закрывают наружные листья.
  if(lod===0) for(let i=0;i<(hedge ? 5 : 4);i++){
    const a=i*2.4+variant,base=b.count,foot=hedge ? (i-2)*.43 : .046*Math.cos(a);
    for(let row=0;row<2;row++) for(let k=0;k<3;k++){
      const r=row ? .015 : .026, angle=k*TAU/3;
      pos.set(foot+.27*row*Math.cos(a)+r*Math.cos(angle),row ? .26 : .006,
        (.03+.21*row)*Math.sin(a)+r*Math.sin(angle));
      normal.set(Math.cos(angle),.15,Math.sin(angle)).normalize();
      b.push(pos,normal,-1,-1,color.setRGB(.16,.096,.055),flex(pos.y),0);
    }
    for(let k=0;k<3;k++){const next=(k+1)%3;b.idx.push(base+k,base+k+3,base+next,base+next,base+k+3,base+next+3);}
  }
}

// Несколько плоскостей куртины/хвои закреплены в мире. Наклон куртин оставляет цветы видимыми сверху.
function sprig(b, rect, x, y, z, hw, height, angle, lean, tipLength) {
  const dx = Math.cos(angle), dz = Math.sin(angle), base = b.count;
  const [u0, v0, u1, v1] = rect;
  normal.set(-dz * 0.36, 0.93, dx * 0.36).normalize();
  for (const [side, h, u, v] of [[-1, 0, u0, v0], [1, 0, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) {
    pos.set(x + side * hw * dx - dz * h * lean, y + h * height, z + side * hw * dz + dx * h * lean);
    b.push(pos, normal, u, v, white, h, 1, h * tipLength);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  b.cards++;
}

function flowers(b, bed) {
  const n = bed ? 7 : 4;
  if (bed) {
    const soil = new THREE.Color('#79583e');
    b.solid(new THREE.SphereGeometry(0.62, 10, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.19, 1), () => soil, () => 0, 0);
  }
  for (let j = 0; j < n; j++) {
    const a = 2.4 * j, radius = (bed ? 0.40 : 0.25) * Math.sqrt(j / n);
    for (let i=0;i<3;i++) {
      const az=a+i*2.17+.21*Math.sin(j+2*i), spread=.049+.025*Math.sin(j+i);
      const height=(bed ? .35 : .36)*(.86+.13*Math.cos(2.3*j+i));
      sprig(b,FLORA.rects.daisy,Math.cos(a)*radius+spread*Math.cos(az),bed ? .08 : 0,
        Math.sin(a)*radius+spread*Math.sin(az),.20+.024*Math.sin(az),height,az,
        .12+.047*Math.cos(1.8*i+j),.05);
    }
  }
}

/** Общая неизменяемая геометрия: поле оборачивает её своим инстансным буфером растворения. */
export function cityFloraGeometry(kind, variant = 0, lod = 0, snow = false) {
  if (kind === 'pine') return spruceGeometry(variant, lod, snow);
  const key = `${kind}:${variant}:L${lod}`;
  if (kind === 'tree' && lod === 0) {
    const baked = bakedModel('flora.tree-models', 'cityFlora:' + key);
    if (baked) return baked;
  }
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now(), b = new VegetationBuilder(true);
  switch (kind) {
    case 'tree': tree(b, variant, lod); break;
    case 'bush': shrub(b, variant, lod, false); break;
    case 'hedge': shrub(b, variant, lod, true); break;
    case 'rock': appendMenu(b, rockGeometry(0, lod === 0 ? 24 : 12, lod === 0 ? 12 : 5, lod===0).translate(0, 0.16, 0), kind); break;
    case 'flowers': case 'bed': flowers(b, kind === 'bed'); break;
    default: throw new Error('Неизвестная модель растения: ' + kind);
  }
  const g = b.build('cityFlora:' + key, { kind, variant, lod });
  if (b.branchIndices) g.userData.branchIndices = b.branchIndices;
  VEG_GEN.ms += performance.now() - t0;
  cache.set(key, g);
  return g;
}
