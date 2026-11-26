import * as THREE from 'three';
import { createTowerSim } from '../../../src/core/towerSim.js';
import { FixedStepper } from '../../../src/core/stepper.js';
import { CITIES, SIM, SIM_DT, W0, specialParams } from '../../../src/core/levels.js';
import { TowerView } from '../../../src/render/towerView.js';
import { prepareWallTextures } from '../../../src/render/houses/walls.js';
import { assets } from '../../../src/assets/index.js';
import { createRenderer, createScene, aimGauge, positionCamera } from './stage.js';
import { waterfront } from './waterfront.js';
import { TARGET } from './rules.js';
import { studyDrop, studyFinish } from './study.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((el) => [el.id, el]));
const DROP = [{ type: 'drop' }];
const names = { regular: 'Обычный', balcony: 'Балкон', atrium: 'Атриум', loft: 'Лофт' };
const aim = ui.aim.getContext('2d');
let stage;

async function openStage(city) {
  if (stage) return stage;
  await Promise.all([prepareWallTextures(), assets.ensure(['core', 'flora']).catch(() => {})]);
  const renderer = createRenderer(ui.world);
  const scene = createScene(city);
  const yard = waterfront(city, { chute: false });
  scene.add(yard.root);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 190);
  const focus = new THREE.Vector3();
  function resize() {
    const w = ui.world.clientWidth,
      h = ui.world.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
  }
  new ResizeObserver(resize).observe(ui.world);
  resize();
  stage = { renderer, camera, focus, scene, yard, resize };
  return stage;
}

export async function startConstruction({ city, mode, job, save, finish }) {
  const { renderer, camera, focus, scene, yard, resize } = await openStage(city);
  resize();
  const cargo = mode === 'cargo',
    windy = cargo && city === 'harbor';
  const warehouse = job.buildingType === 'warehouse';
  const style = warehouse ? 'shop' : 'house';
  const sim = createTowerSim({
    ...CITIES.find((def) => def.id === city),
    calm: true,
    seed: 19,
    floorsTarget: job.floorsTarget,
    ...(windy ? { wind: 6, gusty: true } : {}),
    cond: { setup: { goldenEvery: 100, goldenJitter: 0, windBias: windy ? 1.15 : 0 } },
  });
  const st = sim.state;
  const kindAt = (n) => job.specials?.[n] || 'regular';
  let tick = 0,
    message = '',
    messageAt = -10;
  // План привязан к номеру установленного этажа. После промаха тот же груз подаётся снова.
  st.upcoming = job.specials?.[1] || null;
  function advanceSim(dt, commands) {
    sim.step(dt, commands);
    if (st.phase === 'spawning') st.upcoming = job.specials?.[st.floors.length + 1] || null;
  }
  sim.events.on('landed', (e) => {
    const effect =
      e.special === 'atrium'
        ? 'Атриум заселён'
        : e.special === 'balcony' && e.regrown
          ? 'Балкон расширил опору'
          : e.special === 'loft'
            ? e.damped
              ? 'Лофт погасил качку'
              : 'Тяжёлый лофт на месте'
            : e.zone === 'perfect'
              ? 'Точно по центру'
              : 'Этаж на месте';
    message = warehouse ? 'Секция склада на месте' : effect + ' · +' + e.pop + ' жит.';
    messageAt = st.time;
  });
  sim.events.on('missed', () => {
    message = 'Мимо опоры. Попробуйте следующий проход.';
    messageAt = st.time;
  });
  sim.events.on('finished', ({ floors }) => studyFinish(mode, city, job.studyRun, floors));
  if (job.drops.length) {
    // Сохраняем только принятые сбросы. При возврате досчитываем последний до посадки.
    const stop = job.drops.at(-1) + Math.ceil(1 / SIM_DT);
    let i = 0;
    for (; tick < stop && !st.finished; tick++) {
      if (tick === job.drops[i]) {
        advanceSim(SIM_DT, DROP);
        i++;
      } else advanceSim(SIM_DT);
    }
  }
  const view = new TowerView(scene, { styleFor: () => style });
  view.attach(sim);
  view.sync(sim, 1, 0);
  const steps = new FixedStepper();
  const offset = { x: 0, z: 0 },
    wind = { x: 0, z: 0 };
  let input = false,
    previous = 0,
    frameId = 0,
    roof = false,
    cameraFloors = st.floors.length;
  let lastPhase = '',
    lastFloors = -1,
    lastMisses = -1,
    lastWind = 0;
  const quantity = job.floorsTarget;
  const queue = document.createElement('ol');
  queue.className = 'floor-queue';
  queue.setAttribute('aria-label', 'Порядок этажей снизу вверх');
  for (let n = 1; n <= quantity; n++) {
    const cell = document.createElement('li');
    cell.textContent = n + ' · ' + names[kindAt(n)];
    queue.append(cell);
  }
  ui.pieces.hidden = true;
  if (cargo) ui.pieces.after(queue);
  ui['project-name'].textContent = cargo
    ? 'Порядок этажей'
    : warehouse
      ? 'Готовность склада'
      : 'Готовность дома';
  ui['aim-end'].textContent = 'центр опоры';
  ui.brief.textContent = cargo
    ? 'Поставьте этажи в выбранном порядке. Темп сбросов задаёте вы.'
    : warehouse
      ? 'Соберите склад. Каждый этаж увеличит груз, который тележка сможет увезти за один раз.'
      : 'Постройте дом на выбранном участке, чтобы увидеть, кто и куда пойдёт.';
  ui.guide.textContent = windy
    ? 'Метка показывает ход крюка. Лёгкий атриум сносит сильнее. Сброс — пробел или касание.'
    : 'Отпускайте груз над серединой опоры. Сброс — пробел, щелчок или касание.';
  ui['continue-build'].textContent = cargo ? 'Посмотреть результат' : 'Вернуться на план';
  ui['continue-build'].disabled = false;
  const endButton = ui['continue-build'];
  function drop() {
    if (st.phase === 'hanging' && !st.finished) input = true;
  }
  function keyboard(e) {
    if (e.code === 'Space' && !e.repeat && [document.body, ui.world, ui.drop].includes(e.target)) {
      e.preventDefault();
      drop();
    }
  }
  function resetTime() {
    previous = 0;
    input = false;
    steps.reset();
  }
  const events = new AbortController();
  const opts = { signal: events.signal };
  ui.drop.addEventListener('click', drop, opts);
  ui.world.addEventListener('pointerdown', drop, opts);
  window.addEventListener('keydown', keyboard, opts);
  document.addEventListener('visibilitychange', resetTime, opts);
  endButton.addEventListener(
    'click',
    () => {
      if (!st.finished) return;
      cancelAnimationFrame(frameId);
      events.abort();
      queue.remove();
      view.dispose();
      const width = st.floors.at(-1)?.w || 0;
      finish({
        floors: st.floors.length,
        population: st.population,
        width,
        widthPercent: Math.round((100 * width) / W0),
        floorTypes: st.floors.map((f) => f.special || 'regular'),
      });
    },
    opts,
  );
  function step(dt) {
    if (st.finished) return;
    view.beforeStep(sim);
    if (input && st.phase === 'hanging') {
      if (!job.drops.length) studyDrop(mode, city, job.studyRun);
      job.drops.push(tick);
      save();
      advanceSim(dt, DROP);
    } else advanceSim(dt);
    tick++;
    input = false;
  }
  function refresh() {
    const n = st.floors.length,
      done = !!st.finished,
      ready = st.phase === 'hanging' && !done;
    ui.height.textContent = n + ' / ' + quantity + ' этажей';
    ui.lives.textContent = 'Запас промахов · ' + (st.maxMisses - st.misses);
    ui.count.textContent = n + ' / ' + quantity;
    for (let i = 0; i < queue.children.length; i++) {
      queue.children[i].className = i < n ? 'placed' : i === n && !done ? 'current' : '';
    }
    const width = Math.round((100 * (st.floors.at(-1)?.w ?? W0)) / W0);
    const use = warehouse ? 'Ящиков на тележке · ' + n : 'Жители · ' + st.population;
    ui.record.textContent = use + '    Ширина опоры · ' + width + '%';
    ui.drop.disabled = !ready;
    ui.drop.hidden = done;
    ui.aim.hidden = done;
    ui.aim.parentElement.querySelector('.aim-label').hidden = done;
    endButton.hidden = !done;
    if (!done) {
      const kind = kindAt(n + 1);
      ui.traffic.textContent = cargo ? 'На крюке · ' + names[kind] : 'Участок · ' + job.label;
    } else {
      ui.traffic.textContent = n
        ? warehouse
          ? 'Склад готов принять груз.'
          : 'Дом готов к заселению.'
        : 'Участок свободен.';
      ui.guide.textContent = '';
      endButton.focus({ preventScroll: true });
    }
  }
  function frame(now) {
    const dt = previous ? Math.min((now - previous) / 1000, 0.066) : 0;
    previous = now;
    steps.advance(dt, step);
    const n = st.floors.length,
      done = !!st.finished;
    view.sync(sim, steps.alpha, dt);
    if (done && !roof) {
      roof = true;
      if (n) view.addRoof(style, () => {});
    }
    if (st.phase !== lastPhase || n !== lastFloors || st.misses !== lastMisses) {
      refresh();
      lastPhase = st.phase;
      lastFloors = n;
      lastMisses = st.misses;
    }
    const text = done
      ? n === quantity
        ? warehouse
          ? 'Склад достроен'
          : 'Дом достроен'
        : n
          ? 'Стройка завершена'
          : 'Участок свободен'
      : st.time - messageAt < 1.8
        ? message
        : '';
    if (ui.notice.textContent !== text) ui.notice.textContent = text;
    if (!done) {
      const top = st.floors.at(-1);
      const fall = Math.sqrt((2 * SIM.dropHeight) / (SIM.g * (specialParams(st.hanging.special)?.gMul ?? 1)));
      const dx =
        (st.hook.x + st.hook.vx * SIM.inherit * fall - (top?.x ?? 0) - sim.topOffset(offset).x) /
        (top?.w ?? W0);
      aimGauge(aim, dx, false, st.phase === 'hanging');
      if (windy) {
        const x = sim.windAcc(st.time, wind).x;
        const signal = (x < 0 ? -1 : 1) * (Math.abs(x) > 8 ? 2 : 1);
        if (signal !== lastWind) {
          ui['aim-end'].textContent =
            'Ветер ' + (x < 0 ? 'влево' : 'вправо') + (Math.abs(signal) === 2 ? ' · порыв' : '');
          lastWind = signal;
        }
      }
    }
    cameraFloors += (n - cameraFloors) * (1 - Math.exp(-dt * 5));
    positionCamera(camera, focus, cameraFloors, 0.45);
    yard.update(st.time, TARGET);
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(frame);
  }
  frame(performance.now());
  if (!st.finished) ui.world.focus({ preventScroll: true });
}
