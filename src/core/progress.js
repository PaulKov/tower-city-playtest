// Применение результатов стройки и быстрой игры к сохранению.
import { COINS_PER_STAR, GOLDEN_COINS } from './levels.js';
import { cityPopulation, starsFor, placeBuilding, plotAt } from './cityRules.js';
import { coinsForBuild, coinsForQuick, grantStarterPack } from './economy.js';
import { makePlot, legacyPlot, cleanHouseName } from './towerShape.js';
import { defaultHeroes, activeRequests, afterBuild, arrived } from './heroes.js';
import { releaseDecor, releaseHeroHomes } from './decor.js';

/** Состояние города поверх сохранения (plots — та же ссылка, мутации пишутся в save). Испорченная запись города
 *  пересоздаётся, звёзды и герои сохраняются. */
export function cityStateFromSave(save, cityDef) {
  let c = save.cities[cityDef.id];
  if (!c || !Array.isArray(c.plots) || c.plots.length !== cityDef.size * cityDef.size) {
    c = save.cities[cityDef.id] = {
      plots: new Array(cityDef.size * cityDef.size).fill(null), stars: c?.stars | 0, heroes: c?.heroes ?? defaultHeroes(cityDef.id),
    };
  }
  const state = { size: cityDef.size, plots: c.plots };
  if (save.authorMode) state.authorMode = true;
  return state;
}

/** Каким будет участок при принятии результата. Сравнение домов не меняет сохранение. */
export function plotForBuild(cityDef, x, y, result) {
  const floors = Math.max(0, result.floors | 0);
  if (!floors) return null;
  const base = { type: result.type, pop: Math.max(0, Math.round(result.population)), floors };
  const at = Number.isFinite(result.builtAt) && result.builtAt > 0 ? result.builtAt : 0;
  return makePlot({ ...base, shape: result.shape, best: result.bestCombo, miss: result.misses, at })
    ?? legacyPlot(cityDef, y * cityDef.size + x, base, at);
}

/**
 * Итог стройки в городе. result — { type, floors, population, shape, bestCombo, misses, builtAt }: shape — этажи
 * из towerSim.finished, builtAt — время постройки от сцены. → монеты, звёзды, стартовый набор, прозвище дома,
 * выполненные просьбы героев (heroes) и приехавшие на этой стройке герои (arrived; спецификация «Герои городов» §4.3);
 * decorBack — сколько украшений игрока вернулось на склад (старый участок и дома героев).
 */
export function completeBuild(save, cityDef, x, y, result) {
  const cs = cityStateFromSave(save, cityDef);
  const plot = plotForBuild(cityDef, x, y, result);
  const rec = save.cities[cityDef.id];
  const starsBefore = rec.stars | 0;
  if (!plot) return {
    coins: 0, starsBefore, starsAfter: starsBefore, starCoins: 0, starterPack: false,
    cityPop: cityPopulation(cs), nick: null, heroes: [], arrived: [], decorBack: 0,
  };
  // просьбы проверяются те, что были до стройки, и только у уже приехавших героев (§3.4)
  const before = activeRequests(save, cityDef);
  const came = new Set(arrived(save, cityDef).map((h) => h.id));
  // украшения игрока старого участка уходят на склад до того, как новый участок займёт его место
  let decorBack = releaseDecor(save, cityDef, x, y);
  placeBuilding(cs, x, y, plot);
  save.lastBuiltCity = cityDef.id;

  const coins = coinsForBuild(plot.pop);
  const cityPop = cityPopulation(cs);
  const starsAfter = Math.max(starsBefore, starsFor(cityDef, cityPop));
  const starCoins = (starsAfter - starsBefore) * COINS_PER_STAR;
  rec.stars = starsAfter;
  const heroes = afterBuild(save, cityDef, x, y, before);
  decorBack += releaseHeroHomes(save, cityDef); // герой въехал в украшенный дом: украшения ему не нужны
  const newcomers = arrived(save, cityDef).filter((h) => !came.has(h.id)).map((h) => h.id);

  let starterPack = false;
  if (starsAfter >= 1 && !save.starterPackGiven[cityDef.id]) {
    save.starterPackGiven[cityDef.id] = true;
    grantStarterPack(save);
    starterPack = true;
  }
  save.coins += coins + starCoins;
  return { coins, starsBefore, starsAfter, starCoins, starterPack, cityPop, nick: plot.nick, heroes, arrived: newcomers, decorBack };
}

/** Своё имя дома (спецификация «Своя башня» §7): очищается cleanHouseName → имя; пустое — снова прозвище. Нет дома — null. */
export function renameHouse(save, cityDef, x, y, name) {
  const p = plotAt(cityStateFromSave(save, cityDef), x, y);
  if (!p) return null;
  p.name = cleanHouseName(name);
  return p.name;
}

/** Рекорд классики хранится под прежним ключом, в том числе в старых сохранениях. */
export function quickRecordFor(save, calm, storm = false) {
  if (storm) return save.quickStormRecord;
  return calm ? save.quickCalmRecord : save.quickRecord;
}

export function completeQuick(save, { height, population, calm = false, storm = false }) {
  const coins = coinsForQuick(population);
  const record = quickRecordFor(save, calm, storm);
  const recordHeight = height > record.height;
  const recordPop = population > record.population;
  if (recordHeight) record.height = height;
  if (recordPop) record.population = population;
  save.coins += coins;
  return { coins, recordHeight, recordPop };
}

export function goldenHitCoins(save) {
  save.coins += GOLDEN_COINS;
  return GOLDEN_COINS;
}
