import { studyOpen, studyStart } from './study.js';

const params = new URLSearchParams(location.search);
const mode = ['district', 'cargo'].includes(params.get('mode')) ? params.get('mode') : 'slice';
const city = params.get('city') === 'harbor' ? 'harbor' : 'valley';
const tabs = document.querySelectorAll('[data-mode]');
const panel = document.getElementById('selection');
const building = document.getElementById('building');
const cityName = { valley: 'Солнечная долина', harbor: 'Морская гавань' };

function address(nextMode, nextCity) {
  const url = new URL(location.href);
  url.searchParams.set('mode', nextMode);
  url.searchParams.set('city', nextCity);
  return url;
}

function setLinks(currentCity) {
  for (const tab of tabs) {
    tab.href = address(tab.dataset.mode, currentCity);
    if (tab.dataset.mode === mode) tab.setAttribute('aria-current', 'page');
  }
}
setLinks(city);
document.title = document.querySelector('[aria-current="page"]').textContent + ' · Башня';
document.body.classList.toggle('harbor', city === 'harbor');

async function openComparison() {
  const key = 'tower.stand.v1.' + mode + '.' + city;
  let state = {};
  try {
    state = JSON.parse(sessionStorage.getItem(key)) || {};
  } catch {
    /* В приватном окне используем память страницы. */
  }
  function save() {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* Хранилище недоступно. */
    }
  }
  for (const name of Object.keys(cityName)) {
    const button = document.getElementById(name);
    button.disabled = false;
    button.setAttribute('aria-pressed', String(name === city));
    button.onclick = () => {
      if (name !== city) location.assign(address(mode, name));
    };
  }
  const show =
    mode === 'district'
      ? (await import('./district.js')).showDistrict
      : (await import('./cargo.js')).showCargo;
  let cleanup;
  function showPanel(focus = false) {
    building.hidden = true;
    panel.hidden = false;
    panel.replaceChildren();
    cleanup = show({ city, panel, state, save, build });
    studyOpen(mode, city);
    if (focus) {
      const heading = panel.querySelector('h1,h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }
  async function enterBuild() {
    cleanup?.();
    cleanup = null;
    panel.hidden = true;
    building.hidden = false;
    const notice = document.getElementById('notice');
    notice.textContent = 'Готовим стройплощадку…';
    document.getElementById('mission').textContent = state.construction.label;
    document.getElementById('location').textContent = cityName[city];
    try {
      const { startConstruction } = await import('./construction.js');
      await startConstruction({
        city,
        mode,
        job: state.construction,
        save,
        finish(result) {
          state.studyLastRun = state.construction.studyRun;
          delete state.construction;
          state.result = result;
          save();
          showPanel(true);
        },
      });
      studyOpen(mode, city);
    } catch (error) {
      notice.textContent = 'Не удалось открыть 3D-стройку. Можно повторить загрузку или вернуться к выбору.';
      building.classList.add('build-error');
      const retry = document.getElementById('drop');
      retry.hidden = false;
      retry.disabled = false;
      retry.textContent = 'Повторить загрузку';
      retry.onclick = () => location.reload();
      const back = document.getElementById('continue-build');
      back.textContent = 'К выбору';
      back.hidden = false;
      back.onclick = () => {
        delete state.construction;
        save();
        location.reload();
      };
      console.error(error);
    }
  }
  function build(options) {
    state.construction = { ...options, drops: [], studyRun: studyStart(mode, city, state.studyLastRun) };
    save();
    enterBuild();
  }
  if (state.construction) await enterBuild();
  else showPanel();
}
if (mode === 'slice') {
  building.hidden = false;
  import('./game.js');
  // Игрок может сменить город как в шапке, так и на экране готового дома.
  document.addEventListener('click', () =>
    setLinks(new URLSearchParams(location.search).get('city') || city),
  );
} else {
  openComparison().catch((error) => {
    panel.hidden = false;
    panel.textContent = 'Не удалось открыть режим. Обновите страницу.';
    console.error(error);
  });
}
