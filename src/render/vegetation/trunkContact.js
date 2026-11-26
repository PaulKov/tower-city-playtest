// Горизонтальные сечения реальной сетки. Центр предыдущего кольца лежит внутри следующего:
// четыре луча изнутри находят обе стороны ствола даже при наклоне и рядом с боковым суком.
const sections = new WeakMap();
const BASE = .20, STEP = .04, COUNT = 65;

function barkDistance(edges, x, z, nx, nz, outer = false) {
  let best = outer ? -Infinity : Infinity;
  for (let i = 0; i < edges.length; i += 4) {
    const ax = edges[i] - x, az = edges[i + 1] - z, dx = edges[i + 2], dz = edges[i + 3];
    const det = nx * dz - nz * dx;
    if (Math.abs(det) < 1e-9) continue;
    const along = (ax * nz - az * nx) / det, distance = (ax * dz - az * dx) / det;
    if (along >= -1e-6 && along <= 1.000001 && distance > 0 && distance < .46) {
      best = outer ? Math.max(best, distance) : Math.min(best, distance);
    }
  }
  return best;
}

function trunkSections(g, pine) {
  if (sections.has(g)) return sections.get(g);
  const rows = Array.from({ length: COUNT }, () => ({ x: 0, z: 0, edges: [] }));
  const pos = g.attributes.position, tint = g.attributes.aTint, idx = g.index;
  const cut = new Float64Array(4), tri = new Int32Array(3);
  for (let k = 0; k < idx.count; k += 3) {
    for (let i = 0; i < 3; i++) tri[i] = idx.getX(k + i);
    // В снегу aTint отключён и у хвои. Кора ели выделена отрицательными UV.
    if (tint?.getX(tri[0]) > .5 || (pine && g.attributes.uv.getX(tri[0]) >= 0)) continue;
    const a = pos.getY(tri[0]), b = pos.getY(tri[1]), c = pos.getY(tri[2]);
    const first = Math.max(0, Math.ceil((Math.min(a, b, c) - BASE) / STEP));
    const end = Math.min(COUNT, Math.ceil((Math.max(a, b, c) - BASE) / STEP));
    for (let j = first; j < end; j++) {
      const y = BASE + j * STEP;
      let n = 0;
      for (let i = 0; i < 3; i++) {
        const l = tri[i], h = tri[(i + 1) % 3], yl = pos.getY(l), yh = pos.getY(h);
        if ((yl > y) === (yh > y)) continue;
        const t = (y - yl) / (yh - yl);
        cut[n++] = pos.getX(l) + t * (pos.getX(h) - pos.getX(l));
        cut[n++] = pos.getZ(l) + t * (pos.getZ(h) - pos.getZ(l));
      }
      if (n === 4) rows[j].edges.push(cut[0], cut[1], cut[2] - cut[0], cut[3] - cut[1]);
    }
  }
  let x = 0, z = 0;
  for (const row of rows) {
    const dx = barkDistance(row.edges, x, z, 1, 0) - barkDistance(row.edges, x, z, -1, 0);
    const dz = barkDistance(row.edges, x, z, 0, 1) - barkDistance(row.edges, x, z, 0, -1);
    if (Number.isFinite(dx)) x += dx / 2;
    if (Number.isFinite(dz)) z += dz / 2;
    row.x = x; row.z = z;
  }
  sections.set(g, rows);
  return rows;
}

/** Профиль со стороны, за которую держится панда. В кадре остаётся только интерполяция по высоте. */
export function trunkContact(g, plant, nx, nz, radius) {
  const c = Math.cos(plant.ry), s = Math.sin(plant.ry), scale = plant.s;
  const localX = c * nx - s * nz, localZ = s * nx + c * nz;
  const contour = trunkSections(g, plant.kind === 'pine').map(row => {
    const hit = barkDistance(row.edges, row.x, row.z, localX, localZ, true);
    const r = Number.isFinite(hit) ? hit * scale : radius;
    return { x: plant.x + (c * row.x + s * row.z) * scale + nx * r,
      z: plant.z + (c * row.z - s * row.x) * scale + nz * r };
  });
  return (level, actorScale, out) => {
    const h = Math.min(COUNT - 1, Math.max(0, ((level + .39 * actorScale) / scale - BASE) / STEP));
    const i = Math.min(COUNT - 2, Math.floor(h)), a = contour[i], b = contour[i + 1], t = h - i;
    out.x = a.x + t * (b.x - a.x) + .155 * actorScale * nx;
    out.z = a.z + t * (b.z - a.z) + .155 * actorScale * nz;
    return out;
  };
}
