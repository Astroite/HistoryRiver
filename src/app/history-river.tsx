"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  CONTENT_END_YEAR,
  DEFAULT_FOCUS_YEAR,
  OBSERVATION_SPAN,
  RIVER_START_YEAR,
  abstractChina,
  buildFigureThreads,
  createObservationWindow,
  formatHistoricalYear,
  guideStateAtSeconds,
  historicalYearToY,
  influenceAt,
  personPositionAt,
  prototypeFixture,
  themeColorFor,
  type ExperienceState,
  type InfluenceDimension,
} from "@/lib/history/model";

const stateLabels: Record<ExperienceState, string> = {
  "river-overview": "观河",
  "entering-window": "入流",
  slice: "观事",
  "person-focus": "逐人",
  "relation-focus": "溯源",
};

const stateNotes: Record<ExperienceState, string> = {
  "river-overview": "站在今天，仰望九天长河",
  "entering-window": "穿过光瀑，丝线逐渐显出姓名",
  slice: "俯看山河，人物因事件聚散",
  "person-focus": "沿一根丝线，观看完整一生",
  "relation-focus": "思想越过生命边界继续流动",
};

const dimensionLabels: Record<InfluenceDimension, string> = {
  overall: "综合",
  political: "政治",
  military: "军事",
  thought: "思想",
  culture: "文化",
};

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
  "river-overview": { width: 0.85, glow: 0.6, opacity: 0.55, context: 0, geoSpread: 0 },
  "entering-window": { width: 1.1, glow: 1, opacity: 0.82, context: 0.22, geoSpread: 0.55 },
  slice: { width: 1.5, glow: 1.2, opacity: 0.95, context: 0.34, geoSpread: 1 },
  "person-focus": { width: 1.6, glow: 1.3, opacity: 1, context: 0.4, geoSpread: 1 },
  "relation-focus": { width: 1.05, glow: 0.75, opacity: 0.5, context: 0.22, geoSpread: 1 },
};

interface RenderStats {
  medianMs: number;
  p95Ms: number;
  calls: number;
  points: number;
  lines: number;
}

interface AudioRig {
  context: AudioContext;
  gain: GainNode;
  low: OscillatorNode;
  high: OscillatorNode;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
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
  const audioRef = useRef<AudioRig | null>(null);

  const [view, setView] = useState<ExperienceState>("river-overview");
  const [focusYear, setFocusYear] = useState(DEFAULT_FOCUS_YEAR);
  const [dimension, setDimension] = useState<InfluenceDimension>("overall");
  const [selectedPersonId, setSelectedPersonId] = useState(
    fixture.persons[3].id,
  );
  const [selectedRelationId, setSelectedRelationId] = useState(
    fixture.relations[0].id,
  );
  const [hoveredPersonId, setHoveredPersonId] = useState<string | null>(null);
  const [guidePlaying, setGuidePlaying] = useState(true);
  const [guideSeconds, setGuideSeconds] = useState(0);
  const [lowMotion, setLowMotion] = useState(false);
  const [quality, setQuality] = useState<"default" | "reduced">("default");
  const [soundOn, setSoundOn] = useState(false);
  const [stats, setStats] = useState<RenderStats>({
    medianMs: 0,
    p95Ms: 0,
    calls: 0,
    points: 0,
    lines: 0,
  });

  const selectedPerson = useMemo(
    () =>
      fixture.persons.find((person) => person.id === selectedPersonId) ??
      fixture.persons[0],
    [fixture.persons, selectedPersonId],
  );
  const selectedRelation = useMemo(
    () =>
      fixture.relations.find((relation) => relation.id === selectedRelationId) ??
      fixture.relations[0],
    [fixture.relations, selectedRelationId],
  );
  const windowRange = useMemo(
    () => createObservationWindow(focusYear),
    [focusYear],
  );

  const stopGuide = useCallback(() => {
    guidePlayingRef.current = false;
    setGuidePlaying(false);
  }, []);

  const directTo = useCallback(
    (next: ExperienceState) => {
      stopGuide();
      viewRef.current = next;
      setView(next);
      cameraDirectedRef.current = true;
    },
    [stopGuide],
  );

  const selectPerson = useCallback(
    (personId: string) => {
      selectedPersonRef.current = personId;
      setSelectedPersonId(personId);
      directTo("person-focus");
    },
    [directTo],
  );

  const selectRelation = useCallback(
    (relationId: string) => {
      selectedRelationRef.current = relationId;
      setSelectedRelationId(relationId);
      directTo("relation-focus");
    },
    [directTo],
  );

  const startGuide = useCallback(() => {
    guideEpochRef.current = performance.now();
    guidePlayingRef.current = true;
    setGuidePlaying(true);
    setGuideSeconds(0);
    viewRef.current = "river-overview";
    setView("river-overview");
    cameraDirectedRef.current = true;
  }, []);

  const toggleSound = useCallback(async () => {
    if (!audioRef.current) {
      const context = new AudioContext();
      const gain = context.createGain();
      const low = context.createOscillator();
      const high = context.createOscillator();
      low.type = "sine";
      high.type = "sine";
      low.frequency.value = 46;
      high.frequency.value = 92;
      gain.gain.value = 0;
      low.connect(gain);
      high.connect(gain);
      gain.connect(context.destination);
      low.start();
      high.start();
      audioRef.current = { context, gain, low, high };
    }
    const rig = audioRef.current;
    await rig.context.resume();
    const next = !soundOn;
    rig.gain.gain.setTargetAtTime(next ? 0.012 : 0, rig.context.currentTime, 0.08);
    setSoundOn(next);
  }, [soundOn]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    focusYearRef.current = focusYear;
  }, [focusYear]);

  useEffect(() => {
    dimensionRef.current = dimension;
  }, [dimension]);

  useEffect(() => {
    lowMotionRef.current = lowMotion;
  }, [lowMotion]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      setLowMotion(media.matches);
      lowMotionRef.current = media.matches;
    };
    queueMicrotask(syncPreference);
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const rig = audioRef.current;
    if (!rig || !soundOn) return;
    const frequencies: Record<ExperienceState, readonly [number, number]> = {
      "river-overview": [46, 92],
      "entering-window": [52, 104],
      slice: [58, 116],
      "person-focus": [62, 124],
      "relation-focus": [69, 138],
    };
    const [low, high] = frequencies[view];
    rig.low.frequency.setTargetAtTime(low, rig.context.currentTime, 0.4);
    rig.high.frequency.setTargetAtTime(high, rig.context.currentTime, 0.4);
  }, [soundOn, view]);

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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02070b);
    scene.fog = new THREE.FogExp2(0x02070b, 0.0085);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 320);
    camera.position.set(42, 58, 110);
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
    renderer.toneMappingExposure = 1.15;
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
    controls.minDistance = 5;
    controls.maxDistance = 160;
    controls.target.set(0, 58, 0);
    controls.addEventListener("start", () => {
      cameraDirectedRef.current = false;
      stopGuide();
    });

    const riverGroup = new THREE.Group();
    scene.add(riverGroup);

    const random = seededRandom(fixture.seed + (quality === "default" ? 1 : 2));
    const riverParticleCount = quality === "default" ? 30000 : 9000;
    const riverPositions = new Float32Array(riverParticleCount * 3);
    const riverColors = new Float32Array(riverParticleCount * 3);
    const cold = new THREE.Color(0x5ca9b8);
    const warm = new THREE.Color(0xd9b56d);
    const topY = historicalYearToY(RIVER_START_YEAR);
    for (let index = 0; index < riverParticleCount; index += 1) {
      const y = random() * topY;
      const age = y / topY;
      const width = 3.2 + Math.sin(age * Math.PI) * 4.8;
      const bend = Math.sin(y * 0.075) * 2.4;
      riverPositions[index * 3] = bend + (random() + random() + random() - 1.5) * width;
      riverPositions[index * 3 + 1] = y;
      riverPositions[index * 3 + 2] = (random() + random() - 1) * width * 0.62;
      const color = cold.clone().lerp(warm, 0.18 + (1 - age) * 0.2);
      color.multiplyScalar(0.45 + random() * 0.75);
      riverColors[index * 3] = color.r;
      riverColors[index * 3 + 1] = color.g;
      riverColors[index * 3 + 2] = color.b;
    }
    const riverGeometry = new THREE.BufferGeometry();
    riverGeometry.setAttribute("position", new THREE.BufferAttribute(riverPositions, 3));
    riverGeometry.setAttribute("color", new THREE.BufferAttribute(riverColors, 3));
    const riverMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: quality === "default" ? 1.05 : 1.18 },
        uOpacity: { value: 0.72 },
      },
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uSize;

        void main() {
          vColor = color;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = clamp(uSize * (280.0 / max(1.0, -viewPosition.z)), 1.0, 6.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        uniform float uOpacity;

        void main() {
          float distanceToCenter = length(gl_PointCoord - vec2(0.5));
          float halo = 1.0 - smoothstep(0.08, 0.5, distanceToCenter);
          if (halo <= 0.0) discard;
          gl_FragColor = vec4(vColor, halo * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const riverParticles = new THREE.Points(riverGeometry, riverMaterial);
    riverGroup.add(riverParticles);

    const seaParticleCount = quality === "default" ? 9000 : 2500;
    const seaPositions = new Float32Array(seaParticleCount * 3);
    for (let index = 0; index < seaParticleCount; index += 1) {
      const radius = Math.sqrt(random()) * 44;
      const angle = random() * Math.PI * 2;
      seaPositions[index * 3] = Math.cos(angle) * radius;
      seaPositions[index * 3 + 1] = (random() - 0.5) * 0.3;
      seaPositions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const seaGeometry = new THREE.BufferGeometry();
    seaGeometry.setAttribute("position", new THREE.BufferAttribute(seaPositions, 3));
    const seaMaterial = new THREE.PointsMaterial({
      color: 0x7fc9ca,
      size: 0.11,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    riverGroup.add(new THREE.Points(seaGeometry, seaMaterial));

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

        uniform vec4 uDimWeights;
        uniform float uDimCulture;
        uniform float uWidthScale;
        uniform float uGeoSpread;
        uniform float uFocusYear;
        uniform float uHalfSpan;
        uniform float uFeather;
        uniform float uBend;
        uniform float uRiverWidth;
        uniform float uSelectedId;
        uniform float uHoveredId;

        varying vec3 vColor;
        varying float vGlow;
        varying float vAcross;
        varying float vFade;
        varying float vEmph;

        void main() {
          float infl = dot(uDimWeights, aInfluence) + uDimCulture * aCulture;
          infl *= aActiveCurve;

          // 远景收拢入河 / 近景散到真实地理位置
          vec3 p = position;
          float bend = sin(p.y * uBend) * 2.4;
          vec2 riverXZ = vec2(bend + aLane * uRiverWidth, aLane * uRiverWidth * 0.25);
          p.xz = mix(riverXZ, p.xz, uGeoSpread);

          float isSel = 1.0 - step(0.5, abs(aEntityId - uSelectedId));
          float isHov = 1.0 - step(0.5, abs(aEntityId - uHoveredId));
          float hasSel = step(0.0, uSelectedId + 0.5);
          float emph = mix(1.0, mix(0.35, 1.2, isSel), hasSel);
          emph = max(emph, isHov * 0.9);
          vEmph = emph;

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

        uniform float uOpacity;
        uniform float uGlowScale;
        uniform float uContextOpacity;

        void main() {
          float edge = 1.0 - abs(vAcross);
          float glow = pow(edge, 2.0) * (0.4 + vGlow * uGlowScale);
          vec3 color = vColor * (0.55 + glow);
          float alpha = vFade * edge * uOpacity * vEmph;
          alpha = max(alpha, edge * uContextOpacity * 0.14 * vEmph);
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
    const nodeGeometry = new THREE.SphereGeometry(1, 12, 12);
    const nodeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
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
        direct: 0xffe5a1,
        "documented-indirect": 0x75d8cf,
        "scholarly-inference": 0xc49aec,
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

    const eventRings: THREE.Mesh[] = [];
    for (const event of fixture.events) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.35, 0.02, 6, 72),
        new THREE.MeshBasicMaterial({
          color: 0xd4b36f,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(
        event.center[0],
        historicalYearToY(event.year),
        event.center[1],
      );
      ring.userData.eventYear = event.year;
      riverGroup.add(ring);
      eventRings.push(ring);
    }

    const windowHeight = Math.abs(
      historicalYearToY(DEFAULT_FOCUS_YEAR - 10) -
        historicalYearToY(DEFAULT_FOCUS_YEAR + 10),
    );
    const windowGeometry = new THREE.BoxGeometry(24, windowHeight, 18);
    const windowMaterial = new THREE.MeshBasicMaterial({
      color: 0x88a8a5,
      transparent: true,
      opacity: 0.004,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const windowMesh = new THREE.Mesh(
      windowGeometry,
      windowMaterial,
    );
    const windowEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x89aaa8,
      transparent: true,
      opacity: 0.07,
      blending: THREE.NormalBlending,
    });
    const windowEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(windowGeometry),
      windowEdgeMaterial,
    );
    riverGroup.add(windowMesh, windowEdges);

    // --- 抽象中国地理方位图：海岸线 + 黄河 + 长江（俯视切片的方位参照）---------
    const geographyGroup = new THREE.Group();
    const addGeographyLine = (
      coordinates: ReadonlyArray<readonly [number, number]>,
      color: number,
      baseOpacity: number,
    ) => {
      const points = coordinates.map(([x, z]) => new THREE.Vector3(x, 0, z));
      const curve = new THREE.CatmullRomCurve3(points);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(96)),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: baseOpacity,
          depthWrite: false,
        }),
      );
      line.userData.baseOpacity = baseOpacity;
      geographyGroup.add(line);
    };
    addGeographyLine(abstractChina.coastline, 0x5c8f93, 1); // 海岸线
    addGeographyLine(abstractChina.rivers.yellow, 0xc7a86a, 1); // 黄河（暖）
    addGeographyLine(abstractChina.rivers.yangtze, 0x6fb3c4, 1); // 长江（冷）
    riverGroup.add(geographyGroup);

    const sourceGlow = new THREE.Mesh(
      new THREE.SphereGeometry(10, 20, 20),
      new THREE.MeshBasicMaterial({
        color: 0x8baeb2,
        transparent: true,
        opacity: 0.05,
        side: THREE.BackSide,
      }),
    );
    sourceGlow.position.set(0, topY + 5, 0);
    riverGroup.add(sourceGlow);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.42 };
    const pointer = new THREE.Vector2();
    const tempMatrix = new THREE.Matrix4();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const tempColor = new THREE.Color();
    const selectedColor = new THREE.Color(0xffdc8a);
    const hoveredColor = new THREE.Color(0xffffff);
    const frameSamples: number[] = [];
    let previousFrame = performance.now();
    let lastStatsAt = previousFrame;
    let lastGuideStage = "";
    let lastGuideUiAt = 0;
    let lastHoverId: string | null = null;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
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
        setHoveredPersonId(nextId);
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
        return {
          position: new THREE.Vector3(42, 58, 110),
          target: new THREE.Vector3(0, 58, 0),
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
          position: new THREE.Vector3(0.01, focusY + 31, 0.01),
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

    renderer.setAnimationLoop((now) => {
      const delta = Math.min(100, now - previousFrame);
      previousFrame = now;
      frameSamples.push(delta);
      if (frameSamples.length > 240) frameSamples.shift();

      if (guidePlayingRef.current) {
        if (guideEpochRef.current === 0) guideEpochRef.current = now;
        const seconds = (now - guideEpochRef.current) / 1000;
        if (seconds >= 75) {
          guidePlayingRef.current = false;
          setGuidePlaying(false);
          setGuideSeconds(75);
          viewRef.current = "river-overview";
          setView("river-overview");
          cameraDirectedRef.current = true;
        } else {
          const stage = guideStateAtSeconds(seconds);
          if (stage !== lastGuideStage) {
            lastGuideStage = stage;
            viewRef.current = stage;
            setView(stage);
            cameraDirectedRef.current = true;
            if (stage === "slice") {
              focusYearRef.current = fixture.events[0].year;
              setFocusYear(fixture.events[0].year);
            }
            if (stage === "relation-focus") {
              selectedRelationRef.current = fixture.relations[0].id;
              setSelectedRelationId(fixture.relations[0].id);
            }
          }
          if (now - lastGuideUiAt > 250) {
            setGuideSeconds(seconds);
            lastGuideUiAt = now;
          }
        }
      }

      const focus = focusYearRef.current;
      const focusY = historicalYearToY(focus);
      windowMesh.position.y = focusY;
      windowEdges.position.y = focusY;
      geographyGroup.position.y = focusY + 0.02;
      const currentView = viewRef.current;
      const showWindow =
        currentView === "river-overview" || currentView === "entering-window";
      windowMesh.visible = showWindow;
      windowEdges.visible = showWindow;
      windowMaterial.opacity = currentView === "entering-window" ? 0.008 : 0.003;
      windowEdgeMaterial.opacity = currentView === "entering-window" ? 0.12 : 0.055;

      const showGeography =
        currentView === "slice" ||
        currentView === "person-focus" ||
        currentView === "relation-focus";
      geographyGroup.visible = showGeography;
      const geographyOpacity =
        currentView === "slice" ? 0.32 : currentView === "person-focus" ? 0.18 : 0.1;
      for (const child of geographyGroup.children) {
        ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity =
          geographyOpacity;
      }

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
            ? (0.12 + strength * 0.34) * pulse * (isSelected ? 1.5 : 1)
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
              ? 0.92
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

      for (let index = 0; index < eventRings.length; index += 1) {
        const ring = eventRings[index];
        ring.visible = currentView === "slice" || currentView === "person-focus";
        const distance = Math.abs(focus - (ring.userData.eventYear as number));
        const relevance = Math.max(0.08, 1 - distance / 12);
        const pulse = lowMotionRef.current ? 1 : 1 + Math.sin(now * 0.003 + index) * 0.13;
        ring.scale.setScalar((0.7 + relevance * 0.7) * pulse);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.05 + relevance * 0.27;
      }

      const isOverview = currentView === "river-overview";
      riverMaterial.uniforms.uSize.value = isOverview
        ? quality === "default" ? 1.72 : 1.55
        : currentView === "entering-window"
          ? quality === "default" ? 0.92 : 1.04
          : quality === "default" ? 0.78 : 0.9;
      riverMaterial.uniforms.uOpacity.value = isOverview
        ? 0.9
        : currentView === "entering-window"
          ? 0.36
          : currentView === "slice"
            ? 0.24
            : 0.14;
      seaMaterial.opacity = isOverview
        ? 0.38
        : currentView === "entering-window"
          ? 0.16
          : 0.08;
      riverParticles.rotation.y = lowMotionRef.current ? 0 : now * 0.000025;
      sourceGlow.scale.setScalar(
        lowMotionRef.current ? 1 : 1 + Math.sin(now * 0.0007) * 0.08,
      );

      if (cameraDirectedRef.current) {
        const anchor = cameraAnchor();
        const motion = lowMotionRef.current ? 0.025 : 0.045;
        camera.position.lerp(anchor.position, motion);
        camera.up.lerp(anchor.up, motion * 1.4).normalize();
        controls.target.lerp(anchor.target, motion);
      }
      controls.update();
      renderer.render(scene, camera);

      if (now - lastStatsAt > 1000) {
        setStats({
          medianMs: percentile(frameSamples, 0.5),
          p95Ms: percentile(frameSamples, 0.95),
          calls: renderer.info.render.calls,
          points: renderer.info.render.points,
          lines: renderer.info.render.lines,
        });
        lastStatsAt = now;
      }
    });

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [fixture, quality, selectPerson, selectRelation, stopGuide]);

  useEffect(
    () => () => {
      const rig = audioRef.current;
      if (!rig) return;
      rig.low.stop();
      rig.high.stop();
      void rig.context.close();
    },
    [],
  );

  const changeFocusYear = (year: number) => {
    stopGuide();
    focusYearRef.current = year;
    setFocusYear(year);
    cameraDirectedRef.current = true;
  };

  const changeDimension = (next: InfluenceDimension) => {
    stopGuide();
    dimensionRef.current = next;
    setDimension(next);
  };

  const toggleLowMotion = () => {
    const next = !lowMotion;
    lowMotionRef.current = next;
    setLowMotion(next);
    cameraDirectedRef.current = true;
  };

  const relationSource = fixture.persons.find(
    (person) => person.id === selectedRelation.sourcePersonId,
  );
  const relationTarget = fixture.persons.find(
    (person) => person.id === selectedRelation.targetPersonId,
  );

  return (
    <main className="history-shell">
      <div ref={mountRef} className="history-stage" />
      <div className="history-vignette" aria-hidden="true" />

      <header className="history-header">
        <div className="history-brand">
          <span className="history-seal">史</span>
          <div>
            <p className="history-kicker">LUO JIU CHUAN · P0</p>
            <h1>落九川</h1>
          </div>
        </div>
        <div className="history-badges" aria-label="原型状态">
          <span>原型 · 模拟数据</span>
          <span>观察窗口 20 年</span>
          <span>{quality === "default" ? "默认质量" : "降级质量"}</span>
        </div>
      </header>

      <nav className="state-nav" aria-label="体验状态">
        {(Object.keys(stateLabels) as ExperienceState[]).map((state) => (
          <button
            key={state}
            type="button"
            className={view === state ? "is-active" : ""}
            onClick={() => directTo(state)}
          >
            <span>{stateLabels[state]}</span>
            <small>{state.replace("-", " / ")}</small>
          </button>
        ))}
      </nav>

      <section className="time-panel" aria-label="时间窗口与事件">
        <div className="panel-heading">
          <span>二十年窗口</span>
          <strong>
            {formatHistoricalYear(windowRange.startYear)}—
            {formatHistoricalYear(windowRange.endYear)}
          </strong>
        </div>
        <input
          className="time-slider"
          type="range"
          min={-525}
          max={-505}
          step={1}
          value={focusYear}
          aria-label="观察窗口中心年份"
          onChange={(event) => changeFocusYear(Number(event.target.value))}
        />
        <div className="timeline-ends" aria-hidden="true">
          <span>源头 / 九天</span>
          <span>今天 / 光海</span>
        </div>
        <div className="event-list">
          {fixture.events.map((event) => (
            <button
              type="button"
              key={event.id}
              onClick={() => {
                changeFocusYear(event.year);
                directTo("slice");
              }}
            >
              <i />
              <span>{event.label}</span>
              <small>{formatHistoricalYear(event.year)}</small>
            </button>
          ))}
        </div>
      </section>

      <aside className="detail-panel" aria-live="polite">
        <p className="detail-state">{stateLabels[view]}</p>
        <h2>{view === "relation-focus" ? selectedRelation.label : selectedPerson.label}</h2>
        <p className="detail-summary">
          {view === "relation-focus"
            ? `${relationSource?.label ?? "来源"} → ${relationTarget?.label ?? "后继"}`
            : selectedPerson.role}
        </p>

        {view === "relation-focus" ? (
          <div className="evidence-card">
            <span>关系证据</span>
            <strong>
              {selectedRelation.kind === "direct"
                ? "明确传递"
                : selectedRelation.kind === "documented-indirect"
                  ? "有文献支持的间接影响"
                  : "后世学术推断"}
            </strong>
            <p>视觉线型表示证据性质，不等同于“历史真伪”的绝对等级。</p>
          </div>
        ) : (
          <>
            <p className="life-range">
              {formatHistoricalYear(selectedPerson.birthYear)}—
              {formatHistoricalYear(selectedPerson.deathYear)}
            </p>
            <div className="influence-readout">
              <span>{dimensionLabels[dimension]}影响</span>
              <b>
                {Math.round(
                  influenceAt(selectedPerson, focusYear, dimension) * 100,
                )}
              </b>
              <em>%</em>
            </div>
          </>
        )}

        <div className="relation-list" aria-label="思想关系">
          {fixture.relations.map((relation) => (
            <button
              key={relation.id}
              type="button"
              className={selectedRelationId === relation.id ? "is-active" : ""}
              onClick={() => selectRelation(relation.id)}
            >
              <span className={`relation-mark ${relation.kind}`} />
              {relation.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="control-dock" aria-label="观察维度与辅助设置">
        <div className="dimension-controls">
          {(Object.keys(dimensionLabels) as InfluenceDimension[]).map((item) => (
            <button
              type="button"
              key={item}
              className={dimension === item ? "is-active" : ""}
              onClick={() => changeDimension(item)}
            >
              {dimensionLabels[item]}
            </button>
          ))}
        </div>
        <div className="utility-controls">
          <button type="button" onClick={guidePlaying ? stopGuide : startGuide}>
            {guidePlaying ? "暂停导览" : "重播导览"}
          </button>
          <button type="button" onClick={toggleSound}>
            {soundOn ? "声音开启" : "声音关闭"}
          </button>
          <button type="button" onClick={toggleLowMotion}>
            {lowMotion ? "低动态" : "标准动态"}
          </button>
          <button
            type="button"
            onClick={() => setQuality(quality === "default" ? "reduced" : "default")}
          >
            {quality === "default" ? "切换降级" : "恢复默认"}
          </button>
        </div>
      </section>

      <div className="scene-caption">
        <p>{stateNotes[view]}</p>
        <span>
          {guidePlaying
            ? `导览 ${Math.min(75, Math.round(guideSeconds))} / 75 秒`
            : hoveredPersonId
              ? `悬停：${fixture.persons.find((person) => person.id === hoveredPersonId)?.label}`
              : "拖动接管镜头 · Esc 返回全史 · 空格重播导览"}
        </span>
      </div>

      <div className="visual-legend" aria-label="视觉图例">
        <span><i className="person-thread" />人物丝线 · 粗细/辉光=影响力</span>
        <span><i className="focus-node" />焦点年份节点</span>
        <span><i className="thought-thread" />思想丝线</span>
        <span><i className="event-cloud" />事件聚集</span>
      </div>

      <footer className="metrics-bar">
        <span>SEED {fixture.seed}</span>
        <span>WEBGL · {quality.toUpperCase()}</span>
        <span>MED {stats.medianMs.toFixed(1)} ms</span>
        <span>P95 {stats.p95Ms.toFixed(1)} ms</span>
        <span>CALLS {stats.calls}</span>
        <span>POINTS {stats.points.toLocaleString()}</span>
        <span>LINES {stats.lines.toLocaleString()}</span>
        <span>{formatHistoricalYear(CONTENT_END_YEAR)} 内容边界</span>
      </footer>
    </main>
  );
}
