import * as THREE from 'three';
import * as G from '../../../src/render/geomUtils.js';
import { dockPlank, harborMaterial } from '../../../src/render/models/harborDock.js';
import { harborBoatGeometry } from '../../../src/render/models/harborBoat.js';
import { heroDecorNearGeometry } from '../../../src/render/models/heroDecor.js';
import { plantGeometryAt } from '../../../src/render/vegetation/field.js';
import { vegetationMaterial } from '../../../src/render/vegetation/material.js';
import { assets } from '../../../src/assets/index.js';
import { groundMaterial } from '../../../src/render/groundMaterials.js';
import { createRng } from '../../../src/core/rng.js';
import { bargeTravel, TARGET } from './rules.js';

const surface = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const timber = '#96603b',
  rail = '#48665d',
  cream = '#fff0c5';
const bridgeX = 5.8,
  crossingZ = 2.1;
const cube = (w, h, d, x, y, z, c, r = 0.045) => G.place(G.roundedBox(w, h, d, r, 1, c), { x, y, z });
const pole = (x, y, z, r, h, c) => G.place(G.cylinder(r * 0.97, r, h, 20, c), { x, y, z });
const oval = (x, y, z, w, h, d, c) => G.place(G.sphere(1, 18, 12, c), { x, y, z, sx: w, sy: h, sz: d });

function batch(list) {
  const mesh = new THREE.Mesh(G.mergeColored(list), surface);
  for (const g of list) g.dispose();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function plank(w, h, d, seed) {
  return new THREE.Mesh(dockPlank(w, h, d, seed), harborMaterial(true));
}

// Трава и камень разделены уступом; обе кромки следуют одному контуру.
function island(points, y, depth, color, curved = false) {
  if (curved) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
    );
    points = curve.getPoints(points.length * 6).map((p) => [p.x, p.z]);
  }
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => {
    if (i) shape.lineTo(x, -z);
    else shape.moveTo(x, -z);
  });
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.12,
    bevelThickness: 0.12,
  });
  return G.colored(g.rotateX(-Math.PI / 2).translate(0, y - depth, 0), color);
}

function grove(root, city) {
  const sites = [
    [-10, -4, 1.12],
    [-8, -12, 1.36],
    [-4, -13, 1.18],
    [-13, 4, 1.08],
    [11, -6, 1.08],
    [15, -9, 1.23],
    [17, 2, 1.02],
    [11.5, 7, 0.96],
  ];
  const palm = city === 'harbor',
    atlas = assets.tryGet('menu.flora.color');
  const material = vegetationMaterial({
    lite: true,
    wind: false,
    solid: palm,
    palm,
    palmFar: palm,
    floraAtlas: atlas,
  });
  const pose = new THREE.Object3D(),
    color = new THREE.Color();
  for (let variant = 0; variant < 2; variant++) {
    const geometry = plantGeometryAt(city, atlas, { kind: 'tree', variant }, 1).clone();
    geometry.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(4), 1));
    const mesh = new THREE.InstancedMesh(geometry, material, 4);
    for (let j = 0; j < 4; j++) {
      const [x, z, scale] = sites[2 * j + variant];
      pose.position.set(x, 0.015, z);
      pose.rotation.y = j * 2.3 + variant;
      pose.scale.setScalar(scale);
      pose.updateMatrix();
      mesh.setMatrixAt(j, pose.matrix);
      mesh.setColorAt(j, color.set(palm ? '#58964c' : j % 2 ? '#7aaf4d' : '#85ad53'));
    }
    root.add(mesh);
  }
}

function bridge(parts, root) {
  for (const z of [crossingZ - 0.62, crossingZ + 0.62]) {
    parts.push(cube(4.45, 0.19, 0.15, bridgeX, 0.05, z, timber));
    for (const x of [3.8, 7.82]) parts.push(pole(x, -0.19, z, 0.13, 1.44, timber));
  }
  const boards = [];
  for (let i = 0; i < 9; i++) {
    const board = plank(0.445, 0.16, 1.58, 120 + i);
    board.receiveShadow = true;
    board.castShadow = true;
    board.position.set(bridgeX + (i - 4) * 0.465, 0.22, crossingZ);
    root.add(board);
    if (i >= 3 && i <= 5) boards.push(board);
  }
  for (const x of [3.91, 7.68]) {
    for (const z of [crossingZ - 0.78, crossingZ + 0.78]) {
      parts.push(pole(x, 0.47, z, 0.088, 0.86, timber));
      parts.push(oval(x, 0.915, z, 0.11, 0.08, 0.11, cream));
    }
  }
  return boards;
}

function barge() {
  const root = new THREE.Group(),
    parts = [];
  // Скошенные нос и корма, палуба между планширями. У ватерлинии полоса краски.
  const outline = [
    [-0.92, -2.2],
    [-0.62, -2.65],
    [0.62, -2.65],
    [0.92, -2.2],
    [0.92, 2.02],
    [0.65, 2.5],
    [-0.65, 2.5],
    [-0.92, 2.02],
  ];
  parts.push(island(outline, 0.37, 0.48, '#305966'), island(outline, 0.4, 0.055, '#cb7854'));
  parts.push(cube(1.65, 0.12, 4.5, 0, 0.5, 0, '#ac8355'));
  for (const x of [-0.87, 0.87]) {
    parts.push(cube(0.12, 0.19, 4.25, x, 0.54, 0, '#416c70'));
    for (const z of [-1.75, 0, 1.65]) {
      const tire = G.colored(new THREE.TorusGeometry(0.18, 0.064, 10, 24), '#374647');
      parts.push(G.place(tire, { x: x * 1.09, y: 0.38, z, ry: Math.PI / 2 }));
    }
  }
  parts.push(cube(1.25, 0.77, 0.91, 0, 0.96, -1.53, cream), cube(1.43, 0.13, 1.1, 0, 1.39, -1.53, '#ab6348'));
  parts.push(
    cube(0.92, 0.35, 0.04, 0, 1.05, -1.052, '#467780'),
    cube(0.055, 0.37, 0.06, 0, 1.05, -1.04, cream),
  );
  for (const x of [-0.64, 0.64]) parts.push(cube(0.035, 0.32, 0.52, x, 1.08, -1.5, '#467780'));
  for (const z of [1.9, -2.07]) parts.push(pole(0.55, 0.67, z, 0.085, 0.27, rail));
  root.add(batch(parts));
  return root;
}

function cart() {
  const parts = [cube(1, 0.28, 0.75, 0, 0.43, 0, '#b95738')];
  for (const x of [-0.34, 0.34])
    for (const z of [-0.4, 0.4]) {
      parts.push(G.place(G.cylinder(0.175, 0.175, 0.085, 20, rail), { x, y: 0.19, z, rx: Math.PI / 2 }));
    }
  for (let i = 0; i < 6; i++)
    parts.push(
      oval(((i % 3) - 1) * 0.25, 0.64, Math.floor(i / 3) * 0.28 - 0.14, 0.16, 0.14, 0.16, '#de9135'),
    );
  // Садовник в соломенной шляпе идёт перед ручкой тележки.
  parts.push(G.beam([0.48, 0.45, 0], [0.95, 0.54, 0], 0.065, timber));
  parts.push(oval(1, 0.48, 0, 0.2, 0.33, 0.19, '#53856b'), oval(1, 0.88, 0, 0.16, 0.19, 0.16, '#d39a72'));
  parts.push(pole(1, 1.04, 0, 0.26, 0.045, '#d8b967'), pole(1, 1.1, 0, 0.16, 0.12, '#e3c97f'));
  for (const z of [-0.105, 0.105]) parts.push(cube(0.18, 0.21, 0.135, 1, 0.13, z, '#654e3e'));
  return batch(parts);
}

export function waterfront(city, { chute = true } = {}) {
  const harbor = city === 'harbor',
    root = new THREE.Group(),
    parts = [],
    rng = createRng(harbor ? 915 : 220);
  const left = [
    [-21, -18],
    [-14, -23],
    [-4, -22],
    [2, -16],
    [3.2, -8],
    [3.9, -2],
    [3.62, 2],
    [3.85, 7],
    [1.5, 12],
    [-6, 15],
    [-18, 11],
    [-22, 4],
  ];
  const right = [
    [8, -10],
    [11, -15],
    [20, -13],
    [26, -4],
    [23, 9],
    [14, 11],
    [8.7, 7],
    [7.95, 3],
    [7.85, -1],
  ];
  for (const shape of [left, right]) {
    parts.push(island(shape, -0.25, 1.8, harbor ? '#b7a383' : '#ad9475', true));
    const turf = island(shape, -0.1, 0.24, harbor ? '#b8ba79' : '#97b268', true);
    const pos = turf.attributes.position,
      uv = turf.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 5, pos.getZ(i) / 5);
    const grass = assets.tryGet('ground.grass') ? groundMaterial('grass', assets, { lite: true }) : surface;
    const bank = new THREE.Mesh(turf, grass);
    bank.receiveShadow = true;
    root.add(bank);
  }
  parts.push(cube(5.15, 0.15, 5.05, 0, 0.005, 0, '#d6c9ac', 0.11));
  // Линия основания видна до первого сброса.
  for (const x of [-2, 2]) parts.push(cube(0.07, 0.025, 4, x, 0.09, 0, cream));
  for (const z of [-2, 2]) parts.push(cube(4, 0.025, 0.07, 0, 0.09, z, cream));
  grove(root, city);
  const stones = ['#929987', '#b3ac91', '#999c87'];
  for (let i = 0; i < 24; i++) {
    const z = -5.5 + i * 0.58,
      x = 3.82 + 0.15 * Math.sin(z * 0.94);
    parts.push(
      oval(
        x,
        -0.36 + rng.uniform(-0.15, 0.06),
        z,
        rng.uniform(0.2, 0.43),
        rng.uniform(0.2, 0.38),
        rng.uniform(0.28, 0.57),
        stones[i % 3],
      ),
    );
  }
  if (!harbor) {
    for (let i = 0; i < 6; i++)
      parts.push(cube(0.45, 0.06, 1.32, 7.96 + 0.42 * i, 0.04, crossingZ, '#cbb891'));
    for (let i = 0; i < 4; i++)
      parts.push(cube(0.4, 0.06, 1.35, 2.35 + 0.39 * i, 0.05 + i * 0.048, crossingZ, '#cbb891'));
  }
  const farColor = harbor ? '#729c94' : '#91ad85';
  for (let i = 0; i < 10; i++) {
    const hill = G.sphere(1, 36, 20, farColor),
      pos = hill.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v),
        y = pos.getY(v),
        z = pos.getZ(v);
      pos.setY(v, y * (0.85 + 0.22 * x - 0.18 * z + 0.12 * Math.sin(x * 4 + i)));
    }
    hill.computeVertexNormals();
    parts.push(
      G.place(hill, {
        x: -52 + i * 11,
        y: -2.9,
        z: -44 - rng.uniform(0, 9),
        sx: rng.uniform(8, 14),
        sy: rng.uniform(4, 8),
        sz: rng.uniform(6, 12),
      }),
    );
  }
  for (let i = 0; i < 20; i++) {
    const x = rng.uniform(-15, 3),
      z = rng.uniform(-12, 9);
    if (Math.abs(x) < 6 && Math.abs(z) < 7) continue;
    parts.push(oval(x, 0.15, z, 0.35, 0.25, 0.31, '#7b8d61'));
  }
  const deck = [],
    boat = harbor ? barge() : null,
    wagon = harbor ? null : cart();
  if (harbor) {
    for (let i = 0; i < 9; i++) parts.push(cube(1.15, 0.13, 0.32, 3.73, 0.12, -1.6 + i * 0.33, timber));
    for (const z of [-1.5, 0.65]) parts.push(pole(4.2, -0.18, z, 0.12, 1.1, timber));
    for (let i = 0; i < TARGET; i++) {
      const board = plank(1.46, 0.14, 0.48, 220 + i);
      board.position.set(0, 0.64, -0.4 + i * 0.6);
      boat.add(board);
      deck.push(board);
    }
    root.add(boat);
    const tug = new THREE.Mesh(harborBoatGeometry(1), harborMaterial(true));
    tug.position.set(5, -0.64, -22);
    tug.rotation.y = 0.48;
    root.add(tug);
  } else {
    deck.push(...bridge(parts, root));
    root.add(wagon);
    for (let i = 0; i < 4; i++) {
      const z = -2.5 + i * 0.66;
      parts.push(cube(2.3, 0.14, 0.42, 10, 0.03, z, '#936e49'));
      for (let j = 0; j < 7; j++)
        parts.push(oval(9.14 + j * 0.28, 0.16, z, 0.15, 0.15, 0.14, j % 2 ? '#839947' : '#729647'));
    }
  }
  if (chute) {
    // Жёлоб у правой кромки: наклонное днище, боковые борта и опоры.
    for (const z of [-0.56, 0.56]) {
      parts.push(G.beam([2.15, 1.1, z], [4.18, 0.49, z], 0.1, rail));
      parts.push(pole(2.38, 0.47, z, 0.07, 0.9, rail));
    }
    parts.push(G.place(G.roundedBox(2.14, 0.1, 1.16, 0.035, 1, '#cc9a4c'), { x: 3.18, y: 0.71, rz: -0.29 }));
    for (const z of [-0.59, 0.59])
      parts.push(
        G.place(G.roundedBox(2.17, 0.22, 0.08, 0.025, 1, '#d78033'), { x: 3.18, y: 0.86, z, rz: -0.29 }),
      );
  }
  const smallProp = heroDecorNearGeometry(harbor ? 'crates' : 'flowerbed', harbor ? '#ca7552' : '#e99b47');
  for (const [x, z] of harbor
    ? [
        [2.0, -3.7],
        [2.7, -3.3],
        [8.9, -2],
      ]
    : [
        [8.75, 3.0],
        [9.8, 3.1],
        [-3.4, 3.1],
      ])
    parts.push(G.place(smallProp.clone(), { x, z, s: 1.2 }));
  smallProp.dispose();
  const shore = batch(parts);
  shore.castShadow = true;
  shore.receiveShadow = true;
  root.add(shore);
  const waterColor = harbor ? '#43999f' : '#66a899';
  const waterMaterial = new THREE.MeshPhongMaterial({ color: waterColor, shininess: 32 });
  const waterTime = { value: 0 };
  waterMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uStreamTime = waterTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStream;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStream=position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStream; uniform float uStreamTime;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat wave=sin(vStream.y*4.0+uStreamTime*1.4+sin(vStream.x*2.4))*.5+.5; float glint=pow(wave,9.0)*(.5+.5*sin(vStream.x*3.1+vStream.y*.8)); diffuseColor.rgb*=.986+.036*wave; diffuseColor.rgb+=.018*glint;',
      );
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 180), waterMaterial);
  water.receiveShadow = true;
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.66;
  root.add(water);
  const ripples = [];
  for (let i = 0; i < 120; i++) {
    const x = rng.uniform(-26, 29),
      z = rng.uniform(-30, 25);
    ripples.push(
      oval(
        x,
        -0.648,
        z,
        rng.uniform(0.16, 0.74),
        0.008,
        rng.uniform(0.025, 0.06),
        harbor ? '#a6d6cf' : '#b1d8be',
      ),
    );
  }
  const current = batch(ripples);
  root.add(current);
  const boardFly = plank(0.45, 0.16, 1.55, 124);
  boardFly.visible = false;
  root.add(boardFly);
  let flyTime = -2,
    fromX = 0,
    fromY = 0,
    fromZ = 0,
    targetIndex = 0,
    departAt = -Infinity,
    wagonAt = -Infinity;
  function deliver(pc, time, index) {
    flyTime = time;
    fromX = pc.x;
    fromY = pc.y + 1.27;
    fromZ = pc.z;
    targetIndex = index;
    boardFly.visible = true;
    if (index === TARGET - 1) {
      if (harbor) departAt = time + 0.65;
      else wagonAt = time + 0.65;
    }
  }
  function update(time, count) {
    waterTime.value = time;
    const flight = time - flyTime,
      active = flight >= 0 && flight < 0.62;
    if (boat) {
      const leave = time - departAt;
      const travel = Number.isFinite(departAt) ? Math.min(1, Math.max(0, leave) / 4) ** 2 : bargeTravel(time);
      boat.position.set(5.48, -0.61 + 0.024 * Math.sin(time * 2.3), crossingZ - travel * 10);
      boat.rotation.z = 0.013 * Math.sin(time * 1.7);
    }
    if (wagon) {
      const trip = Number.isFinite(wagonAt)
        ? Math.min(1, Math.max(0, (time - wagonAt) / 4))
        : count === TARGET
          ? 1
          : 0;
      wagon.position.set(2.55 + trip * 6.4, 0.12 + 0.18 * Math.sin(trip * Math.PI), crossingZ);
    }
    current.position.x = Math.sin(time * 0.6) * 0.16;
    for (let i = 0; i < deck.length; i++) deck[i].visible = i < count && !(active && i === targetIndex);
    boardFly.visible = active;
    if (active) {
      const t = flight / 0.62,
        end = deck[targetIndex].position;
      const destX = boat ? boat.position.x + end.x : end.x,
        destY = boat ? boat.position.y + end.y : end.y,
        destZ = boat ? boat.position.z + end.z : end.z;
      if (t < 0.58) {
        const u = t / 0.58;
        boardFly.position.set(fromX + (3.25 - fromX) * u, fromY + (0.93 - fromY) * u * u, fromZ * (1 - u));
      } else {
        const u = (t - 0.58) / 0.42;
        boardFly.position.set(
          3.25 + (destX - 3.25) * u,
          0.93 + (destY - 0.93) * u + 0.33 * Math.sin(Math.PI * u),
          destZ * u,
        );
      }
      boardFly.rotation.y = boat ? (t * Math.PI) / 2 : 0;
    }
  }
  let oldBridge = null;
  function reset(projects) {
    flyTime = -2;
    departAt = -Infinity;
    wagonAt = -Infinity;
    boardFly.visible = false;
    if (!harbor && projects > 0 && !oldBridge) {
      oldBridge = new THREE.Group();
      const supports = [];
      bridge(supports, oldBridge);
      oldBridge.add(batch(supports));
      oldBridge.scale.x = 1.42;
      oldBridge.position.set(-2.54, 0, -7);
      root.add(oldBridge);
    }
  }
  return { root, deliver, update, reset };
}
