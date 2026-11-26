// У проверочных прохождений своя анонимная сессия и своя очередь подтверждений.
const params = new URLSearchParams(location.search);
const qa = params.get('qa') === '1';
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const delivery = document.querySelector('meta[name="study-delivery"]')?.content;
const localCollector = delivery === 'local';
const storageKey = 'tower.study.v1.' + (qa ? 'qa' : 'play') + (localCollector ? '.local' : '');
const pointer = localCollector ? routingUrl() : null;
const invitation = localCollector ? await invitationOrigin() : null;
let receiver = localCollector ? invitation || configuredOrigin() : location.origin;
const modeNames = { slice: 'Мостик и баржа', district: 'Планировка', cargo: 'Мастерская этажей' };
const cities = { valley: 'Долина', harbor: 'Гавань' };
const get = (id) => document.getElementById('study-' + id);
let data, current, sending = false, leaving = false, timer, delay = 1000, checkRoute = true;

function configuredOrigin() {
  const configured = document.querySelector('meta[name="study-endpoint"]')?.content;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' && (configured === url.origin || configured === url.origin + '/')) {
        return url.origin;
      }
    } catch {
      // Очередь подождёт до открытия ссылки с рабочим адресом.
    }
  }
  return null;
}

function routingUrl() {
  const configured = document.querySelector('meta[name="study-routing-url"]')?.content;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return url.href;
  } catch {
    // Всегда остаётся заданный сборкой адрес или подписанное приглашение.
  }
  return null;
}

async function signedOrigin(origin, sig) {
  if (typeof origin !== 'string' || !/^https:\/\/[a-z0-9-]{1,100}\.trycloudflare\.com$/.test(origin)) return null;
  const spki = document.querySelector('meta[name="study-routing-key"]')?.content;
  if (typeof sig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(sig) || !spki) return null;
  try {
    const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'spki', bytes(spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    const signature = bytes(sig.replaceAll('-', '+').replaceAll('_', '/'));
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(origin),
    );
    if (valid) return origin;
  } catch {
    // Непроверенный параметр не меняет назначение журнала.
  }
  return null;
}

async function invitationOrigin() {
  const slug = params.get('receiver');
  if (!slug || params.getAll('receiver').length !== 1 || params.getAll('sig').length !== 1) return null;
  return signedOrigin('https://' + slug + '.trycloudflare.com', params.get('sig'));
}

async function refreshRoute() {
  if (!pointer) return;
  const now = Date.now();
  const route = data.routing;
  if (route.checkedAt <= now && now - route.checkedAt < 30000) return;
  route.checkedAt = now;
  save();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    // Запрашиваем только публичный адрес, без идентификатора вкладки и игровых данных.
    const response = await fetch(pointer, {
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) return;
    const { origin, sig } = await response.json();
    if (!(await signedOrigin(origin, sig)) || leaving) return;
    route.origin = origin;
    route.sig = sig;
    if (origin !== receiver) {
      receiver = origin;
      data.receiver = origin;
      delete data.token;
    }
    save();
  } catch {
    // При недоступном указателе доставка идёт на последний проверенный адрес.
  } finally {
    clearTimeout(timeout);
  }
}

function fresh() {
  return { key: crypto.randomUUID(), seq: 0, queue: [], places: {}, questions: [], drafts: {} };
}

// Браузер копирует sessionStorage во вкладку, открытую через window.open.
// Закрепляем ключ за живой страницей, освобождая его при переходе в этой же вкладке.
async function claimTab(key) {
  if (!navigator.locks) return true;
  return new Promise((resolve) => {
    navigator.locks.request('tower.study.' + key, { ifAvailable: true }, (lock) => {
      resolve(!!lock);
      if (lock) return new Promise((release) => window.addEventListener('pagehide', release, { once: true }));
    }).catch(() => resolve(true));
  });
}

if ((!local || params.get('study') === '1') && crypto.randomUUID) {
  try {
    data = JSON.parse(sessionStorage.getItem(storageKey)) || fresh();
    if (!(await claimTab(data.key))) {
      data = fresh();
      await claimTab(data.key);
    }
    if (Array.isArray(data.events)) {
      data.queue = data.events.slice(data.acknowledged || 0);
      delete data.events;
      delete data.acknowledged;
      delete data.started;
    }
    if (pointer) {
      if (data.routing?.url !== pointer || data.routing.invitation !== invitation) {
        data.routing = { url: pointer, invitation, checkedAt: 0 };
      } else {
        receiver = (await signedOrigin(data.routing.origin, data.routing.sig)) || receiver;
      }
    }
    if (localCollector && data.receiver !== receiver) {
      delete data.token;
      data.receiver = receiver;
    }
    sessionStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    data = null;
  }
}

function save() {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // В этой странице можно доиграть и отправить оставшиеся события из памяти.
  }
}

function record(type, mode, city, run, fields) {
  const event = { id: crypto.randomUUID(), seq: ++data.seq, type, mode, city, run, ...fields };
  data.queue.push(event);
  save();
  // Все синхронные действия игрока (например первый start + drop) уйдут вместе.
  if (!timer) queueMicrotask(flush);
  return event.id;
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(receiver + '/api/study/' + path, {
    method: 'POST', headers, body: JSON.stringify(body), keepalive: true,
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout?.(15000),
  });
}

async function flush() {
  if (!data || data.full || sending || leaving || !data.queue.length) return;
  clearTimeout(timer);
  timer = null;
  sending = true;
  let retry = 0;
  try {
    if (checkRoute) {
      await refreshRoute();
      checkRoute = false;
    }
    if (leaving) return;
    if (!receiver) throw new Error();
    if (!data.token) {
      const session = await post('session', { key: data.key, qa });
      if (!session.ok) throw new Error();
      const { token } = await session.json();
      if (typeof token !== 'string' || !token) throw new Error();
      if (leaving) return;
      data.token = token;
      save();
    }
    const events = data.queue.slice(0, 30);
    const result = await post('events', { events }, data.token);
    if (leaving) return;
    if (result.status === 401) delete data.token;
    if (result.status === 409) data.full = true;
    if (!result.ok || (await result.json()).ok !== true) throw new Error();
    if (leaving) return;
    data.queue.splice(0, events.length);
    delay = 1000;
  } catch {
    checkRoute = true;
    retry = delay;
    delay = Math.min(60000, delay * 2);
  } finally {
    sending = false;
    if (!leaving) {
      save();
      showStatus();
      if (data.queue.length && !data.full) timer = setTimeout(flush, retry);
    }
  }
}

function place(mode, city) {
  return (data.places[mode + '.' + city] ??= { attempts: 0 });
}

function atLimit() {
  return data.full || data.seq >= 2500;
}

export function studyOpen(mode, city) {
  if (!data) return;
  current = { mode, city };
  const here = place(mode, city);
  if (!here.open && !atLimit()) {
    here.open = true;
    record('open', mode, city, null);
  }
  get('notice').hidden = false;
  get('details').hidden = false;
  topics();
  showStatus();
}

export function studyStart(mode, city, previousRun) {
  if (!data || atLimit()) return null;
  const here = place(mode, city);
  const followsFinish = here.finished && here.run === previousRun;
  const kind = !followsFinish ? 'first' : here.floors > 0 ? 'repeat' : 'retry';
  const id = crypto.randomUUID();
  here.run = id;
  here.dropped = false;
  here.finished = false;
  here.attempts++;
  if (kind === 'repeat') data.questions.push({ id, mode, city, number: here.attempts });
  record('start', mode, city, id, { kind });
  if (kind === 'repeat') topics();
  return id;
}

export function studyDrop(mode, city, id) {
  if (!data || !id || atLimit()) return;
  const here = place(mode, city);
  if (here.run !== id || here.dropped) return;
  here.dropped = true;
  record('drop', mode, city, id);
}

export function studyFinish(mode, city, id, floors) {
  if (!data || !id || atLimit()) return;
  const here = place(mode, city);
  if (here.run !== id || here.finished || !here.dropped) return;
  here.finished = true;
  here.floors = floors;
  record('finish', mode, city, id, { floors });
}

function addTopic(select, mode, city, title, value) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = modeNames[mode] + ' · ' + cities[city] + ' · ' + title;
  select.append(option);
}

function topics() {
  if (!current) return;
  const select = get('topic');
  const previous = select.value;
  select.replaceChildren();
  for (const q of [...data.questions].reverse()) {
    addTopic(select, q.mode, q.city, 'стройка №' + q.number, q.id);
  }
  const { mode, city } = current;
  addTopic(select, mode, city, 'общее впечатление', mode + '.' + city);
  if (get('details').open && [...select.options].some((o) => o.value === previous)) select.value = previous;
  get('link').textContent = data.questions.length ? 'Почему захотелось построить ещё?' : 'Оставить отзыв';
  selectTopic();
}

function selectTopic() {
  const topic = get('topic').value;
  const q = data.questions.find((item) => item.id === topic);
  get('question').textContent = q
    ? 'Почему вы начали ещё одну стройку здесь?'
    : 'Что вам понравилось или почему захотелось остановиться?';
  get('text').value = data.drafts[topic] || '';
  get('send').disabled = atLimit() || !get('text').value.trim();
}

function showStatus() {
  let message = '';
  if (data.lastAnswer) {
    if (data.queue.some((e) => e.id === data.lastAnswer)) {
      message = data.full ? 'Не удалось отправить ответ.' : 'Ответ сохранён в этой вкладке и ожидает отправки.';
    } else message = 'Ответ отправлен. Спасибо!';
  }
  if (atLimit()) {
    message = (message ? message + ' ' : '') + 'Место для ответов этой вкладки закончилось.';
    get('send').disabled = true;
  }
  if (get('status').textContent !== message) get('status').textContent = message;
  if (localCollector) {
    const status = data.queue.length && !data.full && (!receiver || delay > 1000)
      ? 'Действия ждут отправки в этой вкладке. Оставьте её открытой до восстановления связи.'
      : '';
    if (get('delivery-status').textContent !== status) get('delivery-status').textContent = status;
  }
}

if (data) {
  if (localCollector) {
    get('disclosure').textContent =
      'Выбор режима и города, стройки и ваши ответы анонимно передаются на компьютер автора теста.';
  }
  get('link').onclick = (event) => {
    event.preventDefault();
    if (data.questions.length && !data.questions.some((q) => q.id === get('topic').value)) {
      get('topic').value = data.questions.at(-1).id;
      selectTopic();
    }
    get('details').open = true;
    get('text').focus();
  };
  get('topic').onchange = selectTopic;
  get('text').oninput = () => {
    data.drafts[get('topic').value] = get('text').value;
    get('send').disabled = atLimit() || !get('text').value.trim();
    save();
  };
  get('form').onsubmit = (event) => {
    event.preventDefault();
    const text = get('text').value.trim().slice(0, 400);
    if (!text || atLimit() || !current) return;
    const topic = get('topic').value;
    const index = data.questions.findIndex((q) => q.id === topic);
    const q = index >= 0 ? data.questions.splice(index, 1)[0] : null;
    delete data.drafts[topic];
    const { mode, city } = q || current;
    data.lastAnswer = record(q ? 'reason' : 'feedback', mode, city, q?.id || null, { text });
    save();
    topics();
    showStatus();
  };
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', flush);
  flush();
  window.addEventListener('pagehide', () => {
    leaving = true;
    // Последнее нажатие могло прийти во время предыдущего запроса. ID при повторе те же.
    if (receiver && !data.full && data.token && data.queue.length) {
      const events = data.queue.slice(0, 30);
      post('events', { events }, data.token).catch(() => {});
    }
  });
  window.addEventListener('pageshow', (event) => {
    // За время пребывания страницы в bfcache другая стройка могла обновить этот журнал.
    if (event.persisted) location.reload();
  });
}
