// Детерминированный генератор псевдослучайных чисел (mulberry32).

export function createRng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const rng = {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Целое в диапазоне [min, max] включительно. */
    int(min, max) {
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    uniform(min, max) {
      return min + rng.next() * (max - min);
    },
    pick(arr) {
      return arr[Math.floor(rng.next() * arr.length)];
    },
    fork(salt = 1) {
      return createRng((Math.floor(rng.next() * 4294967296) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
    },
  };
  return rng;
}

/** Хэш строки/чисел в 32-битное зерно. */
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h = Math.imul(h ^ 0x2f, 16777619) >>> 0;
  }
  return h >>> 0;
}
