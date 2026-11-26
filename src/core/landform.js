// Рельеф в локальной сетке. Хребет образуют две неравные вершины, седловина,
// боковой отрог и ложбины стока; ниже их соединяют пологие выносы грунта.
import { createRng } from './rng.js';

const sat = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = sat(v); return t * t * (3 - 2 * t); };
const sq = (v) => v * v;

export function createLandform({ x, z, y, h, sx, sz, a = 0, seed, kind = 'hill', nx = 16, nz = 12 }) {
  const rng = createRng(seed), phase = rng.uniform(-Math.PI, Math.PI), twist = rng.uniform(-0.21, 0.21);
  const summit = rng.uniform(-0.48, -0.12), shoulder = rng.uniform(0.23, 0.58);
  const spur = rng.uniform(-0.35, 0.32), spurSide = rng.next() < 0.5 ? 1 : -1;
  const lee = rng.uniform(0.26, 0.48), windward = rng.uniform(0.46, 0.68);
  const secondary = rng.uniform(0.47, 0.91), coastal = kind === 'island', alpine = kind === 'alpine';
  const upland = kind === 'upland' || kind === 'cream' || alpine;
  const pitch = rng.uniform(0.15, 0.34), foldPhase = rng.uniform(-Math.PI, Math.PI);
  const table = new Float32Array((nx + 1) * (nz + 1));
  const exposures = upland ? new Uint8Array(table.length) : null;
  // Местные выходы более твёрдой породы: у каждого своя длина простирания и падение.
  const ledges = upland ? [-1,1].map(side => ({
    u: rng.uniform(-0.42,0.39), v: side*rng.uniform(0.21,0.40), half: rng.uniform(0.26,0.49),
    dip: rng.uniform(-0.40,0.38), lift: rng.uniform(0.09,0.16), side,
  })) : [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = 2 * i / nx - 1, v = 2 * j / nz - 1, angle = Math.atan2(v, u);
    const shoreline = 0.83 + 0.09 * Math.cos(3 * angle + phase) + 0.06 * Math.sin(5 * angle - phase)
      + 0.035 * Math.sin(8 * angle + 1.8 * phase);
    const radial = Math.hypot(u, v) / shoreline;
    const margin = 1 - radial, apron = smooth(margin / (kind === 'island' ? 0.18 : 0.37));
    // Водосборы режут наветренный бок поперёк гребня, разрушая параллельные изолинии.
    const ridge = v - twist * Math.sin(u * 4.1 + phase) - 0.12 * Math.sin(u * 6 - phase);
    const gullies = Math.sin(11 * u + 3.6 * ridge + phase) + 0.45 * Math.sin(19 * u - 6 * ridge);
    const channel = sat(0.45 + 0.4 * gullies) * Math.min(0.18, Math.abs(ridge) * 0.55);
    const slope = ridge / (ridge > 0 ? windward : lee);
    const section = alpine ? Math.exp(-1.6 * Math.abs(slope) ** 1.35)
      : Math.exp(-(coastal ? 1.25 : 1.65) * slope * slope);
    const peak = Math.exp(-sq((u - summit) / (coastal ? 0.46 : 0.40)));
    const saddle = secondary * Math.exp(-sq((u - shoulder) / (coastal ? 0.33 : 0.30)));
    const flank = 0.30 * Math.exp(-sq(((u - spur) - v * 0.55) / 0.28) - sq((v - spurSide * 0.36) / 0.43));
    const foot = 0.15 + 0.17 * sat(margin) + 0.05 * Math.sin(5 * angle + phase) * sat(radial);
    let height = apron * (foot + section * (0.18 + Math.max(peak, saddle) * 0.73) + flank - channel);
    if (upland) {
      // Длинный водораздел между вершинами. От него веером расходятся рёбра;
      // ручьи сходятся в углублённых ложбинах, у подножия остаются пологие шлейфы.
      const across = Math.abs(ridge), fan = (u + 0.32*ridge)/(0.80 + 0.72*across);
      const rib = 0.5+0.5*Math.cos(12.2*fan + foldPhase + 0.93*Math.sin(4.4*fan + 2.9*ridge));
      const runout = smooth(across/0.28)*(1-smooth((across-0.48)/0.42));
      const crest = (0.16+0.68*Math.exp(-sq((u-summit)/(0.43+0.39*pitch)))
        + (0.28+0.23*secondary)*Math.exp(-sq((u-shoulder)/0.32))) *
        Math.exp(-(Math.abs(ridge/(ridge>0 ? 0.48 : 0.37))**(alpine ? 1.62 : 2.4)));
      const shelf = smooth((0.47-across+0.08*Math.sin(6.3*u+phase))/0.18);
      height = apron * (0.09+0.14*sat(margin)+crest+0.42*flank+0.052*shelf+
        runout*(0.05+(alpine ? 0.28 : 0.21)*rib**1.8 - 0.06*(1-rib)**3));
      let reveal = 0;
      for (const bed of ledges) {
        const along=(u-bed.u)/bed.half, end=1-smooth((Math.abs(along)-0.57)/0.43);
        const cross=(bed.v+bed.dip*(u-bed.u)+0.035*Math.sin(5*along+phase)-v)*bed.side;
        const upper = smooth((cross+0.05)/0.09), bank = Math.exp(-sq((cross-0.04)/0.14));
        height += apron*end*bank*bed.lift*upper;
        reveal = Math.max(reveal, apron*end*bank*(1-0.71*smooth((cross-0.043)/0.09)));
      }
      exposures[j*(nx+1)+i]=Math.round(255*reveal);
    }
    if (coastal) {
      // Базальтовые контрфорсы расходятся веером от гребня. Врезанные
      // ущелья углубляются к середине склона, у мысов остаётся низкая терраса.
      const downslope = Math.abs(ridge), fan = u / (0.79 + 0.78 * downslope);
      const fold = Math.sin(16 * fan + phase + 0.59 * Math.sin(6 * u + 3.3 * ridge));
      const valley = Math.exp(-sq(fold / 0.37)) * smooth(downslope / 0.24);
      height -= apron * valley * (0.14 + 0.26 * section);
      height += apron * 0.075 * Math.abs(fold) * smooth(downslope / 0.19);
      height += 0.065 * smooth(margin / 0.08) * (1 - smooth(margin / 0.30));
    }
    table[j * (nx + 1) + i] = Math.max(0, height);
  }
  return { x, z, y, h, sx, sz, a, kind, nx, nz, table, exposures, phase, ca: Math.cos(a), sa: Math.sin(a) };
}

/** Точная высота видимой треугольной грани в мировых координатах. Сетка и её диагонали общие с landformGeometry. */
export function landHeight(f, x, z) {
  const dx = x - f.x, dz = z - f.z;
  const u = ((dx * f.ca - dz * f.sa) / f.sx + 1) * f.nx / 2;
  const v = ((dx * f.sa + dz * f.ca) / f.sz + 1) * f.nz / 2;
  if (u < 0 || v < 0 || u >= f.nx || v >= f.nz) return -Infinity;
  const i = Math.floor(u), j = Math.floor(v), tx = u - i, tz = v - j, stride = f.nx + 1, k = j * stride + i;
  const q = f.table;
  const value = tx + tz <= 1
    ? (1 - tx - tz) * q[k] + tx * q[k + 1] + tz * q[k + stride]
    : (1 - tz) * q[k + 1] + (1 - tx) * q[k + stride] + (tx + tz - 1) * q[k + stride + 1];
  return value > 0 ? f.y + f.h * value : -Infinity;
}
