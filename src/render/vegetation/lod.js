// Выбор уровня детализации растений (спецификация «Растительность» §8.2, §8.3). Чистый модуль.

/** Запас против дрожания на границе порога, доля порога. */
export const HYST = 0.15;
/** Длительность растворения при смене уровня, с. */
export const FADE_S = 0.25;
/** Мелкие виды (клумбы, цветы, камни) растворяются, когда меньше стольких пикселей. */
export const HIDE_PX = 6;
/** Высота опорного кадра, пикс.: пороги не зависят от размера окна и DPR. */
export const FRAME_PX = 1080;

/**
 * Размер ограничивающей сферы радиуса r на расстоянии dist при вертикальном угле обзора fovDeg — в пикселях кадра
 * высотой 1080: 1080 · r / (dist · tan(fov / 2)). Камера в центре сферы (dist ≤ 0) даёт конечное большое число.
 */
export function projectedPx(r, dist, fovDeg) {
  const fov = Math.min(Math.max(Number.isFinite(fovDeg) ? fovDeg : 35, 1), 179);
  const d = Math.max(Number.isFinite(dist) ? dist : 0, 1e-3);
  return FRAME_PX * Math.max(0, r) / (d * Math.tan(fov * Math.PI / 360));
}

/**
 * Уровень 0..2 по размеру на экране px. thresholds = [t0, t1]: L0 при px > t0, L2 при px < t1 (t0 = Infinity — L0 нет).
 * prev — уровень прошлого пересчёта (не 0..2 — выбор без запаса). К более детальному уровню переход идёт, только когда
 * px выше порога на HYST, к менее детальному — когда ниже на HYST. Зовётся на каждое растение пересчёта: пороги
 * читаются по номеру, без разбора массива и массива границ на вызов.
 */
export function pickLod(px, prev, thresholds) {
  if (!(prev === 0 || prev === 1 || prev === 2)) return px > thresholds[0] ? 0 : px >= thresholds[1] ? 1 : 2;
  let lod = prev; // thresholds[k] — граница уровней k и k + 1
  while (lod > 0 && px > thresholds[lod - 1] * (1 + HYST)) lod--;
  while (lod < 2 && px < thresholds[lod] * (1 - HYST)) lod++;
  return lod;
}

/** Виден ли мелкий вид размером px; wasVisible — виден ли он был (запас HYST в обе стороны от HIDE_PX). */
export function smallVisible(px, wasVisible) {
  return px >= HIDE_PX * (wasVisible ? 1 - HYST : 1 + HYST);
}
