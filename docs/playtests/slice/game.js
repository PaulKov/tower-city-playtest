import { createScene, createRenderer, aimGauge, positionCamera } from './stage.js';
import * as THREE from 'three';
import { createTowerSim } from '../../../src/core/towerSim.js';
import { FixedStepper } from '../../../src/core/stepper.js';
import { CITIES, SIM, SIM_DT, W0 } from '../../../src/core/levels.js';
import { TowerView } from '../../../src/render/towerView.js';
import { prepareWallTextures } from '../../../src/render/houses/walls.js';
import { buildCityBuildings } from '../../../src/render/houses/cityBuildings.js';
import { encodeShape } from '../../../src/core/towerShape.js';
import { assets } from '../../../src/assets/index.js';
import { dockPlank, harborMaterial } from '../../../src/render/models/harborDock.js';
import { acceptsSlice, bargeAtDock, CYCLE, MOORED, FIRST_DECK, TARGET } from './rules.js';
import { waterfront } from './waterfront.js';
import { studyOpen, studyStart, studyDrop, studyFinish } from './study.js';

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((el) => [el.id, el]));
const bars = document.querySelectorAll('.pieces i');
const aim = ui.aim.getContext('2d');
const DROP = [{ type: 'drop' }];
const FALL = Math.sqrt((2 * SIM.dropHeight) / SIM.g);
const TOWNS = {
  valley: {
    title: 'Мостик к огороду',
    task: 'Помогите садовнику перевезти урожай через ручей.',
    unit: 'Настил мостика',
    other: 'Попробовать Гавань',
  },
  harbor: {
    title: 'Баржа у причала',
    task: 'Отправьте три доски на палубу, пока судно стоит у жёлоба.',
    unit: 'Груз на палубе',
    other: 'Вернуться в Долину',
  },
};
const runs = new Map();
let active,
  renderer,
  previous = 0;
const steps = new FixedStepper();
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 190);
const focus = new THREE.Vector3();
const offset = { x: 0, z: 0 };
const keyFor = (city) => 'tower.slice-pilot.v1.' + city;

function fresh() {
  return { houses: 0, best: 0, projects: 0, carry: 0, attempt: 0, drops: [] };
}
function load(city) {
  try {
    const data = JSON.parse(sessionStorage.getItem(keyFor(city)));
    if (
      data &&
      ['houses', 'best', 'projects', 'carry', 'attempt'].every(
        (k) => Number.isSafeInteger(data[k]) && data[k] >= 0,
      ) &&
      data.carry < TARGET &&
      data.best <= 10 &&
      Array.isArray(data.drops) &&
      data.drops.length <= 14 &&
      data.drops.every((n, i) => Number.isSafeInteger(n) && n >= (i ? data.drops[i - 1] + 1 : 0))
    )
      return data;
  } catch {
    /* Закрытое хранилище: игра продолжается в памяти вкладки. */
  }
  return fresh();
}
function save(run) {
  try {
    sessionStorage.setItem(keyFor(run.city), JSON.stringify(run.history));
  } catch {
    /* Памяти текущей игры достаточно. */
  }
}

function workshop(city, history) {
  const scene = createScene(city);
  const yard = waterfront(city);
  scene.add(yard.root);
  const run = { city, history, scene, yard };
  newHouse(run);
  return run;
}

function newHouse(run) {
  const { city, history } = run;
  run.view?.dispose();
  if (run.previousHouse) {
    run.previousHouse.removeFromParent();
    run.housingBatch.dispose();
    run.previousHouse = null;
  }
  if (
    history.lastHouse?.floors > 0 &&
    history.lastHouse.floors <= 10 &&
    Array.isArray(history.lastHouse.shape)
  ) {
    const lot = { ...history.lastHouse, x: 0, y: 0, cx: 0, cz: 0, type: 'house' };
    const batch = (run.housingBatch = buildCityBuildings(city, [lot]));
    const house = (run.previousHouse = new THREE.Group());
    for (const part of batch.parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = part.cast;
      mesh.receiveShadow = true;
      house.add(mesh);
    }
    house.position.set(-5.3, 0.02, -0.4);
    house.scale.setScalar(0.58);
    run.scene.add(house);
  }
  const cityDef = CITIES.find((c) => c.id === city);
  const sim = (run.sim = createTowerSim({
    ...cityDef,
    calm: true,
    seed: 9 + history.attempt,
    floorsTarget: 10,
  }));
  const view = (run.view = new TowerView(run.scene));
  // Деревянная обшивка едет вместе с этажом; размеры следуют сужению башни.
  const deck = (run.rack ??= new THREE.Group());
  if (!deck.children.length) {
    for (let i = 0; i < 6; i++) {
      const board = new THREE.Mesh(dockPlank(0.6, 0.09, 3.89, 50 + i), harborMaterial(true));
      board.position.set((i - 2.5) * 0.64, 0.046, 0);
      deck.add(board);
    }
  }
  view.activePivot.add(deck);
  run.count = history.carry;
  run.tick = 0;
  run.input = false;
  run.feedback = '';
  run.feedbackAt = -10;
  run.sealed = false;
  run.afterClose = 0;
  run.roofPending = false;
  run.moored = null;
  run.yard.reset(history.projects);
  function say(msg) {
    run.feedback = msg;
    run.feedbackAt = sim.state.time;
  }
  let disposition = '';
  sim.events.on('sliced', (e) => {
    if (sim.state.floors.length < FIRST_DECK || run.count >= TARGET) return;
    if (!acceptsSlice(sim.state.floors.length, e)) {
      disposition = 'Срез упал слева от жёлоба';
      return;
    }
    if (city === 'harbor' && !bargeAtDock(sim.state.time)) {
      disposition = 'Баржа в рейсе. Дождитесь швартовки';
      return;
    }
    run.yard.deliver(
      e.pieces.find((p) => p.x > e.cx + 0.001 && p.d >= 0.5),
      sim.state.time,
      run.count,
    );
    run.count++;
    disposition =
      run.count === TARGET
        ? city === 'valley'
          ? 'Мостик готов! Садовник везёт урожай'
          : 'Баржа загружена и отправляется в рейс'
        : city === 'valley'
          ? 'Доска легла на мостик'
          : 'Доска на палубе';
  });
  sim.events.on('landed', (e) => {
    say(
      disposition ||
        (e.zone === 'perfect'
          ? 'Точно по центру!'
          : e.index + 1 < FIRST_DECK
            ? 'Этаж на месте'
            : 'Этаж установлен'),
    );
    disposition = '';
    if (run === active) refresh();
  });
  sim.events.on('missed', () => {
    say('Мимо опоры. Дождитесь следующего прохода');
    if (run === active) refresh();
  });
  sim.events.on('finished', ({ floors }) => {
    studyFinish('slice', city, history.studyRun, floors);
    run.roofPending = true;
    if (run === active) refresh();
  });
  // В журнале хранятся только моменты реальных нажатий. Долгое ожидание можно
  // воспроизвести без отрисовки. Новый дом сохраняет незаконченный настил или груз.
  if (history.drops.length) {
    const end = history.drops.at(-1) + Math.ceil(1.16 / SIM_DT);
    let next = 0;
    for (; run.tick < end; run.tick++) {
      if (history.drops[next] === run.tick) {
        sim.step(SIM_DT, DROP);
        next++;
      } else sim.step(SIM_DT);
    }
  }
  // При восстановлении уже упавшие обломки остаются в прошлом.
  view.attach(sim);
  view.sync(sim, 1, 0);
  run.sealed = history.closed === true && run.count === TARGET && !sim.state.finished;
  if (run.sealed) run.roofPending = true;
  run.cameraFloors = sim.state.floors.length;
}

function refresh() {
  const run = active,
    { city, sim, count, history } = run,
    st = sim.state,
    done = run.sealed || !!st.finished;
  const harbor = city === 'harbor',
    text = TOWNS[city],
    floors = st.floors.length;
  document.body.classList.toggle('harbor', harbor);
  for (const id of Object.keys(TOWNS)) ui[id].setAttribute('aria-pressed', String(id === city));
  ui.location.textContent = harbor ? 'Морская гавань' : 'Солнечная долина';
  ui.mission.textContent = text.title;
  ui.brief.textContent = text.task;
  ui['project-name'].textContent = text.unit;
  ui.count.textContent = count + ' / ' + TARGET;
  for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('done', i < count);
  ui.height.textContent = floors + ' / 10 этажей';
  ui.lives.textContent = 'Запас промахов · ' + (st.maxMisses - st.misses);
  ui.guide.textContent = done
    ? 'Можно остаться здесь или сменить город.'
    : floors < FIRST_DECK - 1
      ? 'Первые два этажа цельтесь в середину. Щелчок, касание или пробел.'
      : count === TARGET
        ? 'Дом можно достроить до десяти этажей.'
        : 'Отпустите этаж, когда метка войдёт в зелёную полосу справа.';
  ui.drop.hidden = done;
  ui.result.hidden = !done;
  ui.travel.textContent = text.other;
  ui.keep.hidden = done || count < TARGET;
  ui.again.textContent = st.floors.length ? 'Ещё один дом' : 'Попробовать снова';
  ui.record.textContent =
    'Домов: ' +
    (history.houses + (done && floors > 0 ? 1 : 0)) +
    ' · ' +
    (harbor ? 'Рейсов: ' : 'Мостиков: ') +
    (history.projects + (count === TARGET ? 1 : 0)) +
    ' · Лучший дом: ' +
    Math.max(history.best, done ? floors : 0);
  ui.aim.hidden = done;
  document.querySelector('.aim-label').hidden = done;
  if (done)
    ui.notice.textContent =
      (floors === 10 ? 'Все 10 этажей на месте' : 'Стройка окончена') +
      ' · ' +
      (count === TARGET ? (harbor ? 'Баржа загружена' : 'Мостик готов') : 'доски ' + count + ' из ' + TARGET);
  run.moored = null;
}
function select(city) {
  if (!runs.has(city)) runs.set(city, workshop(city, load(city)));
  active = runs.get(city);
  active.input = false;
  steps.reset();
  previous = 0;
  ui.notice.textContent = '';
  refresh();
  resize();
  const address = new URL(location.href);
  address.searchParams.set('city', city);
  window.history.replaceState(null, '', address);
  studyOpen('slice', city);
}
function repeat() {
  const run = active,
    { history, sim, count } = run;
  if (!run.sealed && !sim.state.finished) return;
  const floors = sim.state.floors.length;
  if (floors) {
    history.houses++;
    history.lastHouse = { floors, shape: encodeShape(sim.state.floors) };
  }
  history.best = Math.max(history.best, floors);
  if (count === TARGET) history.projects++;
  history.carry = count === TARGET ? 0 : count;
  history.attempt++;
  history.drops = [];
  history.closed = false;
  history.studyRun = studyStart('slice', run.city, history.studyRun);
  newHouse(run);
  save(run);
  steps.reset();
  ui.notice.textContent = '';
  refresh();
  ui.drop.focus();
}
function drop() {
  if (active && !active.sealed && active.sim.state.phase === 'hanging') active.input = true;
}
function keepHouse() {
  const r = active;
  if (r.sealed || r.sim.state.finished || r.count !== TARGET || r.input || r.sim.state.phase === 'falling')
    return;
  r.sealed = true;
  r.history.closed = true;
  studyFinish('slice', r.city, r.history.studyRun, r.sim.state.floors.length);
  r.roofPending = true;
  save(r);
  refresh();
  ui.again.focus();
}
function step(dt) {
  const r = active;
  if (r.sealed) {
    r.afterClose += dt;
    return;
  }
  r.view.beforeStep(r.sim);
  if (r.input && r.sim.state.phase === 'hanging') {
    if (!r.history.drops.length) {
      // Первая площадка открывается сама. Начало фиксирует только принятый сброс.
      r.history.studyRun ??= studyStart('slice', r.city);
      studyDrop('slice', r.city, r.history.studyRun);
    }
    r.history.drops.push(r.tick);
    save(r);
    r.sim.step(dt, DROP);
  } else r.sim.step(dt);
  r.tick++;
  r.input = false;
}

function resize() {
  if (!renderer) return;
  const canvas = ui.world,
    w = canvas.clientWidth,
    h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
}
function frame(now) {
  const dt = previous ? Math.min((now - previous) * 0.001, 0.066) : 0;
  previous = now;
  const r = active,
    sim = r.sim,
    st = sim.state;
  steps.advance(dt, step);
  r.view.sync(sim, steps.alpha, dt);
  if (r.roofPending) {
    r.roofPending = false;
    if (st.floors.length) r.view.addRoof('house', () => {});
  }
  const n = st.floors.length,
    deck = n >= FIRST_DECK - 1 && r.count < TARGET;
  r.rack.visible = deck;
  r.rack.scale.x = (st.falling?.w ?? st.hanging.w) / W0;
  r.yard.update(st.time + r.afterClose, r.count);
  if (r.sealed) {
    r.view.activePivot.visible = false;
    r.view.crane.setLoad(null);
  }
  const done = r.sealed || !!st.finished,
    top = st.floors.at(-1),
    ready = !done && st.phase === 'hanging';
  const predicted =
    (st.hook.x + st.hook.vx * SIM.inherit * FALL - (top?.x ?? 0) - sim.topOffset(offset).x) / (top?.w ?? W0);
  if (!done) aimGauge(aim, predicted, deck, ready);
  if (ui.drop.disabled === ready) ui.drop.disabled = !ready;
  ui.keep.disabled = st.phase === 'falling';
  const docked = bargeAtDock(st.time);
  const signal = docked && st.time % CYCLE > MOORED - FALL - 0.15 ? 'leaving' : docked ? 'moored' : 'away';
  if (r.moored !== signal) {
    r.moored = signal;
    ui.traffic.textContent =
      r.count === TARGET
        ? r.city === 'harbor'
          ? 'Полный груз отправлен.'
          : 'Дорога к огороду открыта.'
        : r.city === 'harbor'
          ? signal === 'leaving'
            ? 'Баржа отходит'
            : docked
              ? '● Баржа у жёлоба'
              : '○ Баржа в пути'
          : 'Доски скатятся по жёлобу справа.';
  }
  if (!done) {
    const notice = st.time - r.feedbackAt < 2.0 ? r.feedback : '';
    if (ui.notice.textContent !== notice) ui.notice.textContent = notice;
  }
  // В кадре остаются и крюк, и адресат доски; высота кадра растёт вместе с домом.
  r.cameraFloors += (n - r.cameraFloors) * (1 - Math.exp(-dt * 5));
  positionCamera(camera, focus, r.cameraFloors);
  renderer.render(r.scene, camera);
  requestAnimationFrame(frame);
}

async function start() {
  renderer = createRenderer(ui.world);
  await Promise.all([prepareWallTextures(), assets.ensure(['core', 'flora']).catch(() => {})]);
  const city = new URLSearchParams(location.search).get('city') === 'harbor' ? 'harbor' : 'valley';
  select(city);
  for (const id of Object.keys(TOWNS)) {
    ui[id].disabled = false;
    ui[id].onclick = () => {
      select(id);
      ui.world.focus({ preventScroll: true });
    };
  }
  ui.drop.onclick = drop;
  ui.world.onpointerdown = drop;
  ui.again.onclick = repeat;
  ui.keep.onclick = keepHouse;
  ui.travel.onclick = () => select(active.city === 'valley' ? 'harbor' : 'valley');
  window.addEventListener('keydown', (e) => {
    if (
      e.code === 'Space' &&
      !e.repeat &&
      (e.target === document.body || e.target === ui.world || e.target === ui.drop)
    ) {
      e.preventDefault();
      drop();
    }
  });
  new ResizeObserver(resize).observe(ui.world);
  document.addEventListener('visibilitychange', () => {
    previous = 0;
    active.input = false;
    steps.reset();
  });
  requestAnimationFrame(frame);
}
start().catch((error) => {
  ui.notice.textContent = 'Не удалось открыть стройплощадку. Обновите страницу в браузере с WebGL.';
  console.error(error);
});
