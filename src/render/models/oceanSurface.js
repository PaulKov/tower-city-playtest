// Длинная зыбь и перекрёстная ветровая волна вокруг острова. CPU использует те же составляющие
// для ватерлинии катеров, что и вершинный шейдер моря. Величины заданы в метрах и секундах.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { assets } from '../../assets/index.js';
import { rockGeometry } from '../menu/menuFlora.js';

export const OCEAN_WIND = { value: new THREE.Vector2() };
export const OCEAN_TIME = { value: 0 };
export const ISLAND_R = 34, BEACH_W = 12, BEACH_DROP = 0.9, WATER_Y = -0.32;
export const SHORE_R = ISLAND_R - BEACH_W*WATER_Y/BEACH_DROP;
export const OCEAN_EDGE = 260;
export const BOAT_SPOTS = [[-16.5,-50,0.3], [-7,-46,-0.25], [24,-42,0.8], [-40,-20,1.9], [40,10,-1.2], [12,-62,0.5]];
// X — ось внешнего причала, YZ — начало и конец настила, W — высота над ватерлинией.
export const OCEAN_PIER = { value: new THREE.Vector4() };
const TAU = 2 * Math.PI;
// Волновой вектор (рад/м), частота (рад/с), фаза, амплитуда зыби и прибавка от попутного ветра.
const WAVES = [
  [0.302, 0.158, 1.83, 0.45, 0.047, 0.102],
  [0.080, -0.585, 2.40, 1.82, 0.026, 0.071],
  [-0.702, 0.424, 2.84, 4.16, 0.017, 0.052],
  [1.170, 0.278, 3.43, 2.18, 0.009, 0.033],
].map(([kx, kz, speed, phase, swell, gain]) => ({ kx, kz, speed, phase, swell, gain, k: Math.hypot(kx,kz) }));

// Промеры от центра до береговой черты через 15°: песчаная коса на севере, закрытая бухта и
// каменные мысы на западе. Сплайн пересекает все промеры, производная задаёт нормаль к берегу.
const COAST = [36.5,36.6,43.7,48.8,46.2,35.7,39.3,56.5,48.7,43.6,34.8,38.8,
  47.4,42.2,40.4,50.3,48.5,39.8,36.1,37.0,41.7,44.6,38.9,39.8].map(r => r-38.267);
function coastProfile(a, derivative) {
  const n = COAST.length, f = (a/TAU+1)*n, i = Math.floor(f), t = f-i;
  const b = COAST[i%n], c = COAST[(i+1)%n];
  const m = 0.5*(c-COAST[(i+n-1)%n]), k = 0.5*(COAST[(i+2)%n]-b);
  const q = 3*(c-b)-2*m-k, s = 2*(b-c)+m+k;
  return derivative ? (m+t*(2*q+3*t*s))*n/TAU : b+t*(m+t*(q+t*s));
}
const coastOffset = a => coastProfile(a,false);
const clamp = (a) => Math.max(0, Math.min(1, a));
const smooth = (t) => t * t * (3 - 2 * t);

/** Первое приближение кратчайшего расстояния вдоль нормали к сплайну уреза. */
export function coastDistance(shore,x,z) {
  const r=Math.hypot(x,z), a=Math.atan2(z,x), radius=shore+coastOffset(a);
  return (r-radius)*radius/Math.hypot(radius,coastProfile(a,true));
}

/** x — уровень воды относительно штиля, yz — наклон по осям мира, w — прибой на гребне. */
export function sampleOcean(x, z, time, shore, wx, wz, out) {
  const r = Math.max(0.01, Math.hypot(x,z)), a = Math.atan2(z,x), d = r - shore - coastOffset(a);
  const edgeSlope = coastProfile(a,true) / r, dx = (x + z * edgeSlope) / r, dz = (z - x * edgeSlope) / r;
  const wind = Math.hypot(wx, wz), strength = Math.min(1, wind * 0.43);
  let h = 0, gx = 0, gz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i], along = (wx*w.kx + wz*w.kz) / (w.k * (wind + 0.4));
    const amp = w.swell + w.gain * strength * (0.55 + 0.45 * along);
    // Мелкая волна раньше выходит за частоту выборки дальней сетки. Гасим её до появления муара.
    const span = 18 + 23/w.k, lod = clamp((d - 13 - 24/w.k) / span), weight = 1-smooth(lod);
    const alongK = w.kx*x + w.kz*z, crossK = w.kz*x - w.kx*z;
    // Огибающая движется медленнее гребней. Поперечное возмущение укорачивает их и изгибает фронт.
    const side = 0.19*crossK + w.phase - 0.13*w.speed*time, bend = Math.sin(side), turn = 0.19*Math.cos(side);
    const phase = alongK - w.speed*time + w.phase + 0.85*bend;
    const packet = 0.17*alongK + 0.26*crossK - 0.095*w.speed*time + 1.7*w.phase + 0.48*bend;
    const envelope = 0.53 + 0.40*Math.sin(packet), packetSlope = 0.40*Math.cos(packet);
    const basic = amp*Math.sin(phase), height = basic*envelope, slope = amp*envelope*Math.cos(phase)*weight;
    const group = basic*weight*packetSlope;
    const fadeSlope = -height * 6 * lod * (1-lod) / span;
    h += weight * height;
    gx += slope*(w.kx+0.85*turn*w.kz) + group*(0.17*w.kx+(0.26+0.48*turn)*w.kz) + fadeSlope*dx;
    gz += slope*(w.kz-0.85*turn*w.kx) + group*(0.17*w.kz-(0.26+0.48*turn)*w.kx) + fadeSlope*dz;
  }
  const shoal = clamp((d + 1.5) / 10.5), level = 0.22 + 0.78 * smooth(shoal);
  const terrainSlope = h * 0.78 * (6 / 10.5) * shoal * (1 - shoal);
  gx = gx * level + terrainSlope * dx; gz = gz * level + terrainSlope * dz; h *= level;
  let foam = 0;
  if (d < 23) {
    const delta = d - 1.65, envelope = Math.exp(-0.047 * delta * delta), compression = 1+0.22*Math.abs(d);
    const arc = 0.24*x + 0.15*z, p = (1.03+0.29/compression)*d + 1.86*time + 0.061*x - 0.087*z + 0.4*Math.sin(arc);
    const crest = Math.cos(p), shape = 0.85*crest + 0.15*(2*crest*crest - 1);
    const patch = 0.18*x - 0.13*z + 0.26*time, pocket = 0.27*x + 0.31*z - 0.34*time;
    const alongShore = 0.62 + 0.24*Math.sin(patch) + 0.12*Math.sin(pocket);
    const base = (0.039 + 0.115*strength)*envelope, amp = base * alongShore;
    const slope = -amp * (0.85 + 0.60*crest) * Math.sin(p), turn = 0.4 * Math.cos(arc);
    h += amp * shape;
    const coastalFrequency = 1.03+0.29/(compression*compression), frontSlope = 0.094*delta*amp*shape;
    const patchSlope = 0.24*Math.cos(patch), pocketSlope = 0.12*Math.cos(pocket);
    gx += slope*(coastalFrequency*dx+0.061+0.24*turn)-frontSlope*dx + base*shape*(0.18*patchSlope+0.27*pocketSlope);
    gz += slope*(coastalFrequency*dz-0.087+0.15*turn)-frontSlope*dz + base*shape*(-0.13*patchSlope+0.31*pocketSlope);
    foam = envelope * smooth(clamp((alongShore-0.29)/0.56)) * (0.11+0.89*strength)
      * smooth(clamp((crest+0.17*Math.sin(p)-0.38)/0.56));
  }
  return out.set(h, gx, gz, foam);
}

const glWave = (w) => `oceanBand(p,t,d,edge,wind,windLen,power,vec2(${w.kx},${w.kz}),${w.k.toFixed(8)},${w.speed.toFixed(3)},${w.phase},${w.swell},${w.gain},wave);`;
export const OCEAN_GLSL = `
  const float coastRadii[24] = float[24](${COAST.map(r=>r.toFixed(4)).join(',')});
  vec2 oceanCoast(float a) {
    float f = (a/6.28318530718 + 1.0)*24.0, t = fract(f); int i = int(f);
    float b = coastRadii[i%24], c = coastRadii[(i+1)%24];
    float m = 0.5*(c-coastRadii[(i+23)%24]), k = 0.5*(coastRadii[(i+2)%24]-b);
    float q = 3.0*(c-b)-2.0*m-k, s = 2.0*(b-c)+m+k;
    return vec2(b+t*(m+t*(q+t*s)),(m+t*(2.0*q+3.0*t*s))*(24.0/6.28318530718));
  }
  float oceanShoreDistance(vec2 p, float shore) { return length(p) - shore - oceanCoast(atan(p.y,p.x)).x; }
  vec4 shoreRunup(vec2 p,float t,float d,float power) {
    float phase = (1.03+0.29/(1.0+0.22*abs(d)))*d + 1.86*t
      + dot(p,vec2(0.061,-0.087)) + 0.4*sin(dot(p,vec2(0.24,0.15)));
    float envelope = exp(-0.047*(d-1.65)*(d-1.65));
    float groupPhase = dot(p,vec2(0.18,-0.13))+0.26*t, pocket = dot(p,vec2(0.27,0.31))-0.34*t;
    float alongShore = 0.62+0.24*sin(groupPhase)+0.12*sin(pocket);
    return vec4(phase,envelope*(0.039+0.115*power),alongShore,envelope);
  }
  void oceanBand(vec2 p, float t, float d, vec2 edge, vec2 wind, float windLen, float power, vec2 k, float freq, float speed,
                 float phase, float swell, float gain, inout vec3 wave) {
    float along = dot(wind,k) / (freq*(windLen+0.4));
    float amp = swell + gain*power*(0.55+0.45*along);
    vec2 sideK = vec2(k.y,-k.x);
    float alongK = dot(p,k), crossK = dot(p,sideK);
    float side = 0.19*crossK + phase - 0.13*speed*t, bend = sin(side), turn = 0.19*cos(side);
    float ph = alongK - speed*t + phase + 0.85*bend;
    float packet = 0.17*alongK + 0.26*crossK - 0.095*speed*t + 1.7*phase + 0.48*bend;
    float envelope = 0.53+0.40*sin(packet), basic = amp*sin(ph), h = basic*envelope;
    vec2 slope = amp*envelope*cos(ph)*(k+0.85*turn*sideK) + basic*0.40*cos(packet)*(0.17*k+(0.26+0.48*turn)*sideK);
    float span = 18.0+23.0/freq, lod = clamp((d-13.0-24.0/freq)/span,0.0,1.0);
    float weight = 1.0-lod*lod*(3.0-2.0*lod);
    wave += vec3(h*weight, slope*weight - h*6.0*lod*(1.0-lod)/span*edge);
  }
  vec4 oceanSurface(vec2 p, float t, float shore, vec2 wind) {
    float r = max(0.01,length(p)); vec2 coast = oceanCoast(atan(p.y,p.x));
    float d = r-shore-coast.x, edgeSlope = coast.y/r;
    vec2 edge = (p + vec2(p.y,-p.x)*edgeSlope) / r;
    float windLen = length(wind), power = min(1.0,windLen*0.43);
    vec3 wave = vec3(0.0);
    ${WAVES.map(glWave).join('\n    ')}
    float shoal = clamp((d+1.5)/10.5,0.0,1.0);
    float level = 0.22 + 0.78 * shoal*shoal*(3.0-2.0*shoal);
    wave.yz = wave.yz * level + wave.x * 0.78 * (6.0/10.5) * shoal*(1.0-shoal) * edge;
    wave.x *= level;
    float foam = 0.0;
    if (d < 23.0) {
      vec4 runup=shoreRunup(p,t,d,power);
      float delta=d-1.65, ph=runup.x, base=runup.y, alongShore=runup.z;
      float crest = cos(ph), shape = 0.85*crest + 0.15*(2.0*crest*crest-1.0);
      vec2 patchK=vec2(0.18,-0.13), pocketK=vec2(0.27,0.31), arcK=vec2(0.24,0.15);
      float patchSlope=0.24*cos(dot(p,patchK)+0.26*t), pocketSlope=0.12*cos(dot(p,pocketK)-0.34*t);
      float amp=base*alongShore, slope=-amp*(0.85+0.60*crest)*sin(ph);
      float compression=1.0+0.22*abs(d), coastalFrequency=1.03+0.29/(compression*compression);
      wave.x += amp*shape;
      wave.yz += slope*(coastalFrequency*edge+vec2(0.061,-0.087)+0.4*cos(dot(p,arcK))*arcK)-0.094*delta*amp*shape*edge;
      wave.yz += base*shape*(patchSlope*patchK+pocketSlope*pocketK);
      foam = runup.w * smoothstep(0.29,0.85,alongShore) * (0.11+0.89*power)
        * smoothstep(0.38,0.94,crest+0.17*sin(ph));
    }
    return vec4(wave,foam);
  }
`;

/** Кольца с частым шагом в полосе прибоя, затем редеют к затянутому дымкой горизонту.
 * Внутри суши вода отсутствует; одна индексированная сетка для всей видимой акватории. */
export function oceanGeometry(shore, y, lite = false, overview = false) {
  const sides = overview ? (lite ? 64 : 96) : (lite ? 144 : 224);
  const rings = overview ? [-3.1,-1.1,-0.3,0.35,1.3,2.6,4.3,6.5,9,12.3,18.5,27,38,55,76,104]
    : lite ? [-3.1,-1.7,-0.8,-0.25,0.25,0.8,1.4,2.2,3.2,4.7,6.5,9,12.3,16,23.2,29,37,45,58,74,93,115]
      : [-3.1,-2.25,-1.55,-0.95,-0.55,-0.22,0.12,0.46,0.82,1.2,1.66,2.2,2.9,3.7,4.7,5.8,7,8.4,10,12.3,15.1,18.5,23.2,29,37,45,58,74,93,115];
  rings.push(178-shore,216-shore,OCEAN_EDGE-shore);
  const vertices = sides*rings.length, pos = new Float32Array(3*vertices), normal = new Float32Array(3*vertices);
  const depth = new Float32Array(2*vertices), ix = new Uint16Array(6*sides*(rings.length-1));
  for (let j = 0; j < rings.length; j++) for (let i = 0; i < sides; i++) {
    const a = i*TAU/sides, offset = coastOffset(a);
    const r = shore + rings[j] + offset*(1-smooth(clamp((rings[j]-18)/85))), v = j*sides+i;
    const x = r*Math.cos(a), z = r*Math.sin(a);
    pos[3*v] = x; pos[3*v+1] = y; pos[3*v+2] = z; normal[3*v+1] = 1;
    depth[2*v] = y-beachFloor(ISLAND_R,shore,BEACH_DROP,y,x,z);
    depth[2*v+1] = (r-shore-offset)*r/Math.hypot(r,coastProfile(a,true));
    if (j === rings.length-1) continue;
    const b = j*sides+(i+1)%sides, c = v+sides, d = b+sides;
    let k = 6 * (i*(rings.length-1)+j);
    ix[k++] = v; ix[k++] = b; ix[k++] = c; ix[k++] = c; ix[k++] = b; ix[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3)); g.setAttribute('normal',new THREE.BufferAttribute(normal,3));
  g.setAttribute('aOceanDepth',new THREE.BufferAttribute(depth,2)); g.setIndex(new THREE.BufferAttribute(ix,1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.boundingBox.min.y -= 0.6; g.boundingBox.max.y += 0.6; g.boundingSphere.radius += 0.6;
  return g;
}

/** Сектора уложены подряд в одном индексе. Фрустум отсекает невидимые дуги одним drawRange,
 * в том числе всё море, когда в кадре только центр города. На границе индекса возможен запас секторов. */
export function oceanCulling(shore, waterY) {
  const n = 16, sectors = [], point = new THREE.Vector3();
  const inner = shore+Math.min(...COAST)-4.3;
  for (let i = 0; i < n; i++) {
    const box = new THREE.Box3();
    for (const r of [inner,OCEAN_EDGE]) for (const a of [i*TAU/n,(i+1)*TAU/n]) {
      box.expandByPoint(point.set(r*Math.cos(a),waterY-0.6,r*Math.sin(a)));
      box.expandByPoint(point.set(r*Math.cos(a),waterY+0.6,r*Math.sin(a)));
    }
    sectors.push(box);
  }
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), last = new THREE.Matrix4();
  let previous = null;
  return (mesh,camera) => {
    if (!camera?.isCamera) return;
    pv.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    if (previous === mesh.geometry && pv.equals(last)) return;
    previous = mesh.geometry; last.copy(pv);
    frustum.setFromProjectionMatrix(pv, camera.coordinateSystem, camera.reversedDepth);
    let first = n, end = 0;
    for (let i = 0; i < n; i++) if (frustum.intersectsBox(sectors[i])) { first = Math.min(first,i); end = i+1; }
    mesh.visible = end > first;
    const size = mesh.geometry.index.count/n;
    mesh.geometry.setDrawRange(first*size, Math.max(0,end-first)*size);
  };
}

const COAST_SIDES = 384;
function grassyRim(inner, shore, a) {
  const dryWidth = 4.0 + 1.48*Math.cos(3*a+0.8) + 0.93*Math.sin(5*a-0.7)
    + 0.43*Math.cos(12*a) + 0.27*Math.sin(26*a) + 0.15*Math.cos(53*a-0.4);
  return Math.max(inner-0.66 + 0.31*Math.sin(7*a+0.3), shore+coastOffset(a)-dryWidth);
}
function duneHeight(inner, grassR, a) {
  const dock = Math.sin(a)<-0.45 ? smooth(clamp((Math.abs(grassR*Math.cos(a)+12)-1.8)/3.4)) : 1;
  return dock*smooth(clamp((grassR-inner)/4.5)) * (0.57 + 1.04*(0.5+0.5*Math.cos(3*a-0.6)));
}
const DUNE_RINGS = [0,0.32,0.65,0.87,1];

/** Высота травянистого мыса по радиальным рёбрам сетки. За его сухой границей — море или пляж. */
export function islandLawnHeight(inner, shore, x, z, margin) {
  const r = Math.hypot(x,z);
  if (r < inner-1.7-margin) return 0;
  const angle = Math.atan2(z,x), edge = grassyRim(inner,shore,angle);
  if (r + margin > edge) return -Infinity;
  const start = inner-1.7;
  if (r <= start) return 0;
  const t = (r-start)/(edge-start);
  const crest = duneHeight(inner,edge,angle);
  const rise = fraction => smooth(clamp((start+fraction*(edge-start)-inner)/Math.max(0.01,edge-inner)));
  for (let i=1; i<DUNE_RINGS.length; i++) {
    const lo=DUNE_RINGS[i-1], hi=DUNE_RINGS[i];
    if (t<=hi) return crest*(rise(lo)+(rise(hi)-rise(lo))*(t-lo)/(hi-lo));
  }
  return crest;
}
function beachHeight(t, a, upper, waterY, drop, width) {
  const slope = (0.087 + 0.027*Math.sin(4*a+0.7) + 0.012*Math.cos(11*a-0.25))*drop/BEACH_DROP;
  const curve = 0.016, damping = 0.032;
  if (t >= 1) {
    const d = (t-1)*width;
    return waterY-d*(slope+curve*d/(1+damping*d));
  }
  // У обеих сторон уреза совпадают наклон и кривизна. Кубическая поправка
  // поднимает только дальнюю часть пляжа до отметки дюны с нулевым наклоном.
  const u = 1-t, d = width*u, span = 1+damping*width;
  const raise = upper-waterY-width*(slope-curve*width/span);
  const turn = width*(slope-curve*width*(2+damping*width)/(span*span));
  const swale = Math.sin(Math.PI*t);
  return waterY+d*(slope-curve*d/(1+damping*d))+u*u*u*(raise+(3*raise+turn)*t)
    + swale*swale*swale*(0.016+0.025*Math.sin(4*a+0.7));
}

/** Песок и кромка воды по профилю, из которого построены кольца beachGeometry. */
export function beachFloor(inner, shore, drop, waterY, x, z) {
  const a = Math.atan2(z, x), edge = grassyRim(inner, shore, a);
  const width = shore + coastOffset(a) - edge;
  const t = (Math.hypot(x, z) - edge) / width;
  return t >= 0 ? beachHeight(t, a, duneHeight(inner, edge, a), waterY, drop, width)
    : islandLawnHeight(inner, shore, x, z, 0);
}

export function beachBank(shore, angle) {
  const r = shore + coastOffset(angle), dr = coastProfile(angle, true);
  const c = Math.cos(angle), s = Math.sin(angle), len = Math.hypot(r, dr);
  return { x: r * c, z: r * s, nx: -(r * c + dr * s) / len, nz: -(r * s - dr * c) / len };
}

/** Заросли на расширенных мысах. Растения ставятся на ту же высоту, что и склон под их корнями. */
export function addDunePlants(plants, inner, shore) {
  const rng = createRng(89251);
  for (const angle of [-2.33,-0.78,0.69,1.82,2.06,3.11]) {
    for (let i=0;i<6;i++) {
      const a = angle+rng.uniform(-0.095,0.095), edge = grassyRim(inner,shore,a);
      const r = edge-rng.uniform(0.45,3.7);
      if (r <= inner+1 || (Math.sin(a)<0 && Math.abs(r*Math.cos(a)+12)<2.6)) continue;
      const x = r*Math.cos(a), z = r*Math.sin(a);
      if (plants.some(p => (p.x-x)**2 + (p.z-z)**2 < (0.6*p.s+0.53)**2)) continue;
      const y = duneHeight(inner,edge,a)*smooth(clamp((r-inner)/(edge-inner)));
      // Песчаный склон ломает плоскость круглой тени; здесь её заменяют трава и собственные тени листьев.
      plants.push({ kind:'bush', variant:i%2, x, y:y-0.07, z,
        ry:rng.uniform(0,TAU), s:rng.uniform(0.78,1.55), color:i%3 ? '#6ba25e' : '#8eaa69', blob:false });
    }
  }
}

/** Плоскость улиц доходит до нерегулярной гряды приморских дюн. У кромки её вершины общие с профилем пляжа. */
export function islandGroundGeometry(inner, shore) {
  const positions = [0,0,0], uv = [inner/6,inner/6], index = [], rings = DUNE_RINGS;
  for (let j = 0; j < rings.length; j++) for (let i = 0; i < COAST_SIDES; i++) {
    const a = i*TAU/COAST_SIDES, grassR = grassyRim(inner,shore,a), t = rings[j];
    const r = inner-1.7 + t*(grassR-inner+1.7);
    const x = r*Math.cos(a), z = r*Math.sin(a);
    const rise = smooth(clamp((r-inner)/Math.max(0.01,grassR-inner)));
    const y = duneHeight(inner,grassR,a)*rise;
    positions.push(x,y,z); uv.push((inner+x)/6, (inner-z)/6);
    const v = 1+j*COAST_SIDES+i, b = v-i+(i+1)%COAST_SIDES;
    if (!j) index.push(0,b,v);
    if (j+1 < rings.length) index.push(v,b,v+COAST_SIDES, v+COAST_SIDES,b,b+COAST_SIDES);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(index); g.computeVertexNormals();
  return g;
}


/** Короткие группы песколюба на сухой берме. Отдельные побеги имеют основание и загнутый наружу кончик. */
function beachGrass(add, ix, rng, x, y, z, size, overview) {
  const foot = new THREE.Color('#607340'), tip = new THREE.Color('#aca96b');
  for (let i=0;i<13;i++) {
    const a = rng.uniform(0,TAU), c = Math.cos(a), s = Math.sin(a), spread = size*rng.uniform(0.1,0.72);
    const bx = x+0.28*spread*c, bz = z+0.28*spread*s, h = size*rng.uniform(0.40,1);
    const w = size*rng.uniform(0.013,0.032);
    if (overview && i%3!==0) continue;
    const n = add(bx-s*w,y,bz+c*w,foot);
    add(bx+s*w,y,bz-c*w,foot); add(bx+c*spread*0.40-s*w,y+h*0.72,bz+s*spread*0.40+c*w,tip);
    add(bx+c*spread*0.40+s*w,y+h*0.72,bz+s*spread*0.40-c*w,tip); add(bx+c*spread,y+h,bz+s*spread,tip);
    ix.push(n,n+2,n+1,n+1,n+2,n+3,n+2,n+4,n+3);
  }
}

/** Мелководный профиль с дюной, бермой, полосой влажного песка и отдельными выходами породы. */
export function beachGeometry(inner, width, drop, waterY, overview = false) {
  const pos = [], color = [], surface = [], uv = [], ix = [], c = new THREE.Color();
  const upperSand = new THREE.Color('#d8c294'), lowerSand = new THREE.Color('#e5d4ae'), fringe = new THREE.Color('#8f9b62');
  const shore = inner - width*waterY/drop, rng = createRng(23947);
  // Оба LOD повторяют граничное кольцо газона и общие отметки дна. Частые рёбра
  // около уреза поддерживают плавное движение линии пересечения на низкой камере.
  const sides = overview ? COAST_SIDES/2 : COAST_SIDES;
  const dryRings = overview ? [0,0.14,0.36,0.61,0.78,0.9,1] : [0,0.07,0.14,0.25,0.36,0.48,0.61,0.70,0.78,0.84,0.9,0.95,1];
  const bottom = overview ? [0.7,2.4,5.4,9.5,15.5,23,32,45] : [0.31,0.7,1.27,2.4,3.7,5.4,7.3,9.5,12.3,15.5,19,23,27.3,32,38,45];
  const rings = dryRings.length+bottom.length;
  function add(x,y,z,shade,sand=0,moisture=0) {
    const id = pos.length/3; pos.push(x,y,z); color.push(shade.r,shade.g,shade.b);
    uv.push(x*0.74,z*0.74); surface.push(sand,moisture); return id;
  }
  for (let j = 0; j < rings; j++) for (let i = 0, count = j ? sides : COAST_SIDES; i < count; i++) {
    const a = i*TAU/count, grassR = grassyRim(inner,shore,a), strand = shore+coastOffset(a), span = strand-grassR;
    const t = j<dryRings.length ? dryRings[j] : 1+bottom[j-dryRings.length]/span;
    const r = grassR+span*t, y = beachHeight(t,a,duneHeight(inner,grassR,a),waterY,drop,span);
    const capillary = 1-smooth(clamp((y-waterY-0.032)/0.13));
    c.copy(upperSand).lerp(lowerSand,smooth(clamp(t/0.72)));
    const grass = 1-smooth(clamp(t/(0.09+0.10*(1+Math.sin(26*a+0.70*Math.sin(9*a))))));
    c.lerp(fringe,grass*0.88).multiplyScalar(1+0.028*Math.sin(13*a+8*t)+0.016*Math.cos(49*a-3*t));
    const id = add(r*Math.cos(a),y,r*Math.sin(a),c,1,capillary);
    if (!j && overview) {
      // Два отрезка кромки газона сходятся в один отрезок второго кольца.
      if (i%2===0) {
        const a = COAST_SIDES+i/2, b = COAST_SIDES+(i/2+1)%sides;
        ix.push(id,id+1,a,id+1,b,a,id+1,(i+2)%count,b);
      }
    } else if (j+1<rings) {
      const b = id-i+(i+1)%count;
      ix.push(id,b,id+sides,id+sides,b,b+sides);
    }
  }
  // Выходы не образуют обод: только на трёх выступающих мысах, размеры уменьшаются к воде.
  const stones = [1,3,6,9].map(v=>rockGeometry(v,overview?9:18,overview?5:10));
  const pale = new THREE.Color('#afa894'), dark = new THREE.Color('#838379');
  for (const a0 of [-2.28,-0.75,1.85]) {
    const strike = a0 + 0.88;
    for (let i=0;i<10;i++) {
      const a = a0+rng.uniform(-0.072,0.072), t = rng.uniform(0.59,1.31);
      const grassy = grassyRim(inner,shore,a), r = grassy+(shore+coastOffset(a)-grassy)*t;
      const size = rng.uniform(0.29,1.22)*(1.65-0.72*t), yaw = strike+rng.uniform(-0.52,0.52);
      const rock = stones[i%stones.length], p = rock.attributes.position, col = rock.attributes.color, base = pos.length/3;
      for (let k=0;k<p.count;k++) {
        const u = 2.5*size*p.getX(k), v = 1.65*size*p.getZ(k);
        const x = r*Math.cos(a) + u*Math.cos(yaw)-v*Math.sin(yaw), z = r*Math.sin(a) + u*Math.sin(yaw)+v*Math.cos(yaw);
        const sand = beachFloor(inner,shore,drop,waterY,x,z);
        const h = sand + size*(1.24*p.getY(k) - 0.08);
        c.copy(dark).lerp(pale,0.30+0.67*smooth(clamp((h-waterY)/0.43)));
        c.multiplyScalar(0.67+1.07*col.getX(k)+0.13*Math.sin(18*p.getY(k)+4*p.getX(k)));
        add(x,h,z,c);
      }
      for(let k=0;k<rock.index.count;k++) ix.push(base+rock.index.getX(k));
    }
  }
  for (const rock of stones) rock.dispose();
  for (const a0 of [-2.18,-1.55,-0.95,-0.06,0.77,1.35,2.44]) for (let i=0;i<15;i++) {
    const a = a0+rng.uniform(-0.12,0.12), t = rng.uniform(0.035,0.39), grassy = grassyRim(inner,shore,a);
    const span = shore+coastOffset(a)-grassy;
    const r = grassy+span*t, y = beachHeight(t,a,duneHeight(inner,grassy,a),waterY,drop,span);
    beachGrass(add,ix,rng,r*Math.cos(a),y-0.015,r*Math.sin(a),rng.uniform(0.16,0.54),overview);
  }
  if (!overview) {
    // Отлив раскладывает мелкую гальку и створки в коротких скоплениях на берме.
    const drift = createRng(563810), shell = new THREE.Color('#d9bda1'), pebble = new THREE.Color('#898174');
    for (const a0 of [-2.86,-1.95,-1.47,-0.61,0.38,0.91,1.98,2.40]) for (let i=0;i<14;i++) {
      const a = a0+drift.uniform(-0.043,0.043), strand = shore+coastOffset(a), span = strand-grassyRim(inner,shore,a);
      const r = strand-span*drift.uniform(0.09,0.49), x = r*Math.cos(a), z = r*Math.sin(a);
      const y = beachFloor(inner,shore,drop,waterY,x,z), yaw = drift.uniform(0,TAU), size = drift.uniform(0.025,0.095);
      const valve = i%4===0, count = valve ? 10 : 7, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const crown = add(x,y+size*(valve ? 0.31 : 0.45),z,c.copy(valve ? shell : pebble).multiplyScalar(drift.uniform(0.94,1.14)));
      for (let k=0;k<count;k++) {
        const angle = k*TAU/count, u = size*Math.cos(angle)*(valve ? 0.78 : 1), v = size*Math.sin(angle);
        const px = x+u*cos-v*sin, pz = z+u*sin+v*cos;
        const edge = beachFloor(inner,shore,drop,waterY,px,pz);
        c.copy(valve ? shell : pebble).multiplyScalar(valve && k%2===0 ? 0.89 : 0.74);
        add(px,edge-size*0.05,pz,c);
        ix.push(crown,crown+1+(k+1)%count,crown+1+k);
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(color,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('aBeach',new THREE.Float32BufferAttribute(surface,2));
  g.setIndex(ix); g.computeVertexNormals(); return g;
}

let fallbackSand = null;
const beachMaterials = new WeakMap();
function sandGrain() {
  if (fallbackSand) return fallbackSand;
  const size = 128, data = new Uint8Array(size*size*4), rng = createRng(657942);
  for (let z=0;z<size;z++) for (let x=0;x<size;x++) {
    const i = 4*(z*size+x), u=x*TAU/size, v=z*TAU/size, grain = rng.next();
    const ripple = Math.sin(6*v+Math.sin(2*u+v)+0.8*Math.cos(2*u-v));
    const h = 224+9*ripple+5*Math.sin(2*u+3*v)+17*(grain-0.5) - (grain<0.075 ? 26 : 0);
    data[i] = h; data[i+1] = h-2; data[i+2] = h-4; data[i+3] = 255;
  }
  const map = new THREE.DataTexture(data,size,size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
  fallbackSand = map;
  return map;
}

export function beachMaterial(store = assets, detailed = true) {
  const photo = store.tryGet('terrain.sand'), map = photo?.albedo ?? sandGrain();
  let variants = beachMaterials.get(map);
  if (!variants) beachMaterials.set(map,variants=new Map());
  if (variants.has(detailed)) return variants.get(detailed);
  const material = new THREE.MeshStandardMaterial({vertexColors:true, map, roughness:0.96,
    normalMap:photo?.normal ?? null, roughnessMap:photo?.roughness ?? null, normalScale:new THREE.Vector2(0.66,0.66),
    bumpMap:photo ? null : map, bumpScale:0.018});
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms,{uBeachTime:OCEAN_TIME,uBeachWind:OCEAN_WIND});
    const vary = '\nattribute vec2 aBeach; varying vec4 vBeach; varying vec2 vBeachMeters;\n';
    shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>'+vary+
      'uniform float uBeachTime; uniform vec2 uBeachWind;\n'+OCEAN_GLSL)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        const float shore=${SHORE_R.toFixed(8)}, waterY=${WATER_Y.toFixed(4)};
        vBeachMeters=position.xz;
        float dryY=position.y-waterY;
        float film=0.0, retained=0.0;
        if (aBeach.x>0.5 && dryY>-0.27 && dryY<0.27) {
          float d=oceanShoreDistance(position.xz,shore);
          float power=min(1.0,length(uBeachWind)*0.43);
          vec4 runup=shoreRunup(position.xz,uBeachTime,d,power);
          float wetY=oceanSurface(position.xz,uBeachTime,shore,uBeachWind).x;
          film=wetY;
          // Фаза показывает, сколько времени прошло с последнего гребня.
          // Память хранится в аналитической огибающей, без накопительного буфера.
          float age=mod(runup.x,6.2831853)/1.86;
          float peak=runup.y*runup.z+0.028, latest=smoothstep(-0.047,0.031,peak-dryY);
          retained=latest*(0.24+0.76*exp(-age/0.78));
        }
        vBeach=vec4(aBeach,film-dryY,retained);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec4 vBeach; varying vec2 vBeachMeters;')
      .replace('#include <map_fragment>', `float sandWet=0.0;
      if (vBeach.x > 0.5) {
        float sediment=sin(dot(vBeachMeters,vec2(1.27,0.63))+1.35*sin(dot(vBeachMeters,vec2(0.33,-0.84))));
        float flooded=smoothstep(-0.040,0.022,vBeach.z+0.017*sediment);
        sandWet=clamp(max(flooded,0.44*vBeach.y+0.61*vBeach.w)*(0.95+0.09*sediment),0.0,1.0);
        vec3 sand = texture2D(map,vMapUv).rgb;
        diffuseColor.rgb *= ${photo ? 'mix(vec3(1.0), sand*1.85, 0.78)' : 'sand'};
        diffuseColor.rgb *= mix(vec3(0.98+0.035*sediment),vec3(0.55,0.53,0.46),sandWet);
      }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
        if (vBeach.x > 0.5) {
          #ifdef USE_ROUGHNESSMAP
            roughnessFactor *= 0.45 + 0.55*texture2D(roughnessMap,vRoughnessMapUv).g;
          #endif
          roughnessFactor *= mix(1.0,0.41,sandWet);
        }`)
      .replace('#include <normal_fragment_maps>',`if (vBeach.x > 0.5) {
        vec3 baseNormal=normal;
        #include <normal_fragment_maps>
        normal=normalize(mix(baseNormal,normal,1.0-0.63*sandWet));
        ${detailed ? `float grainPhase=dot(vBeachMeters,vec2(7.4,19.5))+1.1*sin(dot(vBeachMeters,vec2(2.8,-3.1)));
          float ripple=cos(grainPhase)*(1.0-smoothstep(0.37,1.4,fwidth(grainPhase)))*mix(0.018,0.007,sandWet);
          normal=normalize(normal+mat3(viewMatrix)*vec3(ripple*0.36,0.0,ripple*0.93));` : ''}
      }`)
      .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
        material.specularColor*=mix(0.93,1.34,sandWet);`);
  };
  material.customProgramCacheKey = () => `${photo ? 'shore:sand-photo' : 'shore:sand-grain'}:${detailed}`;
  variants.set(detailed,material);
  return material;
}
