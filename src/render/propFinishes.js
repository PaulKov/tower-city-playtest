// Общий батч реквизита. UV одной детали хранят развёртку и номер физического покрытия.
// Три канала — множитель цвета, шероховатость и металличность. У каждого слоя собственная пирамида mip.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { assets } from '../assets/index.js';

export const PROP_FINISH = Object.freeze({ wood: 0, endgrain: 1, paint: 2, metal: 3, cloth: 4, mineral: 5, foliage: 6, glass: 7 });
const SIZE = 64, LAYERS = Object.keys(PROP_FINISH).length;
export const FORGED_STEEL = LAYERS;
const UV_BASE = 512;
let atlas;
let source;
const atlasUniform = { value: null };
const metallic = [0,0,0.04,0.62,0,0,0,0];

/** Кодируется после развёртки, до слияния с неразмеченным декором. Древесные волокна идут вдоль U. */
export function finishU(layer, u) {
  return -(UV_BASE + 2 * layer + THREE.MathUtils.clamp(u, 0, 1));
}

export function finishGeometry(geometry, layer) {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setX(i, finishU(layer, uv.getX(i)));
  }
  return geometry;
}

function finishAtlas() {
  if (atlas) return atlas;
  const data = new Uint8Array(SIZE * SIZE * 4 * LAYERS);
  const rng = createRng(77291), tau = Math.PI * 2;
  const grainPhases = Array.from({ length: 48 }, () => rng.next());
  function texel(layer, pixel, tone, rough, metal = 0) {
    const i = (layer * SIZE * SIZE + pixel) * 4;
    data[i] = Math.round(THREE.MathUtils.clamp(tone / 1.4, 0, 1) * 255);
    data[i+1] = Math.round(rough * 255);
    data[i+2] = Math.round(metal * 255);
    data[i+3] = Math.round(THREE.MathUtils.clamp(tone-0.5,0,1)*255);
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5) / SIZE, v = (y + 0.5) / SIZE, pixel = y * SIZE + x;
      const fleck = rng.next() - 0.5;
      const flow = Math.sin(tau*u) * 0.012 + Math.sin(tau*(2*u+v)) * 0.009;
      const knot = Math.exp(-((u-0.36)**2 / 0.014 + (v-0.61)**2 / 0.011));
      const fibres = (v + flow + 0.072*knot) * 44;
      const phase = grainPhases[(Math.floor(fibres) + 48) % 48];
      const latewood = Math.pow(0.5 + 0.5*Math.cos(tau*(fibres + 0.25*phase)), 5);
      const pore = Math.hypot((u-0.36)*1.5, v-0.61);
      texel(PROP_FINISH.wood,pixel,1.04 - latewood*(0.16+0.14*phase) - 0.21*knot*Math.exp(-9*pore) + 0.05*fleck,0.84-0.08*latewood);
      const ring = Math.hypot((u-0.28)*0.69,v-0.42) * 19 + flow;
      const end = Math.pow(0.5+0.5*Math.sin(tau*ring),5);
      texel(PROP_FINISH.endgrain,pixel,0.96-0.19*end+0.065*fleck,0.87-0.05*end);
      texel(PROP_FINISH.paint,pixel,1.0+0.06*fleck,0.74+0.08*fleck,0.04);
      const brush = Math.sin(tau*(51*v+0.045*Math.sin(tau*u)));
      texel(PROP_FINISH.metal,pixel,0.99+0.043*brush+0.036*fleck,0.56+0.07*brush+0.08*fleck,0.62);
      const warp = Math.sin(tau*24*u), weft = Math.sin(tau*24*v);
      const weave = warp*weft + 0.21*Math.sin(tau*(24*u+12*v));
      texel(PROP_FINISH.cloth,pixel,0.98+0.079*weave+0.045*fleck,0.93-0.025*warp);
      const aggregate = Math.sin(tau*(3*u+2*v)) * Math.sin(tau*(5*v-u));
      texel(PROP_FINISH.mineral,pixel,1+0.065*aggregate+0.13*fleck,0.92+0.07*fleck);
      const midrib = Math.max(0,1-75*Math.abs(v-0.5));
      const veins = Math.pow(Math.max(0,Math.cos(tau*(9*u-4*Math.abs(v-0.5)))),13);
      texel(PROP_FINISH.foliage,pixel,0.97+0.10*midrib+0.06*veins+0.034*fleck,0.83-0.04*midrib);
      texel(PROP_FINISH.glass,pixel,1,0.27,0);
    }
  }
  atlas = makeArray(data,SIZE);
  return atlas;
}

function makeArray(data,size) {
  const t=new THREE.DataArrayTexture(data,size,size,LAYERS);
  t.name='propFinishes'; t.magFilter=THREE.LinearFilter;
  t.minFilter=THREE.LinearMipmapLinearFilter; t.generateMipmaps=true;
  t.anisotropy=4; t.needsUpdate=true;
  return t;
}

/** Переставляет плитки исходного изображения в слои GPU один раз при загрузке версии. */
export function syncPropFinishes(store = assets) {
  const packed=store?.tryGet?.('prop.surfaces');
  if (!packed || packed===source) return;
  const im=packed.image, size=im.width/4;
  if (!Number.isInteger(size) || im.height!==2*size) return;
  const c=document.createElement('canvas'); c.width=im.width; c.height=im.height;
  const ctx=c.getContext('2d');
  if (!packed.flipY) { ctx.translate(0,im.height); ctx.scale(1,-1); }
  ctx.drawImage(im,0,0);
  const src=ctx.getImageData(0,0,c.width,c.height).data, data=new Uint8Array(size*size*LAYERS*4);
  for (let layer=0;layer<LAYERS;layer++) {
    for(let y=0;y<size;y++) {
      let read=4*((Math.floor(layer/4)*size+y)*im.width+(layer%4)*size);
      let write=4*((layer*size+y)*size);
      for(let x=0;x<size;x++,read+=4,write+=4) {
        data[write]=src[read]; data[write+1]=src[read+1];
        data[write+2]=Math.round(255*metallic[layer]); data[write+3]=src[read+2];
      }
    }
  }
  const old=atlas;
  atlas=makeArray(data,size); atlasUniform.value=atlas; source=packed; old?.dispose();
}

/** Неразмеченные части в том же меше используют PBR-параметры базового материала. */
export function propFinishPatch(shader) {
  syncPropFinishes();
  atlasUniform.value=finishAtlas();
  shader.uniforms.uPropFinish = atlasUniform;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vPropUv;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float packedFinish = -uv.x - ${UV_BASE}.0;
      float finishLayer = floor(packedFinish * 0.5);
      vPropUv = vec3(packedFinish - finishLayer * 2.0, uv.y, finishLayer);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uPropFinish; varying vec3 vPropUv;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec4 finishSample = vec4(1.0 / 1.4, roughness, metalness, 0.5);
      bool profiledPart = vPropUv.z >= 0.0 && vPropUv.z < ${LAYERS}.0;
      if (profiledPart) finishSample = texture(uPropFinish, vPropUv);
      #ifdef PROP_FORGING
        if (abs(vPropUv.z-${FORGED_STEEL}.0) < 0.5) {
          vec4 peen = texture(uPropFinish,vec3(vPropUv.xy,2.0));
          vec4 scale = texture(uPropFinish,vec3(vPropUv.xy,5.0));
          float grain = 1.4*scale.r-1.0;
          finishSample = vec4(mix(1.0/1.4,peen.r,.62)*(1.0+.34*grain),
            clamp(.64+.38*grain,.53,.76),.57,.45+.07*peen.a+.03*scale.a);
          profiledPart = true;
        }
      #endif
      diffuseColor.rgb *= finishSample.r * 1.4;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (profiledPart && vViewPosition.z < 14.0) {
        vec3 px=dFdx(-vViewPosition), py=dFdy(-vViewPosition);
        vec3 tx=cross(py,normal), ty=cross(normal,px);
        float det=dot(px,tx);
        vec2 relief=vec2(dFdx(finishSample.a),dFdy(finishSample.a));
        float height=mix(0.00034,0.00085,1.0-step(1.5,vPropUv.z))*(1.0-smoothstep(5.0,14.0,vViewPosition.z));
        normal=normalize(normal-sign(det)*height*(tx*relief.x+ty*relief.y)/max(abs(det),1e-10));
      }`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = finishSample.g;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = finishSample.b;');
}
