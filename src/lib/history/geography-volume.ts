import {
  CONTENT_END_YEAR,
  RIVER_START_YEAR,
  abstractChina,
  historicalYearToY,
} from "./model.ts";

export type GeographyAnchorKey =
  | "core"
  | "east"
  | "south"
  | "west"
  | "southwest"
  | "north"
  | "northeast"
  | "northwest"
  | "plateau"
  | "southeast";

export interface GeographyAnchor {
  center: readonly [number, number];
  spread: readonly [number, number];
}

export type GeographyWeights = Record<GeographyAnchorKey, number>;

export interface GeographyKeyframe {
  year: number;
  label: string;
  uncertainty: number;
  weights: GeographyWeights;
  prototypeOnly: true;
}

export interface GeographyProfile {
  year: number;
  uncertainty: number;
  weights: GeographyWeights;
  sourceKeyframes: readonly [number, number];
}

export interface GeographyVolumeGeometry {
  annualSliceCount: number;
  contourSamples: number;
  sliceSegmentCount: number;
  longitudinalSegmentCount: number;
  slicePositions: Float32Array;
  sliceYears: Float32Array;
  /** 逐顶点资料不确定度 0..1，供着色器调制亮度与色温。 */
  sliceUncertainty: Float32Array;
  longitudinalPositions: Float32Array;
  longitudinalYears: Float32Array;
  longitudinalUncertainty: Float32Array;
}

export const geographyAnchors: Record<GeographyAnchorKey, GeographyAnchor> = {
  core: { center: [0, 0], spread: [6.4, 5.4] },
  east: { center: [7.2, -0.8], spread: [4.8, 5.2] },
  south: { center: [2.4, 7.4], spread: [6.2, 5.5] },
  west: { center: [-8.2, 0.5], spread: [5.7, 5.1] },
  southwest: { center: [-7.4, 8.8], spread: [5.2, 5.4] },
  north: { center: [-0.8, -7.4], spread: [6.4, 4.7] },
  northeast: { center: [9.6, -8.8], spread: [5.0, 4.8] },
  northwest: { center: [-12.2, -6.4], spread: [6.6, 5.1] },
  plateau: { center: [-15.4, 5.6], spread: [6.2, 5.4] },
  southeast: { center: [8.6, 7.1], spread: [4.6, 5.0] },
};

const anchorKeys = Object.keys(geographyAnchors) as GeographyAnchorKey[];

function weights(partial: Partial<GeographyWeights>): GeographyWeights {
  return Object.fromEntries(
    anchorKeys.map((key) => [key, partial[key] ?? 0]),
  ) as unknown as GeographyWeights;
}

/**
 * P0 历史空间关键帧。它们是“历史活动与行政覆盖的抽象空间场”，不是疆域图，
 * 也不能用于表达主权结论。CHGIS/OHM 等资料只用于确定变化节点与相对扩缩；
 * 具体几何在本地被压缩为无地名、无国界、带不确定度的区域权重。
 */
export const geographyKeyframes: readonly GeographyKeyframe[] = [
  {
    year: RIVER_START_YEAR,
    label: "早期文明空间场",
    uncertainty: 0.96,
    weights: weights({ core: 0.52, east: 0.18, west: 0.16, north: 0.12 }),
    prototypeOnly: true,
  },
  {
    year: -1600,
    label: "早期王朝核心区",
    uncertainty: 0.82,
    weights: weights({ core: 0.88, east: 0.42, west: 0.3, north: 0.34, south: 0.2 }),
    prototypeOnly: true,
  },
  {
    year: -1046,
    label: "封国网络扩展",
    uncertainty: 0.72,
    weights: weights({ core: 1, east: 0.72, west: 0.58, north: 0.54, south: 0.46, southeast: 0.22 }),
    prototypeOnly: true,
  },
  {
    year: -770,
    label: "多中心历史空间",
    uncertainty: 0.62,
    weights: weights({ core: 0.96, east: 0.86, west: 0.7, north: 0.62, south: 0.78, southeast: 0.52, southwest: 0.3 }),
    prototypeOnly: true,
  },
  {
    year: -221,
    label: "统一行政空间",
    uncertainty: 0.42,
    weights: weights({ core: 1, east: 0.94, west: 0.84, north: 0.74, south: 0.9, southeast: 0.8, southwest: 0.6, northwest: 0.28, northeast: 0.32 }),
    prototypeOnly: true,
  },
  {
    year: 220,
    label: "帝国空间延展",
    uncertainty: 0.38,
    weights: weights({ core: 1, east: 0.96, west: 0.88, north: 0.82, south: 0.94, southeast: 0.86, southwest: 0.72, northwest: 0.56, northeast: 0.58, plateau: 0.18 }),
    prototypeOnly: true,
  },
  {
    year: 420,
    label: "南北空间分化",
    uncertainty: 0.52,
    weights: weights({ core: 0.82, east: 0.86, west: 0.58, north: 0.68, south: 0.92, southeast: 0.88, southwest: 0.7, northwest: 0.34, northeast: 0.52, plateau: 0.14 }),
    prototypeOnly: true,
  },
  {
    year: 618,
    label: "再统一与交通扩展",
    uncertainty: 0.34,
    weights: weights({ core: 1, east: 0.98, west: 0.9, north: 0.9, south: 0.96, southeast: 0.88, southwest: 0.74, northwest: 0.76, northeast: 0.68, plateau: 0.34 }),
    prototypeOnly: true,
  },
  {
    year: 960,
    label: "东南重心增强",
    uncertainty: 0.38,
    weights: weights({ core: 0.94, east: 1, west: 0.62, north: 0.54, south: 1, southeast: 1, southwest: 0.72, northwest: 0.28, northeast: 0.38, plateau: 0.12 }),
    prototypeOnly: true,
  },
  {
    year: 1271,
    label: "大陆空间广域连接",
    uncertainty: 0.36,
    weights: weights({ core: 1, east: 1, west: 0.96, north: 1, south: 0.98, southeast: 0.94, southwest: 0.84, northwest: 0.9, northeast: 0.9, plateau: 0.78 }),
    prototypeOnly: true,
  },
  {
    year: 1368,
    label: "山河核心重新收束",
    uncertainty: 0.3,
    weights: weights({ core: 1, east: 1, west: 0.86, north: 0.9, south: 1, southeast: 0.96, southwest: 0.78, northwest: 0.58, northeast: 0.68, plateau: 0.38 }),
    prototypeOnly: true,
  },
  {
    year: 1644,
    label: "多区域重新连接",
    uncertainty: 0.28,
    weights: weights({ core: 1, east: 1, west: 0.9, north: 0.96, south: 1, southeast: 0.98, southwest: 0.86, northwest: 0.78, northeast: 0.9, plateau: 0.68 }),
    prototypeOnly: true,
  },
  {
    year: 1820,
    label: "历史空间高覆盖切片",
    uncertainty: 0.2,
    weights: weights({ core: 1, east: 1, west: 0.96, north: 1, south: 1, southeast: 1, southwest: 0.92, northwest: 0.9, northeast: 0.96, plateau: 0.88 }),
    prototypeOnly: true,
  },
  {
    year: 1911,
    label: "王朝末期切片",
    uncertainty: 0.2,
    weights: weights({ core: 1, east: 1, west: 0.94, north: 0.98, south: 1, southeast: 1, southwest: 0.9, northwest: 0.86, northeast: 0.94, plateau: 0.84 }),
    prototypeOnly: true,
  },
  {
    year: CONTENT_END_YEAR,
    label: "作品内容边界",
    uncertainty: 0.32,
    weights: weights({ core: 1, east: 1, west: 0.9, north: 0.96, south: 1, southeast: 1, southwest: 0.9, northwest: 0.8, northeast: 0.92, plateau: 0.78 }),
    prototypeOnly: true,
  },
] as const;

export const abstractMountainRidges = [
  [[-16, 7], [-12, 8], [-8, 8.4], [-4, 7.8], [0, 7.2]],
  [[-14, 1.4], [-10, 1.2], [-6, 1.8], [-2, 2.2], [2, 1.8]],
  [[-5, -8.5], [-5.2, -5], [-4.4, -1.5], [-3.4, 2.5], [-2.2, 5.8]],
] as const satisfies ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function keyframeSpan(year: number): readonly [GeographyKeyframe, GeographyKeyframe, number] {
  const clampedYear = Math.max(RIVER_START_YEAR, Math.min(CONTENT_END_YEAR, year));
  for (let index = 1; index < geographyKeyframes.length; index += 1) {
    const upper = geographyKeyframes[index];
    if (clampedYear <= upper.year) {
      const lower = geographyKeyframes[index - 1];
      const progress = (clampedYear - lower.year) / (upper.year - lower.year);
      return [lower, upper, smoothstep(progress)];
    }
  }
  const last = geographyKeyframes[geographyKeyframes.length - 1];
  return [last, last, 0];
}

export function geographyProfileAt(year: number): GeographyProfile {
  const [lower, upper, progress] = keyframeSpan(year);
  return {
    year: Math.max(RIVER_START_YEAR, Math.min(CONTENT_END_YEAR, year)),
    uncertainty: lower.uncertainty + (upper.uncertainty - lower.uncertainty) * progress,
    weights: Object.fromEntries(
      anchorKeys.map((key) => [
        key,
        lower.weights[key] + (upper.weights[key] - lower.weights[key]) * progress,
      ]),
    ) as unknown as GeographyWeights,
    sourceKeyframes: [lower.year, upper.year],
  };
}

function distanceToSegment(
  x: number,
  z: number,
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz || 1;
  const t = clamp01(((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared);
  return Math.hypot(x - (start[0] + dx * t), z - (start[1] + dz * t));
}

function distanceToPath(
  x: number,
  z: number,
  path: ReadonlyArray<readonly [number, number]>,
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(x, z, path[index - 1], path[index]));
  }
  return distance;
}

function spatialField(profile: GeographyProfile, x: number, z: number): number {
  let field = 0;
  for (const key of anchorKeys) {
    const anchor = geographyAnchors[key];
    const dx = (x - anchor.center[0]) / anchor.spread[0];
    const dz = (z - anchor.center[1]) / anchor.spread[1];
    field += profile.weights[key] * Math.exp(-0.5 * (dx * dx + dz * dz));
  }

  const yellowDistance = distanceToPath(x, z, abstractChina.rivers.yellow);
  const yangtzeDistance = distanceToPath(x, z, abstractChina.rivers.yangtze);
  field += 0.065 * Math.exp(-(yellowDistance * yellowDistance) / 3.2);
  field += 0.075 * Math.exp(-(yangtzeDistance * yangtzeDistance) / 3.8);

  for (const ridge of abstractMountainRidges) {
    const ridgeDistance = distanceToPath(x, z, ridge);
    field -= 0.028 * Math.exp(-(ridgeDistance * ridgeDistance) / 1.1);
  }

  const coastLimit = 11.4 - Math.max(0, z - 1) * 0.16 - Math.max(0, -z - 7) * 0.1;
  if (x > coastLimit) field -= (x - coastLimit) * 0.16;
  return field;
}

const contourCache = new Map<number, Map<number, ReadonlyArray<readonly [number, number]>>>();

function keyframeContour(
  keyframe: GeographyKeyframe,
  samples: number,
): ReadonlyArray<readonly [number, number]> {
  let sampleCache = contourCache.get(samples);
  if (!sampleCache) {
    sampleCache = new Map();
    contourCache.set(samples, sampleCache);
  }
  const cached = sampleCache.get(keyframe.year);
  if (cached) return cached;

  const profile: GeographyProfile = {
    year: keyframe.year,
    uncertainty: keyframe.uncertainty,
    weights: keyframe.weights,
    sourceKeyframes: [keyframe.year, keyframe.year],
  };
  const points: Array<readonly [number, number]> = [];
  const threshold = 0.44;
  for (let sample = 0; sample < samples; sample += 1) {
    const angle = sample / samples * Math.PI * 2;
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    let radius = 3.4;
    for (let testRadius = 0; testRadius <= 26; testRadius += 0.35) {
      if (spatialField(profile, directionX * testRadius, directionZ * testRadius) >= threshold) {
        radius = testRadius;
      }
    }
    const uncertaintyWarp =
      Math.sin(angle * 3 + keyframe.year * 0.0017) * keyframe.uncertainty * 0.22 +
      Math.sin(angle * 7 - keyframe.year * 0.0009) * keyframe.uncertainty * 0.1;
    const finalRadius = Math.max(3.2, radius + uncertaintyWarp);
    points.push([directionX * finalRadius, directionZ * finalRadius]);
  }
  sampleCache.set(keyframe.year, points);
  return points;
}

export function geographyContourAt(
  year: number,
  samples = 48,
): ReadonlyArray<readonly [number, number]> {
  const [lower, upper, progress] = keyframeSpan(year);
  const lowerContour = keyframeContour(lower, samples);
  if (lower.year === upper.year) return lowerContour;
  const upperContour = keyframeContour(upper, samples);
  return lowerContour.map((point, index) => [
    point[0] + (upperContour[index][0] - point[0]) * progress,
    point[1] + (upperContour[index][1] - point[1]) * progress,
  ] as const);
}

export function buildGeographyVolume(options: {
  startYear?: number;
  endYear?: number;
  contourSamples?: number;
  longitudinalStride?: number;
} = {}): GeographyVolumeGeometry {
  const startYear = Math.max(RIVER_START_YEAR, Math.round(options.startYear ?? RIVER_START_YEAR));
  const endYear = Math.min(CONTENT_END_YEAR, Math.round(options.endYear ?? CONTENT_END_YEAR));
  const contourSamples = Math.max(12, Math.round(options.contourSamples ?? 48));
  const longitudinalStride = Math.max(1, Math.round(options.longitudinalStride ?? 4));
  if (endYear < startYear) throw new Error("endYear must not precede startYear");

  const annualSliceCount = endYear - startYear + 1;
  const sliceSegmentCount = annualSliceCount * contourSamples;
  const longitudinalSamples = Math.ceil(contourSamples / longitudinalStride);
  const longitudinalSegmentCount = Math.max(0, annualSliceCount - 1) * longitudinalSamples;
  const slicePositions = new Float32Array(sliceSegmentCount * 2 * 3);
  const sliceYears = new Float32Array(sliceSegmentCount * 2);
  const sliceUncertainty = new Float32Array(sliceSegmentCount * 2);
  const longitudinalPositions = new Float32Array(longitudinalSegmentCount * 2 * 3);
  const longitudinalYears = new Float32Array(longitudinalSegmentCount * 2);
  const longitudinalUncertainty = new Float32Array(longitudinalSegmentCount * 2);

  let sliceVertex = 0;
  let longitudinalVertex = 0;
  let previousContour: ReadonlyArray<readonly [number, number]> | null = null;
  let previousYear = startYear;
  let previousUncertainty = geographyProfileAt(startYear).uncertainty;

  for (let year = startYear; year <= endYear; year += 1) {
    const contour = geographyContourAt(year, contourSamples);
    const uncertainty = geographyProfileAt(year).uncertainty;
    const y = historicalYearToY(year);
    for (let sample = 0; sample < contourSamples; sample += 1) {
      const nextSample = (sample + 1) % contourSamples;
      const start = contour[sample];
      const end = contour[nextSample];
      slicePositions.set([start[0], y, start[1], end[0], y, end[1]], sliceVertex * 3);
      sliceYears[sliceVertex] = year;
      sliceYears[sliceVertex + 1] = year;
      sliceUncertainty[sliceVertex] = uncertainty;
      sliceUncertainty[sliceVertex + 1] = uncertainty;
      sliceVertex += 2;

      if (previousContour && sample % longitudinalStride === 0) {
        const previous = previousContour[sample];
        longitudinalPositions.set(
          [previous[0], historicalYearToY(previousYear), previous[1], start[0], y, start[1]],
          longitudinalVertex * 3,
        );
        longitudinalYears[longitudinalVertex] = previousYear;
        longitudinalYears[longitudinalVertex + 1] = year;
        longitudinalUncertainty[longitudinalVertex] = previousUncertainty;
        longitudinalUncertainty[longitudinalVertex + 1] = uncertainty;
        longitudinalVertex += 2;
      }
    }
    previousContour = contour;
    previousYear = year;
    previousUncertainty = uncertainty;
  }

  return {
    annualSliceCount,
    contourSamples,
    sliceSegmentCount,
    longitudinalSegmentCount,
    slicePositions,
    sliceYears,
    sliceUncertainty,
    longitudinalPositions,
    longitudinalYears,
    longitudinalUncertainty,
  };
}
