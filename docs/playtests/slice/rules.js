export const TARGET = 3;
export const FIRST_DECK = 3;
export const CYCLE = 12;
export const MOORED = 4.8;

// Первая часть цикла — стоянка. В остальное время баржа плавно отходит и возвращается.
export function bargeTravel(time) {
  const phase = time % CYCLE;
  if (phase <= MOORED) return 0;
  return Math.sin((Math.PI * (phase - MOORED)) / (CYCLE - MOORED)) ** 2;
}

export function bargeAtDock(time) {
  return time % CYCLE <= MOORED;
}

export function acceptsSlice(floor, event) {
  return floor >= FIRST_DECK && event.pieces.some((p) => p.x > event.cx + 0.001 && p.d >= 0.5);
}
