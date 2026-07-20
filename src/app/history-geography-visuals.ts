import * as THREE from "three";

import { buildGeographyVolume } from "@/lib/history/geography-volume";
import {
  CONTENT_END_YEAR,
  RIVER_START_YEAR,
} from "@/lib/history/model";

export interface HistoryGeographyRig {
  root: THREE.Group;
  components: Record<HistoryGeographyComponent, THREE.Object3D>;
  update(now: number, lowMotion: boolean): void;
}

export type HistoryGeographyComponent = "annualSlices" | "longitudinalFibers";

const VOLUME_OPACITY = 0.0028;
const LONGITUDINAL_OPACITY = 0.038;

function createVolumeMaterial(opacity: number, longitudinal: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: opacity },
      uStartYear: { value: RIVER_START_YEAR },
      uEndYear: { value: CONTENT_END_YEAR },
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uLongitudinal: { value: longitudinal ? 1 : 0 },
    },
    vertexShader: `
      attribute float aYear;
      attribute float aUncertainty;

      varying vec3 vColor;
      varying float vUncertainty;
      varying float vEra;
      varying float vFlowOffset;

      uniform float uStartYear;
      uniform float uEndYear;

      vec3 historicalPeriodColor(float year) {
        vec3 color = vec3(0.33, 0.46, 0.43);
        color = mix(color, vec3(0.55, 0.25, 0.22), smoothstep(-245.0, -205.0, year));
        color = mix(color, vec3(0.45, 0.50, 0.56), smoothstep(190.0, 250.0, year));
        color = mix(color, vec3(0.72, 0.52, 0.25), smoothstep(565.0, 620.0, year));
        color = mix(color, vec3(0.43, 0.59, 0.55), smoothstep(885.0, 940.0, year));
        color = mix(color, vec3(0.30, 0.43, 0.61), smoothstep(1245.0, 1290.0, year));
        color = mix(color, vec3(0.62, 0.25, 0.22), smoothstep(1345.0, 1385.0, year));
        color = mix(color, vec3(0.68, 0.55, 0.24), smoothstep(1620.0, 1660.0, year));
        color = mix(color, vec3(0.76, 0.70, 0.58), smoothstep(1885.0, 1920.0, year));
        return color;
      }

      void main() {
        float era = clamp((aYear - uStartYear) / (uEndYear - uStartYear), 0.0, 1.0);
        vec3 celestial = vec3(0.53, 0.66, 0.76);
        vec3 ivory = vec3(0.86, 0.84, 0.79);
        vec3 memoryGold = vec3(0.91, 0.80, 0.63);
        vec3 riverColor = era < 0.72
          ? mix(celestial, ivory, smoothstep(0.05, 0.72, era))
          : mix(ivory, memoryGold, smoothstep(0.72, 1.0, era) * 0.72);
        vColor = mix(riverColor, historicalPeriodColor(aYear), 0.22);
        vUncertainty = aUncertainty;
        vEra = era;
        vFlowOffset = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vUncertainty;
      varying float vEra;
      varying float vFlowOffset;

      uniform float uOpacity;
      uniform float uTime;
      uniform float uFlow;
      uniform float uLongitudinal;

      void main() {
        float confidence = 1.0 - vUncertainty;
        vec3 color = mix(vColor, vColor * vec3(0.82, 0.88, 1.0), vUncertainty * 0.5);
        float phase = fract(
          vEra * (7.5 + vFlowOffset * 1.2)
          - uTime * 0.000075 * uFlow
          + vFlowOffset
        );
        float flowLight = smoothstep(0.0, 0.035, phase)
          * (1.0 - smoothstep(0.035, 0.16, phase))
          * uLongitudinal;
        color = mix(color, vec3(0.96, 0.90, 0.74), flowLight * 0.34);
        float alpha = uOpacity
          * mix(0.55, 1.0, confidence)
          * (1.0 + flowLight * 0.72);
        if (alpha <= 0.0005) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: longitudinal ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export function createHistoryGeography(): HistoryGeographyRig {
  const root = new THREE.Group();
  root.scale.set(0.72, 1, 0.72);
  root.position.x = 6;

  const volume = buildGeographyVolume({
    contourSamples: 48,
    longitudinalStride: 4,
  });
  const sliceGeometry = new THREE.BufferGeometry();
  sliceGeometry.setAttribute("position", new THREE.BufferAttribute(volume.slicePositions, 3));
  sliceGeometry.setAttribute("aYear", new THREE.BufferAttribute(volume.sliceYears, 1));
  sliceGeometry.setAttribute(
    "aUncertainty",
    new THREE.BufferAttribute(volume.sliceUncertainty, 1),
  );
  const sliceMaterial = createVolumeMaterial(VOLUME_OPACITY, false);
  const annualSlices = new THREE.LineSegments(sliceGeometry, sliceMaterial);
  annualSlices.renderOrder = 1;
  annualSlices.frustumCulled = false;
  root.add(annualSlices);

  const longitudinalGeometry = new THREE.BufferGeometry();
  longitudinalGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(volume.longitudinalPositions, 3),
  );
  longitudinalGeometry.setAttribute(
    "aYear",
    new THREE.BufferAttribute(volume.longitudinalYears, 1),
  );
  longitudinalGeometry.setAttribute(
    "aUncertainty",
    new THREE.BufferAttribute(volume.longitudinalUncertainty, 1),
  );
  const longitudinalMaterial = createVolumeMaterial(LONGITUDINAL_OPACITY, true);
  const longitudinalFibers = new THREE.LineSegments(
    longitudinalGeometry,
    longitudinalMaterial,
  );
  longitudinalFibers.renderOrder = 2;
  longitudinalFibers.frustumCulled = false;
  root.add(longitudinalFibers);

  return {
    root,
    components: {
      annualSlices,
      longitudinalFibers,
    },
    update(now, lowMotion) {
      const flow = lowMotion ? 0 : 1;
      sliceMaterial.uniforms.uTime.value = now;
      longitudinalMaterial.uniforms.uTime.value = now;
      sliceMaterial.uniforms.uFlow.value = flow;
      longitudinalMaterial.uniforms.uFlow.value = flow;
    },
  };
}
