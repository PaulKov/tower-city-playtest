// Загрузчик файлов ассетов: очередь с приоритетом, прогресс, таймаут простоя, повторы. Без three и DOM.
export class LoadError extends Error {
  constructor(reason, file, { status = 0, cause } = {}) {
    super(`${reason}: ${file}${status ? ` (${status})` : ''}`, cause === undefined ? undefined : { cause });
    this.name = 'LoadError';
    this.reason = reason;
    this.file = file;
    this.status = status;
  }
}

const retryable = (e) => e.reason === 'network' || e.reason === 'idle' || (e.reason === 'http' && e.status >= 500);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out.buffer;
}

export function createLoader({ fetch: doFetch = (...a) => globalThis.fetch(...a), base, concurrency = 4, retryDelays = [500, 1500], idleMs = 20000 } = {}) {
  const jobs = new Map();
  const high = [];
  const low = [];
  let active = 0;

  // state.listenerFailed — исключение слушателя прогресса: пробрасывается как есть, без классификации и повтора.
  async function fetchOnce(job, state) {
    const ctrl = new AbortController();
    let idle = false;
    let timer = 0;
    let res = null;
    let reader = null;
    let listenerError;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { idle = true; ctrl.abort(); }, idleMs); };
    const report = (n) => {
      try { job.report(n); } catch (e) { listenerError = e; state.listenerFailed = true; throw e; }
    };
    // Fire-and-forget: очистка не должна ни подменять, ни задерживать исходное исключение.
    const dispose = () => {
      try { (reader ? reader.cancel() : res?.body?.cancel())?.catch(() => {}); } catch { /* ignore */ }
      try { ctrl.abort(); } catch { /* ignore */ }
    };
    try {
      arm();
      res = await doFetch(job.url, { signal: ctrl.signal });
      if (!res.ok) throw new LoadError('http', job.file, { status: res.status });
      if (!res.body) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength !== job.bytes) throw new LoadError('size', job.file);
        report(buf.byteLength);
        return buf;
      }
      reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        got += value.byteLength;
        if (got > job.bytes) throw new LoadError('size', job.file);
        chunks.push(value);
        report(got);
      }
      if (got !== job.bytes) throw new LoadError('size', job.file);
      return concat(chunks, got);
    } catch (e) {
      // Классификация — до очистки: abort() из dispose не может превратить ошибку в idle/network.
      let out = e;
      if (state.listenerFailed) out = listenerError;
      else if (idle) out = new LoadError('idle', job.file, { cause: e });
      else if (e instanceof LoadError) out = e;
      else if (e?.name === 'AbortError' || e instanceof TypeError) out = new LoadError('network', job.file, { cause: e });
      dispose();
      throw out;
    } finally {
      clearTimeout(timer);
    }
  }
  async function runJob(job) {
    for (let attempt = 0; ; attempt++) {
      const state = { listenerFailed: false };
      try {
        return await fetchOnce(job, state);
      } catch (e) {
        if (state.listenerFailed || !(e instanceof LoadError) || !retryable(e) || attempt >= retryDelays.length) throw e;
        await sleep(retryDelays[attempt]);
      }
    }
  }

  function finish(job) {
    active--;
    if (jobs.get(job.file) === job) jobs.delete(job.file);
  }

  function pump() {
    while (active < concurrency && (high.length || low.length)) {
      const job = high.length ? high.shift() : low.shift();
      active++;
      runJob(job).then(
        (buf) => { finish(job); job.resolve(buf); pump(); },
        (err) => { finish(job); job.reject(err); pump(); },
      );
    }
  }

  function promote(file) {
    const job = jobs.get(file);
    const i = job ? low.indexOf(job) : -1;
    if (i >= 0) { low.splice(i, 1); high.push(job); }
  }

  function load(file, bytes, { onProgress, priority = 'high' } = {}) {
    let job = jobs.get(file);
    if (!job) {
      job = {
        file, bytes, url: new URL(file, base).href, loaded: 0, listeners: new Set(),
        report(n) {
          if (n <= this.loaded) return;
          this.loaded = n;
          for (const l of this.listeners) l(n, this.bytes);
        },
      };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      jobs.set(file, job);
      (priority === 'high' ? high : low).push(job);
    } else if (priority === 'high') {
      promote(file);
    }
    if (onProgress) {
      job.listeners.add(onProgress);
      if (job.loaded > 0) onProgress(job.loaded, job.bytes);
    }
    pump();
    return job.promise;
  }

  return { load, promote, get active() { return active; } };
}
