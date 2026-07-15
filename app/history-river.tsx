"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  CONTENT_END_YEAR,
  DEFAULT_FOCUS_YEAR,
  RIVER_START_YEAR,
  createLifePath,
  createObservationWindow,
  formatHistoricalYear,
  guideStateAtSeconds,
  historicalYearToY,
  influenceAt,
  personPositionAt,
  prototypeFixture,
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
  "entering-window": "穿过光瀑，光丝逐渐显出姓名",
  slice: "俯看山河，人物因事件聚散",
  "person-focus": "沿一根悬丝，观看完整一生",
  "relation-focus": "思想越过生命边界继续流动",
};

const dimensionLabels: Record<InfluenceDimension, string> = {
  overall: "综合",
  political: "政治",
  military: "军事",
  thought: "思想",
  culture: "文化",
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
      "由人物光点、生命悬丝、事件点云和思想丝线构成的三维历史长河",
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

    const lifeSegments: number[] = [];
    for (const person of fixture.persons) {
      const path = createLifePath(person, fixture, quality === "default" ? 2 : 4);
      for (let index = 1; index < path.length; index += 1) {
        const previous = path[index - 1];
        const current = path[index];
        lifeSegments.push(
          previous.x,
          previous.y,
          previous.z,
          current.x,
          current.y,
          current.z,
        );
      }
    }
    const lifeGeometry = new THREE.BufferGeometry();
    lifeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(lifeSegments, 3),
    );
    const lifeMaterial = new THREE.LineBasicMaterial({
      color: 0x5b8790,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    riverGroup.add(new THREE.LineSegments(lifeGeometry, lifeMaterial));

    const selectedGeometry = new THREE.BufferGeometry();
    const selectedMaterial = new THREE.LineBasicMaterial({
      color: 0xffd98a,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const selectedLifeLine = new THREE.Line(selectedGeometry, selectedMaterial);
    riverGroup.add(selectedLifeLine);
    let lastSelectedPath = "";

    const personGeometry = new THREE.SphereGeometry(0.34, 12, 12);
    const personMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const personMesh = new THREE.InstancedMesh(
      personGeometry,
      personMaterial,
      fixture.persons.length,
    );
    personMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    personMesh.renderOrder = 4;
    riverGroup.add(personMesh);

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
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(
          (start.x + end.x) / 2,
          Math.max(start.y, end.y) + 2.6,
          (start.z + end.z) / 2 + 1.8,
        ),
        new THREE.Vector3(end.x, end.y, end.z),
      );
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(36));
      const colors: Record<typeof relation.kind, number> = {
        direct: 0xffe5a1,
        "documented-indirect": 0x75d8cf,
        "scholarly-inference": 0xc49aec,
      };
      const material = new THREE.LineBasicMaterial({
        color: colors[relation.kind],
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geometry, material);
      line.userData.relationId = relation.id;
      line.renderOrder = 5;
      relationLines.push(line);
      riverGroup.add(line);
    }

    const eventRings: THREE.Mesh[] = [];
    for (const event of fixture.events) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.4, 0.035, 6, 72),
        new THREE.MeshBasicMaterial({
          color: 0xd4b36f,
          transparent: true,
          opacity: 0.35,
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
    const windowGeometry = new THREE.BoxGeometry(28, windowHeight, 22);
    const windowMesh = new THREE.Mesh(
      windowGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xc9a866,
        transparent: true,
        opacity: 0.025,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const windowEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(windowGeometry),
      new THREE.LineBasicMaterial({
        color: 0xe1c582,
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
      }),
    );
    riverGroup.add(windowMesh, windowEdges);

    const geographyGroup = new THREE.Group();
    const geographyCurves = [
      [
        [-12, 4], [-8, 3], [-4, 5], [0, 3], [4, 4], [8, 1], [12, 2],
      ],
      [
        [-10, -5], [-6, -3], [-2, -4], [2, -2], [6, -4], [10, -3],
      ],
      [
        [-7, 8], [-5, 5], [-3, 2], [-1, -1], [1, -5], [3, -8],
      ],
    ];
    for (const coordinates of geographyCurves) {
      const points = coordinates.map(
        ([x, z]) => new THREE.Vector3(x, 0, z),
      );
      const curve = new THREE.CatmullRomCurve3(points);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)),
        new THREE.LineBasicMaterial({
          color: 0x416f72,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        }),
      );
      geographyGroup.add(line);
    }
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
      const hit = raycaster.intersectObject(personMesh, false)[0];
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
      const personHit = raycaster.intersectObject(personMesh, false)[0];
      if (personHit?.instanceId !== undefined) {
        selectPerson(fixture.persons[personHit.instanceId].id);
        return;
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
          position: new THREE.Vector3(24, focusY + 9, 34),
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
      const viewIsClose = viewRef.current !== "river-overview";
      geographyGroup.visible = viewIsClose;

      for (let index = 0; index < fixture.persons.length; index += 1) {
        const person = fixture.persons[index];
        const point = personPositionAt(person, focus, fixture);
        const strength = influenceAt(person, focus, dimensionRef.current);
        const alive = strength > 0;
        const isSelected = person.id === selectedPersonRef.current;
        const isHovered = person.id === hoveredPersonRef.current;
        const pulse = lowMotionRef.current ? 1 : 1 + Math.sin(now * 0.002 + index) * 0.06;
        const size = alive ? (0.42 + strength * 1.05) * pulse : 0.001;
        tempScale.setScalar(size * (isSelected ? 1.3 : 1));
        tempMatrix.compose(
          new THREE.Vector3(point.x, point.y, point.z),
          tempQuaternion,
          tempScale,
        );
        personMesh.setMatrixAt(index, tempMatrix);
        const color = isSelected
          ? new THREE.Color(0xffdc8a)
          : isHovered
            ? new THREE.Color(0xffffff)
            : new THREE.Color(0x8ed4cf).lerp(
                new THREE.Color(0xd8b66e),
                strength,
              );
        personMesh.setColorAt(index, color);
      }
      personMesh.instanceMatrix.needsUpdate = true;
      if (personMesh.instanceColor) personMesh.instanceColor.needsUpdate = true;

      if (selectedPersonRef.current !== lastSelectedPath) {
        lastSelectedPath = selectedPersonRef.current;
        const person = fixture.persons.find(
          (candidate) => candidate.id === lastSelectedPath,
        ) ?? fixture.persons[0];
        const points = createLifePath(person, fixture, 1).map(
          (point) => new THREE.Vector3(point.x, point.y, point.z),
        );
        selectedLifeLine.geometry.dispose();
        selectedLifeLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
      }
      selectedLifeLine.visible = viewRef.current === "person-focus";

      for (const line of relationLines) {
        const material = line.material as THREE.LineBasicMaterial;
        const selected = line.userData.relationId === selectedRelationRef.current;
        material.opacity =
          viewRef.current === "relation-focus" ? (selected ? 0.98 : 0.16) : 0.22;
      }

      for (let index = 0; index < eventRings.length; index += 1) {
        const ring = eventRings[index];
        const distance = Math.abs(focus - (ring.userData.eventYear as number));
        const relevance = Math.max(0.08, 1 - distance / 12);
        const pulse = lowMotionRef.current ? 1 : 1 + Math.sin(now * 0.003 + index) * 0.13;
        ring.scale.setScalar((0.7 + relevance * 0.7) * pulse);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.1 + relevance * 0.52;
      }

      const isOverview = viewRef.current === "river-overview";
      riverMaterial.uniforms.uSize.value = isOverview
        ? quality === "default" ? 1.72 : 1.55
        : quality === "default" ? 1.05 : 1.18;
      riverMaterial.uniforms.uOpacity.value = isOverview ? 0.9 : 0.68;
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
            <p className="history-kicker">HISTORY RIVER · P0</p>
            <h1>史河：九天来流</h1>
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
        <span><i className="person-dot" />人物光点</span>
        <span><i className="life-thread" />人生悬丝</span>
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
