"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  createHistoryPostProcessing,
  createHistoryVisuals,
} from "@/app/history-river-visuals";
import { createHistoryGeography } from "@/app/history-geography-visuals";

import {
  DEFAULT_FOCUS_YEAR,
  OBSERVATION_SPAN,
  RIVER_START_YEAR,
  buildFigureThreads,
  guideStateAtSeconds,
  historicalYearToY,
  influenceAt,
  personPositionAt,
  prototypeFixture,
  themeColorFor,
  type ExperienceState,
  type InfluenceDimension,
} from "@/lib/history/model";

// 维度 → 影响力权重目标（one-hot；culture 走独立通道）。切换维度只插值该目标。
const dimensionTargets: Record<
  InfluenceDimension,
  { vec: readonly [number, number, number, number]; culture: number }
> = {
  overall: { vec: [1, 0, 0, 0], culture: 0 },
  political: { vec: [0, 1, 0, 0], culture: 0 },
  military: { vec: [0, 0, 1, 0], culture: 0 },
  thought: { vec: [0, 0, 0, 1], culture: 0 },
  culture: { vec: [0, 0, 0, 0], culture: 1 },
};

// 各体验状态下丝线的显影参数（宽度、辉光、整体不透明度、窗口外上下文亮度、汇流程度）。
const threadStateStyle: Record<
  ExperienceState,
  {
    width: number;
    glow: number;
    opacity: number;
    context: number;
    geoSpread: number;
  }
> = {
  "river-overview": { width: 0.32, glow: 0.32, opacity: 0.3, context: 0, geoSpread: 0 },
  "entering-window": { width: 0.42, glow: 0.5, opacity: 0.5, context: 0.12, geoSpread: 0.55 },
  slice: { width: 0.48, glow: 0.62, opacity: 0.62, context: 0.2, geoSpread: 1 },
  "person-focus": { width: 0.54, glow: 0.7, opacity: 0.7, context: 0.24, geoSpread: 1 },
  "relation-focus": { width: 0.38, glow: 0.46, opacity: 0.4, context: 0.14, geoSpread: 1 },
};

const experienceStates = new Set<ExperienceState>([
  "river-overview",
  "entering-window",
  "slice",
  "person-focus",
  "relation-focus",
]);

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

export function HistoryRiver() {
  const fixture = prototypeFixture;
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ExperienceState>("river-overview");
  const focusYearRef = useRef(DEFAULT_FOCUS_YEAR);
  const dimensionRef = useRef<InfluenceDimension>("overall");
  const selectedPersonRef = useRef(fixture.persons[3].id);
  const selectedRelationRef = useRef(fixture.relations[0].id);
  const hoveredPersonRef = useRef<string | null>(null);
  const cameraDirectedRef = useRef(true);
  const guidePlayingRef = useRef(true);
  const guideEpochRef = useRef(0);
  const lowMotionRef = useRef(false);

  const stopGuide = useCallback(() => {
    guidePlayingRef.current = false;
  }, []);

  const directTo = useCallback(
    (next: ExperienceState) => {
      stopGuide();
      viewRef.current = next;
      cameraDirectedRef.current = true;
    },
    [stopGuide],
  );

  const selectPerson = useCallback(
    (personId: string) => {
      selectedPersonRef.current = personId;
      directTo("person-focus");
    },
    [directTo],
  );

  const selectRelation = useCallback(
    (relationId: string) => {
      selectedRelationRef.current = relationId;
      directTo("relation-focus");
    },
    [directTo],
  );

  const startGuide = useCallback(() => {
    guideEpochRef.current = performance.now();
    guidePlayingRef.current = true;
    viewRef.current = "river-overview";
    cameraDirectedRef.current = true;
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      lowMotionRef.current = media.matches;
    };
    queueMicrotask(syncPreference);
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get("view");
    if (!requestedView || !experienceStates.has(requestedView as ExperienceState)) return;
    guidePlayingRef.current = false;
    viewRef.current = requestedView as ExperienceState;
    cameraDirectedRef.current = true;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") directTo("river-overview");
      if (event.code === "Space" && event.target === document.body) {
        event.preventDefault();
        if (guidePlayingRef.current) stopGuide();
        else startGuide();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [directTo, startGuide, stopGuide]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

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

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 520);
    camera.position.set(50, 34, 218);
    camera.up.set(0, 1, 0);

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
    renderer.domElement.className = "history-canvas";
    renderer.domElement.setAttribute(
      "aria-label",
      "由人物丝线、事件点云和思想丝线构成的三维历史长河；每根丝线是一个人物，粗细与辉光表示其影响力",
    );
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = true;
    controls.minDistance = 7;
    controls.maxDistance = 280;
    controls.target.set(-28, 30, 0);
    controls.addEventListener("start", () => {
      cameraDirectedRef.current = false;
      stopGuide();
    });

    const riverGroup = new THREE.Group();
    scene.add(riverGroup);
    const topY = historicalYearToY(RIVER_START_YEAR);
    const visuals = createHistoryVisuals({
      seed: fixture.seed,
      topY: topY + 36,
      quality,
    });
    riverGroup.add(visuals.root);
    const postProcessing = createHistoryPostProcessing(
      renderer,
      scene,
      camera,
      quality,
      visuals.setOceanBloomPass,
    );
    const geography = createHistoryGeography();
    riverGroup.add(geography.root);

    // --- 人物丝线（带状几何）：每个人物一根贯穿生卒的主题色丝线 ------------------
    const threadData = buildFigureThreads(fixture, {
      stepYears: quality === "default" ? 1 : 2,
    });
    const threadGeometry = new THREE.BufferGeometry();
    threadGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(threadData.positions, 3),
    );
    threadGeometry.setAttribute(
      "aTangent",
      new THREE.BufferAttribute(threadData.tangents, 3),
    );
    threadGeometry.setAttribute("aSide", new THREE.BufferAttribute(threadData.sides, 1));
    threadGeometry.setAttribute(
      "aActiveCurve",
      new THREE.BufferAttribute(threadData.activeCurve, 1),
    );
    threadGeometry.setAttribute(
      "aInfluence",
      new THREE.BufferAttribute(threadData.baseInfluence, 4),
    );
    threadGeometry.setAttribute(
      "aCulture",
      new THREE.BufferAttribute(threadData.cultureInfluence, 1),
    );
    threadGeometry.setAttribute(
      "aThemeColor",
      new THREE.BufferAttribute(threadData.themeColor, 3),
    );
    threadGeometry.setAttribute("aYear", new THREE.BufferAttribute(threadData.years, 1));
    threadGeometry.setAttribute("aLane", new THREE.BufferAttribute(threadData.lanes, 1));
    threadGeometry.setAttribute(
      "aEntityId",
      new THREE.BufferAttribute(threadData.entityIds, 1),
    );
    // 事件参与度作为丝线的第二层注意力：切片时参与者保持清晰，外围生命退入上下文。
    const eventMembership = new Float32Array(threadData.vertexCount * 2);
    for (let vertexIndex = 0; vertexIndex < threadData.vertexCount; vertexIndex += 1) {
      const person = fixture.persons[Math.trunc(threadData.entityIds[vertexIndex])];
      if (!person) continue;
      eventMembership[vertexIndex * 2] = fixture.events[0].participantIds.includes(person.id)
        ? 1
        : 0;
      eventMembership[vertexIndex * 2 + 1] = fixture.events[1].participantIds.includes(person.id)
        ? 1
        : 0;
    }
    threadGeometry.setAttribute(
      "aEventMembership",
      new THREE.BufferAttribute(eventMembership, 2),
    );
    threadGeometry.setIndex(new THREE.BufferAttribute(threadData.index, 1));

    const threadMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDimWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
        uDimCulture: { value: 0 },
        uWidthScale: { value: threadStateStyle["river-overview"].width },
        uGlowScale: { value: threadStateStyle["river-overview"].glow },
        uOpacity: { value: threadStateStyle["river-overview"].opacity },
        uContextOpacity: { value: threadStateStyle["river-overview"].context },
        uGeoSpread: { value: 0 },
        uFocusYear: { value: DEFAULT_FOCUS_YEAR },
        uHalfSpan: { value: OBSERVATION_SPAN / 2 },
        uFeather: { value: 9 },
        uBend: { value: 0.075 },
        uRiverWidth: { value: 6.5 },
        uRiverCenterX: { value: 6 },
        uEvent0Year: { value: fixture.events[0].year },
        uEvent1Year: { value: fixture.events[1].year },
        uEventRadius: { value: 11 },
        uEventEmphasis: { value: 0 },
        uSelectedId: { value: -1 },
        uHoveredId: { value: -1 },
      },
      vertexShader: `
        attribute vec3 aTangent;
        attribute float aSide;
        attribute float aActiveCurve;
        attribute vec4 aInfluence;
        attribute float aCulture;
        attribute vec3 aThemeColor;
        attribute float aYear;
        attribute float aLane;
        attribute float aEntityId;
        attribute vec2 aEventMembership;

        uniform vec4 uDimWeights;
        uniform float uDimCulture;
        uniform float uWidthScale;
        uniform float uGeoSpread;
        uniform float uFocusYear;
        uniform float uHalfSpan;
        uniform float uFeather;
        uniform float uBend;
        uniform float uRiverWidth;
        uniform float uRiverCenterX;
        uniform float uEvent0Year;
        uniform float uEvent1Year;
        uniform float uEventRadius;
        uniform float uSelectedId;
        uniform float uHoveredId;

        varying vec3 vColor;
        varying float vGlow;
        varying float vAcross;
        varying float vFade;
        varying float vEmph;
        varying float vEventAffinity;

        void main() {
          float infl = dot(uDimWeights, aInfluence) + uDimCulture * aCulture;
          infl *= aActiveCurve;

          // 远景收拢入河 / 近景散到真实地理位置
          vec3 p = position;
          float bend = sin(p.y * uBend) * 2.4;
          vec2 riverXZ = vec2(
            uRiverCenterX + bend + aLane * uRiverWidth,
            aLane * uRiverWidth * 0.25
          );
          p.xz = mix(riverXZ, p.xz, uGeoSpread);

          float isSel = 1.0 - step(0.5, abs(aEntityId - uSelectedId));
          float isHov = 1.0 - step(0.5, abs(aEntityId - uHoveredId));
          float hasSel = step(0.0, uSelectedId + 0.5);
          float emph = mix(1.0, mix(0.35, 1.2, isSel), hasSel);
          emph = max(emph, isHov * 0.9);
          vEmph = emph;

          float event0Proximity = 1.0 - smoothstep(
            0.0,
            uEventRadius,
            abs(uFocusYear - uEvent0Year)
          );
          float event1Proximity = 1.0 - smoothstep(
            0.0,
            uEventRadius,
            abs(uFocusYear - uEvent1Year)
          );
          vEventAffinity = max(
            aEventMembership.x * event0Proximity,
            aEventMembership.y * event1Proximity
          );

          float halfWidth = uWidthScale * (0.06 + infl * 0.34) * emph;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 t = normalize((modelViewMatrix * vec4(aTangent, 0.0)).xyz + vec3(0.0, 0.0, 0.0001));
          vec3 perp = normalize(vec3(t.y, -t.x, 0.0) + vec3(0.0001, 0.0, 0.0));
          mv.xyz += aSide * halfWidth * perp;
          gl_Position = projectionMatrix * mv;

          vColor = aThemeColor;
          vGlow = infl;
          vAcross = aSide;
          float d = abs(aYear - uFocusYear);
          vFade = 1.0 - smoothstep(uHalfSpan, uHalfSpan + uFeather, d);
          // 聚焦人物时，其完整一生（含窗口外延续）保持显影
          vFade = max(vFade, isSel);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vGlow;
        varying float vAcross;
        varying float vFade;
        varying float vEmph;
        varying float vEventAffinity;

        uniform float uOpacity;
        uniform float uGlowScale;
        uniform float uContextOpacity;
        uniform float uEventEmphasis;

        void main() {
          float edge = 1.0 - abs(vAcross);
          float glow = pow(edge, 2.0) * (0.18 + vGlow * uGlowScale * 0.56);
          vec3 celestial = vec3(0.53, 0.66, 0.76);
          vec3 memoryGold = vec3(0.91, 0.80, 0.63);
          vec3 color = mix(celestial, vColor, 0.28) * (0.38 + glow * 0.68);
          color = mix(color, memoryGold, clamp((vEmph - 1.0) * 0.7, 0.0, 0.32));
          float eventAttention = mix(1.0, 0.28 + vEventAffinity * 0.72, uEventEmphasis);
          float alpha = vFade * edge * uOpacity * vEmph * eventAttention;
          alpha = max(
            alpha,
            edge * uContextOpacity * 0.14 * vEmph * mix(1.0, eventAttention, 0.72)
          );
          if (alpha <= 0.004) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const figureThreads = new THREE.Mesh(threadGeometry, threadMaterial);
    figureThreads.renderOrder = 3;
    figureThreads.frustumCulled = false;
    riverGroup.add(figureThreads);

    // --- 焦点年份节点：识别身份 / 拾取 / "此刻此人"锚点 -------------------------
    const personColors = fixture.persons.map((person) => {
      const [r, g, b] = themeColorFor(person, fixture.seed);
      return new THREE.Color(r, g, b);
    });
    const nodeGeometry = new THREE.SphereGeometry(0.55, 10, 10);
    const nodeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nodeMesh = new THREE.InstancedMesh(
      nodeGeometry,
      nodeMaterial,
      fixture.persons.length,
    );
    nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nodeMesh.renderOrder = 4;
    riverGroup.add(nodeMesh);

    const relationLines: THREE.Line[] = [];
    for (const relation of fixture.relations) {
      const source = fixture.persons.find(
        (person) => person.id === relation.sourcePersonId,
      );
      const target = fixture.persons.find(
        (person) => person.id === relation.targetPersonId,
      );
      if (!source || !target) continue;
      const start = personPositionAt(source, relation.year, fixture);
      const end = personPositionAt(target, relation.year, fixture);
      const startPoint = new THREE.Vector3(start.x, start.y, start.z);
      const endPoint = new THREE.Vector3(end.x, end.y, end.z);
      const direction = endPoint.clone().sub(startPoint);
      const planarNormal = new THREE.Vector3(-direction.z, 0, direction.x);
      if (planarNormal.lengthSq() > 0) planarNormal.normalize();
      const bow = THREE.MathUtils.clamp(direction.length() * 0.16, 0.65, 1.55);
      const controlOffset = planarNormal.multiplyScalar(bow);
      const firstControl = startPoint
        .clone()
        .lerp(endPoint, 0.34)
        .add(controlOffset)
        .add(new THREE.Vector3(0, 0.34, 0));
      const secondControl = startPoint
        .clone()
        .lerp(endPoint, 0.68)
        .add(controlOffset)
        .add(new THREE.Vector3(0, 0.34, 0));
      const curve = new THREE.CubicBezierCurve3(
        startPoint,
        firstControl,
        secondControl,
        endPoint,
      );
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(42));
      const colors: Record<typeof relation.kind, number> = {
        direct: 0xe7cca0,
        "documented-indirect": 0x8baeba,
        "scholarly-inference": 0x9aaabd,
      };
      const material = new THREE.LineBasicMaterial({
        color: colors[relation.kind],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geometry, material);
      line.userData.relationId = relation.id;
      line.userData.sourcePersonId = relation.sourcePersonId;
      line.userData.targetPersonId = relation.targetPersonId;
      line.renderOrder = 5;
      line.visible = false;
      relationLines.push(line);
      riverGroup.add(line);
    }

    const eventClouds: THREE.Points[] = [];
    for (let eventIndex = 0; eventIndex < fixture.events.length; eventIndex += 1) {
      const event = fixture.events[eventIndex];
      const pointCount = quality === "default" ? 180 : 80;
      const positions = new Float32Array(pointCount * 3);
      for (let index = 0; index < pointCount; index += 1) {
        const t = index / Math.max(1, pointCount - 1);
        const angle = index * 2.399963 + eventIndex * 0.83;
        const radius = Math.sqrt(t) * (0.55 + Math.sin(index * 1.73) * 0.11);
        positions[index * 3] = Math.cos(angle) * radius;
        positions[index * 3 + 1] = Math.sin(index * 2.17) * 0.08;
        positions[index * 3 + 2] = Math.sin(angle) * radius * 0.68;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0xe7cca0,
        size: 0.075,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const cloud = new THREE.Points(geometry, material);
      cloud.position.set(
        event.center[0],
        historicalYearToY(event.year),
        event.center[1],
      );
      cloud.userData.eventYear = event.year;
      cloud.renderOrder = 4;
      riverGroup.add(cloud);
      eventClouds.push(cloud);
    }

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.42 };
    const pointer = new THREE.Vector2();
    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const tempColor = new THREE.Color();
    const selectedColor = new THREE.Color(0xffdc8a);
    const hoveredColor = new THREE.Color(0xffffff);
    let lastGuideStage = "";
    let lastHoverId: string | null = null;

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

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerMove = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = nodeMesh.visible
        ? raycaster.intersectObject(nodeMesh, false)[0]
        : undefined;
      const nextId =
        hit?.instanceId === undefined ? null : fixture.persons[hit.instanceId]?.id;
      if (nextId !== lastHoverId) {
        lastHoverId = nextId;
        hoveredPersonRef.current = nextId;
        renderer.domElement.style.cursor = nextId ? "pointer" : "grab";
      }
    };

    const onClick = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      if (nodeMesh.visible) {
        const personHit = raycaster.intersectObject(nodeMesh, false)[0];
        if (personHit?.instanceId !== undefined) {
          selectPerson(fixture.persons[personHit.instanceId].id);
          return;
        }
      }
      const relationHit = raycaster.intersectObjects(relationLines, false)[0];
      const relationId = relationHit?.object.userData.relationId as string | undefined;
      if (relationId) selectRelation(relationId);
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("click", onClick);

    const cameraAnchor = () => {
      const focusY = historicalYearToY(focusYearRef.current);
      const currentView = viewRef.current;
      if (currentView === "river-overview") {
        const portraitMix = 1 - THREE.MathUtils.smoothstep(camera.aspect, 0.72, 1.15);
        return {
          position: new THREE.Vector3(
            THREE.MathUtils.lerp(54, 42, portraitMix),
            46,
            THREE.MathUtils.lerp(238, 252, portraitMix),
          ),
          target: new THREE.Vector3(
            THREE.MathUtils.lerp(-18, 6, portraitMix),
            49,
            4,
          ),
          up: new THREE.Vector3(0, 1, 0),
        };
      }
      if (currentView === "entering-window") {
        return {
          position: new THREE.Vector3(26, focusY + 14, 42),
          target: new THREE.Vector3(0, focusY, 0),
          up: new THREE.Vector3(0, 1, 0),
        };
      }
      if (currentView === "slice") {
        return {
          position: new THREE.Vector3(0.01, focusY + 42, 0.01),
          target: new THREE.Vector3(0, focusY, 0),
          up: new THREE.Vector3(0, 0, -1),
        };
      }
      if (currentView === "person-focus") {
        const person = fixture.persons.find(
          (candidate) => candidate.id === selectedPersonRef.current,
        ) ?? fixture.persons[0];
        const point = personPositionAt(person, focusYearRef.current, fixture);
        return {
          position: new THREE.Vector3(point.x + 10, point.y + 6, point.z + 12),
          target: new THREE.Vector3(point.x, point.y, point.z),
          up: new THREE.Vector3(0, 1, 0),
        };
      }
      const relation = fixture.relations.find(
        (candidate) => candidate.id === selectedRelationRef.current,
      ) ?? fixture.relations[0];
      const source = fixture.persons.find(
        (person) => person.id === relation.sourcePersonId,
      ) ?? fixture.persons[0];
      const target = fixture.persons.find(
        (person) => person.id === relation.targetPersonId,
      ) ?? fixture.persons[1];
      const start = personPositionAt(source, relation.year, fixture);
      const end = personPositionAt(target, relation.year, fixture);
      const center = new THREE.Vector3(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        (start.z + end.z) / 2,
      );
      return {
        position: center.clone().add(new THREE.Vector3(12, 8, 16)),
        target: center,
        up: new THREE.Vector3(0, 1, 0),
      };
    };

    const initialAnchor = cameraAnchor();
    camera.position.copy(initialAnchor.position);
    camera.up.copy(initialAnchor.up);
    controls.target.copy(initialAnchor.target);
    camera.lookAt(initialAnchor.target);
    controls.update();

    renderer.setAnimationLoop((now) => {
      if (guidePlayingRef.current) {
        if (guideEpochRef.current === 0) guideEpochRef.current = now;
        const seconds = (now - guideEpochRef.current) / 1000;
        if (seconds >= 75) {
          guidePlayingRef.current = false;
          viewRef.current = "river-overview";
          cameraDirectedRef.current = true;
        } else {
          const stage = guideStateAtSeconds(seconds);
          if (stage !== lastGuideStage) {
            lastGuideStage = stage;
            viewRef.current = stage;
            cameraDirectedRef.current = true;
            if (stage === "slice") {
              focusYearRef.current = fixture.events[0].year;
            }
            if (stage === "relation-focus") {
              selectedRelationRef.current = fixture.relations[0].id;
            }
          }
        }
      }

      const focus = focusYearRef.current;
      const currentView = viewRef.current;
      geography.update(now, focus, currentView, lowMotionRef.current);

      // 丝线 uniform：维度权重、汇流程度与显影参数平滑插值
      const lerpK = lowMotionRef.current ? 0.05 : 0.1;
      const uniforms = threadMaterial.uniforms;
      const dimTarget = dimensionTargets[dimensionRef.current];
      (uniforms.uDimWeights.value as THREE.Vector4).lerp(
        new THREE.Vector4(...dimTarget.vec),
        lerpK,
      );
      uniforms.uDimCulture.value +=
        (dimTarget.culture - uniforms.uDimCulture.value) * lerpK;
      const style = threadStateStyle[currentView];
      uniforms.uWidthScale.value += (style.width - uniforms.uWidthScale.value) * lerpK;
      uniforms.uGlowScale.value += (style.glow - uniforms.uGlowScale.value) * lerpK;
      uniforms.uOpacity.value += (style.opacity - uniforms.uOpacity.value) * lerpK;
      uniforms.uContextOpacity.value +=
        (style.context - uniforms.uContextOpacity.value) * lerpK;
      uniforms.uGeoSpread.value += (style.geoSpread - uniforms.uGeoSpread.value) * lerpK;
      const eventEmphasisByView: Record<ExperienceState, number> = {
        "river-overview": 0,
        "entering-window": 0.18,
        slice: 0.78,
        "person-focus": 0.18,
        "relation-focus": 0.32,
      };
      uniforms.uEventEmphasis.value +=
        (eventEmphasisByView[currentView] - uniforms.uEventEmphasis.value) * lerpK;
      uniforms.uFocusYear.value = focus;
      const selectedIndex = fixture.persons.findIndex(
        (person) => person.id === selectedPersonRef.current,
      );
      const hoveredIndex = fixture.persons.findIndex(
        (person) => person.id === hoveredPersonRef.current,
      );
      uniforms.uSelectedId.value = currentView === "person-focus" ? selectedIndex : -1;
      uniforms.uHoveredId.value = hoveredIndex;

      // 焦点年份节点
      const showNodes = currentView !== "river-overview";
      nodeMesh.visible = showNodes;
      if (showNodes) {
        for (let index = 0; index < fixture.persons.length; index += 1) {
          const person = fixture.persons[index];
          const point = personPositionAt(person, focus, fixture);
          const strength = influenceAt(person, focus, dimensionRef.current);
          const alive = strength > 0;
          const isSelected = person.id === selectedPersonRef.current;
          const isHovered = person.id === hoveredPersonRef.current;
          const pulse = lowMotionRef.current
            ? 1
            : 1 + Math.sin(now * 0.002 + index) * 0.06;
          const size = alive
            ? (0.08 + strength * 0.22) * pulse * (isSelected ? 1.28 : 1)
            : 0.0001;
          tempScale.setScalar(size);
          tempMatrix.compose(
            new THREE.Vector3(point.x, point.y, point.z),
            tempQuaternion,
            tempScale,
          );
          nodeMesh.setMatrixAt(index, tempMatrix);
          if (isSelected) tempColor.copy(selectedColor);
          else if (isHovered) tempColor.copy(hoveredColor);
          else tempColor.copy(personColors[index]).multiplyScalar(1.25);
          nodeMesh.setColorAt(index, tempColor);
        }
        nodeMesh.instanceMatrix.needsUpdate = true;
        if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
      }

      for (const line of relationLines) {
        const material = line.material as THREE.LineBasicMaterial;
        const selected = line.userData.relationId === selectedRelationRef.current;
        const touchesSelectedPerson =
          line.userData.sourcePersonId === selectedPersonRef.current ||
          line.userData.targetPersonId === selectedPersonRef.current;
        material.opacity =
          currentView === "relation-focus"
            ? selected
              ? 0.46
              : 0
            : currentView === "person-focus"
              ? touchesSelectedPerson
                ? 0.12
                : 0
              : currentView === "slice"
                ? selected
                  ? 0.1
                  : 0.018
                : 0;
        line.visible = material.opacity > 0;
      }

      for (let index = 0; index < eventClouds.length; index += 1) {
        const cloud = eventClouds[index];
        cloud.visible = currentView === "slice" || currentView === "person-focus";
        const distance = Math.abs(focus - (cloud.userData.eventYear as number));
        const relevance = Math.max(0.08, 1 - distance / 12);
        const drift = lowMotionRef.current ? 0 : now * 0.00008 * (index % 2 === 0 ? 1 : -1);
        cloud.rotation.y = drift;
        cloud.scale.setScalar(0.86 + relevance * 0.48);
        (cloud.material as THREE.PointsMaterial).opacity = 0.04 + relevance * 0.22;
      }

      visuals.update(now, currentView, lowMotionRef.current);

      if (cameraDirectedRef.current) {
        const anchor = cameraAnchor();
        const motion = lowMotionRef.current ? 0.025 : 0.045;
        camera.position.lerp(anchor.position, motion);
        camera.up.lerp(anchor.up, motion * 1.4).normalize();
        controls.target.lerp(anchor.target, motion);
      }
      controls.update();
      postProcessing.render();

    });

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      visuals.dispose();
      postProcessing.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [fixture, selectPerson, selectRelation, stopGuide]);

  return (
    <main className="history-shell">
      <div ref={mountRef} className="history-stage" />
      <div className="history-vignette" aria-hidden="true" />
    </main>
  );
}
