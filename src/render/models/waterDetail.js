// Короткая рябь, преломление луча до дна и отражения ближнего окружения в одном проходе.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { OCEAN_GLSL, OCEAN_WIND, OCEAN_PIER, BOAT_SPOTS } from './oceanSurface.js';

const oceanBoats = BOAT_SPOTS.map(([x,z,yaw]) => new THREE.Vector4(x,z,Math.cos(yaw),Math.sin(yaw)));

let texture;
export function waveTexture() {
  if (texture) return texture;
  const size = 128, period = 7, tau = 2 * Math.PI, rng = createRng(13815);
  const data = new Uint8Array(size * size * 4), seeds = [];
  for (let i = 0; i < period * period; i++) seeds.push([rng.uniform(0.12, 0.88), rng.uniform(0.12, 0.88)]);
  // Короткие гребешки имеют разные направления, длину и фазу. В отличие от
  // набора параллельных синусоид гребень может сходить на нет через несколько длин волн.
  const bands = [];
  for (let k = 0; k < 23; k++) {
    const angle = (k % 4 === 0 ? -0.57 : 0.86) + rng.uniform(-0.64,0.64);
    const frequency = 2.7 + 13 * (k + rng.next()) / 23;
    const a = Math.round(frequency*Math.cos(angle)), b = Math.round(frequency*Math.sin(angle));
    bands.push([a, b, 0.17 / (1 + frequency*frequency*0.021), rng.next()*tau]);
  }
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i / size, y = j / size, wx = x + 0.022 * Math.sin(tau * (y + x)), wy = y + 0.033 * Math.cos(tau * (2 * x - y));
    let dx = 0, dy = 0, height = 0;
    for (const [a, b, w, phase] of bands) {
      const ph = tau * (a * wx + b * wy) + phase, gradient = Math.cos(ph) * w;
      dx += gradient * a; dy += gradient * b; height += Math.sin(ph) * w;
    }
    const cx = Math.floor(wx * period), cy = Math.floor(wy * period);
    let first = Infinity, second = Infinity;
    for (let v = cy - 1; v <= cy + 1; v++) for (let u = cx - 1; u <= cx + 1; u++) {
      const seed = seeds[((v + period) % period) * period + (u + period) % period];
      const d = (wx * period - u - seed[0]) ** 2 + (wy * period - v - seed[1]) ** 2;
      if (d < first) { second = first; first = d; } else if (d < second) second = d;
    }
    const k = 4 * (j * size + i);
    data[k] = THREE.MathUtils.clamp(128 + Math.round(120 * dx / 2.31), 0, 255);
    data[k + 1] = THREE.MathUtils.clamp(128 + Math.round(120 * dy / 5.33), 0, 255);
    data[k + 2] = THREE.MathUtils.clamp(128 + Math.round(154 * height), 0, 255);
    data[k + 3] = Math.round(255 * Math.exp(-10 * (Math.sqrt(second) - Math.sqrt(first))));
  }
  texture = new THREE.DataTexture(data, size, size);
  texture.name = 'harbor:capillary-waves';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Бесшовный участок дна размером 1,46 м. В красном канале песок, в зелёном
// камешки с собственной полутенью, в синем — пятна осадка. Генерация однократная.
let bedTexture;
export function seabed() {
  if (bedTexture) return bedTexture;
  const n = 256, tau = 2 * Math.PI, rng = createRng(44208), bytes = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, i = 4 * (x + n * y);
    const drifts = Math.cos(tau * (2 * u - v)) + 0.5 * Math.sin(tau * (3 * v + u));
    const ridge = Math.cos(tau * (4 * u + 7 * v) + 1.8 * drifts);
    bytes[i] = 136 + 16 * ridge + 9 * drifts + rng.uniform(-23, 23);
    bytes[i+1] = 128;
    bytes[i+2] = 125 + 38 * drifts + 17 * Math.sin(tau * (5 * u - 3 * v));
    bytes[i+3] = 255;
  }
  for (let k = 0; k < 1800; k++) {
    const cx = rng.next() * n, cy = rng.next() * n, r = 0.65 + 4.1 * rng.next() ** 4;
    const aspect = rng.uniform(0.50, 0.92), angle = rng.next() * tau, c = Math.cos(angle), s = Math.sin(angle);
    const pigment = rng.uniform(-54, 32);
    for (let y = Math.floor(cy-r); y <= cy+r; y++) for (let x = Math.floor(cx-r); x <= cx+r; x++) {
      const dx = (x-cx)/r, dy = (y-cy)/r, ex = dx*c+dy*s, ey = (dy*c-dx*s)/aspect;
      const h = 1 - ex*ex - ey*ey;
      if (h <= 0) continue;
      const i = 4 * ((x & 255) + n * (y & 255));
      bytes[i+1] = 128 + (pigment + 24 * Math.sqrt(h) - 47 * dx + 21 * dy) * Math.min(1, h * 5);
    }
  }
  bedTexture = new THREE.DataTexture(bytes, n, n);
  bedTexture.name = 'water:sand-and-shingle';
  bedTexture.wrapS = bedTexture.wrapT = THREE.RepeatWrapping;
  bedTexture.generateMipmaps = true;
  bedTexture.minFilter = THREE.LinearMipmapLinearFilter;
  bedTexture.magFilter = THREE.LinearFilter;
  bedTexture.needsUpdate = true;
  return bedTexture;
}

const VARYINGS = '\nvarying vec3 vWaterPos;\nvarying vec2 vWaterUv;\nvarying vec4 vOcean;\n';

let preserve;
/** Один участок густого сиропа. R — слои мякоти, G — взвешенные кусочки ягоды,
 * B — тёмные семечки, A — редкие пузырьки с ободком. Все четыре поля имеют свои mip. */
function preserveTexture() {
  if (preserve) return preserve;
  const n=256, tau=2*Math.PI, rng=createRng(7213), pixels=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const u=tau*x/n, v=tau*y/n, bend=1.17*Math.sin(u+v)+0.65*Math.cos(2*u-v);
    const vein=Math.sin(3*v+Math.sin(u)+bend)+0.47*Math.cos(6*v-2*u+bend);
    pixels[(y*n+x)*4]=Math.round(124+64*vein);
  }
  for(let k=0;k<360;k++) {
    const x=rng.int(0,n-1),y=rng.int(0,n-1), channel=k<88?1:k<310?2:3;
    const r=channel===1?rng.uniform(3.2,9.5):channel===2?rng.uniform(0.85,1.9):rng.uniform(1.1,3.2);
    const angle=rng.uniform(0,tau), ca=Math.cos(angle),sa=Math.sin(angle), aspect=channel===3?0.92:rng.uniform(0.45,0.80);
    const bound=Math.ceil(r);
    for(let j=-bound;j<=bound;j++) for(let i=-bound;i<=bound;i++) {
      const h=1-((i*ca+j*sa)/r)**2-((j*ca-i*sa)/(r*aspect))**2;
      if(h<=0) continue;
      const at=4*(((y+j)&255)*n+((x+i)&255))+channel;
      const value=channel===3?0.26+0.69*(1-h):Math.min(1,2.7*h);
      pixels[at]=Math.max(pixels[at],Math.round(255*value));
    }
  }
  preserve=new THREE.DataTexture(pixels,n,n);preserve.name='sweet:berry-preserve';
  preserve.wrapS=preserve.wrapT=THREE.RepeatWrapping;preserve.minFilter=THREE.LinearMipmapLinearFilter;
  preserve.magFilter=THREE.LinearFilter;preserve.generateMipmaps=true;preserve.needsUpdate=true;
  return preserve;
}

let frozenInclusions;
function iceInclusions() {
  if (frozenInclusions) return frozenInclusions;
  const n = 512, data = new Uint8Array(n*n*4), rng = createRng(93427);
  function deposit(x, y, r, channel, strength, hollow = false) {
    x *= 2; y *= 2; r *= 2;
    const endX = Math.min(n-1, Math.ceil(x+r)), endY = Math.min(n-1, Math.ceil(y+r));
    for (let j = Math.max(0, Math.floor(y-r)); j <= endY; j++) {
      for (let i = Math.max(0, Math.floor(x-r)); i <= endX; i++) {
        const rr = ((x-i)**2 + (y-j)**2)/(r*r);
        if (rr > 1) continue;
        const alpha = Math.min(1, 2.5*(1-rr)) * (hollow ? 0.32 + 0.68*rr : 1);
        const at = 4*(j*n+i)+channel;
        data[at] = Math.max(data[at], Math.round(255*alpha*strength));
      }
    }
  }
  // Трещины идут от мест давления у берега. Их раскрытие сходит на нет к свободному концу.
  const trace = (x, y, angle, steps, breadth, branch) => {
    for (let k = 0; k < steps; k++) {
      const strength = 1-k/steps, reach = rng.uniform(5,19);
      angle += rng.uniform(-0.40,0.40);
      const dx = Math.cos(angle), dy = Math.sin(angle);
      for (let t = 0; t < reach; t += 0.7) {
        deposit(x+t*dx,y+t*dy,0.72+breadth*strength,0,0.25+0.65*strength);
        deposit(x+t*dx+1.25,y+t*dy+1.50,1.45+breadth*strength,1,0.25+0.65*strength);
      }
      x += dx*reach; y += dy*reach;
      if (branch && k === 2) trace(x,y,angle + rng.uniform(0.55,1.15),3,0.29,false);
    }
  };
  for (const [x,y,a,k] of [[0,39,0.51,8],[171,0,1.53,7],[255,153,3.52,6],[108,256,-1.81,5]]) trace(x,y,a,k,0.96,true);
  // В замерзающей воде газ собирается небольшими группами под разными слоями.
  for (let i = 0; i < 21; i++) {
    const x = rng.uniform(4,251), y = rng.uniform(4,251), count = rng.int(3,10);
    for (let j = 0; j < count; j++) {
      const dx = rng.uniform(-12,12), dy = rng.uniform(-8,8);
      deposit(x+dx,y+dy,rng.uniform(0.65,2.15),2, rng.uniform(0.36,0.90),true);
    }
  }
  frozenInclusions = new THREE.DataTexture(data,n,n);
  frozenInclusions.name = 'ice:fractures-and-air';
  frozenInclusions.generateMipmaps = true; frozenInclusions.minFilter = THREE.LinearMipmapLinearFilter;
  frozenInclusions.magFilter = THREE.LinearFilter; frozenInclusions.needsUpdate = true;
  return frozenInclusions;
}

/** Внутренние включения льда видны на разной глубине. Края у берега матовые от инея. */
export function patchIce(shader) {
  shader.uniforms.uIceGrain = { value: seabed() };
  shader.uniforms.uIceVeins = { value: iceInclusions() };
  const vary = '\nvarying vec3 vIcePos; varying vec2 vIceUv;\n';
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>' + vary)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIcePos = (modelMatrix * vec4(position,1.0)).xyz; vIceUv = uv;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>' + vary + 'uniform sampler2D uIceGrain, uIceVeins;\n')
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 eye = normalize(cameraPosition - vIcePos);
      vec2 below = vIcePos.xz - eye.xz * 0.054;
      vec3 cold = texture2D(uIceGrain, below / 2.48).rgb;
      vec2 iceUv = vIceUv - vec2(vIceUv.x > 3.5 ? 4.0 : 2.0,0.0);
      vec3 flaws = texture2D(uIceVeins, iceUv - eye.xz*0.008).rgb;
      float edge = vIceUv.x > 3.5 ? length(vIceUv - vec2(4.5,0.5)) * 2.0 :
        max(abs(vIceUv.x - 2.5),abs(vIceUv.y - 0.5)) * 2.0;
      float frost = smoothstep(0.59,1.09,edge + 0.12*(cold.b-0.5)) * (0.30 + 0.59*cold.b);
      float air = smoothstep(0.606,0.76,cold.g) * (0.09 + 0.30*cold.b) + 0.53*flaws.b;
      diffuseColor.rgb *= mix(vec3(0.30,0.51,0.58), vec3(0.94,0.97,0.99),
        clamp(frost + 0.60*flaws.r + air + 0.22*cold.b,0.0,1.0)) * (1.0-0.18*flaws.g);`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = 0.23 + 0.47*frost + 0.12*cold.b;');
}
const SAMPLE = /* glsl */`
  vec2 p = vWaterPos.xz;
  bool sea = vWaterUv.x < 1.5, basin = vWaterUv.x > 3.5 && vWaterUv.x < 5.5, jet = vWaterUv.x > 5.5;
  bool quay = vWaterUv.y > 1.5 && !basin && !jet;
  vec3 waterEye = normalize(cameraPosition - vWaterPos);
  float eyeRange = length(cameraPosition - vWaterPos);
  vec2 basinUv = vec2(vWaterUv.x - 4.5, 0.5 - vWaterUv.y) * 2.0;
  vec2 plotUv = vec2(vWaterUv.x - 2.5, 0.5 - fract(vWaterUv.y));
  float radius = length(basinUv), edge = 2.0 * max(abs(plotUv.x), abs(plotUv.y));
  float shore = vOcean.x, impact = 0.0, foam = 0.0;
  float flowTime=uTime;
  #ifdef WATER_JAM
    bool jamPool=!basin && !jet;
    if (jamPool) flowTime*=0.09;
  #endif
  vec4 w1 = texture2D(uWaterDetail, p * 0.54 + flowTime * vec2(-0.037, 0.018));
  vec2 slope = (w1.rg - 0.5) * (sea ? 0.40 : 0.23);
  #ifndef WATER_LITE
    vec4 w2 = texture2D(uWaterDetail, vec2(-p.y, p.x) * 1.13 + flowTime * vec2(0.027, -0.046));
    slope += vec2(w2.g - 0.5, 0.5 - w2.r) * (sea ? 0.19 : 0.13);
  #endif
  if (sea) {
    // В ракурсе вдоль воды один пиксель покрывает десятки капиллярных волн.
    // Фильтруем наклон до расчёта отражения, чтобы вдали не возникали светлые стены.
    float footprint = max(length(dFdx(p)),length(dFdy(p)));
    slope *= (1.0 - 0.84 * smoothstep(0.024,0.27,footprint)) *
      (0.79 + 0.18 * sin(0.49*p.x - 0.27*p.y + 1.6*w1.b));
    slope += vOcean.yz * mix(0.76,0.19,smoothstep(12.0,75.0,eyeRange));
    float streak = 0.42 + 0.27 * sin(dot(p,vec2(0.37,-0.22)) + 3.0*w1.b - 0.42*uTime);
    float flecks = smoothstep(0.60, 0.96, 0.74*w1.b + 0.40*w1.a + 0.12*sin(p.y*3.4 + w1.g));
    foam = vOcean.w * (0.15 * streak + 0.65 * flecks);
  } else if (basin) {
    // Две ближайшие точки падения посылают перекрывающиеся расходящиеся волны.
    float sector = (atan(basinUv.y, basinUv.x + 0.00001) - 0.22) / 1.256637;
    float nearest = floor(sector + 0.5), neighbor = nearest + (sector < nearest ? -1.0 : 1.0);
    slope *= 0.34;
    for (int source = 0; source < 2; source++) {
      float a = (source == 0 ? nearest : neighbor) * 1.256637 + 0.22;
      vec2 d = basinUv - (0.730 + 0.043 * cos(a)) * vec2(cos(a), sin(a));
      float r = max(length(d), 0.003);
      float phase = 42.0 * r - 5.7 * uTime + 1.6 * sin(a) + 0.58 * w1.b;
      float packets = 0.52 + 0.48 * sin(19.3 * r - 2.8 * uTime + cos(a));
      slope += d / r * ((0.21 + 0.08 * w1.b) * sin(phase) * packets * exp(-2.8 * r));
      impact += (1.0 - smoothstep(0.012, 0.115, r)) * (0.32 + 0.68 * w1.a);
    }
  }
  #ifdef WATER_JAM
    vec4 fruit = vec4(0.0);
    float meniscus=0.0;
    if(jamPool) {
      vec2 inside=(p-0.034*waterEye.xz)/1.75 + flowTime*vec2(0.012,-0.006);
      fruit=texture2D(uPreserve,inside+0.013*w1.rg);
      meniscus=smoothstep(0.963,1.0,edge);
      slope = 0.20*slope + 0.042*(w1.rg-0.5) + 0.18*meniscus*sign(plotUv)*step(abs(plotUv.yx),abs(plotUv));
    }
  #endif
  vec3 waterNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 reflected = reflect(-waterEye, waterNormal);
  float facing = clamp(dot(waterNormal, waterEye), 0.0, 1.0);
  float microRoughness = sea ? mix(0.13,0.25,smoothstep(8.0,72.0,eyeRange)) : 0.105;
  float averageFacing = sqrt(facing*facing + microRoughness*microRoughness*(1.0-facing*facing));
  float fresnel = 0.0204 + 0.9796 * pow(1.0 - averageFacing, 5.0);
  vec3 sunDir = vec3(0.468, 0.802, 0.368);
  #if NUM_DIR_LIGHTS > 0
    sunDir = inverseTransformDirection(directionalLights[0].direction, viewMatrix);
  #endif
  if (jet) {
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25,0.34,0.35), 0.87);
  } else {
    #ifdef WATER_JAM
      if(jamPool) {
        vec3 deep=diffuseColor.rgb*vec3(0.54,0.44,0.52);
        vec3 pulp=diffuseColor.rgb*vec3(1.32,1.09,0.77);
        diffuseColor.rgb=mix(deep,pulp,0.20+0.52*fruit.r+0.23*fruit.g);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.088,0.016,0.021),0.47*fruit.b);
        diffuseColor.rgb+=vec3(0.032,0.012,0.014)*fruit.a;
        diffuseColor.rgb*=1.0-0.23*meniscus;
      } else
    #endif
    {
      // Закон Снеллиуса, n воды = 1.333. Грунт неподвижен в мире и смещается
      // под волной на величину, зависящую от направления взгляда и глубины.
      float depth = sea ? 0.11 + 0.155 * max(0.0, shore) : mix(quay ? 1.44 : 0.76, 0.32, smoothstep(0.42, 1.0, edge));
      if (basin) depth = 0.14 - 0.052 * smoothstep(0.75, 1.0, radius);
      vec3 down = refract(-waterEye, waterNormal, 0.7502);
      float pathLength = depth / max(0.24, -down.y);
      vec2 bottom = p + down.xz * pathLength;
      vec3 deep = sea ? vec3(0.012,0.080,0.095) : quay ? vec3(0.012,0.100,0.105) : vec3(0.040,0.106,0.080);
      vec3 body = deep;
      if (depth < 7.0) {
        vec3 bed = texture2D(uWaterBed, bottom / 1.46).rgb;
        float grain = bed.r * 0.95 + (bed.g - 0.5) * 1.8;
        vec3 substrate = mix(vec3(0.25,0.214,0.146), vec3(0.49,0.415,0.29), grain);
        substrate *= mix(vec3(0.69,0.73,0.61), vec3(1.11,1.08,1.00), bed.b);
        #ifdef WATER_SAND
          if (sea || quay) {
            vec3 sediment = texture2D(uSeaSand, bottom / 3.9).rgb;
            substrate *= 0.24 + 1.45 * sediment;
          }
        #endif
        if (basin) {
          // Сквозь воду под углом видны швы плит на дне и бронзовый слив.
          vec2 rel = basinUv * 0.704 + down.xz * pathLength;
          vec2 st = rel / vec2(0.242,0.186);
          st.x += 0.5 * mod(floor(st.y), 2.0);
          vec2 seams = (0.5 - abs(fract(st) - 0.5)) * vec2(0.242,0.186);
          float slab = smoothstep(0.001,0.004 + fwidth(rel.x),min(seams.x,seams.y));
          float tint = 0.53 + 0.47 * sin(dot(floor(st), vec2(7.19, 31.47)));
          substrate = mix(vec3(0.137,0.215,0.188), mix(vec3(0.16,0.264,0.233), vec3(0.19,0.284,0.242),tint), slab);
          substrate *= 0.82 + grain * 0.40;
          float drain = 1.0 - smoothstep(0.068, 0.083, length(rel));
          substrate = mix(substrate, vec3(0.14,0.115,0.071), drain);
          substrate *= 1.0 - 0.28 * smoothstep(0.59,0.72,length(rel));
          deep = vec3(0.036,0.122,0.113);
        }
        // Преломлённый солнечный свет движется по дну своим ходом. На глубине он затухает.
        vec2 lightUv = bottom * (basin ? 0.94 : 0.66) + 0.032 * slope + uTime * vec2(0.025, -0.017);
        float net = texture2D(uWaterDetail, lightUv).a;
        #ifndef WATER_LITE
          net *= 0.29 + 0.71 * texture2D(uWaterDetail, lightUv.yx * 0.73 - uTime * 0.019).b;
        #endif
        substrate *= 0.93 + 0.63 * net * exp(-0.85 * depth) * (1.0 - uNightW);
        vec3 absorb = basin ? vec3(1.05,0.31,0.20) : quay || sea ? vec3(2.10,0.93,0.63) : vec3(1.40,0.86,1.14);
        vec3 transmit = exp(-absorb * pathLength);
        body = mix(deep, substrate, transmit);
      }
      diffuseColor.rgb = body * uWaterGain;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.68,0.78,0.72), clamp(foam + impact * 0.55, 0.0, 1.0));
    }
  }
`;
const LIGHT = /* glsl */`
  if (jet) {
    float rim = 1.0 - abs(dot(normalize(vViewPosition), normal));
    float thread = 0.5 + 0.5 * sin(58.0 * vWaterUv.x - 12.0 * uTime + 4.0 * vWaterUv.y);
    diffuseColor.a = 0.18 + 0.48 * rim + 0.12 * thread;
    if (vWaterUv.x >= 8.0) {
      vec2 disk = (vWaterUv-vec2(8.5,0.5))*2.0;
      float rr = dot(disk,disk);
      if (rr > 1.0) discard;
      float lens = max(0.0, 1.0-rr);
      rim = 1.0 - sqrt(lens);
      thread = pow(max(0.0,dot(vec3(disk,sqrt(lens)),vec3(-0.35,0.47,0.81))),12.0);
      diffuseColor.a = (0.24+0.58*rim+0.15*thread)*smoothstep(0.0,max(0.04,fwidth(rr)),lens);
    }
    totalEmissiveRadiance += vec3(0.35,0.43,0.45) * (rim + 0.22 * thread) * (1.0 - 0.88 * uNightW);
  } else {
    float horizon = pow(1.0 - clamp(reflected.y,0.0,1.0), 2.0);
    vec3 sky = mix(vec3(0.25,0.51,0.75), vec3(0.88,0.91,0.90), horizon);
    vec3 halfDir = normalize(waterEye + sunDir);
    float sparkle = pow(max(dot(waterNormal,halfDir),0.0), 185.0);
    totalEmissiveRadiance += vec3(0.25,0.23,0.18) * sparkle * (1.0 - 0.94 * uNightW);
    if (!sea) totalEmissiveRadiance += sky * fresnel * 0.57 * (1.0 - 0.94 * uNightW);
  }
`;

// Ближнее отражение и тень от настила и пришвартованного судна. Луч пересекает плоскость на высоте
// борта и рубки. Искажение зависит от нормали коротких волн. Второго рендера сцены для этого не требуется.
const QUAY_REFLECTION = `
  // Рассеянный свет освещает погружённый материал, а поверхность единожды
  // отражает солнце и небо. Второй PBR-блик давал всему морю лаковую плёнку.
  if (!jet) outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
  if (quay) {
    float reverseBoat = step(3.5, vWaterUv.y);
    vec2 local = vec2(vWaterUv.x - 2.5, 0.5 - (vWaterUv.y - 2.0 - 2.0 * reverseBoat)) * 4.8;
    vec2 direction = reflected.xz / max(reflected.y, 0.18);
    vec2 pier = local + direction * 0.155;
    float boards = (1.0-smoothstep(0.59,0.66,abs(pier.y))) * (1.0-smoothstep(2.32,2.42,abs(pier.x)));
    vec2 center = vec2(mix(0.28,-0.28,reverseBoat),1.48);
    vec2 q = local + direction * 0.20 - center;
    float bow = mix(q.x,-q.x,reverseBoat);
    float beam = 0.39 * (1.0 - 0.65 * smoothstep(0.54,1.29,bow) - 0.18 * smoothstep(0.77,1.24,-bow));
    float hull = (1.0-smoothstep(beam-0.02,beam+0.03,abs(q.y))) * (1.0-smoothstep(1.20,1.31,abs(q.x)));
    vec2 glazing = local + direction * 0.61 - center;
    float windows = (1.0 - smoothstep(0.48,0.57,abs(glazing.x))) * (1.0 - smoothstep(0.24,0.31,abs(glazing.y)));
    float mullion = 1.0 - smoothstep(0.006,0.023,abs(fract(glazing.x / 0.27)-0.5)*0.27);
    vec2 roof = local + direction * 0.86 - center;
    float eave = abs(max(abs(roof.x)-0.56,abs(roof.y)-0.30));
    float trim = 1.0 - smoothstep(0.0,0.025,eave);
    float shadow = exp(-3.3 * max(0.0, abs(local.y)-0.56))
                    + 0.50 * exp(-3.8*max(0.0,length((local-center)/vec2(1.30,0.48))-0.70));
    outgoingLight *= 1.0 - clamp(shadow,0.0,1.0) * 0.33;
    float lightLevel = 1.0 - 0.89 * uNightW;
    float reflectance = min(0.54,0.105 + 2.4*fresnel);
    float seams = smoothstep(0.01,0.09,abs(fract(pier.x/0.216) - 0.5));
    outgoingLight = mix(outgoingLight, vec3(0.093,0.079,0.050) * (0.65+0.35*seams) * lightLevel, reflectance * boards);
    outgoingLight = mix(outgoingLight, vec3(0.016,0.053,0.055) * lightLevel, (reflectance+0.13) * hull);
    outgoingLight = mix(outgoingLight, mix(vec3(0.08,0.14,0.16),vec3(0.30,0.23,0.14),mullion) * lightLevel, reflectance * windows);
    outgoingLight += vec3(0.048,0.051,0.043) * reflectance * trim * lightLevel;
  } else if (sea) {
    // У горизонта отражается то же голубое небо, что видно над морем. Мелкая рябь
    // на дальних пикселях теряет контраст, сохраняя цвет и крупный силуэт волн.
    float distant = smoothstep(18.0,135.0,eyeRange);
    float gloss = mix(fresnel, 0.36, 0.80*distant);
    vec3 sky = mix(vec3(0.16,0.32,0.42),vec3(0.33,0.46,0.50),1.0-clamp(reflected.y,0.0,1.0));
    outgoingLight = mix(outgoingLight, sky * (1.0 - 0.94*uNightW), gloss);
    // Отражающий луч встречает настил, борт или стекло рубки. Проверяем лишь
    // полосу воды у стоянки: на открытом горизонте достаточно отражения неба.
    if (shore < 35.0 && distant < 0.70) {
      vec2 direction = reflected.xz / max(0.10, reflected.y);
      vec2 pier = p + direction * uOceanPier.w;
      float deck = (1.0 - smoothstep(1.36,1.47,abs(pier.x-uOceanPier.x))) *
        smoothstep(uOceanPier.z-0.1,uOceanPier.z+0.1,pier.y) * (1.0-smoothstep(uOceanPier.y-0.1,uOceanPier.y+0.1,pier.y));
      float mixLight = 1.0 - uNightW * 0.90;
      outgoingLight = mix(outgoingLight, vec3(0.082,0.074,0.049)*mixLight, deck * (0.28 + gloss * 0.59));
      if (p.y < uOceanPier.y && p.y > uOceanPier.z && abs(p.x-uOceanPier.x)<2.1) {
        vec2 pile = vec2(abs(p.x-uOceanPier.x)-1.25, mod(p.y-(uOceanPier.y-1.0)+1.5,3.0)-1.5);
        outgoingLight *= 1.0 - 0.48 * (1.0-smoothstep(0.13,0.49,length(pile)));
      }
      for (int i=0; i<${BOAT_SPOTS.length}; i++) {
        vec4 boat = uOceanBoats[i]; vec2 delta = p-boat.xy;
        if (dot(delta,delta) > 26.0) continue;
        mat2 toBoat = mat2(boat.z, boat.w, -boat.w, boat.z);
        vec2 local = toBoat * delta, hull = local + toBoat * direction * 0.19;
        float width = 0.39 - 0.27 * smoothstep(0.48,1.28,hull.x);
        float side = (1.0-smoothstep(width-0.018,width+0.036,abs(hull.y))) * (1.0-smoothstep(1.21,1.30,abs(hull.x)));
        vec2 cab = local + toBoat * direction * 0.56;
        float pane = (1.0-smoothstep(0.45,0.55,abs(cab.x))) * (1.0-smoothstep(0.23,0.29,abs(cab.y)));
        float contact = 1.0-smoothstep(0.85,1.58,length(local/vec2(1.30,0.43)));
        outgoingLight *= 1.0 - 0.27 * contact;
        outgoingLight = mix(outgoingLight, vec3(0.024,0.065,0.067)*mixLight, side*(0.24+0.61*gloss));
        outgoingLight = mix(outgoingLight, vec3(0.11,0.17,0.18)*mixLight, pane*(0.10+0.43*gloss));
      }
    }
  } else if (basin) {
    vec2 lip = basinUv * 0.704 + reflected.xz / max(reflected.y,0.16) * 0.049;
    float facingWall = smoothstep(0.697,0.713,length(lip));
    outgoingLight = mix(outgoingLight, vec3(0.20,0.18,0.14) * (1.0 - 0.85 * uNightW), facingWall * (0.14 + 0.5 * fresnel));
  }
`;

export function patchWater(shader, { time, shore, night, gain, sand, jam = false }) {
  Object.assign(shader.uniforms, { uTime: time, uShore: { value: shore }, uNightW: night, uOceanWind: OCEAN_WIND, uWaterGain: { value: gain },
    uOceanBoats: { value: oceanBoats }, uOceanPier: OCEAN_PIER,
    uWaterDetail: { value: waveTexture() }, uWaterBed: { value: seabed() } });
  if (sand) shader.uniforms.uSeaSand = { value: sand };
  if (jam) shader.uniforms.uPreserve = { value: preserveTexture() };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>' + VARYINGS + 'uniform float uTime, uShore; uniform vec2 uOceanWind;\n' + OCEAN_GLSL)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vWaterUv = uv;
      vOcean = vec4(0.0);
      if (uv.x < 1.5) {
        vOcean = oceanSurface(position.xz, uTime, uShore, uOceanWind);
        transformed.y += vOcean.x;
        vOcean.x = oceanShoreDistance(position.xz, uShore);
      }
      if (uv.x >= 8.0) {
        float t = fract(1.63 * uTime + uv.x);
        transformed.y += 0.42 * t * (1.0-t);
        vec2 corner = sign(normal.xy);
        vec3 right = vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
        transformed += (right*corner.x*0.86 + up*corner.y*1.38)*uv.y;
        vWaterUv = vec2(8.5,0.5)+0.5*corner;
      }
      vWaterPos = (modelMatrix * vec4(transformed,1.0)).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + VARYINGS + `uniform float uNightW, uTime, uWaterGain;
      uniform sampler2D uWaterDetail, uWaterBed, uSeaSand, uPreserve; uniform vec4 uOceanPier, uOceanBoats[${BOAT_SPOTS.length}];\n`)
    .replace('#include <color_fragment>', '#include <color_fragment>' + SAMPLE)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (!jet) normal = normalize(mat3(viewMatrix) * waterNormal);')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + LIGHT)
    .replace('#include <opaque_fragment>', QUAY_REFLECTION + '\n#include <opaque_fragment>');
}
