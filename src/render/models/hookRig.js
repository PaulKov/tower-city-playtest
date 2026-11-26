// Нижняя подвеска крана. Размеры в метрах, начало координат — точка подвеса этажа.
import * as THREE from 'three';
import * as G from '../geomUtils.js';
import { finishGeometry, FORGED_STEEL, PROP_FINISH as F } from '../propFinishes.js';

const tau = 2 * Math.PI;
const metal = (g, color) => finishGeometry(G.colored(g, color), F.metal);
const V = (x,y,z=0) => new THREE.Vector3(x,y,z);

// Ось поковки и два радиуса сечения. Верх седла у x=0 равен 0,871 + 0,050 м.
const sections = [
  [0,1.254,.039,.032],[-.003,1.202,.040,.032],[-.025,1.145,.046,.035],
  [-.078,1.088,.050,.040],[-.113,1.019,.054,.042],[-.115,.960,.057,.041],
  [-.087,.903,.055,.039],[-.044,.880,.052,.037],[0,.871,.050,.034],
  [.044,.880,.044,.031],[.093,.909,.036,.025],[.127,.963,.028,.018],
  [.142,1.026,.016,.012],[.141,1.075,.0065,.0055],[.138,1.083,.001,.001],
];

export function forgedHook(near) {
  const path = new THREE.CatmullRomCurve3(sections.map(([x,y]) => V(x,y)));
  const radii = new THREE.CatmullRomCurve3(sections.map(([, ,r,d],i) => V(r,d,i*.04)));
  const rings = (sections.length-1)*(near ? 9 : 3), sides = near ? 48 : 16;
  const positions = [], tex = [], colors = [], indices = [];
  const center = V(0,0), tangent = V(0,0), radius = V(0,0);
  const dark = new THREE.Color('#70756e'), worn = new THREE.Color('#a3a599'), shade = new THREE.Color();
  for (let i=0; i<=rings; i++) {
    const t=i/rings;
    path.getPoint(t,center); path.getTangent(t,tangent); radii.getPoint(t,radius);
    for (let j=0; j<=sides; j++) {
      const a=tau*j/sides, c=Math.cos(a), s=Math.sin(a);
      // У наружной спинки поковки полнее щеки, у внутренней постели округлый профиль.
      const width = c < 0 ? 1.12 : 1;
      const across = c*radius.x*width;
      const land = Math.sin(Math.PI*t)**2 * Math.exp(-((c+.45)**2)/.065);
      positions.push(center.x-tangent.y*across, center.y+tangent.x*across, s*radius.y*(1-.15*c+.15*land));
      const bearing = Math.exp(-((t-.575)**2)/.009)*Math.max(0,c)**4;
      shade.copy(dark).lerp(worn,.12+.73*bearing+.09*s*s);
      colors.push(shade.r,shade.g,shade.b);
      tex.push(t,j/sides);
      if (i<rings && j<sides) {
        const k=i*(sides+1)+j;
        indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);
      }
    }
  }
  // Закрытый носок и торец шейки, без дыр в силуэте при взгляде сверху.
  for (let j=1; j<sides-1; j++) {
    const last=rings*(sides+1);
    indices.push(0,j+1,j,last,last+j,last+j+1);
  }
  const g=new THREE.BufferGeometry();
  g.setIndex(indices);
  for(const [name,values,n] of [['position',positions,3],['color',colors,3],['uv',tex,2]]) {
    g.setAttribute(name,new THREE.Float32BufferAttribute(values,n));
  }
  g.computeVertexNormals();
  const normal=g.attributes.normal;
  for (let i=0; i<=rings; i++) {
    const a=i*(sides+1), b=a+sides;
    tangent.fromBufferAttribute(normal,a); center.fromBufferAttribute(normal,b); tangent.add(center).normalize();
    normal.setXYZ(a,tangent.x,tangent.y,tangent.z); normal.setXYZ(b,tangent.x,tangent.y,tangent.z);
  }
  return finishGeometry(g,FORGED_STEEL);
}

// Плоскость звена развёрнута поперёк седла. Продольные ветви проходят снаружи щёк поковки.
const yaw = -.63, c = Math.cos(yaw), s = Math.sin(yaw);
const linkRadius = .085, stock = .0145, straight = .052;
// Поправка учитывает наклон звена к оси и кривизну постели по ширине поковки.
const linkTop = .921 + stock + .0016;
const linkBottom = linkTop - 2*linkRadius - straight;
// Внутренняя фаска и подъём нижней дуги по толщине пластины приходятся на верх отверстия.
const headY = linkBottom + stock - .024 + .004;
const pinY = headY-.082;
const onPlate = (x,y,z) => V(c*x+s*z,y,-s*x+c*z);

export function masterLink(near) {
  const outline = new THREE.CurvePath();
  const top = linkTop-linkRadius, bottom = top-straight;
  outline.add(new THREE.EllipseCurve(0,top,linkRadius,linkRadius,0,Math.PI));
  outline.add(new THREE.LineCurve(new THREE.Vector2(-linkRadius,top),new THREE.Vector2(-linkRadius,bottom)));
  outline.add(new THREE.EllipseCurve(0,bottom,linkRadius,linkRadius,Math.PI,tau));
  outline.add(new THREE.LineCurve(new THREE.Vector2(linkRadius,bottom),new THREE.Vector2(linkRadius,top)));
  const path = new THREE.Curve(), xy = new THREE.Vector2();
  path.getPoint = (t,out=new THREE.Vector3()) => {
    outline.getPoint(t,xy);
    return out.set(s*xy.x,xy.y,c*xy.x);
  };
  const g = new THREE.TubeGeometry(path,near?120:40,stock,near?24:12,true);
  return finishGeometry(G.colored(g,'#a9afa7'),FORGED_STEEL);
}

// В XY пластины. Каждый коуш удерживает свой участок пальца по одну сторону проушины.
const pins = [[-1,-1],[-1,1],[1,-1],[1,1]];
const anchors = pins.map(([side,face]) => {
  const pin = onPlate(side*.053,pinY,face*.027);
  const tail = onPlate(side*(.053+.047),pinY-.044,face*.027);
  const forward = tail.clone().sub(pin).normalize();
  return {side,face,pin,tail,exit:tail.clone().addScaledVector(forward,.041)};
});
export const slingEnds = anchors.map(({exit,side,face}) => ({root:exit, x:side, z:face}));

function extrude(shape, depth, bevel, near, color, curves=near?24:5) {
  const g=new THREE.ExtrudeGeometry(shape,{depth,steps:1,curveSegments:curves,
    bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:near?5:1});
  g.translate(0,0,-depth/2);
  return metal(g,color);
}

export function hookLatch(near) {
  const shape=new THREE.Shape();
  shape.moveTo(-.015,.006);
  shape.quadraticCurveTo(-.016,.024,.004,.023);
  shape.bezierCurveTo(.021,.024,.025,.008,.038,.001);
  shape.lineTo(.132,-.078); shape.quadraticCurveTo(.145,-.080,.142,-.091);
  shape.quadraticCurveTo(.137,-.099,.128,-.094);
  shape.lineTo(.029,-.018); shape.quadraticCurveTo(-.011,-.010,-.015,.006);
  const pivot=new THREE.Path(); pivot.absarc(.003,.007,.007,0,tau); shape.holes.push(pivot);
  const parts=[];
  for(const side of [-1,1]) {
    const arm=extrude(shape,.004,.0013,near,'#acada1');
    // Около оси щёки защёлки обхватывают шейку, к носку сходятся.
    const pos=arm.attributes.position;
    for(let i=0;i<pos.count;i++) pos.setZ(i,pos.getZ(i)+side*(.036-.031*THREE.MathUtils.smoothstep(pos.getX(i),.010,.137)));
    arm.computeVertexNormals(); parts.push(arm.translate(0,1.160,0));
  }
  const axle=G.cylinder(.009,.009,.084,near?32:14,'#626a68').rotateX(Math.PI/2).translate(.003,1.167,0);
  parts.push(finishGeometry(axle,F.metal));
  if (near) for(const side of [-1,1]) {
    const washer=G.cylinder(.013,.012,.004,32,'#86897f').rotateX(Math.PI/2);
    parts.push(finishGeometry(washer.translate(.003,1.167,side*.040),F.metal));
  }
  return parts;
}

export function rigHead(near) {
  const parts=[masterLink(near)];
  const shape=new THREE.Shape();
  shape.moveTo(-.017,.030);
  shape.quadraticCurveTo(0,.040,.017,.030);
  shape.bezierCurveTo(.038,.018,.028,-.010,.057,-.041);
  shape.quadraticCurveTo(.088,-.067,.078,-.089);
  shape.quadraticCurveTo(.072,-.106,.054,-.105);
  shape.quadraticCurveTo(0,-.092,-.054,-.105);
  shape.quadraticCurveTo(-.081,-.108,-.082,-.080);
  shape.bezierCurveTo(-.085,-.058,-.046,-.035,-.033,-.006);
  shape.quadraticCurveTo(-.033,.023,-.017,.030);
  for(const [x,y,r] of [[0,0,.024],[-.053,-.082,.0128],[.053,-.082,.0128]]) {
    const hole=new THREE.Path();hole.absarc(x,y,r,0,tau);shape.holes.push(hole);
  }
  const plate=extrude(shape,.021,.0022,near,'#767f7c',near?24:10);
  parts.push(plate.rotateY(yaw).translate(0,headY,0));
  for(const side of [-1,1]) {
    for(const [z,r,h,color] of [[0,.012,.091,'#999b92'],[-.048,.017,.006,'#717774'],[.048,.017,.006,'#717774']]) {
      const pin=G.cylinder(r,r,h,near?32:14,color).rotateX(Math.PI/2).rotateY(yaw);
      parts.push(finishGeometry(pin.translate(...onPlate(side*.053,pinY,z).toArray()),F.metal));
    }
  }
  for(const {side,face,pin,tail,exit} of anchors) {
    const points=[[.050,-.047],[.020,-.034],[-.009,-.024],[-.021,-.010],
      [-.019,.006],[-.006,.018],[.011,.016],[.021,.003],[.024,-.023],[.040,-.040],[.052,-.048]];
    const path=new THREE.CatmullRomCurve3(points.map(([x,y])=>onPlate(side*(.053+x),pin.y+y,face*.027)));
    parts.push(metal(new THREE.TubeGeometry(path,near?36:14,.0065,near?14:8,false),'#969b94'));
    const axis=exit.clone().sub(tail).normalize(), mid=exit.clone().lerp(tail,.50);
    const profile=[[.010,-.025],[.014,-.023],[.016,-.018],[.016,.015],[.014,.023],[.011,.025]];
    const sleeve=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),near?36:16);
    sleeve.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0,1),axis)).translate(mid.x,mid.y,mid.z);
    parts.push(metal(sleeve,'#a2a59e'));
  }
  return parts;
}
