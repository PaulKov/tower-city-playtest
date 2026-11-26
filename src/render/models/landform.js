// Один индексный лоскут на остров/хребет. Нулевые клетки ложа не передаются видеокарте.
// Тот же порядок треугольников использует landHeight для деревьев и каменных выходов.
import * as THREE from 'three';
import { landHeight } from '../../core/landform.js';
import { assets } from '../../assets/index.js';
import { customMat } from '../materials.js';
import { getTexture } from '../textures.js';
import { terrainDiffuseLight } from '../diffuseSky.js';

const strip = THREE.MathUtils.smoothstep;
const sat = (v) => Math.max(0, Math.min(1, v));

const DETAIL_END = 22; // Полувысота поля зрения в метрах на глубине поверхности.
let landCover;

// Одна бесшовная плитка для обоих расстояний. R — пятна стелющейся растительности,
// G — эродированный пласт породы, B — мелкая неоднородность осыпи. Масштаб в сцене 18 м.
function landCoverMap() {
  if (landCover) return landCover;
  const size = 256, data = new Uint8Array(size*size*4), field = new Float32Array(64*64);
  let seed = 0x69fa0;
  for (let i=0; i<field.length; i++) {
    seed = (Math.imul(1664525,seed)+1013904223) >>> 0;
    field[i] = seed / 4294967296;
  }
  function noise(u,v,freq) {
    const x=u*freq, y=v*freq, i=Math.floor(x), j=Math.floor(y);
    const tx=x-i, ty=y-j, sx=tx*tx*(3-2*tx), sy=ty*ty*(3-2*ty);
    const x0=((i%freq)+freq)%freq, y0=((j%freq)+freq)%freq, x1=(x0+1)%freq, y1=(y0+1)%freq;
    const a=field[64*y0+x0]*(1-sx)+field[64*y0+x1]*sx;
    const b=field[64*y1+x0]*(1-sx)+field[64*y1+x1]*sx;
    return a+(b-a)*sy;
  }
  for (let j=0;j<size;j++) for (let i=0;i<size;i++) {
    const u=i/size,v=j/size, broad=noise(u,v,4), mids=noise(u+0.27,v+0.13,14), fleck=noise(u,v,61);
    const clumps = 0.50*broad + 0.37*mids + 0.13*fleck;
    const bedding = v*6 + 2*u + 1.83*broad + 0.78*mids;
    const seam = (1-strip(Math.abs(bedding-Math.round(bedding)),0.045,0.24))*strip(broad,0.20,0.76);
    const k=4*(j*size+i);
    data[k]=Math.round(255*strip(clumps,0.30,0.71));
    data[k+1]=Math.round(255*sat(0.57+0.43*(mids-0.5)-0.32*seam+0.28*(fleck-0.5)));
    data[k+2]=Math.round(255*fleck);data[k+3]=255;
  }
  landCover=new THREE.DataTexture(data,size,size);landCover.name='terrain:land-cover';
  landCover.wrapS=landCover.wrapT=THREE.RepeatWrapping;landCover.generateMipmaps=true;
  landCover.minFilter=THREE.LinearMipmapLinearFilter;landCover.magFilter=THREE.LinearFilter;
  landCover.anisotropy=4;landCover.needsUpdate=true;return landCover;
}
const surfaceTint = `
  uniform float uCliffExposure;
  vec3 surfaceTint(float runoff, float ledge, float grains, float normalSlope) {
    float slope = smoothstep(0.05, 0.37, normalSlope);
    vec3 foliage = mix(vec3(0.71,0.77,0.72), vec3(1.13,1.10,0.99), smoothstep(0.22,0.78,runoff));
    float fracture = smoothstep(0.19, 0.76, 0.49 * ledge + 0.32 * runoff + 0.19 * grains);
    vec3 cliff = mix(vec3(0.76,0.73,0.69), vec3(1.17,1.12,1.05), fracture);
    return mix(vec3(1.0), mix(foliage, cliff, slope) * (0.82 + 0.37 * grains), uCliffExposure);
  }`;

// Линейные маски стока и слоёв усредняются до масштаба сетки, зерно — до среднего линейного альбедо.
// Снимок исходного изображения нужен один раз на версию текстуры, до первого кадра.
const grainMeans = new WeakMap();
let noiseMip;
function filteredPixels(image, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}
function meanGrain(grain) {
  if (grainMeans.has(grain)) return grainMeans.get(grain);
  const pixels = filteredPixels(grain.image, 32), color = new THREE.Color();
  let sum = 0;
  for (let i = 1; i < pixels.length; i += 4) sum += color.setRGB(0, pixels[i] / 255, 0, THREE.SRGBColorSpace).g;
  const mean = sum / (pixels.length / 4);
  grainMeans.set(grain, mean);
  return mean;
}
const NOISE_SIZE = 16;
function smoothNoise(u, v) {
  // CanvasTexture flipY=true, repeat и билинейная интерполяция вокруг центров текселей.
  const x = u * NOISE_SIZE - 0.5, y = -v * NOISE_SIZE - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy, mask = NOISE_SIZE - 1;
  const x0 = ix & mask, x1 = (ix+1) & mask, y0 = (iy & mask)*NOISE_SIZE, y1 = ((iy+1) & mask)*NOISE_SIZE;
  const a = (1-tx)*noiseMip[(y0+x0)*4] + tx*noiseMip[(y0+x1)*4];
  const b = (1-tx)*noiseMip[(y1+x0)*4] + tx*noiseMip[(y1+x1)*4];
  return (a + ty*(b-a)) / 255;
}
function bakeHorizonSamples(g) {
  noiseMip ??= filteredPixels(getTexture('cloudNoise').image, NOISE_SIZE);
  const { position, uv } = g.attributes, samples = new Uint8Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const u = uv.getX(i), v = uv.getY(i), y = position.getY(i);
    const runoff = smoothNoise(0.047*u + 0.023*y, 0.047*v - 0.018*y);
    const fx = 0.78*u + 0.63*v, fy = y + 0.21*v - 0.12*u;
    samples[i*2] = Math.round(255 * runoff);
    samples[i*2+1] = Math.round(255 * smoothNoise(0.27*fx + 0.037*fy + 0.19*runoff, 0.19*fy + 0.09*fx + 0.58*runoff));
  }
  g.setAttribute('aRockSamples', new THREE.BufferAttribute(samples, 2, true));
}

/** Цвет травянистых ложбин и выветренных пород обрыва, одна программа на весь горизонт. */
export function landformMaterial(theme = 'valley', distant = false) {
  const coastal = theme === 'harbor';
  const grain = assets.get('ground.asphalt').albedo;
  return customMat('landform:' + grain.uuid + ':' + theme + (distant ? ':horizon' : ':detail'), () => {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const mean = meanGrain(grain);
    m.onBeforeCompile = (s) => {
      s.uniforms.uMeanGrain = { value: mean };
      s.uniforms.uCliffExposure = { value: coastal ? 1 : 0.68 };
      s.uniforms.uLandCover = {value:landCoverMap()};
      s.uniforms.uLandContrast = {value:theme === 'sweet' ? 0.32 : theme === 'snow' ? 0.55 : 1};
      const coverVary = 'varying vec3 vSlopeTile;\n';
      const attrs = 'attribute vec2 aRockSamples; uniform float uMeanGrain;';
      const tone = 'vColor.rgb * surfaceTint(aRockSamples.x, aRockSamples.y, uMeanGrain, 1.0 - normal.y)';
      const varyings = 'varying vec4 vRock; varying vec3 vHorizonColor; varying float vFieldHeight;';
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + surfaceTint + attrs + coverVary + (distant ? '' : varyings))
        .replace('#include <color_vertex>', '#include <color_vertex>\n' + (distant ? 'vColor.rgb = ' : 'vHorizonColor = ') + tone + `;
          vSlopeTile = vec3((uv.x + 0.21*uv.y + 0.19*position.y)/18.0,
            (0.79*uv.y + 0.18*uv.x + 0.86*position.y)/18.0, 1.0-normal.y);`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>','#include <common>\n' + coverVary + 'uniform sampler2D uLandCover; uniform float uLandContrast;')
        .replace('#include <alphamap_fragment>', `
          vec3 cover = texture2D(uLandCover,vSlopeTile.xy).rgb;
          float rockFace = smoothstep(0.065,0.34,vSlopeTile.z);
          vec3 turf = mix(vec3(0.66,0.75,0.69),vec3(1.15,1.10,0.98),cover.r);
          vec3 bedding = vec3(0.65 + 0.64*cover.g + 0.08*cover.b);
          diffuseColor.rgb *= mix(vec3(1.0), mix(turf,bedding,rockFace),uLandContrast);
          #include <alphamap_fragment>`);
      if (distant) {
        terrainDiffuseLight(s);
        return;
      }
      s.uniforms.uStrata = { value: getTexture('cloudNoise') };
      s.uniforms.uGrain = { value: grain };
      s.vertexShader = s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vRock = vec4(uv, position.y, 1.0 - normal.y);
        vFieldHeight = (isPerspectiveMatrix(projectionMatrix) ? -mvPosition.z : 1.0) / projectionMatrix[1][1];`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>',
        '#include <common>\n' + surfaceTint + varyings + 'uniform sampler2D uStrata; uniform sampler2D uGrain;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vFieldHeight >= ${DETAIL_END}.0) {
            diffuseColor.rgb = vHorizonColor;
          } else {
            vec2 ground = vRock.xy;
            float runoff = texture2D(uStrata, ground * 0.047 + vec2(0.023, -0.018) * vRock.z).r;
            vec2 face = vec2(dot(ground,vec2(0.78, 0.63)), vRock.z + 0.21 * ground.y - 0.12 * ground.x);
            vec2 strataUV = vec2(0.27 * face.x + 0.037 * face.y, 0.19 * face.y + 0.09 * face.x);
            float ledge = texture2D(uStrata, strataUV + vec2(0.19, 0.58) * runoff).r;
            float grains = texture2D(uGrain, (0.34 * ground + 0.19 * face)).g;
            diffuseColor.rgb *= surfaceTint(runoff, ledge, grains, vRock.w);
            diffuseColor.rgb = mix(diffuseColor.rgb, vHorizonColor, smoothstep(12.0, ${DETAIL_END}.0, vFieldHeight));
          }
        `);
    };
    m.customProgramCacheKey = () => distant ? 'landform:horizon' : 'landform:detail';
    return m;
  });
}

/** Соседние хребты могут перекрываться в плане. Храним точные границы каждой отдельной сетки,
 * чтобы при повороте камеры оставить в одном вызове все потенциально видимые склоны. */
export function horizonCulling(mesh, pieces, theme) {
  const g = mesh.geometry, index = g.index.setUsage(THREE.DynamicDrawUsage);
  const source = index.array.slice(), point = new THREE.Vector3();
  let start = 0;
  const ranges = pieces.map(piece => {
    const bounds = new THREE.Box3(), p = piece.attributes.position, n = piece.index.count;
    for (let i = 0; i < n; i++) bounds.expandByPoint(point.fromBufferAttribute(p, piece.index.getX(i)));
    const indices = source.subarray(start, start+n);
    start += n;
    return { bounds, indices, visible: true };
  });
  g.setDrawRange(0, source.length);
  bakeHorizonSamples(g);
  // compile() прогревает оба материала при входе, render() видит ровно одну группу.
  mesh.material = [mesh.material, landformMaterial(theme, true)];
  g.addGroup(0, source.length, 0);
  const batch = g.groups[0];
  const view = new THREE.Matrix4(), clip = new THREE.Matrix4(), last = new THREE.Matrix4();
  const frustum = new THREE.Frustum(), upload = { start: 0, count: 0 };
  return camera => {
    if (!camera?.isCamera) return;
    camera.updateWorldMatrix(true, false);
    mesh.updateWorldMatrix(true, false);
    view.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
    clip.multiplyMatrices(camera.projectionMatrix, view);
    if (clip.equals(last)) return;
    last.copy(clip);
    frustum.setFromProjectionMatrix(clip, camera.coordinateSystem, camera.reversedDepth);
    const m = view.elements, projection = camera.projectionMatrix.elements[5];
    let changed = false, detailed = false;
    for (const range of ranges) {
      const b = range.bounds, visible = frustum.intersectsBox(b);
      if (visible !== range.visible) { changed = true; range.visible = visible; }
      if (!visible || detailed) continue;
      // Ближайшая к камере точка AABB по оси взгляда. Весь видимый горизонт может иметь
      // простой материал, только если переход к вершинному цвету завершён на каждом треугольнике.
      const depth = -m[14] - m[2]*(m[2] > 0 ? b.max.x : b.min.x)
        - m[6]*(m[6] > 0 ? b.max.y : b.min.y) - m[10]*(m[10] > 0 ? b.max.z : b.min.z);
      detailed = (camera.isPerspectiveCamera ? depth : 1) < DETAIL_END * projection;
    }
    batch.materialIndex = detailed ? 0 : 1;
    if (!changed) return;
    let count = 0;
    for (const range of ranges) if (range.visible) {
      index.array.set(range.indices, count);
      count += range.indices.length;
    }
    g.setDrawRange(0, count);
    if (count) {
      upload.count = count;
      index.clearUpdateRanges();
      index.updateRanges.push(upload);
      index.needsUpdate = true;
    }
  };
}

/** Запекаем мягкий контакт рощ только в вершины ближайшего хребта вокруг каждого основания. */
export function shadeGroveFloor(g, hills, plants) {
  const { position, color } = g.attributes;
  for (const p of plants) {
    if (p.lod !== 2) continue;
    for (const h of hills) {
      if (h.ring !== 0 || Math.abs(landHeight(h, p.x, p.z) - p.y - 0.18) > 0.025) continue;
      const radius = 2.9 * p.s, dx = p.x - h.x - 0.46 * p.s, dz = p.z - h.z - 0.33 * p.s;
      const u = ((dx * h.ca - dz * h.sa) / h.sx + 1) * h.nx / 2;
      const v = ((dx * h.sa + dz * h.ca) / h.sz + 1) * h.nz / 2;
      const rx = radius * h.nx / (2 * h.sx), rz = radius * h.nz / (2 * h.sz);
      for (let j = Math.max(0, Math.ceil(v - rz)); j <= Math.min(h.nz, v + rz); j++) {
        for (let i = Math.max(0, Math.ceil(u - rx)); i <= Math.min(h.nx, u + rx); i++) {
          const k = h.vertexStart + j * (h.nx + 1) + i;
          const x = position.getX(k) - h.x - dx, z = position.getZ(k) - h.z - dz;
          const shade = 1 - 0.47 * sat(1 - (x*x + z*z) / (radius*radius)) ** 2;
          color.setXYZ(k, color.getX(k) * shade, color.getY(k) * shade, color.getZ(k) * shade);
        }
      }
      break;
    }
  }
}

/** Все позиции мировые, UV в метрах, rock/ground/crest — цвета в рабочем пространстве three. */
export function landformGeometry(f, ground, crest, rock, snow = false) {
  const { nx, nz, table } = f, n = table.length, stride = nx + 1;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), color = new Float32Array(n * 3), indices = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = j * stride + i, u = (2 * i / nx - 1) * f.sx, v = (2 * j / nz - 1) * f.sz;
    pos[k * 3] = f.x + f.ca * u + f.sa * v;
    pos[k * 3 + 1] = f.y + table[k] * f.h;
    pos[k * 3 + 2] = f.z - f.sa * u + f.ca * v;
    uv[k * 2] = u;
    uv[k * 2 + 1] = v;
    if (i === nx || j === nz) continue;
    if (table[k] + table[k + 1] + table[k + stride] > 0) indices.push(k, k + stride, k + 1);
    if (table[k + 1] + table[k + stride] + table[k + stride + 1] > 0) indices.push(k + 1, k + stride, k + stride + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const normal = g.attributes.normal;
  const c = new THREE.Color(), base = new THREE.Color(ground), high = new THREE.Color(crest), crag = new THREE.Color(rock);
  const alpine = f.kind === 'alpine', coastal = f.kind === 'island';
  const cream = f.kind === 'cream', horizon = f.kind === 'upland' || cream || alpine || coastal;
  const hollow = base.clone().multiplyScalar(cream ? 0.82 : snow ? 0.59 : 0.36);
  const scree = crag.clone().lerp(high, cream ? 0.46 : 0.25);
  const weathered = crag.clone().multiplyScalar(cream ? 0.80 : 0.68);
  for (let k = 0; k < n; k++) {
    const u = uv[k * 2] / f.sx, v = uv[k * 2 + 1] / f.sz, y = table[k];
    const slope = 1 - normal.getY(k);
    const bands = 0.5 + 0.5 * Math.sin(17 * y + 4.3 * u - 3.1 * v);
    const rills = 0.5 + 0.5 * Math.sin(15.4 * u + 4.8 * v + Math.sin(u * 6));
    const exposed = strip(slope + 0.08 * rills, 0.09, coastal || alpine ? 0.40 : 0.55);
    c.copy(base).lerp(high, sat(0.16 + 0.55 * y + 0.10 * bands));
    c.lerp(crag, exposed * (alpine ? 1 : coastal ? 0.92 : 0.64));
    if (alpine) c.lerp(high, strip(y + 0.22 * normal.getY(k) - 0.30 * exposed, 0.42, 0.70));
    if (coastal) c.lerp(crag, 0.62 * (1 - strip(y, 0.02, 0.17)));
    if (horizon) {
      const left=table[k%stride ? k-1 : k], right=table[k%stride<nx ? k+1 : k];
      const back=table[k>=stride ? k-stride : k], front=table[k+stride<n ? k+stride : k];
      const laplace=f.h*((left+right-2*y)*(nx/(2*f.sx))**2 + (back+front-2*y)*(nz/(2*f.sz))**2);
      const moisture=strip(0.14 + 1.35*laplace + 0.21*normal.getZ(k) + 0.10*rills,0.05,0.55);
      const dip = 0.91*pos[3*k+1]+5.6*u-4.1*v+1.65*Math.sin(6*v+f.phase);
      const bedding = 0.5+0.5*Math.sin(dip);
      const fault = 0.5+0.5*Math.sin(4.5*u-2.1*v+f.phase+1.06*Math.sin(5.8*v+0.40*f.phase));
      const outcrop = strip(slope - 0.30*laplace + 0.11*fault,0.13,0.40) *
        (0.25+0.75*strip(fault,0.26,0.80));
      c.lerp(hollow,moisture*(cream ? 0.38 : 0.70));
      c.lerp(scree, outcrop*(cream ? 0.55 : 0.83));
      c.lerp(weathered, outcrop*(0.18+0.37*bedding)*(cream ? 0.38 : 0.76));
      if (f.exposures) {
        const reveal=f.exposures[k]/255;
        c.lerp(scree,strip(reveal,0.14,0.82)*(cream ? 0.62 : 0.97));
        c.lerp(weathered,reveal*(0.24+0.50*bedding));
      }
      if (snow) {
        const drift=strip(normal.getY(k)+0.14*normal.getZ(k)+0.28*laplace-0.06*Math.sin(dip),0.65,0.98);
        c.lerp(high,drift*0.93);
      }
    }
    c.multiplyScalar(0.91 + 0.085 * bands + (snow ? 0.025 : 0.065) * rills).toArray(color, k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return g;
}
