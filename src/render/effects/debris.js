// Обломки: отрезанные части и промахнувшиеся этажи. Баллистика с гравитацией, вращением,
// отскоком от земли и от верха башни (по AABB), затем уменьшение до исчезновения.
// Собственная геометрия обломков освобождается при удалении; одинаковые коробочные половины могут брать её из кэша этажей.
// makePiece — свои обломки вместо коробочных (куски сырника, «Сладкий город» §5.5): группа мешей со своей геометрией.
import * as THREE from 'three';
import { buildFloorMeshes } from '../models/floor.js';
import { createRng } from '../../core/rng.js';

export const DEBRIS_MAX = 14;
export const DEBRIS_GRAVITY = 30;
const RESTITUTION = 0.32;
const SETTLE_TIME = 0.6;   // сколько лежать на земле перед исчезновением
const SHRINK_TIME = 0.45;
const MAX_LIFE = 5;        // упавшее за край сцены тоже исчезает
const MAX_STEP = 1 / 60;

const finite = (v, def = 0) => (Number.isFinite(v) ? v : def);
const _m = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _axis = new THREE.Vector3(), _box = new THREE.Box3();
const _c = new THREE.Vector3(), _size = new THREE.Vector3();

export class Debris {
  constructor({ seed = 11, makePiece = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'debris';
    this.items = [];
    this.rng = createRng(seed);
    this.makePiece = makePiece;
    this._ext = { hx: 0, hy: 0, hz: 0 }; // полуразмеры обломка на подшаге (_step): один объект на все обломки
  }

  get active() { return this.items.length; }

  /**
   * Отрезанная часть: {x,y,z} — центр низа, w×d — размер, vx/vz/vy — скорость, spin — рад/с.
   * entry — обломок входного этажа (дверь остаётся, если сторона не уже 1,2 м); special — тип спец-этажа (его вид).
   * С makePiece — его кусок: { w, d, ox, oz, golden, special, index } (ox, oz — центр круга сырника от центра куска,
   * index — номер этажа); null — обломка нет (кусок мимо сырника). cache — коробочный обломок берёт общую геометрию
   * из ограниченного кэша этажей. Срезы makePiece всегда свои. → обломок | null.
   */
  spawnPiece({ x = 0, y = 0, z = 0, w = 1, d = 1, style = 'house', vx = 0, vz = 0, vy = -3, spin = 3, golden = false, seed = 0, entry = false, special = null, ox = 0, oz = 0, index = 0, hold = 0, cache = false } = {}) {
    w = finite(w, 1); d = finite(d, 1);
    const floor = this.makePiece
      ? this.makePiece({ w, d, ox: finite(ox), oz: finite(oz), golden, special, index })
      : buildFloorMeshes({ style, w: Math.max(0.05, w), d: Math.max(0.05, d), seed, golden, entry, special, cache });
    if (!floor) return null;
    while (this.items.length >= DEBRIS_MAX) this._remove(0);
    for (const m of floor.children) m.castShadow = true;
    _box.setFromObject(floor);
    _box.getCenter(_c); _box.getSize(_size);
    floor.position.set(-_c.x, -_c.y, -_c.z);
    const pivot = new THREE.Group();
    pivot.name = 'debrisPiece';
    pivot.add(floor);
    pivot.position.set(finite(x) + _c.x, finite(y) + _c.y, finite(z) + _c.z);
    this.group.add(pivot);

    vx = finite(vx); vz = finite(vz); vy = finite(vy, -3); spin = finite(spin, 3);
    const h = Math.hypot(vx, vz), r = this.rng;
    if (h > 0.01) _axis.set(vz / h, 0, -vx / h); // верх заваливается по направлению полёта
    else { const a = r.uniform(0, Math.PI * 2); _axis.set(Math.cos(a), 0, Math.sin(a)); }
    const ang = _axis.multiplyScalar(spin).add(new THREE.Vector3(0, r.uniform(-0.6, 0.6), 0)).clone();
    const item = {
      pivot, floor, ownsGeometry: !!this.makePiece || !!floor.userData.owned, half: _size.clone().multiplyScalar(0.5),
      vel: new THREE.Vector3(vx, vy, vz), ang,
      age: 0, hold, ground: 0, shrink: 0, scale: 1,
    };
    this.items.push(item);
    return item;
  }

  /** Промахнувшийся этаж целиком: кувыркается медленнее. */
  spawnFloor(opts = {}) {
    return this.spawnPiece({ spin: 2.2, vy: -2, ...opts });
  }

  /** tower — {x, z, w, d, top}: верхняя грань башни для отскока (необязательно). */
  update(dt, groundY = 0, tower = null) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.25);
    groundY = finite(groundY);
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP)), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = this.items.length - 1; i >= 0; i--) if (this._step(this.items[i], h, groundY, tower)) this._remove(i);
    }
  }

  /** Полуразмеры повёрнутого обломка по осям мира { hx, hy, hz }; out — запись в этот объект, без него — новый. */
  _extents(it, out = { hx: 0, hy: 0, hz: 0 }) {
    const e = _m.makeRotationFromQuaternion(it.pivot.quaternion).elements, a = it.half, k = it.scale;
    out.hx = (Math.abs(e[0]) * a.x + Math.abs(e[4]) * a.y + Math.abs(e[8]) * a.z) * k;
    out.hy = (Math.abs(e[1]) * a.x + Math.abs(e[5]) * a.y + Math.abs(e[9]) * a.z) * k;
    out.hz = (Math.abs(e[2]) * a.x + Math.abs(e[6]) * a.y + Math.abs(e[10]) * a.z) * k;
    return out;
  }

  /** Возвращает true, когда обломок пора убрать. */
  _step(it, dt, groundY, tower) {
    if (it.hold > 0) {
      const wait = Math.min(it.hold, dt);
      it.hold -= wait;
      dt -= wait;
      if (dt === 0) return false;
    }
    const p = it.pivot.position, v = it.vel;
    it.age += dt;
    const prevY = p.y;
    // точная формула для постоянного ускорения: траектория не зависит от длины шага
    p.x += v.x * dt; p.z += v.z * dt;
    p.y += v.y * dt - 0.5 * DEBRIS_GRAVITY * dt * dt;
    v.y -= DEBRIS_GRAVITY * dt;
    const w = it.ang.length();
    if (w > 1e-6) {
      _dq.setFromAxisAngle(_axis.copy(it.ang).divideScalar(w), w * dt);
      it.pivot.quaternion.premultiply(_dq).normalize();
    }
    let ext = this._extents(it, this._ext);

    if (tower && v.y < 0) {
      const top = finite(tower.top, -Infinity), tx = finite(tower.x), tz = finite(tower.z);
      const tw = finite(tower.w) / 2, td = finite(tower.d) / 2;
      const dx = p.x - tx, dz = p.z - tz;
      if (prevY - ext.hy >= top - 1e-4 && p.y - ext.hy < top && Math.abs(dx) < tw + ext.hx && Math.abs(dz) < td + ext.hz) {
        p.y = top + ext.hy;
        v.y = -v.y * RESTITUTION;
        // сталкиваем с края наружу и наклоняем через край
        const alongX = Math.abs(dx) / Math.max(tw, 1e-3) >= Math.abs(dz) / Math.max(td, 1e-3);
        const sx = dx >= 0 ? 1 : -1, sz = dz >= 0 ? 1 : -1;
        if (alongX) { v.x = sx * Math.max(Math.abs(v.x), 2.8); it.ang.z += -sx * 2.5; }
        else { v.z = sz * Math.max(Math.abs(v.z), 2.8); it.ang.x += sz * 2.5; }
      }
    }

    if (p.y - ext.hy < groundY) {
      p.y = groundY + ext.hy;
      if (v.y < -2) {
        v.y = -v.y * RESTITUTION;
        v.x *= 0.6; v.z *= 0.6;
        it.ang.multiplyScalar(0.55);
      } else {
        v.y = Math.max(0, v.y);
        const k = Math.exp(-7 * dt);
        v.x *= k; v.z *= k; it.ang.multiplyScalar(k);
        it.ground += dt;
      }
    }

    if (it.ground > SETTLE_TIME || it.age > MAX_LIFE || it.shrink > 0) {
      it.shrink += dt;
      it.scale = Math.max(0, 1 - it.shrink / SHRINK_TIME);
      it.pivot.scale.setScalar(Math.max(1e-4, it.scale));
      if (it.scale <= 0) return true;
      // уменьшаемся «к земле», а не повисаем в воздухе
      ext = this._extents(it, this._ext);
      if (p.y - ext.hy > groundY && it.ground > 0) p.y = groundY + ext.hy;
    }
    return false;
  }

  _remove(i) {
    const it = this.items[i];
    this.items.splice(i, 1);
    this.group.remove(it.pivot);
    for (const m of it.floor.children) {
      if (it.ownsGeometry) m.geometry.dispose();
      if (m.isInstancedMesh) m.dispose(); // кусок сырника — один экземпляр: свои буферы матрицы и цвета
    }
  }

  clear() {
    while (this.items.length) this._remove(this.items.length - 1);
  }

  dispose() { this.clear(); }
}
