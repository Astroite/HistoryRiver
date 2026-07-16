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
const RIVER_BLUE = new THREE.Color(0x789cb9);
const IVORY = new THREE.Color(0xf3ebdd);
const MEMORY_GOLD = new THREE.Color(0xe7cca0);

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

function seaPoint(lane: number, t: number, phase: number): THREE.Vector3 {
  const spread = 3.5 + Math.pow(t, 1.42) * 92;
  const lateralFlow =
    Math.sin(t * (6.2 + phase * 4.2) + phase * 12) * (0.62 + t * 7.4);
  const channelMeander =
    Math.sin(t * Math.PI) * (phase - 0.5) * (7 + Math.abs(lane) * 19);
  return new THREE.Vector3(
    WATERFALL_CENTER_X + lane * spread + lateralFlow + channelMeander,
    -1.05 + Math.sin(t * 14 + phase * 9) * 0.075 + t * 0.42,
    -3 + Math.pow(t, 1.08) * 150,
  );
}

function createSeaFibers(
  random: () => number,
  quality: SceneQuality,
): { object: THREE.LineSegments; material: THREE.LineBasicMaterial } {
  const flowCount = quality === "default" ? 320 : 150;
  const segmentCount = quality === "default" ? 58 : 38;
  const positions: number[] = [];
  const colors: number[] = [];
  const channelCenters = [-0.94, -0.74, -0.53, -0.31, -0.08, 0.14, 0.38, 0.61, 0.82, 0.97];

  for (let flow = 0; flow < flowCount; flow += 1) {
    const channel = channelCenters[flow % channelCenters.length];
    const lane = THREE.MathUtils.clamp(
      channel + (random() - 0.5) * (0.08 + random() * 0.12),
      -1,
      1,
    );
    const phase = random();
    const brightness = 0.34 + random() * 0.72;
    const goldPersistence = random() < 0.34 ? 0.28 + random() * 0.38 : 0;
    const startT = random() * 0.08;
    const endT = 0.76 + random() * 0.24;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const t0 = THREE.MathUtils.lerp(startT, endT, segment / segmentCount);
      const t1 = THREE.MathUtils.lerp(startT, endT, (segment + 1) / segmentCount);
      const start = seaPoint(lane, t0, phase);
      const end = seaPoint(lane, t1, phase);
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
      const c0 = MEMORY_GOLD.clone().lerp(RIVER_BLUE, smoothstep(0.18, 0.92, t0));
      const c1 = MEMORY_GOLD.clone().lerp(RIVER_BLUE, smoothstep(0.18, 0.92, t1));
      c0.lerp(MEMORY_GOLD, goldPersistence * (0.45 + t0 * 0.55));
      c1.lerp(MEMORY_GOLD, goldPersistence * (0.45 + t1 * 0.55));
      c0.lerp(IVORY, (1 - Math.abs(lane)) * 0.15).multiplyScalar(brightness);
      c1.lerp(IVORY, (1 - Math.abs(lane)) * 0.15).multiplyScalar(brightness);
      colors.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = 2;
  object.frustumCulled = false;
  return { object, material };
}

function createSeaParticles(
  random: () => number,
  quality: SceneQuality,
): { object: THREE.Points; material: THREE.PointsMaterial } {
  const count = quality === "default" ? 22000 : 7000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const t = Math.sqrt(random());
    const lane = (random() + random() - 1) * 1.02;
    const point = seaPoint(lane, t, random());
    positions[index * 3] = point.x + (random() - 0.5) * (0.25 + t * 1.8);
    positions[index * 3 + 1] = point.y + random() * 0.18;
    positions[index * 3 + 2] = point.z + (random() - 0.5) * (0.4 + t * 1.4);
    const color = MEMORY_GOLD.clone().lerp(RIVER_BLUE, smoothstep(0.16, 0.92, t));
    if (random() < 0.28) color.lerp(MEMORY_GOLD, 0.34 + random() * 0.32);
    color.multiplyScalar(0.48 + random() * 0.88);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.18,
    transparent: true,
    opacity: 0.56,
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 320),
    new THREE.MeshBasicMaterial({
      color: 0x081722,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -1.55, 40);
  ground.renderOrder = -2;
  root.add(ground);

  const stars = createStars(random, topY, quality);
  stars.renderOrder = -1;
  root.add(stars);

  const clouds = createClouds(random, cloudTexture, topY, quality);
  root.add(clouds.group);

  const seaFibers = createSeaFibers(random, quality);
  const seaParticles = createSeaParticles(random, quality);
  root.add(seaFibers.object, seaParticles.object);

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
      seaParticles.material.opacity = 0.74 * visibility;
      seaFibers.material.opacity = 0.04 * visibility;

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
