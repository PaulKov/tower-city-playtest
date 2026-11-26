import * as THREE from 'three';
import { OCEAN_GLSL, OCEAN_PIER, OCEAN_TIME, OCEAN_WIND, BOAT_SPOTS, SHORE_R, OCEAN_EDGE, WATER_Y } from './oceanSurface.js';
import { seabed, waveTexture } from './waterDetail.js';
import { WATER_CONTACT_GLSL } from './waterContacts.js';

export const COAST_QUALITY = { low: 0, medium: 1, high: 2, ultra: 3 };
// Проекция прибрежных островов вдоль лунного света на спокойную поверхность.
// Строится один раз для ночной Гавани до отсечения холмов игровой камерой.
export function moonVisibility(geometry, direction) {
  const size=256, pixels=new Uint8Array(size*size).fill(255);
  const pos=geometry.attributes.position, indices=geometry.index.array;
  const projected=new Float32Array(3*pos.count), texels=size/(2*OCEAN_EDGE);
  for (let i=0; i<pos.count; i++) {
    const h=pos.getY(i)-WATER_Y, along=h/direction.y, j=3*i;
    projected[j]=(pos.getX(i)-direction.x*along)*texels+size/2;
    projected[j+1]=(pos.getZ(i)-direction.z*along)*texels+size/2;
    projected[j+2]=h;
  }
  for (let i=0; i<indices.length; i+=3) {
    const a=3*indices[i], b=3*indices[i+1], c=3*indices[i+2];
    const ax=projected[a], az=projected[a+1], ah=projected[a+2];
    const ux=projected[b]-ax, uz=projected[b+1]-az, uh=projected[b+2]-ah;
    const vx=projected[c]-ax, vz=projected[c+1]-az, vh=projected[c+2]-ah;
    const det=ux*vz-uz*vx;
    if (Math.max(ah,ah+uh,ah+vh)<=0 || Math.abs(det)<1e-6) continue;
    const left=Math.max(0,Math.ceil(ax+Math.min(0,ux,vx)-.5));
    const right=Math.min(size-1,Math.floor(ax+Math.max(0,ux,vx)-.5));
    const top=Math.max(0,Math.ceil(az+Math.min(0,uz,vz)-.5));
    const bottom=Math.min(size-1,Math.floor(az+Math.max(0,uz,vz)-.5));
    for (let z=top; z<=bottom; z++) for (let x=left; x<=right; x++) {
      const dx=x+.5-ax, dz=z+.5-az;
      const u=(dx*vz-dz*vx)/det, v=(ux*dz-uz*dx)/det;
      if (u>=0 && v>=0 && u+v<=1 && ah+u*uh+v*vh>0) pixels[z*size+x]=0;
    }
  }
  const texture=new THREE.DataTexture(pixels,size,size,THREE.RedFormat);
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.needsUpdate=true;
  return texture;
}

const boats = BOAT_SPOTS.map(([x,z,yaw]) => new THREE.Vector4(x,z,Math.cos(yaw),Math.sin(yaw)));

// В линейном свете. Цвет горизонта берётся из того же купола, который запекается в PMREM.
export const CLEAR_SKY_GLSL = `
vec3 clearSkyRadiance(vec3 d,vec3 zenith,vec3 horizon,vec3 halo,vec3 haloDir,float marine) {
  float h=max(d.y,0.0);
  float height=pow(h,0.55)*mix(1.0,mix(0.63,1.0,smoothstep(0.0,0.24,h)),marine);
  float g=max(dot(d,haloDir),0.0);
  return mix(horizon,zenith,height)+halo*(0.30*pow(g,6.0)+0.35*pow(g,40.0))*smoothstep(0.0,0.1,h);
}`;

// Рассеяние света вспышки в облаках. Купол и отражение используют один источник и силу импульса.
export const STORM_LIGHT_GLSL = `
vec3 stormLight(vec2 dir, vec2 target, float swell, float veil, float lit, float wall, float pulse, float charge) {
  float bearing = dot(dir,target) * inversesqrt(max(.001,dot(dir,dir)*dot(target,target)));
  float pocket = smoothstep(.87,.996,bearing+.017*(swell-.5));
  float depth = mix(.34+.28*veil,.27+.73*lit,wall);
  return vec3(.42,.66,1.)*depth*(.23*charge*charge*pocket+pulse*(.12+.42*pocket));
}`;

const VARYINGS = `
varying vec3 vSeaWorld;
varying vec4 vSeaFloor;
varying vec2 vSeaSlope;
uniform float uSeaTime;
uniform vec2 uSeaWind;
`;

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
${VARYINGS}
attribute vec2 aOceanDepth;
uniform float uSeaShore;
${OCEAN_GLSL}
${WATER_CONTACT_GLSL}
void main() {
  vec3 world=(modelMatrix*vec4(position,1.0)).xyz;
  vec4 surface=oceanSurface(world.xz,uSeaTime,uSeaShore,uSeaWind);
  float contact=uContactCount>0 ? waterContact(world.xz,uSeaTime).x : 0.0;
  world.y+=surface.x+contact;
  vSeaWorld=world;
  // Толщина столба воды в метрах, signed distance, пена гребня, высота волны.
  vSeaFloor=vec4(aOceanDepth.x+surface.x+contact,aOceanDepth.y,surface.w,surface.x);
  vSeaSlope=surface.yz;
  vec4 mvPosition=viewMatrix*vec4(world,1.0);
  gl_Position=projectionMatrix*mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
${VARYINGS}
${WATER_CONTACT_GLSL}
${CLEAR_SKY_GLSL}
uniform vec3 uSeaZenith,uSeaHorizon,uSeaHalo,uSeaHaloDir,uSeaSun,uSeaSunColor;
uniform float uSeaMarine,uSeaSunlight;
uniform sampler2D uSeaRipples,uSeaBed,uSeaPhoto;
uniform vec4 uSeaPier,uSeaBoats[${BOAT_SPOTS.length}];

#ifdef COAST_STORM
  uniform sampler2D uSeaCloud;
  uniform float uSeaPulse,uSeaCharge;
  uniform vec3 uSeaStormAt;
  ${STORM_LIGHT_GLSL}
#endif

#ifdef COAST_MOON
  uniform sampler2D uSeaMoonMask;
#endif

vec3 reflectedAtmosphere(vec3 d) {
  #ifdef COAST_STORM
    // Крупные облачные валы сохраняются при усреднении отражения на ряби.
    float h=max(0.,d.y);
    float u=atan(d.z,-d.x)*0.15915494+uSeaTime*.00075;
    float swell=texture2D(uSeaCloud,vec2(u*2.,.37+h*.23)).r;
    float bank=texture2D(uSeaCloud,vec2(u*4.,h*1.45+swell*.28)).r;
    float wall=smoothstep(.04,.18,h-(swell-.5)*.16);
    float lit=smoothstep(.25,.78,bank);
    vec3 deck=mix(uSeaZenith*.48,uSeaHalo,.10+.48*lit);
    vec3 light=mix(uSeaHorizon,deck,wall);
    if(uSeaPulse+uSeaCharge>0.) light+=stormLight(d.xz,uSeaStormAt.xz-cameraPosition.xz,swell,.5,lit,wall,uSeaPulse,uSeaCharge);
    return light;
  #else
    vec3 light=clearSkyRadiance(d,uSeaZenith,uSeaHorizon,uSeaHalo,uSeaHaloDir,uSeaMarine);
    #ifdef COAST_MOON
      // Блик от диска фильтруется угловым размером пикселя и шириной ряби.
      float alignment=max(0.,dot(d,uSeaHaloDir));
      float aa=max(.0003,fwidth(alignment));
      float visible=texture2D(uSeaMoonMask,vSeaWorld.xz/${(2*OCEAN_EDGE).toFixed(1)}+.5).r;
      light+=vec3(1.,.96,.86)*visible*smoothstep(.9993-aa,.9997+aa,alignment);
    #endif
    return light;
  #endif
}

vec3 coastalBottom(vec2 p,float grainFootprint) {
  vec3 grain=texture2D(uSeaBed,p/1.46).rgb;
  vec3 bottom=vec3(0.49,0.386,0.258)*(0.74+0.34*grain.r+0.22*grain.b);
  bottom*=1.0+(grain.g-0.5)*0.67;
  #ifdef COAST_PHOTO
    vec3 photo=texture2D(uSeaPhoto,p*0.74).rgb;
    bottom*=0.50+1.12*photo;
  #endif
  #if COAST_QUALITY >= 3 && !defined(COAST_OVERVIEW)
    vec3 strata=texture2D(uSeaBed,vec2(p.y*0.21-p.x*0.10,p.x*0.26+p.y*0.09)).rgb;
    bottom*=1.0+(strata.b-0.5)*0.47*(1.0-smoothstep(0.33,1.6,grainFootprint));
  #endif
  return bottom;
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p=vSeaWorld.xz;
  vec3 toEye=cameraPosition-vSeaWorld;
  float eyeDistance=length(toEye);
  vec3 eye=toEye/max(eyeDistance,0.001);

  float depth=max(0.0,vSeaFloor.x), shore=vSeaFloor.y;
  vec2 windFlow=uSeaWind/(1.0+length(uSeaWind));
  float miles=max(length(dFdx(p)),length(dFdy(p)));
  float resolved=1.0-smoothstep(0.024,0.28,miles);
  vec4 ripple=texture2D(uSeaRipples,p*0.46+uSeaTime*(vec2(-0.027,0.017)+0.052*windFlow));
  vec2 capillary=(ripple.rg-0.5)*0.27;
  #if COAST_QUALITY >= 2 && !defined(COAST_OVERVIEW)
    vec4 crossing=texture2D(uSeaRipples,mat2(0.6,0.8,-0.8,0.6)*p*0.90+uSeaTime*vec2(0.044,-0.019));
    capillary+=vec2(crossing.g-0.5,0.5-crossing.r)*0.13;
  #endif
  float packet=0.82+0.18*sin(dot(p,vec2(0.37,-0.24))+ripple.b*2.0);
  vec4 contact=vec4(0.0);
  if (uContactCount>0) contact=waterContact(p,uSeaTime);
  // Рёбра разреженной акватории не должны проявляться в отражении при скользящем взгляде.
  float macroDetail=(1.0-smoothstep(9.0,31.0,eyeDistance))*smoothstep(0.005,0.075,eye.y);
  vec2 slope=vSeaSlope*macroDetail+resolved*(capillary*packet+contact.yz);
  vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));
  float facing=clamp(dot(normal,eye),0.0,1.0);
  // После фильтрации коротких волн отражение светлого горизонта сохраняется.
  float rough=mix(0.045,0.083,clamp(length(uSeaWind)*0.65+0.2*(1.0-resolved),0.0,1.0));
  float broadFacing=sqrt(facing*facing+rough*rough*(1.0-facing*facing));
  float fresnel=0.0204+0.9796*pow(1.0-broadFacing,5.0);
  vec3 reflected=reflect(-eye,normal);
  vec3 reflectedSky=reflectedAtmosphere(reflected)*0.83;

  // Луч к дну преломляется по закону Снелла. Длина луча задаёт поглощение в
  // каждом канале, рассеяние набирается по мере потери пропускания.
  vec3 transmitted=refract(-eye,normal,0.7502);
  float path=depth/max(0.32,-transmitted.y);
  vec3 scatter=mix(vec3(0.008,0.151,0.151),vec3(0.007,0.082,0.111),smoothstep(0.3,6.5,depth));
  float skyLight=mix(0.33,1.0,clamp(uSeaHorizon.g,0.0,1.0));
  vec3 color=scatter*skyLight;
  float transmission=0.0;
  #if COAST_QUALITY >= 3 && !defined(COAST_OVERVIEW)
    // Производные берутся всей группой пикселей до ветвления по глубине.
    vec2 px=dFdx(p), py=dFdy(p);
    vec2 h=vec2(dFdx(vSeaFloor.x-vSeaFloor.w),dFdy(vSeaFloor.x-vSeaFloor.w));
    float area=px.x*py.y-px.y*py.x;
  #endif
  if (depth<6.6) {
    #if COAST_QUALITY >= 3 && !defined(COAST_OVERVIEW)
      if (abs(area)>0.000002 && depth<2.0) {
        vec2 bedSlope=vec2(h.x*py.y-h.y*px.y,px.x*h.y-py.x*h.x)/area;
        path=depth/clamp(-transmitted.y-dot(transmitted.xz,bedSlope),0.32,1.35);
      }
    #endif
    vec2 hit=p+transmitted.xz*path;
    vec3 sediment=coastalBottom(hit,miles);
    #if COAST_QUALITY >= 1 && !defined(COAST_OVERVIEW)
      if (depth<3.1 && uSeaSunlight>0.02) {
        vec3 sunRay=refract(-uSeaSun,normal,0.7502);
        vec2 focus=hit-sunRay.xz*depth/max(0.35,-sunRay.y);
        vec4 lens=texture2D(uSeaRipples,focus*0.84+uSeaTime*vec2(0.031,-0.025)+0.095*slope+0.11*(ripple.rg-0.5));
        float net=lens.a;
        #if COAST_QUALITY == 2
          net*=0.47+0.86*crossing.b;
        #endif
        #if COAST_QUALITY >= 3
          vec4 secondLens=texture2D(uSeaRipples,vec2(-focus.y,focus.x)*0.57+uSeaTime*vec2(0.027,0.017)-0.08*slope);
          net=0.56*net+0.44*secondLens.a;
        #endif
        float concentration=smoothstep(0.19,0.76,net)*smoothstep(0.035,0.27,depth);
        sediment+=sediment*uSeaSunColor*concentration*uSeaSunlight*0.47*exp(-1.18*depth)*resolved;
      }
    #endif
    vec3 beam=exp(-vec3(1.77,0.77,0.58)*path);
    sediment*=skyLight*mix(0.62,0.89,uSeaSunlight);
    float floorVisibility=1.0-smoothstep(4.7,6.6,depth);
    transmission=dot(beam,vec3(.2126,.7152,.0722))*floorVisibility;
    color=mix(color,mix(color,sediment,beam),floorVisibility);
  }

  color=mix(color,reflectedSky,fresnel);
  float halfFacing=max(dot(normal,normalize(eye+uSeaSun)),0.0);
  float spread=mix(140.0,38.0,1.0-resolved);
  float glint=pow(halfFacing,spread)*uSeaSunlight;
  color+=uSeaSunColor*(0.31+0.45*fresnel)*glint;

  #if COAST_QUALITY >= 1 && !defined(COAST_OVERVIEW)
    // Ближние объекты дают локальное перекрытие отражённого неба и тень свай.
    if (shore<32.0 && eyeDistance<60.0) {
      vec2 direction=reflected.xz/max(0.13,reflected.y);
      vec2 deck=p+direction*uSeaPier.w;
      float pier=(1.0-smoothstep(1.31,1.48,abs(deck.x-uSeaPier.x)))
        *smoothstep(uSeaPier.z-0.12,uSeaPier.z+0.15,deck.y)*(1.0-smoothstep(uSeaPier.y-0.12,uSeaPier.y+0.15,deck.y));
      float shadow=(1.0-smoothstep(0.75,1.66,abs(p.x-uSeaPier.x+0.12)))
        *smoothstep(uSeaPier.z-0.15,uSeaPier.z+0.23,p.y)*(1.0-smoothstep(uSeaPier.y-0.16,uSeaPier.y+0.16,p.y));
      color=mix(color*(1.0-0.22*shadow),vec3(0.091,0.069,0.044)*skyLight,pier*(0.15+0.52*fresnel));
      #if COAST_QUALITY >= 2
        for (int i=0;i<${BOAT_SPOTS.length};i++) {
          vec4 boat=uSeaBoats[i]; vec2 delta=p-boat.xy;
          if (dot(delta,delta)>20.0) continue;
          mat2 inverseYaw=mat2(boat.z,boat.w,-boat.w,boat.z);
          vec2 local=inverseYaw*delta, ray=inverseYaw*direction;
          vec2 hull=local+ray*0.19;
          float beam=0.42-0.29*smoothstep(0.47,1.30,hull.x);
          float hullReflection=(1.0-smoothstep(beam-0.02,beam+0.05,abs(hull.y)))*(1.0-smoothstep(1.21,1.34,abs(hull.x)));
          vec2 cabin=local+ray*0.55;
          float windows=(1.0-smoothstep(0.43,0.56,abs(cabin.x)))*(1.0-smoothstep(0.24,0.31,abs(cabin.y)));
          float contactShadow=1.0-smoothstep(0.62,1.45,length(local/vec2(1.54,0.54)));
          color=mix(color*(1.0-0.26*contactShadow),vec3(0.027,0.063,0.069)*skyLight,hullReflection*(0.26+0.51*fresnel));
          color=mix(color,vec3(0.109,0.162,0.177)*skyLight,windows*(0.11+0.42*fresnel));
        }
      #endif
    }
  #endif
  if (uContactCount>0) {
    for (int i=0;i<2;i++) {
      if (i>=uContactCount) break;
      vec4 resident=uContactCenters[i];
      vec2 offset=(p-resident.xy)/resident.z;
      color*=1.0-0.18*resident.w*(1.0-smoothstep(0.03,0.55,dot(offset,offset)));
    }
  }

  float lacing=smoothstep(0.38,0.86,ripple.a+0.22*ripple.b);
  float breaking=smoothstep(0.012,0.072,depth)*(1.0-smoothstep(0.62,1.10,depth));
  float foam=breaking*vSeaFloor.z*mix(0.10,0.81,lacing*mix(0.42,1.0,resolved));
  foam=clamp(foam+contact.w*(0.24+0.66*lacing),0.0,0.88);
  color=mix(color,vec3(0.71,0.78,0.71)*skyLight,foam);

  // На скользящем ракурсе морская дымка раньше скрывает поверхность; дальняя
  // кромка сетки растворяется в точном цвете купола, в том же тонмаппинге.
  float marineFog=(1.0-exp(-0.012*max(0.0,eyeDistance-12.0)))*(1.0-smoothstep(0.05,0.42,eye.y));
  float meshEdge=smoothstep(159.0,237.0,length(p));
  #ifdef COAST_STORM
    vec3 horizon=uSeaHorizon;
  #else
    vec3 horizon=clearSkyRadiance(-eye,uSeaZenith,uSeaHorizon,uSeaHalo,uSeaHaloDir,uSeaMarine);
  #endif
  color=mix(color,horizon,max(marineFog,meshEdge));

  // Рядом с точкой пересечения видно настоящее дно, включая объекты поверх него.
  // По мере роста глубины материал перекрывает их своим цветом и оптическим дном.
  // Реальная геометрия под водой и расчётное преломление используют одно поглощение.
  // Повторное экспоненциальное гашение стирало различие между лапой и дном на отмели.
  float opacity=smoothstep(0.0,0.095,depth)*(1.0-.77*(1.0-fresnel)*transmission);
  opacity=max(opacity,foam);
  if (opacity<0.002) discard;
  gl_FragColor=vec4(color,opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function coastSeaMaterial({ level, overview, sand, sky, sunDirection, sunColor, sunlight, contacts, moonMask }) {
  const defines = { COAST_QUALITY: COAST_QUALITY[level] };
  if (overview) defines.COAST_OVERVIEW=1;
  if (sand) defines.COAST_PHOTO=1;
  const u = sky.material.uniforms;
  if (u.uPulse) defines.COAST_STORM=1;
  else if (moonMask) defines.COAST_MOON=1;
  const weather = u.uPulse ? {uSeaCloud:u.uCloud, uSeaPulse:u.uPulse, uSeaCharge:u.uCharge, uSeaStormAt:u.uStormAt} : {};
  const material = new THREE.ShaderMaterial({ defines, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent:true, depthWrite:true, fog:overview,
    uniforms: { ...contacts, ...weather,
      fogColor:{value:new THREE.Color()}, fogNear:{value:0}, fogFar:{value:0}, fogDensity:{value:0},
      uSeaTime:OCEAN_TIME, uSeaWind:OCEAN_WIND, uSeaShore:{value:SHORE_R},
      uSeaZenith:u.uTop, uSeaHorizon:u.uHorizon, uSeaHalo:u.uHalo??u.uRim,
      uSeaHaloDir:u.uHaloDir??{value:sunDirection}, uSeaMarine:u.uMarineSky??{value:0},
      uSeaSun:{value:sunDirection}, uSeaSunColor:{value:sunColor}, uSeaSunlight:{value:sunlight},
      uSeaRipples:{value:waveTexture()}, uSeaBed:{value:seabed()}, uSeaPhoto:{value:sand},
      uSeaPier:OCEAN_PIER, uSeaBoats:{value:boats}, uSeaMoonMask:{value:moonMask},
    },
  });
  material.name=overview ? 'harbor:overview-sea' : `harbor:coastal-sea:${level}`;
  return material;
}
