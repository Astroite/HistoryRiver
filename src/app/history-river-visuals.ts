import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

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
const CELESTIAL = new THREE.Color(0xa9c5dc);
const IVORY = new THREE.Color(0xf3ebdd);
const MEMORY_GOLD = new THREE.Color(0xe7cca0);

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

// 海浪高度场：多组正弦叠加的 GLSL 函数，流线丝线与浪花点云共用，保证同一片海协同起伏。
// 振幅较大以形成参考图中滚动的金色波脊（丘状涌浪），而非细碎涟漪。
const OCEAN_HEIGHT_GLSL = `
  float oceanHeight(vec2 q) {
    float t = uTime * 0.00035 * uFlow;
    float h = 0.0;
    h += sin(q.x * 0.026 + q.y * 0.016 + t * 1.05) * 3.4;
    h += sin(q.y * 0.030 - t * 0.85) * 2.4;
    h += sin((q.x * 0.018 - q.y * 0.024) + t * 1.40) * 1.7;
    h += sin((q.x * 0.070 + q.y * 0.060) + t * 2.10) * 0.7;
    return h * uAmp;
  }
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
  const color = t < 0.58
    ? CELESTIAL.clone().lerp(IVORY, smoothstep(0.12, 0.58, t))
    : IVORY.clone().lerp(MEMORY_GOLD, smoothstep(0.58, 1, t));
  return color.multiplyScalar(brightness);
}

function waterfallPoint(
  lane: number,
  t: number,
  phase: number,
  topY: number,
): THREE.Vector3 {
  const centralBend = Math.sin(t * Math.PI * 1.55 + 0.32) * 2.25;
  const lowerFlare = smoothstep(0.76, 1, t);
  const width =
    6.2 +
    Math.pow(Math.sin(t * Math.PI), 1.12) * 18 +
    Math.pow(t, 4) * 15;
  const strandWander =
    Math.sin(t * (7.2 + phase * 3.4) + phase * 11) * (0.5 + t * 1.65);
  const bundleDrift =
    Math.sin(t * Math.PI * (1.1 + phase * 0.55) + phase * Math.PI * 2) *
    Math.sin(t * Math.PI) *
    (0.45 + Math.abs(lane) * 2.2);
  return new THREE.Vector3(
    WATERFALL_CENTER_X +
      centralBend +
      lane * width +
      lane * lowerFlare * 8 +
      strandWander +
      bundleDrift,
    topY * (1 - t) - Math.pow(t, 7) * 1.2,
    lane * (1.2 + t * 3.5) + Math.sin(t * 9 + phase * 7) * (0.18 + t * 0.46),
  );
}

function createWaterfallFibers(
  random: () => number,
  topY: number,
  quality: SceneQuality,
): { object: THREE.LineSegments; material: THREE.LineBasicMaterial } {
  const strandCount = quality === "default" ? 280 : 130;
  const segmentCount = quality === "default" ? 104 : 64;
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const bundleCenters = [-0.9, -0.68, -0.42, -0.16, 0.08, 0.34, 0.61, 0.86];

  for (let strand = 0; strand < strandCount; strand += 1) {
    const bundle = bundleCenters[strand % bundleCenters.length];
    const lane = THREE.MathUtils.clamp(
      bundle + (random() - 0.5) * (0.12 + random() * 0.15),
      -1,
      1,
    );
    const phase = random();
    const strandBrightness = random() < 0.14
      ? 0.72 + random() * 0.5
      : 0.2 + random() * 0.42;
    const startT = random() * 0.045;
    const endT = 0.965 + random() * 0.035;

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const t0 = THREE.MathUtils.lerp(startT, endT, segment / segmentCount);
      const t1 = THREE.MathUtils.lerp(startT, endT, (segment + 1) / segmentCount);
      const start = waterfallPoint(lane, t0, phase, topY);
      const end = waterfallPoint(lane, t1, phase, topY);
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
      color.copy(waterfallColor(t0, strandBrightness));
      colors.push(color.r, color.g, color.b);
      color.copy(waterfallColor(t1, strandBrightness));
      colors.push(color.r, color.g, color.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
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
  const count = quality === "default" ? 22000 : 8000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const t = Math.pow(random(), 0.92);
    const lane = (random() + random() + random() - 1.5) / 1.5;
    const phase = random();
    const point = waterfallPoint(lane, t, phase, topY);
    const radialJitter = 0.32 + Math.pow(t, 1.7) * 0.8;
    positions[index * 3] = point.x + (random() - 0.5) * radialJitter;
    positions[index * 3 + 1] = point.y + (random() - 0.5) * 0.42;
    positions[index * 3 + 2] = point.z + (random() - 0.5) * radialJitter;
    const color = waterfallColor(t, 0.48 + random() * 0.88);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    seeds[index] = phase;
    speeds[index] = 0.6 + random() * 1.2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: quality === "default" ? 1.35 : 1.55 },
      uOpacity: { value: 0.58 },
      uFlow: { value: 1 },
    },
    vertexShader: `
      attribute vec3 color;
      attribute float aSeed;
      attribute float aSpeed;

      varying vec3 vColor;
      uniform float uTime;
      uniform float uSize;
      uniform float uFlow;

      void main() {
        vec3 p = position;
        float drift = mod(uTime * 0.00007 * aSpeed + aSeed * 3.7, 3.7);
        p.y -= drift * uFlow;
        p.x += sin(p.y * 0.095 + aSeed * 12.0 + uTime * 0.00018) * 0.16 * uFlow;
        vColor = color;
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(uSize * (300.0 / max(1.0, -viewPosition.z)), 0.7, 4.5);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      uniform float uOpacity;

      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float core = 1.0 - smoothstep(0.04, 0.22, distanceToCenter);
        float halo = 1.0 - smoothstep(0.12, 0.5, distanceToCenter);
        float alpha = (core * 0.78 + halo * 0.22) * uOpacity;
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

function createFlowingOcean(
  random: () => number,
  quality: SceneQuality,
): { object: THREE.LineSegments; material: THREE.ShaderMaterial } {
  // 纯丝线三维光海：铺满无边海域，无任何水体面片。
  // - 每根丝线很短（SEA_THREAD_LEN_MIN..MAX 单位），象征一段人生片段。
  // - 一个家族 = 多段短丝线错落汇聚（首尾续接 + 横向错位）成的一条更长的粗线条，象征代际传承。
  // - 海面(y≈SEA_BASE_Y)代表 1949「当下」；丝线可沉入海面之下，越深越淡，表示不可知的未来。
  const lineageCount = quality === "default" ? 4200 : 1600;
  const xMin = WATERFALL_CENTER_X - SEA_X_HALF;
  const width = SEA_X_HALF * 2;
  const zMin = SEA_Z_MIN;
  const zRange = SEA_Z_MAX - SEA_Z_MIN;

  const positions: number[] = [];
  const brights: number[] = [];
  const depths: number[] = []; // 0 = 海面(当下) .. 1 = 最深(不可知的未来)

  for (let lineage = 0; lineage < lineageCount; lineage += 1) {
    // 家族起点铺满整片平面。丝线大致沿波脊横向流动（±x），带小幅摆动，贴合涌浪走向。
    let x = xMin + width * random();
    let z = zMin + zRange * random();
    let heading = (random() < 0.5 ? 0 : Math.PI) + (random() - 0.5) * 0.9;

    const lineageBright = 0.26 + random() * 0.5 + (random() < 0.12 ? 0.7 : 0);
    const generations = 3 + Math.floor(random() * 5); // 每个家族 3..7 段续接
    // 该家族并行子丝线数量：错落叠加使续接的长条看上去更粗。
    const strands = 2 + Math.floor(random() * 2);
    let depth = random() * 0.12;

    for (let generation = 0; generation < generations; generation += 1) {
      // 单段短丝线长度：10..30 单位。
      const threadLen =
        SEA_THREAD_LEN_MIN + random() * (SEA_THREAD_LEN_MAX - SEA_THREAD_LEN_MIN);
      const steps = 4 + Math.floor(random() * 2); // 4..5 段折线足够表现短丝线
      const along = threadLen / steps;
      const meanderAmp = 0.8 + random() * 2.2;
      const meanderFreq = 0.6 + random() * 1.7;
      const phase = random() * Math.PI * 2;
      // 这一代整体下沉量：多数近海面(已知)，少数沉向未来(变淡)。
      const depthGain = random() < 0.5 ? random() * 0.1 : 0;
      // 换代处横向错位（错落），使续接点重叠汇聚而非直线拼接。
      const handoffPerpX = Math.sin(heading);
      const handoffPerpZ = -Math.cos(heading);
      const handoff = (random() - 0.5) * 2.2;
      x += handoffPerpX * handoff;
      z += handoffPerpZ * handoff;
      const startX = x;
      const startZ = z;
      const startHeading = heading;
      const startDepth = depth;

      for (let strand = 0; strand < strands; strand += 1) {
        // 每根并行子丝线相对家族中心的小横向偏移与亮度扰动。
        const strandOffset = (strand - (strands - 1) / 2) * (0.4 + random() * 0.5);
        const strandBright = lineageBright * (0.8 + random() * 0.45);
        let sHeading = startHeading;
        let px = startX + handoffPerpX * strandOffset;
        let pz = startZ + handoffPerpZ * strandOffset;
        let pDepth = startDepth;
        let py = SEA_BASE_Y - pDepth * SEA_DEPTH_BELOW;
        for (let step = 1; step <= steps; step += 1) {
          const s = step / steps;
          sHeading += (random() - 0.5) * 0.12; // 缓慢弯曲
          const dirX = Math.cos(sHeading);
          const dirZ = Math.sin(sHeading);
          const perpX = Math.sin(sHeading);
          const perpZ = -Math.cos(sHeading);
          const wob = Math.sin(s * Math.PI * meanderFreq * 2 + phase) * meanderAmp;
          const nx = px + dirX * along + perpX * wob * 0.12;
          const nz = pz + dirZ * along + perpZ * wob * 0.12;
          const nDepth = Math.min(0.98, startDepth + depthGain * s);
          const ny = SEA_BASE_Y - nDepth * SEA_DEPTH_BELOW;
          positions.push(px, py, pz, nx, ny, nz);
          brights.push(strandBright, strandBright);
          depths.push(pDepth, nDepth);
          px = nx;
          pz = nz;
          py = ny;
          pDepth = nDepth;
        }
      }

      // 家族中心推进到本段短丝线终点，供下一段续接（沿平均朝向前进一整段长度）。
      x += Math.cos(startHeading) * threadLen;
      z += Math.sin(startHeading) * threadLen;
      heading = startHeading;
      depth = Math.min(0.96, depth + depthGain);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aBright", new THREE.Float32BufferAttribute(brights, 1));
  geometry.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uAmp: { value: 1 },
      uOpacity: { value: 0.22 },
      // 金色光海：谷底深金、脊面亮金、波峰近乎白金；沉入未来时转为冷暗。
      uNear: { value: new THREE.Color(0xffcf6a) },
      uFar: { value: new THREE.Color(0x9a6a24) },
      uCrest: { value: new THREE.Color(0xfff2c8) },
      uDeep: { value: new THREE.Color(0x140d05) },
      uZRange: { value: new THREE.Vector2(SEA_Z_MIN, SEA_Z_MAX) },
      // 视距淡出：超出 uFade.x 起渐隐，至 uFade.y 归零，使海域没入黑暗形成无际地平。
      uFade: { value: new THREE.Vector2(SEA_FADE_NEAR, SEA_FADE_FAR) },
    },
    vertexShader: `
      attribute float aBright;
      attribute float aDepth;

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

      ${OCEAN_HEIGHT_GLSL}

      void main() {
        vec3 p = position;
        // 波浪只作用于接近海面的丝线；越深越平静(未来不可知、无涌动)。
        float surfaceness = 1.0 - clamp(aDepth, 0.0, 1.0);
        float h = oceanHeight(p.xz) * surfaceness;
        p.y += h;
        float t = uTime * 0.00035 * uFlow;
        p.x += sin(p.x * 0.03 + t * 1.05) * 0.6 * surfaceness;
        p.z += sin(p.z * 0.034 - t * 0.85) * 0.5 * surfaceness;

        float d = clamp((p.z - uZRange.x) / (uZRange.y - uZRange.x), 0.0, 1.0);
        // 沿深度做冷暖：远处略沉，近处更亮金。
        vec3 base = mix(uNear, uFar, smoothstep(0.1, 0.95, d));
        // 波峰高度归一（振幅约 ±8）：脊顶提亮为白金。
        float crest = smoothstep(1.5, 6.5, h);
        vec3 col = mix(base, uCrest, crest * 0.8) * aBright;
        // 沉入未来：变冷变暗。
        col = mix(col, uDeep, aDepth * 0.8);
        vColor = col;

        float depthFade = mix(1.0, 0.04, aDepth); // 越深越淡

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // 视距淡出：远处渐隐至零，海域没入黑暗，形成无边地平线（取代有限平面的硬边）。
        float viewDist = -mv.z;
        float horizonFade = 1.0 - smoothstep(uFade.x, uFade.y, viewDist);
        // 波脊更亮、波谷偏暗，强化滚动涌浪的体积感。
        vAlpha = uOpacity * horizonFade * depthFade * (0.35 + crest * 1.1);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.003) discard;
        gl_FragColor = vec4(vColor, vAlpha);
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
): { object: THREE.Points; material: THREE.ShaderMaterial } {
  const count = quality === "default" ? 78000 : 26000;
  const xMin = WATERFALL_CENTER_X - SEA_X_HALF;
  const width = SEA_X_HALF * 2;
  const zRange = SEA_Z_MAX - SEA_Z_MIN;
  const positions = new Float32Array(count * 3);
  const brights = new Float32Array(count);
  const drips = new Float32Array(count); // 0 = 贴海面的金沙；>0 = 从波下垂落的光丝(下坠深度)
  for (let index = 0; index < count; index += 1) {
    // 浪花铺满整片海面（表征当下的海面辉光），均匀散布并带轻微抖动。
    positions[index * 3] = xMin + width * random();
    positions[index * 3 + 1] = SEA_BASE_Y;
    positions[index * 3 + 2] = SEA_Z_MIN + zRange * random();
    brights[index] = 0.5 + random() * 1.15;
    // 约 18% 的颗粒作为"垂落光丝"，从海面向下悬垂不同长度。
    drips[index] = random() < 0.18 ? Math.pow(random(), 1.6) * 34 : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aBright", new THREE.BufferAttribute(brights, 1));
  geometry.setAttribute("aDrip", new THREE.BufferAttribute(drips, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uAmp: { value: 1 },
      uOpacity: { value: 0.7 },
      uSize: { value: quality === "default" ? 1.7 : 1.9 },
      // 金色浪花：海面亮金，远处深金，波峰白金。
      uNear: { value: new THREE.Color(0xffd77a) },
      uFar: { value: new THREE.Color(0xb07d2e) },
      uCrest: { value: new THREE.Color(0xfff4d2) },
      uZRange: { value: new THREE.Vector2(SEA_Z_MIN, SEA_Z_MAX) },
      uFade: { value: new THREE.Vector2(SEA_FADE_NEAR, SEA_FADE_FAR) },
    },
    vertexShader: `
      attribute float aBright;
      attribute float aDrip;

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
        float h = oceanHeight(p.xz);
        p.y += h;
        // 垂落光丝：从海面向下悬垂，并随时间缓慢滴落循环。
        float t = uTime * 0.00035 * uFlow;
        float sag = aDrip * (0.6 + 0.4 * sin(t * 1.7 + p.x * 0.05));
        p.y -= sag;
        float d = clamp((p.z - uZRange.x) / (uZRange.y - uZRange.x), 0.0, 1.0);
        vec3 base = mix(uNear, uFar, smoothstep(0.1, 0.95, d));
        float crest = smoothstep(1.5, 6.5, h);
        vColor = mix(base, uCrest, crest * 0.75) * aBright;
        // 垂落段随下坠变暗，融入下方黑暗。
        float dripFade = 1.0 - smoothstep(0.0, 34.0, sag) * 0.85;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // 视距淡出：远处渐隐至零，浪花没入黑暗，与丝线海协同形成无际地平。
        float horizonFade = 1.0 - smoothstep(uFade.x, uFade.y, -mv.z);
        vAlpha = uOpacity * horizonFade * dripFade * (0.4 + crest * 1.0);
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

  const flowingOcean = createFlowingOcean(random, quality);
  const seaFoam = createSeaFoam(random, quality);
  root.add(flowingOcean.object, seaFoam.object);

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
    0xf3e4c9,
    0.38,
    new THREE.Vector3(WATERFALL_CENTER_X + 1, 0.8, 1),
    new THREE.Vector2(84, 24),
  );
  const confluenceCore = createGlowSprite(
    radialTexture,
    0xfff4df,
    0.34,
    new THREE.Vector3(WATERFALL_CENTER_X + 1, 1.2, 4),
    new THREE.Vector2(30, 11),
  );
  const horizonMist = createGlowSprite(
    cloudTexture,
    0x7794aa,
    0.085,
    new THREE.Vector3(WATERFALL_CENTER_X - 4, 6, 12),
    new THREE.Vector2(178, 42),
  );
  const seaMist = createGlowSprite(
    cloudTexture,
    0xb9ad96,
    0.06,
    new THREE.Vector3(WATERFALL_CENTER_X + 6, 3, 58),
    new THREE.Vector2(218, 34),
  );
  const upperVeil = createGlowSprite(
    cloudTexture,
    0x90aec5,
    0.16,
    new THREE.Vector3(WATERFALL_CENTER_X + 1, topY * 0.7, -4),
    new THREE.Vector2(54, 78),
  );
  const lowerVeil = createGlowSprite(
    cloudTexture,
    0xd9d7cf,
    0.12,
    new THREE.Vector3(WATERFALL_CENTER_X + 2, topY * 0.34, -2),
    new THREE.Vector2(68, 72),
  );
  root.add(
    sourceGlow,
    confluenceGlow,
    confluenceCore,
    horizonMist,
    seaMist,
    upperVeil,
    lowerVeil,
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
      waterfallParticles.material.uniforms.uOpacity.value = 0.68 * visibility;
      waterfallFibers.material.opacity = 0.085 * visibility;

      // 编织海面与浪花：uTime 驱动波浪仿真，低动态偏好时冻结起伏但保留静态海面。
      const oceanFlow = lowMotion ? 0 : 1;
      const oceanAmp = lowMotion ? 0.35 : 1;
      flowingOcean.material.uniforms.uTime.value = now;
      flowingOcean.material.uniforms.uFlow.value = oceanFlow;
      flowingOcean.material.uniforms.uAmp.value = oceanAmp;
      flowingOcean.material.uniforms.uOpacity.value = 0.28 * visibility;
      seaFoam.material.uniforms.uTime.value = now;
      seaFoam.material.uniforms.uFlow.value = oceanFlow;
      seaFoam.material.uniforms.uAmp.value = oceanAmp;
      seaFoam.material.uniforms.uOpacity.value = 0.8 * visibility;

      const breath = lowMotion ? 1 : 1 + Math.sin(now * 0.00045) * 0.045;
      sourceGlow.scale.set(42 * breath, 48 * breath, 1);
      confluenceGlow.scale.set(84 * breath, 24 * breath, 1);
      confluenceCore.scale.set(30 * breath, 11 * breath, 1);
      (sourceGlow.material as THREE.SpriteMaterial).opacity = 0.28 * visibility;
      (confluenceGlow.material as THREE.SpriteMaterial).opacity = 0.38 * visibility;
      (confluenceCore.material as THREE.SpriteMaterial).opacity = 0.34 * visibility;
      (horizonMist.material as THREE.SpriteMaterial).opacity = 0.12 * visibility;
      (seaMist.material as THREE.SpriteMaterial).opacity = 0.1 * visibility;
      (upperVeil.material as THREE.SpriteMaterial).opacity = 0.16 * visibility;
      (lowerVeil.material as THREE.SpriteMaterial).opacity = 0.12 * visibility;

      for (const state of clouds.states) {
        const motion = lowMotion ? 0 : Math.sin(now * 0.000035 + state.phase);
        state.sprite.position.x = state.basePosition.x + motion * 1.8;
        state.sprite.position.y = state.basePosition.y + motion * 0.42;
        (state.sprite.material as THREE.SpriteMaterial).opacity =
          state.baseOpacity * (0.88 + motion * 0.12) * Math.max(0.52, visibility);
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
