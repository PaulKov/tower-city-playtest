// Монеты и бонусы (спецификация §5).
import { BONUSES, BONUS_ORDER, MAX_BONUS, BUILD_COINS_DIV, QUICK } from './levels.js';

export function coinsForBuild(pop) {
  return Math.max(0, Math.floor(pop / BUILD_COINS_DIV));
}

export function coinsForQuick(pop) {
  return Math.max(0, Math.floor(pop / QUICK.coinsDiv));
}

export function buyBonus(save, id) {
  const b = BONUSES[id];
  if (!b || !BONUS_ORDER.includes(id)) return { ok: false, reason: 'unknown' };
  if ((save.inventory[id] || 0) >= MAX_BONUS) return { ok: false, reason: 'max' };
  if (save.coins < b.price) return { ok: false, reason: 'coins' };
  save.coins -= b.price;
  save.inventory[id] = (save.inventory[id] || 0) + 1;
  return { ok: true };
}

export function grantBonus(save, id) {
  if (!BONUS_ORDER.includes(id)) return false;
  if ((save.inventory[id] || 0) >= MAX_BONUS) return false;
  save.inventory[id] = (save.inventory[id] || 0) + 1;
  return true;
}

export function grantRandomBonus(save, rng) {
  const free = BONUS_ORDER.filter(id => (save.inventory[id] || 0) < MAX_BONUS);
  if (!free.length) return null;
  const id = rng.pick(free);
  grantBonus(save, id);
  return id;
}

export function consumeBonus(save, id) {
  if (!BONUS_ORDER.includes(id) || !((save.inventory[id] || 0) > 0)) return false;
  if (!save.authorMode) save.inventory[id] -= 1;
  return true;
}

export function grantStarterPack(save) {
  const got = [];
  for (const id of BONUS_ORDER) if (grantBonus(save, id)) got.push(id);
  return got;
}
