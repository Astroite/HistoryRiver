"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";

import {
  createHistoryGeography,
  type HistoryGeographyComponent,
} from "@/app/history-geography-visuals";
import {
  createHistoryPostProcessing,
  createHistoryVisuals,
  type HistoryVisualComponent,
} from "@/app/history-river-visuals";
import renderData from "@/data/history/generated/render-data.json";
import {
  RIVER_START_YEAR,
  buildRenderPersonThreadGeometry,
  historicalYearToY,
  type RenderHistoryDataset,
} from "@/lib/history/model";
import { UE5EditorCameraControls } from "@/lib/viewport/ue5-editor-camera-controls";

const historyData = renderData as unknown as RenderHistoryDataset;

type SceneDebugComponent =
  | HistoryVisualComponent
  | HistoryGeographyComponent
  | "personThreads";
type DebugComponent = SceneDebugComponent | "vignette";
type ComponentVisibility = Record<DebugComponent, boolean>;

interface DebugComponentGroup {
  label: string;
  items: Array<{ id: DebugComponent; label: string }>;
}

const DEBUG_COMPONENT_GROUPS: DebugComponentGroup[] = [
  {
    label: "历史数据",
    items: [
      { id: "personThreads", label: "人物年度轨迹" },
      { id: "annualSlices", label: "历史地理切片" },
      { id: "longitudinalFibers", label: "历史地理纵线" },
    ],
  },
  {
    label: "历史长河",
    items: [
      { id: "waterfallFibers", label: "瀑布光纤" },
      { id: "waterfallParticles", label: "瀑布粒子" },
      { id: "ocean", label: "人民光海" },
      { id: "oceanCrests", label: "海面潮脊" },
      { id: "confluence", label: "河口汇流" },
      { id: "seaFoam", label: "浪花" },
      { id: "deepSeaDust", label: "深海尘光" },
    ],
  },
  {
    label: "环境",
    items: [
      { id: "stars", label: "星空" },
      { id: "clouds", label: "云层" },
      { id: "glows", label: "光晕与雾" },
      { id: "vignette", label: "画面暗角" },
    ],
  },
];

function createDefaultComponentVisibility(): ComponentVisibility {
  return {
    personThreads: true,
    annualSlices: true,
    longitudinalFibers: true,
    waterfallFibers: true,
    waterfallParticles: true,
    ocean: true,
    oceanCrests: true,
    confluence: true,
    seaFoam: true,
    deepSeaDust: true,
    stars: true,
    clouds: true,
    glows: true,
    vignette: true,
  };
}

function subscribeToLocationChange(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getDebugModeSnapshot() {
  return new URLSearchParams(window.location.search).has("debug");
}

function getServerDebugModeSnapshot() {
  return false;
}

function HistoryDebugMenu({
  visibility,
  onChange,
  onSetAll,
}: {
  visibility: ComponentVisibility;
  onChange: (component: DebugComponent, visible: boolean) => void;
  onSetAll: (visible: boolean) => void;
}) {
  return (
    <aside className="history-debug-menu" aria-label="调试菜单">
      <header className="history-debug-header">
        <span className="history-debug-badge">DEBUG</span>
        <h2>场景组件</h2>
      </header>
      <div className="history-debug-actions">
        <button type="button" onClick={() => onSetAll(true)}>
          全部显示
        </button>
        <button type="button" onClick={() => onSetAll(false)}>
          全部隐藏
        </button>
      </div>
      {DEBUG_COMPONENT_GROUPS.map((group) => (
        <fieldset key={group.label} className="history-debug-group">
          <legend>{group.label}</legend>
          {group.items.map((item) => (
            <label key={item.id} className="history-debug-toggle">
              <span>{item.label}</span>
              <input
                type="checkbox"
                checked={visibility[item.id]}
                onChange={(event) => onChange(item.id, event.currentTarget.checked)}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <p className="history-debug-hint">移除地址中的 debug 参数即可关闭菜单</p>
    </aside>
  );
}

interface HistoryRiverDiagnostics {
  datasetVersion: string;
  personCount: number;
  personYearCount: number;
  frameTimeMs: number[];
  render: { calls: number; points: number; lines: number; triangles: number };
  memory: { geometries: number; textures: number };
}

declare global {
  interface Window {
    __historyRiverDiagnostics?: HistoryRiverDiagnostics;
  }
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) {
      object.geometry.dispose();
    }
    if ("material" in object) {
      const material = object.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    }
  });
}

function createPersonThreads(data: RenderHistoryDataset): {
  object: THREE.LineSegments;
  material: THREE.ShaderMaterial;
} {
  const threadData = buildRenderPersonThreadGeometry(data);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(threadData.positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(threadData.colors, 3));
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(threadData.alpha, 1));
  geometry.setAttribute(
    "aPersonIndex",
    new THREE.BufferAttribute(threadData.personIndices, 1),
  );
  geometry.setAttribute("aYearIndex", new THREE.BufferAttribute(threadData.yearIndices, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uOpacity: { value: 0.7 },
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aAlpha;
      attribute float aPersonIndex;
      attribute float aYearIndex;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vPhase;

      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vPhase = fract(aYearIndex * 0.011 + aPersonIndex * 0.071);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uFlow;
      uniform float uOpacity;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vPhase;

      void main() {
        float flowPhase = fract(vPhase - uTime * 0.000035 * uFlow);
        float glint = smoothstep(0.0, 0.045, flowPhase)
          * (1.0 - smoothstep(0.045, 0.16, flowPhase));
        vec3 celestial = vec3(0.53, 0.66, 0.76);
        vec3 color = mix(celestial, vColor, 0.48);
        color = mix(color, vec3(0.94, 0.84, 0.65), glint * 0.38);
        float alpha = uOpacity * vAlpha * (0.58 + glint * 0.72);
        if (alpha <= 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = 3;
  object.frustumCulled = false;
  object.userData.datasetVersion = data.manifest.version;
  object.userData.personCount = data.manifest.personCount;
  object.userData.personYearCount = data.manifest.personYearCount;
  object.userData.ranges = threadData.ranges;
  return { object, material };
}

export function HistoryRiver() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneComponentsRef = useRef<
    Partial<Record<SceneDebugComponent, THREE.Object3D>>
  >({});
  const debugEnabled = useSyncExternalStore(
    subscribeToLocationChange,
    getDebugModeSnapshot,
    getServerDebugModeSnapshot,
  );
  const [componentVisibility, setComponentVisibility] = useState(
    createDefaultComponentVisibility,
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lowMotion = motionPreference.matches;
    const syncMotionPreference = () => {
      lowMotion = motionPreference.matches;
    };
    motionPreference.addEventListener("change", syncMotionPreference);

    const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory ?? 8;
    const quality = navigator.hardwareConcurrency <= 4
      || deviceMemory <= 4
      || (window.innerWidth <= 520 && window.devicePixelRatio > 1.5)
      ? "reduced"
      : "default";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02070b);
    scene.fog = new THREE.FogExp2(0x02070b, 0.0032);

    const cameraTarget = new THREE.Vector3(-18, 49, 4);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1_600);
    camera.position.set(54, 46, 238);
    camera.up.set(0, 1, 0);
    camera.lookAt(cameraTarget);

    const renderer = new THREE.WebGLRenderer({
      antialias: quality === "default",
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, quality === "default" ? 1.5 : 1),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // Post-processing renders several composers per frame; disable per-pass resets so
    // development diagnostics can report the complete frame, then reset explicitly.
    renderer.info.autoReset = false;
    renderer.domElement.className = "history-canvas";
    renderer.domElement.setAttribute(
      "aria-label",
      `由 ${historyData.manifest.personCount} 位跨时代核心人物逐年轨迹构成的可自由浏览历史长河三维场景`,
    );
    mount.appendChild(renderer.domElement);

    const cameraControls = new UE5EditorCameraControls(
      camera,
      renderer.domElement,
      {
        pivot: cameraTarget,
        focusDistance: camera.position.distanceTo(cameraTarget),
      },
    );

    const riverGroup = new THREE.Group();
    scene.add(riverGroup);
    const visuals = createHistoryVisuals({
      seed: 1729,
      topY: historicalYearToY(RIVER_START_YEAR) + 36,
      quality,
    });
    riverGroup.add(visuals.root);
    const geography = createHistoryGeography();
    riverGroup.add(geography.root);
    const personThreads = createPersonThreads(historyData);
    riverGroup.add(personThreads.object);
    sceneComponentsRef.current = {
      ...visuals.components,
      ...geography.components,
      personThreads: personThreads.object,
    };

    const postProcessing = createHistoryPostProcessing(
      renderer,
      scene,
      camera,
      quality,
      visuals.setOceanBloomPass,
    );

    const diagnostics: HistoryRiverDiagnostics | null = process.env.NODE_ENV === "development"
      ? {
          datasetVersion: historyData.manifest.version,
          personCount: historyData.manifest.personCount,
          personYearCount: historyData.manifest.personYearCount,
          frameTimeMs: [],
          render: { calls: 0, points: 0, lines: 0, triangles: 0 },
          memory: { geometries: 0, textures: 0 },
        }
      : null;
    if (diagnostics) window.__historyRiverDiagnostics = diagnostics;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
      postProcessing.resize(rect.width, rect.height);
      visuals.resize(rect.width, rect.height, renderer.getPixelRatio());
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let previousFrameTime = 0;
    renderer.setAnimationLoop((now) => {
      renderer.info.reset();
      const deltaSeconds = previousFrameTime > 0 ? (now - previousFrameTime) / 1_000 : 0;
      if (diagnostics && previousFrameTime > 0) {
        diagnostics.frameTimeMs.push(now - previousFrameTime);
        if (diagnostics.frameTimeMs.length > 600) diagnostics.frameTimeMs.shift();
      }
      previousFrameTime = now;
      cameraControls.update(deltaSeconds);
      geography.update(now, lowMotion);
      visuals.update(now, lowMotion);
      personThreads.material.uniforms.uTime.value = lowMotion ? 0 : now;
      personThreads.material.uniforms.uFlow.value = lowMotion ? 0 : 1;
      postProcessing.render();
      if (diagnostics) {
        diagnostics.render = { ...renderer.info.render };
        diagnostics.memory = { ...renderer.info.memory };
      }
    });

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      motionPreference.removeEventListener("change", syncMotionPreference);
      cameraControls.dispose();
      if (diagnostics && window.__historyRiverDiagnostics === diagnostics) {
        delete window.__historyRiverDiagnostics;
      }
      visuals.dispose();
      postProcessing.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
      sceneComponentsRef.current = {};
    };
  }, []);

  useEffect(() => {
    for (const [component, visible] of Object.entries(componentVisibility)) {
      if (component === "vignette") continue;
      const object = sceneComponentsRef.current[component as SceneDebugComponent];
      if (object) object.visible = visible;
    }
  }, [componentVisibility]);

  const changeComponentVisibility = (
    component: DebugComponent,
    visible: boolean,
  ) => {
    setComponentVisibility((current) => ({
      ...current,
      [component]: visible,
    }));
  };

  const setAllComponentsVisible = (visible: boolean) => {
    setComponentVisibility((current) => {
      const next = { ...current };
      for (const component of Object.keys(next) as DebugComponent[]) {
        next[component] = visible;
      }
      return next;
    });
  };

  return (
    <main className="history-shell">
      <div ref={mountRef} className="history-stage" />
      <div
        className="history-vignette"
        aria-hidden="true"
        hidden={!componentVisibility.vignette}
      />
      {debugEnabled ? (
        <HistoryDebugMenu
          visibility={componentVisibility}
          onChange={changeComponentVisibility}
          onSetAll={setAllComponentsVisible}
        />
      ) : null}
    </main>
  );
}
