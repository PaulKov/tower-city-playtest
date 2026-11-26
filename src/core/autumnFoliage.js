import { hashSeed } from './rng.js';

/** Доля сброшенных листьев конкретного лиственного дерева. Крона, листопад и опад
 * на земле используют одну стадию. Её выбирают один раз при создании посадки. */
export function autumnLeafLoss(x, z) {
  const seed = hashSeed('autumn-crown', Math.round(x * 64), Math.round(z * 64));
  return 0.06 + 0.84 * (seed / 4294967296);
}
