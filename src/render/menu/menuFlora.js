// Растения главного меню (спецификация «Меню по референсу» §3.2, §6): деревья и кусты с гроздьями на поверхности кроны,
// ели, импостеры деревьев, цветы и трава — цилиндрические спрайты одним вызовом отрисовки; камни — меш.
// Текстуры из Blender: общий с городами цветовой атлас (альбедо × окклюзия) и нормали меню (y в яркости, x в альфе)
// (tools/art). До загрузки атласа растения скрыты. У ближних лиственных деревьев детализация
// следует за камерой; остальные группы и дальние импостеры задаются раскладкой меню.
import * as THREE from 'three';
import { customMat } from '../materials.js';
import { BROADLEAF_BARK, broadleafBarkTexture, FOLIAGE_WIND, VEG_UNIFORMS } from '../vegetation/material.js';
import { createRng } from '../../core/rng.js';
import { FLORA } from './floraData.js';
import { menuSpruceDetail } from './menuSpruce.js';
import { envLightPatch, envLit } from './envLight.js';

/** Режимы вершин: сплошная геометрия (ствол, камень), листовая карточка на ветви, цилиндрический спрайт. */
export const MODE = { solid: 0, lobe: 1, sprite: 2 };
const NO_DOME = [0, 0, 0, 0];
// Высота кроны на опорном кадре 1080 px, где становятся различимы тонкие развилки.
const TREE_FOCUS_FROM = 480, TREE_FOCUS_TO = 640;

/** Альфа растений не пишется в буфер кадра: alphaToCoverage берёт покрытие из альфы фрагмента, а в буфере остаётся
 * альфа фона (1) — дальше по цепочке проходов края карточек не смешиваются со светлым фоном (белые швы). Маска
 * кэша three — «всё пишется» (setMask(true)): материал растения её не меняет, и маска без альфы доживает до отрисовки. */
export function noAlphaBefore(renderer) {
  renderer.state.buffers.color.setMask(true);
  renderer.getContext().colorMask(true, true, true, false);
}
export function noAlphaAfter(renderer) {
  renderer.getContext().colorMask(true, true, true, true);
}
/** Половина стороны спрайта шапки в радиусах шапки: кадр рендера 2,3 на радиус 1 (tools/art/blender_sprites.py). */
export const LOBE_FRAME = 1.15;
const LOBE_SPRITES = ['lobeA', 'lobeB', 'lobeC', 'lobeD'];
const FINE_SPRITES = ['lobeE', 'lobeF'];
const SHOOT_SPRITES = ['sprayA', 'sprayB', 'sprayC'];
/** Общие uniforms материала растений меню: атлас нормалей, доля нормали кроны, сила окклюзии. */
export const FLORA_UNIFORMS = {
  uFloraNormal: { value: null },
  uHullMix: { value: 1.0 }, // вес нормали карточки против нормали грозди (бугры размером с гроздь, как у референса)
  uFloraAmb: { value: 1.7 },
  uFloraWrap: { value: 0.4 }, // свет заворачивает за купол: тень в кроне мягкая, не чёрная (референс дерева)
  uFloraHazeK: { value: 1 }, // доля дымки окружения у растений (envLight uEnvHazeK)
  // ключевой свет листвы от камеры (вид): доля uFloraKey смешивает солнце окружения с направлением uFloraKeyDir
  // в пространстве вида — кроны освещены спереди-слева-сверху с любой стороны облёта, как на референсе
  uFloraKey: { value: 0 },
  uFloraKeyDir: { value: new THREE.Vector3(-0.5, 0.62, 0.6).normalize() },
  uFloraSpriteSat: { value: 1 }, // насыщенность спрайтов (цветы яркие, как у референса; envLight uEnvSat)
  uFloraMeshSat: { value: 1 }, // насыщенность листвы крон и кустов: своя, не общая окружения — листва сочнее газона и холмов
  uFloraMeshSatLite: { value: 1 }, // то же у lite (medium, low): Lambert без карты нормалей бледнее, своя насыщенность
  uDomeMix: { value: 2.0 }, // вес нормали сферы купола против нормали карточки и грозди: купол лепится целиком, карточка — нет
  uBarkBump: { value: 0.018 }, // глубина рельефа коры (бамп): мягкие борозды, мультяшный ствол
  // солнце окружения (menuWorld LOOK.envSunDir) и его цвет×сила: прямой свет листвы — свой, не глобальный
  uFloraSun: { value: new THREE.Vector3(-0.73, 0.67, -0.14).normalize() },
  uFloraTrans: { value: new THREE.Vector2(0.35, 4) }, // просвечивание листвы против солнца: сила и острота (степень)
  uFloraHazeKSprite: { value: 0.85 }, // доля дымки у спрайтов (дальние рощи, ели): как у земли — рощи не «висят» над склоном
  uFloraLitPow: { value: 1.8 }, // острота лимонного света: лимонный — макушка купола к солнцу
  uFloraKnee: { value: 1.0 }, // колено яркости листвы: макушки светлые, но под порогом bloom (с 1,4 светились ореолом и выцветали в кремовый)
  uFloraAoLo: { value: new THREE.Vector2(0.88, 0.66) }, // низ купола: у мелких куполов (кусты; светлее — низ и глубина кустов вблизи не уходят в черноту) и у крупных (кроны)
  uFloraRim: { value: new THREE.Vector4(1.6, 1.4, 0.5, 0.6) }, // светящаяся кромка купола к солнцу: цвет (множитель листа) и сила
  uFloraSunColor: { value: new THREE.Vector3(3.1, 2.9, 2.5) },
  // освещённая листва жёлто-лаймовая, теневая — холоднее (оттенок крон референса)
  uLitTint: { value: new THREE.Vector3(2.3, 1.55, 0.15) }, // лимонные блики (красный выше зелёного, синего почти нет: оттенок ~108°, как у референса) — макушка купола к солнцу
  uShadeTint: { value: new THREE.Vector3(0.82, 1.04, 1.45) }, // тень в кроне — изумрудная, холодная
};

const BARK = new THREE.Color('#a97a55'), BARK_DARK = new THREE.Color('#684935');
/** Кора в глубине кроны: тёмная, с зеленью от листвы (линейный цвет, как BUSH_CORE). */
const BARK_DEEP = new THREE.Color(0.075, 0.09, 0.035);
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _e = new THREE.Euler();

// ---------------------------------------------------------------- материал

function swap(src, from, to) {
  if (!src.includes(from)) throw new Error('menu flora shader patch: no ' + from);
  return src.replace(from, to);
}

const VS_DECL = `
#define LOBE_SOFT 0.1
attribute vec2 aCorner;
attribute float aMode;
attribute float aRot;
attribute float aFlex;
attribute float aLift;
#ifndef FLORA_SPRITES
attribute float aTreeExtent;
#endif
varying float vTreeSplit;
#ifdef FLORA_SPRITES
attribute vec4 aRect;
attribute vec3 aHalf;
#endif
attribute vec4 aDome;
${FOLIAGE_WIND}
varying vec3 vDomeV;
varying float vDomeR;
varying vec3 vBark;
varying float vFloraMode;
#if !defined( FLORA_SPRITES ) && !defined( FLORA_LITE )
varying vec3 vLeafTangent;
#endif
varying float vFloraBias;
varying float vFloraUp;
varying float vFloraFlip;
`;
// Карточку крепим в локальной плоскости поверхности ещё до поворота экземпляра. Облёт меняет
// перспективу и открывает соседние листья. Дальние спрайты сохраняют вертикаль мира и обращены к камере.
const PROJECT = `
vec4 mvPosition = vec4( transformed, 1.0 );
vTreeSplit = 0.0;
#ifndef FLORA_SPRITES
  #ifdef USE_INSTANCING
  if (aTreeExtent != 0.0) {
    float radius = abs(aTreeExtent) / 16.0;
    vec3 center = (modelMatrix * instanceMatrix * vec4(0.0,radius,0.0,1.0)).xyz;
    float pixelSize = 1080.0 * projectionMatrix[1][1] * radius * length(instanceMatrix[0].xyz) / max(0.001,distance(center,cameraPosition));
    float share = smoothstep(${TREE_FOCUS_FROM}.0,${TREE_FOCUS_TO}.0,pixelSize);
    vTreeSplit = aTreeExtent > 0.0 ? share-1.0 : share;
  }
  #endif
#endif
#ifdef FLORA_SPRITES
mvPosition = vec4( 0.0, 0.0, 0.0, 1.0 );
#else
if ( aMode > 0.5 ) {
  vec3 leafRight = abs( normal.y ) > 0.9999 ? vec3( 1.0, 0.0, 0.0 ) : normalize( vec3( normal.z, 0.0, -normal.x ) );
  vec3 leafUp = cross( normal, leafRight );
  float cs = cos( aRot ), sn = sin( aRot );
  vec3 tangent = cs * leafRight + sn * leafUp;
  mvPosition.xyz += aCorner.x * tangent + aCorner.y * ( cs * leafUp - sn * leafRight ) + aLift * normal;
#ifndef FLORA_LITE
#ifdef USE_INSTANCING
  tangent = mat3( instanceMatrix ) * tangent;
#endif
  vLeafTangent = normalize( mat3( modelViewMatrix ) * tangent );
#endif
}
#endif
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
float floraScale = length( instanceMatrix[ 0 ].xyz );
vec2 floraAt = ( modelMatrix * instanceMatrix[ 3 ] ).xz;
#else
float floraScale = 1.0;
vec2 floraAt = modelMatrix[ 3 ].xz;
#endif
mvPosition = modelViewMatrix * mvPosition;
float branchBend = 0.18 * aFlex * aFlex * branchPressure( floraAt );
float bend = branchBend;
#ifdef FLORA_SPRITES
// У цветка и дальней ели разная высота, нижний край обоих закреплён у земли.
bend *= min( 2.0, aHalf.y * 0.35 );
#elif defined( FLORA_WIND )
// Нижний край текстуры содержит кончики листьев; верхний остаётся прикреплён к ветви.
if ( aMode > 0.5 ) bend += max( 0.0, -aCorner.y ) * leafFlutter( floraAt, position );
#endif
vec3 windV = ( viewMatrix[ 0 ].xyz * uWind.x + viewMatrix[ 2 ].xyz * uWind.y ) * floraScale;
mvPosition.xyz += windV * bend;
vFloraMode = aMode;
vBark = vec3(aCorner, aRot); // у древесины — развёртка в метрах и возрастной профиль
#ifdef FLORA_SPRITES
{
  vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  vec3 rightV = normalize( cross( upV, vec3( 0.0, 0.0, 1.0 ) ) );
  mvPosition.xyz += ( rightV * position.x * abs( aHalf.x ) + upV * position.y * aHalf.y ) * floraScale;
  vFloraMode = 2.0;
  vFloraUp = aHalf.z < -1.0 ? 0.1 : aHalf.z;
  vTreeSplit = max(0.0, -1.0 - aHalf.z);
  vFloraFlip = aHalf.x < 0.0 ? -1.0 : 1.0; // отражённый спрайт (aHalf.x < 0): своя куртина, а не копия соседней
}
#endif
gl_Position = projectionMatrix * mvPosition;
{ // центр купола карточки в пространстве вида: нормаль купола в каждом пикселе (плавный свет через все карточки)
  vec4 domeC = vec4( aDome.xyz, 1.0 );
#ifdef USE_INSTANCING
  domeC = instanceMatrix * domeC;
#endif
  vDomeV = ( modelViewMatrix * domeC ).xyz + windV * branchBend;
  vDomeR = aDome.w * floraScale;
}
// листья резкие вблизи и мягче с расстоянием: в кадре меню крона читается клубами, а не чешуёй из мелких листьев
vFloraBias = aMode > 0.5 ? LOBE_SOFT + clamp( ( - mvPosition.z - 25.0 ) / 40.0, 0.0, 0.6 ) : 0.0;
#ifndef FLORA_SPRITES
vFloraUp = 0.0;
#endif
`;
const UV_SPRITE = `
#if defined( FLORA_SPRITES ) && defined( USE_MAP )
vMapUv = mix( aRect.xy, aRect.zw, vec2( aHalf.x < 0.0 ? 1.0 - uv.x : uv.x, uv.y ) );
#endif
`;
// Дальние спрайты (лес на холмах) мягче: сдвиг уровня мипмапа растёт с расстоянием, как воздушная дымка референса.
const FAR_BIAS = `
#ifdef FLORA_SPRITES
vFloraBias = clamp( ( - mvPosition.z - 70.0 ) / 120.0, 0.0, 0.8 ); // вдали кроны мягче, но не размытые пятна
#endif
`;
const FS_DECL = `
varying float vTreeSplit;
uniform sampler2D uFloraNormal;
uniform float uHullMix;
uniform float uFloraAmb;
uniform float uFloraWrap;
uniform float uFloraKey;
uniform vec3 uFloraKeyDir;
uniform vec3 uFloraSun;
uniform vec3 uFloraSunColor;
uniform vec3 uLitTint;
uniform vec3 uShadeTint;
uniform vec3 uSunDir;
uniform float uTrans;
uniform vec2 uFloraTrans;
uniform float uFloraLitPow;
uniform vec2 uFloraAoLo;
uniform vec4 uFloraRim;
varying float vFloraMode;
#if !defined( FLORA_SPRITES ) && !defined( FLORA_LITE )
varying vec3 vLeafTangent;
#endif
varying float vFloraBias;
varying float vFloraUp;
varying float vFloraFlip;
varying vec3 vDomeV;
varying float vDomeR;
varying vec3 vBark;
uniform float uDomeMix;
uniform float uBarkBump;
${BROADLEAF_BARK}
// ключевой свет — только вблизи (80–200 м): дальние деревья в дымке освещены солнцем окружения
vec3 floraSunView( float dist ) {
  float k = uFloraKey * ( 1.0 - smoothstep( 80.0, 200.0, dist ) );
  return normalize( mix( normalize( ( viewMatrix * vec4( uFloraSun, 0.0 ) ).xyz ), uFloraKeyDir, k ) );
}
`;
// Сплошные части (uv < 0) берут белый тексель. Альфа растёт с уровнем мипмапа: листва не «редеет» вдали.
const MAP = `
#ifdef USE_MAP
{
  vec4 floraTexel = texture( map, vMapUv, vFloraBias );
#if defined( FLORA_LITE ) && !defined( FLORA_SPRITES )
  if ( abs(vFloraMode) < 0.5 && vMapUv.x >= 0.0 ) {
    // Под внешними листьями та же фактура, в просветах — тень внутренней листвы.
    floraTexel = vec4( vec3( mix( 0.70, 0.42 + 1.65 * floraTexel.g, floraTexel.a ) ), 1.0 );
  }
#endif
  if ( vMapUv.x >= 0.0 && vFloraMode > 0.5 && vFloraMode < 1.5 ) {
    vec2 floraTs = vec2( textureSize( map, 0 ) );
    float floraLod = max( 0.0, 0.5 * log2( max( dot( dFdx( vMapUv * floraTs ), dFdx( vMapUv * floraTs ) ), dot( dFdy( vMapUv * floraTs ), dFdy( vMapUv * floraTs ) ) ) ) );
    floraTexel.a = clamp( floraTexel.a * ( 1.15 + 0.2 * floraLod ), 0.0, 1.0 ); // листья грозди не редеют вдали
    // край ячейки атласа (грозди — по сетке 0,25): на крупных уровнях мипмапа туда затекают соседние ячейки, усиление
    // альфы проявило бы их полосой по кромке карточки; листья до края ячейки не доходят
    vec2 floraCell = fract( vMapUv * 4.0 );
    floraTexel.a *= smoothstep( 0.02, 0.08, min( min( floraCell.x, 1.0 - floraCell.x ), min( floraCell.y, 1.0 - floraCell.y ) ) );
  }
  if ( vMapUv.x >= 0.0 ) diffuseColor *= floraTexel;
}
#endif
#ifdef FLORA_SPRITES
{ // воздушная перспектива растительности: дальние деревья бледнее, но не светлее — у референса роща на гребне темнее
  // склона под ней (светлеть их заставляет общая дымка окружения, uFloraHazeKSprite)
  float floraHaze = clamp( vFloraBias / 1.4, 0.0, 1.0 );
  float floraLum = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( floraLum ), 0.15 * floraHaze );
}
#endif
`;
// Порог альфы с alphaToCoverage: переход покрытия — 1,5 пикселя с центром на пороге. У three он начинается от порога
// и занимает один пиксель: при 4 выборках MSAA край листвы шёл лесенкой из почти двоичных ступеней.
const ALPHA_TEST = `
#ifdef FLORA_SPRITES
  if (vTreeSplit > 0.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715)))) < vTreeSplit) discard;
#else
  // Два уровня в полосе перехода занимают взаимодополняющие пиксели.
  if (vTreeSplit != 0.0) {
    float noise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy),vec2(0.06711056,0.00583715))));
    if (vTreeSplit < 0.0 ? noise >= 1.0 + vTreeSplit : noise < vTreeSplit) discard;
  }
#endif
#ifdef USE_ALPHATEST
#ifdef ALPHA_TO_COVERAGE
diffuseColor.a = clamp( ( diffuseColor.a - alphaTest ) / ( 1.5 * max( fwidth( diffuseColor.a ), 1e-4 ) ) + 0.5, 0.0, 1.0 );
if ( diffuseColor.a == 0.0 ) discard;
#else
if ( diffuseColor.a < alphaTest ) discard;
#endif
#endif
`;
const NORMAL = `
#ifdef USE_MAP
if ( vFloraMode > 0.5 && vMapUv.x >= 0.0 ) {
#ifdef FLORA_LITE
  vec2 nxy = vec2( 0.0 ); // lite (medium, low): без карты нормалей грозди — свет от шапки и кроны, выборкой меньше
  float nz = 1.0;
#else
  vec4 floraN = texture( uFloraNormal, vMapUv, vFloraBias );
  // на полупрозрачной кромке грозди нормаль — от шапки: наклонённые к небу края давали голубые швы карточек
  vec2 nxy = ( vec2( floraN.a, floraN.g ) * 2.0 - 1.0 ) * smoothstep( 0.55, 0.95, diffuseColor.a );
  float nz = sqrt( max( 0.0, 1.0 - dot( nxy, nxy ) ) );
#endif
  if ( vFloraMode < 1.5 ) {
#if !defined( FLORA_SPRITES ) && !defined( FLORA_LITE )
    normal = normalize( vLeafTangent * nxy.x + cross( normal, vLeafTangent ) * nxy.y + normal * ( nz + uHullMix ) );
#endif
    if ( vDomeR > 0.0 ) { // нормаль сферы купола в пикселе: гладкая светотень купола, как у референса; низ купола темнее
      vec3 floraDomeN = normalize( - vViewPosition - vDomeV );
      normal = normalize( floraDomeN * uDomeMix + normal );
      vec3 floraUpV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
      // низ купола глубже: купол лепится, как у референса дерева; у крупных куполов крон — сильнее («цветная капуста»)
      float floraAoLo = mix( uFloraAoLo.x, uFloraAoLo.y, smoothstep( 0.6, 1.0, vDomeR ) );
      diffuseColor.rgb *= floraAoLo + ( 1.0 - floraAoLo ) * smoothstep( -0.3, 0.8, dot( floraDomeN, floraUpV ) );
    }
  } else {
    vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
    vec3 rightV = normalize( cross( upV, vec3( 0.0, 0.0, 1.0 ) ) );
    normal = normalize( mix( rightV * nxy.x * vFloraFlip + upV * nxy.y + cross( rightV, upV ) * nz, upV, vFloraUp ) );
  }
  float floraLit = smoothstep( -0.2, 0.85, dot( normal, floraSunView( length( vViewPosition ) ) ) ); // лимонный — только верх к солнцу
#ifdef FLORA_LITE
  floraLit *= 0.65; // без карты нормалей вся карточка смотрит на солнце одинаково: свет мягче, как в среднем у high
#endif
  // оттенки света листвы — только зелени (лист, хвоя): лепестки цветов сохраняют свой цвет (розовые не персиковые)
  float floraLeaf = clamp( ( diffuseColor.g - max( diffuseColor.r, diffuseColor.b ) ) * 5.0 + 0.15, 0.0, 1.0 );
  diffuseColor.rgb *= mix( vec3( 1.0 ), mix( uShadeTint, uLitTint, pow( floraLit, uFloraLitPow ) ), floraLeaf ); // лимонный — только макушка купола к солнцу
}
#endif
#ifndef FLORA_SPRITES
#if defined(USE_MAP) && !defined(FLORA_LITE)
if (vFloraMode < -.5) {
  vec4 relief=texture(uFloraNormal,vMapUv,vFloraBias);
  vec3 dx=dFdx(-vViewPosition), dy=dFdy(-vViewPosition);
  vec2 s=dFdx(vMapUv), t=dFdy(vMapUv);
  vec3 tangent=dx*t.y-dy*s.y, across=dy*s.x-dx*t.x;
  normal=normalize(normal + (2.*relief.a-1.)*tangent*inversesqrt(max(1.e-15,dot(tangent,tangent)))
    + (2.*relief.g-1.)*across*inversesqrt(max(1.e-15,dot(across,across))));
}
#endif
if ( vFloraMode < 0.5 && dot( vBark.xy, vBark.xy ) > 1e-6 ) { // кора (у камней координат коры нет): борозды темнее, рельеф нормали ловит свет
  floraBark(vBark.xy, vBark.z, -vViewPosition, uBarkBump, diffuseColor.rgb, normal);
}
#endif
`;
const TRANS = `
if ( vFloraMode > 0.5 ) { // листва на просвет против солнца окружения (кроны у солнца светятся, как у референса)
  // только на плотном листе: полупрозрачную кайму карточки (альфа к покрытию) свечение не подсвечивает
  float floraSolid = smoothstep( 0.8, 1.0, diffuseColor.a );
  vec3 floraL = normalize( ( viewMatrix * vec4( uFloraSun, 0.0 ) ).xyz );
  totalEmissiveRadiance += diffuseColor.rgb * ( uFloraTrans.x * floraSolid ) * pow( max( 0.0, dot( - floraL, normalize( vViewPosition ) ) ), uFloraTrans.y );
  // кромка купола к солнцу: край силуэта, повёрнутый к свету, светится лимонным (контровой свет референса)
  float floraRim = pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 ) * clamp( dot( normal, floraL ) + 0.3, 0.0, 1.0 );
  // только у зелени (как оттенки света листвы): у белых лепестков лимонный контровой свет обводил край жёлтой каймой
  float floraRimLeaf = clamp( ( diffuseColor.g - max( diffuseColor.r, diffuseColor.b ) ) * 5.0 + 0.15, 0.0, 1.0 );
  totalEmissiveRadiance += diffuseColor.rgb * uFloraRim.rgb * ( uFloraRim.w * floraRim * floraSolid * floraRimLeaf );
}
`;

/**
 * uv текстуры листвы — центроидная интерполяция: при мультисэмплинге фрагмент, задевающий пиксель лишь краем (крошечная
 * или скошенная карточка), иначе берёт uv центра пикселя — вне карточки, в соседней ячейке атласа с листьями; такие
 * фрагменты проходили порог альфы и давали одиночные искры над кронами. С centroid uv — внутри покрытой части.
 */
function centroidUv(chunk) {
  const src = THREE.ShaderChunk[chunk];
  if (src.split('varying vec2 vMapUv;').length !== 2) throw new Error(`menuFlora: vMapUv not found once in ${chunk}`);
  return src.replace('varying vec2 vMapUv;', 'centroid varying vec2 vMapUv;');
}

function floraPatch(shader) {
  if (!shader.defines || !('FLORA_SPRITES' in shader.defines)) shader.uniforms.uBroadleafBark = { value: broadleafBarkTexture() };
  Object.assign(shader.uniforms, FLORA_UNIFORMS, { uTime: VEG_UNIFORMS.uTime, uWind: VEG_UNIFORMS.uWind, uSunDir: VEG_UNIFORMS.uSunDir, uTrans: VEG_UNIFORMS.uTrans });
  let vs = swap(shader.vertexShader, '#include <common>', '#include <common>' + VS_DECL);
  vs = swap(vs, '#include <uv_pars_vertex>', centroidUv('uv_pars_vertex'));
  vs = swap(vs, '#include <uv_vertex>', '#include <uv_vertex>' + UV_SPRITE);
  shader.vertexShader = swap(vs, '#include <project_vertex>', PROJECT + FAR_BIAS);
  let fs = swap(shader.fragmentShader, '#include <common>', '#include <common>' + FS_DECL);
  fs = swap(fs, '#include <uv_pars_fragment>', centroidUv('uv_pars_fragment'));
  fs = swap(fs, '#include <map_fragment>', MAP);
  fs = swap(fs, '#include <alphatest_fragment>', ALPHA_TEST);
  // Изнанку листа освещает та же мягкая нормаль кроны, в том числе у карточки на краю силуэта.
  fs = swap(fs, '#include <normal_fragment_begin>', swap(THREE.ShaderChunk.normal_fragment_begin,
    'normal *= faceDirection;', 'if ( vFloraMode < 0.5 ) normal *= faceDirection;'));
  fs = swap(fs, '#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + NORMAL);
  fs = swap(fs, '#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + TRANS);
  // листва пропускает и рассеивает небо: тень кроны светлее, чем у сплошных поверхностей
  // прямой свет листвы — солнце окружения с «обёрткой» (мягкая листва), вместо глобального солнца и заполняющего
  shader.fragmentShader = swap(fs, '#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 floraSunV = floraSunView( length( vViewPosition ) );
  float floraWrap = clamp( ( dot( normal, floraSunV ) + uFloraWrap ) / ( 1.0 + uFloraWrap ), 0.0, 1.0 );
  reflectedLight.directDiffuse = BRDF_Lambert( diffuseColor.rgb ) * uFloraSunColor * floraWrap;
  reflectedLight.directSpecular *= 0.0;
}
reflectedLight.indirectDiffuse *= uFloraAmb * ( vFloraMode < 0.5 ? 0.8 : 1.0 ); // ствол: чуть меньше рассеянного — видна солнечная сторона
#ifdef FLORA_LITE
reflectedLight.indirectDiffuse *= 1.1; // Lambert без рассеянного света карты окружения (он есть у Standard на high)
#endif
reflectedLight.indirectSpecular *= 0.0; // листва матовая: отражение неба на краях гроздей давало светлые контуры карточек`);
  envLightPatch(shader);
  shader.uniforms.uEnvHazeK = shader.defines && 'FLORA_SPRITES' in shader.defines ? FLORA_UNIFORMS.uFloraHazeKSprite : FLORA_UNIFORMS.uFloraHazeK;
  const has = (d) => !!shader.defines && d in shader.defines;
  if (!has('FLORA_SPRITES')) shader.uniforms.uEnvKnee = FLORA_UNIFORMS.uFloraKnee; // цветы-спрайты — с общим коленом: белые без ореолов
  shader.uniforms.uEnvSat = has('FLORA_SPRITES') ? FLORA_UNIFORMS.uFloraSpriteSat : has('FLORA_LITE') ? FLORA_UNIFORMS.uFloraMeshSatLite : FLORA_UNIFORMS.uFloraMeshSat;
}

const WHITE = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/**
 * Материал растений меню: lite — Lambert (medium, low), иначе Standard с alphaToCoverage (сглаженные края листвы,
 * MSAA на high); альфу растения в буфер не пишут (FLORA_NO_ALPHA_WRITE в createMenuFlora): её значения < 1 на краях
 * смешивались дальше по цепочке проходов со светлым фоном — белые швы между карточками крон;
 * sprites — вариант поля спрайтов (прямоугольник атласа и размер — атрибуты экземпляра); wind — ветер.
 * Карта — атлас цвета (пока пакета нет — белый тексель, растения скрыты полем).
 */
export function floraMaterial({ lite = false, sprites = false, wind = true } = {}) {
  const key = `menu-flora:${lite ? 'lite' : 'pbr'}:${sprites ? 'sprites' : 'mesh'}:${wind ? 'wind' : 'still'}`;
  return customMat(key, () => {
    const opts = { color: '#ffffff', vertexColors: !sprites, map: WHITE, alphaTest: 0.5, side: sprites ? THREE.FrontSide : THREE.DoubleSide };
    const m = lite ? new THREE.MeshLambertMaterial(opts) : new THREE.MeshStandardMaterial({ ...opts, roughness: 0.82, metalness: 0 });
    m.fog = false; // листва — в дымке окружения (envLight), без тумана сцены поверх неё
    if (!lite) m.alphaToCoverage = true;
    m.defines = {};
    m.defaultAttributeValues = { aTreeExtent: [0] };
    if (sprites) m.defines.FLORA_SPRITES = '';
    if (wind) m.defines.FLORA_WIND = '';
    if (lite) m.defines.FLORA_LITE = '';
    m.onBeforeCompile = floraPatch;
    m.customProgramCacheKey = () => key;
    return m;
  });
}

// ---------------------------------------------------------------- геометрия

/** Сборщик вершин растений: position, normal, uv, color, aCorner, aMode, aRot, aFlex, aLift. */
class Builder {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.corner = []; this.mode = []; this.rot = []; this.flex = []; this.lift = [];
    this.dome = [];
    this.idx = [];
  }

  get count() { return this.pos.length / 3; }

  vertex(p, n, u, v, c, corner, mode, rot, flex, lift, dome = NO_DOME) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b); this.corner.push(corner[0], corner[1]); this.mode.push(mode); this.rot.push(rot);
    this.flex.push(flex); this.lift.push(lift); this.dome.push(dome[0], dome[1], dome[2], dome[3]);
  }

  /** Шапка: квадрат с центром at, половиной стороны half, нормалью кроны n, спрайтом rect, цветом c. */
  lobe(at, half, n, rect, c, rot, flex, lift, dome = NO_DOME, curved = false) {
    const [u0, v0, u1, v1] = rect, b = this.count;
    if (curved) {
      // Черешки выходят в разных плоскостях вдоль изогнутой оси. Поворот
      // дальнего конца несёт пару боковых листьев вперёд, а другую в тень.
      const twist = 0.31 * Math.sin(rot + at[0] * 2.3 + at[2]);
      for (let row = 0; row < 3; row++) {
        const t = row / 2, along = 1 - 2 * t;
        for (const side of [-1, 1]) {
          const depth = half * (0.25 * Math.sin(t * Math.PI) - 0.41 * t * t + side * twist * t);
          const start = [at[0] + n[0] * depth, at[1] + n[1] * depth, at[2] + n[2] * depth];
          this.vertex(start, n, side < 0 ? u0 : u1, v1 + (v0-v1)*t, c,
            [side*half, along*half], MODE.lobe, rot, flex, lift, dome);
        }
      }
      for (let row = 0; row < 2; row++) {
        const i = b + 2*row;
        this.idx.push(i, i+2, i+1, i+1, i+2, i+3);
      }
      return;
    }
    const k = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
    for (const [x, y, u, v] of k) this.vertex(at, n, u, v, c, [x * half, y * half], MODE.lobe, rot, flex, lift, dome);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  /** Сплошная геометрия three с цветом colorAt(y) и гибкостью flexAt(y). */
  solid(geom, colorAt, flexAt = () => 0, rect = null) {
    const p = geom.getAttribute('position'), n = geom.getAttribute('normal'), uv = geom.getAttribute('uv'), b = this.count;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const u = rect ? rect[0] + uv.getX(i) * (rect[2] - rect[0]) : -1;
      const v = rect ? rect[1] + uv.getY(i) * (rect[3] - rect[1]) : -1;
      this.vertex([p.getX(i), y, p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], u, v, colorAt(y, i), [0, 0], MODE.solid, 0, flexAt(y), 0);
    }
    if (geom.index) for (let i = 0; i < geom.index.count; i++) this.idx.push(b + geom.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(b + i);
    geom.dispose();
  }

  build(name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(this.corner, 2));
    g.setAttribute('aMode', new THREE.Float32BufferAttribute(this.mode, 1));
    g.setAttribute('aRot', new THREE.Float32BufferAttribute(this.rot, 1));
    g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.flex, 1));
    g.setAttribute('aLift', new THREE.Float32BufferAttribute(this.lift, 1));
    g.setAttribute('aDome', new THREE.Float32BufferAttribute(this.dome, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    if (this.treeExtent) g.setAttribute('aTreeExtent',new THREE.Int8BufferAttribute(new Int8Array(this.count).fill(this.treeExtent),1));
    if (this.branchIndices) g.userData.branchIndices = this.branchIndices;
    g.name = name;
    return g;
  }
}

/**
 * Ветвь (трубка) вдоль сглаженной кривой (Catmull-Rom) через pts: радиус — radAt(t, угол в мире, y), sides граней по
 * окружности, segs отрезков вдоль, гладкие нормали. Координаты коры (окружность и длина в метрах, rRef — радиус для
 * окружности) — в aCorner: по ним шейдер рисует борозды коры. colorAt(t, y, P) — цвет с окклюзией (P — точка оси).
 */
function limb(b, pts, radAt, sides, segs, colorAt, flexAt, rRef) {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, false), len = curve.getLength();
  const base = b.count, P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const n = frames.normals[i], bn = frames.binormals[i], c = colorAt(t, P.y, P);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      N.set(n.x * ca + bn.x * sa, n.y * ca + bn.y * sa, n.z * ca + bn.z * sa);
      const r = radAt(t, Math.atan2(N.z, N.x), P.y);
      b.vertex([P.x + N.x * r, P.y + N.y * r, P.z + N.z * r], [N.x, N.y, N.z], -1, -1, c, [a * rRef, t * len], MODE.solid, 0, flexAt(P.y), 0);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < sides; j++) {
      const q = base + i * (sides + 1) + j, w = q + sides + 1;
      b.idx.push(q, q + 1, w + 1, q, w + 1, w);
    }
  }
}

// Живая ось ветви. Параллельный перенос поперечного сечения не скручивает кору
// в перегибе; последняя вершина одна, поэтому у тонкого конца нет нулевых граней.
function taperedBough(b, curve, width, sides, spans, phase, colorAt, flexAt, joinAxis, joinRadius, barkMap) {
  const start = b.count, p = new THREE.Vector3(), previous = new THREE.Vector3(), tangent = new THREE.Vector3();
  const side = new THREE.Vector3(), across = new THREE.Vector3(), radial = new THREE.Vector3(), normal = new THREE.Vector3();
  const { v0, v1, v2, v3 } = curve;
  const d0 = v1.clone().sub(v0), d1 = v2.clone().sub(v1), d2 = v3.clone().sub(v2);
  const joint = new THREE.Vector3();
  const circumference = 2*Math.PI*width;
  const barkSpan = circumference > 0.48 ? Math.round(circumference/0.96)*0.96 : circumference;
  let length = 0;
  for (let i = 0; i < spans; i++) {
    const t = i/spans, u = 1-t;
    curve.getPoint(t,p);
    if (i) length += p.distanceTo(previous);
    previous.copy(p);
    tangent.copy(d0).multiplyScalar(3*u*u).addScaledVector(d1,6*u*t).addScaledVector(d2,3*t*t);
    const speed = tangent.length();
    tangent.multiplyScalar(1/speed);
    if (!i) side.set(Math.abs(tangent.y) < 0.90 ? 0 : 1, Math.abs(tangent.y) < 0.90 ? 1 : 0, 0);
    side.addScaledVector(tangent,-side.dot(tangent)).normalize(); across.crossVectors(tangent,side);
    const collar = 0.18*Math.exp(-10*t), taper = u**0.83;
    const radius = width*taper*(1+collar), slope = width*(0.83*u**-0.17*(1+collar)+10*taper*collar)/speed;
    // Перидерма молодого прироста гладкая. По мере утолщения сука появляются
    // пластины взрослой коры; даже один длинный сук молодеет по пути к концу.
    const youth = 1-smooth01(0.022,0.155,radius);
    const color = colorAt(t,p.y,p), flex = flexAt(p.y);
    for (let j = 0; j <= sides; j++) {
      const a = TAU_BRANCH*j/sides, r = radius*(1+0.039*Math.cos(3*a+phase+3*t)+0.022*Math.sin(2*a-5*t));
      radial.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(across,Math.sin(a));
      normal.copy(radial).addScaledVector(tangent,slope).normalize();
      if (t < 0.5) {
        // У воротника свет продолжается с родительской ветви, включая участок,
        // где по касательной расходятся два древесных цилиндра.
        joint.copy(p).sub(v0).addScaledVector(radial,r);
        joint.addScaledVector(joinAxis,-joint.dot(joinAxis));
        const distance = joint.length();
        if (distance > 1e-7 && distance < 2.05*joinRadius) {
          const blend = 1-THREE.MathUtils.smoothstep(distance/joinRadius,0.8,2.05);
          normal.lerp(joint.multiplyScalar(1/distance),blend).normalize();
        }
      }
      const pos = [p.x+r*radial.x,p.y+r*radial.y,p.z+r*radial.z], u = barkSpan*j/sides;
      b.vertex(pos,normal.toArray(),-1,-1,color,barkMap ? barkMap(pos,p,u,length,barkSpan) : [u,length],MODE.solid,youth,flex,0);
    }
  }
  const tip = b.count;
  const end = v3.toArray(), arc = length+v3.distanceTo(p);
  b.vertex(end,d2.normalize().toArray(),-1,-1,colorAt(1,v3.y,v3),barkMap ? barkMap(end,v3,0,arc,barkSpan) : [0,arc],MODE.solid,1,flexAt(v3.y),0);
  for (let i=0; i<spans; i++) for (let j=0; j<sides; j++) {
    const k = start+i*(sides+1)+j, next = k+sides+1;
    if (i+1 === spans) b.idx.push(k,k+1,tip);
    else b.idx.push(k,k+1,next+1,k,next+1,next);
  }
}
const TAU_BRANCH = 2*Math.PI;
const MENU_BRANCHES = [[22,21],[16,16],[10,15],[8,9]];
const CITY_BRANCHES = [[8,5],[6,4],[4,3],[3,2]];
const MENU_MID_BRANCHES = [[7,4],[4,2],[3,2]];
// Толстая развилка держит круглое сечение. У прутика шириной в пиксель
// важнее точки вдоль дуги, чем окружность поперёк неё.
const CITY_MID_BRANCHES = [[6,4],[3,3],[3,1]];
const CITY_FAR_BRANCHES = [[5,3],[3,1]];
const BRANCH_LEVELS = [null, CITY_BRANCHES, MENU_BRANCHES, MENU_MID_BRANCHES, CITY_MID_BRANCHES, CITY_FAR_BRANCHES];

function forkedBough(b, curve, width, order, bearing, seed, detail, lobes, bark, flex, faces, joinAxis, joinRadius, barkMap) {
  const family = BRANCH_LEVELS[detail];
  const rng = createRng(seed), [sides,spans] = family[order];
  const begin = b.idx.length;
  taperedBough(b,curve,width,sides,spans,rng.uniform(0,6),bark,flex,joinAxis,joinRadius,barkMap);
  faces[order] += (b.idx.length-begin)/3;
  if (order+1 === family.length) return;
  const children = order === 0 ? (detail === 2 ? 3 : 2) : (order === 2 && detail === 1) || detail >= 3 ? 1 : 2;
  const length = curve.v0.distanceTo(curve.v3);
  for (let i=0; i<children; i++) {
    const t = 0.32 + (0.52 * i)/(Math.max(children-1,1)) + rng.uniform(-0.045,0.045);
    const start = curve.getPoint(t), tangent = curve.getTangent(t);
    const az = bearing + ((i+seed)%2 ? -1 : 1)*rng.uniform(0.56,1.42);
    const span = length * rng.uniform(order ? 0.45 : 0.53,order ? 0.72 : 0.79);
    const direction = new THREE.Vector3(Math.cos(az),rng.uniform(0.45,1.05),Math.sin(az)).normalize();
    const end = start.clone().addScaledVector(direction,span);
    // Последние побеги входят в край ближайшей грозди. Нижний ярус остаётся
    // виден из-под кроны, а торчащих в воздухе толстых обрубков нет.
    let nearest, gap = Infinity;
    for (const lobe of lobes) {
      const dist = Math.hypot(end.x-lobe[0],end.y-lobe[1],end.z-lobe[2])-lobe[3]*0.96;
      if (dist < gap) { nearest = lobe; gap = dist; }
    }
    if (gap > 0) end.lerp(new THREE.Vector3(nearest[0],nearest[1],nearest[2]),Math.min(0.46,gap/(gap+nearest[3])));
    const bend = rng.uniform(-0.13,0.13)*span;
    const a = start.clone().addScaledVector(tangent,0.19*span).addScaledVector(direction,0.18*span);
    const c = start.clone().lerp(end,0.73);
    c.x -= Math.sin(az)*bend; c.y -= span*rng.uniform(0.05,0.13); c.z += Math.cos(az)*bend;
    const id = (Math.imul(seed,31) + i + 1) >>> 0;
    const radius = width*(1-t)**0.83*rng.uniform(0.54,0.72);
    forkedBough(b,new THREE.CubicBezierCurve3(start,a,c,end),radius,order+1,az,id,detail,lobes,bark,flex,faces,tangent,width*(1-t)**0.83);
  }
}

// Цельный комель. Одна замкнутая поверхность проходит от кончиков корней в землю,
// через их плечи и между ними, до развилки. Ширина, высота и поворот у каждого корня свои.
function flaredStem(b, axis, roots, fork, top, r0, rFork, rootReach, phase, detail, colorAt, flexAt, scar) {
  const rootProfile = roots.map((q, i) => {
    const w = Math.sin(phase+2.71*i), angle = Math.atan2(q[6],q[4]);
    return { angle, reach: Math.hypot(q[4],q[6])*Math.max(0.86,rootReach)*(0.99+0.18*w),
      height: 0.47+0.39*(1+Math.cos(phase+1.67*i)), narrow: 7.4+2.4*w,
      turn: 0.17*Math.sin(phase+1.93*i) };
  });
  const capLen = rFork*1.32;
  const profile = (a, y) => {
    const h = Math.max(0,y+0.025), t = smooth01(0,fork,y);
    let r = r0+(rFork-r0)*t + 0.19*r0*Math.exp(-h/0.55);
    r *= 1 + 0.055*Math.cos(2*a+0.49*y+phase) + 0.039*Math.sin(3*a-0.55*y+phase*0.4)
      + 0.023*Math.cos(5*a+0.33*y+phase);
    // У подошвы выступ широкий и пологий. Выше остаётся узкое ребро в волокнах ствола.
    for (const root of rootProfile) {
      const bearing = root.angle+root.turn*(1-Math.exp(-1.9*h));
      const lobe = Math.exp((Math.cos(a-bearing)-1)*(root.narrow+5.8*h));
      r += Math.max(0,root.reach-1.10*r0)*lobe/(1 + 4.6*h/root.height)**1.53;
    }
    // Старый нижний сук отпал под ветвью первого яруса. Древесина вокруг
    // медленно нарастала с двух сторон и оставила асимметричное овальное плечо.
    const sy = y-scar.y, sx = scar.radius*Math.atan2(Math.sin(a-scar.angle),Math.cos(a-scar.angle))-0.18*sy;
    if (Math.abs(sx)<0.36 && Math.abs(sy)<0.47) {
      const oval = (sx/0.16)**2+(sy/0.24)**2;
      r += 0.057*Math.exp(-0.87*oval)*(1+0.22*Math.tanh(sx/0.08));
    }
    if (y > top-capLen) r *= Math.sqrt(Math.max(0,1-((y-top+capLen)/capLen)**2));
    return r;
  };
  // Кольца сгущены там, где силуэт быстрее меняет направление, у земли и плеча.
  const heights = detail === 5 ? [-0.29,0.15,0.53,0.64*fork,0.94*fork,top-capLen*0.21]
    : detail === 4 ? [-0.32,0,0.22,0.59,0.97,0.70*fork,0.96*fork,top-capLen*0.21]
    : [-0.34,0,0.10,0.22,0.40,0.66,0.95,0.55*fork,0.75*fork,0.94*fork,top-capLen*0.69,top-capLen*0.21];
  const divisions = detail === 2 ? 3 : 1, sides = detail === 2 ? 52 : detail === 4 ? 14 : detail === 5 ? 9 : 28;
  const rows = [];
  for (let i=0; i<heights.length-1; i++) {
    for (let j=0; j<divisions; j++) rows.push(THREE.MathUtils.lerp(heights[i],heights[i+1],j/divisions));
  }
  rows.push(heights.at(-1));
  const start = b.count, normal = new THREE.Vector3(), dAngle = new THREE.Vector3(), dHeight = new THREE.Vector3();
  const eps = 0.002, period = Math.round(2*Math.PI*r0/0.96)*0.96;
  for (const y of rows) {
    const t = (y+0.15)/(top+0.15), p = axis(t), before = axis(t-eps/(top+0.15)), after = axis(t+eps/(top+0.15));
    const color = colorAt(t,y,new THREE.Vector3(...p));
    for (let j=0; j<=sides; j++) {
      const a = 2*Math.PI*j/sides + scar.angle-Math.PI, cs = Math.cos(a), sn = Math.sin(a), r = profile(a,y);
      const da = (profile(a+eps,y)-profile(a-eps,y))/(2*eps), dy = (profile(a,y+eps)-profile(a,y-eps))/(2*eps);
      dAngle.set(da*cs-r*sn,0,da*sn+r*cs);
      dHeight.set((after[0]-before[0])/(2*eps)+dy*cs,1,(after[2]-before[2])/(2*eps)+dy*sn);
      normal.crossVectors(dHeight,dAngle).normalize();
      // На расходящихся корнях волокна также расходятся: удлиняем путь коры
      // пропорционально расширению конкретного ребра, с плавным выходом на ствол.
      const rootArc = Math.max(0,r-r0)*Math.exp(-Math.max(0,y)*2.2);
      const uv = [4.8+(j/sides-0.5)*period,3.1+y-scar.y-rootArc*0.78];
      b.vertex([p[0]+r*cs,y,p[2]+r*sn],normal.toArray(),-1,-1,color,uv,MODE.solid,-1,flexAt(y),0);
    }
  }
  const end = b.count, p = axis(1);
  b.vertex(p,[0,1,0],-1,-1,colorAt(1,top,new THREE.Vector3(...p)),[4.8,3.1+top-scar.y],MODE.solid,-1,flexAt(top),0);
  for (let i=0; i<rows.length; i++) for (let j=0; j<sides; j++) {
    const k = start+i*(sides+1)+j, next = k+sides+1;
    if (i+1 === rows.length) b.idx.push(k,end,k+1);
    else b.idx.push(k,next,k+1,k+1,next,next+1);
  }
}

/**
 * Ствол дерева, как у референса: ось с мягким S-изгибом и наклоном, сужение к развилке, расширение у земли с
 * контрфорсами к корням, узловатость; корни стелются и уходят в землю; 3–5 изогнутых ветвей от развилки вверх-наружу к
 * нижним куполам. Окклюзия: темнее у земли, в развилке и под кроной.
 */
function trunkInto(b, d, lod, rng, segments, rootReach = 1, branchDetail = 0) {
  const [, , , r0, , fork, , rFork] = d.trunk[0];
  const [sides, rings, rootSides, rootRings, branchSides, branchRings] = segments;
  const crownBottom = Math.min(...d.lobes.map((l) => l[1] - l[3]));
  const lean = rng.uniform(0.06, 0.14) * fork, la = rng.uniform(0, Math.PI * 2), ph = rng.uniform(0, 6.3);
  // ствол кончается сразу над развилкой (у оснований ветвей) скруглённой макушкой: на 0,9 м выше он торчал между ветвей
  // обрубком с открытым торцом
  const top = fork + 0.45, capLen = rFork * 1.3;
  const cap = (y) => (y > top - capLen ? Math.sqrt(Math.max(0, 1 - ((y - top + capLen) / capLen) ** 2)) : 1);
  // скруглённый конец ветви: последние k длины сходятся в точку — без открытого торца
  const capEnd = (t, k) => (t > 1 - k ? Math.sqrt(Math.max(0, 1 - ((t - 1 + k) / k) ** 2)) : 1);
  const axis = (t) => {
    const k = lean * Math.sin(Math.PI * t * 0.9), w = 0.35 * lean * Math.sin(Math.PI * t * 2.1 + 0.6);
    return [Math.cos(la) * k - Math.sin(la) * w, -0.15 + t * (top + 0.15), Math.sin(la) * k + Math.cos(la) * w];
  };
  const roots = d.trunk.filter((q) => q[5] < 0.1), branches = d.trunk.filter((q) => q[5] >= 0.1 && (q[4] !== 0 || q[6] !== 0));
  const nR = Math.max(3, roots.length), rootPh = roots.length ? -nR * Math.atan2(roots[0][6], roots[0][4]) : 0;
  const shade = (y) => 1 - 0.38 * smooth01(fork - 0.4, crownBottom + 0.4, y); // под кроной темнее
  // внутри купола кора в глубокой тени листвы (листва теней не отбрасывает — тень в цвете вершин): темнеет и зеленеет
  // по глубине в куполе; иначе рыжие освещённые кончики ветвей светились сквозь просветы кроны
  const inCrown = (p) => {
    let k = 0;
    for (const l of d.lobes) k = Math.max(k, smooth01(0, 0.5, 1 - Math.hypot(p.x - l[0], p.y - l[1], p.z - l[2]) / l[3]));
    return k;
  };
  const bark = (t, y, p) => _c.copy(BARK_DARK).lerp(BARK, smooth01(-0.1, 0.9, y)).multiplyScalar(shade(y)).lerp(BARK_DEEP, p ? 0.85 * inCrown(p) : 0).clone();
  const flex = (y) => Math.max(0, Math.min(1, y / d.h));
  const scar = branches.length ? { angle: Math.atan2(branches[0][6],branches[0][4]), y: fork*(0.58+0.045*Math.sin(ph)), radius: r0 } : null;
  const shapedStem = branchDetail > 0 && branchDetail !== 3;
  if (shapedStem && scar) {
    flaredStem(b,axis,roots,fork,top,r0,rFork,rootReach,ph,branchDetail,bark,flex,scar);
  } else {
    limb(b, [0, 0.2, 0.4, 0.6, 0.8, 1].map(axis), (t, a, y) => {
      const yy = Math.max(0, y), taper = rFork + (r0 - rFork) * Math.pow(Math.max(0, 1 - t * (top + 0.15) / (fork + 0.15)), 0.9);
      const flare = 1 + 0.85 * Math.exp(-yy / 0.4);
      const buttress = 1 + 0.35 * Math.exp(-yy / 0.55) * Math.pow(Math.max(0, Math.cos(nR * a + rootPh + 1.1 * yy)), 1.5); // контрфорсы мягкие, уходят в скрутку
      const gnarl = 1 + 0.05 * Math.sin(a * 3 + yy * 2.3 + ph) + 0.035 * Math.sin(a * 5 - yy * 3.1 + ph * 2);
      // ствол скручен жгутом, как у референса дерева: 5 толстых волокон закручиваются вверх (~1,1 рад/м), между ними борозды
      const flute = lod ? 0 : 0.16 * Math.pow(0.5 + 0.5 * Math.cos(5 * (a + 1.1 * yy) + ph), 1.6) - 0.06; // 5 толстых жгутов
      // мелкие гребни коры поверх волокон: вытянутый вдоль ствола шум
      const ridge = lod ? 0 : 0.03 * fbm3(Math.cos(a) * 3.2 + ph, yy * 0.8, Math.sin(a) * 3.2, 3);
      return Math.max(rFork * 0.7, taper) * flare * buttress * gnarl * (1 + flute + ridge) * cap(y);
    }, sides, rings, bark, flex, r0);
    for (const [, y0, , rr0, x1, , z1, rr1] of roots) { // корни: от контрфорса по земле и в землю
      if (!rootSides) break;
      const dx = x1 * rootReach, dz = z1 * rootReach;
      limb(b, [[dx * 0.15, y0 + 0.2, dz * 0.15], [dx * 0.45, y0 * 0.45, dz * 0.45], [dx * 0.8, 0.02, dz * 0.8], [dx * 1.05, -0.12, dz * 1.05]],
        (t) => (rr0 * 1.1 * (1 - t) + rr1 * 1.8 * t) * (1 + 0.15 * Math.sin(t * 7 + ph)), rootSides, rootRings, bark, flex, rr0);
    }
  }
  const forkAt = axis((fork * 0.85 + 0.15) / (top + 0.15));
  // конец ветви — в центре ближайшего купола (под листвой): от точки под куполом снизу был виден плоский торец-обрубок
  const intoLobe = (x, y, z) => {
    let best = d.lobes[0], bd = Infinity;
    for (const l of d.lobes) { const dd = (l[0] - x / 0.85) ** 2 + (l[1] - y) ** 2 + (l[2] - z / 0.85) ** 2; if (dd < bd) { bd = dd; best = l; } }
    return [best[0] * 0.9, best[1] + best[3] * 0.1, best[2] * 0.9];
  };
  const start = b.idx.length, order = [0,0,0,0];
  const stemEnd = b.count;
  let ordinal = 0, leader = null, steepest = 0;
  for (const [, , , rb0, bx, by, bz, rb1] of branches) { // ветви: вверх-наружу с изгибом, к нижним куполам
    const [x1, y1, z1] = intoLobe(bx, by, bz);
    const h = Math.hypot(x1 - forkAt[0], z1 - forkAt[2]) || 1, ox = (x1 - forkAt[0]) / h, oz = (z1 - forkAt[2]) / h, rise = y1 - forkAt[1];
    const p0 = forkAt, p1 = [p0[0] + ox * h * 0.3, p0[1] + rise * 0.3, p0[2] + oz * h * 0.3];
    const p2 = [p0[0] + ox * h * 0.72, p0[1] + rise * 0.62, p0[2] + oz * h * 0.72];
    const r0b = rFork * 0.68, r1b = Math.max(rb1 * 0.6, rFork * 0.12); // к концу тоньше: торец — внутри купола
    if (branchDetail) {
      const bearing = Math.atan2(oz,ox), phase = bearing*2 + ph;
      const fullStem = shapedStem;
      const footHeight = fullStem ? 0.84+0.16*Math.sin(phase+ordinal*1.39) : 0.86+0.07*Math.sin(phase);
      const foot = axis((fork*footHeight+0.15)/(top+0.15));
      const a = new THREE.Vector3(foot[0],foot[1],foot[2]);
      const c1 = new THREE.Vector3(p1[0]-0.13*oz,p1[1]+0.13*rise,p1[2]+0.13*ox);
      const sway = 0.15*h*Math.sin(phase+0.8);
      const c2 = new THREE.Vector3(p2[0]+oz*sway,p2[1]-0.08*rise,p2[2]-ox*sway);
      const arch = new THREE.CubicBezierCurve3(a,c1,c2,new THREE.Vector3(x1,y1,z1));
      if (fullStem && rise/h > steepest) { leader = arch; steepest = rise/h; }
      // Фаза коры фиксируется на внешнем плече воротника и переносится вместе
      // с поперечным сечением. По длине сука борозды не заворачивают поперёк оси.
      const period = Math.round(TAU_BRANCH*r0/0.96)*0.96;
      const shoulderU = 4.8+period*(THREE.MathUtils.euclideanModulo((bearing-scar.angle)/TAU_BRANCH+0.5,1)-0.5);
      let seamU;
      const barkMap = fullStem ? (pos,point,u,v,span) => {
        if (seamU === undefined) {
          const seam = Math.atan2(pos[2]-point.z,pos[0]-point.x);
          seamU = shoulderU+span*THREE.MathUtils.euclideanModulo((seam-bearing)/TAU_BRANCH,1);
        }
        return [seamU-u,3.1-scar.y+THREE.MathUtils.lerp(pos[1],foot[1]+v,smooth01(0.25,1.35,v))];
      } : null;
      forkedBough(b,arch,r0b,0,
        bearing,Math.round(fork*113)+ordinal++*43,branchDetail,d.lobes,bark,flex,order,new THREE.Vector3(0,1,0),rFork,barkMap);
      continue;
    }
    limb(b, [p0, p1, p2, [x1, y1, z1]], (t, a) => (r0b + (r1b - r0b) * Math.pow(t, 0.55)) * (1 + 0.04 * Math.sin(a * 3 + t * 9 + ph)) * capEnd(t, 0.08),
      branchSides, branchRings, bark, flex, r0b);
    // тонких ветвей от середины к нижним куполам нет: они шли к куполу под кроной по открытому воздуху и входили в него
    // снизу, где листвы мало, — вблизи читались голыми обрубками; у референса ветви уходят только в крону
  }
  if (leader) {
    // Вершина ствола входит в ведущий сук. В открытой вилке нет отдельного
    // округлого обрубка между расходящимися ветвями.
    const center = new THREE.Vector3(), begin = leader.v0.y;
    let previousY = -Infinity, weight, keep, offsetX, offsetZ, line;
    for (let i=0; i<stemEnd; i++) {
      const k = i*3, y = b.pos[k+1];
      if (y <= begin) continue;
      if (y !== previousY) {
        let lo = 0, hi = 1;
        for (let n=0; n<12; n++) {
          const t = (lo+hi)*0.5; leader.getPoint(t,center);
          if (center.y < y) lo=t; else hi=t;
        }
        previousY = y; line = axis((y+0.15)/(top+0.15));
        weight = smooth01(begin,top-capLen*0.35,y);
        keep = 1-0.58*weight; offsetX = weight*(center.x-line[0]); offsetZ = weight*(center.z-line[2]);
      }
      b.pos[k] = line[0] + (b.pos[k]-line[0])*keep + offsetX;
      b.pos[k+2] = line[2] + (b.pos[k+2]-line[2])*keep + offsetZ;
    }
  }
  b.branchIndices = { start, count: b.idx.length-start, order };
  if (branchDetail) {
    // У общей развилки волокна, цвет и освещение непрерывно переходят со ствола
    // на плечи суков. Отдельные локальные системы коры нужны выше воротника.
    const woodNormal = new THREE.Vector3(), shoulder = new THREE.Vector3();
    for (let i = 0; i < b.count; i++) {
      const k = 3*i, y = b.pos[k+1];
      if (y < 0.68*fork || y > top+0.55) continue;
      const line = axis(Math.min(1,(y+0.15)/(top+0.15)));
      const dx = b.pos[k]-line[0], dz = b.pos[k+2]-line[2], radial = Math.hypot(dx,dz);
      if (radial < 0.001 || radial > rFork*2.9) continue;
      const weight = smooth01(0.68*fork,0.80*fork,y)*(1-smooth01(top,top+0.55,y))*(1-smooth01(1.6,2.9,radial/rFork));
      shoulder.set(dx/radial,0.10,dz/radial).normalize();
      woodNormal.fromArray(b.nor,k).lerp(shoulder,weight).normalize().toArray(b.nor,k);
      const color = bark(0,y);
      b.col[k] += weight*(color.r-b.col[k]);
      b.col[k+1] += weight*(color.g-b.col[k+1]);
      b.col[k+2] += weight*(color.b-b.col[k+2]);
    }
  }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Плотность карточек: их число на шапке радиуса r — CARD_COVER·r²/half²; [high ≈1,25 покрытия сферы шапки, lite —
 * меньше перекрытия: на igpu листва — главная цена кадра меню]. */
const CARD_COVER = [7, 2.8];
/** Полуразмер карточки-грозди, м: [high, lite] — у деревьев, кустов и изгороди. */
export const CARD_HALF = { tree: [0.5, 0.68], bush: [0.2, 0.36], hedge: [0.1, 0.2] }; // лист грозди ≈ 0,55·half: у крон ~0,28 м, как у референса дерева
const _P = new THREE.Vector3(), _L = new THREE.Vector3(), _C = new THREE.Vector3(), _N = new THREE.Vector3();
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * «Пушистая» листва (спецификация «Меню: переработка окружения» §2.3): каждая шапка lobes [x, y, z, r, _, ao] покрыта
 * карточками-гроздями листьев полуразмера half по спирали Фибоначчи на её сфере; карточки внутри соседних шапок
 * отброшены (их не видно, и они не рисуются). Нормаль освещения — смесь нормали шапки и кроны (мягкая крупная
 * светотень, бугры шапок); цвет — окклюзия: складки между шапками, низ кроны, глубина шапки по проекту.
 */
function foliage(b, lobes, { half: half0, cover = CARD_COVER[0], rects, rng, center, y0, y1, flexAt, tone = 1, tint = [1, 1, 1], creaseK = 1, dome = null, nMix = [0.9, 0.3], halfK = Infinity, cull = 0.86, topK = 0, ground = false, liftK = 0.45, shoots = false }) {
  for (let li = 0; li < lobes.length; li++) {
    const [x, y, z, r, , ao = 1] = lobes[li];
    // карточка не шире шапки (halfK · r): крупные карточки lite на мелких шапках раздували силуэт и перерисовку
    const half = Math.min(half0, r * halfK), n = Math.max(4, Math.round(cover * r * r / (half * half)));
    const phase = rng.uniform(0, Math.PI * 2), domeTone = rng.uniform(0.9, 1.1);
    for (let i = 0; i < n; i++) {
      const u = 1 - 2 * (i + 0.5) / n, sr = Math.sqrt(1 - u * u), a = i * GOLDEN + phase;
      _L.set(Math.cos(a) * sr, u, Math.sin(a) * sr);
      const d = r * rng.uniform(0.8, 0.9); // карточки ровно по поверхности купола: аккуратный силуэт, как у референса
      _P.set(x + _L.x * d, y + _L.y * d, z + _L.z * d);
      let hidden = false;
      for (let j = 0; j < lobes.length && !hidden; j++) {
        const q = lobes[j];
        if (j !== li) hidden = (_P.x - q[0]) ** 2 + (_P.y - q[1]) ** 2 + (_P.z - q[2]) ** 2 < (q[3] * cull) ** 2;
      }
      if (hidden) continue;
      // складка: близость поверхности соседнего купола (окклюзия между куполами — купола отделены тёмными складками)
      let near = 9;
      for (let j = 0; j < lobes.length; j++) {
        if (j === li) continue;
        const q = lobes[j];
        near = Math.min(near, Math.hypot(_P.x - q[0], _P.y - q[1], _P.z - q[2]) - q[3]);
      }
      const crease = 1 - creaseK * 0.45 * (1 - smooth01(-0.05, 0.6, near)); // складки между куполами: купола раздельные, как у референса; у кустов слабее
      _C.set(_P.x - center[0], (_P.y - center[1]) * 1.25, _P.z - center[2]).normalize();
      _N.copy(_L).multiplyScalar(nMix[0]).addScaledVector(_C, nMix[1]).normalize(); // свет по шапке: каждая — свой купол, как у референса
      const h = Math.min(1, Math.max(0, (_P.y - y0) / Math.max(1e-3, y1 - y0)));
      // низ каждого купола темнее — в шейдере по пикселю (aDome): купола читаются по отдельности, свет плавный
      const k = tone * (0.66 + 0.26 * smooth01(-0.35, 0.75, _L.dot(_C)) + 0.2 * h) * (0.8 + 0.2 * ao) * crease // складки и низ кроны темнее
        * (1 + topK * smooth01(0.3, 0.95, _L.y)); // макушка шапки светлее (topK — у кустов: светлые верхушки бугров, как у референса)
      // разброс тона — у купола, а не у карточки: пятна разного тона читались «чешуёй», купол — нет
      const s = half * rng.uniform(0.85, 1.15), kv = k * domeTone * rng.uniform(0.96, 1.04);
      // Нижние грозди куста лежат над газоном; у земли уменьшаем вынос вдоль нормали купола.
      let py = _P.y, lift = s * liftK;
      if (ground) {
        // На кусте молодые концы растут группой к соседнему освещённому окну.
        // Короткие и длинные приросты чередуются на одном плече куста.
        const reach = r*(.11+.14*Math.sin(2*a+.68*li+2*u));
        _P.addScaledVector(_L,reach);
        _N.x+=.28*Math.cos(a+.97*li); _N.z+=.24*Math.sin(1.5*a+.7*li);
        _N.y+=.18*Math.cos(2*a+u); _N.normalize();
        py = Math.max(_P.y, s * LOBE_FRAME * 0.75);
        lift *= Math.min(1, py / 0.4);
      }
      b.lobe([_P.x, py, _P.z], s * LOBE_FRAME, [_N.x, _N.y, _N.z], rects[rng.int(0, rects.length - 1)], new THREE.Color(kv * tint[0], kv * tint[1], kv * tint[2]),
        Math.atan2(_L.x, -_L.y) + rng.uniform(-0.3, 0.3), flexAt(_P.y), lift, dome || (ground ? NO_DOME : [x, y, z, r]), shoots && (i + li) % 3 !== 1 && (!ground || _L.y > 0.12));
    }
  }
}

const rectsOf = (names) => names.map((n) => FLORA.rects[n]);

// В облегчённой кроне меньше поверхностных листьев. Под ними видна зелень в глубине
// той же ветви: двадцать треугольников на шапку, общие материал и вызов отрисовки.
function innerFoliage(b, lobes, gain, flexAt) {
  for (const [x, y, z, radius] of lobes) {
    const r = 0.82 * radius;
    const g = new THREE.SphereGeometry(r, 5, 3).translate(x, y, z);
    b.solid(g, py => {
      const up = (py - y) / r;
      return _c.setRGB(0.22 + 0.12 * up, 0.34 + 0.14 * up, 0.065 + 0.015 * up).multiplyScalar(gain);
    }, flexAt, FLORA.rects.lobeA);
  }
}

/**
 * Дерево по проекту FLORA.trees[v]: ствол, корни и ветви (сплошные) и «пушистая» крона из карточек-гроздей (foliage).
 * lod 0 (high) — мелкие карточки и подробная кора, lod 1 — крупные карточки и облегчённый ствол.
 * Поле города передаёт свою сетку ствола, длину корней и плотность карточек для каждого уровня.
 */
export function treeGeometry(v, lod = 0, detail = null) {
  const d = FLORA.trees[v], b = new Builder(), rng = createRng(500 + v * 7 + (detail ? 0 : lod));
  if (!detail) b.treeExtent = Math.round(8*d.h) * (lod ? -1 : 1);
  trunkInto(b, d, lod, rng, detail?.trunk ?? (lod ? [12, 14, 6, 4, 8, 6] : [32, 48, 14, 12, 22, 24]),
    detail?.rootReach, detail?.branchDetail ?? (detail ? 0 : lod ? 3 : 2));
  const name = `menu:tree:${v}:L${lod}`;
  if (detail?.cover === 0) return b.build(name);
  const lobes = d.lobes;
  const cx = lobes.reduce((s, l) => s + l[0], 0) / lobes.length;
  const cy = lobes.reduce((s, l) => s + l[1], 0) / lobes.length;
  const cz = lobes.reduce((s, l) => s + l[2], 0) / lobes.length;
  const y0 = Math.min(...lobes.map((l) => l[1] - l[3])), y1 = Math.max(...lobes.map((l) => l[1] + l[3]));
  const flexAt = y => Math.min(1, y / d.h), liteMenu = lod && !detail;
  if (liteMenu) innerFoliage(b, lobes, 1.0, flexAt);
  const shoots = detail ? !!detail.shoots : lod === 0;
  foliage(b, lobes, { shoots, half: detail?.half ?? CARD_HALF.tree[lod ? 1 : 0], cover: liteMenu ? 5.4 : (detail?.cover ?? CARD_COVER[0]), rects: rectsOf(shoots ? SHOOT_SPRITES : LOBE_SPRITES), rng, center: [cx, cy + 0.35, cz], y0, y1,
    flexAt, tone: 1.15, halfK: 0.8, liftK: liteMenu ? 0.18 : 0.45 }); // верхушки деревьев светлее кустов
  return b.build(name);
}

/**
 * Шапки куста: главный купол радиуса R с центром на высоте cy и бугры [dx, dy, dz, r] по направлениям, выступающие из
 * него на долю out своего радиуса: силуэт — гроздь бугров, как у кустов референса, а не ровный шар.
 */
function bushLobes(R, cy, parts, out = 0.4) {
  return [[0, cy, 0, R], ...parts.map(([dx, dy, dz, r]) => {
    const l = Math.hypot(dx, dy, dz), d = R - r + out * r;
    return [dx / l * d, cy + dy / l * d, dz / l * d, r];
  })];
}

/** Проекты кустов (с it153): шире своей высоты, 3–6 бугров вокруг главного купола; листва — те же грозди, что у крон. */
export const BUSHES = [
  { lobes: bushLobes(0.56, 0.5, [[1, -0.3, 0.2, 0.46], [-1, -0.25, -0.15, 0.44], [0.15, -0.3, 1, 0.4], [-0.3, -0.35, -1, 0.4], [0.3, 0.75, 0.15, 0.36]]) },
  { lobes: bushLobes(0.5, 0.42, [[1, -0.2, 0, 0.46], [-1, -0.2, 0.1, 0.44], [0.3, 0.05, 0.95, 0.38], [-0.2, 0.7, -0.3, 0.32]], 0.5) },
  { lobes: bushLobes(0.64, 0.56, [[1, -0.3, 0.1, 0.48], [-1, -0.3, 0.05, 0.46], [0.1, -0.3, 1, 0.44], [-0.1, -0.3, -1, 0.44], [0.35, 0.7, -0.2, 0.4], [-0.45, 0.6, 0.35, 0.38]]) },
];
const BLOOM = ['rose', 'cosmos', 'daisy'];
/** Кусты темнее и холоднее крон (сине-зелёные), но с лаймовым верхом бугров, как у референса. */
const BUSH_TINT = [0.9, 1, 1.18];
/** Ядро куста — тёмная зелень глубины листвы (светлее почти чёрного: низ кустов и просветы не проваливались в черноту). */
const BUSH_CORE = new THREE.Color(0.2, 0.34, 0.09);

/** Куст варианта v; bloom — номер цветов (BLOOM) на верхней половине шапок или −1 без цветов; lod — как у деревьев. */
export function bushGeometry(v, bloom = -1, lod = 0, core = true) {
  const d = BUSHES[v], b = new Builder(), rng = createRng(700 + v * 13 + bloom);
  const liteMenu = lod && core;
  foliage(b, d.lobes, { shoots: !lod, half: liteMenu ? 0.27 : CARD_HALF.bush[lod ? 1 : 0], cover: liteMenu ? 5.4 : CARD_COVER[lod ? 1 : 0], rects: rectsOf(liteMenu ? LOBE_SPRITES : SHOOT_SPRITES), rng,
    center: [0, 0.3, 0], y0: 0, y1: 1.2, flexAt: lod ? () => 0.4 : y => 0.50 * smooth01(0.07, 0.94, y), tone: lod ? 0.43 : 0.47, tint: BUSH_TINT, creaseK: 0.48, nMix: [0.85, 0.4], topK: 0.54,
    cull: 0.72, ground: true, liftK: liteMenu ? 0.18 : 0.45 });
  // отсечение 0,72: утопленные шапки не выбивают карточки друг друга (дыры)
  if (liteMenu) innerFoliage(b, d.lobes, 0.68, () => 0.4);
  else if (core) { // сквозь густые побеги видны лишь небольшие фрагменты круглого ядра
    const [cx, cy, cz, cr] = d.lobes[0], sphere = new THREE.SphereGeometry(cr * 0.7, 12, 8);
    sphere.translate(cx, cy, cz);
    b.solid(sphere, () => BUSH_CORE, () => 0.4, FLORA.rects.leafMass);
    sphere.dispose();
  }
  if (bloom >= 0) { // мелкие цветки по верхней половине шапок (как у цветущих кустов референса), а не крупные диски
    for (const [x, y, z, r] of d.lobes) {
      for (let i = 0; i < 7; i++) {
        const a = rng.uniform(0, Math.PI * 2), up = rng.uniform(0.15, 0.85), h = Math.sqrt(1 - up * up);
        const p = [x + Math.cos(a) * h * r * 0.88, y + up * r * 0.88, z + Math.sin(a) * h * r * 0.88];
        b.lobe(p, r * 0.3, [Math.cos(a) * h, up, Math.sin(a) * h], FLORA.rects[BLOOM[bloom]], new THREE.Color(1, 1, 1), rng.uniform(-0.4, 0.4), 0.5, r * 0.35);
      }
    }
  }
  return b.build(`menu:bush:${v}:${bloom}:L${lod}`);
}

/** Брус изгороди, м: полудлина сегмента, полуширина, высота, скругление кромок. */
export const HEDGE = { L: 1.22, D: 0.3, H: 0.82, R: 0.12 };
/**
 * Ядро изгороди — глубина листвы в тени: в просветах между карточками — тёмная зелень, а не освещённая плоская грань
 * бруса (с ядром цвета куста просветы читались бледными «осколками»).
 */
const HEDGE_CORE = new THREE.Color(0.07, 0.12, 0.03);

/**
 * Карточки изгороди: lod, генератор и функция card(x, y, z, nx, ny, nz, k) — гроздь мелкой листвы в точке с нормалью и
 * тоном k. Шаг меньше полуразмера, разброс в треть шага, ряды вразбежку: ядро не просвечивает, а правильная сетка не
 * читается «пупырчатой плёнкой». Верх и плечи стрижки несут изогнутые концы побегов.
 */
function hedgeCards(b, lod, seed, half = CARD_HALF.hedge[lod ? 1 : 0]) {
  const rng = createRng(seed), rects = rectsOf(lod ? FINE_SPRITES : SHOOT_SPRITES), { H } = HEDGE;
  // Листовые побеги заполняют около 40% тайла, прежние плотные грозди — 30%.
  // Небольшое увеличение шага сохраняет стриженый контур и место для выступающих кончиков.
  const step = half * (lod ? 1.25 : 1), tone = 0.7;
  // Молодые побеги в атласе светлее старой мелкой листвы. Зрелая зелень стриженого ряда
  // должна сохранять оттенок, в том числе в переходе на среднюю сетку.
  const tint = lod ? new THREE.Color(1.12, 0.98, 1) : new THREE.Color(0.48, 0.56, 0.67);
  const n = new THREE.Vector3();
  let shoulder = 0;
  const card = (x, y, z, nx, ny, nz, k) => {
    n.set(nx, ny, nz).normalize();
    const j = step * 0.35;
    b.lobe([x + rng.uniform(-j, j), y + rng.uniform(-j, j) * 0.5, z + rng.uniform(-j, j) * 0.5], half * LOBE_FRAME * rng.uniform(0.85, 1.2), [n.x, n.y, n.z],
      rects[rng.int(0, rects.length - 1)], tint.clone().multiplyScalar(k * tone), rng.uniform(-Math.PI, Math.PI), 0.25 * y / H,
      half * 0.3 * Math.min(1, y / 0.4), NO_DOME, !lod && ny > 0.55 && shoulder++ % 3 === 0);
  };
  return { half, step, card };
}

/** Тон бока изгороди на высоте y: темнее книзу, а у верхней кромки — к светлому верху без резкой границы. */
const hedgeSide = (y) => 0.56 + 0.3 * y / HEDGE.H + 0.22 * Math.max(0, (y / HEDGE.H - 0.6) / 0.4) ** 2;
/** Ряды бока изгороди по высоте: нижний — над плоскостью тротуара (без «лесенки» по низу). */
const hedgeRows = (step) => {
  const { H, R } = HEDGE, ny = Math.max(2, Math.round((H - R - 0.06) / step));
  return Array.from({ length: ny }, (_, k) => 0.14 + (k + 0.5) * ((H - R - 0.14) / ny));
};

/**
 * Сегмент стриженой изгороди длиной 2,4 м вдоль x, как у референса: брус 0,6 × 0,82 м со скруглёнными кромками,
 * покрытый мелколистными карточками-гроздями по граням (плоский светлый верх, бока темнее книзу); lod — как у деревьев.
 * Торцов у сегмента нет: сегменты ряда стыкуются, а концы ряда закрывает hedgeCapGeometry.
 */
export function hedgeGeometry(lod = 0, cardHalf) {
  const b = new Builder(), { half, step, card } = hedgeCards(b, lod, 811, cardHalf), { L, D, H, R } = HEDGE;
  { // Тёмная сердцевина изгороди видна между поверхностными гроздьями.
    const core = new THREE.BoxGeometry(2 * L * 0.97, H * 0.9, 2 * D * 0.8);
    core.translate(0, H * 0.45, 0);
    b.solid(core, () => HEDGE_CORE, () => 0.2);
    core.dispose();
  }
  const nx = Math.max(2, Math.round(2 * L / step)), nz = Math.max(1, Math.round(2 * (D - R) / step)), rows = hedgeRows(step);
  const dxs = 2 * L / nx, at = (i, row) => -L + (i + 0.5 + (row % 2 ? 0.5 : 0)) * dxs; // ряды вразбежку
  for (let i = 0; i < nx; i++) {
    // верх и кромка — на полкарточки ниже, чтобы выступающие кончики повторяли контур стрижки
    for (let k = 0; k < nz; k++) card(Math.min(L, at(i, k)), H - half * 0.45, -(D - R) + (k + 0.5) * (2 * (D - R) / nz), 0, 1, 0, 1.45); // плоский верх на солнце — светлый
    for (const sd of [-1, 1]) {
      card(at(i, 1), H - R * 0.35 - half * 0.3, sd * (D - R * 0.35), 0, 0.75, sd * 0.7, 1.2); // скруглённая кромка
      rows.forEach((y, k) => card(Math.min(L, at(i, k)), y, sd * D, 0, 0.12, sd, hedgeSide(y))); // бок
    }
  }
  return b.build(`menu:hedge:L${lod}`);
}

/**
 * Торец конца ряда изгороди (+x сегмента, в его осях): грань из тех же карточек, скруглённые вертикальные кромки и
 * кромка верха — ряд кончается стриженым торцом, а не вертикальным срезом карточек боков. Экземпляр стоит как
 * крайний сегмент (начало ряда — повёрнут на π).
 */
export function hedgeCapGeometry(lod = 0, cardHalf) {
  const b = new Builder(), { half, step, card } = hedgeCards(b, lod, 877, cardHalf), { L, D, H, R } = HEDGE;
  const rows = hedgeRows(step), nz = Math.max(2, Math.round(2 * (D - R) / step)), dy = rows[1] - rows[0];
  rows.forEach((y, k) => {
    for (let j = 0; j < nz; j++) card(L, y, -(D - R) + (j + (k % 2 ? 0.75 : 0.25)) * (2 * (D - R) / nz), 1, 0.12, 0, hedgeSide(y)); // ряды вразбежку
    // вертикальная кромка — вдвое чаще рядов: на стыке бока и торца ядро не просвечивает тёмной щелью
    for (const sd of [-1, 1]) for (const yy of [y, y + dy / 2]) card(L - R * 0.35, yy, sd * (D - R * 0.35), 0.7, 0.12, sd * 0.7, hedgeSide(yy));
  });
  // кромка верха — тоном верхних рядов бока, а не светлого верха: светлые карточки стекали на торец лопастями
  const top = H - R * 0.35 - half * 0.3;
  for (let j = 0; j < nz; j++) card(L - R * 0.35, top, -(D - R) + (j + 0.5) * (2 * (D - R) / nz), 0.7, 0.75, 0, hedgeSide(H));
  for (const sd of [-1, 1]) card(L - R * 0.35, top, sd * (D - R * 0.35), 0.55, 0.65, sd * 0.55, hedgeSide(H)); // угол
  return b.build(`menu:hedgecap:L${lod}`);
}

/** Гладкий 3D-шум значений (детерминированный) и его сумма октав: рельеф камней. */
function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
function fbm3(x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += a * (noise3(x * f, y * f, z * f) * 2 - 1); a *= 0.5; f *= 2.03; }
  return s;
}

/**
 * Валун, как у референса: плотная сфера (96×64), срезанная 7 плоскостями с мягким сопряжением — широкие грани
 * обкатанного камня; поверх лёгкие бугры и зерно, низ утоплен в землю (траву и цветы у основания). Цвет в вершинах —
 * тёплый серо-сиреневый камень, светлее кверху, темнее в сопряжениях граней, мелкая крапчатость.
 */
export function rockGeometry(v = 0, widthSegments = 96, heightSegments = 64, textured = true) {
  const b = new Builder(), rng = createRng(901 + v);
  const g = new THREE.SphereGeometry(0.5, widthSegments, heightSegments), p = g.getAttribute('position');
  const planes = [];
  for (let i = 0; i < 7; i++) {
    const a = rng.uniform(0, Math.PI * 2), up = i === 0 ? 0.92 : rng.uniform(-0.1, 0.65);
    const h = Math.sqrt(1 - up * up);
    planes.push([Math.cos(a) * h, up, Math.sin(a) * h, i === 0 ? 0.8 : rng.uniform(0.76, 0.9)]);
  }
  const smin = (a, c, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-c / k));
  const seam = new Float32Array(p.count), d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    // Октаэдрическая развёртка: на верхней плоскости валуна нет полюса
    // со стянутым в одну точку минеральным рисунком. Стык уходит под землю.
    const l1=Math.abs(d.x)+Math.abs(d.y)+Math.abs(d.z), u=d.x/l1, v0=d.z/l1;
    const s=d.y<0 ? Math.sign(u)*(1-Math.abs(v0)) : u;
    const t=d.y<0 ? Math.sign(v0)*(1-Math.abs(u)) : v0;
    g.attributes.uv.setXY(i,.5+.5*s,.5+.5*t);
    let r = 1, cut = 0;
    for (const [nx, ny, nz, o] of planes) {
      const c = d.x * nx + d.y * ny + d.z * nz;
      if (c <= 0.05) continue;
      const rr = smin(r, o / c, 0.07);
      cut = Math.max(cut, Math.max(0, 1 - Math.abs(o / c - r) / 0.12)); // у сопряжения граней
      r = rr;
    }
    seam[i] = cut;
    const k = r * (1 + 0.05 * fbm3(d.x * 2.1 + v, d.y * 2.1, d.z * 2.1, 3) + 0.01 * fbm3(d.x * 16, d.y * 16 + v, d.z * 16, 2));
    p.setXYZ(i, d.x * 0.5 * k * 1.25, d.y * 0.5 * k * 0.78 + 0.02, d.z * 0.5 * k * 1.05);
  }
  g.computeVertexNormals();
  const stone = new THREE.Color('#5c5957'), top = new THREE.Color('#969286');
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const c = stone.clone().lerp(top, Math.min(1, Math.max(0, (y + 0.05) / 0.4)));
    c.multiplyScalar((textured ? 1.26 : 1) * (1 - 0.12 * seam[i]) * (0.94 + 0.12 * fbm3(x * 22, y * 22, z * 22 + v, 2)));
    colors.push(c);
  }
  b.solid(g, (y, i) => colors[i], () => 0, textured ? FLORA.rects.boulder : null);
  if(textured) b.mode.fill(-1);
  return b.build(`menu:rock:${v}`);
}

/** Квадрат спрайта: x −1..1, y 0..1 (низ — на земле), uv 0..1. */
function spriteQuad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  for (const [name, size] of [['aCorner', 2], ['aMode', 1], ['aRot', 1], ['aLift', 1]]) g.setAttribute(name, new THREE.Float32BufferAttribute(new Array(4 * size).fill(0), size));
  g.setAttribute('aFlex', new THREE.Float32BufferAttribute([0, 0, 1, 1], 1));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Спрайты по имени: прямоугольник атласа и половина ширины / высота при масштабе 1 (м). */
export const SPRITE_SIZE = {
  conifer0: [0.5, 1], conifer1: [0.5, 1], conifer2: [0.5, 1],
  tree0: [0.5, 1], tree1: [0.5, 1], tree2: [0.5, 1], tree3: [0.5, 1],
  daisy: [0.5, 0.5], cosmos: [0.5, 0.5], violet: [0.5, 0.5], buttercup: [0.5, 0.5], rose: [0.5, 0.5],
  grassA: [0.5, 1], grassB: [0.5, 1],
};

/** Доля нормали «вверх» у спрайта (трава и цветы освещены как газон под ними, ели и импостеры — своей картой). */
const SPRITE_UP = { grassA: 0.85, grassB: 0.85, daisy: 0.55, cosmos: 0.55, violet: 0.55, buttercup: 0.55, rose: 0.45, conifer: 0.1, tree: 0.1 };

/**
 * Поле спрайтов: один InstancedMesh квадратов; у экземпляра — прямоугольник атласа (aRect), половина ширины и высота
 * (aHalf), матрица (место и масштаб) и цвет. items: { sprite, x, y, z, w, h, color? }; w, h — половина ширины и высота, м.
 */
/** Цветы, которые можно отражать: свет на них почти симметричен (у елей и импостеров деревьев освещена своя сторона). */
const FLIPPABLE = new Set(['daisy', 'cosmos', 'violet', 'buttercup', 'rose']);
/**
 * Какие спрайты отразить по горизонтали: у вида цветов одна картинка, и две соседние куртины читались копией. Куртина
 * отражена наоборот ближайшей уже поставленной куртине того же вида в радиусе FLIP_R (сетка ячеек FLIP_R), первая —
 * по хешу места; генератор раскладки не трогается — расстановка та же.
 */
const FLIP_R = 4;
function flips(items) {
  const out = new Uint8Array(items.length), cells = new Map();
  items.forEach((it, i) => {
    if (!FLIPPABLE.has(it.sprite)) return;
    const cx = Math.floor(it.x / FLIP_R), cz = Math.floor(it.z / FLIP_R);
    let near = -1, nd = FLIP_R * FLIP_R;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cells.get(`${cx + dx}:${cz + dz}`) || []) {
        const q = items[j], d = (q.x - it.x) ** 2 + (q.z - it.z) ** 2;
        if (q.sprite === it.sprite && d < nd) { nd = d; near = j; }
      }
    }
    if (near >= 0) out[i] = 1 - out[near];
    else { const h = Math.sin(it.x * 12.9898 + it.z * 78.233) * 43758.5453; out[i] = h - Math.floor(h) > 0.5 ? 1 : 0; }
    const key = `${cx}:${cz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  return out;
}

export function spriteField(items, material) {
  const g = spriteQuad(), n = items.length, flip = flips(items);
  const rect = new Float32Array(Math.max(1, n) * 4), half = new Float32Array(Math.max(1, n) * 3);
  const m = new THREE.InstancedMesh(g, material, Math.max(1, n));
  items.forEach((it, i) => {
    rect.set(FLORA.rects[it.sprite], i * 4);
    half[i * 3] = it.w * (flip[i] ? -1 : 1); half[i * 3 + 1] = it.h; half[i * 3 + 2] = it.up ?? SPRITE_UP[it.sprite.replace(/\d+$/, '')] ?? 0;
    m.setMatrixAt(i, _m.makeTranslation(it.x, it.y, it.z));
    m.setColorAt(i, _c.set(it.color ?? '#ffffff'));
  });
  g.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  g.setAttribute('aHalf', new THREE.InstancedBufferAttribute(half, 3));
  m.count = n;
  m.name = 'menu:sprites';
  m.castShadow = false;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------- поле меню

/** Кэш геометрий растений на страницу (как у растительности): повторный вход в меню их не строит; не освобождаются. */
const GEOMS = new Map();
function shared(key, make) {
  let g = GEOMS.get(key);
  if (!g) { g = make(); g.userData.menuShared = true; GEOMS.set(key, g); }
  return g;
}

/** InstancedMesh геометрии geom с экземплярами items { x, y, z, s, ry, color }. */
function instances(name, geom, material, items) {
  const m = new THREE.InstancedMesh(geom, material, Math.max(1, items.length));
  items.forEach((it, i) => {
    _q.setFromEuler(_e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0));
    m.setMatrixAt(i, _m.compose(_p.set(it.x, it.y, it.z), _q, _s.setScalar(it.s ?? 1)));
    m.setColorAt(i, _c.set(it.color ?? '#ffffff'));
  });
  m.count = items.length;
  m.visible = items.length > 0;
  m.name = name;
  m.castShadow = false;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

/**
 * Растения меню по раскладке plants { trees, bushes, hedges, rocks, sprites } (menuWorld.js) — с интерфейсом поля
 * растительности окружения: group, stats, plants, configure, update, dispose; ещё setAtlas(color, normal).
 * trees: { v, near, x, y, z, s, ry, color } — near: шапки и ствол, иначе импостер tree<v> в поле спрайтов.
 */
/**
 * Пучок травы (геометрия, не спрайт): 14 изогнутых узких травинок по 4 отрезка в круге 0,2 м, высота 0,12–0,34 м;
 * у основания тёмные, к кончику светлые (линейный цвет); нормаль ближе к вертикали — травинки освещаются как газон.
 */
/** Цвет травинки (линейный): основание и кончик. */
// у основания — в тени газона, кончик — в цвет освещённого газона, а не соломенно-жёлтый (на тёплом солнце газона
// прежний кончик светился бледной соломой)
const GRASS_BASE = [0.13, 0.27, 0.055], GRASS_TIP = [0.28, 0.51, 0.094];
/**
 * Травинки видны только вблизи камеры: полная высота до GRASS_FADE[0] м, к GRASS_FADE[1] м пучок сжимается в точку
 * (вырожденные треугольники не растеризуются). На референсе травинки различимы только на переднем плане, дальше газон гладкий.
 */
export const GRASS_FADE = [13, 29];
/** Травинок в пучке (по 3 сегмента). */
const GRASS_BLADES = 15;

export function grassClumpGeometry(seed = 7) {
  const rng = createRng(seed), pos = [], nor = [], col = [], idx = [], flex = [];
  // цвет — как альбедо газона (рисованный газон × окраска земли): основание чуть темнее, кончик светлее — без «волосков»
  const base = new THREE.Color().setRGB(GRASS_BASE[0], GRASS_BASE[1], GRASS_BASE[2]), tip = new THREE.Color().setRGB(GRASS_TIP[0], GRASS_TIP[1], GRASS_TIP[2]), c = new THREE.Color();
  for (let k = 0; k < GRASS_BLADES; k++) { // короткий густой газон, как на переднем плане референса, а не редкие высокие стебли
    const a = Math.floor(k/3)*2.399, r = 0.14+0.055*Math.sin(3.4*a), x0 = Math.cos(a)*r+rng.uniform(-0.018,0.018), z0 = Math.sin(a)*r+rng.uniform(-0.017,0.017);
    const h = rng.uniform(0.068,0.205), w = rng.uniform(0.009,0.019), lean = rng.uniform(0.36,1.08), dir = a+rng.uniform(-1.55,1.55);
    const dx = Math.cos(dir), dz = Math.sin(dir), sx = -dz, sz = dx, v0 = pos.length / 3, tone = rng.uniform(0.88, 1.12);
    for (let i = 0; i <= 3; i++) {
      const t=i/3, bend=lean*h*t*t, y=h*(t-0.26*lean*t*t*t), half=w*(1-t*t)*(0.35+0.33*Math.sin(Math.PI*t));
      c.copy(base).lerp(tip, Math.pow(t, 0.8)).multiplyScalar(tone);
      for (let side=0;side<(i===3?1:2);side++) {
        const sgn=side*2-1, twist=0.55*t;
        pos.push(x0+dx*bend+(sx+twist*dx)*half*sgn,y+half*t*sgn*0.24,z0+dz*bend+(sz+twist*dz)*half*sgn);
        nor.push(dx*0.22+sgn*sx*0.08,0.96,dz*0.22+sgn*sz*0.08);
        const light=(0.68+0.32*t)*(1+sgn*0.035);
        col.push(c.r*light,c.g*light,c.b*light); flex.push(h*t*t);
      }
    }
    for (let i=0;i<2;i++) { const q=v0+i*2; idx.push(q,q+1,q+3,q,q+3,q+2); }
    idx.push(v0+4,v0+5,v0+6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aLeafBend',new THREE.Float32BufferAttribute(flex,1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.name = 'menu:grassClump';
  return g;
}

/** Материал травинок: свет газона (envLit ground, запечённые тени), двусторонний, вершинный цвет, LOD по расстоянию. */
function grassBladeMaterial() {
  return customMat('menu:grassBlades', () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      // нормаль травинки — почти нормаль газона с обеих сторон: без переворота у изнанки (иначе изнанка смотрит в землю и чернеет)
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);`);
      Object.assign(shader.uniforms,{uTime:VEG_UNIFORMS.uTime,uWind:VEG_UNIFORMS.uWind});
      shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aLeafBend;\nuniform vec2 uWind; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 grassRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float detail = 1.0 - smoothstep(${GRASS_FADE[0].toFixed(1)}, ${GRASS_FADE[1].toFixed(1)}, distance(grassRoot,cameraPosition));
        transformed *= detail;
        vec2 bladeWind = uWind * (aLeafBend*detail*(0.11+0.09*sin(1.6*uTime+dot(grassRoot.xz,vec2(0.35,0.23)))));
        `).replace('#include <project_vertex>',THREE.ShaderChunk.project_vertex.replace('gl_Position =','mvPosition.xyz += viewMatrix[0].xyz*bladeWind.x + viewMatrix[2].xyz*bladeWind.y;\ngl_Position ='));
    };
    m.customProgramCacheKey = () => 'menuGrassBlades';
    return envLit(m, { shade: true, ground: true });
  });
}

// Два общих батча на форму. Матрицы и цвета перекладываются только при смене
// состава батча. В переходе тот же размер на экране даёт шейдеру долю каждого яруса.
function menuTreeBatch(items, variant, material, add) {
  const make = lod => add(instances(`menu:tree:${variant}${lod ? '' : ':near'}`,
    shared(`tree:${variant}:${lod}`, () => treeGeometry(variant,lod)),material,items));
  const close = make(0), mid = make(1);
  close.count = 0; close.visible = false;
  const radius = Math.round(8*FLORA.trees[variant].h)/16, slots = items.map((tree,i) => {
    const matrix = new THREE.Matrix4(), color = new THREE.Color(), r = radius*tree.s;
    mid.getMatrixAt(i,matrix); mid.getColorAt(i,color);
    return { matrix, color, radius: r, bound: new THREE.Sphere(new THREE.Vector3(tree.x,tree.y+r,tree.z),1.55*r), mask: 2 };
  });
  for (const m of [close,mid]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
  const counts = { close: 0, mid: items.length, blend: 0 };
  return (eye,projection,frustum) => {
    let dirty = false;
    for (const slot of slots) {
      const b = slot.bound;
      // Сфера кроны шире её полувысоты у некоторых деревьев. Добавка также покрывает ветер.
      const inView = frustum.intersectsSphere(b);
      const px = projection*slot.radius/Math.max(0.001,b.center.distanceTo(eye));
      const mask = inView ? (px > TREE_FOCUS_FROM ? 1 : 0) | (px < TREE_FOCUS_TO ? 2 : 0) : 0;
      if (mask !== slot.mask) { dirty = true; slot.mask = mask; }
    }
    if (!dirty) return counts;
    close.count = mid.count = 0;
    counts.blend = 0;
    for (const slot of slots) {
      if (slot.mask & 1) { close.setColorAt(close.count,slot.color); close.setMatrixAt(close.count++,slot.matrix); }
      if (slot.mask & 2) { mid.setColorAt(mid.count,slot.color); mid.setMatrixAt(mid.count++,slot.matrix); }
      if (slot.mask === 3) counts.blend++;
    }
    close.visible = close.count > 0; mid.visible = mid.count > 0;
    close.instanceMatrix.needsUpdate = close.instanceColor.needsUpdate = close.visible;
    mid.instanceMatrix.needsUpdate = mid.instanceColor.needsUpdate = mid.visible;
    counts.close = close.count; counts.mid = mid.count;
    return counts;
  };
}

export function createMenuFlora(plants, terrainSurface) {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'vegetation';
  group.visible = false; // до атласа
  const meshes = [];
  let config = { lite: false, wind: true };
  const add = (m, sprites = false) => {
    m.userData.floraSprites = sprites;
    m.onBeforeRender = noAlphaBefore;
    m.onAfterRender = noAlphaAfter;
    meshes.push(m); group.add(m); return m;
  };
  // LOD листвы по пресету: [high, lite] — геометрия меняется в configure (программа та же)
  const lods = (m, key, make) => { m.userData.lods = [m.geometry, shared(key, make)]; return m; };
  const mesh = floraMaterial(config);
  const treeBatches = [], treeFrustum = new THREE.Frustum(), treeClip = new THREE.Matrix4(), lastClip = new THREE.Matrix4(), eye = new THREE.Vector3();
  const near = plants.trees.filter((t) => t.near);
  for (let v = 0; v < FLORA.trees.length; v++) {
    const list = near.filter((t) => t.v === v);
    if (list.length) treeBatches.push(menuTreeBatch(list,v,mesh,add));
  }
  const bushKinds = new Map();
  for (const b of plants.bushes) {
    const key = `${b.v}:${b.bloom ?? -1}`;
    if (!bushKinds.has(key)) bushKinds.set(key, []);
    bushKinds.get(key).push(b);
  }
  for (const [key, list] of bushKinds) {
    const [v, bloom] = key.split(':').map(Number);
    lods(add(instances(`menu:bush:${key}`, shared(`bush:${key}:0`, () => bushGeometry(v, bloom, 0)), mesh, list)), `bush:${key}:1`, () => bushGeometry(v, bloom, 1));
  }
  if (plants.hedges.length) lods(add(instances('menu:hedge', shared('hedge:0', () => hedgeGeometry(0)), mesh, plants.hedges)), 'hedge:1', () => hedgeGeometry(1));
  // торцы концов рядов изгороди (cap: 1 — начало ряда, −x сегмента; 2 — конец, +x): экземпляр — крайний сегмент
  const caps = [];
  for (const h of plants.hedges) {
    if (h.cap & 1) caps.push({ ...h, ry: h.ry + Math.PI });
    if (h.cap & 2) caps.push(h);
  }
  if (caps.length) lods(add(instances('menu:hedgecap', shared('hedgecap:0', () => hedgeCapGeometry(0)), mesh, caps)), 'hedgecap:1', () => hedgeCapGeometry(1));
  if (plants.rocks.length) add(instances('menu:rock', shared('rock', () => rockGeometry(0)), mesh, plants.rocks));
  // необязательное (пучки травы, полевые цветы лугов, часть дальнего леса — opt) — в конце поля: на medium и low его
  // отсекает count (деталь high, рычаг цены кадра; вызов тот же)
  const isGrass = (it) => it.sprite === 'grassA' || it.sprite === 'grassB' || it.opt;
  const sprites = plants.sprites.filter((it) => !isGrass(it)), grass = plants.sprites.filter(isGrass);
  for (const t of plants.trees) {
    if (t.near) continue;
    const [hw, h] = SPRITE_SIZE['tree' + t.v], k = FLORA.trees[t.v].h * 1.12 * t.s;
    // импостер утоплен ниже развилки (она на 0,32–0,34 высоты, низ кроны — на 0,38–0,46): виден короткий ствол, как у
    // дальних деревьев референса, — роща стоит на склоне, а не висит; длинный ствол «леденца» уходит в траву.
    // На холмах (за 180 м) чуть глубже: склон под кроной круче
    const sink = 0.27 + 0.05 * Math.min(1, Math.max(0, (Math.hypot(t.x, t.z) - 180) / 120));
    (t.opt ? grass : sprites).push({ sprite: 'tree' + t.v, x: t.x, y: t.y - sink * h * k, z: t.z, w: hw * k, h: h * k, color: t.color });
  }
  const spriteItems = [...sprites, ...grass];
  const spriteMesh = add(spriteField(spriteItems, floraMaterial({ ...config, sprites: true })), true);
  const spruces = menuSpruceDetail(spriteItems, spriteMesh, group, terrainSurface);
  let currentAtlas = null;
  // травинки газона (геометрия): свой материал — не через applyMaterials; только high
  let blades = null;
  if (plants.blades?.length) {
    blades = instances('menu:grassBlades', shared('grassClump', () => grassClumpGeometry()), grassBladeMaterial(), plants.blades);
    blades.instanceColor = null;
    group.add(blades);
  }
  const spriteCount = { all: sprites.length + grass.length, lite: sprites.length };
  const genMs = performance.now() - t0;
  const all = [...plants.trees, ...plants.bushes, ...plants.hedges, ...plants.rocks, ...plants.sprites];
  const stats = { cpuMs: 0, visible: all.length, lod: [0, near.length, plants.trees.length - near.length], fading: 0, updates: 0, grass: 0, genMs };

  function applyMaterials() {
    for (const m of meshes) {
      m.material = floraMaterial({ ...config, sprites: m.userData.floraSprites });
      if (m.userData.lods) m.geometry = m.userData.lods[config.lite ? 1 : 0];
    }
  }

  return {
    group, stats,
    get plants() { return all; },
    get config() { return config; },
    mesh: (name) => group.getObjectByName(name),
    /** Цветовой атлас (sRGB) и нормали меню (линейные); растения появляются. */
    setAtlas(color, normal) {
      currentAtlas = color;
      spruces?.configure(config, color);
      normal.colorSpace = THREE.NoColorSpace;
      normal.needsUpdate = true;
      for (const lite of [false, true]) for (const sp of [false, true]) for (const wind of [false, true]) {
        const m = floraMaterial({ lite, sprites: sp, wind });
        m.map = color;
      }
      FLORA_UNIFORMS.uFloraNormal.value = normal;
      group.visible = true;
    },
    /** Блок PRESETS[*].veg: лёгкий материал, ветер; на лёгком (medium, low) — без пучков травы. */
    configure(veg = {}) {
      config = { lite: !!veg.lite, wind: veg.wind !== false };
      applyMaterials();
      spriteMesh.count = config.lite ? spriteCount.lite : spriteCount.all;
      spruces?.configure(config, currentAtlas);
      lastClip.elements[15] = NaN;
      if (blades) blades.visible = !config.lite; // травинки — деталь high
    },
    update(dt, t, camera) {
      VEG_UNIFORMS.uTime.value = Number.isFinite(t) ? t : VEG_UNIFORMS.uTime.value + (dt || 0);
      VEG_UNIFORMS.uWind.value.set(0.78, 0.32);
      if (!camera?.isPerspectiveCamera) return;
      camera.updateWorldMatrix(true,false);
      treeClip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      if (treeClip.equals(lastClip)) return;
      const start = performance.now();
      lastClip.copy(treeClip); eye.setFromMatrixPosition(camera.matrixWorld);
      treeFrustum.setFromProjectionMatrix(treeClip,camera.coordinateSystem,camera.reversedDepth);
      spruces?.update(eye, treeFrustum);
      const projection = 1080*camera.projectionMatrix.elements[5];
      stats.lod[0] = stats.lod[1] = stats.fading = 0;
      for (const update of treeBatches) {
        const counts = update(eye,projection,treeFrustum);
        stats.lod[0] += counts.close; stats.lod[1] += counts.mid; stats.fading += counts.blend;
      }
      stats.visible = all.length - near.length + stats.lod[0] + stats.lod[1] - stats.fading;
      stats.cpuMs = performance.now()-start; stats.updates++;
    },
    dispose() {
      spruces?.dispose();
      for (const m of meshes) { if (!m.geometry.userData.menuShared) m.geometry.dispose(); m.dispose(); m.removeFromParent(); }
      meshes.length = 0;
    },
  };
}
