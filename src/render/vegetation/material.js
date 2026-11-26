// Материал растений (спецификация «Растительность» §5.5): один на пресет. high — MeshStandardMaterial (roughness 0,9,
// отражения неба, alphaToCoverage: MSAA есть только на high), medium и low — MeshLambertMaterial (рассеянный свет неба
// Lambert в r186 получает сам — план, отличие 1). Атлас масок, цвет vColor · mix(1, instanceColor, aTint) · светлота
// атласа, ветер (define VEG_WIND), растворение по aFade и шуму IGN (§8.3), просвет листвы против солнца.
// Вариант травы (define VEG_GRASS): слот пучка — gl_InstanceID, раскладку, цвет и ветер считает вершинный шейдер.
// Общие uniforms VEG_UNIFORMS обновляет поле (field.js).
import * as THREE from 'three';
import { vertexCubeUV } from '../diffuseSky.js';
import { bakedTexture } from './baked.js';
import { customMat } from '../materials.js';
import { vegetationAtlas, ATLAS_RECTS, generationStamp, finishGeneration } from './atlas.js';
import { GRASS } from './kinds.js';
import { palmFiberTexture, palmFrondMask } from './palm.js';
import { mapleBarkMap } from './maple.js';

/** Время, обе компоненты ветра в мировых осях X/Z, направление на солнце и сила просвета. */
export const VEG_UNIFORMS = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2() },
  uSunDir: { value: new THREE.Vector3(14, 24, 11).normalize() },
  uTrans: { value: 0.35 },
};
/** Множитель цвета лёгкого материала: средняя яркость кроны medium как у high в пределах 3 % (план, Task 12). */
export const VEG_LITE_GAIN = 1.138;
/** Изгиб при единичном ветре и полной гибкости, в метрах геометрии растения. */
export const WIND_AMP = { plant: 0.15, grass: 0.1 };
/** Трава (план, Task 19): маска газонов, точка фокуса, палитра темы и цвета цветов; их выставляет трава перед кадром. */
export const GRASS_TILE = 10, GRASS_DISTANCE = 40;
export const GRASS_UNIFORMS = {
  uGrassMask: { value: null },
  uGrassFocus: { value: new THREE.Vector2() },
  uGrassPalette: { value: [new THREE.Color('#86cf62'), new THREE.Color('#7cc45a'), new THREE.Color('#93d76d')] },
  uGrassFlowers: { value: [new THREE.Color('#ffffff'), new THREE.Color('#ffd84d')] },
  uGrassFlowerRate: { value: GRASS.flowers },
};

/** Замена куска шейдера; нет куска (другая версия three) — ошибка, а не тихо неисправленный шейдер. */
function swap(src, from, to) {
  if (!src.includes(from)) throw new Error('vegetation shader patch: no ' + from);
  return src.replace(from, to);
}

/** Весь куст или ветвь гнётся за порывом. Отдельная волна шевелит только свободные концы гроздей. */
export const FOLIAGE_WIND = `
uniform float uTime;
uniform vec2 uWind;
float branchPressure( vec2 root ) {
  return 0.72 + 0.44 * sin( uTime * 1.6 + dot( root, vec2( 0.21, 0.14 ) ) );
}
float leafFlutter( vec2 root, vec3 leaf ) {
  return 0.10 * sin( uTime * 4.7 + dot( root, vec2( 0.31, 0.23 ) ) + dot( leaf, vec3( 2.1, 1.3, 0.8 ) ) );
}
`;

const VS_DECL = `
#ifdef VEG_MAPLE_BARK
attribute vec4 aMapleBark;
varying vec4 vMapleBark;
varying vec4 vMapleCollar;
#endif
attribute float aFlex;
attribute float aTint;
#ifdef VEG_AUTUMN
attribute vec2 aFade;
attribute vec4 aAutumnTarget;
#else
attribute float aFade;
#endif
uniform vec3 uSunDir;
#if (defined( VEG_CROWN ) && defined( VEG_WIND )) || defined( VEG_BARK )
attribute float aTip;
#endif
#ifdef VEG_BARK
varying float vBarkProfile;
#endif
#ifdef VEG_FLOWERS
varying vec3 vPetalTint;
#endif
varying float vFade;
varying float vTint;
`;
// Смещение в мировых осях применяется после матрицы экземпляра. Поворот растения меняет лишь его позу.
const AUTUMN_VARYING = `
#ifdef VEG_AUTUMN_FAR
varying float vLeafLoss;
#endif
`;

const WIND = `
#ifdef VEG_BARK
vBarkProfile = aTip < -1.5 ? -1.0 : max(0.0,-aTip);
#endif
#ifdef VEG_MAPLE_BARK
vMapleBark=aMapleBark;
vMapleCollar=vec4(position,normal.x*normal.x/max(.001,dot(normal.xz,normal.xz)));
#endif
#ifdef VEG_SNOWBANK
vSnowHeight = position.y;
#endif
vec2 vegOffset = vec2( 0.0 );
#if defined( USE_INSTANCING ) || defined( VEG_GRASS )
#ifdef VEG_GRASS
  vec2 vegRoot = ( modelMatrix * vec4( vegGrassPos.x, 0.0, vegGrassPos.y, 1.0 ) ).xz;
  float vegScale = vegGrassS;
#else
  vec2 vegRoot = ( modelMatrix * instanceMatrix[ 3 ] ).xz;
  float vegScale = length( instanceMatrix[ 0 ].xyz );
#endif
  float vegBend = aFlex * aFlex * VEG_AMP * branchPressure( vegRoot );
#if defined( VEG_WIND ) && defined( VEG_CROWN )
  #if defined( VEG_BARK ) || defined( VEG_BARK_GRAIN )
    vegBend += max(0.0,aTip) * leafFlutter( vegRoot, position );
  #else
    vegBend += aTip * leafFlutter( vegRoot, position );
  #endif
#elif defined( VEG_WIND ) && defined( VEG_GRASS )
  vegBend += aFlex * VEG_AMP * leafFlutter( vegRoot, position );
#endif
  vegOffset = uWind * ( vegScale * vegBend );
#endif
#ifdef VEG_AUTUMN
  float rank = aAutumnTarget.w;
  float shed = smoothstep(0.16 + 0.43 * rank, 0.59 + 0.36 * rank, aFade.y);
  transformed += aAutumnTarget.xyz * shed;
  vFade = aFade.x;
  #ifdef VEG_AUTUMN_FAR
    vLeafLoss = aFade.y * aTint;
  #endif
#else
  vFade = aFade;
#endif
vTint = aTint;
`;

const glf = (v) => Number(v).toFixed(6);
const vec4 = (r) => `vec4( ${r.map(glf).join(', ')} )`;
// Слот i → ячейка мира: фокус привязан к шагу, хеш берётся от целых координат ячейки, поэтому при движении фокуса
// трава стоит на месте. Пучок вне газона, вне маски или за кругом r получает масштаб 0 и схлопывается в точку.
const GRASS_DECL = `
#ifdef VEG_GRASS
uniform sampler2D uGrassMask;
uniform vec2 uGrassFocus;
uniform vec3 uGrassPalette[ 3 ];
uniform vec3 uGrassFlowers[ 2 ];
uniform float uGrassFlowerRate;
attribute vec2 aGrassTile;
const int vegGrassTile = ${GRASS_TILE};
const float vegGrassStep = ${glf(GRASS.step)};
vec2 vegGrassPos;
float vegGrassS;
float vegGrassHeight;
float vegGrassRot;
float vegGrassFlower;
float vegGrassBlade;
vec3 vegGrassColor;
float vegGrassRand( uvec2 c, uint k ) {
  uint h = c.x * 1597334677u ^ c.y * 3812015801u ^ k * 2654435761u;
  h ^= h >> 16u; h *= 2246822519u; h ^= h >> 13u; h *= 3266489917u; h ^= h >> 16u;
  return float( h & 65535u ) / 65535.0;
}
void vegGrassSlot() {
  ivec2 local = ivec2(gl_InstanceID % vegGrassTile, (gl_InstanceID / vegGrassTile) % vegGrassTile);
  ivec2 cell = ivec2( round( uGrassFocus / vegGrassStep ) ) + ivec2(aGrassTile) + local;
  uvec2 c = uvec2( cell + 32768 );
  vegGrassPos = ( vec2( cell ) + vec2( vegGrassRand( c, 1u ), vegGrassRand( c, 2u ) ) ) * vegGrassStep;
  float edge = 1.0 - smoothstep( ${glf(GRASS.r * (1 - GRASS.fade))}, ${glf(GRASS.r)}, distance( vegGrassPos, uGrassFocus ) );
  vec2 inside = step( abs( vegGrassPos ), vec2( ${glf(GRASS.mask)} ) );
  float lawn = texture2D( uGrassMask, vegGrassPos / ${glf(2 * GRASS.mask)} + 0.5 ).r * inside.x * inside.y;
  float seed = vegGrassRand( c, 3u ), pick = vegGrassRand( c, 4u );
  float patchValue = sin( dot(vegGrassPos,vec2(0.63,0.31)) + 1.6*sin(vegGrassPos.y*0.47-vegGrassPos.x*0.15) );
  float close = 1.0-smoothstep(21.0,${glf(GRASS_DISTANCE)},distance(cameraPosition,vec3(vegGrassPos.x,0.0,vegGrassPos.y)));
  vegGrassS = smoothstep(0.26,0.58,lawn) * edge * close * mix(0.68,1.21,seed) * (0.91+0.17*patchValue);
  vegGrassHeight = (0.43+0.61*lawn+0.12*patchValue) * (0.84+0.36*pick);
  vegGrassBlade = step(0.84,seed);
  vegGrassRot = fract( seed*7.812 + pick )*6.2831853;
  vegGrassFlower = 1.0 - step( uGrassFlowerRate, fract( pick*37.103 ) );
  vegGrassColor = vegGrassFlower > 0.5 ? uGrassFlowers[ int( pick * 1.999 ) ] : uGrassPalette[ int( pick * 2.999 ) ];
}
#endif
`;
const GRASS_SLOT = `
#ifdef VEG_GRASS
vegGrassSlot();
#endif
`;
// пучок-цветок берёт участок цветов атласа вместо участка травы
const GRASS_UV = `
#if defined( VEG_GRASS ) && defined( USE_MAP )
if (uv.x < -1.5) {
  vMapUv.x=-uv.x-2.0;
  if (vegGrassBlade>.5) {
#ifdef VEG_COASTAL_GRASS
    vMapUv.x=-1.;
#else
    vMapUv.x=.75+(vMapUv.x-.75)*.025;
#endif
  }
}
if ( vegGrassFlower > 0.5 && uv.x >= 0.0 ) {
  vec4 vegG = ${vec4(ATLAS_RECTS.grass)}, vegF = ${vec4(ATLAS_RECTS.flower)};
  vMapUv = vegF.xy + ( vMapUv - vegG.xy ) * ( vegF.zw - vegF.xy ) / ( vegG.zw - vegG.xy );
}
#endif
`;
const GRASS_COLOR = `
#ifdef VEG_GRASS
vColor.rgb *= vegGrassColor;
if (vegGrassFlower > 0.5 && uv.x < 0.0) vColor.rgb = color * uGrassPalette[1];
#endif
`;
const GRASS_PLACE = `
#ifdef VEG_GRASS
{
  float vegC = cos( vegGrassRot ), vegS = sin( vegGrassRot );
  if (vegGrassFlower > 0.5 && uv.x >= 0.0) transformed *= 0.53;
  if (uv.x < -1.5 && vegGrassBlade > 0.5) transformed.z *= 0.037;
  transformed = vec3( vegC * transformed.x + vegS * transformed.z, transformed.y*vegGrassHeight, vegC * transformed.z - vegS * transformed.x ) * vegGrassS;
  transformed.xz += vegGrassPos;
}
#endif
`;
// В развёртке 0,96 × 1,52 м. Расщелины разного возраста, края отставших пластин и
// глазки сучков запекаются один раз. Mip-фильтр одновременно усредняет цвет и высоту.
let barkTexture;
export function broadleafBarkTexture() {
  const ready = bakedTexture('flora.broadleaf-bark', 'broadleaf-bark-relief', { repeat: true, linear: true, anisotropy: 4 });
  if (ready) return ready;
  if (barkTexture) return barkTexture;
  const stamp = generationStamp();
  const width = 256, height = 384, data = new Uint8Array(width * height * 4);
  const relief = new Float32Array(width * height);
  let seed = 53249;
  const random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
  // Периодическая решётка: последние клетки продолжаются с другого края карты.
  const wrap = (v, n) => (v % n + n) % n;
  const grid = (nx, ny, components = 1) => {
    const values = Float32Array.from({ length: nx * ny * components }, random);
    return (x, y, c = 0) => values[(wrap(y, ny) * nx + wrap(x, nx)) * components + c];
  };
  const wave = (nx, ny) => {
    const sample = grid(nx, ny);
    return (u, v) => {
      const x = u*nx, y = v*ny, i = Math.floor(x), j = Math.floor(y);
      const fx = x-i, fy = y-j, a = fx*fx*(3-2*fx), b = fy*fy*(3-2*fy);
      const low = sample(i,j)*(1-a) + sample(i+1,j)*a;
      return low*(1-b) + (sample(i,j+1)*(1-a) + sample(i+1,j+1)*a)*b;
    };
  };
  const plates = (nx, ny) => {
    const site = grid(nx,ny,2), pitch = nx+2;
    const xs = new Float32Array(pitch*(ny+2)), ys = new Float32Array(xs.length);
    for (let j=-1; j<=ny; j++) for (let i=-1; i<=nx; i++) {
      const k = (j+1)*pitch+i+1;
      xs[k] = i+0.16+0.68*site(i,j); ys[k] = j+0.12+0.76*site(i,j,1);
    }
    return (u, v) => {
      const x = (u-Math.floor(u))*nx, y = (v-Math.floor(v))*ny, col = Math.floor(x), row = Math.floor(y);
      let first = Infinity, second = Infinity;
      for (let j=row; j<row+3; j++) for (let i=col; i<col+3; i++) {
        const k = j*pitch+i, dx = xs[k]-x, dy = ys[k]-y;
        const d = dx*dx + dy*dy;
        if (d < first) { second = first; first = d; } else if (d < second) second = d;
      }
      return Math.sqrt(second) - Math.sqrt(first);
    };
  };
  const coarse = wave(5,5), drift = wave(9,13), fibres = wave(88,43), chip = wave(48,35);
  const cracks = plates(15,4), splits = plates(41,9), ridges=plates(6,2);
  const knots = [[0.23,0.42,0.042,0.065], [0.77,0.78,0.031,0.048], [0.54,0.075,0.020,0.029]];
  const sat = (x) => Math.max(0, Math.min(1, x));
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const u = (i+0.5)/width, v = (j+0.5)/height;
    const slow = coarse(u,v), bend = drift(u,v), grain = fibres(u,v), flake = chip(u,v), grit = random()-0.5;
    let flow = u+0.089*(slow-0.5)+0.033*(bend-0.5)+0.003*(flake-0.5);
    let scar = 0, lip = 0;
    for (const [x,y,rx,ry] of knots) {
      const dx = (u-x)/rx, dy = (v-y)/ry;
      if (Math.abs(dx) > 2.1 || Math.abs(dy) > 2.1) continue;
      const r = Math.hypot(dx+0.19*dy+0.23*(bend-0.5), dy);
      flow -= rx*dx*0.93*sat(1-r/2.1)**2;
      const eye = sat(1.0-r*1.65), rim = sat(1-Math.abs(r-0.8)*5);
      scar += 0.46*eye + 0.20*rim;
      lip += 0.19*sat(1-Math.abs(r-1.04)*4)*(0.65+0.35*dy);
    }
    const c = cracks(flow,v+0.09*(drift(u+0.3,v)-0.5)+0.018*(flake-0.5));
    const f = splits(flow+0.012*(grain-0.5),v+0.08*(slow-0.5));
    const trench = sat(1-c/(0.17+0.09*bend))**1.6;
    const fine = sat(1-f/0.25)**1.35 * sat(0.14+1.28*flake);
    const edge = sat(1-Math.abs(c-0.21)*7) * (0.45+0.55*bend);
    // Старая кора расходится на длинные пластины шириной с ладонь; их тень
    // остаётся видна, когда на субпиксельные волокна уже приходятся мип-уровни.
    const gap=ridges(flow+.048*(bend-.5),v+.14*(slow-.5));
    const cleft=sat(1-gap/.29)**1.34*(.62+.38*bend), shoulder=sat(1-Math.abs(gap-.39)*4.2);
    const plate=.24*(slow-.5)+.12*shoulder-.32*cleft;
    const h = 0.61 + 0.13*(slow-0.5)+0.11*(flake-0.5)+0.09*(grain-0.5)+0.032*grit
      - 0.45*trench - 0.21*fine + 0.12*edge - scar + lip + .68*plate;
    const tone = 0.48+0.25*(slow-0.5)+0.15*(bend-0.5)+0.18*(flake-0.5)+0.13*(grain-0.5)+0.058*grit
      -0.37*trench-0.17*fine+0.17*edge-0.8*scar+lip+plate;
    const k = 4*(i+j*width);
    relief[k/4] = h;
    data[k+2] = 255*sat(tone);
    data[k+3] = 255*sat(0.35+0.75*(slow-0.5)+0.42*(flake-0.5)+0.23*edge);
  }
  // Наклоны фильтруются до освещения. Разность высот в экранных квадратах 2×2
  // давала ступеньки на ветвях при увеличении и искры под скользящим светом.
  for (let j=0; j<height; j++) for (let i=0; i<width; i++) {
    const k = i+j*width;
    const u = (relief[j*width+wrap(i+1,width)]-relief[j*width+wrap(i-1,width)]) * width/(2*0.96);
    const v = (relief[wrap(j+1,height)*width+i]-relief[wrap(j-1,height)*width+i]) * height/(2*1.52);
    data[4*k] = Math.round(255*sat(0.5+u/128)); data[4*k+1] = Math.round(255*sat(0.5+v/128));
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.name = 'broadleaf-bark-relief';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4; texture.needsUpdate = true;
  finishGeneration(stamp);
  return barkTexture = texture;
}

export const BROADLEAF_BARK = `
uniform sampler2D uBroadleafBark;
void floraBark(vec2 uv, float ageProfile, vec3 positionView, float depth, inout vec3 diffuse, inout vec3 n) {
  vec2 grainUv = uv, collarSlope = vec2(0.0);
  float eye = 0.0, lip = 0.0, check = 0.0;
  if (ageProfile < -0.5) {
    // Одна зажившая развилка в развёртке ствола. Волокна расходятся вокруг
    // оставшейся сердцевины и снова сходятся над ней, под наплывом видна тень.
    vec2 d = uv-vec2(4.8,3.1);
    if (abs(d.x)<0.36 && abs(d.y)<0.47) {
      vec2 p = vec2((d.x-0.18*d.y)/0.106,d.y/0.160);
      p.x *= 1.0+0.10*clamp(p.y,-1.0,1.0);
      float r = max(length(p),0.001), envelope = exp(-0.73*r*r);
      grainUv.x -= 0.94*(d.x-0.18*d.y)*envelope;
      grainUv.y += 0.048*envelope*(0.62+p.y);
      float roundLip = exp(-12.0*(r-0.82)*(r-0.82));
      lip = roundLip*(0.80+0.20*clamp(p.x,-1.0,1.0));
      eye = 1.0-smoothstep(0.28,0.78,r);
      // Мелкий косой раскол старого среза исчезает под зарастающей кромкой.
      float slit = abs(p.x+0.23*p.y-0.09*sin(6.0*p.y)-0.045*sin(12.0*p.y));
      check = (1.0-smoothstep(0.025,0.14+fwidth(p.x),slit))*eye;
      vec2 dr = vec2(p.x/0.106,p.y/0.160-0.18*p.x/0.106)/r;
      collarSlope = dr*(0.50*lip*(-24.0)*(r-0.82) + 0.30*r*exp(-2.0*r*r));
    }
  }
  vec4 wood = texture(uBroadleafBark, grainUv * vec2(1.0/0.96, 1.0/1.52));
  float youth = max(0.0,ageProfile), luma = dot(diffuse,vec3(0.2126,0.7152,0.0722));
  vec3 mature = mix(diffuse,vec3(luma*1.12,luma,luma*.89),.43+.38*wood.a) * (.43+1.21*wood.b);
  vec3 shoot = mix(diffuse,vec3(1.68,1.00,0.53)*luma,0.56) * (1.05+0.35*wood.a);
  vec3 heart = mix(mature,vec3(1.45,1.04,0.71)*luma,0.37*eye);
  diffuse = mix(heart,shoot,youth) * (1.0+0.068*lip-0.20*eye-0.26*check);
  vec2 slope = 128.0*(wood.rg-vec2(0.5))*mix(1.0,0.075,youth);
  vec3 dx = dFdx(positionView), dy = dFdy(positionView);
  vec3 nx = cross(dy,n), ny = cross(n,dx);
  float det = dot(dx,nx);
  float hx = dot(slope,dFdx(grainUv))+dot(collarSlope,dFdx(uv));
  float hy = dot(slope,dFdy(grainUv))+dot(collarSlope,dFdy(uv));
  n = normalize(max(abs(det),1e-12)*n-sign(det)*depth*(hx*nx+hy*ny));
}
`;
const FS_DECL = `
#ifdef VEG_BARK_GRAIN
uniform sampler2D uBroadleafBark;
#endif
#ifdef VEG_BARK
varying float vBarkProfile;
#endif
#ifdef VEG_MAPLE_BARK
uniform sampler2D uMapleBark;
varying vec4 vMapleBark;
varying vec4 vMapleCollar;
#endif
#ifdef VEG_BARK
${BROADLEAF_BARK}
#endif
uniform vec3 uSunDir;
uniform float uTrans;
#ifdef VEG_FLOWERS
varying vec3 vPetalTint;
#endif
varying float vFade;
varying float vTint;
`;

// Координаты пальмы задаёт геометрия: 0..1 вдоль отдельного листочка, 2..3 вдоль целой вайи,
// ниже −3 по стволу. Частые прожилки и прорези усредняются по площади пикселя.
const PALM_VARYING = '\n#ifdef VEG_PALM\nvarying vec2 vPalmUv;\n#endif\n';
const PALM_BARK = `
#ifdef VEG_PALM_FAR
uniform sampler2D uPalmFrond;
#elif defined( VEG_PALM )
uniform sampler2D uPalmFibers;
float palmHash( vec2 p ) {
  vec3 h = fract( p.xyx * vec3( 0.1031, 0.1099, 0.0973 ) );
  h += dot( h, h.yzx + 19.19 );
  return fract( ( h.x + h.y ) * h.z );
}
// Шум замыкается по окружности, частота по высоте независима.
float palmNoise( vec2 p, float period ) {
  vec2 ij = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float x = mod( ij.x, period ), next = mod( ij.x + 1.0, period );
  float n = mix( mix( palmHash( vec2( x, ij.y ) ), palmHash( vec2( next, ij.y ) ), f.x ),
                 mix( palmHash( vec2( x, ij.y + 1.0 ) ), palmHash( vec2( next, ij.y + 1.0 ) ), f.x ), f.y );
  vec2 footprint = fwidth( p );
  return mix( n, 0.5, smoothstep( 0.31, 1.20, max( footprint.x, footprint.y ) ) );
}
vec4 palmBark( float u, float h ) {
  float weather = palmNoise( vec2( 5.0 * u, 3.1 * h ), 5.0 );
  float strand = palmNoise( vec2( 27.0 * u + 1.1 * weather, h * 5.3 ), 27.0 );
  float growth = 5.74*h + 0.28*sin(h*3.6) + 0.18*weather;
  float id = floor(growth);
  float around = fract(u - .381966*id + .5) - .5;
  float arc = 2.0*abs(around);
  float center = .32 + .22*palmHash(vec2(id,13.7)) + .30*arc*arc + .12*strand;
  float d = fract(growth) - center;
  float cover = (1.0-smoothstep(.18,.92,arc))*smoothstep(.02,.69,strand);
  float shield = (1.0-smoothstep(.036,.27,abs(d-.10)))*cover;
  // У бывшего листового основания пучки обходят утолщение. Затёртая
  // поверхность рубца светлее и глаже волокон, которые огибают его края.
  float sweep = sin(6.283185*around)*shield;
  // Отдельные длинные волокна, короткие надломы и тени между пучками.
  // Одна выборка с mip-фильтрацией сохраняет матовый характер коры на расстоянии.
  float fibers = texture2D(uPalmFibers, vec2(u + .008*weather + .023*sweep, .81*h + .016*strand - .012*shield)).r;
  float worn = shield * smoothstep(.13,.56,weather);
  fibers = mix(fibers,.50,worn*.72);
  // Древесные волокна расходятся и обрываются; редкие светлые лубяные пучки сочетаются с тёмными бороздами.
  float splits = ( 1.0 - smoothstep( 0.17, 0.39, fibers ) ) * smoothstep( 0.19, 0.73, strand );
  float weathered = smoothstep( 0.28, 0.72, 0.63 * weather + 0.37 * strand );
  float fiberLight = smoothstep( 0.47, 0.82, fibers ) * ( 0.36 + 0.64 * weathered );
  vec3 grain = mix( vec3( 0.76, 0.72, 0.65 ), vec3( 1.19, 1.20, 1.16 ), weathered );
  grain *= 0.95 + 0.30 * ( strand - 0.5 ) + 0.94 * (fibers - 0.5) + 0.17 * fiberLight - 0.21 * splits;
  grain *= mix(vec3(.91,.92,.89),vec3(1.12,1.04,.92),smoothstep(.38,.71,fibers));

  // Сброшенный лист оставляет рваный серп вокруг части ствола. Направление и сохранность
  // каждого следующего рубца свои; промежутки между ними занимают продольные волокна коры.
  float aa = fwidth( growth );
  float detail = 1.0 - smoothstep( 0.22, 0.75, aa );
  float mark = 1.0 - smoothstep( 0.008, 0.058 + 0.47 * aa, abs( d ) );
  float edge = 1.0 - smoothstep( 0.012, 0.078 + 0.40 * aa, abs( d - 0.069 ) );
  grain *= mix(vec3(1.0),vec3(1.17,1.10,.98),worn);
  grain *= 1.0 + 0.09 * shield + cover * detail * ( 0.17 * edge - 0.34 * mark );
  float young = smoothstep( 2.50, 2.76, h );
  float relief = 0.0028 * strand + 0.0014 * fiberLight - 0.0017 * splits + .0025*(fibers-.5)
    + cover * detail * ( 0.0010 * edge - 0.0018 * mark );
  return vec4( mix( grain, vec3( 1.0 + 0.035 * ( strand - 0.5 ) ), young ), ( 1.0 - young ) * relief );
}
#endif
`;
const PALM_SURFACE = `
#ifdef VEG_PALM_FAR
  if ( vPalmUv.y >= 2.0 ) {
    vec4 feather = texture2D( uPalmFrond, vec2( 0.5 + 0.5 * vPalmUv.x, vPalmUv.y - 2.0 ) );
    diffuseColor.a *= feather.a;
    diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.28 * feather.r ), vec3( 0.30, 0.36, 0.09 ), 0.60 * feather.g );
  }
#elif defined( VEG_PALM )
  float palmRelief = 0.0;
  if ( vPalmUv.y >= 0.0 ) {
    float s = vPalmUv.x, ds = fwidth( s );
    float midrib = 1.0 - smoothstep( 0.015, 0.050 + ds * 0.45, abs( s ) );
    float fibers = cos( 118.0*s+13.*vPalmUv.y+2.*s*s ) * (1.-smoothstep(.012,.061,ds));
    diffuseColor.rgb *= .92+.12*smoothstep(-.10,.09,s)+.052*fibers;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.41, 0.49, 0.15 ), 0.32 * midrib );
  } else if ( vPalmUv.y <= -3.0 ) {
    vec4 barkSample = palmBark( vPalmUv.x, -3.0 - vPalmUv.y );
    diffuseColor.rgb *= barkSample.rgb;
    palmRelief = barkSample.a;
  }
#endif
`;
const PALM_NORMAL = `
#if defined( VEG_PALM ) && !defined( VEG_PALM_FAR )
  if ( vPalmUv.y <= -3.0 ) {
    vec3 dx = dFdx( -vViewPosition ), dy = dFdy( -vViewPosition );
    vec3 nx = cross( dy, normal ), ny = cross( normal, dx );
    float det = dot( dx, nx );
    normal = normalize( max( abs( det ), 1.0e-12 ) * normal - sign( det ) * ( nx * dFdx( palmRelief ) + ny * dFdy( palmRelief ) ) );
  }
#endif
`;
// Выборка атласа безусловная (производные для mip-уровней), сплошные части (uv = -1) берут белый тексель.
const MAP = `
#ifdef USE_MAP
#ifdef VEG_MAPLE_BARK
  vec4 vegTexel; vec2 mapleSlope=vec2(0.); vec3 mapleTone=vec3(1.);
  vec2 mapleNormalUv=vMapleBark.xy;
  if (vTint<.5) {
    vec3 relief=texture2D(uMapleBark,vMapleBark.xy).rgb;
    // В подмышке волокна двух осей пересекаются. Локальная проекция продолжается
    // с обеих сторон шва, вдоль самостоятельных ветвей работает обычная развёртка.
    if (vMapleBark.w>.001) {
      vec3 p=vMapleCollar.xyz;
      vec2 a=vec2(p.x/.54+.21*p.z,(p.y+.36*p.z)/.68);
      vec2 b=vec2(p.z/.54-.19*p.x,(p.y+.38*p.x)/.68);
      float axis=smoothstep(.16,.84,vMapleCollar.w);
      vec3 grain=mix(texture2D(uMapleBark,a).rgb,texture2D(uMapleBark,b).rgb,axis);
      relief=mix(relief,grain,vMapleBark.w);
      mapleNormalUv=mix(mapleNormalUv,mix(a,b,step(.5,axis)),vMapleBark.w);
    }
    mapleSlope=(2.*relief.gb-1.)*vMapleBark.z*(1.-.60*vMapleBark.w);
    float worn=vMapleBark.z*smoothstep(.43,.88,relief.r);
    mapleTone=mix(vec3(1.045,.956,.90),vec3(.955,1.039,1.11),worn)*mix(.88,.38+.91*relief.r,vMapleBark.z);
    vegTexel=vec4(1.);
  } else { vegTexel=texture2D(map,vMapUv); }
#elif defined( VEG_BARK_GRAIN )
  vec4 vegTexel;
  if (vMapUv.x <= -2.0) {
    vec4 bark = texture2D(uBroadleafBark,vec2((-2.0-vMapUv.x)/0.96,vMapUv.y/1.52));
    float luma = dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
    diffuseColor.rgb = mix(diffuseColor.rgb,vec3(1.12,1.,.89)*luma,.43+.38*bark.a)*(.43+1.21*bark.b);
    vegTexel = vec4(1.);
  } else { vegTexel=texture2D(map,vMapUv); }
#elif defined( VEG_SPRUCE )
  float spruceHeight = 0.0;
  vec4 vegTexel;
  if (vMapUv.x <= -2.0) {
    // Два участка коры в общем атласе. Производные целых координат сохраняют
    // масштаб mipmap у их границы и вдоль продольного шва ствола.
    vec2 p = vec2(-2.0 - vMapUv.x, vMapUv.y / 0.96);
    vec2 tile = fract(p);
    float halfTile = step(0.5, tile.y);
    vec2 at = (vec2(528.0 + 512.0 * halfTile, 560.0) + 384.0 * vec2(tile.x, tile.y - 0.5 * halfTile)) / 2048.0;
    vec3 plate = textureGrad(map, at, dFdx(p) * 0.1875, dFdy(p) * 0.1875).rgb;
    diffuseColor.rgb *= 0.23 + 1.42 * plate;
    spruceHeight = plate.g;
    vegTexel = vec4(1.0);
  } else { vegTexel = texture2D(map, vMapUv); }
#elif defined( VEG_SHRUB )
  // Развёртка объёма в метрах, один отсчёт. Производные берутся до зеркального
  // повтора, чтобы лист не менял масштаб на стыке и плавно исчезал в mipmap.
  vec4 vegTexel;
  if (vMapUv.x>2.) {
    vec2 at=vec2(vMapUv.x-16.,vMapUv.y);
    vec2 tile=abs(fract(.5*at)*2.-1.);
    vec2 span=vec2(.239);
    vegTexel=textureGrad(map,vec2(.755,.005)+tile*span,dFdx(at)*span,dFdy(at)*span);
    // У края луч проходит только через наружные листья. В середине кроны
    // просвет перекрывают листья в глубине. Вдали щели усредняет mipmap.
    float depth=abs(dot(normalize(vNormal),normalize(vViewPosition)));
    vegTexel.a=mix(smoothstep(.15,.23,vegTexel.g),1.,smoothstep(.04,.51,depth));
  } else { vegTexel=texture2D(map,vMapUv); }
#else
  vec4 vegTexel=texture2D(map,vMapUv);
#endif
#ifdef VEG_AUTUMN_FAR
  // Порог облетания хранится в том же текселе, что и зерно листьев.
  if (vLeafLoss > vegTexel.b) discard;
  vegTexel.rgb = vegTexel.rrr;
#endif
#ifdef VEG_NEEDLES
// В одной выборке лежат летнее освещение хвоинок и снег на верхней стороне
// той же веточки. Три плоскости глубины читают прежнюю миниатюру целого дерева.
if (vMapUv.x>=0. && vMapUv.x<.25) {
  vegTexel.a*=mix(1.,smoothstep(.04,.74,vegTexel.b),vTint);
  vec3 winterNeedle=mix(vec3(.25,.38,.33),vec3(.68,.73,.74),smoothstep(.18,.55,vegTexel.r));
  diffuseColor.rgb*=mix(winterNeedle,vec3(1.),vTint);
  vegTexel.rgb=vec3(mix(vegTexel.r,vegTexel.g,vTint));
}
#endif
#ifdef VEG_FLOWERS
// Белые лепестки ромашек берут цвет посадки. Зелёные стебли и жёлтая сердцевина сохраняют цвет атласа.
float chroma = max( max( vegTexel.r, vegTexel.g ), vegTexel.b ) - min( min( vegTexel.r, vegTexel.g ), vegTexel.b );
vegTexel.rgb *= mix( vPetalTint, vec3( 1.0 ), smoothstep( 0.02, 0.12, chroma ) );
#elif defined( VEG_CROWN )
// Атлас содержит собственную окклюзию. Основной перепад света даёт форма всей кроны:
// слишком тёмные прожилки между листьями зрительно обособляют каждую плоскую гроздь.
float leafLuma = dot( vegTexel.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
vegTexel.rgb = vec3( min( 0.43, 0.05 + 2.0 * leafLuma ) + 1.28 * leafLuma );
#ifdef VEG_DECIDUOUS
vegTexel.rgb = max(vec3(.035),vegTexel.rgb*1.13-.065);
#endif
#endif
#ifdef VEG_MAPLE_BARK
  if(vTint<.5) vegTexel.rgb=mapleTone;
#endif
diffuseColor *= vMapUv.x < 0.0 ? vec4( 1.0 ) : vegTexel;
#endif
`;
const FADE = `
#ifdef VEG_SNOWBANK
// На тонком краю сквозь порошу видны цвет земли и контактная тень соседнего дерева.
diffuseColor.a *= smoothstep( -0.008, 0.10, vSnowHeight );
#endif
if ( vFade != 0.0 ) {
  float vegIgn = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  if ( vFade > 0.0 ? vegIgn < vFade : vegIgn >= - vFade ) discard;
}
`;
const TRANS = `
{
  vec3 vegL = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
  totalEmissiveRadiance += diffuseColor.rgb * uTrans * vTint * pow( max( 0.0, dot( - vegL, normalize( vViewPosition ) ) ), 4.0 );
}
`;

// Тёплый свет на верхушках и прохладная тень плавно меняются с нормалью купола. Золотистый оттенок
// сильнее у зелёной листвы; осенняя и цветущая сохраняют палитру. Цвет интерполируется по вершинам.
const CROWN_LIGHT = `
#if defined( VEG_CROWN ) && !defined( VEG_FLOWERS ) && !defined( FLAT_SHADED )
float green = clamp( 5.0 * ( vColor.g - max( vColor.r, vColor.b ) ), 0.0, 1.0 );
float sun = dot( vNormal, mat3( viewMatrix ) * uSunDir ) * 0.5 + 0.5;
vec3 daylight = mix( vec3( 1.04, 1.02, 1.0 ), vec3( 1.86, 1.12, 0.78 ), green );
#ifdef VEG_DECIDUOUS
daylight = mix(vec3(1.03,1.01,.98),vec3(1.30,1.05,.87),green);
#endif
vColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 0.96, 1.0, 1.08 ), daylight, sun * sun ), aTint );
#endif
`;

// У матовой кроны на среднем и дальнем LOD рассеянный свет неба плавно меняется
// по нормали лопасти. Берём тот же самый свёрнутый PMREM сцены в вершинах.
// Минимальная грань CubeUV имеет размер 16 texel при любом разрешении захвата.
const GROVE_SKY = `
#ifdef USE_ENVMAP
#define ENVMAP_TYPE_CUBE_UV
#include <envmap_common_pars_fragment>
#ifdef VEG_GROVE_PROBE
uniform vec3 uGroveCoeff[4];
uniform vec3 uGroveAcross;
#else
${vertexCubeUV}
#endif
varying vec3 vGroveSky;
#endif
`;

// На матовой поверхности рассеянная составляющая каждого направленного
// источника меняется плавно. Вершины считают заполнение и солнце отдельно,
// пиксель по-прежнему читает свою тень. Локальные источники требуют обычного Lambert.
const GROVE_VERTEX_LIGHT = `
#if defined(VEG_GROVE_PROBE) && NUM_POINT_LIGHTS == 0 && NUM_SPOT_LIGHTS == 0 && NUM_SUN_LIGHTS == 0 && NUM_RECT_AREA_LIGHTS == 0 && NUM_DIR_LIGHT_SHADOWS <= 1 && !defined(USE_LIGHT_PROBES) && !defined(USE_LIGHT_PROBES_GRID)
#define VEG_VERTEX_LIGHT
varying vec3 vGroveFill;
varying vec3 vGroveSun;
#endif
`;
function patchGroveLight(shader) {
  shader.vertexShader = swap(shader.vertexShader, '#include <envmap_pars_vertex>',
    '#include <envmap_pars_vertex>\n' + GROVE_SKY + GROVE_VERTEX_LIGHT +
    '\n#ifdef VEG_VERTEX_LIGHT\n#include <lights_pars_begin>\n#endif');
  shader.vertexShader = swap(shader.vertexShader, '#include <envmap_vertex>', `
#include <envmap_vertex>
#ifdef USE_ENVMAP
  vec3 groveNormal = transformNormalByInverseViewMatrix(vNormal, viewMatrix);
  #ifdef VEG_GROVE_PROBE
  vec3 n = envMapRotation * groveNormal;
  vGroveSky = envMapIntensity * (uGroveCoeff[0] + n.y * (uGroveCoeff[1] + n.y*uGroveCoeff[2])
    + dot(n,uGroveAcross)*uGroveCoeff[3]);
  #else
  vGroveSky = PI * envMapIntensity * bilinearCubeUV(envMap, envMapRotation * groveNormal, cubeUV_m0);
  #endif
#endif
#ifdef VEG_VERTEX_LIGHT
  vGroveFill = ambientLightColor;
  vGroveSun = vec3(0.);
  #ifdef USE_ENVMAP
    vGroveFill += vGroveSky;
  #endif
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
    vGroveFill += getHemisphereLightIrradiance(hemisphereLights[i],vNormal);
  }
  #pragma unroll_loop_end
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    #if defined(USE_SHADOWMAP) && UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS
    vGroveSun += directionalLights[i].color * max(0.,dot(vNormal,directionalLights[i].direction));
    #else
    vGroveFill += directionalLights[i].color * max(0.,dot(vNormal,directionalLights[i].direction));
    #endif
  }
  #pragma unroll_loop_end
  vGroveFill *= RECIPROCAL_PI;
  vGroveSun *= RECIPROCAL_PI;
#endif`);
  const maps = swap(THREE.ShaderChunk.lights_fragment_maps, 'getIBLIrradiance( geometryNormal )', 'vGroveSky');
  shader.fragmentShader = swap(shader.fragmentShader, '#include <lights_fragment_maps>', maps);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <envmap_pars_fragment>',
    '#include <envmap_pars_fragment>\n#ifdef USE_ENVMAP\nvarying vec3 vGroveSky;\n#endif\n' + GROVE_VERTEX_LIGHT);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <lights_lambert_fragment>', `
#ifdef VEG_VERTEX_LIGHT
  float canopyShadow = 1.;
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow groveShadow = directionalLightShadows[0];
    if (receiveShadow) canopyShadow = getShadow(directionalShadowMap[0],groveShadow.shadowMapSize,
      groveShadow.shadowIntensity,groveShadow.shadowBias,groveShadow.shadowRadius,vDirectionalShadowCoord[0]);
  #endif
  reflectedLight.directDiffuse = diffuseColor.rgb*(vGroveFill + canopyShadow*vGroveSun);
#else
#include <lights_lambert_fragment>`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <lights_fragment_end>', '#include <lights_fragment_end>\n#endif');
  // Один аппаратно фильтрованный отсчёт вместо пяти повёрнутых отсчётов PCF.
  // Координаты, уклон, интенсивность и проверку границ карты оставляет three.
  const shadow = THREE.ShaderChunk.shadowmap_pars_fragment;
  const first = shadow.indexOf('vec2 texelSize', shadow.indexOf('float getShadow( sampler2DShadow'));
  const end = shadow.indexOf(') * 0.2;', first) + ') * 0.2;'.length;
  if (first < 0 || end <= first) throw new Error('Неизвестный фильтр PCF для дальней листвы');
  shader.fragmentShader = swap(shader.fragmentShader, '#include <shadowmap_pars_fragment>',
    shadow.slice(0, first) + 'shadow = texture(shadowMap, shadowCoord.xyz);' + shadow.slice(end));
}

function patch(shader) {
  Object.assign(shader.uniforms, VEG_UNIFORMS, GRASS_UNIFORMS);
  if (this.userData.groveProbe) {
    shader.uniforms.uGroveCoeff = { value: this.userData.groveProbe.coeff };
    shader.uniforms.uGroveAcross = { value: this.userData.groveProbe.across };
  }
  if (Object.hasOwn(this.defines, 'VEG_MAPLE_BARK')) shader.uniforms.uMapleBark = { value: mapleBarkMap() };
  if (Object.hasOwn(this.defines, 'VEG_BARK') || Object.hasOwn(this.defines, 'VEG_BARK_GRAIN')) shader.uniforms.uBroadleafBark = { value: broadleafBarkTexture() };
  if (Object.hasOwn(this.defines, 'VEG_PALM_FAR')) shader.uniforms.uPalmFrond = { value: palmFrondMask() };
  else if (Object.hasOwn(this.defines, 'VEG_PALM')) shader.uniforms.uPalmFibers = { value: palmFiberTexture() };
  const surfaceVaryings = AUTUMN_VARYING + PALM_VARYING + '\n#ifdef VEG_SNOWBANK\nvarying float vSnowHeight;\n#endif\n';
  let vs = swap(shader.vertexShader, '#include <common>', '#include <common>' + VS_DECL + FOLIAGE_WIND + GRASS_DECL + surfaceVaryings);
  vs = swap(vs, '#include <uv_vertex>', GRASS_SLOT + '#include <uv_vertex>' + GRASS_UV + '\n#ifdef VEG_PALM\nvPalmUv = uv;\n#endif\n');
  vs = swap(vs, '#include <begin_vertex>', '#include <begin_vertex>' + GRASS_PLACE + WIND);
  vs = swap(vs, '#include <normal_vertex>', '#include <normal_vertex>' + CROWN_LIGHT);
  vs = swap(vs, '#include <project_vertex>', swap(THREE.ShaderChunk.project_vertex, 'gl_Position =',
    'mvPosition.xyz += viewMatrix[ 0 ].xyz * vegOffset.x + viewMatrix[ 2 ].xyz * vegOffset.y;\ngl_Position ='));
  vs = swap(vs, '#include <worldpos_vertex>', swap(THREE.ShaderChunk.worldpos_vertex, 'worldPosition = modelMatrix * worldPosition;',
    'worldPosition = modelMatrix * worldPosition;\nworldPosition.xz += vegOffset;'));
  shader.vertexShader = swap(vs, '#include <color_vertex>',
    swap(THREE.ShaderChunk.color_vertex, 'vColor.rgb *= instanceColor.rgb;', `
    #ifdef VEG_FLOWERS
      vPetalTint = mix( vec3( 1.0 ), instanceColor.rgb, aTint );
    #else
      vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );
    #endif`) + GRASS_COLOR);
  let fs = swap(shader.fragmentShader, '#include <common>', '#include <common>' + FS_DECL + surfaceVaryings + PALM_BARK);
  fs = swap(fs, '#include <map_fragment>', MAP + PALM_SURFACE);
  if (Object.hasOwn(this.defines,'VEG_STONE') && this.isMeshStandardMaterial) {
    fs=swap(fs,'#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 dx=dFdx(-vViewPosition), dy=dFdy(-vViewPosition);
      vec3 nx=cross(dy,normal), ny=cross(normal,dx);
      float det=dot(dx,nx);
      normal=normalize(max(1.e-12,abs(det))*normal-sign(det)*.006*(dFdx(vegTexel.g)*nx+dFdy(vegTexel.g)*ny));`);
  }
  if (Object.hasOwn(this.defines, 'VEG_SPRUCE')) {
    if (!this.isMeshLambertMaterial) fs = swap(fs, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (vMapUv.x <= -2.0) {
        vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
        vec3 nx = cross(dy, normal), ny = cross(normal, dx);
        float det = dot(dx, nx);
        normal = normalize(max(1.0e-12, abs(det)) * normal - sign(det) * 0.0025 * (dFdx(spruceHeight) * nx + dFdy(spruceHeight) * ny));
      }`);
  }
  if (Object.hasOwn(this.defines,'VEG_DECIDUOUS') && this.isMeshStandardMaterial) {
    fs = swap(fs, '#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= mix(.29,.53,vTint);');
  }
  fs = swap(fs, '#include <alphatest_fragment>', '#include <alphatest_fragment>' + FADE);
  // нормаль карточки смотрит от центра кроны с обеих сторон: обратная грань не переворачивает её
  fs = swap(fs, '#include <normal_fragment_begin>', swap(THREE.ShaderChunk.normal_fragment_begin, 'normal *= faceDirection;', '') + PALM_NORMAL);
  if (Object.hasOwn(this.defines, 'VEG_MAPLE_BARK')) fs = swap(fs, '#include <normal_fragment_maps>', `
#include <normal_fragment_maps>
if (vTint<.5) {
  vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);
  vec2 s0=dFdx(mapleNormalUv),s1=dFdy(mapleNormalUv);
  float orientation=sign(s0.x*s1.y-s0.y*s1.x);
  vec3 t=q0*s1.y-q1*s0.y, b=q1*s0.x-q0*s1.x;
  t-=normal*dot(normal,t); b-=normal*dot(normal,b);
  normal=normalize(normal*sqrt(max(.12,1.-dot(mapleSlope,mapleSlope)))+
    orientation*(mapleSlope.x*t*inversesqrt(max(1.e-16,dot(t,t)))+mapleSlope.y*b*inversesqrt(max(1.e-16,dot(b,b)))));
}`);
  if (Object.hasOwn(this.defines, 'VEG_BARK')) fs = swap(fs, '#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + BARK_RELIEF);
  shader.fragmentShader = swap(fs, '#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + TRANS);
  if (Object.hasOwn(this.defines, 'VEG_GROVE_LIGHT')) patchGroveLight(shader);
}

const BARK_RELIEF = `
#ifdef VEG_BARK
  if (vMapUv.x <= -2.0) {
    vec2 barkUv = vec2(-vMapUv.x - 2.0, vMapUv.y);
    floraBark(barkUv, vBarkProfile, -vViewPosition, 0.011, diffuseColor.rgb, normal);
  }
#endif
`;
/**
 * lite — Lambert (medium, low), wind — дополнительно шевелятся кончики листвы, grass — пучки травы.
 * floraAtlas — цветовой атлас меню; у клумб floraFlowers окрашивает только лепестки.
 * У solid силуэт образуют полигоны: пальма, валун или дальняя шапка кроны.
 */
export function vegetationMaterial({ lite = false, wind = true, grass = false, grassMap = null, floraAtlas = null, floraFlowers = false, solid = false, palm = false, palmFar = false, spruce = false, needles = false, shrub = false, stone = false, snowbank = false, groveLight = false, groveProbe = null, closedCanopy = false, autumn = false, barkRelief = false, barkGrain = false, mapleBark = false } = {}) {
  const atlas = solid ? null : floraAtlas;
  const kind = spruce ? 'spruce' : needles ? 'needles' : shrub ? 'shrub' : stone ? 'stone' : snowbank ? 'snowbank' : palm ? (palmFar ? 'palm-far' : 'palm') : solid ? 'solid' : atlas ? (floraFlowers ? 'petals' : 'leaves') : (grass ? 'grass' : 'plant');
  const bark = barkRelief && atlas;
  // Во втором ряду сухая древесина и листья получают широкий рассеянный
  // свет неба. Фактура, ветви, MSAA и ветровые веса сохраняются на high.
  const groveDiffuse = groveLight && (lite || barkGrain || mapleBark || closedCanopy);
  const key = `veg:${lite ? 'lite' : 'pbr'}:${wind ? 'wind' : 'sway'}:${kind}${groveDiffuse ? ':grove' : ''}${closedCanopy ? ':closed' : ''}${autumn ? ':autumn' : ''}${bark ? ':bark' : barkGrain ? ':grain' : ''}${mapleBark ? ':maple-bark' : ''}`;
  const map = atlas || (grass ? grassMap : null);
  const probe = groveDiffuse && groveProbe;
  return customMat(key + (map ? ':' + map.uuid : '') + (probe ? ':' + probe.key : ''), () => {
    const opts = { color: '#ffffff', vertexColors: true, side: closedCanopy || stone ? THREE.FrontSide : THREE.DoubleSide };
    if (snowbank) Object.assign(opts, { side: THREE.FrontSide, transparent: true, depthWrite: false });
    if (!solid) { opts.map = map || vegetationAtlas(); opts.alphaTest = closedCanopy || stone ? 0 : 0.5; }
    if (palm) opts.alphaTest = palmFar ? 0.44 : 0.34;
    const m = lite || groveDiffuse ? new THREE.MeshLambertMaterial(opts) : new THREE.MeshStandardMaterial({ ...opts, roughness: palm ? .84 : bark || barkGrain || mapleBark || closedCanopy || stone || shrub ? 1 : 0.9, metalness: 0 });
    if (lite || groveDiffuse) m.color.multiplyScalar(VEG_LITE_GAIN);
    if (!lite) m.alphaToCoverage = (!solid && !closedCanopy && !stone) || palm;
    m.defines = { VEG_AMP: (grass ? WIND_AMP.grass : WIND_AMP.plant).toFixed(3) };
    if (wind) m.defines.VEG_WIND = '';
    if (bark) m.defines.VEG_BARK = '';
    if (barkGrain) m.defines.VEG_BARK_GRAIN = '';
    if (bark || barkGrain || mapleBark || closedCanopy) m.defines.VEG_DECIDUOUS = '';
    if (mapleBark) m.defines.VEG_MAPLE_BARK = '';
    if (spruce) m.defines.VEG_SPRUCE = '';
    if (needles || spruce) m.defines.VEG_NEEDLES = '';
    if (stone) m.defines.VEG_STONE = '';
    if (shrub) m.defines.VEG_SHRUB = '';
    if (autumn) m.defines.VEG_AUTUMN = '';
    if (autumn && closedCanopy) m.defines.VEG_AUTUMN_FAR = '';
    if (groveDiffuse) m.defines.VEG_GROVE_LIGHT = '';
    if (probe) {
      m.defines.VEG_GROVE_PROBE = '';
      m.userData.groveProbe = probe;
    }
    if ((atlas || solid) && !stone) m.defines.VEG_CROWN = '';
    if (palm) m.defines.VEG_PALM = '';
    if (palm && palmFar) m.defines.VEG_PALM_FAR = '';
    if (snowbank) m.defines.VEG_SNOWBANK = '';
    if (atlas && floraFlowers) m.defines.VEG_FLOWERS = '';
    if (grass) m.defines.VEG_GRASS = '';
    if (grass && grassMap) m.defines.VEG_COASTAL_GRASS = '';
    m.onBeforeCompile = patch;
    m.customProgramCacheKey = () => key;
    return m;
  });
}
