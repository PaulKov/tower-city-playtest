// Все константы баланса и данные уровней (спецификация §3–§5).

export const SIM_DT = 1 / 120;
export const MAX_STEPS = 8;

export const W0 = 4;
export const D0 = 4;
export const FLOOR_H = 1.2;
export const MIN_SIZE = 0.25;

export const SIM = {
  amp: 2.6, ampZ: 1.4,
  // эллипс: сдвиг фазы z относительно x прецессирует 0 → 90° → 0 за ellCycles периодов качания,
  // путь крюка то сплющивается в линию через центр (можно поставить идеально), то раскрывается в эллипс
  ellCycles: 4,
  periodDecay: 0.01, minPeriodFactor: 0.7,
  g: 30, inherit: 0.5, dropHeight: 4,
  perfectFrac: 0.06, regrowFrac: 0.06, regrowCombo: 3,
  swayK: 6, swayC: 0.6, kappa: 1.2, swayMax: 0.35, swayDanger: 0.25,
  biasFactor: 0.5, biasMax: 0.2, perfectDamp: 0.7,
  comboTime: 4, comboMul: 1.5,
  misses: 3, spawnDelay: 0.35,
  goldenEvery: 7, goldenJitter: 2,
  magnetFrac: 0.35, slowFloors: 5, comboBonusAt: 5,
  windFall: 0.15, heightRamp: 6,
  // спец-этажи (спецификация «Спец-этажи» §3.1): номер первого спец-сброса и интервал (границы включены),
  // порог сильного сужения — доля W0 или D0
  specialFirst: [4, 6], specialGap: [5, 6], specialStrong: 0.75,
};

/** Спец-этажи (спецификация «Спец-этажи» §3.1): код типа в записи формы — индекс + 1. */
export const SPECIAL_TYPES = ['atrium', 'loft', 'balcony'];
/**
 * Множители спец-этажей — только отличные от 1 (у regrow — от 0): windMul — снос ветром в полёте, gMul — тяжесть,
 * popMul — жители, swayDamp — гашение качки при посадке, kappaMul — толчок при hit, regrow — расширение балкона
 * (доля W0 и D0), notice — амплитуда качки (ед. сцены), от которой гашение заметно.
 */
export const SPECIAL = Object.freeze({
  atrium: Object.freeze({ windMul: 2, popMul: 2 }),
  loft: Object.freeze({ windMul: 0.5, gMul: 1.6, swayDamp: 0.35, kappaMul: 1.35, notice: 0.2 }),
  balcony: Object.freeze({ regrow: 0.15 }),
});
/** Параметры спец-этажа; не тип из SPECIAL_TYPES (null, 'pool', 'constructor', '__proto__' …) — null. */
export const specialParams = (type) => (typeof type === 'string' && Object.hasOwn(SPECIAL, type) ? SPECIAL[type] : null);

export const BUILDING_TYPES = {
  house:  { id: 'house',  name: 'Жилой',     floors: 10, base: 10, unlockPop: 0,    needs: [],                         color: '#6ec6ff' },
  shop:   { id: 'shop',   name: 'Торговый',  floors: 15, base: 15, unlockPop: 150,  needs: ['house'],                  color: '#ff7a6b' },
  office: { id: 'office', name: 'Офис',      floors: 20, base: 20, unlockPop: 600,  needs: ['house', 'shop'],          color: '#5fd68a' },
  tower:  { id: 'tower',  name: 'Небоскрёб', floors: 25, base: 25, unlockPop: 1500, needs: ['house', 'shop', 'office'], color: '#ffc94a' },
};
export const TYPE_ORDER = ['house', 'shop', 'office', 'tower'];

/** Облик прямоугольного дома. Данные участка и симуляция хранят исходный тип здания. */
export const cityBuildingStyle = (cityId, type) => cityId === 'night' && type === 'tower' ? 'nightTower' : type;

// Спокойная стройка: период крюка в секундах, затухание качки и доля толчка срезанного этажа.
export const STEADY = Object.freeze({
  minPeriod: 2.25, periodMul: 1.12, periodDecay: 0.006, minPeriodFactor: 0.84,
  swayC: 3, impulseMul: 0.48, arcMul: 0.50,
});

// Шторм: ветер и полёт с первого этажа; предупреждение в секундах игрового времени,
// пауза между ударами — в новых этажах над уцелевшей башней.
export const STORM = Object.freeze({
  wind: 4.2, windFall: 0.42, periodMul: 0.78, leaderTime: 0.048,
  gustLen: [7, 11], gustGap: [3.2, 5], warning: [2.8, 3.6], safeFloors: [3, 5],
  rodZone: 0.7, // центральная доля ширины и глубины опоры для посадки громоотвода
});

// Тексты, привязанные к игровым данным (core не импортирует ui).
export const RULE_TEXT = {
  outside: 'Участок вне карты',
  blocked: 'Участок занят природой',
  unavailable: 'Этот тип недоступен в городе',
  locked: n => `Откроется при населении ${n}`,
  needs: names => `Нужен рядом: ${names.join(', ')}`,
};

const ALL = TYPE_ORDER;

/**
 * Город строит этажи-сырники («Сладкий город» §4.1, поле floors: 'syrnik')? Единственная проверка поля: по ней стройка
 * выбирает стиль и набор, карта — дома-сырники, приложение — модули. cityDef — запись города или null.
 */
export function isSyrnikCity(cityDef) {
  return cityDef?.floors === 'syrnik';
}

// blocked: [x, y, вид декора]
export const CITIES = [
  {
    id: 'valley', name: 'Солнечная долина', size: 3, blocked: [],
    types: ['house', 'shop'], period: 2.4, wind: 0, ellipse: false,
    weather: 'clear', night: false, stars: [600, 1200, 1800], theme: 'valley',
  },
  {
    id: 'harbor', name: 'Морская гавань', size: 4,
    blocked: [[3, 2, 'pier'], [3, 3, 'pier'], [0, 0, 'park']],
    types: ['house', 'shop', 'office'], period: 2.1, wind: 0.6, gusty: true, ellipse: false,
    weather: 'sea', night: false, stars: [1500, 2800, 4200], theme: 'harbor',
  },
  {
    id: 'autumn', name: 'Осенний городок', size: 4,
    blocked: [[1, 2, 'park'], [3, 0, 'hill']],
    types: ALL, period: 2.0, wind: 0.5, ellipse: true,
    weather: 'rain', night: false, stars: [2200, 4000, 6000], theme: 'autumn',
  },
  {
    id: 'snow', name: 'Снежные вершины', size: 5,
    blocked: [[0, 0, 'hill'], [4, 0, 'hill'], [2, 2, 'lake'], [0, 4, 'park'], [4, 4, 'hill']],
    types: ALL, period: 1.8, wind: 1.4, ellipse: true,
    weather: 'snow', night: false, stars: [3500, 6000, 9000], theme: 'snow',
  },
  {
    id: 'night', name: 'Ночной мегаполис', size: 5,
    blocked: [[2, 2, 'park'], [0, 4, 'lake'], [4, 1, 'park']],
    types: ALL, period: 1.6, wind: 1.0, ellipse: true,
    weather: 'night', night: true, stars: [4000, 7000, 11000], theme: 'night',
  },
  {
    // «Сладкий город»: дома из сырников (floors: 'syrnik' — стиль этажа, рисуют сцены)
    id: 'sweet', name: 'Сладкий город', size: 5,
    blocked: [[2, 0, 'lake'], [0, 2, 'hill'], [4, 3, 'hill'], [2, 4, 'park']],
    types: ALL, period: 1.5, wind: 1.2, gusty: true, ellipse: true,
    weather: 'sugar', night: false, stars: [5000, 8500, 13000], theme: 'sweet', floors: 'syrnik',
  },
];

export const QUICK = {
  period: 2.2, minPeriodFactor: 0.6, base: 10, epochEvery: 15,
  windFrom: 30, windStrength: 0.8, ellipseFrom: 45, coinsDiv: 20,
};

export const BONUSES = {
  magnet: { id: 'magnet', price: 60 },
  slow:   { id: 'slow',   price: 50 },
  widen:  { id: 'widen',  price: 80 },
  anchor: { id: 'anchor', price: 70 },
  helmet: { id: 'helmet', price: 100 },
};
export const BONUS_ORDER = ['magnet', 'slow', 'widen', 'anchor', 'helmet'];
export const MAX_BONUS = 3;
export const COINS_PER_STAR = 50;
export const GOLDEN_COINS = 15;
export const BUILD_COINS_DIV = 10;
