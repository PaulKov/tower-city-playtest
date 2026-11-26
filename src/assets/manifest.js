// Манифест ассетов: формат, проверка и выборки по пакетам. Без three и DOM.
export const FORMAT = 1;
export const VERSIONS = ['full', 'lite'];
export const ROLES = {
  pbr: ['albedo', 'normal', 'roughness'],
  texture: ['image'],
  gltf: ['model'],
  binary: ['data'],
};
// Необязательные роли: проверяются и загружаются, только если есть в files.
// far — дальний вид модели (упрощённая геометрия без клипов).
export const OPTIONAL_ROLES = { gltf: ['far'] };
const CREDIT_KEYS = ['title', 'author', 'license', 'url'];

export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const own = (obj, key) => isObj(obj) && Object.hasOwn(obj, key);
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const fail = (msg) => { throw new ManifestError(msg); };

export const assetRoles = (a) => [
  ...ROLES[a.type],
  ...(own(OPTIONAL_ROLES, a.type) ? OPTIONAL_ROLES[a.type] : []).filter((r) => own(a.files, r)),
];

// Путь остаётся внутри assets/: без схемы, хоста, управляющих символов, %, ?, #
// (URL-нормализация), без пустых, «.» и «..» сегментов (в т.ч. ведущего и хвостового «/»).
const BAD_PATH_CHARS = /[\u0000-\u0020\u007f\\:%?#]/;
const isLocalPath = (p) => isStr(p) && !BAD_PATH_CHARS.test(p)
  && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');

// Адрес авторов открывается ссылкой на экране «Авторы»: только абсолютный http(s) с хостом.
function isWebUrl(u) {
  if (!isStr(u) || !/^https?:\/\//i.test(u)) return false;
  try {
    return new URL(u).hostname !== '';
  } catch {
    return false;
  }
}

function checkFile(where, f) {
  if (!isObj(f)) fail(`${where}: нет записи файла`);
  const p = f.file;
  if (!isLocalPath(p)) fail(`${where}: недопустимый путь ${show(p)}`);
  if (!Number.isInteger(f.bytes) || f.bytes <= 0) fail(`${where}: недопустимый размер ${show(f.bytes)}`);
}

export function parseManifest(json) {
  if (!isObj(json)) fail('манифест не объект');
  if (json.format !== FORMAT) fail(`формат ${show(json.format)}, ожидался ${FORMAT}`);
  const { packs, assets, credits } = json;
  if (!isObj(packs) || !isObj(assets) || !isObj(credits)) fail('нет packs, assets или credits');
  for (const [id, a] of Object.entries(assets)) {
    if (!isObj(a) || typeof a.type !== 'string' || !own(ROLES, a.type)) fail(`${id}: неизвестный тип ${show(a?.type)}`);
    if (!isObj(a.files)) fail(`${id}: нет files`);
    for (const role of assetRoles(a)) {
      if (!own(a.files, role)) fail(`${id}: нет роли ${role}`);
      for (const v of VERSIONS) checkFile(`${id}.${role}.${v}`, own(a.files[role], v) ? a.files[role][v] : undefined);
    }
    const c = own(credits, id) ? credits[id] : undefined;
    if (!isObj(c) || !CREDIT_KEYS.every((k) => isStr(c[k]))) fail(`${id}: нет авторов`);
  }
  // AssetStore.credits() отдаёт все записи (кроме собственных ассетов), а не только записи ассетов, поэтому проверяем каждую.
  for (const [id, c] of Object.entries(credits)) {
    if (!isObj(c) || !CREDIT_KEYS.every((k) => isStr(c[k]))) fail(`${id}: нет авторов`);
    if (!isWebUrl(c.url)) fail(`${id}: адрес авторов не http(s): ${show(c.url)}`);
  }
  for (const [name, ids] of Object.entries(packs)) {
    if (!Array.isArray(ids)) fail(`пакет ${name} не список`);
    for (const id of ids) if (typeof id !== 'string' || !own(assets, id)) fail(`пакет ${name}: неизвестный ассет ${show(id)}`);
  }
  return json;
}

export function pickVersion({ param = null, coarse = false } = {}) {
  if (param === 'full' || param === 'lite') return param;
  return coarse ? 'lite' : 'full';
}

export function packAssets(m, packs) {
  const ids = [];
  for (const p of packs) {
    if (!own(m.packs, p)) continue;
    for (const id of m.packs[p]) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function assetFiles(m, id, version) {
  const a = m.assets[id];
  return assetRoles(a).map((role) => ({ id, role, file: a.files[role][version].file, bytes: a.files[role][version].bytes }));
}

export function packFiles(m, packs, version) {
  const seen = new Map();
  for (const id of packAssets(m, packs)) {
    for (const f of assetFiles(m, id, version)) if (!seen.has(f.file)) seen.set(f.file, f);
  }
  return [...seen.values()];
}

export const packBytes = (m, packs, version) => packFiles(m, packs, version).reduce((s, f) => s + f.bytes, 0);
