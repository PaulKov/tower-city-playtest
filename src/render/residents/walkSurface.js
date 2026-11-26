// Пол у лап берётся с верхних граней мощения. Треугольники индексируются один раз при сборке улицы.
import { hitsDisc } from './ground.js';
const CELL = 1, key = (x, z) => x + 65536 * z;

// Отсекаем грань подошвы по вертикальной плоскости ребра покрытия. Вместе с XZ
// интерполируются высота и вес соответствующей ноги. Два буфера переиспользуются на весь проход.
function clipEdge(src, dst, count, x, z, dx, dz) {
  let last = (count - 1) * 4, n = 0;
  let prev = dx * (src[last + 2] - z) - dz * (src[last] - x);
  for (let i = 0; i < count * 4; i += 4) {
    const d = dx * (src[i + 2] - z) - dz * (src[i] - x);
    if (prev * d < 0) {
      const t = prev / (prev - d);
      for (let k = 0; k < 4; k++) dst[n++] = src[last + k] + t * (src[i + k] - src[last + k]);
    }
    if (d <= 0) for (let k = 0; k < 4; k++) dst[n++] = src[i + k];
    last = i; prev = d;
  }
  return n / 4;
}

export function walkSurface(geometries, base = 0) {
  const cells = new Map();
  let peak = -Infinity;
  for (const geo of geometries) {
    const pos = geo.getAttribute('position'), index = geo.index, count = index ? index.count : pos.count;
    for (let k = 0; k < count; k += 3) {
      const a = index ? index.getX(k) : k, b = index ? index.getX(k + 1) : k + 1, c = index ? index.getX(k + 2) : k + 2;
      const x = pos.getX(a), y = pos.getY(a), z = pos.getZ(a);
      const bx = pos.getX(b) - x, bz = pos.getZ(b) - z, cx = pos.getX(c) - x, cz = pos.getZ(c) - z;
      const det = bx * cz - bz * cx;
      if (det >= -1e-9) continue; // нижние грани и отвесные стенки
      const tri = { x, y, z, bx, bz, cx, cz, ux: cz / det, uz: -cx / det, vx: -bz / det, vz: bx / det,
        by: pos.getY(b) - y, cy: pos.getY(c) - y, top: Math.max(y, pos.getY(b), pos.getY(c)) };
      peak = Math.max(peak, tri.top);
      tri.slope = Math.hypot(tri.by * tri.ux + tri.cy * tri.vx, tri.by * tri.uz + tri.cy * tri.vz);
      const x0 = Math.floor((x + Math.min(0, bx, cx)) / CELL), x1 = Math.floor((x + Math.max(0, bx, cx)) / CELL);
      const z0 = Math.floor((z + Math.min(0, bz, cz)) / CELL), z1 = Math.floor((z + Math.max(0, bz, cz)) / CELL);
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const id = key(i, j), list = cells.get(id);
        if (list) list.push(tri); else cells.set(id, [tri]);
      }
    }
  }
  for (const list of cells.values()) list.sort((a, b) => b.top - a.top);
  const poly = new Float64Array(7 * 4), tmp = new Float64Array(7 * 4);
  const surface = (x, z) => {
    const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let height = typeof base === 'function' ? base(x, z) : base;
    if (list) for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.top <= height) break;
      const dx = x - t.x, dz = z - t.z, u = dx * t.ux + dz * t.uz, v = dx * t.vx + dz * t.vz;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001) height = Math.max(height, t.y + u * t.by + v * t.cy);
    }
    return height;
  };
  // Верх покрытия во всём следе тела: рука или хвост могут ещё находиться над бордюром после шага вниз.
  surface.maxAround = (x, z, radius) => {
    let h = surface(x, z);
    if (h >= peak) return h;
    const x1 = Math.floor((x + radius) / CELL), z1 = Math.floor((z + radius) / CELL);
    for (let j = Math.floor((z - radius) / CELL); j <= z1; j++) for (let i = Math.floor((x - radius) / CELL); i <= x1; i++) {
      const list = cells.get(key(i, j));
      if (!list) continue;
      for (let n = 0; n < list.length; n++) {
        const t = list[n];
        if (t.top <= h) break;
        const dx = x - t.x, dz = z - t.z, u = dx * t.ux + dz * t.uz, v = dx * t.vx + dz * t.vz;
        if ((u >= 0 && v >= 0 && u + v <= 1) ||
          hitsDisc(0, 0, t.bx, t.bz, dx, dz, radius) || hitsDisc(0, 0, t.cx, t.cz, dx, dz, radius) ||
          hitsDisc(t.bx, t.bz, t.cx, t.cz, dx, dz, radius)) {
          h = Math.max(h, Math.min(t.top, t.y + u * t.by + v * t.cy + radius * t.slope));
        }
      }
    }
    return h;
  };
  // На перепаде высот край плитки способен пересечь середину треугольника между вершинами лапы.
  surface.soleLift = (points, faces, lift, ceiling) => {
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f], b = faces[f + 1], c = faces[f + 2];
      const low = Math.min(points[a + 1] + lift * points[a + 3], points[b + 1] + lift * points[b + 3], points[c + 1] + lift * points[c + 3]);
      if (low >= ceiling - 1e-8) continue;
      const x0 = Math.floor(Math.min(points[a], points[b], points[c]) / CELL), x1 = Math.floor(Math.max(points[a], points[b], points[c]) / CELL);
      const z0 = Math.floor(Math.min(points[a + 2], points[b + 2], points[c + 2]) / CELL), z1 = Math.floor(Math.max(points[a + 2], points[b + 2], points[c + 2]) / CELL);
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const list = cells.get(key(ix, iz));
        if (!list) continue;
        for (let n = 0; n < list.length; n++) {
          const t = list[n];
          if (t.top <= low) break;
          for (let k = 0; k < 4; k++) { poly[k] = points[a + k]; poly[4 + k] = points[b + k]; poly[8 + k] = points[c + k]; }
          let count = clipEdge(poly, tmp, 3, t.x, t.z, t.bx, t.bz);
          if (count) count = clipEdge(tmp, poly, count, t.x + t.bx, t.z + t.bz, t.cx - t.bx, t.cz - t.bz);
          if (count) count = clipEdge(poly, tmp, count, t.x + t.cx, t.z + t.cz, -t.cx, -t.cz);
          for (let i = 0; i < count * 4; i += 4) {
            const dx = tmp[i] - t.x, dz = tmp[i + 2] - t.z;
            const height = t.y + t.by * (dx * t.ux + dz * t.uz) + t.cy * (dx * t.vx + dz * t.vz);
            lift = Math.max(lift, (height - tmp[i + 1]) / tmp[i + 3]);
          }
        }
      }
    }
    return lift;
  };
  return surface;
}
