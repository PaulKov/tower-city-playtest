import { SPECIAL, W0 } from '../../../src/core/levels.js';
import { h } from '../../../src/ui/dom.js';

const FLOORS = 5;
const SLOTS = [2, 4];
const KITS = {
  balcony: {
    name: 'Балкон',
    tag: 'Ширина',
    detail: `После среза возвращает до ${Math.round(SPECIAL.balcony.regrow * 100)} % начальной ширины, в пределах фундамента.`,
  },
  atrium: {
    name: 'Атриум',
    tag: 'Жители',
    detail: 'При той же посадке здесь поселится вдвое больше жителей.',
  },
  loft: {
    name: 'Лофт',
    tag: 'Устойчивость',
    detail: 'Падает быстрее. Попадание в центр гасит качку, а посадка на край сильно толкает башню.',
  },
};

const number = new Intl.NumberFormat('ru-RU');

// Чертёж сборной секции. Все три груза используют одну проекцию, с отдельной
// конструкцией фасада, торца и крыши для каждого груза.
function drawKit(type) {
  const canvas = h('canvas', { width: 560, height: 256, 'aria-hidden': 'true', class: 'cargo-drawing' });
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(2, 2);
  ctx.translate(140, 64);
  ctx.scale(1.24, 1.24);
  ctx.translate(-140, -64);
  const p = (x, y, z) => [136 + x * 1.04 - z * 0.67, 88 - y - x * 0.18 - z * 0.32];
  const polygon = (points, color, stroke = '') => {
    ctx.beginPath();
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  const line = (a, b, color, width = 1) => {
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.lineWidth = 1;
  };
  const block = (x1, x2, y1, y2, z1, z2, colors) => {
    const [face, end, top] = colors;
    polygon([p(x1, y1, z1), p(x2, y1, z1), p(x2, y2, z1), p(x1, y2, z1)], face);
    polygon([p(x1, y1, z1), p(x1, y1, z2), p(x1, y2, z2), p(x1, y2, z1)], end);
    polygon([p(x1, y2, z1), p(x2, y2, z1), p(x2, y2, z2), p(x1, y2, z2)], top);
  };
  const frame = ['#637673', '#475b5a', '#c8d2bf'];
  const stone = ['#d4ba87', '#a58c62', '#f6e6b9'];
  const steel = ['#394d50', '#243e41', '#70837e'];
  const pale = ['#f3daac', '#c1a980', '#fff2cf'];

  // Тень и реперы под нижней плитой.
  polygon([p(-55, -8, -24), p(61, -8, -24), p(61, -8, 24), p(-55, -8, 24)], '#28453724');
  for (const [x, z] of [
    [-59, -29],
    [59, -29],
    [-59, 29],
    [59, 29],
  ]) {
    const [u, v] = p(x, -7, z);
    line([u - 2.5, v], [u + 2.5, v], '#516e665d');
    line([u, v - 2.5], [u, v + 2.5], '#516e665d');
  }

  const loft = type === 'loft',
    balcony = type === 'balcony';
  const edge = balcony ? pale : loft ? steel : frame;
  const walls = balcony
    ? ['#dfaa71', '#ad805b', '#edc99b']
    : loft
      ? ['#b86e50', '#95533f', '#d89068']
      : ['#67a5a5', '#608e91', '#b9ded0'];
  block(-54, 54, 0, 5, -22, 22, edge);
  block(-49, 49, 5, 34, -18, 18, walls);
  if (loft) {
    // Швы кладки на двух видимых фасадах.
    for (let y = 9, row = 0; y < 34; y += 5, row++) {
      line(p(-49, y, -18), p(49, y, -18), '#85523e', 0.65);
      line(p(-49, y, -18), p(-49, y, 18), '#764d40', 0.65);
      for (let x = -46 + (row % 2) * 6; x < 49; x += 12) {
        line(p(x, y, -18), p(x, y - 5, -18), '#85523e', 0.65);
      }
    }
  }

  const pane = (a, b, side) => {
    const at = (u, y) => (side ? p(-49.2, y, u) : p(u, y, -18.2));
    const low = balcony ? 7 : 8,
      high = loft ? 29 : 32;
    polygon([at(a, low), at(b, low), at(b, high), at(a, high)], side ? '#42777b' : '#70b3af', '#415e5c');
    polygon([at(a + 1, high - 1), at(b - 2, high - 1), at(a + 1, low + 3)], side ? '#78a9a1' : '#a4d2bc');
    line(at(a, 20), at(b, 20), '#466866', 1.2);
    line(at((a + b) / 2, low), at((a + b) / 2, high), '#466866', 1);
  };
  for (let x = -45; x < 46; x += 24) pane(x, x + (type === 'atrium' ? 23 : 17), false);
  pane(-15, -1, true);
  pane(2, 15, true);
  block(-53, 53, 34, 38, -21, 21, edge);
  if (balcony) {
    block(-57, 57, 4, 7, -29, -17, pale);
    for (let x = -54; x <= 54; x += 9) {
      line(p(x, 7, -27), p(x, 19, -27), '#fcf0cf', 2);
    }
    line(p(-55, 19, -27), p(55, 19, -27), '#7a7868', 2.8);
    line(p(-55, 20, -27), p(55, 20, -27), '#fff2cf', 1.8);
    line(p(-55, 19, -27), p(-55, 19, -16), '#ddccaa', 1.8);
    block(18, 38, 7, 11, -26, -21, ['#ac6749', '#94593e', '#c9885c']);
    for (let x = 19; x < 38; x += 3) {
      line(p(x, 11, -24), p(x - 1, 15 + (x % 3), -24), '#688052', 2.4);
    }
  } else if (loft) {
    for (const x of [-49, -2, 47]) block(x, x + 2.5, 5, 34, -20, -18, steel);
    block(14, 33, 38, 42, -2, 14, stone);
    block(17, 30, 42, 48, 0, 12, ['#667267', '#4c5b52', '#9a9f89']);
    for (let x = 18; x < 29; x += 3) line(p(x, 43, 0), p(x, 47, 0), '#354b4c', 1);
  } else {
    // Невысокий стеклянный фонарь с коньком и видимыми стропилами.
    polygon([p(-37, 38, -12), p(37, 38, -12), p(37, 48, 1), p(-37, 48, 1)], '#9fd3c2', '#5d8882');
    polygon([p(-37, 48, 1), p(37, 48, 1), p(37, 38, 14), p(-37, 38, 14)], '#c4e3d0', '#5d8882');
    polygon([p(-37, 38, -12), p(-37, 48, 1), p(-37, 38, 14)], '#75aba7', '#5d8882');
    for (let x = -32; x <= 32; x += 16) {
      line(p(x, 38, -12), p(x, 48, 1), '#5e827a', 1.4);
      line(p(x, 48, 1), p(x, 38, 14), '#77948a', 1.1);
    }
  }
  return canvas;
}

function kitName(type) {
  return KITS[type]?.name || 'Обычный';
}

function sectionTitle(text) {
  return h('h2', { class: 'cargo-section-title' }, text);
}

function receipt(run, previous) {
  const columns = previous ? [run, previous] : [run];
  const row = (title, read) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, title),
      columns.map((item) => h('td', {}, read(item))),
    );
  return h(
    'table',
    { class: 'cargo-results', 'aria-label': 'Сравнение построек' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Показатель'),
        columns.map((item) => h('th', { scope: 'col' }, 'Дом №' + item.number)),
      ),
    ),
    h(
      'tbody',
      {},
      row('Заказ', (item) => item.kit.map(kitName).join(' → ')),
      row('Этажи', (item) => item.floors + ' / ' + FLOORS),
      row('Особые этажи', (item) => item.specials + ' / ' + SLOTS.length),
      row('Ширина верха', (item) => (item.floors ? item.width + ' %' : '—')),
      row('Жители', (item) => number.format(item.population)),
    ),
  );
}

export function showCargo({ city, panel, state, save, build }) {
  const harbor = city === 'harbor';
  const options = [harbor ? 'loft' : 'balcony', 'atrium'];
  const shop = (state.workshop ??= { kit: options.slice(), runs: [], count: 0 });
  if (state.result) {
    const result = state.result,
      pending = shop.pending;
    if (pending) {
      const floors = result.floors;
      const width = result.widthPercent ?? Math.round((100 * result.width) / W0);
      const specials = result.floorTypes.filter((type) => options.includes(type)).length;
      shop.runs = [
        {
          number: pending.number,
          kit: pending.kit,
          floors,
          width,
          population: result.population,
          specials,
        },
        ...shop.runs,
      ].slice(0, 2);
      shop.count = pending.number;
      shop.page = 'receipt';
      delete shop.pending;
    }
    delete state.result;
    save();
  }
  const box = h('div', { class: 'cargo-workshop', dataset: { city } });
  panel.replaceChildren(box);

  function showReceipt() {
    const [run, previous] = shop.runs;
    const full = run.floors === FLOORS;
    const intro = full
      ? previous
        ? 'Сравните два последних заказа.'
        : 'Следующий заказ появится рядом для сравнения.'
      : 'Каски закончились. В зачёт пошли все установленные этажи.';
    const review = h(
      'div',
      { class: 'cargo-review' },
      h('div', { class: 'cargo-eyebrow' }, harbor ? 'Верфь Морской гавани' : 'Мастерская Солнечной долины'),
      h(
        'h1',
        { class: 'cargo-title' },
        full ? 'Дом №' + run.number + ' готов' : 'Стройка №' + run.number + ' завершена',
      ),
      h('p', { class: 'cargo-intro' }, intro + ' Ширина верха указана в процентах от фундамента.'),
      receipt(run, previous),
    );
    const nextButton = h(
      'button',
      {
        type: 'button',
        class: 'cargo-primary',
        dataset: { cargo: 'next' },
        onClick: () => {
          shop.page = 'prep';
          save();
          showPrep();
          box.querySelector('[data-kit]').focus();
        },
      },
      'Собрать следующий дом',
    );
    const rematch = h(
      'div',
      { class: 'cargo-next' },
      sectionTitle('Следующий заказ'),
      h('p', {}, 'Поменяйте грузы местами или поставьте один тип дважды.'),
      nextButton,
    );
    box.replaceChildren(h('div', { class: 'cargo-recap' }, review, rematch));
  }

  function showPrep() {
    const kitButtons = [],
      names = [];
    const announce = h('div', { class: 'cargo-sr', role: 'status' });
    const card = (type) => {
      const item = KITS[type];
      const detail =
        harbor && type === 'atrium'
          ? 'Вдвое больше жителей на этаже. Ветер в полёте действует на атриум вдвое сильнее.'
          : item.detail;
      const buttons = SLOTS.map((floor, index) => {
        const button = h(
          'button',
          {
            type: 'button',
            class: 'cargo-pick',
            dataset: { kit: type, floor },
            'aria-label': item.name + ', поставить на ' + floor + '-й этаж',
            onClick: () => {
              shop.kit[index] = type;
              applySelection(true);
            },
          },
          floor + '-й этаж',
        );
        kitButtons.push([button, type, index]);
        return button;
      });
      return h(
        'article',
        { class: 'cargo-card', dataset: { type } },
        h('div', { class: 'cargo-art' }, drawKit(type)),
        h(
          'div',
          { class: 'cargo-card-body' },
          h('div', { class: 'cargo-trait' }, item.tag),
          h('h2', { class: 'cargo-kit-name' }, item.name),
          h('p', {}, detail),
          h(
            'div',
            { class: 'cargo-assign', role: 'group', 'aria-label': 'Назначить ' + item.name.toLowerCase() },
            buttons,
          ),
        ),
      );
    };
    const cards = options.map(card);
    const queue = SLOTS.map((floor) => {
      const name = h('b', {});
      names.push(name);
      return h('li', {}, h('span', { class: 'cargo-level' }, floor + '-й этаж'), name);
    });
    const swap = h(
      'button',
      {
        type: 'button',
        class: 'cargo-swap',
        dataset: { cargo: 'swap' },
        onClick: () => {
          shop.kit.reverse();
          applySelection(true);
        },
      },
      h('span', { 'aria-hidden': 'true' }, '⇅'),
      'Поменять местами',
    );
    const launch = h(
      'button',
      {
        type: 'button',
        class: 'cargo-primary',
        dataset: { cargo: 'build' },
        onClick: () => {
          launch.disabled = true;
          const pending = { number: shop.count + 1, kit: shop.kit.slice() };
          shop.pending = pending;
          save();
          build({
            label: 'Дом №' + pending.number + ' · Мастерская этажей',
            floorsTarget: FLOORS,
            specials: Object.fromEntries(SLOTS.map((floor, index) => [floor, pending.kit[index]])),
          });
        },
      },
      'Начать стройку',
    );
    function applySelection(changed) {
      for (const [button, type, index] of kitButtons) {
        button.setAttribute('aria-pressed', String(shop.kit[index] === type));
      }
      names.forEach((name, index) => {
        name.textContent = kitName(shop.kit[index]);
      });
      swap.disabled = shop.kit[0] === shop.kit[1];
      if (changed) {
        announce.textContent = SLOTS.map((floor, i) => floor + '-й этаж — ' + names[i].textContent).join(
          '. ',
        );
        save();
      }
    }
    const ticket = h(
      'div',
      { class: 'cargo-ticket' },
      h(
        'div',
        { class: 'cargo-ticket-head' },
        sectionTitle('Очередь крана'),
        h('b', {}, 'Дом №' + (shop.count + 1)),
      ),
      h('p', {}, 'Из пяти этажей два особых. Остальные придут обычными.'),
      h('ol', { class: 'cargo-queue', 'aria-label': 'Очередь особых этажей' }, queue),
      swap,
      launch,
    );
    const history = shop.runs.length
      ? h('details', { class: 'cargo-log' }, h('summary', {}, 'Предыдущие заказы'), receipt(...shop.runs))
      : null;
    box.replaceChildren(
      h('div', { class: 'cargo-eyebrow' }, harbor ? 'Верфь Морской гавани' : 'Мастерская Солнечной долины'),
      h('h1', { class: 'cargo-title' }, 'Мастерская этажей'),
      h(
        'p',
        { class: 'cargo-intro' },
        'Выберите груз для второго и четвёртого этажей. Можно заказать один тип дважды.',
      ),
      h('div', { class: 'cargo-workbench' }, h('div', { class: 'cargo-cards' }, cards), ticket),
      ...(history ? [history] : []),
      announce,
    );
    applySelection(false);
  }
  if (shop.page === 'receipt' && shop.runs.length) showReceipt();
  else showPrep();
}
