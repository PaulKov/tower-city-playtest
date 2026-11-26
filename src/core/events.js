// Простая шина событий.

export class Emitter {
  constructor() {
    this._map = new Map();
  }

  on(type, fn) {
    let set = this._map.get(type);
    if (!set) this._map.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this._map.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  clear() {
    this._map.clear();
  }
}
