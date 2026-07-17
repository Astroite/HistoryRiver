import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import {
  OceanFlowField,
  type OceanFlowPoint,
} from "@/lib/history/ocean-flow-field";
import type { ExperienceState } from "@/lib/history/model";

type SceneQuality = "default" | "reduced";

interface CloudSpriteState {
  sprite: THREE.Sprite;
  basePosition: THREE.Vector3;
  baseOpacity: number;
  phase: number;
}

export interface HistoryVisualRig {
  root: THREE.Group;
  update(now: number, view: ExperienceState, lowMotion: boolean): void;
  dispose(): void;
}

export interface HistoryPostProcessing {
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

const WATERFALL_CENTER_X = 6;
const CONFLUENCE_CENTER_Z = 4;
const CELESTIAL = new THREE.Color(0x9ebbd5);
const IVORY = new THREE.Color(0xffdda8);
const MEMORY_GOLD = new THREE.Color(0xe99b38);

// 人民光海：一片无边无际、由无数短丝线铺满的三维光海——不渲染任何水体面片。
// 单根丝线很短（约 10–30 单位，象征一段人生片段）；多根短丝线错落汇聚、首尾续接，
// 才形成看上去更长的粗线条，象征家族的代际传承。海面代表 1949「当下」；
// 海面之下越深越淡，表示不可知的未来。海域向四周远远铺开，边缘没入雾中形成无际地平。
const SEA_BASE_Y = -1.15;
// 海域向四周远远铺开，远超可视范围；边缘由视距淡出（uFadeNear..uFadeFar）没入黑暗，
// 形成无边无际的地平线，而非有限矩形的硬边。
const SEA_X_HALF = 520;
const SEA_Z_MIN = -360;
const SEA_Z_MAX = 440;
// 视距淡出区间（相机空间 -z）：近处满显，超出后渐隐为零，等价于加色混合下的消隐。
const SEA_FADE_NEAR = 210;
const SEA_FADE_FAR = 470;
// 海面之下延伸的"未来"体量：丝线可下沉到此深度，越深越淡。
const SEA_DEPTH_BELOW = 52;
// 单根短丝线长度（世界单位）随机区间：约定 1 单位≈1 年，故单段人生片段约 10–30 年。
const SEA_THREAD_LEN_MIN = 10;
const SEA_THREAD_LEN_MAX = 30;

// 海浪场：Gerstner 波组。点在波面上做圆周轨道运动（水平+垂直一起动），而非仅垂直升降——
// 这样丝线能真正"披"在起伏的波面上并顺流摆动，动起来是活的水，而不是整体上下抽动的死板平面。
// 频率配比：一道长波做大圆丘骨架，中频波供短丝线（10–30 单位）看到曲率并贴合，细纹增加流动细节。
// 流线丝线与浪花点云共用，保证同一片海协同起伏。
interface OceanWave {
  dir: readonly [number, number]; // 归一化传播方向
  wavelength: number;
  amp: number;
  steep: number;
  speed: number;
}

const OCEAN_WAVES: OceanWave[] = (
  [
    { dir: [0.86, 0.51], wavelength: 340, amp: 10.0, steep: 0.72, speed: 0.78 }, // 主涌浪（大圆丘骨架）
    { dir: [-0.55, 0.84], wavelength: 150, amp: 5.4, steep: 0.85, speed: 1.05 }, // 次级波脊
    { dir: [0.28, -0.96], wavelength: 66, amp: 2.8, steep: 1.0, speed: 1.35 }, // 中频：供短丝线贴合曲率
    { dir: [0.97, 0.12], wavelength: 32, amp: 1.2, steep: 1.0, speed: 1.75 }, // 细纹：流动细节
  ] as const
).map((w) => {
  const len = Math.hypot(w.dir[0], w.dir[1]);
  return { ...w, dir: [w.dir[0] / len, w.dir[1] / len] as const };
});

const CONFLUENCE_RIPPLE = {
  wavelength: 48,
  amp: 3.4,
  steep: 0.62,
  speed: 1.46,
  near: 8,
  far: 210,
} as const;

const OCEAN_HEIGHT_GLSL = `
  // 单个 Gerstner 波，返回三维位移 (dx, dy, dz)。dir 需已归一化。
  vec3 gerstnerWave(vec2 q, vec2 dir, float wavelength, float amp, float steep, float w) {
    float t = uTime * 0.00035 * uFlow;
    float k = 6.2831853 / wavelength;
    float f = k * dot(dir, q) - w * t;
    float cf = cos(f);
    float sf = sin(f);
    return vec3(dir.x * steep * amp * cf, amp * sf, dir.y * steep * amp * cf);
  }

  // 合成波面位移。振幅合计约 ±20；水平轨道使波面滚动流动。
  vec3 oceanDisplace(vec2 q) {
    vec3 d = vec3(0.0);
${OCEAN_WAVES.map(
  (w) =>
    `    d += gerstnerWave(q, vec2(${w.dir[0].toFixed(5)}, ${w.dir[1].toFixed(5)}), ${w.wavelength.toFixed(1)}, ${w.amp.toFixed(2)}, ${w.steep.toFixed(2)}, ${w.speed.toFixed(2)});`,
).join("\n")}
    // 河流落点生成一组径向余波，让纵向河束与横向光海共享同一个运动源。
    vec2 impactOffset = q - vec2(${WATERFALL_CENTER_X.toFixed(1)}, ${CONFLUENCE_CENTER_Z.toFixed(1)});
    float impactDistance = length(impactOffset);
    vec2 impactDir = impactOffset / max(impactDistance, 0.001);
    float impactEnvelope = smoothstep(${CONFLUENCE_RIPPLE.near.toFixed(1)}, ${(CONFLUENCE_RIPPLE.near + 10).toFixed(1)}, impactDistance)
      * (1.0 - smoothstep(${(CONFLUENCE_RIPPLE.far - 55).toFixed(1)}, ${CONFLUENCE_RIPPLE.far.toFixed(1)}, impactDistance));
    float impactK = 6.2831853 / ${CONFLUENCE_RIPPLE.wavelength.toFixed(1)};
    float impactT = uTime * 0.00035 * uFlow;
    float impactPhase = impactK * impactDistance - ${CONFLUENCE_RIPPLE.speed.toFixed(2)} * impactT;
    d += vec3(
      impactDir.x * ${CONFLUENCE_RIPPLE.steep.toFixed(2)} * ${CONFLUENCE_RIPPLE.amp.toFixed(2)} * cos(impactPhase),
      ${CONFLUENCE_RIPPLE.amp.toFixed(2)} * sin(impactPhase),
      impactDir.y * ${CONFLUENCE_RIPPLE.steep.toFixed(2)} * ${CONFLUENCE_RIPPLE.amp.toFixed(2)} * cos(impactPhase)
    ) * impactEnvelope;
    return d * uAmp;
  }

  float oceanHeight(vec2 q) { return oceanDisplace(q).y; }
`;

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

function smoothstep(min: number, max: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 17.17) * 43758.5453;
  return value - Math.floor(value);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const top = THREE.MathUtils.lerp(
    hash2(x0, y0, seed),
    hash2(x0 + 1, y0, seed),
    sx,
  );
  const bottom = THREE.MathUtils.lerp(
    hash2(x0, y0 + 1, seed),
    hash2(x0 + 1, y0 + 1, seed),
    sx,
  );
  return THREE.MathUtils.lerp(top, bottom, sy);
}

function fbm(x: number, y: number, seed: number): number {
  let amplitude = 0.56;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 13) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return total / normalization;
}

function createCloudTexture(seed: number): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / (size - 1) * 2 - 1;
      const ny = y / (size - 1) * 2 - 1;
      const radius = Math.sqrt(nx * nx + ny * ny * 0.68);
      const warpedX = nx * 2.4 + fbm(nx * 1.7, ny * 1.7, seed) * 0.72;
      const warpedY = ny * 1.8 + fbm(nx * 1.3 + 7, ny * 1.3 - 4, seed + 9) * 0.54;
      const density = fbm(warpedX + 11, warpedY - 8, seed + 23);
      const envelope = 1 - smoothstep(0.34, 1.02, radius);
      const alpha = envelope * smoothstep(0.34, 0.76, density) * 0.92;
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createRadialTexture(): THREE.DataTexture {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / (size - 1) * 2 - 1;
      const ny = y / (size - 1) * 2 - 1;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const alpha = Math.pow(Math.max(0, 1 - radius), 2.4);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function waterfallColor(t: number, brightness = 1): THREE.Color {
  const color = t < 0.5
    ? CELESTIAL.clone().lerp(IVORY, smoothstep(0.04, 0.5, t))
    : IVORY.clone().lerp(MEMORY_GOLD, smoothstep(0.5, 0.94, t));
  return color.multiplyScalar(brightness);
}

interface WaterfallStrandProfile {
  angle: number;
  radius: number;
  phase: number;
  skew: number;
}

function waterfallPoint(
  profile: WaterfallStrandProfile,
  t: number,
  topY: number,
): THREE.Vector3 {
  const shoulder = Math.pow(Math.sin(t * Math.PI), 1.12);
  const mouth = smoothstep(0.66, 1, t);
  const centralBend =
    Math.sin(t * Math.PI * 1.64 + 0.38) * (2.8 + shoulder * 2.8) +
    Math.sin(t * Math.PI * 3.25 + 1.15) * shoulder * 1.05;
  const bodyRadiusX = 8.8 + shoulder * 10.2;
  const bodyRadiusZ = 6.2 + shoulder * 7.8;
  const radiusX = THREE.MathUtils.lerp(bodyRadiusX, 32, mouth);
  const radiusZ = THREE.MathUtils.lerp(bodyRadiusZ, 8.4, mouth);
  const crossX = Math.cos(profile.angle) * profile.radius * radiusX;
  const crossZ = Math.sin(profile.angle) * profile.radius * radiusZ;
  const strandWander =
    Math.sin(t * (7.4 + profile.phase * 3.2) + profile.phase * 11) *
    (0.34 + shoulder * 1.25) *
    (1 - mouth * 0.62);
  const bundleDrift =
    Math.sin(
      t * Math.PI * (1.08 + profile.phase * 0.5) +
      profile.phase * Math.PI * 2,
    ) *
    Math.sin(t * Math.PI) *
    (0.5 + profile.radius * 2.5);
  const centerZ = THREE.MathUtils.lerp(
    -10,
    CONFLUENCE_CENTER_Z + 9.5,
    Math.pow(t, 1.2),
  );
  const mouthLift = (1 - Math.pow(Math.abs(Math.cos(profile.angle)), 1.6))
    * profile.radius
    * mouth
    * 0.5;
  return new THREE.Vector3(
    WATERFALL_CENTER_X +
      centralBend +
      crossX +
      strandWander +
      bundleDrift +
      profile.skew * shoulder,
    THREE.MathUtils.lerp(topY, SEA_BASE_Y + 0.32, t) + mouthLift,
    centerZ +
      crossZ +
      Math.sin(t * 9.2 + profile.phase * 7) * (0.16 + shoulder * 0.55),
  );
}

function createWaterfallFibers(
  random: () => number,
  topY: number,
  quality: SceneQuality,
): { object: THREE.LineSegments; material: THREE.ShaderMaterial } {
  const strandCount = quality === "default" ? 168 : 82;
  const segmentCount = quality === "default" ? 144 : 84;
  const positions: number[] = [];
  const colors: number[] = [];
  const progresses: number[] = [];
  const seeds: number[] = [];
  const speeds: number[] = [];
  const edges: number[] = [];
  const color = new THREE.Color();
  const bundleAngles = Array.from({ length: 14 }, (_, index) =>
    index / 14 * Math.PI * 2,
  );

  for (let strand = 0; strand < strandCount; strand += 1) {
    const phase = random();
    const radius = 0.14 + Math.pow(random(), 0.72) * 0.86;
    const profile: WaterfallStrandProfile = {
      angle: bundleAngles[strand % bundleAngles.length] + (random() - 0.5) * 0.3,
      radius,
      phase,
      skew: (random() - 0.5) * 2.2,
    };
    const strandBrightness = random() < 0.13
      ? 0.68 + random() * 0.34
      : 0.22 + random() * 0.36;
    const startT = random() * 0.045;
    const endT = 0.965 + random() * 0.035;
    const flowSeed = random();
    const flowSpeed = 0.72 + random() * 0.72;
    const edge = smoothstep(0.58, 1, radius);

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const t0 = THREE.MathUtils.lerp(startT, endT, segment / segmentCount);
      const t1 = THREE.MathUtils.lerp(startT, endT, (segment + 1) / segmentCount);
      const start = waterfallPoint(profile, t0, topY);
      const end = waterfallPoint(profile, t1, topY);
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
      color.copy(waterfallColor(t0, strandBrightness));
      colors.push(color.r, color.g, color.b);
      color.copy(waterfallColor(t1, strandBrightness));
      colors.push(color.r, color.g, color.b);
      progresses.push(t0, t1);
      seeds.push(flowSeed, flowSeed);
      speeds.push(flowSpeed, flowSpeed);
      edges.push(edge, edge);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progresses, 1));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute("aSpeed", new THREE.Float32BufferAttribute(speeds, 1));
  geometry.setAttribute("aEdge", new THREE.Float32BufferAttribute(edges, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uOpacity: { value: 0.27 },
    },
    vertexShader: `
      attribute vec3 color;
      attribute float aProgress;
      attribute float aSeed;
      attribute float aSpeed;
      attribute float aEdge;

      varying vec3 vColor;
      varying float vProgress;
      varying float vSeed;
      varying float vSpeed;
      varying float vEdge;

      void main() {
        vColor = color;
        vProgress = aProgress;
        vSeed = aSeed;
        vSpeed = aSpeed;
        vEdge = aEdge;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uFlow;
      uniform float uOpacity;

      varying vec3 vColor;
      varying float vProgress;
      varying float vSeed;
      varying float vSpeed;
      varying float vEdge;

      void main() {
        float phase = fract(
          vProgress * (4.2 + vSeed * 1.7)
          - uTime * 0.00017 * vSpeed * uFlow
          + vSeed
        );
        float pulse = smoothstep(0.0, 0.045, phase)
          * (1.0 - smoothstep(0.045, 0.19, phase));
        float afterglow = smoothstep(0.0, 0.22, phase)
          * (1.0 - smoothstep(0.22, 0.52, phase));
        vec3 highlight = vec3(1.0, 0.94, 0.78);
        vec3 color = mix(vColor, highlight, pulse * (0.42 + vEdge * 0.2));
        float alpha = uOpacity
          * (0.34 + vEdge * 0.16 + pulse * 1.55 + afterglow * 0.18);
        if (alpha <= 0.003) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = 2;
  object.frustumCulled = false;
  return { object, material };
}

function createWaterfallParticles(
  random: () => number,
  topY: number,
  quality: SceneQuality,
): { object: THREE.Points; material: THREE.ShaderMaterial } {
  const count = quality === "default" ? 7600 : 3200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  const progresses = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const t = Math.pow(random(), 0.92);
    const phase = random();
    const profile: WaterfallStrandProfile = {
      angle: random() * Math.PI * 2,
      radius: Math.pow(random(), 0.78),
      phase,
      skew: (random() - 0.5) * 2.4,
    };
    const point = waterfallPoint(profile, t, topY);
    const radialJitter = 0.24 + Math.sin(t * Math.PI) * 0.64;
    positions[index * 3] = point.x + (random() - 0.5) * radialJitter;
    positions[index * 3 + 1] = point.y + (random() - 0.5) * 0.42;
    positions[index * 3 + 2] = point.z + (random() - 0.5) * radialJitter;
    const color = waterfallColor(t, 0.48 + random() * 0.88);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    seeds[index] = phase;
    speeds[index] = 0.6 + random() * 1.2;
    progresses[index] = t;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute("aProgress", new THREE.BufferAttribute(progresses, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: quality === "default" ? 1.18 : 1.42 },
      uOpacity: { value: 0.18 },
      uFlow: { value: 1 },
    },
    vertexShader: `
      attribute vec3 color;
      attribute float aSeed;
      attribute float aSpeed;
      attribute float aProgress;

      varying vec3 vColor;
      varying float vPulse;
      uniform float uTime;
      uniform float uSize;
      uniform float uFlow;

      void main() {
        vec3 p = position;
        float drift = mod(uTime * 0.00007 * aSpeed + aSeed * 3.7, 3.7);
        p.y -= drift * uFlow;
        p.x += sin(p.y * 0.095 + aSeed * 12.0 + uTime * 0.00018) * 0.16 * uFlow;
        float flowPhase = fract(
          aProgress * (5.0 + aSeed * 1.8)
          - uTime * 0.0002 * aSpeed * uFlow
          + aSeed
        );
        vPulse = smoothstep(0.0, 0.08, flowPhase)
          * (1.0 - smoothstep(0.08, 0.28, flowPhase));
        vColor = mix(color, vec3(1.0, 0.94, 0.78), vPulse * 0.5);
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(
          uSize * (1.0 + vPulse * 0.85) * (300.0 / max(1.0, -viewPosition.z)),
          0.7,
          5.2
        );
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vPulse;
      uniform float uOpacity;

      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float core = 1.0 - smoothstep(0.04, 0.22, distanceToCenter);
        float halo = 1.0 - smoothstep(0.12, 0.5, distanceToCenter);
        float alpha = (core * 0.78 + halo * 0.22)
          * uOpacity
          * (0.72 + vPulse * 0.9);
        if (alpha <= 0.003) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = new THREE.Points(geometry, material);
  object.renderOrder = 3;
  object.frustumCulled = false;
  return { object, material };
}

function createConfluenceFlows(
  random: () => number,
  quality: SceneQuality,
  flowField: OceanFlowField,
): { object: THREE.LineSegments; material: THREE.ShaderMaterial } {
  const bundleCount = quality === "default" ? 32 : 20;
  const strandCount = quality === "default" ? 3 : 2;
  const positions: number[] = [];
  const progresses: number[] = [];
  const brights: number[] = [];
  const seeds: number[] = [];
  const speeds: number[] = [];

  for (let bundle = 0; bundle < bundleCount; bundle += 1) {
    const lane = THREE.MathUtils.lerp(-0.94, 0.94, bundle / (bundleCount - 1))
      + Math.sin(bundle * 1.73) * 0.014;
    const length = 94 + Math.pow(random(), 0.72) * 156;
    const brightness = 0.48 + random() * 0.48 + (random() < 0.08 ? 0.3 : 0);
    const flowSeed = random();
    const flowSpeed = 0.72 + random() * 0.62;

    for (let strand = 0; strand < strandCount; strand += 1) {
      const strandOffset = strand - (strandCount - 1) / 2;
      const mouthLane = lane + strandOffset * 0.018;
      const startX = WATERFALL_CENTER_X + mouthLane * 31.5;
      const startZ = CONFLUENCE_CENTER_Z + 8.5 - Math.abs(mouthLane) * 2.8;
      const strandLength = length * (1 + strandOffset * 0.012);
      const strandBright = brightness * (0.88 + strand * 0.06);
      const strandSeed = flowSeed + strandOffset * 0.025;
      const path = flowField.trace(startX, startZ, {
        maxDistance: strandLength,
        step: quality === "default" ? 3.2 : 4.8,
      });

      for (let index = 0; index < path.length - 1; index += 1) {
        const start = path[index];
        const end = path[index + 1];
        const progress = end.distance / strandLength;
        positions.push(
          start.x,
          SEA_BASE_Y + 0.32,
          start.z,
          end.x,
          SEA_BASE_Y + 0.32,
          end.z,
        );
        progresses.push(start.distance / strandLength, progress);
        brights.push(strandBright, strandBright);
        seeds.push(strandSeed, strandSeed);
        speeds.push(flowSpeed, flowSpeed);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progresses, 1));
  geometry.setAttribute("aBright", new THREE.Float32BufferAttribute(brights, 1));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute("aSpeed", new THREE.Float32BufferAttribute(speeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uAmp: { value: 1 },
      uOpacity: { value: 0.15 },
      uCore: { value: new THREE.Color(0xffdca2) },
      uFlowColor: { value: new THREE.Color(0xd99738) },
      uCrest: { value: new THREE.Color(0xfffaea) },
      uFade: { value: new THREE.Vector2(SEA_FADE_NEAR, SEA_FADE_FAR) },
    },
    vertexShader: `
      attribute float aProgress;
      attribute float aBright;
      attribute float aSeed;
      attribute float aSpeed;

      uniform float uTime;
      uniform float uFlow;
      uniform float uAmp;
      uniform float uOpacity;
      uniform vec3 uCore;
      uniform vec3 uFlowColor;
      uniform vec3 uCrest;
      uniform vec2 uFade;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vProgress;
      varying float vSeed;
      varying float vSpeed;

      ${OCEAN_HEIGHT_GLSL}

      void main() {
        vec3 p = position;
        vec3 disp = oceanDisplace(p.xz);
        float oceanBlend = smoothstep(0.0, 0.18, aProgress);
        p += disp * oceanBlend;

        float crest = smoothstep(5.0, 17.0, disp.y * oceanBlend);
        float contactLight = 1.0 - smoothstep(0.02, 0.34, aProgress);
        vec3 base = mix(uCore, uFlowColor, smoothstep(0.04, 0.86, aProgress));
        vColor = mix(base, uCrest, crest * 0.56 + contactLight * 0.12)
          * (0.44 + aBright * 0.5);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float horizonFade = 1.0 - smoothstep(uFade.x, uFade.y, -mv.z);
        float entryFade = 0.42 + smoothstep(0.0, 0.09, aProgress) * 0.58;
        float reachFade = 1.0 - smoothstep(0.68, 1.0, aProgress);
        vAlpha = uOpacity
          * horizonFade
          * entryFade
          * (0.2 + reachFade * 0.8)
          * (0.62 + contactLight * 0.56)
          * min(aBright, 1.35);
        vProgress = aProgress;
        vSeed = aSeed;
        vSpeed = aSpeed;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vProgress;
      varying float vSeed;
      varying float vSpeed;

      uniform float uTime;
      uniform float uFlow;

      void main() {
        if (vAlpha <= 0.003) discard;
        float phase = fract(
          vProgress * (4.6 + vSeed * 1.8)
          - uTime * 0.00016 * vSpeed * uFlow
          + vSeed
        );
        float pulse = smoothstep(0.0, 0.05, phase)
          * (1.0 - smoothstep(0.05, 0.2, phase));
        vec3 color = mix(vColor, vec3(1.0, 0.95, 0.8), pulse * 0.58);
        gl_FragColor = vec4(color, vAlpha * (0.7 + pulse * 1.25));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = 3;
  object.frustumCulled = false;
  return { object, material };
}

function createFlowingOcean(
  random: () => number,
  quality: SceneQuality,
  flowField: OceanFlowField,
): { object: THREE.LineSegments; material: THREE.ShaderMaterial } {
  const masterRowCount = quality === "default" ? 176 : 96;
  const detailColumns = quality === "default" ? 88 : 50;
  const detailRows = quality === "default" ? 70 : 40;
  const traceStep = quality === "default" ? 3.6 : 5.4;
  const xMin = flowField.bounds.minX;
  const width = flowField.bounds.maxX - flowField.bounds.minX;
  const zRange = SEA_Z_MAX - SEA_Z_MIN;

  const positions: number[] = [];
  const brights: number[] = [];
  const depths: number[] = [];
  const layers: number[] = [];
  const flowCoords: number[] = [];
  const flowSeeds: number[] = [];

  const offsetPoint = (point: OceanFlowPoint, offset: number, depth: number) => {
    if (offset === 0) {
      return {
        x: point.x,
        y: SEA_BASE_Y - depth * SEA_DEPTH_BELOW,
        z: point.z,
      };
    }
    const flow = flowField.sample(point.x, point.z);
    return {
      x: point.x - flow.vz * offset,
      y: SEA_BASE_Y - depth * SEA_DEPTH_BELOW,
      z: point.z + flow.vx * offset,
    };
  };

  const appendSegment = (
    start: OceanFlowPoint,
    end: OceanFlowPoint,
    offset: number,
    depth: number,
    bright: number,
    layer: number,
    seed: number,
    startCoord: number,
    endCoord: number,
  ) => {
    const a = offsetPoint(start, offset, depth);
    const b = offsetPoint(end, offset, depth);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    brights.push(bright, bright);
    depths.push(depth, depth);
    layers.push(layer, layer);
    flowCoords.push(startCoord, endCoord);
    flowSeeds.push(seed, seed);
  };

  const appendPath = (
    path: OceanFlowPoint[],
    offset: number,
    depth: number,
    bright: number,
    layer: number,
    seed: number,
  ) => {
    let distance = 0;
    for (let index = 0; index < path.length - 1; index += 1) {
      const segmentLength = Math.hypot(
        path[index + 1].x - path[index].x,
        path[index + 1].z - path[index].z,
      );
      appendSegment(
        path[index],
        path[index + 1],
        offset,
        depth,
        bright,
        layer,
        seed,
        distance / 42,
        (distance + segmentLength) / 42,
      );
      distance += segmentLength;
    }
  };

  // Sparse full-length streamlines reveal the large-scale current without making a net.
  for (let row = 0; row < masterRowCount; row += 1) {
    const seedZ = SEA_Z_MIN
      + (row + 0.5) / masterRowCount * zRange
      + (random() - 0.5) * zRange / masterRowCount * 0.45;
    for (const side of [-1, 1] as const) {
      const seedX = WATERFALL_CENTER_X + side * (7 + random() * 3.5);
      const path = flowField.trace(seedX, seedZ, {
        maxDistance: SEA_X_HALF + 92,
        step: traceStep,
      });
      const sample = flowField.sample(seedX, seedZ);
      const baseDepth = random() < 0.08 ? 0.035 + random() * 0.06 : random() * 0.014;
      appendPath(
        path,
        0,
        baseDepth,
        0.22 + sample.density * 0.24 + random() * 0.11,
        0,
        random(),
      );
    }
  }

  // Thousands of short, stratified traces provide fiber density. Every segment is
  // integrated through the same field, so added density does not add random crossings.
  for (let row = 0; row < detailRows; row += 1) {
    for (let column = 0; column < detailColumns; column += 1) {
      const seedX = xMin + (column + 0.18 + random() * 0.64) / detailColumns * width;
      const seedZ = SEA_Z_MIN
        + (row + 0.18 + random() * 0.64) / detailRows * zRange;
      const flow = flowField.sample(seedX, seedZ);
      if (random() > 0.72 + flow.density * 0.28) continue;
      const length = THREE.MathUtils.lerp(
        SEA_THREAD_LEN_MIN,
        SEA_THREAD_LEN_MAX,
        random(),
      );
      const backwardLength = length * (0.38 + random() * 0.24);
      const backward = flowField.trace(seedX, seedZ, {
        direction: -1,
        maxDistance: backwardLength,
        step: traceStep * 0.72,
      });
      const forward = flowField.trace(seedX, seedZ, {
        maxDistance: length - backwardLength,
        step: traceStep * 0.72,
      });
      const path = [...backward.reverse(), ...forward.slice(1)];
      const familySize = random() < 0.16 ? 2 : 1;
      const depth = random() < 0.1 ? 0.018 + random() * 0.07 : random() * 0.012;
      const bright = 0.45 + flow.density * 0.34 + random() * 0.28;
      const seed = random();
      for (let strand = 0; strand < familySize; strand += 1) {
        const offset = familySize === 1 ? 0 : (strand - 0.5) * 0.72;
        appendPath(path, offset, depth, bright * (0.94 + strand * 0.06), 1, seed);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aBright", new THREE.Float32BufferAttribute(brights, 1));
  geometry.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1));
  geometry.setAttribute("aLayer", new THREE.Float32BufferAttribute(layers, 1));
  geometry.setAttribute("aFlowCoord", new THREE.Float32BufferAttribute(flowCoords, 1));
  geometry.setAttribute("aFlowSeed", new THREE.Float32BufferAttribute(flowSeeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uAmp: { value: 1 },
      uOpacity: { value: 0.24 },
      // 金色光海：谷底深金、脊面亮金、波峰近乎白金；沉入未来时转为冷暗。
      uNear: { value: new THREE.Color(0xffd98a) },
      uFar: { value: new THREE.Color(0xb07f2e) },
      uCrest: { value: new THREE.Color(0xfff6dc) },
      uDeep: { value: new THREE.Color(0x140d05) },
      uZRange: { value: new THREE.Vector2(SEA_Z_MIN, SEA_Z_MAX) },
      // 视距淡出：超出 uFade.x 起渐隐，至 uFade.y 归零，使海域没入黑暗形成无际地平。
      uFade: { value: new THREE.Vector2(SEA_FADE_NEAR, SEA_FADE_FAR) },
    },
    vertexShader: `
      attribute float aBright;
      attribute float aDepth;
      attribute float aLayer;
      attribute float aFlowCoord;
      attribute float aFlowSeed;

      uniform float uTime;
      uniform float uFlow;
      uniform float uAmp;
      uniform float uOpacity;
      uniform vec3 uNear;
      uniform vec3 uFar;
      uniform vec3 uCrest;
      uniform vec3 uDeep;
      uniform vec2 uZRange;
      uniform vec2 uFade;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vFlowCoord;
      varying float vFlowSeed;
      varying float vLayer;

      ${OCEAN_HEIGHT_GLSL}

      void main() {
        vec3 p = position;
        // 波浪只作用于接近海面的丝线；越深越平静(未来不可知、无涌动)。
        float surfaceness = 1.0 - clamp(aDepth, 0.0, 1.0);
        // 三维波面位移：水平+垂直的圆周轨道，使丝线披在起伏波面上并顺流摆动（而非整体上下抽动）。
        vec3 disp = oceanDisplace(p.xz) * surfaceness;
        p += disp;
        float h = disp.y;

        float d = clamp((p.z - uZRange.x) / (uZRange.y - uZRange.x), 0.0, 1.0);
        // 近景稍暖、远景更沉；长主流线比家族短丝束再暗一级。
        vec3 base = mix(uFar, uNear, smoothstep(0.08, 0.92, d));
        // 波峰高度归一（振幅约 ±22）：脊顶提亮为白金。
        float crest = smoothstep(5.0, 17.0, h);
        vec3 col = mix(base, uCrest, crest * 0.82)
          * aBright
          * mix(0.66, 1.0, aLayer);
        // 沉入未来：变冷变暗。
        col = mix(col, uDeep, aDepth * 0.8);
        vColor = col;

        float depthFade = mix(1.0, 0.04, aDepth); // 越深越淡

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // 视距淡出：远处渐隐至零，海域没入黑暗，形成无边地平线（取代有限平面的硬边）。
        float viewDist = -mv.z;
        float horizonFade = 1.0 - smoothstep(uFade.x, uFade.y, viewDist);
        // 波脊更亮、波谷偏暗，强化滚动涌浪的体积感。
        vAlpha = uOpacity
          * horizonFade
          * depthFade
          * mix(0.16 + crest * 0.38, 0.6 + crest * 0.84, aLayer);
        vFlowCoord = aFlowCoord;
        vFlowSeed = aFlowSeed;
        vLayer = aLayer;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vFlowCoord;
      varying float vFlowSeed;
      varying float vLayer;

      uniform float uTime;
      uniform float uFlow;

      void main() {
        if (vAlpha <= 0.003) discard;
        float phase = fract(
          vFlowCoord
          - uTime * 0.00011 * (0.76 + vFlowSeed * 0.48) * uFlow
          + vFlowSeed
        );
        float pulse = smoothstep(0.0, 0.045, phase)
          * (1.0 - smoothstep(0.045, 0.19, phase));
        float pulseStrength = mix(0.16, 0.82, vLayer) * pulse;
        vec3 color = mix(vColor, vec3(1.0, 0.95, 0.82), pulseStrength * 0.5);
        gl_FragColor = vec4(color, vAlpha * (1.0 + pulseStrength));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = 2;
  object.frustumCulled = false;
  return { object, material };
}

function createSeaFoam(
  random: () => number,
  quality: SceneQuality,
  flowField: OceanFlowField,
): { object: THREE.Points; material: THREE.ShaderMaterial } {
  const count = quality === "default" ? 26000 : 10000;
  const xMin = WATERFALL_CENTER_X - SEA_X_HALF;
  const width = SEA_X_HALF * 2;
  const zRange = SEA_Z_MAX - SEA_Z_MIN;
  const positions = new Float32Array(count * 3);
  const brights = new Float32Array(count);
  const flowVectors = new Float32Array(count * 2);
  const drips = new Float32Array(count); // 0 = 贴海面的金沙；>0 = 从波下垂落的光丝(下坠深度)
  for (let index = 0; index < count; index += 1) {
    let x = xMin + width * random();
    let z = SEA_Z_MIN + zRange * random();
    let flow = flowField.sample(x, z);
    while (random() > 0.36 + flow.density * 0.64) {
      x = xMin + width * random();
      z = SEA_Z_MIN + zRange * random();
      flow = flowField.sample(x, z);
    }
    positions[index * 3] = x;
    positions[index * 3 + 1] = SEA_BASE_Y;
    positions[index * 3 + 2] = z;
    brights[index] = 0.42 + flow.density * 0.48 + random() * 0.78;
    flowVectors[index * 2] = flow.vx;
    flowVectors[index * 2 + 1] = flow.vz;
    // 极少量短垂光保留海面纵深，不再形成大面积根系状悬丝。
    drips[index] = random() < 0.045 ? Math.pow(random(), 1.7) * 22 : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aBright", new THREE.BufferAttribute(brights, 1));
  geometry.setAttribute("aFlow", new THREE.BufferAttribute(flowVectors, 2));
  geometry.setAttribute("aDrip", new THREE.BufferAttribute(drips, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uAmp: { value: 1 },
      uOpacity: { value: 0.7 },
      uSize: { value: quality === "default" ? 1.7 : 1.9 },
      // 金色浪花：海面亮金，远处深金，波峰白金。
      uNear: { value: new THREE.Color(0xffe19a) },
      uFar: { value: new THREE.Color(0xc08a38) },
      uCrest: { value: new THREE.Color(0xfff8e2) },
      uZRange: { value: new THREE.Vector2(SEA_Z_MIN, SEA_Z_MAX) },
      uFade: { value: new THREE.Vector2(SEA_FADE_NEAR, SEA_FADE_FAR) },
    },
    vertexShader: `
      attribute float aBright;
      attribute float aDrip;
      attribute vec2 aFlow;

      uniform float uTime;
      uniform float uFlow;
      uniform float uAmp;
      uniform float uOpacity;
      uniform float uSize;
      uniform vec3 uNear;
      uniform vec3 uFar;
      uniform vec3 uCrest;
      uniform vec2 uZRange;
      uniform vec2 uFade;

      varying vec3 vColor;
      varying float vAlpha;

      ${OCEAN_HEIGHT_GLSL}

      void main() {
        vec3 p = position;
        float tangentDrift = sin(
          uTime * 0.00032 * uFlow + position.x * 0.021 + position.z * 0.013
        ) * 0.72;
        p.xz += aFlow * tangentDrift;
        // 与丝线海共用三维波面轨道，浪花随波滚动流淌。
        vec3 disp = oceanDisplace(p.xz);
        p += disp;
        float h = disp.y;
        // 垂落光丝：从海面向下悬垂，并随时间缓慢滴落循环。
        float t = uTime * 0.00035 * uFlow;
        float sag = aDrip * (0.6 + 0.4 * sin(t * 1.7 + p.x * 0.05));
        p.y -= sag;
        float d = clamp((p.z - uZRange.x) / (uZRange.y - uZRange.x), 0.0, 1.0);
        vec3 base = mix(uFar, uNear, smoothstep(0.08, 0.92, d));
        float crest = smoothstep(5.0, 17.0, h);
        vColor = mix(base, uCrest, crest * 0.8) * aBright;
        // 垂落段随下坠变暗，融入下方黑暗。
        float dripFade = 1.0 - smoothstep(0.0, 22.0, sag) * 0.82;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // 视距淡出：远处渐隐至零，浪花没入黑暗，与丝线海协同形成无际地平。
        float horizonFade = 1.0 - smoothstep(uFade.x, uFade.y, -mv.z);
        vAlpha = uOpacity * horizonFade * dripFade * (0.07 + crest * 1.08);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (300.0 / max(1.0, -mv.z)), 0.6, 3.6);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float alpha = (1.0 - smoothstep(0.1, 0.5, distanceToCenter)) * vAlpha;
        if (alpha <= 0.003) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = new THREE.Points(geometry, material);
  object.renderOrder = 3;
  object.frustumCulled = false;
  return { object, material };
}

function createStars(
  random: () => number,
  topY: number,
  quality: SceneQuality,
): THREE.Points {
  const count = quality === "default" ? 1900 : 850;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 260;
    positions[index * 3 + 1] = random() * (topY + 34) - 8;
    positions[index * 3 + 2] = -18 - random() * 88;
    const color = CELESTIAL.clone().lerp(IVORY, random() * 0.25);
    color.multiplyScalar(0.28 + Math.pow(random(), 5) * 1.4);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.2,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

function createGlowSprite(
  texture: THREE.Texture,
  color: number,
  opacity: number,
  position: THREE.Vector3,
  scale: THREE.Vector2,
): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sprite.position.copy(position);
  sprite.scale.set(scale.x, scale.y, 1);
  sprite.renderOrder = 1;
  return sprite;
}

function createClouds(
  random: () => number,
  texture: THREE.Texture,
  topY: number,
  quality: SceneQuality,
): { group: THREE.Group; states: CloudSpriteState[] } {
  const group = new THREE.Group();
  const states: CloudSpriteState[] = [];
  const count = quality === "default" ? 44 : 24;
  for (let index = 0; index < count; index += 1) {
    const zone = index / count;
    const isSourceCloud = zone < 0.52;
    const isMidCloud = zone >= 0.52 && zone < 0.8;
    const isLeft = random() < 0.5;
    const x = isSourceCloud
      ? WATERFALL_CENTER_X + (random() - 0.5) * 94
      : isMidCloud
        ? (isLeft ? -1 : 1) * (44 + random() * 68)
        : (isLeft ? -1 : 1) * (30 + random() * 74);
    const y = isSourceCloud
      ? topY - 6 + (random() - 0.35) * 42
      : isMidCloud
        ? 34 + random() * 58
        : 2 + random() * 25;
    const z = isSourceCloud
      ? -12 - random() * 56
      : isMidCloud
        ? -20 - random() * 38
        : -4 + (random() - 0.5) * 34;
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: isSourceCloud ? 0x3b566e : isMidCloud ? 0x2d465b : 0x263d50,
      transparent: true,
      opacity: isSourceCloud
        ? 0.09 + random() * 0.13
        : isMidCloud
          ? 0.065 + random() * 0.085
          : 0.065 + random() * 0.075,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      rotation: (random() - 0.5) * Math.PI,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    const width = isSourceCloud
      ? 54 + random() * 82
      : isMidCloud
        ? 62 + random() * 86
        : 52 + random() * 82;
    sprite.scale.set(width, width * (0.36 + random() * 0.28), 1);
    sprite.renderOrder = 0;
    group.add(sprite);
    states.push({
      sprite,
      basePosition: sprite.position.clone(),
      baseOpacity: material.opacity,
      phase: random() * Math.PI * 2,
    });
  }
  return { group, states };
}

export function createHistoryVisuals(options: {
  seed: number;
  topY: number;
  quality: SceneQuality;
}): HistoryVisualRig {
  const { seed, topY, quality } = options;
  const random = seededRandom(seed + (quality === "default" ? 101 : 211));
  const root = new THREE.Group();
  const cloudTexture = createCloudTexture(seed);
  const radialTexture = createRadialTexture();

  const stars = createStars(random, topY, quality);
  stars.renderOrder = -1;
  root.add(stars);

  const clouds = createClouds(random, cloudTexture, topY, quality);
  root.add(clouds.group);

  const oceanFlowField = new OceanFlowField({
    bounds: {
      minX: WATERFALL_CENTER_X - SEA_X_HALF,
      maxX: WATERFALL_CENTER_X + SEA_X_HALF,
      minZ: SEA_Z_MIN,
      maxZ: SEA_Z_MAX,
    },
    columns: quality === "default" ? 161 : 105,
    rows: quality === "default" ? 129 : 81,
    mouthX: WATERFALL_CENTER_X,
    mouthZ: CONFLUENCE_CENTER_Z,
    seed,
  });
  const flowingOcean = createFlowingOcean(random, quality, oceanFlowField);
  const confluenceFlows = createConfluenceFlows(random, quality, oceanFlowField);
  const seaFoam = createSeaFoam(random, quality, oceanFlowField);
  root.add(flowingOcean.object, confluenceFlows.object, seaFoam.object);

  const waterfallFibers = createWaterfallFibers(random, topY, quality);
  const waterfallParticles = createWaterfallParticles(random, topY, quality);
  root.add(waterfallFibers.object, waterfallParticles.object);

  const sourceGlow = createGlowSprite(
    radialTexture,
    0xb9d0e2,
    0.28,
    new THREE.Vector3(WATERFALL_CENTER_X - 1, topY + 1, -8),
    new THREE.Vector2(42, 48),
  );
  const confluenceGlow = createGlowSprite(
    radialTexture,
    0xffd890,
    0.2,
    new THREE.Vector3(WATERFALL_CENTER_X, 2.4, CONFLUENCE_CENTER_Z),
    new THREE.Vector2(128, 22),
  );
  const confluenceCore = createGlowSprite(
    radialTexture,
    0xfff4df,
    0.22,
    new THREE.Vector3(WATERFALL_CENTER_X, 1.4, CONFLUENCE_CENTER_Z + 7),
    new THREE.Vector2(72, 8),
  );
  const horizonMist = createGlowSprite(
    cloudTexture,
    0xd9b76e,
    0.11,
    new THREE.Vector3(WATERFALL_CENTER_X - 4, 7, CONFLUENCE_CENTER_Z + 5),
    new THREE.Vector2(186, 38),
  );
  const seaMist = createGlowSprite(
    cloudTexture,
    0xe8c473,
    0.06,
    new THREE.Vector3(WATERFALL_CENTER_X + 6, 4, 58),
    new THREE.Vector2(236, 46),
  );
  root.add(
    sourceGlow,
    confluenceGlow,
    confluenceCore,
    horizonMist,
    seaMist,
  );

  const viewOpacity: Record<ExperienceState, number> = {
    "river-overview": 1,
    "entering-window": 0.62,
    slice: 0.24,
    "person-focus": 0.18,
    "relation-focus": 0.14,
  };

  return {
    root,
    update(now, view, lowMotion) {
      const visibility = viewOpacity[view];
      waterfallParticles.material.uniforms.uTime.value = lowMotion ? 0 : now;
      waterfallParticles.material.uniforms.uFlow.value = lowMotion ? 0 : 1;
      waterfallParticles.material.uniforms.uOpacity.value = 0.4 * visibility;
      waterfallFibers.material.uniforms.uTime.value = now;
      waterfallFibers.material.uniforms.uFlow.value = lowMotion ? 0 : 1;
      waterfallFibers.material.uniforms.uOpacity.value = 0.29 * visibility;

      // 编织海面与浪花：uTime 驱动波浪仿真，低动态偏好时冻结起伏但保留静态海面。
      const oceanFlow = lowMotion ? 0 : 1;
      const oceanAmp = lowMotion ? 0.35 : 1;
      flowingOcean.material.uniforms.uTime.value = now;
      flowingOcean.material.uniforms.uFlow.value = oceanFlow;
      flowingOcean.material.uniforms.uAmp.value = oceanAmp;
      flowingOcean.material.uniforms.uOpacity.value = 0.36 * visibility;
      confluenceFlows.material.uniforms.uTime.value = now;
      confluenceFlows.material.uniforms.uFlow.value = oceanFlow;
      confluenceFlows.material.uniforms.uAmp.value = oceanAmp;
      confluenceFlows.material.uniforms.uOpacity.value = 0.15 * visibility;
      seaFoam.material.uniforms.uTime.value = now;
      seaFoam.material.uniforms.uFlow.value = oceanFlow;
      seaFoam.material.uniforms.uAmp.value = oceanAmp;
      seaFoam.material.uniforms.uOpacity.value = 0.92 * visibility;

      const breath = lowMotion ? 1 : 1 + Math.sin(now * 0.00045) * 0.045;
      sourceGlow.scale.set(42 * breath, 48 * breath, 1);
      confluenceGlow.scale.set(124 * breath, 21 * breath, 1);
      confluenceCore.scale.set(68 * breath, 8 * breath, 1);
      (sourceGlow.material as THREE.SpriteMaterial).opacity = 0.22 * visibility;
      (confluenceGlow.material as THREE.SpriteMaterial).opacity = 0.085 * visibility;
      (confluenceCore.material as THREE.SpriteMaterial).opacity = 0.09 * visibility;
      (horizonMist.material as THREE.SpriteMaterial).opacity = 0.08 * visibility;
      (seaMist.material as THREE.SpriteMaterial).opacity = 0.065 * visibility;

      for (const state of clouds.states) {
        const motion = lowMotion ? 0 : Math.sin(now * 0.000035 + state.phase);
        state.sprite.position.x = state.basePosition.x + motion * 1.8;
        state.sprite.position.y = state.basePosition.y + motion * 0.42;
        (state.sprite.material as THREE.SpriteMaterial).opacity =
          state.baseOpacity * (0.88 + motion * 0.12) * Math.max(0.28, visibility * 0.42);
      }
    },
    dispose() {
      cloudTexture.dispose();
      radialTexture.dispose();
    },
  };
}

export function createHistoryPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): HistoryPostProcessing {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.68,
      0.72,
      0.58,
    ),
  );
  composer.addPass(new OutputPass());

  return {
    render() {
      composer.render();
    },
    resize(width, height) {
      composer.setSize(width, height);
    },
    dispose() {
      composer.dispose();
    },
  };
}
