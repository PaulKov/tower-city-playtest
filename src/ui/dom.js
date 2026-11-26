// Мини-помощники DOM без зависимостей.

/**
 * h('button', { class: 'btn', onClick: fn, disabled: true }, 'Текст', [детиМассивом], null)
 * on* — обработчики событий, style — строка или объект, dataset — объект, true/false — булевы атрибуты.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        // Object.assign молча пропускает пользовательские свойства (--c), поэтому setProperty.
        else for (const [p, val] of Object.entries(v)) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(val));
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.append(...children);
  return el;
}

// Поля ввода без набора текста: их клавиши — обычные нажатия.
const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Элемент принимает набор с клавиатуры: текстовое поле, textarea, select или contenteditable. Не элемент — false. */
export function isEditable(el) {
  if (typeof Element === 'undefined' || !(el instanceof Element)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !NOT_TEXT.has(el.type);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Иконки 24×24, цвет — currentColor. Только константные строки (без пользовательских данных).
const ICONS = {
  house: '<path d="m2 10 9-7.3a1.6 1.6 0 0 1 2 0l9 7.3-1.8 2.2-1.2-1v8.5a1.6 1.6 0 0 1-1.6 1.6H14v-7h-4v7H6.6A1.6 1.6 0 0 1 5 19.7v-8.5l-1.2 1z"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  inspect: '<circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  person: '<circle cx="12" cy="7" r="4.6"/><path d="M4.2 21.5c0-4.8 3.5-8.3 7.8-8.3s7.8 3.5 7.8 8.3z"/>',
  helmet: '<path d="M3.6 15.2a8.4 8.4 0 0 1 16.8 0z"/><rect x="1.6" y="15" width="20.8" height="3.8" rx="1.9"/><rect x="10.5" y="5" width="3" height="6.4" rx="1.3" fill="#fff" opacity=".45"/>',
  star: '<path d="M12 2.2l2.95 6.2 6.75.85-4.98 4.65 1.3 6.73L12 17.3l-6.02 3.33 1.3-6.73L2.3 9.25l6.75-.85z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  coin: '<circle cx="12" cy="12" r="9.6"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2"/><path d="M10.2 8.6h3.6M10.2 15.4h3.6M12 8.6v6.8" stroke="#000" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>',
  pause: '<rect x="5.5" y="4" width="4.6" height="16" rx="1.8"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.8"/>',
  play: '<path d="M7.4 4.6c0-1 1.1-1.6 1.9-1.1l10.4 7.3c.7.5.7 1.6 0 2.1L9.3 20.4c-.8.6-1.9 0-1.9-1z"/>',
  back: '<path d="M15 4.5L7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.6 4.6L19.2 7.4" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="11" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6"/>',
  city: '<path d="M2.5 21.5V11h4.5V7h4.5v4h1.5V2.5h6.5v19z"/><path d="M14.5 6h2M14.5 9h2M14.5 12h2M8.5 13.5h1" stroke="#fff" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round"/>',
  bag: '<path d="M4.6 8.2h14.8l-1.3 12.3a1.8 1.8 0 0 1-1.8 1.6H7.7a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M8.6 8.2V6.6a3.4 3.4 0 0 1 6.8 0v1.6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  gear: '<circle cx="12" cy="12" r="7.3" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="3.25 2.48"/><path fill-rule="evenodd" d="M12 6.2a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6zm0 3.5a2.3 2.3 0 1 1 0 4.6a2.3 2.3 0 1 1 0-4.6z"/>',
  hand: '<path d="M9 11V4.6a1.6 1.6 0 0 1 3.2 0V10l.1-1.2a1.6 1.6 0 0 1 3.1.2l.1.9a1.6 1.6 0 0 1 3 .6V15a7 7 0 0 1-7 7h-.6a6.4 6.4 0 0 1-5.2-2.7l-2.6-3.7a1.6 1.6 0 0 1 2.6-1.9L9 15.6z"/>',
  magnet: '<path d="M4.5 3.5h5v7.6a2.5 2.5 0 0 0 5 0V3.5h5v7.6a7.5 7.5 0 0 1-15 0z"/><path d="M4.5 3.5h5v3h-5zM14.5 3.5h5v3h-5z" fill="#fff" opacity=".7"/>',
  slow: '<path d="M5.5 2h13v2.4c0 3.4-2.4 5.4-4.1 7.6 1.7 2.2 4.1 4.2 4.1 7.6V22h-13v-2.4c0-3.4 2.4-5.4 4.1-7.6-1.7-2.2-4.1-4.2-4.1-7.6z"/><path d="M9 19.6c0-1.5 1.4-2.6 3-3.6 1.6 1 3 2.1 3 3.6z" fill="#fff" opacity=".6"/>',
  widen: '<path d="M1.5 12l5.6-5.4v3.3h9.8V6.6l5.6 5.4-5.6 5.4v-3.3H7.1v3.3z"/>',
  anchor: '<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><circle cx="12" cy="5" r="2.4"/><path d="M12 7.6V21M7.6 11h8.8M4 13.6a8 7.4 0 0 0 16 0"/></g>',
  sun: '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-dasharray="2.2 2.5" stroke-linecap="round"/>',
  wave: '<path d="M2 9.5c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0 3.6-2 5-1.2M2 15.5c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0 3.6-2 5-1.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  leaf: '<path d="M20.5 3.5C9 3.5 3.5 9 3.5 16.5c0 1.4.2 2.7.6 4 1-4.6 4.3-8.6 9.4-10.6-4 2.6-6.3 6.3-6.9 10.5 1 .2 2 .3 3 .3 7.4 0 10.9-6.6 10.9-17.2z"/>',
  snow: '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4l2.5 2.5L14.5 4M9.5 20l2.5-2.5 2.5 2.5"/></g>',
  cupcake: '<path d="M12 2.4c-2 0-3.4 1.4-3.6 3.2A4.6 4.6 0 0 0 4.6 10h14.8a4.6 4.6 0 0 0-3.8-4.4C15.4 3.8 14 2.4 12 2.4z"/><path d="M5.2 11.6h13.6l-1.5 9a1.8 1.8 0 0 1-1.8 1.5H8.5a1.8 1.8 0 0 1-1.8-1.5z" opacity=".8"/><path d="M9 13.4v6M12 13.4v6M15 13.4v6" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/><circle cx="12" cy="1.9" r="1.1" fill="#e4577a"/>',
  moon: '<path d="M15.6 3a9 9 0 1 0 5.4 14.6A7.6 7.6 0 0 1 15.6 3z"/><circle cx="19" cy="6" r="1.2"/>',
  pencil: '<path d="M15.4 3.6a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4L9.2 19.8l-5.6 1.1 1.1-5.6z"/><path d="M13.4 5.6l5 5" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/>',
  // Герои (спецификация «Герои городов» §8): головы видов в цвете героя и сердце значка на карте городов.
  panda: '<circle cx="5.6" cy="6.4" r="3.4"/><circle cx="18.4" cy="6.4" r="3.4"/><circle cx="12" cy="13.4" r="8.6"/><g fill="#000" fill-opacity=".4"><ellipse cx="8.6" cy="12.6" rx="2.2" ry="2.9" transform="rotate(-18 8.6 12.6)"/><ellipse cx="15.4" cy="12.6" rx="2.2" ry="2.9" transform="rotate(18 15.4 12.6)"/><ellipse cx="12" cy="17.2" rx="1.7" ry="1.2"/></g>',
  rabbit: '<ellipse cx="8.4" cy="6.4" rx="2.5" ry="5.6" transform="rotate(-10 8.4 6.4)"/><ellipse cx="15.6" cy="6.4" rx="2.5" ry="5.6" transform="rotate(10 15.6 6.4)"/><circle cx="12" cy="15.2" r="7.4"/><g fill="#000" fill-opacity=".4"><circle cx="9.3" cy="14.4" r="1.3"/><circle cx="14.7" cy="14.4" r="1.3"/><ellipse cx="12" cy="17.6" rx="1.4" ry="1"/></g>',
  shark: '<path d="M12 1.8l3.4 6.3c3.6 1.3 6.2 4.4 6.2 8.1 0 3.6-4.3 6.2-9.6 6.2s-9.6-2.6-9.6-6.2c0-3.7 2.6-6.8 6.2-8.1z"/><g fill="#000" fill-opacity=".4"><circle cx="8.6" cy="14.6" r="1.3"/><circle cx="15.4" cy="14.6" r="1.3"/></g><path d="M7.6 18.2l1.5-1.1 1.5 1.1 1.4-1.1 1.4 1.1 1.5-1.1 1.5 1.1" fill="none" stroke="#fff" stroke-width="1.3" stroke-linejoin="round" stroke-opacity=".9"/>',
  heart: '<path d="M12 21.2s-8.1-5-9.8-10C.9 7.6 3.2 3.9 6.9 3.9c2.2 0 3.9 1.2 5.1 3 1.2-1.8 2.9-3 5.1-3 3.7 0 6 3.7 4.7 7.3-1.7 5-9.8 10-9.8 10z"/>',
  // спец-этажи («Спец-этажи» §9.2): арка-витраж с листом, двутавр с заклёпками, балюстрада на плите
  atrium: '<path d="M3.5 21.5V10.5a8.5 8.5 0 0 1 17 0v11z"/><path d="M12 2.5v19M3.5 12.5h17" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/><path d="M8 20c0-3.6 2.3-6.2 6.2-6.8-.4 3.8-2.7 6.3-6.2 6.8z" fill="#fff" opacity=".75"/>',
  loft: '<path d="M3 3h18v4h-6.5v10H21v4H3v-4h6.5V7H3z"/><g fill="#fff" opacity=".6"><circle cx="6" cy="5" r="1"/><circle cx="18" cy="5" r="1"/><circle cx="6" cy="19" r="1"/><circle cx="18" cy="19" r="1"/></g>',
  balcony: '<rect x="2" y="4.5" width="20" height="3" rx="1.2"/><rect x="1" y="18" width="22" height="3.5" rx="1.2"/><path d="M5 7.5V18M9.7 7.5V18M14.3 7.5V18M19 7.5V18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  // Башня дня («Башня дня» §6.8; план, отличие 16): медаль на ленте, огонёк серии, ветер, узкий фундамент
  medal: '<path d="M6.4 1.8h4.3l2.4 6.6H8.8zM17.6 1.8h-4.3l-2.4 6.6h4.3z" opacity=".55"/><circle cx="12" cy="15.2" r="7"/><circle cx="12" cy="15.2" r="4.3" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.7"/>',
  flame: '<path d="M12 2.2c.6 3.4 3 5 4.6 7.4 1.4 2 2.1 3.7 2.1 5.6A6.7 6.7 0 0 1 12 21.9a6.7 6.7 0 0 1-6.7-6.7c0-2.6 1.3-4.7 3.1-6.3-.1 1.7.4 3 1.6 3.9C9.8 9 10.6 5.6 12 2.2z"/><path d="M12 13.2c1.6 1.5 2.6 2.7 2.6 4.3a2.6 2.6 0 0 1-5.2 0c0-1.6 1-2.8 2.6-4.3z" fill="#fff" opacity=".55"/>',
  wind: '<path d="M2.5 8.5h12a3 3 0 1 0-3-3M2.5 13h16a3 3 0 1 1-3 3M2.5 17.5h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  bolt: '<path d="M14.5 1 4.3 14h6.2l-1 9L20 9.3h-6.3z"/>',
  narrow: '<rect x="9" y="4.5" width="6" height="15" rx="1.6"/><path d="M1.5 12l5-4.4v8.8zM22.5 12l-5-4.4v8.8z"/>',
};

export function icon(name, cls = '') {
  const s = document.createElement('span');
  s.className = ('ico ' + cls).trim();
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${ICONS[name] || ''}</svg>`;
  return s;
}

// Рисунки логотипа: своё поле viewBox, цвета заданы в разметке. Только константные строки, как ICONS.
const ART = {
  // Панда верхом на этаже (логотип меню): лапы .art-leg болтаются, зрачки .art-eyes следят за акулой, капля .art-sweat.
  pandaRider: ['0 0 60 76', '<g fill="#1f2d55"><rect class="art-leg" x="18" y="54" width="9" height="22" rx="4.5"/><rect class="art-leg r" x="33" y="54" width="9" height="22" rx="4.5"/></g>'
    + '<ellipse cx="30" cy="48" rx="17" ry="14" fill="#fff" stroke="#1f2d55" stroke-width="1.4"/>'
    + '<g fill="#1f2d55"><ellipse cx="14.5" cy="47" rx="5" ry="8.5" transform="rotate(28 14.5 47)"/><ellipse cx="45.5" cy="47" rx="5" ry="8.5" transform="rotate(-28 45.5 47)"/><circle cx="17" cy="9" r="5.5"/><circle cx="43" cy="9" r="5.5"/></g>'
    + '<circle cx="30" cy="22" r="15" fill="#fff" stroke="#1f2d55" stroke-width="1.4"/>'
    + '<g fill="#1f2d55"><ellipse cx="23.6" cy="22" rx="4.2" ry="5.4" transform="rotate(25 23.6 22)"/><ellipse cx="36.4" cy="22" rx="4.2" ry="5.4" transform="rotate(-25 36.4 22)"/></g>'
    + '<circle cx="24" cy="22.6" r="2.4" fill="#fff"/><circle cx="36" cy="22.6" r="2.4" fill="#fff"/>'
    + '<g class="art-eyes" fill="#1f2d55"><circle cx="24" cy="23" r="1.3"/><circle cx="36" cy="23" r="1.3"/></g>'
    + '<ellipse cx="30" cy="29" rx="2.4" ry="1.6" fill="#1f2d55"/><path d="M26.5 33q1.75-1.6 3.5 0q1.75 1.6 3.5 0" fill="none" stroke="#1f2d55" stroke-width="1.2" stroke-linecap="round"/>'
    + '<path class="art-sweat" d="M49 8q3.4 5.4 0 7.6q-3.4-2.2 0-7.6z" fill="#8ad8ff"/>'],
};

/** Рисунок логотипа: span.art со своим SVG; размер задаёт CSS. */
export function art(name, cls = '') {
  const s = document.createElement('span');
  s.className = ('art ' + cls).trim();
  s.setAttribute('aria-hidden', 'true');
  const [box, body] = ART[name] || ['0 0 1 1', ''];
  s.innerHTML = `<svg viewBox="${box}">${body}</svg>`;
  return s;
}

/** Значок героя (портрет, карточка, фишка, метка): span.ico.hero-face, цвет — --hero; без цвета — серый силуэт. */
export function heroFace(view, cls = '') {
  const el = icon(view.icon, ('hero-face ' + cls).trim());
  if (view.color) el.style.setProperty('--hero', view.color);
  return el;
}

/** Повторно запустить CSS-анимацию класса cls на элементе. */
export function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
