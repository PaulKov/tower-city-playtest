// Следы твёрдых предметов в координатах толпы. Сетка строится при расстановке декора.
const CELL = 3;
const key = (x, z) => x + z * 65536;

/** Горизонтальные сечения декора в его собственных координатах. Пустота под навесом остаётся проходом. */
export function solidSections(geometry) {
  const pos = geometry.getAttribute('position'), index = geometry.index, count = index ? index.count : pos.count;
  const bands = new Map(), step = 0.12;
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    const low = Math.min(pos.getY(a), pos.getY(b), pos.getY(c)), high = Math.max(pos.getY(a), pos.getY(b), pos.getY(c));
    const x0 = Math.min(pos.getX(a), pos.getX(b), pos.getX(c)), x1 = Math.max(pos.getX(a), pos.getX(b), pos.getX(c));
    const z0 = Math.min(pos.getZ(a), pos.getZ(b), pos.getZ(c)), z1 = Math.max(pos.getZ(a), pos.getZ(b), pos.getZ(c));
    for (let k = Math.floor(low / step); k <= Math.floor(high / step); k++) {
      const bottom = Math.max(low, k * step), top = Math.min(high, (k + 1) * step);
      let box = bands.get(k);
      if (!box) { box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, bottom, top }; bands.set(k, box); }
      box.bottom = Math.min(box.bottom, bottom); box.top = Math.max(box.top, top);
      box.x0 = Math.min(box.x0, x0); box.x1 = Math.max(box.x1, x1);
      box.z0 = Math.min(box.z0, z0); box.z1 = Math.max(box.z1, z1);
    }
  }
  return [...bands.values()];
}

// Пересечение отрезка с осевой коробкой в координатах предмета.
function hitsBox(ax, az, bx, bz, w, d) {
  let lo = 0, hi = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-10) {
    if (Math.abs(ax) >= w) return false;
  } else {
    const a = (-w - ax) / dx, b = (w - ax) / dx;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  if (Math.abs(dz) < 1e-10) {
    if (Math.abs(az) >= d) return false;
  } else {
    const a = (-d - az) / dz, b = (d - az) / dz;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  return lo < hi; // единственная точка касания границы оставляет тело снаружи
}

export function hitsDisc(ax, az, bx, bz, x, z, radius) {
  if (x < Math.min(ax, bx) - radius || x > Math.max(ax, bx) + radius ||
      z < Math.min(az, bz) - radius || z > Math.max(az, bz) + radius) return false;
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
  // При точном касании сумма смещений в мировых координатах может потерять несколько младших битов.
  return (ax + t * dx - x) ** 2 + (az + t * dz - z) ** 2 < radius * radius * (1 - 1e-12);
}

/** Два отрезка ближе радиуса: пересечение осей либо ближайший конец на соседнем отрезке. */
export function hitsCapsule(ax, az, bx, bz, cx, cz, dx, dz, radius) {
  if (Math.max(ax, bx) + radius < Math.min(cx, dx) || Math.max(cx, dx) + radius < Math.min(ax, bx) ||
      Math.max(az, bz) + radius < Math.min(cz, dz) || Math.max(cz, dz) + radius < Math.min(az, bz)) return false;
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz;
  const c = ux * (cz - az) - uz * (cx - ax), d = ux * (dz - az) - uz * (dx - ax);
  const a = vx * (az - cz) - vz * (ax - cx), b = vx * (bz - cz) - vz * (bx - cx);
  return (c * d < 0 && a * b < 0) ||
    hitsDisc(ax, az, bx, bz, cx, cz, radius) || hitsDisc(ax, az, bx, bz, dx, dz, radius) ||
    hitsDisc(cx, cz, dx, dz, ax, az, radius) || hitsDisc(cx, cz, dx, dz, bx, bz, radius);
}

export class ResidentGround {
  constructor(heightAt = null, contains = null) {
    this.heightAt = heightAt;
    this.supportAt = heightAt;
    this.contains = contains;
    this.cells = new Map();
    this.blockedDisc = null;
  }

  disc(x, z, radius, bottom = -Infinity, top = Infinity) {
    const shape = { x, z, radius, bottom, top };
    this._add(shape, radius, radius);
    return shape;
  }

  box(x, z, w, d, yaw = 0, bottom = -Infinity, top = Infinity, boundary = false) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._add({ x, z, w, d, c, s, bottom, top, boundary }, Math.abs(c) * w + Math.abs(s) * d, Math.abs(s) * w + Math.abs(c) * d);
  }

  sections(boxes, x, y, z, yaw, scale) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (const b of boxes) {
      const dx = (b.x0 + b.x1) * scale / 2, dz = (b.z0 + b.z1) * scale / 2;
      this.box(x + dx * cos + dz * sin, z + dz * cos - dx * sin,
        (b.x1 - b.x0) * scale / 2, (b.z1 - b.z0) * scale / 2, yaw, y + b.bottom * scale, y + b.top * scale);
    }
  }

  _add(shape, w, d) {
    for (let j = Math.floor((shape.z - d) / CELL); j <= Math.floor((shape.z + d) / CELL); j++) {
      for (let i = Math.floor((shape.x - w) / CELL); i <= Math.floor((shape.x + w) / CELL); i++) {
        const k = key(i, j);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, cell = []);
        cell.push(shape);
      }
    }
  }

  clearStep(ax, az, bx, bz, r, bodyRadius = r, bottom = -Infinity, top = Infinity, limitToPaths = true, ignore = null) {
    this.blockedDisc = null;
    if (limitToPaths && this.contains && !this.contains(bx, bz, r)) return false;
    const span = Math.max(r, bodyRadius);
    const endX = Math.floor((Math.max(ax, bx) + span) / CELL), endZ = Math.floor((Math.max(az, bz) + span) / CELL);
    for (let j = Math.floor((Math.min(az, bz) - span) / CELL); j <= endZ; j++) {
      for (let i = Math.floor((Math.min(ax, bx) - span) / CELL); i <= endX; i++) {
        const cell = this.cells.get(key(i, j));
        if (!cell) continue;
        for (let n = 0; n < cell.length; n++) {
          const o = cell[n];
          if (o === ignore || top <= o.bottom || bottom >= o.top) continue;
          const clearance = o.boundary ? r : bodyRadius;
          if (o.radius !== undefined) {
            if (hitsDisc(ax, az, bx, bz, o.x, o.z, o.radius + clearance)) { this.blockedDisc = o; return false; }
          } else {
            const x = ax - o.x, z = az - o.z, u = bx - o.x, v = bz - o.z;
            if (hitsBox(o.c * x - o.s * z, o.s * x + o.c * z, o.c * u - o.s * v, o.s * u + o.c * v, o.w + clearance, o.d + clearance)) return false;
          }
        }
      }
    }
    return true;
  }
}
