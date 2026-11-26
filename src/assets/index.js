// Общий экземпляр хранилища ассетов игры.
import { AssetStore } from './store.js';
import { pickVersion } from './manifest.js';

export const assetVersion = pickVersion({
  param: new URLSearchParams(location.search).get('assets'),
  coarse: matchMedia('(pointer: coarse)').matches,
});

export const assets = new AssetStore({ base: new URL('../../assets/', import.meta.url).href, version: assetVersion });
