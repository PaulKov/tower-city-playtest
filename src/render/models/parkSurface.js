// Покрытия городских участков с общей геометрией и материалом. UV — метры от центра
// участка, aLayer — вид покрытия. Профиль бордюрного камня задан в метрах.
import * as THREE from 'three';
import { assets } from '../../assets/index.js';
import { createRng, hashSeed } from '../../core/rng.js';
import { customMat, standard } from '../materials.js';
import { VEG_UNIFORMS } from '../vegetation/material.js';

export const SURFACE = { paving: 1, curb: 2, gravel: 3, lawn: 4, park: 5 };

export function surfaceUV(g, kind, cx = 0, cz = 0) {
  const p = g.attributes.position, uv = g.attributes.uv;
  const layers = new Float32Array(p.count).fill(kind);
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) - cx, p.getZ(i) - cz);
  g.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
  return g;
}

// За одно повторение (0,84 м) на отсыпке попадаются тысячи песчинок и редкие
// каменные сколы длиной 5–23 мм. RG — наклон, B — отражение. Альфа отдана
// травинкам: они используют тот же тексель в смешанной зоне грунта и газона.
let grit;
function aggregate() {
  if (grit) return grit;
  const n = 256, size = n * n, rng = createRng(29513);
  const h = new Float32Array(size), data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    h[i] = rng.next() * 0.24;
    data[i * 4 + 2] = 104 + rng.next() * 57;
    data[i * 4 + 3] = 87 + rng.next() * 29;
  }
  for (let k = 0; k < 7500; k++) {
    const x = rng.int(0, n - 1), y = rng.int(0, n - 1), a = rng.next() * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a), r = 0.55 + 3.35 * rng.next() ** 3;
    const b = r * rng.uniform(0.4, 0.83), shade = rng.uniform(69, 198);
    const bound = Math.ceil(r);
    for (let j = -bound; j <= bound; j++) for (let i = -bound; i <= bound; i++) {
      const along = (i * ca + j * sa) / r, side = (-i * sa + j * ca) / b;
      const shape = 1 - Math.abs(along) ** 1.4 - Math.abs(side) ** 1.6;
      if (shape < 0) continue;
      const at = ((y + j) & 255) * n + ((x + i) & 255);
      h[at] = 0.14 + Math.min(0.9, r * 0.3) * (0.5 + 0.5 * shape);
      data[at * 4 + 2] = shade + 17 * (along * 0.55 + shape);
    }
  }
  // Лежащие травинки расходятся из пазух по две-три, меняя толщину и
  // направление от основания к светлому кончику. У повторяемой границы нет шва.
  for (let tuft = 0; tuft < 2200; tuft++) {
    const x = rng.next() * n, y = rng.next() * n;
    const wind = 0.5 + 0.8 * Math.sin(2 * Math.PI * x / n) + 0.45 * Math.sin(4 * Math.PI * y / n);
    for (let blade = 0; blade < 3; blade++) {
      const a = wind + rng.uniform(-1.6, 1.6), dx = Math.cos(a), dy = Math.sin(a);
      const length = rng.uniform(6, 24), curve = rng.uniform(-0.47, 0.47), value = rng.uniform(66, 188);
      for (let step = 0; step <= length; step++) {
        const t = step / length, bend = step * t * curve;
        const i = Math.floor(x + dx * step - dy * bend), j = Math.floor(y + dy * step + dx * bend);
        const offset = (((j & 255) * n + (i & 255)) * 4) + 3;
        data[offset] = Math.round(value + 45 * t);
        if (t < 0.43) data[(((j & 255) * n + ((i + 1) & 255)) * 4) + 3] = value * 0.83;
      }
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const at = y * n + x;
    data[at * 4] = 128 + 97 * (h[y * n + ((x - 1) & 255)] - h[y * n + ((x + 1) & 255)]);
    data[at * 4 + 1] = 128 + 97 * (h[((y - 1) & 255) * n + x] - h[((y + 1) & 255) * n + x]);
  }
  grit = new THREE.DataTexture(data, n, n);
  grit.name = 'city:aggregate';
  grit.wrapS = grit.wrapT = THREE.RepeatWrapping;
  grit.generateMipmaps = true;
  grit.minFilter = THREE.LinearMipmapLinearFilter;
  grit.magFilter = THREE.LinearFilter;
  grit.needsUpdate = true;
  return grit;
}

const SURFACE_FS = /* glsl */`
uniform sampler2D uTurf;
uniform sampler2D uTurfNormal;
uniform sampler2D uPavers;
uniform sampler2D uPaverNormal;
uniform sampler2D uAggregate;
#ifdef SCANNED_SAND
uniform sampler2D uSandColor, uSandNormal, uSandRough;
vec3 sandySurface(vec2 world, float scale) {
  vec3 sand = texture2D(uSandColor, world / scale).rgb;
  return 0.16 + 1.58 * sand;
}
#endif
uniform vec3 uPathTint;
uniform float uSnow;
varying vec2 vSurfaceUV;
varying vec3 vSurfacePos;
varying float vSurface;
`;
const SHADE = /* glsl */`
vec2 plotRelief = vec2(0.0);
float sandMix = 0.0;
if (vSurface > 0.5) {
  if (vSurface < 1.5) {
    // Мелкая брусчатка, шов ≈ 9 см от шва. Соотношение сторон фототекстуры 2:1.
    vec2 st = vSurfacePos.xz * vec2(0.36, 0.72);
    diffuseColor.rgb *= 0.47 + 1.03 * texture2D(uPavers, st).rgb;
    #ifndef SURFACE_LITE
      plotRelief = (texture2D(uPaverNormal, st).rg - 0.5) * 0.44;
    #endif
  } else if (vSurface < 3.5) {
    vec4 grit = texture2D(uAggregate, vSurfaceUV / 0.84);
    float contrast = vSurface < 2.5 ? 0.48 : 0.94;
    diffuseColor.rgb *= 0.96 + (grit.b - 0.52) * contrast;
    diffuseColor.rgb *= mix(vec3(0.92, 0.98, 1.06), vec3(1.08, 1.01, 0.89), grit.b);
    plotRelief = (grit.rg - 0.5) * contrast * 0.55;
    #ifdef SCANNED_SAND
      if (vSurface > 2.5) {
        vec2 world = vSurfacePos.xz;
        diffuseColor.rgb *= sandySurface(world, 3.15);
        #ifndef SURFACE_LITE
          plotRelief = (texture2D(uSandNormal, world / 3.15).rg - 0.5) * 0.64;
          sandMix = 1.0;
        #endif
      }
    #endif
  } else {
    vec2 world = vSurfacePos.xz;
    vec2 st = world*0.43;
    float tussock = texture2D(uTurf,world*mix(0.093,0.06665,uSnow)+0.37).g;
    if (uSnow < 0.5) st = vec2(0.91*world.x+0.41*world.y,0.91*world.y-0.41*world.x)*0.82 + vec2(0.27,-0.19)*(tussock-0.46);
    float turf = texture2D(uTurf, st).g;
    vec4 grit = texture2D(uAggregate, vSurfacePos.xz / 0.84);
    float turfValue = uSnow > 0.5 ? (0.54 + turf * 0.57) : (0.20 + turf * 1.17);
    vec3 lawn = diffuseColor.rgb*turfValue*(0.83+tussock*0.28);
    // Сквозь тёмные междоузлия видна подстилка, на сухих полянках кончики теплее.
    float litter = (1.0-smoothstep(0.25,0.50,turf))*smoothstep(0.47,0.68,tussock);
    lawn *= mix(mix(vec3(0.89,0.98,0.87),vec3(1.16,0.94,0.77),clamp(0.26+litter,0.0,1.0)),vec3(1.0),uSnow);
    lawn *= 1.0 + (grit.a-0.51)*vec3(0.82,0.71,0.50)*(1.0-uSnow);
    diffuseColor.rgb = lawn;
    #ifndef SURFACE_LITE
      vec2 turfSlope = texture2D(uTurfNormal,st).rg-0.5;
      plotRelief = mix(vec2(0.91*turfSlope.x-0.41*turfSlope.y,0.41*turfSlope.x+0.91*turfSlope.y)*0.56,turfSlope*0.25,uSnow);
    #endif
    if (vSurface > 4.5) {
      // Земля проглядывает сперва между травинками; по оси дорожки крошка утоптана.
      float edge = min(abs(vSurfaceUV.x), abs(vSurfaceUV.y)) - 0.45;
      float irregular = edge + (turf - 0.48) * 0.13 + (tussock - 0.46) * 0.13;
      float sod = smoothstep(-0.034, 0.057, irregular);
      float verge = 1.0 - smoothstep(0.025, 0.135, abs(irregular));
      float stone = 0.97 + (grit.b - 0.51) * (1.05 + verge * 0.7);
      vec3 path = uPathTint * stone * mix(vec3(0.92, 0.98, 1.06), vec3(1.08, 1.01, 0.89), grit.b);
      vec2 pathRelief = (grit.rg - 0.5) * (0.27 + verge * 0.25);
      #ifdef SCANNED_SAND
        if (sod < 1.0) {
          path *= sandySurface(vSurfacePos.xz, 2.7);
          #ifndef SURFACE_LITE
            pathRelief = (texture2D(uSandNormal, vSurfacePos.xz / 2.7).rg - 0.5) * (0.40 + verge * 0.27);
            sandMix = 1.0-sod;
          #endif
        }
      #endif
      diffuseColor.rgb = mix(path, lawn, sod) * (1.0 - verge * mix(0.25, 0.10, uSnow));
      plotRelief = mix(pathRelief, plotRelief, sod);
    }
  }
}
`;

export function parkMaterial(theme, lite = false) {
  const turf = (theme.snow && assets.tryGet('ground.snow')) || assets.get('ground.grass');
  const pavers = assets.get('ground.tiles');
  const sand = !theme.snow && assets.tryGet('terrain.sand');
  return customMat(`city:surfaces:${theme.grass}:${turf.albedo.uuid}:${pavers.albedo.uuid}:${sand?.albedo?.uuid ?? ''}:${lite}`, () => {
    const options = { vertexColors: true, color: 0xffffff };
    const m = lite ? new THREE.MeshLambertMaterial(options) : standard({ ...options, roughness: 0.94, rim: false });
    const path = new THREE.Color(theme.lot).lerp(new THREE.Color(theme.snow ? '#b0c5d7' : '#aa9c86'), theme.snow ? 0.23 : 0.48);
    m.name = 'city:parkSurface';
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, {
        uTurf: { value: turf.albedo }, uTurfNormal: { value: turf.normal },
        uPavers: { value: pavers.albedo }, uPaverNormal: { value: pavers.normal },
        uAggregate: { value: aggregate() }, uPathTint: { value: path }, uSnow: { value: theme.snow ? 1 : 0 },
      });
      if (sand) Object.assign(s.uniforms, { uSandColor: { value: sand.albedo }, uSandNormal: { value: sand.normal }, uSandRough: { value: sand.roughness } });
      Object.assign(s.uniforms,{ uLawnTime:VEG_UNIFORMS.uTime, uLawnWind:VEG_UNIFORMS.uWind });
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLayer; varying vec2 vSurfaceUV; varying vec3 vSurfacePos; varying float vSurface; uniform float uLawnTime; uniform vec2 uLawnWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vSurface = aLayer; vSurfaceUV = uv; vSurfacePos = position;
          if (aLayer < -0.5) {
            float height = -1.0-aLayer;
            vec3 root = vec3(uv.x,position.y-height,uv.y);
            float distanceToEye = distance(cameraPosition,root);
            float detail = 1.0-smoothstep(11.0,28.0,distanceToEye);
            float gust = 0.66+0.34*sin(1.6*uLawnTime+dot(root.xz,vec2(0.61,0.39)));
            transformed.xz += uLawnWind*height*height*(1.45*gust);
            transformed = mix(root,transformed,detail);
          }`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + SURFACE_FS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + SHADE);
      if (!lite) s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(normal + mat3(viewMatrix) * vec3(plotRelief.x, 0., -plotRelief.y));');
      if (sand && !lite) s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (sandMix > 0.0) roughnessFactor = mix(roughnessFactor, 0.80 + 0.18 * texture2D(uSandRough,vSurfacePos.xz/(vSurface>4.5?2.7:3.15)).r, sandMix);`);
    };
    m.defines = { ...m.defines, ...(lite ? { SURFACE_LITE: 1 } : {}), ...(sand ? { SCANNED_SAND: 1 } : {}) };
    m.customProgramCacheKey = () => lite ? 'citySurfaceLite' : 'citySurface';
    return m;
  });
}

// Один профиль и индексный буфер для всей цепочки камней. Стыки с раствором
// между торцами и три пояса нормалей сохраняют округлую грань в боковом свете.
export function curbRun(cx, cz, length, height, width, outer, alongZ = false, far = false) {
  const count = Math.max(1, Math.round(length / 0.74));
  const rng = createRng(hashSeed(cx, cz, length)), pos = [], nor = [], color = [], uv = [], index = [];
  const stone = new THREE.Color('#c6bdad'), joint = 0.009;
  const point = (along, across, y, nx, ny, nz, shade) => {
    pos.push(cx + (alongZ ? -across : along), y, cz + (alongZ ? along : across));
    nor.push(alongZ ? -nz : nx, ny, alongZ ? nx : nz);
    color.push(stone.r * shade, stone.g * shade, stone.b * shade);
    uv.push(along + cx + cz, across + y);
  };
  const ring = (start, end, y, inset, ny, factor) => {
    const h = width / 2 - inset, side = Math.sqrt(1 - ny * ny);
    point(start + inset, -h, y, -side * 0.17, ny, -side * 0.985, factor);
    point(start + inset, h, y, -side * 0.17, ny, side * 0.985, factor);
    point(end - inset, h, y, side * 0.17, ny, side * 0.985, factor);
    point(end - inset, -h, y, side * 0.17, ny, -side * 0.985, factor);
  };
  let start = -length / 2;
  for (let k = 0; k < count; k++) {
    const end = -length / 2 + (k + 1) * length / count + (k + 1 === count ? 0 : rng.uniform(-0.045, 0.045));
    const a = start + joint / 2, b = end - joint / 2, top = height + rng.uniform(0.001, 0.004), shade = rng.uniform(0.84, 1.05);
    const first = pos.length / 3;
    if (far) {
      // Швы, длина, высота и тон каждого блока те же. На общем плане видны верх и уличный бок.
      const h = width / 2, z = outer * h, next = outer > 0 ? b : a, prev = outer > 0 ? a : b;
      const chamfer = far === 'street' ? 0.018 : 0;
      const lo = -h+(outer<0 ? chamfer : 0), hi = h-(outer>0 ? chamfer : 0);
      point(a, lo, top, 0, 1, 0, shade); point(a, hi, top, 0, 1, 0, shade);
      point(b, hi, top, 0, 1, 0, shade); point(b, lo, top, 0, 1, 0, shade);
      point(prev, z, 0.011, 0, 0, outer, shade * 0.60); point(next, z, 0.011, 0, 0, outer, shade * 0.60);
      point(prev, z, top-chamfer, 0, 0.34, outer * 0.94, shade * 0.94); point(next, z, top-chamfer, 0, 0.34, outer * 0.94, shade * 0.94);
      index.push(first, first+1, first+3, first+1, first+2, first+3,
        first+4, first+5, first+6, first+5, first+7, first+6);
      if(chamfer) {
        point(prev,z-outer*chamfer,top,0,0.82,outer*0.57,shade);point(next,z-outer*chamfer,top,0,0.82,outer*0.57,shade);
        index.push(first+6,first+7,first+8,first+7,first+9,first+8);
      }
      start = end;
      continue;
    }
    ring(a, b, 0.011, 0, 0, shade * 0.60);
    ring(a, b, top - 0.021, 0, 0.22, shade * 0.90);
    ring(a, b, top - 0.006, 0.008, 0.78, shade * 0.98);
    ring(a, b, top, 0.021, 1, shade);
    for (let band = 0; band < 3; band++) for (let j = 0; j < 4; j++) {
      // Низ уходит в постель; до основания дорожка открывает только уличный бок.
      if (band === 0 && j !== (outer > 0 ? 1 : 3)) continue;
      const s = first + band * 4, i = s + j, next = s + (j + 1) % 4;
      index.push(i, next, i + 4, next, next + 4, i + 4);
    }
    index.push(first + 12, first + 13, first + 15, first + 13, first + 14, first + 15);
    start = end;
  }
  const g = new THREE.BufferGeometry();
  for (const [key, values, n] of [['position', pos, 3], ['normal', nor, 3], ['uv', uv, 2], ['color', color, 3]])
    g.setAttribute(key, new THREE.Float32BufferAttribute(values, n));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(SURFACE.curb), 1));
  g.setIndex(index);
  return g;
}

/** Низкие скошенные листья у тропы и более высокие смешанные куртины на газоне. UV хранит точку кущения;
 * в aLayer ниже −1 записана высота листа для изгиба и перехода в фотофактуру на общем плане. */
export function parkBlades(cx, cz, y, tint) {
  const rng = createRng(hashSeed(cx,cz,'park:turf')), pos=[], colors=[], normals=[], roots=[], layers=[], indices=[];
  const base = new THREE.Color(tint), tip = new THREE.Color('#cbcc91');
  const low=0.475, high=2.76;
  // Отражаем край куртины внутри полосы газона. При обрезке координат стебли выстроились бы в линию вдоль тропы.
  const fold = (value) => value<low ? 2*low-value : value>high ? 2*high-value : value;
  for (let patch=0;patch<79;patch++) {
    const signX = rng.next()<0.5 ? -1 : 1, signZ = rng.next()<0.5 ? -1 : 1;
    const x = rng.uniform(low,high), z = rng.uniform(low,high);
    const common = rng.uniform(0,2*Math.PI), spread = rng.uniform(0.17,0.54), tall=rng.uniform(0.82,1.29);
    for(let shoot=0;shoot<6;shoot++) {
      const a = rng.uniform(0,2*Math.PI), reach=spread*Math.sqrt(rng.next());
      const u=fold(x+Math.cos(a)*reach), v=fold(z+Math.sin(a)*reach);
      const px=cx+signX*u, pz=cz+signZ*v, verge=THREE.MathUtils.smoothstep(Math.min(u,v),0.46,0.89);
      const h=tall*rng.uniform(0.044,0.094)*(0.51+0.49*verge), tone=rng.uniform(0.64,0.91), straw=rng.next()**5*0.23;
      const r=(base.r*(1-straw)+tip.r*straw)*tone, g=(base.g*(1-straw)+tip.g*straw)*tone, b=(base.b*(1-straw)+tip.b*straw)*tone;
      for (let leaf=0;leaf<5;leaf++) {
        const dir=common+leaf*2.40+rng.uniform(-0.67,0.67), dx=Math.cos(dir), dz=Math.sin(dir);
        const w=rng.uniform(0.0022,0.0045), length=h*rng.uniform(0.62,1), lean=length*rng.uniform(0.35,1.28);
        const rx=px+dx*rng.uniform(0,0.012), rz=pz+dz*rng.uniform(0,0.012), n=pos.length/3;
        const point = (offsetX,height,offsetZ,light) => {
          pos.push(rx+offsetX,y+height,rz+offsetZ); roots.push(rx,rz); layers.push(-1-height);
          colors.push(r*light,g*light,b*light*(0.85+0.13*light)); normals.push(-dx*0.16,0.987,-dz*0.16);
        };
        if (leaf === 0) {
          point(-dz*w*0.40,0,dx*w*0.40,0.55);
          point(dz*w*0.40,0,-dx*w*0.40,0.61);
          point(dx*lean*0.27-dz*w,length*0.69,dz*lean*0.27+dx*w,0.84);
          point(dx*lean*0.27+dz*w,length*0.69,dz*lean*0.27-dx*w,0.93);
          point(dx*lean,length*rng.uniform(0.83,1),dz*lean,0.97);
          indices.push(n,n+2,n+1,n+1,n+2,n+3,n+2,n+4,n+3);
        } else {
          point(-dz*w,0,dx*w,0.54); point(dz*w,0,-dx*w,0.63); point(dx*lean,length,dz*lean,0.93);
          indices.push(n,n+2,n+1);
        }
      }
    }
  }
  const geom = new THREE.BufferGeometry();
  for (const [name,arr,n] of [['position',pos,3],['normal',normals,3],['color',colors,3],['uv',roots,2],['aLayer',layers,1]])
    geom.setAttribute(name,new THREE.Float32BufferAttribute(arr,n));
  geom.setIndex(indices); return geom;
}
