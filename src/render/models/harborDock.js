// Дерево настила, окрашенный корпус, стекло, металл и канат используют общий материал с номером поверхности.
import * as THREE from 'three';
import * as G from '../geomUtils.js';
import { customMat } from '../materials.js';
import { assets } from '../../assets/index.js';
import { createRng } from '../../core/rng.js';
import { harborBoatGeometry } from './harborBoat.js';

const TAU = 2 * Math.PI;
const DECK_LENGTH = 4.78, DECK_WIDTH = 1.24, BOAT_Z = 1.48;

function timberTexture() {
  const w = 256, h = 256, rng = createRng(9251), data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / w * TAU, v = j / h * TAU;
    const warp = 0.047 * Math.sin(u + 2 * v) + 0.024 * Math.cos(3 * u - v);
    const knot = 0.18 * Math.exp(2.8 * (Math.cos(u + 2) - 1) + 6.9 * (Math.cos(v - 2.4) - 1));
    const grain = v + warp + knot, pore = Math.max(0, Math.cos(33 * grain + 0.3 * Math.sin(2 * u))) ** 6;
    const light = 0.83 + 0.065 * Math.cos(4 * grain) + 0.078 * Math.cos(11 * grain) - 0.15 * pore + rng.uniform(-0.048, 0.048);
    const k = (j * w + i) * 4;
    // G — спил. Отдельный канал усредняет годичные кольца в mip независимо от продольных волокон.
    const radial = Math.hypot((i/w-0.38)*0.95,j/h-0.58)+0.008*Math.sin(3*u+v);
    const rings = Math.pow(0.5+0.5*Math.cos(TAU*18*radial + 0.62*Math.sin(67*radial)),4);
    data[k] = Math.round(232 * light); data[k + 1] = Math.round(218-42*rings-8*knot+5*Math.cos(7*u-3*v)); data[k + 2] = Math.round(246 * light);
    data[k + 3] = Math.round(128 + 42 * Math.sin(33 * grain) + 22 * Math.sin(11 * grain));
  }
  const t = new THREE.DataTexture(data, w, h);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

export function harborMaterial(lite = false) {
  const timber = assets.tryGet('harbor.timber');
  return customMat('harbor:wood-paint-glass:' + (timber?.albedo.uuid ?? 'fallback') + ':' + lite, () => {
    const m = lite ? new THREE.MeshLambertMaterial({vertexColors:true}) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52 });
    const wood = { value: timberTexture() };
    m.onBeforeCompile = shader => {
      shader.uniforms.uHarborWood = wood;
      if (timber) {
        shader.uniforms.uDeckColor = { value: timber.albedo };
        shader.uniforms.uDeckNormal = { value: timber.normal };
        shader.uniforms.uDeckRough = { value: timber.roughness };
      }
      const vary = '\nvarying vec2 vCraftUv;\nvarying float vCraftLayer;\n';
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLayer;' + vary)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCraftLayer = aLayer; vCraftUv = uv;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>' + vary + 'uniform sampler2D uHarborWood, uDeckColor, uDeckNormal, uDeckRough;\n')
        .replace('#include <color_fragment>', `#include <color_fragment>
          bool wood = vCraftLayer > 0.5 && vCraftLayer < 1.5;
          bool decking = vCraftLayer > 4.5 && vCraftLayer < 5.5;
          bool satin = vCraftLayer > 5.5 && vCraftLayer < 6.5;
          bool sawn = vCraftLayer > 6.5;
          vec4 finish = vec4(1.0);
          if (sawn) {
            diffuseColor.rgb *= texture2D(uHarborWood,vCraftUv).g * vec3(1.02,0.96,0.89);
          } else if (decking) {
            #ifdef DECK_SCAN
              diffuseColor.rgb *= 0.18 + 2.05 * texture2D(uDeckColor, vCraftUv).rgb;
            #else
              diffuseColor.rgb *= texture2D(uHarborWood, vCraftUv * vec2(1.5,5.3)).r * vec3(1.14,1.17,1.21);
            #endif
          } else if (wood) {
            finish = texture2D(uHarborWood, vCraftUv * vec2(0.86, 1.40));
            diffuseColor.rgb *= finish.r * vec3(1.18,1.22,1.25);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          if (decking) {
            #ifdef DECK_SCAN
              roughnessFactor = 0.82 + 0.17 * texture2D(uDeckRough,vCraftUv).r;
            #else
              roughnessFactor = 0.94;
            #endif
          } else if (sawn) roughnessFactor = 0.93;
          else if (satin) roughnessFactor = 0.49 - 0.12 * diffuseColor.g;
          else if (wood) roughnessFactor = 0.64 + 0.20 * finish.a;
          else if (vCraftLayer > 1.5 && vCraftLayer < 2.5) roughnessFactor = 0.115;
          else if (vCraftLayer > 2.5 && vCraftLayer < 3.5) roughnessFactor = 0.24;
          else if (vCraftLayer > 3.5) roughnessFactor = 0.86;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          if (satin) metalnessFactor = 0.65;
          else if (vCraftLayer > 2.5 && vCraftLayer < 3.5) metalnessFactor = 0.70;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          #if defined(DECK_SCAN) && !defined(DECK_LITE)
            if (decking) {
              vec3 qx = dFdx(-vViewPosition), qy = dFdy(-vViewPosition);
              vec2 sx = dFdx(vCraftUv), sy = dFdy(vCraftUv);
              vec3 xAxis = cross(qy,normal)*sx.x + cross(normal,qx)*sy.x;
              vec3 yAxis = cross(qy,normal)*sx.y + cross(normal,qx)*sy.y;
              float inv = inversesqrt(max(max(dot(xAxis,xAxis),dot(yAxis,yAxis)),1.0e-12));
              vec2 emboss = (texture2D(uDeckNormal,vCraftUv).rg*2.0-1.0)*0.64;
              normal = normalize(normal + inv * (xAxis*emboss.x + yAxis*emboss.y));
            }
          #endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (vCraftLayer > 1.5 && vCraftLayer < 2.5) {
            vec3 reflected = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
            float sky = smoothstep(-0.12, 0.38, reflected.y);
            totalEmissiveRadiance += mix(vec3(0.006,0.014,0.017),vec3(0.065,0.13,0.16),sky);
          } else if (satin) {
            vec3 reflected = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
            float sky = smoothstep(-0.40, 0.70, reflected.y);
            totalEmissiveRadiance += diffuseColor.rgb * mix(vec3(0.035,0.045,0.044), vec3(0.20,0.24,0.27), sky);
          }`)
        .replace('#include <opaque_fragment>', `if (decking) outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse +
            0.19 * reflectedLight.directSpecular + 0.13 * reflectedLight.indirectSpecular;
          #include <opaque_fragment>`);
    };
    if (timber) m.defines = lite ? { DECK_SCAN: 1, DECK_LITE: 1 } : { DECK_SCAN: 1 };
    m.customProgramCacheKey = () => 'harbor-finishes';
    return m;
  });
}

function layer(g, id) {
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
  return g;
}

/** У доски волокна идут вдоль длинной оси в её собственных метрах, включая боковины и торцы. */
export function dockPlank(w, h, d, seed, near = true) {
  const rng = createRng(seed), brightness = rng.uniform(0.78, 1.08);
  const tint = new THREE.Color('#a59780').lerp(new THREE.Color('#86735f'),rng.uniform(0.08,0.71)).multiplyScalar(brightness);
  const g = near ? G.roundedBox(w, h, d, 0.013, 1, tint) : G.box(w, h, d, tint);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, offset = rng.next();
  // У каждой физической доски своя полоса исходного скана, без нарисованного шва посередине.
  const strip = [0.05,0.145,0.25,0.363,0.474,0.576,0.685,0.803,0.927][rng.int(0,8)];
  const width = Math.min(w,d), flip = rng.next() < 0.5 ? 1 : -1;
  const cutU = rng.uniform(0.36,0.64), cutV = rng.uniform(0.23,0.77);
  const cutScale = rng.uniform(0.48,0.67), slope = rng.uniform(-0.29,0.29);
  const layers=new Float32Array(p.count).fill(5);
  const pitch=i=>Math.abs(w>d?n.getX(i):n.getZ(i));
  for (let i = 0; i < p.count; i++) {
    const along = w > d ? p.getX(i) : p.getZ(i), across = w > d ? p.getZ(i) : p.getX(i);
    const edge = Math.abs(n.getY(i)) > 0.45 ? across : p.getY(i);
    // У скруглённого бокса независимые треугольники. Одна метка на всю грань
    // исключает интерполяцию через слой металла между продольной пластью и торцом.
    const face=i-i%3, end=g.index ? pitch(i)>0.999 : pitch(face)+pitch(face+1)+pitch(face+2)>2.72;
    if (end) {
      layers[i]=7; uv.setXY(i,cutU+cutScale*across/width,cutV+cutScale*(p.getY(i)+slope*across)/width);
    } else uv.setXY(i, along / 1.82 * flip + offset, strip + 0.077 * edge / width);
  }
  g.setAttribute('aLayer',new THREE.BufferAttribute(layers,1));
  return g;
}

/** Продольные волокна сваи, граница прилива и обтёртая верхняя кромка. */
export function dockPile(radius, height, waterline, seed) {
  const rng = createRng(seed), offset = rng.next(), bottom = -height/2, top = height/2;
  const ys = [bottom, waterline-0.09, waterline+0.04, waterline+0.16, top-0.016, top]
    .filter((y,i) => i===0 || i===5 || (y>bottom+0.012 && y<top-0.02)).sort((a,b)=>a-b);
  const profile = ys.map(y => new THREE.Vector2(radius * (1.04 - 0.08 * (y-bottom)/height) - (y===top?0.009:0),y));
  const g = new THREE.LatheGeometry(profile,24), p=g.attributes.position, uv=g.attributes.uv;
  const colors=[], dry=new THREE.Color('#998774'), wet=new THREE.Color('#555343'), c=new THREE.Color();
  for(let i=0;i<p.count;i++){
    const y=p.getY(i), a=uv.getX(i);
    c.copy(wet).lerp(dry, THREE.MathUtils.smoothstep(y-waterline-0.015*Math.sin(a*TAU*3),-0.025,0.17));
    c.multiplyScalar(0.89 + 0.11*Math.cos(a*TAU*4+offset));
    colors.push(c.r,c.g,c.b);
    uv.setXY(i,y/1.65+offset,0.785+0.075*a);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const cap=G.colored(new THREE.CircleGeometry(profile.at(-1).x,24).rotateX(-Math.PI/2).translate(0,top,0),dry);
  return G.mergeColored([layer(g,5),layer(cap,7)],{layer:true});
}

export function dockFastener(r=0.017) {
  return layer(G.cylinder(r,r*0.90,0.006,10,'#625f54'),3);
}

function line(points, r, color, id, detail = 12) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x,y,z]) => new THREE.Vector3(x,y,z)));
  return layer(G.colored(new THREE.TubeGeometry(curve, detail, r, 6, false), color), id);
}

const STEEL = '#a9b3af', COLLAR = '#939e9a', IRON = '#545c58';
const SATIN_METAL = 6;

function turned(profile, segments, color, id) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  return layer(G.colored(g, color), id);
}

// Труба согнута из одной заготовки. Нормаль поперечного сечения на стыке прямой и дуги совпадает.
function ladderRail(close) {
  const steps = close ? 48 : 12, sides = close ? 24 : 8;
  const positions = [], normals = [], indices = [], uvs = [];
  const bend = 0.215, r = 0.023;
  function ring(x, y, nx, ny, length) {
    const first = positions.length / 3;
    for (let i = 0; i < sides; i++) {
      const a = i * TAU / sides, ca = Math.cos(a), sa = Math.sin(a);
      positions.push(x + r * nx * ca, y + r * ny * ca, r * sa);
      normals.push(nx * ca, ny * ca, sa);
      uvs.push(length, a * r);
      if (first > 0) {
        const prev = first - sides + i, next = first - sides + (i + 1) % sides;
        indices.push(prev, first + i, next, next, first + i, next + sides);
      }
    }
  }
  ring(bend, -0.78, 1, 0, 0);
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI * i / steps, cs = Math.cos(a), sn = Math.sin(a);
    ring(bend * cs, 0.70 + bend * sn, cs, sn, 1.48 + bend * a);
  }
  ring(-bend, 0.397, -1, 0, 1.48 + Math.PI * bend + 0.303);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return layer(G.colored(g, STEEL), close ? SATIN_METAL : 3);
}

// Литая утка: шейка расширяется к пятке и рожкам, концы рожков закруглены и слегка подняты.
const cleats = [];
function mooringCleat(close) {
  const lod = close ? 0 : 1;
  if (cleats[lod]) return cleats[lod];
  const id = close ? SATIN_METAL : 3, segments = close ? 24 : 10;
  const base = turned(close
    ? [[0.073,0], [0.086,0.004], [0.087,0.012], [0.083,0.019], [0.071,0.022],
       [0.065,0.033], [0.053,0.061], [0.043,0.126], [0.045,0.151], [0.054,0.170], [0.065,0.179]]
    : [[0.084,0], [0.086,0.016], [0.063,0.033], [0.043,0.132], [0.064,0.179]], segments, IRON, id);
  base.scale(1.54, 1, 0.89);
  const p = [], n = [], uv = [], indices = [], normal = new THREE.Vector3();
  const slices = close ? 18 : 10, sides = close ? 16 : 8;
  const length = 0.193, ry = 0.042, rz = 0.051, lift = 0.043;
  for (let j = 0; j <= slices; j++) {
    const a = Math.PI * (j / slices - 0.5), s = Math.sin(a), c = Math.cos(a);
    for (let i = 0; i < sides; i++) {
      const t = i * TAU / sides, sn = Math.sin(t), cs = Math.cos(t);
      p.push(length * s, 0.184 + lift * s * s + ry * c * sn, rz * c * cs);
      normal.set(s * ry * rz - 2 * lift * s * c * rz * sn, length * c * rz * sn, length * c * ry * cs).normalize();
      n.push(normal.x, normal.y, normal.z);
      uv.push(s, t);
      if (j > 0) {
        const prev = (j - 1) * sides + i, next = (j - 1) * sides + (i + 1) % sides;
        if (j !== slices) indices.push(prev, prev + sides, next + sides);
        if (j !== 1) indices.push(prev, next + sides, next);
      }
    }
  }
  const horns = new THREE.BufferGeometry();
  horns.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  horns.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  horns.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  horns.setIndex(indices);
  const parts = [base, layer(G.colored(horns, '#626c65'), id)];
  if (close) for (const x of [-0.104, 0.104]) {
    const nut = G.cylinder(0.012, 0.014, 0.012, 6, '#737972');
    parts.push(layer(nut.translate(x, 0.024, 0), id));
  }
  return cleats[lod] = G.mergeColored(parts, { layer: true });
}

function ladder(parts, x, z, close) {
  const rail = ladderRail(close), id = close ? SATIN_METAL : 3;
  const inside = x - 0.215, outside = x + 0.215;
  for (const side of [-1, 1]) {
    const atZ = z + 0.23 * side;
    parts.push(rail.clone().translate(x, 0, atZ));
    const flange = turned(close
      ? [[0.066,0], [0.071,0.004], [0.072,0.009], [0.067,0.015], [0.047,0.018],
         [0.039,0.020], [0.032,0.027], [0.029,0.041], [0.024,0.043]]
      : [[0.07,0], [0.07,0.012], [0.031,0.023], [0.025,0.042]], close ? 36 : 12, COLLAR, id);
    parts.push(flange.translate(inside, 0.395, atZ));
    if (!close) continue;
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + 0.18;
      const px = inside + 0.054 * Math.cos(a), pz = atZ + 0.054 * Math.sin(a);
      parts.push(layer(G.cylinder(0.008, 0.010, 0.006, 8, '#808985').translate(px, 0.413, pz), id));
    }
    // Стойки опираются через втулки на продольный прогон под настилом.
    const beam = x - 0.15, y = 0.165;
    const pad = turned([[0.055,0], [0.057,0.006], [0.054,0.012], [0.028,0.016], [0.018,0.023]], 24, COLLAR, id);
    parts.push(pad.rotateZ(-Math.PI / 2).translate(beam, y, atZ));
    parts.push(layer(G.cylinder(0.013, 0.016, outside - beam, 16, STEEL)
      .rotateZ(-Math.PI / 2).translate((outside + beam) / 2, y, atZ), id));
    parts.push(turned([[0.024,0], [0.029,0.004], [0.029,0.027], [0.024,0.031]], 24, COLLAR, id)
      .translate(outside, y - 0.015, atZ));
    for (const dy of [-0.038, 0.038]) parts.push(layer(G.cylinder(0.008, 0.010, 0.007, 6, '#838b86')
      .rotateZ(-Math.PI / 2).translate(beam + 0.013, y + dy, atZ), id));
  }
  for (let k = 0; k < 4; k++) {
    const y = 0.225 - k * 0.262;
    const tread = turned(close
      ? [[0.52,-0.230], [0.62,-0.211], [0.90,-0.197], [1,-0.185], [1,0.185], [0.90,0.197], [0.62,0.211], [0.52,0.230]]
      : [[0.67,-0.230], [1,-0.18], [1,0.18], [0.67,0.230]], close ? 24 : 8, STEEL, id);
    parts.push(tread.scale(0.055, 1, 0.021).rotateX(Math.PI / 2).translate(outside, y, z));
    if (close) {
      // Сменная накладка сидит в верхней плоскости ступени, четыре продольных рифа выступают на 2 мм.
      parts.push(layer(G.roundedBox(0.077,0.010,0.366,0.004,1,'#515956').translate(outside, y + 0.019, z),4));
      for (const dx of [-0.026,-0.009,0.009,0.026]) parts.push(layer(G.roundedBox(0.006,0.004,0.35,0.0018,1,'#606862')
        .translate(outside + dx, y + 0.024, z),4));
    }
  }
}

/** Морской мол: отдельные доски лежат на двух прогонах, подкосы опираются на сваи. */
export function offshorePierGeometry(x, start, end, waterY, close) {
  const parts = [], head = dockFastener(), rng = createRng(64037);
  for (let z = start, i = 0; z > end; i++) {
    const pitch = Math.min(z-end, rng.uniform(0.27,0.32)), gap = Math.min(0.011,pitch/8);
    const center = z - pitch/2, y = 0.339 + rng.uniform(-0.003,0.003);
    parts.push(G.place(dockPlank(2.8-rng.uniform(0,0.014),0.12,pitch-gap,7483+i,close), {x,y,z:center}));
    if (close) for (const sign of [-1,1]) parts.push(G.place(head.clone(), {x:x+sign*1.10,y:y+0.060,z:center+sign*0.041}));
    z -= pitch;
  }
  for (const sign of [-1,1]) {
    parts.push(G.place(dockPlank(0.18,0.23,start-end,492,false), {x:x+sign*1.10,y:0.18,z:(start+end)/2}));
    for (let z = start-1, n=0; z>end; z-=3,n++) {
      const px = x+sign*1.25;
      parts.push(G.place(dockPile(0.145,2.2,waterY+0.7,720+n), {x:px,y:-0.70,z}));
      if (close) {
        const brace = dockPlank(0.095,0.105,0.88,832+n,false);
        parts.push(G.place(brace, {x:px-sign*0.072, y:-0.11, z:z+0.34, rx:-0.64}));
        parts.push(G.place(head.clone(), {x:px+sign*0.149, y:0.16, z, rz:-sign*Math.PI/2}));
      }
    }
    parts.push(G.place(mooringCleat(close).clone(), {x: x + sign * 1.08, y: 0.395, z: end + 0.55, ry: Math.PI / 2}));
  }
  ladder(parts, x + 1.34, end + 2.02, close);
  head.dispose();
  return G.mergeColored(parts, {layer:true});
}

/** Батч обоих причалов. У швартовов разные точки крепления на носу/корме и лёгкая провесь. */
function dockGeometry(sites, waterY, top, lod) {
  const all = [], near = lod === 0, boat = harborBoatGeometry(lod);
  for (const { x, z, yaw, offset } of sites) {
    const parts = [], step = 0.216;
    for (let i = 0; i < 22; i++) {
      const px = (i - 10.5) * step;
      parts.push(G.place(dockPlank(step - 0.007, 0.082, DECK_WIDTH, 1421 + i, near), { x: px, y: top - 0.041 }));
      if (near) for (const dz of [-0.48, 0.48]) {
        parts.push(G.place(layer(G.cylinder(0.012, 0.012, 0.003, 8, '#615e57'), 3), { x: px - 0.04, y: top + 0.001, z: dz }));
      }
    }
    for (const dz of [-0.47, 0.47]) {
      parts.push(G.place(dockPlank(DECK_LENGTH, 0.09, 0.12, 288, false), { y: top - 0.12, z: dz }));
    }
    for (const px of [-2.16, 0, 2.16]) for (const dz of [-0.52, 0.52]) {
      parts.push(G.place(dockPile(0.078,0.42,waterY-(top-0.19),610+Math.round(px*20+dz*10)), { x:px,y:top-0.19,z:dz }));
    }
    for (const px of [-1.08, 1.08]) {
      parts.push(G.place(mooringCleat(near).clone(), { x: px, y: top - 0.002, z: 0.41, s: 0.58 }));
    }
    const boatZ = BOAT_Z, sign = Math.cos(yaw);
    parts.push(G.place(boat.clone(), { x: offset, y: waterY, z: boatZ, ry: yaw }));
    for (const end of [-1, 1]) {
      const stern = end < 0, bx = offset + (stern ? -1.16 : 1.055) * sign;
      const bz = boatZ - (stern ? 0.205 : 0), cleat = end * 1.08 * sign;
      parts.push(line([[bx, waterY + (stern ? 0.304 : 0.411), bz],
        [(bx + cleat) / 2, top + 0.015, (bz + 0.41) / 2], [cleat, top + 0.102, 0.41]],
      near ? 0.008 : 0.010, '#716854', 4, near ? 14 : 5));
    }
    if (near) {
      const rope = [];
      for (let k=0; k<=70; k++) {
        const a = k * TAU / 17, r = 0.093 + 0.00074 * k;
        rope.push([-1.36 + Math.cos(a) * r, top + 0.009, 0.04 + Math.sin(a) * r * 0.76]);
      }
      parts.push(line(rope, 0.007, '#bcaa87', 4, 90));
    }
    for (const g of parts) all.push(g.translate(x, 0, z));
  }
  return G.mergeColored(all, { layer: true });
}

export const dockHalfLength = DECK_LENGTH / 2, dockHalfWidth = DECK_WIDTH / 2;

export function dockColliders(ground, site, waterY, top, deckGround = ground) {
  const { x, z, yaw, offset } = site;
  deckGround.box(x, z, dockHalfLength, dockHalfWidth, 0, top - 0.15, top);
  for (const px of [-1.08, 1.08]) ground.disc(x + px, z + 0.41, 0.08, top, top + 0.12);
  ground.box(x + offset, z + BOAT_Z, 1.12, 0.40, yaw, waterY, waterY + 0.36);
  ground.box(x + offset, z + BOAT_Z, 0.57, 0.31, yaw, waterY + 0.36, waterY + 0.85);
}

export function createHarborDock(sites, waterY, deckTop) {
  const levels = [dockGeometry(sites, waterY, deckTop, 0), dockGeometry(sites, waterY, deckTop, 1)];
  const mesh = new THREE.Mesh(levels[1], harborMaterial());
  mesh.name = 'cityHarbor'; mesh.receiveShadow = true;
  let current = 1, lowCost = false;
  return { mesh, setLite(on) { lowCost=on; mesh.material=harborMaterial(lowCost && current===1); }, update(camera) {
    if (!camera) return;
    const p = camera.position;
    let d2 = Infinity;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      d2 = Math.min(d2, (p.x-s.x)**2 + (p.y-waterY)**2 + (p.z-s.z)**2);
    }
    const next = d2 < (current === 0 ? 27**2 : 23**2) ? 0 : 1;
    if (current !== next) {
      mesh.geometry = levels[next]; current = next; mesh.material = harborMaterial(lowCost && next===1);
      mesh.castShadow = next===0; // вдали контакт корпуса с водой рисуется тем же проходом, что отражение
    }
  }, dispose() {
    // Текущую сетку освобождает cityMap вместе со статикой.
    levels[1 - current]?.dispose();
  } };
}
