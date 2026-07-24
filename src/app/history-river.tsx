"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";

import {
  createHistoryGeography,
  type HistoryGeographyComponent,
} from "@/app/history-geography-visuals";
import { HistoryExperience } from "@/app/history-experience";
import {
  createHistoryPostProcessing,
  createHistoryVisuals,
  type HistoryVisualComponent,
} from "@/app/history-river-visuals";
import {
  createPersonThreadRig,
  derivationLabel,
  summarizePersonEvidence,
  type PersonIsolationMode,
  type PersonThreadLayer,
  type PersonThreadLayerVisibility,
  type PersonThreadRig,
} from "@/app/history-person-threads";
import renderData from "@/data/history/generated/render-data.json";
import {
  RIVER_START_YEAR,
  historicalYearToIndex,
  historicalYearToY,
  yToHistoricalYear,
  yearIndexToHistoricalYear,
  type RenderEraRecord,
  type RenderHistoryDataset,
} from "@/lib/history/model";
import { RiverCameraControls } from "@/lib/viewport/river-camera-controls";

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

const DEFAULT_THREAD_LAYER_VISIBILITY: PersonThreadLayerVisibility = {
  life: true,
  evidence: true,
  anchors: true,
};

const THREAD_LAYER_LABELS: Array<{ id: PersonThreadLayer; label: string }> = [
  { id: "life", label: "生命时间线（含地点未知年份）" },
  { id: "evidence", label: "有据地点段" },
  { id: "anchors", label: "证据节点" },
];

function formatHistoricalYear(year: number | null): string {
  if (year === null) return "未知";
  return year < 0 ? `公元前 ${Math.abs(year)} 年` : `公元 ${year} 年`;
}

function HistoryDebugMenu({
  visibility,
  onChange,
  onSetAll,
  selectedPersonIndex,
  onSelectPerson,
  isolationMode,
  onIsolationModeChange,
  threadLayers,
  onThreadLayerChange,
  onFocusPerson,
}: {
  visibility: ComponentVisibility;
  onChange: (component: DebugComponent, visible: boolean) => void;
  onSetAll: (visible: boolean) => void;
  selectedPersonIndex: number | null;
  onSelectPerson: (personIndex: number | null) => void;
  isolationMode: PersonIsolationMode;
  onIsolationModeChange: (mode: PersonIsolationMode) => void;
  threadLayers: PersonThreadLayerVisibility;
  onThreadLayerChange: (layer: PersonThreadLayer, visible: boolean) => void;
  onFocusPerson: () => void;
}) {
  const [personFilter, setPersonFilter] = useState("");
  const selectedPerson = selectedPersonIndex === null
    ? null
    : historyData.people[selectedPersonIndex];
  const normalizedFilter = personFilter.trim().toLocaleLowerCase("zh-CN");
  const filteredPeople = historyData.people
    .map((person, index) => ({ person, index }))
    .filter(({ person, index }) =>
      normalizedFilter.length === 0
      || index === selectedPersonIndex
      || person.canonicalName.toLocaleLowerCase("zh-CN").includes(normalizedFilter)
      || person.id.toLowerCase().includes(normalizedFilter));
  const evidence = useMemo(
    () => selectedPersonIndex === null
      ? []
      : summarizePersonEvidence(historyData, selectedPersonIndex),
    [selectedPersonIndex],
  );

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
      <section className="history-person-debug" aria-labelledby="history-person-debug-title">
        <h3 id="history-person-debug-title">单人物调试</h3>
        <label className="history-debug-field">
          <span>搜索人物</span>
          <input
            type="search"
            value={personFilter}
            placeholder="中文姓名或 ID"
            onChange={(event) => setPersonFilter(event.currentTarget.value)}
          />
        </label>
        <label className="history-debug-field">
          <span>当前人物</span>
          <select
            value={selectedPersonIndex ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onSelectPerson(value === "" ? null : Number(value));
            }}
          >
            <option value="">未选择</option>
            {filteredPeople.map(({ person, index }) => (
              <option key={person.id} value={index}>
                {person.canonicalName} · {person.id}
              </option>
            ))}
          </select>
        </label>
        {selectedPerson ? (
          <>
            <div className="history-person-summary">
              <strong>{selectedPerson.canonicalName}</strong>
              <span>{selectedPerson.id}</span>
              <span>
                轨迹：{formatHistoricalYear(selectedPerson.trajectoryStartYear)}—
                {formatHistoricalYear(selectedPerson.trajectoryEndYear)}
              </span>
              <span>
                生卒：{formatHistoricalYear(selectedPerson.birthYear)}—
                {formatHistoricalYear(selectedPerson.deathYear)}
              </span>
            </div>
            <div className="history-debug-segmented" role="group" aria-label="人物隔离模式">
              <button
                type="button"
                aria-pressed={isolationMode === "dim"}
                onClick={() => onIsolationModeChange("dim")}
              >
                弱化其他人物
              </button>
              <button
                type="button"
                aria-pressed={isolationMode === "isolate"}
                onClick={() => onIsolationModeChange("isolate")}
              >
                仅显示此人物
              </button>
            </div>
            <button type="button" className="history-debug-focus" onClick={onFocusPerson}>
              镜头定位到此人物
            </button>
            <fieldset className="history-debug-group history-thread-layers">
              <legend>人物轨迹图层</legend>
              {THREAD_LAYER_LABELS.map((item) => (
                <label key={item.id} className="history-debug-toggle">
                  <span>{item.label}</span>
                  <input
                    type="checkbox"
                    checked={threadLayers[item.id]}
                    onChange={(event) =>
                      onThreadLayerChange(item.id, event.currentTarget.checked)}
                  />
                </label>
              ))}
            </fieldset>
            <div className="history-evidence-list">
              <h4>地点证据 · {evidence.length}</h4>
              {evidence.length > 0 ? (
                <ol>
                  {evidence.map((item) => (
                    <li key={item.evidenceSpanIndex}>
                      <strong>{item.locationLabel}</strong>
                      <span>
                        {formatHistoricalYear(item.startYear)}
                        {item.endYear === item.startYear
                          ? ""
                          : `—${formatHistoricalYear(item.endYear)}`}
                      </span>
                      <span>
                        {derivationLabel(item.derivation)} · 不确定度
                        {Math.round(item.uncertainty * 100)}%
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>该人物暂无有据地点，仅显示生命时间线。</p>
              )}
            </div>
          </>
        ) : (
          <p className="history-debug-empty">选择人物后可隔离、高亮并查看地点证据。</p>
        )}
      </section>
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

interface HistorySceneApi {
  camera: THREE.PerspectiveCamera;
  controls: RiverCameraControls;
  rig: PersonThreadRig;
  element: HTMLCanvasElement;
}

function eraGlideTargetY(era: RenderEraRecord): number {
  const middleIndex = Math.round(
    (historicalYearToIndex(era.startYear, RIVER_START_YEAR)
      + historicalYearToIndex(era.endYear, RIVER_START_YEAR)) / 2,
  );
  return historicalYearToY(yearIndexToHistoricalYear(middleIndex, RIVER_START_YEAR));
}

export function HistoryRiver() {
  const mountRef = useRef<HTMLDivElement>(null);
  const personThreadRigRef = useRef<PersonThreadRig | null>(null);
  const focusPersonRef = useRef<(personIndex: number) => void>(() => undefined);
  const flyTargetYRef = useRef<number | null>(null);
  const currentYearRef = useRef<number | null>(null);
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
  const [selectedPersonIndex, setSelectedPersonIndex] = useState<number | null>(null);
  const [isolationMode, setIsolationMode] = useState<PersonIsolationMode>("dim");
  const [threadLayerVisibility, setThreadLayerVisibility] = useState(
    DEFAULT_THREAD_LAYER_VISIBILITY,
  );
  const [sceneApi, setSceneApi] = useState<HistorySceneApi | null>(null);
  const [currentYear, setCurrentYear] = useState<number | null>(null);
  const [prologueOpen, setPrologueOpen] = useState(true);
  const [hoveredPersonIndex, setHoveredPersonIndex] = useState<number | null>(null);
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(
    null,
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

    const cameraControls = new RiverCameraControls(
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
    const personThreads = createPersonThreadRig(historyData);
    personThreadRigRef.current = personThreads;
    riverGroup.add(personThreads.root);
    sceneComponentsRef.current = {
      ...visuals.components,
      ...geography.components,
      personThreads: personThreads.root,
    };
    focusPersonRef.current = (personIndex) => {
      const bounds = personThreads.getPersonBounds(personIndex);
      if (!bounds) return;
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const limitingFov = Math.min(verticalFov, horizontalFov);
      const distance = Math.max(
        8,
        sphere.radius / Math.max(0.1, Math.sin(limitingFov / 2)) * 1.25,
      );
      cameraControls.focusTargetAt(sphere.center, distance);
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
      personThreads.resize(rect.width, rect.height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    setSceneApi({
      camera,
      controls: cameraControls,
      rig: personThreads,
      element: renderer.domElement,
    });

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
      if (flyTargetYRef.current !== null) {
        const remaining = flyTargetYRef.current - cameraControls.pivot.y;
        const step = Math.abs(remaining) < 0.02
          ? remaining
          : remaining * (1 - Math.exp(-Math.max(deltaSeconds, 0.008) * 2.6));
        cameraControls.pivot.y += step;
        camera.position.y += step;
        if (Math.abs(flyTargetYRef.current - cameraControls.pivot.y) < 0.02) {
          flyTargetYRef.current = null;
        }
      }
      const year = yToHistoricalYear(cameraControls.pivot.y);
      if (year !== currentYearRef.current) {
        currentYearRef.current = year;
        setCurrentYear(year);
      }
      geography.update(now, lowMotion);
      visuals.update(now, lowMotion);
      personThreads.update(now, lowMotion);
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
      personThreads.dispose();
      postProcessing.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
      personThreadRigRef.current = null;
      focusPersonRef.current = () => undefined;
      sceneComponentsRef.current = {};
      flyTargetYRef.current = null;
      currentYearRef.current = null;
      setSceneApi(null);
    };
  }, []);

  useEffect(() => {
    for (const [component, visible] of Object.entries(componentVisibility)) {
      if (component === "vignette") continue;
      const object = sceneComponentsRef.current[component as SceneDebugComponent];
      if (object) object.visible = visible;
    }
  }, [componentVisibility]);

  useEffect(() => {
    personThreadRigRef.current?.setSelection(selectedPersonIndex);
  }, [selectedPersonIndex]);

  useEffect(() => {
    personThreadRigRef.current?.setIsolationMode(isolationMode);
  }, [isolationMode]);

  useEffect(() => {
    personThreadRigRef.current?.setLayerVisibility(threadLayerVisibility);
  }, [threadLayerVisibility]);

  useEffect(() => {
    if (!sceneApi) return;
    const { camera, rig, element } = sceneApi;
    let pickFrame = 0;
    let pendingPointer: { x: number; y: number } | null = null;
    let pressStart: { x: number; y: number; time: number; altKey: boolean } | null = null;

    const clearHover = () => {
      pendingPointer = null;
      setHoveredPersonIndex(null);
      setPointerPosition(null);
      rig.setHovered(null);
      element.style.cursor = "";
    };

    const runPick = () => {
      pickFrame = 0;
      if (!pendingPointer) return;
      const rect = element.getBoundingClientRect();
      const hit = rig.pickPerson(
        camera,
        pendingPointer.x - rect.left,
        pendingPointer.y - rect.top,
        rect.width,
        rect.height,
      );
      setHoveredPersonIndex(hit);
      setPointerPosition(hit === null ? null : { ...pendingPointer });
      rig.setHovered(hit);
      element.style.cursor = hit === null ? "" : "pointer";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (event.buttons !== 0) {
        if (pendingPointer) clearHover();
        return;
      }
      pendingPointer = { x: event.clientX, y: event.clientY };
      if (pickFrame === 0) pickFrame = requestAnimationFrame(runPick);
    };

    const onPointerDown = (event: PointerEvent) => {
      setPrologueOpen(false);
      flyTargetYRef.current = null;
      if (event.button === 0) {
        pressStart = {
          x: event.clientX,
          y: event.clientY,
          time: performance.now(),
          altKey: event.altKey,
        };
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !pressStart) return;
      const { x, y, time, altKey } = pressStart;
      pressStart = null;
      const moved = Math.hypot(event.clientX - x, event.clientY - y);
      if (altKey || moved > 6 || performance.now() - time > 600) return;
      const rect = element.getBoundingClientRect();
      const hit = rig.pickPerson(
        camera,
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        20,
      );
      setSelectedPersonIndex(hit);
    };

    const onWheel = () => {
      flyTargetYRef.current = null;
      setPrologueOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") setSelectedPersonIndex(null);
    };

    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointerleave", clearHover);
    element.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointerleave", clearHover);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      if (pickFrame !== 0) cancelAnimationFrame(pickFrame);
    };
  }, [sceneApi]);

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

  const changeThreadLayerVisibility = (
    layer: PersonThreadLayer,
    visible: boolean,
  ) => {
    setThreadLayerVisibility((current) => ({ ...current, [layer]: visible }));
  };

  const selectPerson = (personIndex: number | null, focus = false) => {
    setSelectedPersonIndex(personIndex);
    if (focus && personIndex !== null) focusPersonRef.current(personIndex);
  };

  const glideToEra = (era: RenderEraRecord) => {
    setPrologueOpen(false);
    flyTargetYRef.current = eraGlideTargetY(era);
  };

  return (
    <main className="history-shell">
      <div ref={mountRef} className="history-stage" />
      <div
        className="history-vignette"
        aria-hidden="true"
        hidden={!componentVisibility.vignette}
      />
      <HistoryExperience
        data={historyData}
        currentYear={currentYear}
        prologueOpen={prologueOpen}
        onPrologueChange={setPrologueOpen}
        hoveredPersonIndex={hoveredPersonIndex}
        pointerPosition={pointerPosition}
        selectedPersonIndex={selectedPersonIndex}
        isolationMode={isolationMode}
        onIsolationModeChange={setIsolationMode}
        onEraSelect={glideToEra}
        onPersonSelect={selectPerson}
      />
      {debugEnabled ? (
        <HistoryDebugMenu
          visibility={componentVisibility}
          onChange={changeComponentVisibility}
          onSetAll={setAllComponentsVisible}
          selectedPersonIndex={selectedPersonIndex}
          onSelectPerson={setSelectedPersonIndex}
          isolationMode={isolationMode}
          onIsolationModeChange={setIsolationMode}
          threadLayers={threadLayerVisibility}
          onThreadLayerChange={changeThreadLayerVisibility}
          onFocusPerson={() => {
            if (selectedPersonIndex !== null) focusPersonRef.current(selectedPersonIndex);
          }}
        />
      ) : null}
    </main>
  );
}
