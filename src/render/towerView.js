// Вид башни: этажи по состоянию симуляции, висящий/падающий этаж на кране, обломки и крыша.
// Отрисовка интерполирует между шагами симуляции (alpha) и сглаживает скачки смещений,
// когда меняется число этажей (раскачивание считается от высоты башни) или срабатывает якорь.
// С набором kit (башня из сырников, «Сладкий город» §5.5) этажи, обломки, крыша и тень — его; смещение круга
// сырника у каждого этажа (§5.2) — состояние вида: ядро о нём не знает.
import * as THREE from 'three';
import { FLOOR_H, SIM, SPECIAL_TYPES, STORM } from '../core/levels.js';
import { TOPPING_FLAT, topCircle } from '../core/syrnikShape.js';
import { decodeShape, encodeShape } from '../core/towerShape.js';
import { buildFloorMeshes } from './models/floor.js';
import { buildRoof } from './models/roof.js';
import { createCrane } from './models/crane.js';
import { PLAZA_TOP } from './models/environment.js';
import { Debris } from './effects/debris.js';

export const SQUASH_TIME = 0.36;   // «пружинка» верхнего этажа при посадке, с
export const VISIBLE_BELOW = 30;   // этажи ниже верха больше чем на столько метров не рисуются
// Тень башни отбрасывает один InstancedMesh коробок (по коробке на видимый этаж), а не 2 меша на этаж:
// иначе 25 этажей дают 50 лишних вызовов отрисовки в проходе теней. Детали (карниз, маркизы)
// отбрасывают тень сами только у верхних этажей — там, куда смотрит камера во время стройки.
export const TRIM_SHADOW_TOP = 2;
const SHADOW_INSET = 0.04;         // коробка внутри скруглённого корпуса (скругление 0.08), без полос на углах
const PROXY_MAX = Math.ceil(VISIBLE_BELOW / FLOOR_H) + 2;

const SQUASH_AMP = 0.16;
// «плюх» крыши-начинки (squashRoof, «Сладкий город», шаг Б §4.6): сметана и варенье мягче этажа — сжатие сильнее,
// раздаются вширь на ROOF_SQUASH_WIDEN сжатия; затухание и отскок — как у пружинки этажа за SQUASH_TIME
const ROOF_SQUASH_AMP = 0.24;
const ROOF_SQUASH_WIDEN = 0.5;
const CORR_DECAY = 12;             // затухание поправки смещений, 1/с
const HOOK_FOLLOW = 12;            // подъём крюка за ростом башни, 1/с
const HOOK_AWAY = 5;               // после финиша крюк уходит вверх
const TILT = 0.1;                  // наклон троса на краю качания, рад
const ROOF_TIME = 0.8;
const ROOF_FROM = 3.5;             // высота, с которой падает крыша
const FALL_LEVEL = 8;              // выравнивание падающего этажа после отцепки, 1/с
const DROP_VY = -Math.sqrt(2 * SIM.g * SIM.dropHeight);

const r2 = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
/** Равенство чисел, как у их строк: NaN равен NaN (прежний строковый ключ активного этажа). */
const sameNum = (a, b) => a === b || (a !== a && b !== b);

/**
 * Тип спец-этажа для вида (план, отличие 8): у золотого, у этажа 0 и вне SPECIAL_TYPES — null. Симуляция не ставит
 * тип на золотой этаж и на этаж 0; защита — на случай расхождения (подмены в тестах, чужие события).
 */
export function specialOf(index, golden, special) {
  return !golden && index > 0 && SPECIAL_TYPES.includes(special) ? special : null;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const NO_FLOORS = [];
const flightBounds = new WeakMap();

function facingDepth(group, bounds, side) {
  return side * group.position.z + (side > 0 ? bounds.max.z : -bounds.min.z) * group.scale.z;
}

/**
 * Невидимый в основном проходе (без записи цвета и глубины) набор коробок, который рисуется
 * только как отбрасыватель тени: 1 вызов в проходе теней на всю башню. geom — своя форма тени этажа
 * (круглая у сырника: её владелец — набор), иначе коробка вида.
 */
function makeShadowProxy(geom = null) {
  geom ??= new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // основание на уровне пола этажа
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const m = new THREE.InstancedMesh(geom, mat, PROXY_MAX);
  m.name = 'towerShadow';
  m.count = 0;
  m.visible = false;
  m.castShadow = true;
  m.receiveShadow = false;
  m.frustumCulled = false; // boundingSphere экземпляров не пересчитывается каждый кадр
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}

export class TowerView {
  /** kit — набор этажей-сырников (syrnikTower.createSyrnikKit): им строятся все этажи; освобождает его создатель. */
  constructor(scene, { styleFor = () => 'house', kit = null } = {}) {
    this.scene = scene;
    this.styleFor = styleFor;
    this.kit = kit;
    this.baseY = PLAZA_TOP;
    this.root = new THREE.Group();
    this.root.name = 'towerView';
    this.crane = createCrane();
    this.debris = new Debris({ seed: 23, makePiece: kit ? (o) => kit.piece(o) : null });
    this.root.add(this.crane.group, this.debris.group);
    this.shadowProxy = makeShadowProxy(kit?.shadowGeometry);
    this.root.add(this.shadowProxy);
    if (kit) this.root.add(kit.lower);
    // круг сырника (§5.2): центр круга от центра прямоугольника этажа i — _cox[i], _coz[i] (по событиям посадки);
    // _fall — круг падающего этажа (снимок при сбросе), _act — висящего, _circ — рабочий
    this._cox = []; this._coz = [];
    this._fall = { ox: 0, oz: 0 };
    this._act = { ox: 0, oz: 0 };
    this._circ = { ox: 0, oz: 0 };
    this.floors = [];
    this.activePivot = new THREE.Group();
    this.activePivot.name = 'activeFloor';
    this.activePivot.visible = false;
    this._activeMesh = null;
    this._cargoFlightBox = new THREE.Box3();
    this._cargoFlightReady = false;
    // ключ активного меша — поля, а не строка: кадр сравнивает их без новой строки (_ensureActiveMesh)
    this._ak = { ok: false, style: '', w: 0, d: 0, golden: 0, variant: 0, entry: 0, sp: '', ox: 0, oz: 0 };
    // фаза симуляции в прошлом sync (null — его ещё не было): переход в spawning — кадр посадки (_syncActive)
    this._phase = null;
    this.roof = null;
    this.roofHeight = 0;
    // место начинки последней крыши набора ({ kind, x, z, s, ox, oz }, _roofSpot) — для крупного плана финала; иначе null
    this.roofSpot = null;
    this._roofT = 0; // время падения крыши; меньше нуля — крыша ещё ждёт (addRoof delay)
    this._roofCb = null;
    // «плюх» крыши (squashRoof): что сжимается (опора начинки набора или вся крыша) и время с начала (−1 — нет)
    this._roofBody = null;
    this._roofSquash = -1;
    scene.add(this.root);

    this._sim = null;
    this._detach = [];
    this._cx = []; this._cz = [];        // поправки смещений этажей
    this._ox = []; this._oz = [];        // показанные смещения (позиция − локальная x/z этажа)
    this._lastN = -1;
    this._rebase = false;
    this._prev = { valid: false, n: 0, tx: 0, tz: 0, hx: 0, hz: 0, falling: false, fx: 0, fy: 0, fz: 0 };
    this._hookY = NaN;
    this._squash = null;                 // { index, t }
    this._top = new THREE.Vector3();
    // кадр без новых объектов: смещение верха (sim.topOffset пишет сюда) и верх башни для обломков
    this._off = { x: 0, z: 0 };
    this._tower = { x: 0, z: 0, w: 0, d: 0, top: 0 };
  }

  /** Подписка на события симуляции (посадка, срез, промах, якорь); фаза прошлой симуляции забывается. → отписка. */
  attach(sim) {
    const ev = sim.events;
    this._phase = null; // первый sync новой симуляции — не кадр посадки (_syncActive)
    const offs = [
      ev.on('dropped', () => this._onDropped(sim)),
      ev.on('landed', (e) => { this._landCircle(sim, e); this.onLanded(e); }),
      ev.on('sliced', (e) => this._onSliced(sim, e)),
      ev.on('missed', (e) => this._onMissed(sim, e)),
      ev.on('stormStrike', (e) => this._onStrike(e)),
      ev.on('bonusUsed', (e) => { if (e.id === 'anchor') this._rebase = true; }),
    ];
    const off = () => {
      for (const f of offs.splice(0)) f();
      const i = this._detach.indexOf(off);
      if (i >= 0) this._detach.splice(i, 1);
    };
    this._detach.push(off);
    return off;
  }

  /** Снимок перед шагом симуляции — для интерполяции между шагами. */
  beforeStep(sim) {
    // результат, а не this._off: подделка симуляции в тестах может вернуть свой объект
    const st = sim.state, p = this._prev, t = sim.topOffset(this._off);
    p.valid = true; p.n = st.floors.length; p.tx = t.x; p.tz = t.z;
    p.hx = st.hook.x; p.hz = st.hook.z;
    p.falling = !!st.falling;
    if (st.falling) { p.fx = st.falling.x; p.fy = st.falling.y; p.fz = st.falling.z; }
  }

  onLanded({ index }) {
    const prev = this._squash && this.floors[this._squash.index];
    if (prev) prev.scale.set(1, 1, 1);
    this._squash = { index, t: 0 };
  }

  // ---------- круг сырника (§5.2) ----------

  /** Круг этажа w × d, который наследует круг верхнего из floors (висящий — копия верхнего); у пустой башни — (0, 0). */
  _inherit(floors, w, d, out) {
    const n = floors.length, clamp = this.kit.clampOffset;
    if (n) {
      const t = floors[n - 1];
      clamp(this._cox[n - 1] ?? 0, this._coz[n - 1] ?? 0, t.w, t.d, out); // верх мог стать шире («Расширение»)
    } else {
      out.ox = 0; out.oz = 0;
    }
    return clamp(out.ox, out.oz, w, d, out);
  }

  _setCircle(i, ox, oz) {
    const X = this._cox, Z = this._coz;
    while (X.length < i) { X.push(0); Z.push(0); }
    X[i] = ox; Z[i] = oz;
  }

  /** Сброс: круг падающего — круг висящего в этот момент (его срежут посадка и куски). */
  _onDropped(sim) {
    const f = sim.state.falling;
    if (this.kit && f) this._inherit(sim.state.floors, f.w, f.d, this._fall);
  }

  /**
   * Посадка: при попадании круг остаётся там, где сел падающий (центр его прямоугольника lx, lz плюс его круг), этаж —
   * пересечение; «идеально» ставит этаж ровно на верхний вместе с кругом. Затем ограничения §5.2 (clampOffset).
   */
  _landCircle(sim, e) {
    const f = this.kit ? sim.state.floors[e.index] : null;
    if (!f) return;
    let ox = this._fall.ox, oz = this._fall.oz;
    if (e.zone !== 'perfect' && Number.isFinite(e.lx) && Number.isFinite(e.lz)) { ox += e.lx - f.x; oz += e.lz - f.z; }
    const c = this.kit.clampOffset(ox, oz, f.w, f.d, this._circ);
    this._setCircle(e.index, c.ox, c.oz);
  }

  /** Круг сырника верхнего этажа из floors (состояние симуляции): из состояния вида, в пределах §5.2. → this._circ. */
  _topCircle(floors) {
    const n = floors.length, top = floors[n - 1];
    return this.kit.clampOffset(this._cox[n - 1] ?? 0, this._coz[n - 1] ?? 0, top.w, top.d, this._circ);
  }

  /**
   * Начинка крыши на верхнем этаже этажей floors — по записи формы, как у этого дома на карте и в buildingTop:
   * прямоугольник верхнего этажа с округлением записи (1 см) и круг, выведенный из неё (topCircle). Точные ширина этажа
   * и круг вида отличаются на доли сантиметра, и у верха на границе TOPPING_R_MIN или ровного верха TOPPING_FLAT в
   * стройке бывала начинка, а на карте — пудра (§1: дом на карте — тот, что построен; финальное ревью ветки, мелкое 1).
   * Зовётся при посадке крыши и последнего этажа, не в кадре. → { kind, x, z, s, ox, oz } — место начинки от центра
   * этажа и круг.
   */
  _roofSpot(floors) {
    const shape = decodeShape(encodeShape(floors)), t = shape[shape.length - 1], c = topCircle(shape);
    const sp = this.kit.roofSpot(t.w, t.d, c.ox, c.oz);
    return { kind: sp.kind, x: sp.x, z: sp.z, s: sp.s, ox: c.ox, oz: c.oz };
  }

  /**
   * Начинка крыши, которая сядет на верхний этаж симуляции sim (_roofSpot, как addRoof): { kind, x, z, s, ox, oz }; без
   * набора или этажей — null. Для посадки жителей последнего этажа (buildScene._parachutes).
   */
  toppingSpot(sim) {
    const floors = sim?.state.floors;
    if (!this.kit || !floors?.length) return null;
    return this._roofSpot(floors);
  }

  /**
   * Крыша падает на верхний этаж с высоты ROOF_FROM за ROOF_TIME; onLand вызывается один раз. delay (с) — сначала крыша
   * ждёт над верхом скрытой (финал «посадка крупно»: камера подходит к крупному плану, а крыша вне его кадра на любом
   * экране), затем падает так же.
   */
  addRoof(style, onLand, { delay = 0 } = {}) {
    const top = this._sim?.state.floors.at(-1);
    if (!top) { onLand?.(); return null; }
    if (this.roof) this.root.remove(this.roof);
    const kit = this.kit;
    this.roofSpot = null;
    if (kit) {
      // начинка типа здания или пудра на верхнем сырнике (шаг Б §4.6): этаж посадки ещё может быть не построен видом —
      // круг из состояния вида (по нему — пудра на срезе этажа); начинка — по записи формы (_roofSpot), как на карте;
      // на золотом верхнем этаже крыша лежит на меду
      const floors = this._sim.state.floors, n = floors.length, spot = this.roofSpot = this._roofSpot(floors);
      const c = this._topCircle(floors);
      this.roof = kit.roof(top.w, top.d, c.ox, c.oz, n - 1, { golden: !!top.golden, spot });
    } else {
      this.roof = buildRoof(style, top.w, top.d);
    }
    this.roof.updateMatrixWorld(true);
    /** Высота крыши над верхом башни (для кадра финиша). */
    const bounds = new THREE.Box3().setFromObject(this.roof);
    this.roofHeight = Math.max(0, bounds.max.y);
    flightBounds.set(this.roof, bounds);
    this.roof.visible = false;
    this.root.add(this.roof);
    this._roofT = -Math.max(0, Number(delay) || 0);
    this._roofCb = onLand || null;
    this._roofBody = this.roof.getObjectByName('toppingPivot') ?? this.roof;
    this._roofSquash = -1;
    return this.roof;
  }

  /**
   * «Плюх» севшей крыши (шаг Б §4.6: сметана и варенье — без частиц): опора начинки (у набора — в центре её низа;
   * иначе вся крыша) сжимается по высоте и раздаётся вширь, затем отскакивает и успокаивается за SQUASH_TIME.
   * Сжатие видно в кадре посадки; дальше его ведёт sync — без новых объектов.
   */
  squashRoof() {
    if (!this._roofBody) return;
    this._roofSquash = 0;
    this._squashRoofBody();
  }

  _squashRoofBody() {
    const t = this._roofSquash, body = this._roofBody;
    if (t >= SQUASH_TIME) {
      body.scale.set(1, 1, 1);
      this._roofSquash = -1;
      return;
    }
    const k = 1 - t / SQUASH_TIME;
    const d = ROOF_SQUASH_AMP * k * k * Math.cos(3 * Math.PI * t / SQUASH_TIME);
    body.scale.set(1 + d * ROOF_SQUASH_WIDEN, 1 - d, 1 + d * ROOF_SQUASH_WIDEN);
  }

  /** Мировые координаты центра верха башни (как она показана). */
  topPosition(out = new THREE.Vector3()) {
    const g = this.floors.at(-1);
    return out.set(g ? g.position.x : 0, this.baseY + this.floors.length * FLOOR_H, g ? g.position.z : 0);
  }

  /** Внешняя граница между высотами bottom и top в координатах видимой башни. */
  parachuteProfile(route, bottom, top, landingBottom = bottom) {
    const { side, index, relativeX } = route;
    const target = this.floors[index];
    if (target) {
      route.x = target.position.x + relativeX * target.scale.x;
      route.windowDepth = facingDepth(target, flightBounds.get(target), side);
    }
    // Карнизы, цоколь и короткое сжатие могут вывести отделку за уровень своего этажа.
    const lowest = Math.min(bottom, landingBottom);
    const first = Math.max(0, Math.floor((lowest - this.baseY - .35) / FLOOR_H));
    const end = Math.min(this.floors.length, Math.ceil((top - this.baseY + .35) / FLOOR_H));
    for (let i = first; i < end; i++) {
      const floor = this.floors[i], bounds = flightBounds.get(floor);
      const high = floor.position.y + bounds.max.y * floor.scale.y;
      if (high <= lowest ||
          floor.position.y + bounds.min.y * floor.scale.y >= top) continue;
      const depth = facingDepth(floor, bounds, side);
      if (high > bottom) route.edge = Math.max(route.edge, depth);
      route.approachDepth = Math.max(route.approachDepth, depth);
    }
    const roof = this.roof;
    if (roof?.visible) {
      const bounds = flightBounds.get(roof);
      if (bounds && roof.position.y + bounds.max.y * roof.scale.y > bottom &&
          roof.position.y + bounds.min.y * roof.scale.y < top) {
        const extra = this._roofSquash >= 0 && this._roofBody !== roof ? .12 * bounds.getSize(_s).z / 2 : 0;
        route.edge = Math.max(route.edge, facingDepth(roof, bounds, side) + extra);
      }
    }
    route.edge = Math.max(route.edge, route.windowDepth);
    route.approachDepth = Math.max(route.approachDepth, route.edge);
  }

  /** Текущая грань груза и грань в зоне упреждения при его спуске. */
  parachuteCargo(route, x, reach, bottom, top) {
    route.cargoDepth = route.cargoAhead = -Infinity;
    if (!this.activePivot.visible || !this._activeMesh) return;
    const box = this._cargoFlightBox;
    if (!this._cargoFlightReady) {
      this._activeMesh.updateWorldMatrix(true, false);
      box.copy(flightBounds.get(this._activeMesh)).applyMatrix4(this._activeMesh.matrixWorld);
      this._cargoFlightReady = true;
    }
    if (box.max.y <= bottom || box.max.x <= x - reach || box.min.x >= x + reach) return;
    const depth = route.side > 0 ? box.max.z : -box.min.z;
    if (box.min.y < top) route.cargoDepth = depth;
    const dropping = this._sim.state.phase === 'falling';
    if (box.min.y < top + (dropping ? 2.8 : .6)) route.cargoAhead = depth;
  }

  /** Точка касания и центр начинки с учётом смещения и сжатия видимого верхнего этажа. */
  roofParachuteTarget(route, fallback) {
    const floor = this.floors[route.index];
    route.x = floor ? floor.position.x + route.relativeX * floor.scale.x : fallback.x;
    route.z = floor ? floor.position.z + route.relativeZ * floor.scale.z : fallback.z;
    route.y = floor ? floor.position.y + FLOOR_H * floor.scale.y + route.lift : fallback.y;
    route.centerX = floor ? floor.position.x + route.toppingX : route.x - route.headingX * route.distance;
    route.centerZ = floor ? floor.position.z + route.toppingZ : route.z - route.headingZ * route.distance;
  }

  /** Расстояние от точки до ровной поверхности среза, отрицательное над опорой. */
  roofParachuteEdge(route, x, z) {
    const floor = this.floors[route.index];
    if (!floor) return Infinity;
    const localX = (x - floor.position.x) / floor.scale.x, localZ = (z - floor.position.z) / floor.scale.z;
    const { w, d } = floor.userData;
    return Math.max(Math.abs(localX) - w / 2, Math.abs(localZ) - d / 2,
      Math.hypot(localX - route.circleX, localZ - route.circleZ) - TOPPING_FLAT);
  }

  sync(sim, alpha = 1, dt = 0) {
    this._sim = sim;
    dt = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    alpha = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
    const st = sim.state, n = st.floors.length, p = this._prev;

    this._syncFloorMeshes(st);
    const cur = sim.topOffset(this._off);
    const lerpTop = p.valid && p.n === n;
    const tx = lerpTop ? lerp(p.tx, cur.x, alpha) : cur.x;
    const tz = lerpTop ? lerp(p.tz, cur.z, alpha) : cur.z;
    this._syncOffsets(st, n, tx, tz, dt);
    this._syncSquash(dt);
    if (this.kit) this.kit.setLower(this.floors);
    this._syncShadow();
    this._syncActive(st, alpha, dt);
    this._syncCrane(sim, st, alpha, dt);
    this._cargoFlightReady = false;
    this._syncRoof(dt);
    const top = this.floors.at(-1), f = st.floors.at(-1);
    let tower = null;
    if (top) {
      tower = this._tower;
      tower.x = top.position.x; tower.z = top.position.z; tower.w = f.w; tower.d = f.d; tower.top = this.baseY + n * FLOOR_H;
    }
    this.debris.update(dt, this.baseY, tower);
  }

  _makeFloor(i, f) {
    const golden = !!f.golden, special = specialOf(i, golden, f.special), kit = this.kit;
    let g;
    if (kit) {
      // круг — по состоянию вида, в пределах §5.2 для нынешнего размера (верх мог стать шире)
      const c = kit.clampOffset(this._cox[i] ?? 0, this._coz[i] ?? 0, f.w, f.d, this._circ);
      this._setCircle(i, c.ox, c.oz);
      g = kit.floor(i, { w: f.w, d: f.d, golden, special }, c.ox, c.oz);
    } else {
      g = buildFloorMeshes({ style: this.styleFor(i), w: f.w, d: f.d, seed: i, golden, entry: i === 0, special });
    }
    g.name = 'floor' + i;
    flightBounds.set(g, new THREE.Box3().setFromObject(g));
    g.position.y = this.baseY + i * FLOOR_H;
    for (const m of g.children) m.castShadow = false; // тень — от shadowProxy, детали включает _syncShadow
    this.root.add(g);
    return g;
  }

  _trimFloors(n) {
    while (this.floors.length > n) { this.root.remove(this.floors.pop()); this._cx.pop(); this._cz.pop(); this._ox.pop(); this._oz.pop(); }
    if (this._cox.length > n) this._cox.length = this._coz.length = n;
    if (this._squash && this._squash.index >= n) this._squash = null;
  }

  /** Снимаем верх сразу: до следующего кадра следующие шаги симуляции уже могут поставить этаж на его место. */
  _onStrike({ index, floor, x, y, z }) {
    const circle = this.kit?.clampOffset(this._cox[index] ?? 0, this._coz[index] ?? 0, floor.w, floor.d, this._circ);
    const style = this.styleFor(index), special = specialOf(index, !!floor.golden, floor.special);
    for (let side = -1; side <= 1; side += 2) {
      const shift = side * floor.w / 4;
      this.debris.spawnPiece({
        x: x + shift, y: this.baseY + y - FLOOR_H, z, w: floor.w / 2, d: floor.d,
        vx: side * 5.6, vy: 2.3 + side * 0.35, vz: side * 0.65, spin: 2.5, hold: STORM.leaderTime,
        style, golden: !!floor.golden, special, seed: index, entry: index === 0, index, cache: true,
        ox: (circle?.ox ?? 0) - shift, oz: circle?.oz ?? 0,
      });
    }
    this._trimFloors(index);
    if (this._activeMesh) this.activePivot.remove(this._activeMesh);
    this._activeMesh = null;
    this._ak.ok = false;
    this._prev.valid = false;
    this.kit?.releaseStruckFloors(index);
  }

  /** Меши этажей по списку симуляции; верхний перестраивается, если изменился его размер (расширение). */
  _syncFloorMeshes(st) {
    const n = st.floors.length;
    if (this.floors.length > n || this._cox.length > n) this._trimFloors(n);
    for (let i = this.floors.length; i < n; i++) this.floors.push(this._makeFloor(i, st.floors[i]));
    if (n) {
      const f = st.floors[n - 1], g = this.floors[n - 1], u = g.userData;
      if (u.w !== r2(f.w) || u.d !== r2(f.d) || u.golden !== !!f.golden || u.special !== specialOf(n - 1, !!f.golden, f.special)) {
        const ng = this._makeFloor(n - 1, f);
        ng.position.copy(g.position); ng.scale.copy(g.scale);
        this.root.remove(g);
        this.floors[n - 1] = ng;
      }
    }
  }

  /**
   * Смещения раскачивания: цель q·верх, q = ((i+1)/n)². Когда n меняется (или якорь), поправка
   * сохраняет показанное положение и затухает — нижние этажи не прыгают, а плавно догоняют.
   */
  _syncOffsets(st, n, tx, tz, dt) {
    const cx = this._cx, cz = this._cz, ox = this._ox, oz = this._oz;
    const k = Math.exp(-CORR_DECAY * dt);
    for (let i = 0; i < cx.length; i++) { cx[i] *= k; cz[i] *= k; }
    const oldN = this._lastN;
    const rebase = oldN >= 0 && (oldN !== n || this._rebase);
    const refX = oldN > 0 ? ox[Math.min(oldN, ox.length) - 1] ?? 0 : 0;
    const refZ = oldN > 0 ? oz[Math.min(oldN, oz.length) - 1] ?? 0 : 0;
    for (let i = 0; i < n; i++) {
      const q = ((i + 1) / n) ** 2, gx = tx * q, gz = tz * q;
      if (i >= cx.length) { cx.push(0); cz.push(0); ox.push(gx); oz.push(gz); }
      if (rebase) {
        // старые этажи остаются где были; новый — со смещением прежнего верха, куда он и садился
        const known = i < Math.min(oldN, ox.length);
        cx[i] = (known ? ox[i] : refX) - gx;
        cz[i] = (known ? oz[i] : refZ) - gz;
      } else if (oldN < 0) { cx[i] = 0; cz[i] = 0; }
      const f = st.floors[i], g = this.floors[i];
      ox[i] = gx + cx[i]; oz[i] = gz + cz[i];
      g.position.x = f.x + ox[i];
      g.position.z = f.z + oz[i];
      g.visible = (i + 1) * FLOOR_H >= n * FLOOR_H - VISIBLE_BELOW;
    }
    this._lastN = n;
    this._rebase = false;
  }

  _syncSquash(dt) {
    const s = this._squash;
    if (!s) return;
    s.t += dt;
    const g = this.floors[s.index];
    if (!g) { if (s.t > SQUASH_TIME) this._squash = null; return; }
    if (s.t >= SQUASH_TIME) { g.scale.set(1, 1, 1); this._squash = null; return; }
    const k = 1 - s.t / SQUASH_TIME;
    const d = SQUASH_AMP * k * k * Math.cos(3 * Math.PI * s.t / SQUASH_TIME);
    g.scale.set(1 + d * 0.5, 1 - d, 1 + d * 0.5);
  }

  /** Коробки тени по видимым этажам сверху вниз (с пружинкой); тень деталей — у TRIM_SHADOW_TOP верхних. */
  _syncShadow() {
    const proxy = this.shadowProxy, fl = this.floors, n = fl.length;
    let k = 0;
    for (let i = n - 1; i >= 0 && k < PROXY_MAX; i--) {
      const g = fl[i];
      if (!g.visible) break; // скрыты только нижние этажи подряд
      const parts = g.children; // по индексу: for…of — итератор на этаж в кадре
      for (let j = 0; j < parts.length; j++) if (parts[j].name === 'trim') parts[j].castShadow = i >= n - TRIM_SHADOW_TOP;
      const u = g.userData, sc = g.scale;
      _s.set(Math.max(0.05, u.w - 2 * SHADOW_INSET) * sc.x, (FLOOR_H - SHADOW_INSET) * sc.y, Math.max(0.05, u.d - 2 * SHADOW_INSET) * sc.z);
      _m.compose(g.position, _q, _s);
      proxy.setMatrixAt(k++, _m);
    }
    proxy.count = k;
    proxy.visible = k > 0;
    proxy.instanceMatrix.needsUpdate = true;
  }

  /**
   * Меш активного этажа (индекс n): тот же сид, размер и тип, что у будущего этажа башни, — без подмены при посадке
   * (балкон и «hit» садятся другим размером — тогда этаж башни строится своим мешем).
   */
  _ensureActiveMesh(index, w, d, golden, special = null) {
    const style = this.styleFor(index), sp = specialOf(index, golden, special), kit = this.kit;
    // сырник висит со своим кругом — копия верхнего (§5.2); у коробочного этажа круга нет
    const c = kit ? this._inherit(this._sim ? this._sim.state.floors : NO_FLOORS, w, d, this._act) : null;
    // этажи 0 и 4 — один вариант, но вход только у 0; у сырника вид — свой у каждого этажа (поворот и обжарка клетки);
    // ключ сравнивается по полям — без строки в кадре
    const k = this._ak, rw = r2(w), rd = r2(d), g = golden ? 1 : 0, variant = kit ? index : index & 3, entry = index === 0 ? 1 : 0, s = sp ?? '';
    const ox = c ? r2(c.ox) : 0, oz = c ? r2(c.oz) : 0;
    if (k.ok && k.style === style && sameNum(k.w, rw) && sameNum(k.d, rd) && k.golden === g && k.variant === variant &&
      k.entry === entry && k.sp === s && k.ox === ox && k.oz === oz) return;
    if (this._activeMesh) this.activePivot.remove(this._activeMesh);
    this._activeMesh = kit
      ? kit.active(index, { w, d, golden, special: sp }, c.ox, c.oz)
      : buildFloorMeshes({ style, w, d, seed: index, golden, entry: index === 0, special: sp });
    flightBounds.set(this._activeMesh, new THREE.Box3().setFromObject(this._activeMesh));
    this._activeMesh.position.y = -FLOOR_H; // опора — центр верха этажа (точка подвеса)
    this.activePivot.add(this._activeMesh);
    k.ok = true; k.style = style; k.w = rw; k.d = rd; k.golden = g; k.variant = variant; k.entry = entry; k.sp = s;
    k.ox = ox; k.oz = oz;
  }

  _syncActive(st, alpha, dt) {
    const pv = this.activePivot, n = st.floors.length, p = this._prev;
    if (st.phase === 'hanging') {
      const h = st.hanging;
      this._ensureActiveMesh(n, h.w, h.d, !!h.golden, h.special);
      if (pv.parent !== this.crane.hook) { this.crane.hook.add(pv); pv.position.set(0, 0, 0); pv.rotation.set(0, 0, 0); }
      pv.visible = true;
    } else if (st.phase === 'falling' && st.falling) {
      const f = st.falling;
      this._ensureActiveMesh(n, f.w, f.d, !!f.golden, f.special);
      if (pv.parent !== this.root) {
        const r = this.crane.hook.rotation;
        this.root.add(pv);
        pv.rotation.set(r.x, 0, r.z); // наклон троса гаснет уже в свободном падении
      }
      const a = p.valid && p.falling ? alpha : 1;
      pv.position.set(lerp(p.fx, f.x, a), this.baseY + lerp(p.fy, f.y, a) + FLOOR_H, lerp(p.fz, f.z, a));
      const k = Math.exp(-FALL_LEVEL * dt);
      pv.rotation.x *= k; pv.rotation.z *= k;
      pv.visible = true;
    } else {
      if (st.phase === 'spawning') {
        // следующий этаж готовим заранее, пока крюк пустой; сырник — не в кадре посадки (переход в spawning): тот
        // уже режет этаж посадки и куски, а висящий скрыт всю фазу и строится кадром позже («Сладкий город» §5.4, §8;
        // в кадре посадки с ним было до 5 мс на igpu). Если spawning короче кадра, его построит ветка hanging.
        const top = st.floors[n - 1];
        const landing = !!this.kit && this._phase !== null && this._phase !== 'spawning';
        // тип — тот, что выпал на следующий сброс (st.upcoming); у подделок симуляции без него — обычный этаж
        if (top && !landing) this._ensureActiveMesh(n, top.w, top.d, st.drops + 1 === st.nextGolden, st.upcoming ?? null);
      }
      pv.visible = false;
    }
    this._phase = st.phase;
  }

  _syncCrane(sim, st, alpha, dt) {
    const p = this._prev, crane = this.crane;
    const hx = p.valid ? lerp(p.hx, st.hook.x, alpha) : st.hook.x;
    const hz = p.valid ? lerp(p.hz, st.hook.z, alpha) : st.hook.z;
    const finished = st.phase === 'finished';
    const target = this.baseY + sim.topY() + SIM.dropHeight + FLOOR_H + (finished ? 4 : 0);
    if (!Number.isFinite(this._hookY)) this._hookY = target;
    else this._hookY += (target - this._hookY) * (1 - Math.exp(-(finished ? HOOK_AWAY : HOOK_FOLLOW) * dt));
    // груз отстаёт от тележки к центру качания: трос наклонён к оси, сильнее на краях
    const ax = -TILT * Math.max(-1, Math.min(1, hz / SIM.amp));
    const az = TILT * Math.max(-1, Math.min(1, hx / SIM.amp));
    crane.setHook(hx, this._hookY, hz, ax, az);
    const sling = this.kit ? this.kit.sling : 1; // ремни — на верх сырника, а не к углам прямоугольника
    if (st.phase === 'hanging') crane.setLoad(st.hanging.w * sling, st.hanging.d * sling);
    else crane.setLoad(null);
    crane.update(dt);
  }

  _syncRoof(dt) {
    const roof = this.roof;
    if (!roof) return;
    const top = this.floors.at(-1);
    if (!top) { roof.visible = false; return; }
    this._roofT += dt;
    // задержка (addRoof delay): крыша ждёт над верхом скрытой
    const t = Math.max(0, Math.min(1, this._roofT / ROOF_TIME));
    roof.visible = this._roofT >= 0;
    roof.position.set(top.position.x, this.baseY + this.floors.length * FLOOR_H + ROOF_FROM * (1 - t * t), top.position.z);
    if (this._roofSquash >= 0) {
      this._roofSquash += dt;
      this._squashRoofBody();
    }
    if (t >= 1 && this._roofCb) {
      const cb = this._roofCb;
      this._roofCb = null;
      cb();
    }
  }

  /**
   * Отрезанные части. У сырника круг куска — круг падавшего этажа: его центр (cx, cz — центр падавшего прямоугольника
   * в мире, плюс его круг) минус центр куска, без ограничений §5.2 (кусок — точная часть того сырника).
   */
  _onSliced(sim, { pieces, cx, cz }) {
    const i = Math.max(0, sim.state.floors.length - 1);
    const f = sim.state.floors[i];
    const style = this.styleFor(i), golden = !!f?.golden, special = specialOf(i, golden, f?.special);
    const round = !!this.kit && Number.isFinite(cx) && Number.isFinite(cz);
    const ccx = round ? cx + this._fall.ox : 0, ccz = round ? cz + this._fall.oz : 0;
    pieces.forEach((pc, k) => this.debris.spawnPiece({
      x: pc.x, y: this.baseY + pc.y, z: pc.z, w: pc.w, d: pc.d, vx: pc.vx, vz: pc.vz, vy: DROP_VY * 0.4,
      style, golden, seed: i + k, entry: i === 0, special, ox: round ? ccx - pc.x : 0, oz: round ? ccz - pc.z : 0, index: i,
    }));
  }

  _onMissed(sim, e) {
    const i = sim.state.floors.length;
    this.activePivot.visible = false;
    this.debris.spawnFloor({
      x: e.x, y: this.baseY + e.y, z: e.z, w: e.w, d: e.d, vx: e.vx, vz: e.vz, vy: DROP_VY,
      hold: sim.state.stormRod ? STORM.leaderTime : 0,
      style: this.styleFor(i), golden: !!e.golden, seed: i, entry: i === 0, special: specialOf(i, !!e.golden, e.special),
      ox: this._fall.ox, oz: this._fall.oz, index: i, // сырник падает целиком со своим кругом
    });
  }

  dispose() {
    for (const off of this._detach.slice()) off();
    this._detach.length = 0;
    this.activePivot.removeFromParent();
    this.root.removeFromParent();
    this.shadowProxy.removeFromParent();
    if (!this.kit) this.shadowProxy.geometry.dispose(); // круглая тень — набора
    this.shadowProxy.material.dispose();
    this.shadowProxy.dispose();
    this.crane.dispose();
    this.debris.dispose();
    this.floors.length = 0;
    this.roof = null;
    this.roofHeight = 0;
    this.roofSpot = null;
    this._roofCb = null;
    this._roofBody = null;
    this._roofSquash = -1;
    this._sim = null;
  }
}
