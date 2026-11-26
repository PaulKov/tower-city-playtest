// Хранилище ассетов: манифест, пакеты, кэш файлов и значений, выдача и авторы.
import { parseManifest, packAssets, assetFiles, packFiles } from './manifest.js';
import { createLoader, LoadError } from './loader.js';
import { decodeAsset } from './decoders.js';

const MANIFEST = 'manifest.json';

// Лицензия ассетов, сделанных в проекте: на экран «Авторы» они не попадают (благодарить некого,
// а ссылка на закрытый репозиторий была бы мёртвой); в assets/CREDITS.md запись остаётся.
export const OWN_LICENSE = 'own';

// Дублируется в tools/assets/build.py (CREDITS.md); tests/test_build.py сверяет title и url.
export const CODE_CREDITS = [
  { title: 'three.js', author: 'three.js authors', license: 'MIT', url: 'https://github.com/mrdoob/three.js' },
  { title: 'meshoptimizer', author: 'Arseny Kapoulkine', license: 'MIT', url: 'https://github.com/zeux/meshoptimizer' },
  { title: 'Nunito', author: 'The Nunito Project Authors', license: 'OFL-1.1', url: 'https://github.com/googlefonts/nunito' },
];

export class AssetStore {
  constructor({ base, version = 'full', fetch = (...a) => globalThis.fetch(...a), decode = decodeAsset, loader, warn = (...a) => console.warn(...a), timeout = 20000 } = {}) {
    this.base = base;
    this.version = version;
    this._fetch = fetch;
    this._decode = decode;
    this._loader = loader ?? createLoader({ fetch, base });
    this._warn = warn;
    this._timeout = timeout;
    this._manifest = null;
    this._manifestP = null;
    this._fileP = new Map();    // файл → промис буфера (пока качается)
    this._buffers = new Map();  // файл → ArrayBuffer (скачан, ассет ещё не декодирован)
    this._progress = new Map(); // файл → {loaded, listeners}
    this._assetP = new Map();   // id → промис значения (пока грузится)
    this._values = new Map();   // id → декодированное значение
  }

  get manifest() { return this._manifest; }

  loadManifest() {
    this._manifestP ??= this._fetchManifest().then(
      (m) => { this._manifest = m; return m; },
      (e) => { this._manifestP = null; throw e; },
    );
    return this._manifestP;
  }

  async _fetchManifest() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._timeout);
    let text;
    try {
      const res = await this._fetch(new URL(MANIFEST, this.base).href, { cache: 'no-cache', signal: ctrl.signal });
      if (!res.ok) {
        // Fire-and-forget: the error body is not needed; free the connection (same approach as loader.js).
        try { res.body?.cancel()?.catch(() => {}); } catch { /* ignore */ }
        try { ctrl.abort(); } catch { /* ignore */ }
        throw new LoadError('http', MANIFEST, { status: res.status });
      }
      text = await res.text();
    } catch (e) {
      if (e instanceof LoadError) throw e;
      if (e?.name === 'AbortError' || e instanceof TypeError) throw new LoadError('network', MANIFEST, { cause: e });
      throw e;
    } finally {
      clearTimeout(timer);
    }
    try {
      return parseManifest(JSON.parse(text));
    } catch (e) {
      throw new LoadError('decode', MANIFEST, { cause: e });
    }
  }

  _entry(file) {
    let e = this._progress.get(file);
    if (!e) { e = { loaded: 0, listeners: new Set() }; this._progress.set(file, e); }
    return e;
  }

  _report(file, n) {
    const e = this._entry(file);
    if (n <= e.loaded) return;
    e.loaded = n;
    for (const l of e.listeners) l();
  }

  _listen(file, cb) {
    const e = this._entry(file);
    e.listeners.add(cb);
    return () => e.listeners.delete(cb);
  }

  _file(f, priority) {
    if (this._buffers.has(f.file)) return Promise.resolve(this._buffers.get(f.file));
    const pending = this._fileP.get(f.file);
    if (pending) {
      if (priority === 'high') this._loader.promote(f.file);
      return pending;
    }
    const p = this._loader.load(f.file, f.bytes, { priority, onProgress: (n) => this._report(f.file, n) })
      .then((buf) => {
        this._buffers.set(f.file, buf);
        this._report(f.file, buf.byteLength);
        return buf;
      })
      .finally(() => { if (this._fileP.get(f.file) === p) this._fileP.delete(f.file); });
    p.catch(() => {});
    this._fileP.set(f.file, p);
    return p;
  }

  _asset(id, priority) {
    if (this._values.has(id)) return Promise.resolve(this._values.get(id));
    const files = assetFiles(this._manifest, id, this.version);
    const pending = this._assetP.get(id);
    if (pending) {
      if (priority === 'high') for (const f of files) if (this._fileP.has(f.file)) this._loader.promote(f.file);
      return pending;
    }
    const p = Promise.all(files.map((f) => this._file(f, priority))).then(async (bufs) => {
      const byRole = Object.fromEntries(files.map((f, i) => [f.role, bufs[i]]));
      const value = await this._decode(id, this._manifest.assets[id], byRole);
      this._values.set(id, value);
      for (const f of files) this._buffers.delete(f.file);
      return value;
    });
    p.then(
      () => { this._assetP.delete(id); },
      () => { if (this._assetP.get(id) === p) this._assetP.delete(id); },
    );
    this._assetP.set(id, p);
    return p;
  }

  async ensure(packs, onProgress) {
    const m = await this.loadManifest();
    const files = packFiles(m, packs, this.version);
    const total = files.reduce((s, f) => s + f.bytes, 0);
    let last = -1;
    const emit = () => {
      const sum = files.reduce((s, f) => s + Math.min(this._progress.get(f.file)?.loaded ?? 0, f.bytes), 0);
      if (sum > last) { last = sum; onProgress(sum, total); }
    };
    const offs = onProgress ? files.map((f) => this._listen(f.file, emit)) : [];
    try {
      if (onProgress) emit();
      // Сцена может восстановиться после ошибки отдельной модели, используя остальные готовые ресурсы.
      const loaded = await Promise.allSettled(packAssets(m, packs).map((id) => this._asset(id, 'high')));
      const failed = loaded.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    } finally {
      for (const off of offs) off();
    }
  }

  async background(packs) {
    let m;
    try { m = await this.loadManifest(); } catch (e) { this._safeWarn('assets: манифест не загружен', e); return; }
    for (const id of packAssets(m, packs)) {
      try { await this._asset(id, 'low'); } catch (e) { this._safeWarn(`assets: ${id} не загружен`, e); await this._settleAsset(id); }
    }
  }

  // background() never rejects: a failing logger must not break loading.
  _safeWarn(...args) {
    try { this._warn(...args); } catch { /* ignore */ }
  }

  // _asset() is fail-fast (Promise.all), so the other files of a failed asset may still be downloading.
  // Wait for them so that background() does not overlap the next asset with leftovers of the failed one.
  async _settleAsset(id) {
    try {
      const pending = assetFiles(this._manifest, id, this.version).map((f) => this._fileP.get(f.file)).filter(Boolean);
      await Promise.allSettled(pending);
    } catch { /* ignore */ }
  }

  ready(packs) {
    if (!this._manifest) return false;
    return packAssets(this._manifest, packs).every((id) => this._values.has(id));
  }

  get(id) {
    if (!this._values.has(id)) throw new Error(`ассет ${id} не загружен`);
    return this._values.get(id);
  }

  tryGet(id) {
    return this._values.has(id) ? this._values.get(id) : null;
  }

  credits() {
    const listed = this._manifest ? Object.values(this._manifest.credits).filter((c) => c.license !== OWN_LICENSE) : [];
    return listed.sort((a, b) => a.title.localeCompare(b.title, 'ru')).concat(CODE_CREDITS);
  }
}
