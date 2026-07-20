import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

import {
  RENDER_DERIVATION,
  buildRenderPersonThreadGeometry,
  type RenderDerivationCode,
  type RenderHistoryDataset,
} from "@/lib/history/model";

export type PersonIsolationMode = "dim" | "isolate";
export type PersonThreadLayer = "life" | "evidence" | "anchors";
export type PersonThreadLayerVisibility = Record<PersonThreadLayer, boolean>;

export interface PersonEvidenceSummary {
  evidenceSpanIndex: number;
  startYear: number;
  endYear: number;
  locationLabel: string;
  derivation: RenderDerivationCode;
  uncertainty: number;
}

export interface PersonThreadRig {
  root: THREE.Group;
  update(now: number, lowMotion: boolean): void;
  resize(width: number, height: number): void;
  setSelection(personIndex: number | null): void;
  setIsolationMode(mode: PersonIsolationMode): void;
  setLayerVisibility(visibility: PersonThreadLayerVisibility): void;
  getPersonBounds(personIndex: number): THREE.Box3 | null;
  dispose(): void;
}

const DEFAULT_LAYER_VISIBILITY: PersonThreadLayerVisibility = {
  life: true,
  evidence: true,
  anchors: true,
};

function createLineSegmentsGeometry(
  positions: Float32Array,
  colors: Float32Array,
  alpha: Float32Array,
  personIndices: Float32Array,
  yearIndices: Float32Array,
  derivations: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
  geometry.setAttribute("aPersonIndex", new THREE.BufferAttribute(personIndices, 1));
  geometry.setAttribute("aYearIndex", new THREE.BufferAttribute(yearIndices, 1));
  geometry.setAttribute("aDerivation", new THREE.BufferAttribute(derivations, 1));
  return geometry;
}

function createThreadMaterial(opacity: number, evidence: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uOpacity: { value: opacity },
      uSelectedPersonIndex: { value: -1 },
      uIsolationMode: { value: 0 },
      uDimOpacity: { value: 0.05 },
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aAlpha;
      attribute float aPersonIndex;
      attribute float aYearIndex;
      attribute float aDerivation;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vPhase;
      varying float vPersonIndex;
      varying float vYearIndex;
      varying float vDerivation;

      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vPhase = fract(aYearIndex * 0.011 + aPersonIndex * 0.071);
        vPersonIndex = aPersonIndex;
        vYearIndex = aYearIndex;
        vDerivation = aDerivation;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uFlow;
      uniform float uOpacity;
      uniform float uSelectedPersonIndex;
      uniform float uIsolationMode;
      uniform float uDimOpacity;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vPhase;
      varying float vPersonIndex;
      varying float vYearIndex;
      varying float vDerivation;

      void main() {
        float selectionGain = 1.0;
        if (uSelectedPersonIndex >= 0.0 && abs(vPersonIndex - uSelectedPersonIndex) > 0.25) {
          if (uIsolationMode > 1.5) discard;
          selectionGain = uDimOpacity;
        }
        if (vDerivation > 2.5 && fract(vYearIndex * 0.62) > 0.58) discard;
        float flowPhase = fract(vPhase - uTime * 0.000035 * uFlow);
        float glint = smoothstep(0.0, 0.045, flowPhase)
          * (1.0 - smoothstep(0.045, 0.16, flowPhase));
        vec3 celestial = vec3(0.53, 0.66, 0.76);
        vec3 color = mix(celestial, vColor, ${evidence ? "0.72" : "0.42"});
        color = mix(color, vec3(0.98, 0.88, 0.69), glint * ${evidence ? "0.48" : "0.28"});
        float alpha = uOpacity * vAlpha * (0.58 + glint * 0.72) * selectionGain;
        if (alpha <= 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

function createAnchorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSelectedPersonIndex: { value: -1 },
      uIsolationMode: { value: 0 },
      uDimOpacity: { value: 0.05 },
    },
    vertexShader: `
      attribute float aPersonIndex;
      uniform float uSelectedPersonIndex;
      varying float vPersonIndex;

      void main() {
        vPersonIndex = aPersonIndex;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = abs(aPersonIndex - uSelectedPersonIndex) < 0.25 ? 4.5 : 2.2;
      }
    `,
    fragmentShader: `
      uniform float uSelectedPersonIndex;
      uniform float uIsolationMode;
      uniform float uDimOpacity;
      varying float vPersonIndex;

      void main() {
        float selectionGain = 1.0;
        if (uSelectedPersonIndex >= 0.0 && abs(vPersonIndex - uSelectedPersonIndex) > 0.25) {
          if (uIsolationMode > 1.5) discard;
          selectionGain = uDimOpacity;
        }
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float alpha = (1.0 - smoothstep(0.18, 0.5, distanceFromCenter)) * selectionGain;
        if (alpha <= 0.004) discard;
        gl_FragColor = vec4(0.88, 0.94, 1.0, alpha * 0.88);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function segmentRangeToPolyline(
  positions: Float32Array,
  startSegment: number,
  segmentCount: number,
): number[] {
  if (segmentCount <= 0) return [];
  const result: number[] = [];
  const firstVertex = startSegment * 2;
  result.push(
    positions[firstVertex * 3],
    positions[firstVertex * 3 + 1],
    positions[firstVertex * 3 + 2],
  );
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const vertex = (startSegment + segment) * 2 + 1;
    result.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
  }
  return result;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if ("geometry" in child && child.geometry instanceof THREE.BufferGeometry) {
      child.geometry.dispose();
    }
    if ("material" in child) {
      const material = child.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
  });
}

function lineMaterial(
  color: number,
  lineWidth: number,
  opacity: number,
  depthTest: boolean,
  dashed = false,
): LineMaterial {
  const material = new LineMaterial({
    color,
    linewidth: lineWidth,
    worldUnits: false,
    transparent: true,
    opacity,
    depthTest,
    depthWrite: false,
    dashed,
    dashSize: 1.4,
    gapSize: 0.9,
  });
  material.resolution.set(1, 1);
  return material;
}

function addWideLine(
  group: THREE.Group,
  positions: number[],
  material: LineMaterial,
  layer: PersonThreadLayer,
): Line2 | null {
  if (positions.length < 6) {
    material.dispose();
    return null;
  }
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.frustumCulled = false;
  line.renderOrder = material.depthTest ? 8 : 9;
  line.userData.personThreadLayer = layer;
  group.add(line);
  return line;
}

export function summarizePersonEvidence(
  dataset: RenderHistoryDataset,
  personIndex: number,
): PersonEvidenceSummary[] {
  const runs = new Map<number, typeof dataset.personYears>();
  for (const record of dataset.personYears) {
    if (record[0] !== personIndex || record[8] < 0) continue;
    const run = runs.get(record[8]) ?? [];
    run.push(record);
    runs.set(record[8], run);
  }
  return [...runs.entries()].map(([evidenceSpanIndex, records]) => {
    const first = records[0];
    const last = records[records.length - 1];
    return {
      evidenceSpanIndex,
      startYear: first[1],
      endYear: last[1],
      locationLabel: dataset.locations[first[7]]?.label ?? "插值路径",
      derivation: first[6],
      uncertainty: records.reduce((sum, record) => sum + record[5], 0) / records.length,
    };
  });
}

export function derivationLabel(derivation: RenderDerivationCode): string {
  if (derivation === RENDER_DERIVATION.attested) return "单年实证";
  if (derivation === RENDER_DERIVATION.bounded) return "范围记录";
  if (derivation === RENDER_DERIVATION.interpolated) return "明确插值";
  return "地点未知";
}

export function createPersonThreadRig(data: RenderHistoryDataset): PersonThreadRig {
  const threadData = buildRenderPersonThreadGeometry(data);
  const root = new THREE.Group();
  root.userData.datasetVersion = data.manifest.version;
  root.userData.personCount = data.manifest.personCount;
  root.userData.personYearCount = data.manifest.personYearCount;

  const lifeMaterial = createThreadMaterial(0.62, false);
  const life = new THREE.LineSegments(
    createLineSegmentsGeometry(
      threadData.positions,
      threadData.colors,
      threadData.alpha,
      threadData.personIndices,
      threadData.yearIndices,
      new Float32Array(threadData.alpha.length),
    ),
    lifeMaterial,
  );
  life.renderOrder = 3;
  life.frustumCulled = false;
  root.add(life);

  const evidenceMaterial = createThreadMaterial(0.9, true);
  const evidence = new THREE.LineSegments(
    createLineSegmentsGeometry(
      threadData.evidencePositions,
      threadData.evidenceColors,
      threadData.evidenceAlpha,
      threadData.evidencePersonIndices,
      threadData.evidenceYearIndices,
      threadData.evidenceDerivations,
    ),
    evidenceMaterial,
  );
  evidence.renderOrder = 4;
  evidence.frustumCulled = false;
  root.add(evidence);

  const anchorGeometry = new THREE.BufferGeometry();
  anchorGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(threadData.anchorPositions, 3),
  );
  anchorGeometry.setAttribute(
    "aPersonIndex",
    new THREE.BufferAttribute(threadData.anchorPersonIndices, 1),
  );
  const anchorMaterial = createAnchorMaterial();
  const anchors = new THREE.Points(anchorGeometry, anchorMaterial);
  anchors.renderOrder = 5;
  anchors.frustumCulled = false;
  root.add(anchors);

  const selected = new THREE.Group();
  root.add(selected);
  let selectedPersonIndex: number | null = null;
  let isolationMode: PersonIsolationMode = "dim";
  let layerVisibility = { ...DEFAULT_LAYER_VISIBILITY };
  const resolution = new THREE.Vector2(1, 1);

  const materialsWithSelection = [lifeMaterial, evidenceMaterial, anchorMaterial];
  const syncSelectionUniforms = () => {
    const personIndex = selectedPersonIndex ?? -1;
    const mode = selectedPersonIndex === null ? 0 : isolationMode === "dim" ? 1 : 2;
    for (const material of materialsWithSelection) {
      material.uniforms.uSelectedPersonIndex.value = personIndex;
      material.uniforms.uIsolationMode.value = mode;
    }
  };

  const applyLayerVisibility = () => {
    life.visible = layerVisibility.life;
    evidence.visible = layerVisibility.evidence;
    anchors.visible = layerVisibility.anchors;
    for (const child of selected.children) {
      const layer = child.userData.personThreadLayer as PersonThreadLayer | undefined;
      child.visible = layer ? layerVisibility[layer] : true;
    }
  };

  const clearSelected = () => {
    for (const child of [...selected.children]) {
      selected.remove(child);
      disposeObject(child);
    }
  };

  const rebuildSelected = () => {
    clearSelected();
    if (selectedPersonIndex === null) return;
    const personRange = threadData.ranges[selectedPersonIndex];
    if (!personRange) return;
    const lifePositions = segmentRangeToPolyline(
      threadData.positions,
      personRange.startSegment,
      personRange.segmentCount,
    );
    const halo = addWideLine(
      selected,
      lifePositions,
      lineMaterial(0xffb65c, 6, 0.28, false),
      "life",
    );
    const core = addWideLine(
      selected,
      lifePositions,
      lineMaterial(0xffedd0, 2.2, 0.98, true),
      "life",
    );
    if (halo) halo.material.resolution.copy(resolution);
    if (core) core.material.resolution.copy(resolution);

    for (const range of threadData.evidenceRanges) {
      if (range.personIndex !== selectedPersonIndex || range.segmentCount <= 0) continue;
      const positions = segmentRangeToPolyline(
        threadData.evidencePositions,
        range.startSegment,
        range.segmentCount,
      );
      const interpolated = range.derivation === RENDER_DERIVATION.interpolated;
      const line = addWideLine(
        selected,
        positions,
        lineMaterial(0xa9ddff, 3, interpolated ? 0.68 : 0.96, true, interpolated),
        "evidence",
      );
      if (line) line.material.resolution.copy(resolution);
    }

    const selectedAnchorPositions: number[] = [];
    for (let index = 0; index < threadData.anchorPersonIndices.length; index += 1) {
      if (threadData.anchorPersonIndices[index] !== selectedPersonIndex) continue;
      selectedAnchorPositions.push(
        threadData.anchorPositions[index * 3],
        threadData.anchorPositions[index * 3 + 1],
        threadData.anchorPositions[index * 3 + 2],
      );
    }
    if (selectedAnchorPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(selectedAnchorPositions, 3),
      );
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: 0xffffff,
          size: 6,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.96,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      points.renderOrder = 10;
      points.frustumCulled = false;
      points.userData.personThreadLayer = "anchors";
      selected.add(points);
    }
    applyLayerVisibility();
  };

  return {
    root,
    update(now, lowMotion) {
      for (const material of [lifeMaterial, evidenceMaterial]) {
        material.uniforms.uTime.value = lowMotion ? 0 : now;
        material.uniforms.uFlow.value = lowMotion ? 0 : 1;
      }
    },
    resize(width, height) {
      resolution.set(Math.max(1, width), Math.max(1, height));
      selected.traverse((child) => {
        if (child instanceof Line2) child.material.resolution.copy(resolution);
      });
    },
    setSelection(personIndex) {
      if (selectedPersonIndex === personIndex) return;
      selectedPersonIndex = personIndex;
      syncSelectionUniforms();
      rebuildSelected();
    },
    setIsolationMode(mode) {
      isolationMode = mode;
      syncSelectionUniforms();
    },
    setLayerVisibility(visibility) {
      layerVisibility = { ...visibility };
      applyLayerVisibility();
    },
    getPersonBounds(personIndex) {
      const bounds = threadData.ranges[personIndex]?.bounds;
      if (!bounds) return null;
      return new THREE.Box3(
        new THREE.Vector3(...bounds.min),
        new THREE.Vector3(...bounds.max),
      );
    },
    dispose() {
      clearSelected();
    },
  };
}
