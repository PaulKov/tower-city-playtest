// Ночной горизонт. Четыре вида фасада в одном атласе: шаг окна в метрах задают UV секции.
// Остекление, глухая отделка и световые карнизы — три индексных батча для всего кольца.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { customMat } from '../materials.js';

const TOWERS = 48, SHEETS = 4, BAYS = 16, FLOORS = 32, CELL = 16;
const CLADDING = ['#827b74', '#465b67', '#625b57', '#895f50'];
const MULLION = ['#847e72', '#51636b', '#675a4e', '#96816c'];
const WARM = ['#c89c73', '#e4c59a', '#a88969', '#bdac95', '#e6cfac'];
const COOL = ['#9cbcc5', '#b9cad7', '#94a9c1', '#788eaa', '#d2d2c7'];
const UNLIT = ['#253a50', '#223047', '#324459', '#293950', '#344254'];

function urbanBounce(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
    '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.14, 0.155, 0.18);');
}

function facadeMaterial() {
  return customMat('env:skyline-facades', () => {
    const rng = createRng(0xa193cf);
    const canvas = document.createElement('canvas');
    canvas.width = BAYS * CELL * SHEETS; canvas.height = FLOORS * CELL;
    const light = document.createElement('canvas');
    light.width = canvas.width; light.height = canvas.height;
    const wall = canvas.getContext('2d', { alpha: false });
    const room = light.getContext('2d', { alpha: false });
    const rect = (ctx, x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x,y,w,h); };
    rect(room,0,0,light.width,light.height,'#000000');

    for (let style = 0; style < SHEETS; style++) {
      const office = style === 1 || style === 2, start = style * CELL * BAYS;
      // Крупный арендатор занимает несколько окон на соседних этажах. У лестничного ядра остаётся
      // цельная тёмная полоса. Обе массы сохраняются, когда отдельное окно уже меньше пикселя.
      const tenants = Array.from({length: Math.ceil(FLOORS/4)}, () =>
        Array.from({length: Math.ceil(BAYS/3)}, () => rng.next()));
      const core = rng.int(4,10);
      for (let row = 0; row < FLOORS; row++) {
        const y = (FLOORS-row-1)*CELL, lobby = row === 0;
        if (style === 1 && row >= 1 && row <= 9) {
          rect(wall,start,y,CELL*BAYS,CELL,'#495964');
          for (let k = 0; k < CELL; k += 4) {
            rect(wall,start,y+k,CELL*BAYS,1,'#80909c');
            rect(wall,start,y+k+1,CELL*BAYS,1,'#62727c');
            rect(wall,start,y+k+3,CELL*BAYS,1,'#293842');
          }
          for (let col = 0; col < BAYS; col++) {
            rect(wall,start+col*CELL,y,2,CELL,'#404c56');
            rect(wall,start+col*CELL+2,y,1,CELL,'#6b777c');
          }
          continue;
        }
        let suite = 0, lit = false, glazing;
        for (let col = 0; col < BAYS; col++) {
          const x = start+col*CELL, limestone = style === 0, brick = style === 3;
          // Четыре отделки имеют разную кладку: известняковые блоки, гладкие стойки витража,
          // металлические кассеты и перевязка лицевого кирпича с утопленным раствором.
          if (brick) {
            rect(wall,x,y,CELL,CELL,'#746963');
            for (let k = 0; k < CELL; k += 4) {
              const stagger = (k % 8 === 0) ? 3 : 8;
              rect(wall,x,y+k,stagger-1,3,rng.pick(['#99715d','#8c6354','#a57761']));
              rect(wall,x+stagger,y+k,CELL-stagger,3,rng.pick(['#a27762','#986c5a','#8e6959']));
            }
          } else {
            rect(wall,x,y,CELL,CELL,limestone ? rng.pick(['#aaa092','#a59c90','#b0a698']) : CLADDING[style]);
            rect(wall,x,y+15,CELL,1,limestone ? '#756f68' : '#35434b');
            const joint = limestone ? ((row % 2)*8) : 0;
            rect(wall,x+joint,y,1,CELL,limestone ? '#7f7871' : '#34434a');
            if (style === 2) rect(wall,x,y+12,CELL,2,'#71665b');
          }

          const bank = tenants[Math.floor(row/4)][Math.floor(col/3)];
          if (suite === 0 || col % 3 === 0) {
            suite = rng.int(1, office ? 3 : 2);
            const occupancy = lobby ? 0.78 : office ? 0.09 + 0.61*bank*bank : 0.17+0.54*bank;
            lit = rng.next() < occupancy;
            glazing = rng.pick(rng.next() < (style === 1 ? 0.29 : style === 2 ? 0.47 : 0.80) ? WARM : COOL);
          }
          suite--;
          const service = !lobby && (col === core || (style === 2 && col === core+1));
          const litRoom = lit && !service;
          const inset = lobby ? 2 : limestone ? 3 : brick ? 3 : 1;
          const top = lobby ? 1 : brick || limestone ? 3 : 2;
          const px = x+inset, py = y+top, pw = CELL-2*inset, ph = CELL-top-(lobby ? 1 : brick ? 4 : 3);
          if (service && (brick || limestone)) {
            // Глухая стена лестницы с узким заглублённым вертикальным световым проёмом.
            rect(wall,x+6,py+1,4,ph-1,'#514c49'); rect(wall,x+7,py+2,2,ph-3,'#536675');
            continue;
          }
          const reflected = wall.createLinearGradient(px,py,px+pw*0.5,py+ph);
          reflected.addColorStop(0,rng.pick(['#637786','#536979','#657583']));
          reflected.addColorStop(0.55,rng.pick(UNLIT));
          reflected.addColorStop(1,'#283745');
          rect(wall,px,py,pw,ph,reflected);
          if (litRoom) {
            // Лампа освещает потолок и дальнюю стену. Нижний простенок и часть косого
            // взгляда внутрь перекрывают шкаф, штора либо внутренняя перегородка.
            const wash = room.createLinearGradient(px,py,px+pw*rng.uniform(-0.44,0.44),py+ph);
            wash.addColorStop(0,'#77776b'); wash.addColorStop(0.20,glazing);
            wash.addColorStop(0.65,glazing); wash.addColorStop(1,'#50535a');
            rect(room,px,py,pw,ph,wash);
            if (rng.next() < 0.65) {
              const width = rng.int(2,4), at = rng.next() < 0.5 ? px : px+pw-width;
              rect(room,at,py,width,ph,'rgba(12,17,22,0.56)');
            }
            if (rng.next() < 0.42) rect(room,px,py,pw,rng.int(2,4),'rgba(35,37,39,0.60)');
            if (rng.next() < 0.57) rect(room,px+rng.int(1,3),py+ph-4,rng.int(3,6),4,'rgba(16,24,28,0.76)');
            if (office && rng.next() < 0.44) rect(room,px+2,py+1,pw-4,1,'#e1ddc7');
          }
          // Косяки и подоконник остаются в отражённом свете; свет комнаты отступает в проём.
          rect(wall,px-1,py-1,pw+2,1,'#424345');
          rect(wall,px-1,py,1,ph,'#504e48');
          rect(wall,px+pw,py,1,ph,office ? '#59656b' : '#918372');
          rect(wall,px-1,py+ph,pw+2,1,brick || limestone ? '#a69a83' : '#4e585b');
          if (office || lobby) {
            rect(wall,x+8,py,1,ph,'#414b50'); rect(room,x+8,py,1,ph,'#000000');
          }
        }
      }
    }
    function mapped(image) {
      const t = new THREE.CanvasTexture(image);
      t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
      return t;
    }
    const material = new THREE.MeshLambertMaterial({
      map: mapped(canvas), emissiveMap: mapped(light), vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.96,
    });
    // Рассеянный ночной свет улицы сохраняет материал теневой стороны. Излучение занятых окон
    // хранится отдельно: усреднение mip не подмешивает цвета рам, камня и отражений в свет помещений.
    material.onBeforeCompile = urbanBounce;
    return material;
  });
}

// Грани имеют собственные вершины и плоские нормали. По одному непрерывному интервалу
// индексов на здание, чтобы выбор дуги менял только drawRange, без переписи GPU-буферов.
function surfaceBatch(frame) {
  const position = [], colors = [], uv = [], index = [], starts = [], color = new THREE.Color();
  return {
    starts,
    mark() { starts.push(index.length); },
    face(points, tint, tex = null) {
      const first = position.length / 3;
      color.set(tint);
      for (let i = 0; i < points.length; i++) {
        const [x, y, z] = points[i];
        position.push(frame.x + frame.cos*x + frame.sin*z, y, frame.z - frame.sin*x + frame.cos*z);
        colors.push(color.r, color.g, color.b);
        if (tex) uv.push(tex[2*i], tex[2*i+1]);
        if (i >= 2) index.push(first, first+i-1, first+i);
      }
    },
    mesh(name, material) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      if (uv.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      // Дублируется только небольшой индекс: видимая дуга может пересекать начало кольца.
      const original = geometry.index.array, doubled = new original.constructor(2*original.length);
      doubled.set(original); doubled.set(original, original.length);
      geometry.setIndex(new THREE.BufferAttribute(doubled, 1));
      geometry.setDrawRange(0, original.length);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      return mesh;
    },
  };
}

function footprint(w, d, cut) {
  const x = w/2, z = d/2;
  if (!cut) return [[-x,-z],[-x,z],[x,z],[x,-z]];
  return [[-x,-z+cut],[-x,z-cut],[-x+cut,z],[x-cut,z],[x,z-cut],[x,-z+cut],[x-cut,-z],[-x+cut,-z]];
}

function buildTower(batches, rng, style, w, d, h) {
  const [stone, glass, light] = batches, trim = CLADDING[style], edge = MULLION[style];
  const tint = rng.pick(['#f4f4ef', '#fffcf9', '#e7eff7', '#faf2e9']);
  const accent = ['#edd2a1', '#81c9d6', '#efb99a', '#ddc0aa'][style];
  const floor = rng.uniform(1.12, 1.38), bay = rng.uniform(0.78, 1.0);
  const foot = Math.min(3.5, h*0.14), cuts = Math.min(w,d)*0.095;

  // Пилон перекрывает стык двух пролётов, опирается на уступ нижней секции. Видимые
  // торцы дают тень глубины даже под скользящим углом; спинка скрыта внутри облицовки.
  function pilaster(a, b, length, bays, bottom, top) {
    const tangentX = (b[0]-a[0])/length, tangentZ = (b[2]-a[2])/length;
    const t = length*Math.round(bays*(style === 2 ? 0.72 : 0.37))/bays;
    const half = [0.20,0.09,0.16,0.23][style], depth = [0.22,0.15,0.17,0.17][style];
    const point = (along, y, offset) =>
      [a[0]+along*tangentX-offset*tangentZ, y, a[2]+along*tangentZ+offset*tangentX];
    const l = t-half, r = t+half, paint = ['#a69b89','#52616a','#776e60','#98765f'][style];
    const made = (y) => [point(l,y,0),point(l,y,depth),point(r,y,depth),point(r,y,0)];
    const low = made(bottom), high = made(top);
    for (let k = 0; k < 3; k++) stone.face([low[k],low[k+1],high[k+1],high[k]], k === 1 ? paint : trim);
    stone.face(high, edge);
  }

  // У скошенного аттика верхняя плоскость и обрамляющий её карниз имеют одинаковый уклон.
  function section(w, d, bottom, top, { x = 0, z = 0, cut = 0, slope = 0, baseSlope = 0,
    surface = stone, color = trim, cap = edge, lobby = false, grille = false, ribs = false, covered = false } = {}) {
    const plan = footprint(w, d, cut);
    const low = plan.map(([u,v]) => [x+u, bottom + baseSlope*u, z+v]);
    const high = plan.map(([u,v]) => [x+u, top + slope*u, z+v]);
    const rows = lobby ? 1 : Math.max(1, Math.min(FLOORS-3, Math.round((top-bottom)/floor)));
    const plantFloor = (style === 1 || style === 2) && rows >= 10 ? Math.round(rows*0.55) : -1;
    for (let i = 0; i < plan.length; i++) {
      const j = (i+1) % plan.length, side = [low[i],low[j],high[j],high[i]];
      const length = Math.hypot(plan[j][0]-plan[i][0], plan[j][1]-plan[i][1]);
      // Узкая срезанная грань — стойка, стены с целым оконным пролётом получают свой участок атласа.
      if (surface !== glass || length < 0.67) {
        (surface === glass ? stone : surface).face(side, color);
        continue;
      }
      const bays = Math.max(1, Math.min(BAYS-2, Math.round(length/bay)));
      const u = (style*BAYS + rng.int(1, BAYS-bays-1)) / (BAYS*SHEETS);
      const u1 = u + bays/(BAYS*SHEETS);
      if (grille) {
        const v = 1/FLOORS;
        const left = v+(high[i][1]-bottom)/(floor*FLOORS), right = v+(high[j][1]-bottom)/(floor*FLOORS);
        glass.face(side, tint, [u,v, u1,v, u1,right, u,left]);
        continue;
      }
      if (ribs && bays >= 4) pilaster(low[i],low[j],length,bays,bottom,top);
      // Помещения разных арендаторов занимают 4–8 этажей. Смещаем фрагмент по вертикали;
      // колонны и шаг этажей сохраняют оси на стыках, соседние башни не повторяют один световой рисунок.
      for (let row = 0; row < rows;) {
        const plant = row === plantFloor, until = row < plantFloor ? plantFloor : rows;
        const count = plant ? 1 : Math.min(until-row,rng.int(4,8));
        const v = lobby ? 0 : plant ? 1/FLOORS : rng.int(style === 1 ? 10 : 2,FLOORS-count-1)/FLOORS;
        const v1 = v+count/FLOORS, left = plant ? 1/SHEETS : u, right = left+bays/(BAYS*SHEETS);
        const y0 = bottom + (top-bottom)*row/rows, y1 = bottom + (top-bottom)*(row+count)/rows;
        const ax = low[i][0], az = low[i][2], bx = low[j][0], bz = low[j][2];
        glass.face([[ax,y0,az],[bx,y0,bz],[bx,y1,bz],[ax,y1,az]], tint,[left,v, right,v, right,v1, left,v1]);
        row += count;
      }
    }
    if (!covered) (surface === light ? light : stone).face(high, cap);
  }

  // Двусветный вестибюль сидит на цоколе. Козырёк выступает с внутренней, городской стороны.
  section(w*1.10,d*1.10,-0.55,0.26,{ cut:cuts, color:'#555967' });
  section(w*1.07,d*1.07,0.26,foot,{ cut:cuts, surface:glass, lobby:true, covered:true });
  section(w*1.10,d*1.10,foot,foot+0.29,{ cut:cuts, color:edge });
  section(w*0.41,0.85,foot*0.69,foot*0.69+0.18,{ z:-d*0.54-0.16, color:edge });
  const base = foot+0.29;
  const shaft = (w,d,b,t,opts) => section(w,d,b,t,{ surface:glass,...opts });
  if (style === 0) {
    // Каменная башня с уступами и восьмигранным фонарём.
    const shoulder = h*0.67, crown = h*0.88;
    shaft(w,d,base,shoulder,{ cut:cuts, ribs:true });
    shaft(w*0.79,d*0.79,shoulder,crown,{ cut:cuts });
    shaft(w*0.52,d*0.52,crown,h,{ cut:cuts*0.68 });
    section(w*0.37,d*0.37,h,h+1.05,{ cut:cuts*0.5, color:edge });
    section(w*0.28,d*0.28,h+1.05,h+1.50,{ cut:cuts*0.38, surface:light, color:accent, cap:trim });
    section(w*0.22,d*0.22,h+1.5,h+2.1,{ cut:cuts*0.28 });
    section(0.26,0.26,h+2.1,h+2.8+h*0.055,{ color:edge });
  } else if (style === 1) {
    // Стальной скайгарден: непрерывный стеклянный ствол, над ним косая корона с ламелями.
    const capBase = h*0.85, capMid = h*0.96, slope = (capMid-capBase)*1.65/w;
    shaft(w,d,base,capBase,{ cut:cuts*0.85, ribs:true, covered:true });
    section(w,d,capBase,capMid,{ cut:cuts*0.85, slope, surface:glass, grille:true, covered:true });
    section(w+0.10,d+0.10,capMid,capMid+0.17,{ cut:cuts*0.85, baseSlope:slope, slope, surface:light, color:accent, cap:trim });
  } else if (style === 2) {
    // Крылья одного комплекса разной высоты. Между ними остаётся просвет над общим стилобатом.
    const split = base+(h-base)*0.32, left = -w*0.265, right = w*0.27;
    shaft(w,d,base,split);
    shaft(w*0.47,d,split,h,{ x:left, cut:cuts*0.56, ribs:true, covered:true });
    shaft(w*0.45,d*0.86,split,h*0.77,{ x:right, z:d*0.06, cut:cuts*0.55 });
    section(w*0.49,d+0.12,h,h+0.24,{ x:left, cut:cuts*0.56, color:edge });
    section(w*0.31,d*0.59,h+0.24,h+1.32,{ x:left, color:'#536773' });
    section(w*0.33,d*0.58,h*0.77,h*0.77+0.83,{ x:right, z:d*0.06 });
    section(0.15,d*0.46,h+1.32,h+1.48,{ x:left, surface:light, color:accent, cap:accent });
  } else {
    // Жилой дом: несимметричные террасы, парапеты светлого камня и утопленный лифтовой объём.
    const first = h*0.57, second = h*0.82, x1 = w*0.105, x2 = w*0.175;
    shaft(w,d,base,first,{ ribs:true, covered:true });
    section(w+0.14,d+0.14,first,first+0.25,{ color:edge });
    shaft(w*0.76,d*0.87,first+0.25,second,{ x:x1, covered:true });
    section(w*0.76+0.14,d*0.87+0.14,second,second+0.25,{ x:x1, color:edge });
    shaft(w*0.55,d*0.70,second+0.25,h,{ x:x2, covered:true });
    section(w*0.55+0.12,d*0.70+0.12,h,h+0.22,{ x:x2, color:edge });
    section(w*0.28,d*0.38,h+0.22,h+1.16,{ x:x2, z:d*0.04 });
  }
}

export function buildSkyline(rng) {
  const frame = { x:0,z:0,cos:1,sin:0 }, batches = [surfaceBatch(frame), surfaceBatch(frame), surfaceBatch(frame)];
  const bounds = [], order = [0,1,2,3], layout = rng.fork(1), details = rng.fork(2);
  for (let i = 0; i < TOWERS; i++) {
    if (i % SHEETS === 0) {
      for (let j = order.length-1; j > 0; j--) {
        const k = details.int(0,j); [order[k],order[j]] = [order[j],order[k]];
      }
    }
    for (const batch of batches) batch.mark();
    const a = (i+layout.uniform(-0.23,0.23))*2*Math.PI/TOWERS, r = layout.uniform(85,125);
    const w = layout.uniform(5.5,10), d = layout.uniform(5.1,8.7), h = layout.uniform(14,39)*(r > 110 ? 1.13 : 1);
    const yaw = a + layout.uniform(-0.40,0.40);
    Object.assign(frame,{ x:r*Math.sin(a), z:r*Math.cos(a), cos:Math.cos(yaw), sin:Math.sin(yaw) });
    buildTower(batches, details.fork(i), order[i % SHEETS], w, d, h);
    const reach = Math.hypot(w,d)*0.62+0.85;
    bounds.push(new THREE.Box3(new THREE.Vector3(frame.x-reach,-0.55,frame.z-reach),
      new THREE.Vector3(frame.x+reach,h*1.06+3.0,frame.z+reach)));
  }
  for (const batch of batches) batch.mark();
  const meshes = [
    batches[0].mesh('skyline', customMat('env:skyline-stone', () => {
      const material = new THREE.MeshLambertMaterial({ vertexColors:true });
      material.onBeforeCompile = urbanBounce;
      return material;
    })),
    batches[1].mesh('skylineWindows', facadeMaterial()),
    batches[2].mesh('neon', customMat('env:skyline-lanterns', () => new THREE.MeshBasicMaterial({ vertexColors:true }))),
  ];
  const startsByMesh = batches.map(batch => batch.starts);
  const cameraSpace = new THREE.Matrix4(), clip = new THREE.Matrix4(), last = new THREE.Matrix4(), frustum = new THREE.Frustum();
  const visible = new Uint8Array(TOWERS);
  function update(camera) {
    if (!camera?.isCamera) return;
    camera.updateWorldMatrix(true,false); meshes[0].updateWorldMatrix(true,false);
    cameraSpace.multiplyMatrices(camera.matrixWorldInverse,meshes[0].matrixWorld);
    clip.multiplyMatrices(camera.projectionMatrix,cameraSpace);
    if (last.equals(clip)) return;
    last.copy(clip); frustum.setFromProjectionMatrix(clip,camera.coordinateSystem,camera.reversedDepth);
    let first = -1;
    for (let i = 0; i < TOWERS; i++) {
      visible[i] = frustum.intersectsBox(bounds[i]) ? 1 : 0;
      if (visible[i]) first = i;
    }
    // Выкидываем самую длинную невидимую дугу; редкие просветы между башнями внутри кадра безвредны.
    let skip = 0, run = 0, begin = 0;
    if (first >= 0) for (let j = 1; j <= TOWERS; j++) {
      const i = (first+j) % TOWERS;
      run = visible[i] ? 0 : run+1;
      if (run > skip) { skip = run; begin = (i+1) % TOWERS; }
    }
    const end = begin + (first < 0 ? 0 : TOWERS-skip);
    for (let m = 0; m < meshes.length; m++) {
      const starts = startsByMesh[m], to = starts[end % TOWERS] + (end >= TOWERS ? starts[TOWERS] : 0);
      meshes[m].geometry.setDrawRange(starts[begin], to-starts[begin]);
    }
  }
  return { meshes, update };
}
