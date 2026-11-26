// Цветокоррекция high (спецификация §6.4): теплота, насыщенность, контраст, подъём теней и виньетка
// одним полноэкранным проходом в линейном HDR — после bloom, до OutputPass (тональная компрессия и sRGB).
// gradeColor — JS-зеркало шейдера: тест сверяет их на GPU.
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** toneMappingExposure темы по умолчанию: тема задаёт своё значение полем exposure. */
export const DEFAULT_EXPOSURE = 1.05;
/** Окраска, которая не меняет ничего, кроме виньетки: ровно прежний VignetteShader. */
export const GRADE_NEUTRAL = Object.freeze({ contrast: 1, saturation: 1, warmth: 0, lift: 0, vignette: 0.22 });
/** Параметр окраски → uniform шейдера. */
export const GRADE_UNIFORMS = Object.freeze({ contrast: 'uContrast', saturation: 'uSaturation', warmth: 'uWarmth', lift: 'uLift', vignette: 'uVignette' });

const LUMA = [0.2126, 0.7152, 0.0722]; // Rec.709, линейный свет
const PIVOT = 0.18; // средний серый: точка, вокруг которой работает контраст

const uniforms = { tDiffuse: { value: null } };
for (const [k, name] of Object.entries(GRADE_UNIFORMS)) uniforms[name] = { value: GRADE_NEUTRAL[k] };

export const GradeShader = {
  name: 'GradeShader',
  uniforms,
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uContrast, uSaturation, uWarmth, uLift, uVignette;
varying vec2 vUv;
const vec3 LUMA = vec3( ${LUMA.join(', ')} );
const float PIVOT = ${PIVOT.toFixed(2)};
void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  vec3 x = c.rgb * vec3( 1.0 + uWarmth, 1.0, 1.0 - uWarmth );
  x = max( mix( vec3( dot( x, LUMA ) ), x, uSaturation ), 0.0 );
  x = PIVOT * pow( x / PIVOT, vec3( uContrast ) );
  x = uLift + x * ( 1.0 - uLift );
  vec2 d = vUv - 0.5;
  x *= mix( 1.0 - uVignette, 1.0, 1.0 - smoothstep( 0.2, 0.8, dot( d, d ) * 2.2 ) );
  gl_FragColor = vec4( x, c.a );
}`,
};

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * То же, что GradeShader, для одного цвета.
 * @param {number[]} rgb линейный цвет, каналы могут быть больше 1
 * @param {number[]} uv точка экрана, 0..1
 * @param {typeof GRADE_NEUTRAL} grade полный набор параметров
 */
export function gradeColor(rgb, uv, grade) {
  const { contrast, saturation, warmth, lift, vignette } = grade;
  const w = [rgb[0] * (1 + warmth), rgb[1], rgb[2] * (1 - warmth)];
  const y = LUMA[0] * w[0] + LUMA[1] * w[1] + LUMA[2] * w[2];
  const dx = uv[0] - 0.5, dy = uv[1] - 0.5;
  const v = 1 - smoothstep(0.2, 0.8, (dx * dx + dy * dy) * 2.2);
  const f = (1 - vignette) * (1 - v) + v;
  return w.map((c) => {
    const s = Math.max(y + (c - y) * saturation, 0);
    return (lift + PIVOT * Math.pow(s / PIVOT, contrast) * (1 - lift)) * f;
  });
}

/** Проход окраски в composer. Новый проход нейтрален, вид темы задаёт setGrade (GameRenderer.applyEnv). */
export class GradePass extends ShaderPass {
  constructor() { super(GradeShader); } // ShaderPass копирует uniforms: проходы их не делят

  /** Меняет только переданные параметры: applyEnv передаёт полный набор темы, консоль галереи — один для подбора. */
  setGrade(grade) {
    for (const [k, name] of Object.entries(GRADE_UNIFORMS)) {
      if (grade[k] !== undefined) this.uniforms[name].value = grade[k];
    }
  }
}
