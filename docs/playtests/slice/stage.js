import * as THREE from 'three';

export function createScene(city) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(city === 'harbor' ? '#c2dfe3' : '#d3e5d2');
  scene.fog = new THREE.FogExp2(scene.background, 0.008);
  scene.add(new THREE.HemisphereLight('#fff6dc', '#8c9982', 1.5));
  const sun = new THREE.DirectionalLight('#fff0ce', 2.0);
  sun.position.set(-10, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 17, bottom: -16, near: 0.5, far: 52 });
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  return scene;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
  return renderer;
}

export function aimGauge(aim, dx, deck, ready) {
  const w = aim.canvas.width,
    h = aim.canvas.height,
    mid = w * 0.5,
    span = w * 0.43;
  aim.clearRect(0, 0, w, h);
  aim.fillStyle = '#e4dfd1';
  aim.fillRect(0, h * 0.34, w, h * 0.33);
  aim.fillStyle = '#c8bca6';
  aim.fillRect(mid - span, h * 0.34, span * 2, h * 0.33);
  aim.fillStyle = '#657c6c';
  aim.fillRect(mid - span * 0.06, h * 0.24, span * 0.12, h * 0.52);
  if (deck) {
    aim.fillStyle = '#62953f';
    aim.fillRect(mid + span * 0.065, h * 0.25, span * 0.55, h * 0.5);
  }
  if (ready) {
    const x = Math.max(7, Math.min(w - 7, mid + dx * span));
    aim.fillStyle = '#fffef1';
    aim.beginPath();
    aim.arc(x, h / 2, 10, 0, 2 * Math.PI);
    aim.fill();
    aim.fillStyle = '#213f36';
    aim.beginPath();
    aim.arc(x, h / 2, 6.5, 0, 2 * Math.PI);
    aim.fill();
  }
}

export function positionCamera(camera, focus, floors, centerX = 2.25) {
  const half = Math.max(6.45 + floors * 0.49, 9.2 / camera.aspect);
  camera.left = -half * camera.aspect;
  camera.right = -camera.left;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
  focus.set(centerX, 3.65 + floors * 0.5, 0);
  camera.position.set(focus.x + 5.5, focus.y + 10.6, focus.z + 23.5);
  camera.lookAt(focus);
}
