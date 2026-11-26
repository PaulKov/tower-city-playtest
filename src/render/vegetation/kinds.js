// Виды растений (спецификация «Растительность» §5): варианты, уровни LOD, габариты, пятна-тени, пределы треугольников,
// имена мешей; палитры и плотности тем (§5.7). Чистый модуль: без three, window, document и Math.random.

/**
 * Вид растения при масштабе s = 1. variants — вариантов формы; lods — уровней детализации;
 * h — верх геометрии, м; r и cy — радиус и высота центра ограничивающей сферы, м (сфера вмещает всю геометрию,
 * генератор перебрасывает выходящие карточки — план, отличие 9);
 * blob — [поперёк, сдвиг от солнца] пятна-тени, м (null — без пятна); blobSnow — то же в снегу;
 * blobLen — длина вытянутого пятна вдоль растения (изгородь); small — мелкий вид: растворяется меньше HIDE_PX (lod.js).
 */
export const KINDS = {
  tree: { variants: 2, lods: 3, h: 4.4, r: 2.6, cy: 2.3, blob: [3.8, 0.35] },
  pine: { variants: 2, lods: 3, h: 4.0, r: 2.3, cy: 1.9, blob: [3.8, 0.35], blobSnow: [4.3, 0.35] },
  bush: { variants: 2, lods: 3, h: 1.1, r: 1.45, cy: 0.4, blob: [2.4, 0.1] },
  drift: { variants: 1, lods: 3, h: 0.8, r: 1.6, cy: 0.2, blob: null },
  hedge: { variants: 1, lods: 3, h: 0.8, r: 1.75, cy: 0.4, blob: [1.2, 0.15], blobLen: 2.9 },
  bed: { variants: 1, lods: 1, h: 0.45, r: 0.95, cy: 0.15, blob: [1.7, 0.05], small: true },
  flowers: { variants: 1, lods: 1, h: 0.4, r: 0.75, cy: 0.15, blob: null, small: true },
  rock: { variants: 1, lods: 1, h: 0.6, r: 0.8, cy: 0.2, blob: [1.2, 0.1], small: true },
};

/** Пределы треугольников по уровням (спецификация §5.1); tuft — пучок травы (grass.js). */
export const TRI_LIMITS = {
  tree: [1100, 450, 200], pine: [900, 350, 120], bush: [650, 260, 100], drift: [1344, 396, 140], hedge: [800, 320, 120],
  bed: [300], flowers: [120], rock: [528], tuft: [6],
};
/** Ближний городской лиственный с четырьмя порядками ветвей и прорезной кроной. */
export const CITY_TREE_TRIANGLES = [4250, 750, 330];
export const MAPLE_TRIANGLES = [9700, 480, 230];
/** Комель ближней ели и разветвлённые корни на общем радиальном сечении. */
export const CITY_SPRUCE_NEAR_TRIANGLES = 2400;

/**
 * Трава high (спецификация §6.3, §8.4): решётка n × n слотов с шагом step, м, вокруг точки фокуса (n · step ≥ 2r);
 * r — радиус круга, в последней доле fade пучки уменьшаются до нуля; flowers — доля пучков-цветов; h — высота пучка
 * при масштабе 1 (в шейдере 0,72–1,28: 0,25–0,45 м); far — дальше от камеры фокус не уходит, ahead — фокус перед
 * камерой, если луч взгляда не пересекает землю; маска — res² на ±mask м, запас margin от исключённых зон.
 */
export const GRASS = { n: 110, step: 0.55, r: 30, fade: 1 / 3, flowers: 0.03, h: 0.35, far: 60, ahead: 20, mask: 70, res: 256, margin: 0.3 };

/** Имя меша поля для тройки «вид × вариант × LOD» (спецификация §8.1). */
export const meshName = (kind, variant, lod) => `veg:${kind}:${variant}:L${lod}`;

/** Дальше стольких метров от центра часть деревьев — ели (спецификация §6.1). */
export const PINE_FROM = 45;

const GREEN = {
  leaves: ['#6cc25a', '#58b04e', '#7fd067', '#4fa452', '#8bd36a'],
  bushes: ['#5fae4a', '#6fbf55', '#4f9e47', '#7ac35c'],
  hedges: ['#4f9e47', '#5aa84c', '#468f42'],
  pines: ['#3f9a63', '#2f8a5a', '#47a36b'],
  flowers: ['#ff8fb8', '#ffd84d', '#c6a2ff', '#ffffff', '#ff9f5a'],
  grass: ['#86cf62', '#7cc45a', '#93d76d'],
  flowerPatches: [40, 60], rocks: [10, 16], bushKind: 'bush', snowPines: false,
};

/**
 * Темы растительности. trees — деревьев в кольце (как прежние THEMES[*].trees); pineShare — доля елей среди деревьев
 * дальше PINE_FROM (снег — все ели); палитры цвета экземпляров: leaves, bushes, hedges (null — изгородей и клумб нет),
 * pines, flowers (null — цветов нет), grass (null — травы нет); flowerPatches и rocks — [мин, макс] штук;
 * bushKind — куст или сугроб; snowPines — ели со снежными шапками.
 */
export const VEG_THEMES = {
  valley: { ...GREEN, trees: 64, pineShare: 0.25, leaves: ['#8ad850', '#6fc845', '#a2e05a'] }, // кроны прототипа (§3.3, §5.7)
  harbor: {
    ...GREEN, trees: 28, pineShare: 0, coastal: true,
    grass: ['#92ac71', '#7b9e69', '#a5b67e'], grassFlowers: 0,
  },
  autumn: {
    ...GREEN, trees: 60, pineShare: 0.25, woodlandOpening: 0.11,
    leaves: ['#f39a3c', '#e8673a', '#ffc44d', '#d9822b', '#c8502e', '#a7b84a'],
    bushes: ['#d9822b', '#b9562e', '#c99a3a', '#8f9a3a'],
    hedges: ['#8f9a3a', '#9aa046', '#7f8c34'],
    flowers: ['#ffd84d', '#ff9f5a', '#ffffff', '#e8673a'],
    grass: ['#c2c470', '#b5b862', '#cfc77a'],
    flowerPatches: [20, 30],
  },
  snow: {
    ...GREEN, trees: 58, pineShare: 1, leaves: [], bushes: ['#ffffff', '#f1f6ff', '#e6eefb'],
    hedges: null, flowers: null, grass: null, flowerPatches: [0, 0], bushKind: 'drift', snowPines: true,
  },
  night: { ...GREEN, trees: 44, pineShare: 0.25, buildWoodlandOpening: 0.17 },
  // кроны в бело-розовом цвету (яблони и вишни), кусты с ягодами
  sweet: {
    ...GREEN, trees: 52, pineShare: 0, buildWoodlandOpening: 0.09,
    leaves: ['#ffe3ec', '#ffd0df', '#fff1f5', '#f9bfd3', '#ffc2d4'],
    bushes: ['#78c98c', '#a6dcae', '#e4577a', '#8fd29a'],
    hedges: ['#7fcf95', '#8ed8a2', '#6fc287'],
    flowers: ['#ffffff', '#ffc2d4', '#ffe28a', '#d9c2ff'],
    grass: ['#8fdcae', '#7fd0a0', '#9fe4bb'],
  },
};

/** Тема растительности; неизвестная — долина. */
export const vegTheme = (theme) => VEG_THEMES[Object.hasOwn(VEG_THEMES, theme) ? theme : 'valley'];
