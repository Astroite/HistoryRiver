import * as THREE from "three";

import {
  abstractMountainRidges,
  buildGeographyVolume,
  geographyContourAt,
} from "@/lib/history/geography-volume";
import {
  CONTENT_END_YEAR,
  RIVER_START_YEAR,
  abstractChina,
  historicalYearToY,
  type ExperienceState,
} from "@/lib/history/model";

export interface HistoryGeographyRig {
  root: THREE.Group;
  update(
    now: number,
    focusYear: number,
    view: ExperienceState,
    lowMotion: boolean,
  ): void;
}

const volumeOpacity: Record<ExperienceState, number> = {
  "river-overview": 0.0028,
  "entering-window": 0.007,
  slice: 0.0045,
  "person-focus": 0.003,
  "relation-focus": 0.0025,
};

const longitudinalOpacity: Record<ExperienceState, number> = {
  "river-overview": 0.038,
  "entering-window": 0.03,
  slice: 0.008,
  "person-focus": 0.005,
  "relation-focus": 0.004,
};

const sliceOpacity: Record<ExperienceState, number> = {
  "river-overview": 0,
  "entering-window": 0.12,
  slice: 0.46,
  "person-focus": 0.22,
  "relation-focus": 0.14,
};

// 视图距离代理：远景总览≈1，逐步贴近切片≈0。着色器据此在"整体流体"与"个体年轮"间过渡。
const viewDistance: Record<ExperienceState, number> = {
  "river-overview": 1,
  "entering-window": 0.6,
  slice: 0.12,
  "person-focus": 0.2,
  "relation-focus": 0.3,
};

function createVolumeMaterial(opacity: number, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFocusYear: { value: -515 },
      uFocusRadius: { value: 14 },
      uOpacity: { value: opacity },
      uStartYear: { value: RIVER_START_YEAR },
      uEndYear: { value: CONTENT_END_YEAR },
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uLongitudinal: { value: additive ? 1 : 0 },
      // 视图距离 0(贴近切片)→1(远景总览)：越远越收敛为整体流体，越近越显个体年轮。
      uViewDistance: { value: 1 },
    },
    vertexShader: `
      attribute float aYear;
      attribute float aUncertainty;

      varying vec3 vColor;
      varying float vFocus;
      varying float vUncertainty;
      varying float vEra;
      varying float vFlowOffset;

      uniform float uFocusYear;
      uniform float uFocusRadius;
      uniform float uStartYear;
      uniform float uEndYear;

      // 这些颜色是对各时期礼制与器物色彩的低饱和视觉转译，不作为唯一官方色断言。
      vec3 historicalPeriodColor(float year) {
        vec3 color = vec3(0.33, 0.46, 0.43); // 上古与先秦：青铜青
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
        vFocus = 1.0 - smoothstep(0.0, uFocusRadius, abs(aYear - uFocusYear));
        vUncertainty = aUncertainty;
        vEra = era;
        vFlowOffset = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vFocus;
      varying float vUncertainty;
      varying float vEra;
      varying float vFlowOffset;

      uniform float uOpacity;
      uniform float uViewDistance;
      uniform float uTime;
      uniform float uFlow;
      uniform float uLongitudinal;

      void main() {
        // 不确定度越高，边缘越暗、色温略偏冷（资料稀疏区不伪装成确定疆界）。
        float confidence = 1.0 - vUncertainty;
        vec3 color = mix(vColor, vColor * vec3(0.82, 0.88, 1.0), vUncertainty * 0.5);
        // 远景放大焦点对比，贴近时抬升整体上下文，形成沉积层的体量感。
        float focusGain = mix(0.62, 1.0, uViewDistance);
        float baseFloor = mix(0.5, 0.34, uViewDistance);
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
          * mix(baseFloor, 1.0, vFocus * focusGain)
          * mix(0.55, 1.0, confidence)
          * (1.0 + flowLight * 0.72);
        if (alpha <= 0.0005) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function createConstraintLine(
  path: ReadonlyArray<readonly [number, number]>,
  color: number,
): THREE.Line {
  const points = path.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(curve.getPoints(72)),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
}

export function createHistoryGeography(): HistoryGeographyRig {
  const root = new THREE.Group();
  const volume = buildGeographyVolume({
    contourSamples: 48,
    longitudinalStride: 4,
  });

  const sliceGeometry = new THREE.BufferGeometry();
  sliceGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(volume.slicePositions, 3),
  );
  sliceGeometry.setAttribute(
    "aYear",
    new THREE.BufferAttribute(volume.sliceYears, 1),
  );
  sliceGeometry.setAttribute(
    "aUncertainty",
    new THREE.BufferAttribute(volume.sliceUncertainty, 1),
  );
  const sliceMaterial = createVolumeMaterial(volumeOpacity["river-overview"], false);
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
  const longitudinalMaterial = createVolumeMaterial(
    longitudinalOpacity["river-overview"],
    true,
  );
  const longitudinalFibers = new THREE.LineSegments(
    longitudinalGeometry,
    longitudinalMaterial,
  );
  longitudinalFibers.renderOrder = 2;
  longitudinalFibers.frustumCulled = false;
  root.add(longitudinalFibers);

  const focusGroup = new THREE.Group();
  focusGroup.renderOrder = 4;
  root.add(focusGroup);

  const focusSamples = 96;
  const focusPositions = new Float32Array(focusSamples * 3);
  const focusGeometry = new THREE.BufferGeometry();
  const focusPositionAttribute = new THREE.BufferAttribute(focusPositions, 3);
  focusPositionAttribute.setUsage(THREE.DynamicDrawUsage);
  focusGeometry.setAttribute("position", focusPositionAttribute);
  const focusMaterial = new THREE.LineBasicMaterial({
    color: 0xe9dfca,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const focusBoundary = new THREE.LineLoop(focusGeometry, focusMaterial);
  focusBoundary.renderOrder = 5;
  focusGroup.add(focusBoundary);

  const riverLines = [
    createConstraintLine(abstractChina.rivers.yellow, 0xc4ad87),
    createConstraintLine(abstractChina.rivers.yangtze, 0x789cb9),
  ];
  const mountainLines = abstractMountainRidges.map((ridge) =>
    createConstraintLine(ridge, 0x728596),
  );
  focusGroup.add(...riverLines, ...mountainLines);

  let lastFocusYear = Number.NaN;
  const updateFocusBoundary = (year: number) => {
    const roundedYear = Math.round(year);
    if (roundedYear === lastFocusYear) return;
    lastFocusYear = roundedYear;
    const contour = geographyContourAt(roundedYear, focusSamples);
    for (let index = 0; index < focusSamples; index += 1) {
      focusPositions[index * 3] = contour[index][0];
      focusPositions[index * 3 + 1] = 0;
      focusPositions[index * 3 + 2] = contour[index][1];
    }
    focusPositionAttribute.needsUpdate = true;
    focusGeometry.computeBoundingSphere();
  };
  updateFocusBoundary(-515);

  return {
    root,
    update(now, focusYear, view, lowMotion) {
      const transition = lowMotion ? 0.18 : 0.08;
      sliceMaterial.uniforms.uFocusYear.value = focusYear;
      longitudinalMaterial.uniforms.uFocusYear.value = focusYear;
      sliceMaterial.uniforms.uTime.value = now;
      longitudinalMaterial.uniforms.uTime.value = now;
      sliceMaterial.uniforms.uFlow.value = lowMotion ? 0 : 1;
      longitudinalMaterial.uniforms.uFlow.value = lowMotion ? 0 : 1;
      const targetViewDistance = viewDistance[view];
      sliceMaterial.uniforms.uViewDistance.value +=
        (targetViewDistance - sliceMaterial.uniforms.uViewDistance.value) * transition;
      longitudinalMaterial.uniforms.uViewDistance.value +=
        (targetViewDistance - longitudinalMaterial.uniforms.uViewDistance.value) * transition;
      sliceMaterial.uniforms.uOpacity.value +=
        (volumeOpacity[view] - sliceMaterial.uniforms.uOpacity.value) * transition;
      longitudinalMaterial.uniforms.uOpacity.value +=
        (longitudinalOpacity[view] - longitudinalMaterial.uniforms.uOpacity.value) * transition;

      const horizontalScale = view === "river-overview"
        ? 0.72
        : view === "entering-window"
          ? 0.86
          : 1;
      const horizontalOffset = view === "river-overview"
        ? 6
        : view === "entering-window"
          ? 2.4
          : 0;
      root.scale.x += (horizontalScale - root.scale.x) * transition;
      root.scale.z += (horizontalScale - root.scale.z) * transition;
      root.position.x += (horizontalOffset - root.position.x) * transition;

      updateFocusBoundary(focusYear);
      focusGroup.position.y = historicalYearToY(focusYear) + 0.035;
      const targetSliceOpacity = sliceOpacity[view];
      focusMaterial.opacity += (targetSliceOpacity - focusMaterial.opacity) * transition;
      focusGroup.visible = focusMaterial.opacity > 0.002;
      const riverOpacity = targetSliceOpacity * 0.52;
      const mountainOpacity = targetSliceOpacity * 0.28;
      for (const line of riverLines) {
        const material = line.material as THREE.LineBasicMaterial;
        material.opacity += (riverOpacity - material.opacity) * transition;
      }
      for (const line of mountainLines) {
        const material = line.material as THREE.LineBasicMaterial;
        material.opacity += (mountainOpacity - material.opacity) * transition;
      }
    },
  };
}
