import { ShaderChunk } from 'three';

// Самый грубый уровень PMREM хранит рассеянное освещение нормали.
// Его грани имеют по 16 текселей независимо от размера исходного захвата неба.
export const vertexCubeUV = `
#define CUBEUV_TEXEL_WIDTH (1.0 / float(textureSize(envMap, 0).x))
#define CUBEUV_TEXEL_HEIGHT (1.0 / float(textureSize(envMap, 0).y))
#define CUBEUV_MAX_MIP log2(float(textureSize(envMap, 0).y) * 0.25)
#include <cube_uv_reflection_fragment>`;

/** Для матовых поверхностей с плавными нормалями. Карты покрытия, прямой свет и тени остаются попиксельными. */
export function vertexDiffuseSky(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      #ifdef USE_ENVMAP
        #define ENVMAP_TYPE_CUBE_UV
        #include <envmap_common_pars_fragment>
        ${vertexCubeUV}
        varying vec3 vSkyIrradiance;
      #endif`)
    .replace('#include <normal_vertex>', `#include <normal_vertex>
      #ifdef USE_ENVMAP
        vec3 skyNormal = envMapRotation * transformNormalByInverseViewMatrix(vNormal, viewMatrix);
        vSkyIrradiance = PI * envMapIntensity * bilinearCubeUV(envMap, skyNormal, cubeUV_m0);
      #endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n#ifdef USE_ENVMAP\nvarying vec3 vSkyIrradiance;\n#endif')
    .replace('#include <lights_fragment_maps>', ShaderChunk.lights_fragment_maps.replace('getIBLIrradiance( geometryNormal )', 'vSkyIrradiance'));
}

// У фона и газона нет локальных источников. Освещение треугольника плоской земли
// постоянно, но граница тени может проходить через него и требует полного фильтра PCF.
const terrainLight = `
#if NUM_POINT_LIGHTS == 0 && NUM_SPOT_LIGHTS == 0 && NUM_SUN_LIGHTS == 0 && NUM_RECT_AREA_LIGHTS == 0 && NUM_DIR_LIGHT_SHADOWS <= 1 && !defined(USE_LIGHT_PROBES) && !defined(USE_LIGHT_PROBES_GRID)
  #define TERRAIN_VERTEX_LIGHT
  varying vec3 vTerrainFill, vTerrainSun;
#endif`;

export function terrainDiffuseLight(shader) {
  vertexDiffuseSky(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <envmap_pars_vertex>', `#include <envmap_pars_vertex>
      ${terrainLight}
      #ifdef TERRAIN_VERTEX_LIGHT
        #include <lights_pars_begin>
      #endif`)
    .replace('#include <fog_vertex>', `#include <fog_vertex>
      #ifdef TERRAIN_VERTEX_LIGHT
        vTerrainFill = ambientLightColor;
        vTerrainSun = vec3(0.);
        #ifdef USE_ENVMAP
          vTerrainFill += vSkyIrradiance;
        #endif
        #pragma unroll_loop_start
        for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
          vTerrainFill += getHemisphereLightIrradiance(hemisphereLights[i],vNormal);
        }
        #pragma unroll_loop_end
        #pragma unroll_loop_start
        for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
          #if defined(USE_SHADOWMAP) && UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS
            vTerrainSun += directionalLights[i].color * max(0.,dot(vNormal,directionalLights[i].direction));
          #else
            vTerrainFill += directionalLights[i].color * max(0.,dot(vNormal,directionalLights[i].direction));
          #endif
        }
        #pragma unroll_loop_end
        vTerrainFill *= RECIPROCAL_PI;
        vTerrainSun *= RECIPROCAL_PI;
      #endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n'+terrainLight)
    .replace('#include <lights_lambert_fragment>', `#ifdef TERRAIN_VERTEX_LIGHT
      float shade = 1.;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
        DirectionalLightShadow sun = directionalLightShadows[0];
        if (receiveShadow) shade = getShadow(directionalShadowMap[0],sun.shadowMapSize,sun.shadowIntensity,
          sun.shadowBias,sun.shadowRadius,vDirectionalShadowCoord[0]);
      #endif
      reflectedLight.directDiffuse = diffuseColor.rgb*(vTerrainFill + shade*vTerrainSun);
      #else
      #include <lights_lambert_fragment>`)
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n#endif');
}
