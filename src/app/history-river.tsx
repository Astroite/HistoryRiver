"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import { createHistoryGeography } from "@/app/history-geography-visuals";
import {
  createHistoryPostProcessing,
  createHistoryVisuals,
} from "@/app/history-river-visuals";
import renderData from "@/data/history/generated/render-data.json";
import {
  RIVER_START_YEAR,
  buildRenderPersonThreadGeometry,
  historicalYearToY,
  type RenderHistoryDataset,
} from "@/lib/history/model";

const historyData = renderData as unknown as RenderHistoryDataset;

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

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 520);
    camera.position.set(54, 46, 238);
    camera.up.set(0, 1, 0);
    camera.lookAt(new THREE.Vector3(-18, 49, 4));

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
      `由 ${historyData.manifest.personCount} 位跨时代核心人物逐年轨迹构成的历史长河纯视觉场景`,
    );
    mount.appendChild(renderer.domElement);

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
      if (diagnostics && previousFrameTime > 0) {
        diagnostics.frameTimeMs.push(now - previousFrameTime);
        if (diagnostics.frameTimeMs.length > 600) diagnostics.frameTimeMs.shift();
      }
      previousFrameTime = now;
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
      if (diagnostics && window.__historyRiverDiagnostics === diagnostics) {
        delete window.__historyRiverDiagnostics;
      }
      visuals.dispose();
      postProcessing.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <main className="history-shell">
      <div ref={mountRef} className="history-stage" />
      <div className="history-vignette" aria-hidden="true" />
    </main>
  );
}
