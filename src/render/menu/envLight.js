// Слой света окружения меню (спецификация «Меню: переработка окружения» §2.1). Глобальный свет сцены меню —
// свет башни и жителей (как в снимке CURRENT); окружение (земля, улицы, растения) усиливает прямой свет, ослабляет
// рассеянный и поднимает контраст своими множителями в шейдере — башня от этого не меняется. Земля и улицы ещё читают
// запечённые тени окружения (§2.4): мягкие тени крон и кустов и окклюзию у их подножия. Воздушная перспектива
// окружения (§2.6) — своя дымка по расстоянию поверх цвета: туман сцены (и с ним башня) остаётся как в CURRENT.
import * as THREE from 'three';

const WHITE = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** Общие uniforms слоя: прямой свет (солнце и заполняющий) ×uEnvSun с оттенком uEnvTint, рассеянный (небо, карта
 * окружения) ×uEnvAmb, контраст окружения в линейном цвете вокруг серого 0,18 — uEnvContrast; uEnvShade — маска
 * запечённых теней (r — тень от солнца, g — окклюзия) на квадрате ±uEnvShadeHalf м вокруг центра; uEnvHaze — цвет
 * дымки (линейный), uEnvHazeRange — начало и конец по расстоянию от камеры (м) и наибольшая доля; uEnvSat —
 * насыщенность окружения (глобальная цветокоррекция кадра — как в CURRENT); uEnvGroundSun и uEnvGroundAmb — свой
 * прямой (цвет×сила) и рассеянный свет газона (ENV_GROUND): тёплое солнце и глубокие тени, как у референса.
 * uEnvHazeK — доля дымки (у листвы своя, menuFlora: деревья на дальних холмах зеленее склонов); uEnvHazeFar и
 * uEnvHazeFarRange — второй ярус дымки у края чаши: дальние гряды голубые, как горы референса. */
export const ENV_UNIFORMS = {
  uEnvSun: { value: 1.2 },
  uEnvTint: { value: new THREE.Vector3(1, 1, 1) },
  uEnvAmb: { value: 0.66 },
  uEnvContrast: { value: 1.06 },
  uEnvSat: { value: 1 },
  uEnvShade: { value: WHITE },
  uEnvShadeHalf: { value: 100 },
  /** Дальняя маска теней (рощи и ели на холмах) на квадрате ±uEnvShadeFarHalf м — только у рельефа (ENV_FOREST). */
  uEnvShadeFar: { value: WHITE },
  uEnvShadeFarHalf: { value: 400 },
  uEnvGroundSun: { value: new THREE.Vector3(1, 1, 1) },
  uEnvGroundAmb: { value: 1 },
  /** Оттенок рассеянного света газона в тени (ENV_GROUND и ENV_SHADE): тень прохладная, изумрудная, а не оливковая. */
  uEnvShadeCool: { value: new THREE.Vector3(1, 1, 1) },
  /** Небесный свет в тени газона, не умноженный на альбедо: у травы почти нет синего, и без него тень оливковая. */
  uEnvShadeAdd: { value: new THREE.Vector3(0, 0, 0) },
  uEnvHazeK: { value: 1 },
  uEnvHazeFar: { value: new THREE.Vector3(1, 1, 1) },
  uEnvHazeFarRange: { value: new THREE.Vector3(450, 650, 0) },
  uEnvHaze: { value: new THREE.Vector3(1, 1, 1) },
  uEnvHazeRange: { value: new THREE.Vector3(100, 400, 0) },
  /** Начало мягкого колена яркости окружения (линейный, под порогом bloom 1,0). */
  uEnvKnee: { value: 0.9 },
  /** Направление на солнце окружения (мир) и цвет дымки против солнца (rgb) с силой (w): даль к солнцу светлее и теплее. */
  uEnvSunW: { value: new THREE.Vector3(0, 1, 0) },
  uEnvHazeSun: { value: new THREE.Vector4(1, 1, 1, 0) },
  /** Лес на грядах (ENV_FOREST): начало и конец появления по расстоянию от центра (м) и глубина пятен куп. */
  uEnvForest: { value: new THREE.Vector3(380, 470, 1) },
};

const DECL = `
uniform float uEnvSun;
uniform vec3 uEnvTint;
uniform float uEnvAmb;
uniform float uEnvContrast;
uniform float uEnvSat;
uniform vec3 uEnvHaze;
uniform vec3 uEnvHazeRange;
uniform float uEnvHazeK;
uniform vec3 uEnvHazeFar;
uniform vec3 uEnvHazeFarRange;
uniform float uEnvKnee;
uniform vec3 uEnvSunW;
uniform vec4 uEnvHazeSun;
uniform vec3 uEnvForest;
#ifdef ENV_SHADE
uniform sampler2D uEnvShade;
uniform float uEnvShadeHalf;
varying vec2 vEnvXZ;
#endif
#if defined( ENV_SHADE ) && defined( ENV_FOREST )
uniform sampler2D uEnvShadeFar;
uniform float uEnvShadeFarHalf;
#endif
#ifdef ENV_FOREST
float envHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float envNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( envHash( i ), envHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( envHash( i + vec2( 0.0, 1.0 ) ), envHash( i + 1.0 ), f.x ), f.y );
}
#endif
#ifdef ENV_GROUND
uniform vec3 uEnvGroundSun;
uniform float uEnvGroundAmb;
uniform vec3 uEnvShadeCool;
uniform vec3 uEnvShadeAdd;
#endif
`;
const LIGHT = `
reflectedLight.directDiffuse *= uEnvSun * uEnvTint;
reflectedLight.directSpecular *= uEnvSun * uEnvTint;
reflectedLight.indirectDiffuse *= uEnvAmb;
reflectedLight.indirectSpecular *= uEnvAmb;
#ifdef ENV_SHADE
vec2 envShade = texture2D( uEnvShade, vEnvXZ / ( 2.0 * uEnvShadeHalf ) + 0.5 ).rg;
#ifdef ENV_FOREST
envShade *= texture2D( uEnvShadeFar, vEnvXZ / ( 2.0 * uEnvShadeFarHalf ) + 0.5 ).rg; // рощи и ели на холмах стоят на склоне
#endif
reflectedLight.directDiffuse *= envShade.r;
reflectedLight.directSpecular *= envShade.r;
reflectedLight.indirectDiffuse *= envShade.g;
#endif
#ifdef ENV_GROUND
reflectedLight.directDiffuse *= uEnvGroundSun;
reflectedLight.directSpecular *= uEnvGroundSun;
reflectedLight.indirectDiffuse *= uEnvGroundAmb;
#ifdef ENV_SHADE
// окклюзия у корней гасит и прямой свет (контактная тень под кустами); тень газона прохладная, как у референса —
// и в запечённой тени, и в тени из карты теней (envSm, GROUND_SHADOW): тень башни на газоне того же цвета
{
  float envR = envShade.r * mix( ENV_SM_FLOOR, 1.0, envSm );
  reflectedLight.directDiffuse *= mix( 1.0, envShade.g, 0.6 );
  reflectedLight.indirectDiffuse *= mix( uEnvShadeCool, vec3( 1.0 ), envR );
  reflectedLight.indirectDiffuse += uEnvShadeAdd * ( 1.0 - envR );
}
#endif
#endif
`;
/** Доля прямого света газона в тени из карты теней: как в ядре запечённой тени кроны (40/255, menuWorld bakeShade), а не ноль. */
const ENV_SM_FLOOR = 0.16;
// Строка тени направленного света в lights_fragment_begin three r186 (свет с тенью у меню один — солнце)
const DIR_SHADOW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], '
  + 'directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, '
  + 'directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
/**
 * Газон (ENV_GROUND): доля тени из карты теней сохраняется в envSm, прямой свет в ней гаснет до ENV_SM_FLOOR, а не до
 * нуля, — тень башни на газоне светлая и зелёная, как тени крон, а не почти чёрно-бирюзовая. Форма и край тени — те же.
 */
const GROUND_SHADOW = (() => {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.split(DIR_SHADOW).length !== 2) throw new Error('menu env light patch: directional shadow line not found');
  const ground = chunk.replace(DIR_SHADOW, 'envSm = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], '
    + 'directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, '
    + 'directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;\ndirectLight.color *= mix( ENV_SM_FLOOR, 1.0, envSm );');
  return `#define ENV_SM_FLOOR ${ENV_SM_FLOOR.toFixed(2)}
float envSm = 1.0;
#ifdef ENV_GROUND
${ground}
#else
#include <lights_fragment_begin>
#endif
`;
})();
const GRADE = `
gl_FragColor.rgb = 0.18 * pow( max( gl_FragColor.rgb, vec3( 0.0 ) ) / 0.18, vec3( uEnvContrast ) );
gl_FragColor.rgb = mix( vec3( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), gl_FragColor.rgb, uEnvSat );
{ // мягкое колено яркости под порогом bloom (1,0, renderer.js): окружение почти не светится — белые цветы на солнце
  // без ореолов; до uEnvKnee цвет не меняется, выше — сжатие с сохранением оттенка
  float envL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float envO = max( envL - uEnvKnee, 0.0 );
  gl_FragColor.rgb *= ( envL - envO + envO / ( 1.0 + 10.0 * envO ) ) / max( envL, 1e-4 );
}
{ // дымка против солнца светлее и теплее (рассеяние вперёд): даль у солнца тонет в светлом мареве, как у референса
  float envG = max( dot( normalize( - vViewPosition ), normalize( ( viewMatrix * vec4( uEnvSunW, 0.0 ) ).xyz ) ), 0.0 );
  float envSunK = uEnvHazeSun.w * pow( envG, 5.0 );
  vec3 envHaze = mix( uEnvHaze, uEnvHazeSun.rgb, envSunK ), envHazeFar = mix( uEnvHazeFar, uEnvHazeSun.rgb, envSunK );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, envHaze, uEnvHazeK * uEnvHazeRange.z * smoothstep( uEnvHazeRange.x, uEnvHazeRange.y, length( vViewPosition ) ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, envHazeFar, uEnvHazeFarRange.z * smoothstep( uEnvHazeFarRange.x, uEnvHazeFarRange.y, length( vViewPosition ) ) );
}
#ifdef ENV_FOREST
{ // дальние гряды (за ~400 м) — лес поверх дымки: купы крон (~9 и ~25 м) темнее и светлее — сине-зелёные лесистые
  // хребты референса (под дымкой фактура склона пропадала, гряды сливались с небом)
  float envForest = smoothstep( uEnvForest.x, uEnvForest.y, length( vEnvXZ ) ) * uEnvForest.z;
  if ( envForest > 0.0 ) {
    float c = envNoise( vEnvXZ * 0.11 ) * 0.65 + envNoise( vEnvXZ * 0.04 + 7.3 ) * 0.35;
    gl_FragColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 0.78, 0.85, 0.88 ), vec3( 1.03 ), c ), envForest );
  }
}
#endif
`;
const VS_DECL = `
#ifdef ENV_SHADE
varying vec2 vEnvXZ;
#endif
`;
// у экземпляров (травинки газона) место в мире — с матрицей экземпляра: без неё маска читалась в начале координат
// модели, и травинки в тени крон светились, как на солнце
const VS_POS = `
#ifdef ENV_SHADE
#ifdef USE_INSTANCING
vEnvXZ = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xz;
#else
vEnvXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
#endif
#endif
`;

function swap(src, from, to) {
  if (!src.includes(from)) throw new Error('menu env light patch: no ' + from);
  return src.replace(from, to);
}

/** Патч шейдера освещаемого материала окружения (Lambert или Standard); вызывать в onBeforeCompile. */
export function envLightPatch(shader) {
  Object.assign(shader.uniforms, ENV_UNIFORMS);
  let vs = swap(shader.vertexShader, '#include <common>', '#include <common>' + VS_DECL);
  shader.vertexShader = swap(vs, '#include <begin_vertex>', '#include <begin_vertex>' + VS_POS);
  let fs = swap(shader.fragmentShader, '#include <common>', '#include <common>' + DECL);
  fs = swap(fs, '#include <lights_fragment_begin>', GROUND_SHADOW);
  fs = swap(fs, '#include <lights_fragment_end>', '#include <lights_fragment_end>' + LIGHT);
  shader.fragmentShader = swap(fs, '#include <opaque_fragment>', '#include <opaque_fragment>' + GRADE);
}

/**
 * Материал окружения: свой onBeforeCompile (если был) и затем слой света. shade — земля и улицы читают запечённые
 * тени окружения; ground — газон со своим светом (uEnvGroundSun, uEnvGroundAmb). Ключ программы — свой у материала.
 */
export function envLit(m, { shade = false, ground = false, forest = false } = {}) {
  // окружение меню — своя дымка (uEnvHaze): туман сцены (для башни) поверх неё выбеливал холмы вдвое
  m.fog = false;
  const prev = m.onBeforeCompile;
  if (shade) m.defines = { ...(m.defines || {}), ENV_SHADE: '' };
  if (ground) m.defines = { ...(m.defines || {}), ENV_GROUND: '' };
  if (forest && shade) m.defines = { ...(m.defines || {}), ENV_FOREST: '' };
  m.onBeforeCompile = function envLitCompile(shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    envLightPatch(shader);
  };
  return m;
}
