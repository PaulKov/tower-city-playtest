import { OCEAN_GLSL, OCEAN_WIND, OCEAN_TIME, SHORE_R, WATER_Y } from './oceanSurface.js';

// Возмущение поверхности в системе координат гавани. Каждая сцена владеет своим
// набором uniforms, все уровни детализации её моря читают один и тот же набор.
const LIMIT = 2;

export function createWaterContacts() {
  return {
    uContactCount: {value: 0},
    uContactCenters: {value: new Float32Array(4 * LIMIT)},
    uContactFlow: {value: new Float32Array(4 * LIMIT)},
  };
}

export function updateWaterContacts(field, records, visibility = 1) {
  let count = 0;
  const centers = field.uContactCenters.value, flow = field.uContactFlow.value;
  for (let i = 0; i < records.length && count < LIMIT; i++) {
    const r = records[i], m = r?.motion;
    if (!m?.site?.bed || m.kind !== 'swim' || !(r.pose.scale > 0)) continue;
    const a = m.actor, immersion = Math.min(1, (m.waterY - a.y) / (.40 * m.height));
    if (!(immersion > .01)) continue;
    const j = 4 * count++, speed = Math.hypot(m.vx, m.vz);
    centers[j] = a.x; centers[j + 1] = a.z;
    centers[j + 2] = r.pose.scale; centers[j + 3] = immersion * visibility;
    flow[j] = speed > .005 ? m.vx / speed : Math.sin(a.yaw);
    flow[j + 1] = speed > .005 ? m.vz / speed : Math.cos(a.yaw);
    flow[j + 2] = Math.min(1, speed / (1.3 * m.scale));
    flow[j + 3] = r.pose.natureSplash || 0;
  }
  field.uContactCount.value = count;
}

// Знаковый зазор до кромки прямоугольной акватории в координатах толпы.
export const WATER_BANK_GLSL = `
attribute vec4 aWaterBank;
attribute vec2 aWaterSpan;
float waterBankClearance(vec2 point) {
  vec2 q=point-aWaterBank.xy, normal=aWaterBank.zw;
  float inward=-dot(q,normal), along=dot(q,vec2(normal.y,-normal.x));
  return aWaterSpan.x<=0. ? 1. : min(min(inward,aWaterSpan.y-inward),aWaterSpan.x-abs(along));
}`;

// Высота, две производные по горизонтали и доля пены на гребне.
// Наклон вычисляется аналитически. Кольца расходятся от тела, расходящийся
// след вдоль двух плеч за кормой появляется только при поступательном движении.
export const WATER_CONTACT_GLSL = `
uniform int uContactCount;
uniform vec4 uContactCenters[2];
uniform vec4 uContactFlow[2];
vec4 waterContact(vec2 p, float time) {
  vec4 result = vec4(0.);
  for (int i = 0; i < 2; i++) {
    if (i >= uContactCount) break;
    vec4 center = uContactCenters[i], flow = uContactFlow[i];
    vec2 q = (p - center.xy) / center.z;
    if (dot(q, q) > 11.) continue;
    vec2 ahead = flow.xy, across = vec2(ahead.y, -ahead.x);
    float x = dot(q, across), z = dot(q, ahead);
    float radius = max(.001, length(vec2(x * 1.32, z)));
    vec2 radial = (1.7424 * x * across + z * ahead) / radius;
    float body = exp(-7. * radius * radius);
    float ring = radius - .46, amp = (.011 + .016 * flow.w) * exp(-2.6 * ring * ring);
    float phase = 12. * ring - 4.5 * time;
    float ripple = amp * sin(phase);
    float slope = amp * (12. * cos(phase) - 5.2 * ring * sin(phase)) + .28 * radius * body;
    float aft = max(0., -z), fan = abs(x) - .31 - .42 * aft;
    float start = clamp(aft/.5, 0., 1.), end = clamp((aft-1.8)/1.2, 0., 1.);
    float rise = start*start*(3.-2.*start), fall = 1.-end*end*(3.-2.*end);
    float crest = .026 * flow.z * exp(-13. * fan * fan);
    float wake = crest * rise * fall;
    float alongSlope = crest * (12.*start*(1.-start)*fall - 5.*end*(1.-end)*rise);
    vec2 wakeSlope = -26. * fan * wake * (sign(x)*across + .42*ahead) - alongSlope*ahead;
    float edge = clamp((radius-2.6)/.6, 0., 1.);
    float fade = center.w * (1.-edge*edge*(3.-2.*edge));
    float height = ripple + wake - .020 * body;
    // У начала и конца следа меняется сама амплитуда гребня.
    vec2 gradient = fade * (radial*slope + wakeSlope) - center.w*10.*edge*(1.-edge)*height*radial;
    result += vec4(center.z*fade*height, gradient, fade*(3.6*wake + max(0.,ripple)*(1.5+flow.w)));
  }
  return result;
}`;

// Широкая дуга следа пересекает несколько разных высот. Подгоняем к воде
// каждую её вершину теми же волнами, которыми деформировано само море.
export function followCoastSurface(shader, field, lift, condition = 'true') {
  if (!field) return;
  Object.assign(shader.uniforms, field, {uSurfaceTime: OCEAN_TIME, uSurfaceWind: OCEAN_WIND});
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float uSurfaceTime;
uniform vec2 uSurfaceWind;
${OCEAN_GLSL}
${WATER_CONTACT_GLSL}`).replace('#include <project_vertex>', `
if (${condition}) {
  vec2 q = (instanceMatrix * vec4(transformed, 1.)).xz;
  float scale = length(instanceMatrix[0].xyz);
  float h = ${WATER_Y} + oceanSurface(q, uSurfaceTime, ${SHORE_R}, uSurfaceWind).x;
  if (uContactCount > 0) h += waterContact(q, uSurfaceTime).x;
  transformed.y += (h - instanceMatrix[3].y) / scale + ${lift};
}
#include <project_vertex>`);
}
