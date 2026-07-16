export type EntityId = string;

export type InfluenceDimension =
  | "overall"
  | "political"
  | "military"
  | "thought"
  | "culture";

export type ExperienceState =
  | "river-overview"
  | "entering-window"
  | "slice"
  | "person-focus"
  | "relation-focus";

/**
 * 领域/学派色系。人物主题色按领域分色系：同领域共享色相，个体以明度/饱和度区分，
 * 既有识别度又保持"同一条河"的整体感。
 */
export type Domain =
  | "thought" // 思想（含名辩）
  | "statecraft" // 制度·政治·外交
  | "military" // 军事
  | "culture" // 文化·礼乐·文史
  | "craft"; // 技艺·民生·医农

/** 春秋战国邦国方位键（抽象、模拟，仅表达大致方位，不是精确坐标）。 */
export type RegionKey =
  | "zhou"
  | "lu"
  | "qi"
  | "jin"
  | "qin"
  | "chu"
  | "song"
  | "zheng"
  | "wei"
  | "wuyue";

export interface Person {
  id: EntityId;
  label: string;
  role: string;
  domain: Domain;
  birthYear: number;
  deathYear: number;
  /** 主要活动邦国（生命早期）。 */
  homeRegion: RegionKey;
  /** 生命晚期活动邦国；与 homeRegion 不同表示一生的横向漂移。 */
  endRegion: RegionKey;
  influence: Record<InfluenceDimension, number>;
  prototypeOnly: true;
}

export interface CuratedEvent {
  id: EntityId;
  label: string;
  year: number;
  center: readonly [number, number];
  participantIds: EntityId[];
  prototypeOnly: true;
}

export type RelationKind =
  | "direct"
  | "documented-indirect"
  | "scholarly-inference";

export interface ThoughtRelation {
  id: EntityId;
  label: string;
  sourcePersonId: EntityId;
  targetPersonId: EntityId;
  year: number;
  kind: RelationKind;
  prototypeOnly: true;
}

export interface PrototypeFixture {
  seed: number;
  persons: Person[];
  events: CuratedEvent[];
  relations: ThoughtRelation[];
}

export interface ObservationWindow {
  startYear: number;
  endYear: number;
  focusYear: number;
}

export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

export const CONTENT_END_YEAR = 1949;
export const RIVER_START_YEAR = -2700;
export const UNITS_PER_YEAR = 0.025;
export const OBSERVATION_SPAN = 20;
export const DEFAULT_FOCUS_YEAR = -515;

// ---------------------------------------------------------------------------
// 抽象中国地理方位图（归一化 X/Z 平面，模拟数据）
// X: 西(-) → 东(+)；Z: 北(-) → 南(+)。范围约 [-13, 13]。
// 只表达"山河方位关系"，不是写实行政地图：无现代省界、无精确坐标。
// ---------------------------------------------------------------------------

export interface GeoRegion {
  key: RegionKey;
  label: string;
  /** 邦国大致方位质心 [x(东+), z(南+)]。 */
  center: readonly [number, number];
  /** 软半径：人物在邦国内的抖动范围与不确定性光晕。 */
  radius: number;
  /** 地理不确定度 0..1，越高抖动/光晕越大。 */
  geoUncertainty: number;
}

export const geoRegions: Record<RegionKey, GeoRegion> = {
  zhou: { key: "zhou", label: "周", center: [0, 0], radius: 1.6, geoUncertainty: 0.2 },
  lu: { key: "lu", label: "鲁", center: [7, 1], radius: 1.5, geoUncertainty: 0.18 },
  qi: { key: "qi", label: "齐", center: [8, -2], radius: 1.8, geoUncertainty: 0.22 },
  jin: { key: "jin", label: "晋", center: [-2, -4], radius: 2.0, geoUncertainty: 0.3 },
  qin: { key: "qin", label: "秦", center: [-9, -1], radius: 2.0, geoUncertainty: 0.34 },
  chu: { key: "chu", label: "楚", center: [1, 6], radius: 2.4, geoUncertainty: 0.4 },
  song: { key: "song", label: "宋", center: [4, 1], radius: 1.4, geoUncertainty: 0.24 },
  zheng: { key: "zheng", label: "郑", center: [2, 1], radius: 1.2, geoUncertainty: 0.24 },
  wei: { key: "wei", label: "卫", center: [3, -2], radius: 1.3, geoUncertainty: 0.26 },
  wuyue: { key: "wuyue", label: "吴越", center: [10, 4], radius: 2.0, geoUncertainty: 0.44 },
};

export const abstractChina = {
  regions: geoRegions,
  /** 东/东南海岸线（自东北向东南）。 */
  coastline: [
    [9, -6],
    [10, -3],
    [10, 0],
    [9, 3],
    [7, 6],
    [4, 8],
  ] as ReadonlyArray<readonly [number, number]>,
  rivers: {
    /** 黄河：自西向东，"几"字弯简化。 */
    yellow: [
      [-11, -2],
      [-8, -3],
      [-6, -4],
      [-3, -3],
      [0, -2],
      [3, -1],
      [6, -1],
      [9, -2],
    ] as ReadonlyArray<readonly [number, number]>,
    /** 长江：自西向东偏南。 */
    yangtze: [
      [-9, 4],
      [-5, 5],
      [-1, 5],
      [3, 6],
      [6, 5],
      [9, 4],
    ] as ReadonlyArray<readonly [number, number]>,
  },
} as const;

// ---------------------------------------------------------------------------
// 领域色系与主题色
// ---------------------------------------------------------------------------

/** 领域基色（HSL：色相 0..360、饱和度/明度 0..1）。 */
const domainHsl: Record<Domain, readonly [number, number, number]> = {
  thought: [174, 0.42, 0.56], // 青绿
  statecraft: [38, 0.55, 0.55], // 赭金
  military: [6, 0.58, 0.55], // 朱赤
  culture: [44, 0.62, 0.63], // 暖金
  craft: [136, 0.34, 0.55], // 石绿
};

const influence = (
  overall: number,
  political: number,
  military: number,
  thought: number,
  culture: number,
): Record<InfluenceDimension, number> => ({
  overall,
  political,
  military,
  thought,
  culture,
});

export const prototypeFixture: PrototypeFixture = {
  seed: 240716,
  persons: [
    { id: "p01", label: "行者·松", role: "游学者", domain: "thought", birthYear: -566, deathYear: -480, homeRegion: "lu", endRegion: "qin", influence: influence(0.72, 0.18, 0.08, 0.92, 0.64), prototypeOnly: true },
    { id: "p02", label: "辩者·羽", role: "论辩者", domain: "thought", birthYear: -558, deathYear: -486, homeRegion: "song", endRegion: "qi", influence: influence(0.62, 0.26, 0.05, 0.84, 0.58), prototypeOnly: true },
    { id: "p03", label: "史官·砚", role: "记述者", domain: "culture", birthYear: -552, deathYear: -472, homeRegion: "zhou", endRegion: "zhou", influence: influence(0.55, 0.34, 0.04, 0.62, 0.83), prototypeOnly: true },
    { id: "p04", label: "学者·兰", role: "授业者", domain: "thought", birthYear: -548, deathYear: -468, homeRegion: "lu", endRegion: "lu", influence: influence(0.78, 0.22, 0.03, 0.96, 0.81), prototypeOnly: true },
    { id: "p05", label: "策士·衡", role: "策议者", domain: "statecraft", birthYear: -546, deathYear: -478, homeRegion: "qin", endRegion: "jin", influence: influence(0.74, 0.88, 0.22, 0.54, 0.36), prototypeOnly: true },
    { id: "p06", label: "将者·岳", role: "军政人物", domain: "military", birthYear: -544, deathYear: -488, homeRegion: "jin", endRegion: "qin", influence: influence(0.69, 0.66, 0.95, 0.18, 0.16), prototypeOnly: true },
    { id: "p07", label: "工者·璧", role: "技艺者", domain: "craft", birthYear: -541, deathYear: -470, homeRegion: "song", endRegion: "chu", influence: influence(0.48, 0.13, 0.07, 0.45, 0.91), prototypeOnly: true },
    { id: "p08", label: "隐者·泉", role: "思想者", domain: "thought", birthYear: -539, deathYear: -462, homeRegion: "chu", endRegion: "chu", influence: influence(0.64, 0.08, 0.02, 0.89, 0.67), prototypeOnly: true },
    { id: "p09", label: "使者·舟", role: "行旅者", domain: "statecraft", birthYear: -538, deathYear: -475, homeRegion: "zheng", endRegion: "wuyue", influence: influence(0.51, 0.58, 0.12, 0.36, 0.42), prototypeOnly: true },
    { id: "p10", label: "法者·矩", role: "制度论者", domain: "statecraft", birthYear: -536, deathYear: -466, homeRegion: "qin", endRegion: "qin", influence: influence(0.76, 0.94, 0.28, 0.71, 0.31), prototypeOnly: true },
    { id: "p11", label: "农者·禾", role: "民生论者", domain: "craft", birthYear: -534, deathYear: -458, homeRegion: "wei", endRegion: "song", influence: influence(0.57, 0.24, 0.06, 0.73, 0.69), prototypeOnly: true },
    { id: "p12", label: "医者·芷", role: "医理研究者", domain: "craft", birthYear: -531, deathYear: -455, homeRegion: "qi", endRegion: "lu", influence: influence(0.49, 0.07, 0.02, 0.58, 0.88), prototypeOnly: true },
    { id: "p13", label: "乐者·钟", role: "礼乐研究者", domain: "culture", birthYear: -529, deathYear: -454, homeRegion: "zhou", endRegion: "lu", influence: influence(0.53, 0.16, 0.03, 0.61, 0.96), prototypeOnly: true },
    { id: "p14", label: "守者·城", role: "治理者", domain: "statecraft", birthYear: -527, deathYear: -460, homeRegion: "qi", endRegion: "qi", influence: influence(0.68, 0.82, 0.52, 0.32, 0.29), prototypeOnly: true },
    { id: "p15", label: "问者·简", role: "求学者", domain: "thought", birthYear: -525, deathYear: -448, homeRegion: "lu", endRegion: "zhou", influence: influence(0.46, 0.11, 0.04, 0.79, 0.55), prototypeOnly: true },
    { id: "p16", label: "述者·帛", role: "传述者", domain: "thought", birthYear: -523, deathYear: -450, homeRegion: "song", endRegion: "wei", influence: influence(0.59, 0.19, 0.03, 0.81, 0.86), prototypeOnly: true },
  ],
  events: [
    {
      id: "e01",
      label: "原型事件·合流",
      year: -521,
      center: [-4, 1],
      participantIds: ["p01", "p02", "p04", "p05", "p06", "p08", "p09", "p15"],
      prototypeOnly: true,
    },
    {
      id: "e02",
      label: "原型事件·回响",
      year: -509,
      center: [4, -2],
      participantIds: ["p03", "p04", "p07", "p10", "p11", "p12", "p13", "p16"],
      prototypeOnly: true,
    },
  ],
  relations: [
    { id: "r01", label: "明确传递", sourcePersonId: "p01", targetPersonId: "p04", year: -518, kind: "direct", prototypeOnly: true },
    { id: "r02", label: "文献所见的间接影响", sourcePersonId: "p04", targetPersonId: "p15", year: -511, kind: "documented-indirect", prototypeOnly: true },
    { id: "r03", label: "后世学术推断", sourcePersonId: "p08", targetPersonId: "p16", year: -507, kind: "scholarly-inference", prototypeOnly: true },
    { id: "r04", label: "制度观念的回应", sourcePersonId: "p05", targetPersonId: "p10", year: -505, kind: "documented-indirect", prototypeOnly: true },
  ],
};

export function historicalYearToY(year: number): number {
  return (CONTENT_END_YEAR - year) * UNITS_PER_YEAR;
}

export function formatHistoricalYear(year: number): string {
  if (year < 0) return `公元前${Math.abs(year)}年`;
  return `公元${year}年`;
}

export function createObservationWindow(focusYear: number): ObservationWindow {
  return {
    startYear: focusYear - OBSERVATION_SPAN / 2,
    endYear: focusYear + OBSERVATION_SPAN / 2,
    focusYear,
  };
}

function hash01(id: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    value = Math.imul(value ^ id.charCodeAt(index), 2654435761) >>> 0;
  }
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): readonly [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = clamp01(saturation);
  const l = clamp01(lightness);
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/**
 * 人物主题色：领域基色相 + 按 id/seed 派生的明度、饱和度、色相扰动。
 * 返回 sRGB 0..1。同领域共享色相区间，个体可区分。
 */
export function themeColorFor(
  person: Person,
  seed: number = prototypeFixture.seed,
): readonly [number, number, number] {
  const [baseHue, baseSat, baseLight] = domainHsl[person.domain];
  const hueJitter = (hash01(`${person.id}:h`, seed) - 0.5) * 18;
  const lightJitter = (hash01(`${person.id}:l`, seed) - 0.5) * 0.18;
  const satJitter = (hash01(`${person.id}:s`, seed) - 0.5) * 0.12;
  return hslToRgb(baseHue + hueJitter, baseSat + satJitter, baseLight + lightJitter);
}

/**
 * 人生阶段活跃曲线（仅依赖生命进度）：早年低、盛期高、晚年回落。
 * 单独抽出，保证丝线粗细/辉光与信息层影响力读数使用同一曲线。
 */
export function activeCurveAt(lifeProgress: number): number {
  return 0.28 + Math.sin(clamp01(lifeProgress) * Math.PI) * 0.72;
}

export function personPositionAt(
  person: Person,
  year: number,
  fixture: PrototypeFixture = prototypeFixture,
): WorldPosition {
  const lifeProgress = clamp01(
    (year - person.birthYear) / (person.deathYear - person.birthYear),
  );
  const home = geoRegions[person.homeRegion];
  const end = geoRegions[person.endRegion];
  const uncertainty = (home.geoUncertainty + end.geoUncertainty) / 2;
  const phase = hash01(person.id, fixture.seed) * Math.PI * 2;
  const wobble = 0.9 + uncertainty * 1.4;

  let x =
    home.center[0] +
    (end.center[0] - home.center[0]) * lifeProgress +
    Math.sin(lifeProgress * Math.PI * 3 + phase) * wobble;
  let z =
    home.center[1] +
    (end.center[1] - home.center[1]) * lifeProgress +
    Math.cos(lifeProgress * Math.PI * 2 + phase) * wobble * 0.82;

  for (const event of fixture.events) {
    if (!event.participantIds.includes(person.id)) continue;
    const distanceInYears = year - event.year;
    const pull = Math.exp(-(distanceInYears * distanceInYears) / 8) * 0.86;
    x += (event.center[0] - x) * pull;
    z += (event.center[1] - z) * pull;
  }

  return { x, y: historicalYearToY(year), z };
}

export function influenceAt(
  person: Person,
  year: number,
  dimension: InfluenceDimension,
): number {
  if (year < person.birthYear || year > person.deathYear) return 0;
  const lifeProgress = clamp01(
    (year - person.birthYear) / (person.deathYear - person.birthYear),
  );
  return person.influence[dimension] * activeCurveAt(lifeProgress);
}

export function createLifePath(
  person: Person,
  fixture: PrototypeFixture = prototypeFixture,
  stepYears = 2,
): WorldPosition[] {
  const points: WorldPosition[] = [];
  for (let year = person.birthYear; year <= person.deathYear; year += stepYears) {
    points.push(personPositionAt(person, year, fixture));
  }
  if ((person.deathYear - person.birthYear) % stepYears !== 0) {
    points.push(personPositionAt(person, person.deathYear, fixture));
  }
  return points;
}

// ---------------------------------------------------------------------------
// 人物丝线（带状几何）打包
// 每个人物一根贯穿生卒的丝线；每采样 2 顶点（三角带的左右边）。
// 粗细/辉光在着色器中由影响力驱动，位置静态，维度切换只改 uniform。
// ---------------------------------------------------------------------------

export interface FigureThreadBuildOptions {
  stepYears?: number;
}

export interface FigureThreadPersonRange {
  id: EntityId;
  index: number;
  /** 首顶点下标（每顶点，非每采样）。 */
  start: number;
  /** 顶点数（= 采样数 × 2）。 */
  count: number;
}

export interface FigureThreads {
  /** 总顶点数（= 总采样数 × 2）。 */
  vertexCount: number;
  personCount: number;
  positions: Float32Array; // vec3，中心线世界坐标（geo x, 时间 y, geo z）
  tangents: Float32Array; // vec3，路径切向（用于 billboard 垂向）
  sides: Float32Array; // ±1，带的左右边
  activeCurve: Float32Array; // 生命阶段活跃曲线
  baseInfluence: Float32Array; // vec4：overall, political, military, thought
  cultureInfluence: Float32Array; // 第五维：culture
  themeColor: Float32Array; // vec3
  years: Float32Array; // 历史年份（窗口淡出用）
  lanes: Float32Array; // 汇入河流时的横向分道 [-1,1]
  entityIds: Float32Array; // 人物索引（拾取/强调）
  index: Uint32Array;
  ranges: FigureThreadPersonRange[];
}

export function buildFigureThreads(
  fixture: PrototypeFixture = prototypeFixture,
  options: FigureThreadBuildOptions = {},
): FigureThreads {
  const stepYears = options.stepYears ?? 1;
  const personCount = fixture.persons.length;

  const yearsPerPerson = fixture.persons.map((person) => {
    const years: number[] = [];
    for (let year = person.birthYear; year <= person.deathYear; year += stepYears) {
      years.push(year);
    }
    if (years[years.length - 1] !== person.deathYear) years.push(person.deathYear);
    return years;
  });

  const totalSamples = yearsPerPerson.reduce((sum, years) => sum + years.length, 0);
  const vertexCount = totalSamples * 2;
  const triangleCount = (totalSamples - personCount) * 2;

  const positions = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const sides = new Float32Array(vertexCount);
  const activeCurve = new Float32Array(vertexCount);
  const baseInfluence = new Float32Array(vertexCount * 4);
  const cultureInfluence = new Float32Array(vertexCount);
  const themeColor = new Float32Array(vertexCount * 3);
  const years = new Float32Array(vertexCount);
  const lanes = new Float32Array(vertexCount);
  const entityIds = new Float32Array(vertexCount);
  const index = new Uint32Array(triangleCount * 3);
  const ranges: FigureThreadPersonRange[] = [];

  let vertex = 0; // 单顶点写指针
  let indexPointer = 0;

  for (let personIndex = 0; personIndex < personCount; personIndex += 1) {
    const person = fixture.persons[personIndex];
    const sampleYears = yearsPerPerson[personIndex];
    const color = themeColorFor(person, fixture.seed);
    const lane = personCount > 1 ? (personIndex / (personCount - 1)) * 2 - 1 : 0;
    const points = sampleYears.map((year) => personPositionAt(person, year, fixture));
    const firstVertex = vertex;

    for (let i = 0; i < sampleYears.length; i += 1) {
      const current = points[i];
      const previous = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let tx = next.x - previous.x;
      let ty = next.y - previous.y;
      let tz = next.z - previous.z;
      const length = Math.hypot(tx, ty, tz) || 1;
      tx /= length;
      ty /= length;
      tz /= length;
      const lifeProgress = clamp01(
        (sampleYears[i] - person.birthYear) / (person.deathYear - person.birthYear),
      );
      const ac = activeCurveAt(lifeProgress);

      for (let side = 0; side < 2; side += 1) {
        positions[vertex * 3] = current.x;
        positions[vertex * 3 + 1] = current.y;
        positions[vertex * 3 + 2] = current.z;
        tangents[vertex * 3] = tx;
        tangents[vertex * 3 + 1] = ty;
        tangents[vertex * 3 + 2] = tz;
        sides[vertex] = side === 0 ? -1 : 1;
        activeCurve[vertex] = ac;
        baseInfluence[vertex * 4] = person.influence.overall;
        baseInfluence[vertex * 4 + 1] = person.influence.political;
        baseInfluence[vertex * 4 + 2] = person.influence.military;
        baseInfluence[vertex * 4 + 3] = person.influence.thought;
        cultureInfluence[vertex] = person.influence.culture;
        themeColor[vertex * 3] = color[0];
        themeColor[vertex * 3 + 1] = color[1];
        themeColor[vertex * 3 + 2] = color[2];
        years[vertex] = sampleYears[i];
        lanes[vertex] = lane;
        entityIds[vertex] = personIndex;
        vertex += 1;
      }
    }

    for (let i = 0; i < sampleYears.length - 1; i += 1) {
      const a = firstVertex + i * 2;
      const b = firstVertex + i * 2 + 1;
      const c = firstVertex + (i + 1) * 2;
      const d = firstVertex + (i + 1) * 2 + 1;
      index[indexPointer] = a;
      index[indexPointer + 1] = b;
      index[indexPointer + 2] = c;
      index[indexPointer + 3] = b;
      index[indexPointer + 4] = d;
      index[indexPointer + 5] = c;
      indexPointer += 6;
    }

    ranges.push({
      id: person.id,
      index: personIndex,
      start: firstVertex,
      count: sampleYears.length * 2,
    });
  }

  return {
    vertexCount,
    personCount,
    positions,
    tangents,
    sides,
    activeCurve,
    baseInfluence,
    cultureInfluence,
    themeColor,
    years,
    lanes,
    entityIds,
    index,
    ranges,
  };
}

export function guideStateAtSeconds(seconds: number): ExperienceState {
  if (seconds < 25) return "river-overview";
  if (seconds < 38) return "entering-window";
  if (seconds < 50) return "slice";
  if (seconds < 60) return "person-focus";
  if (seconds < 69) return "relation-focus";
  return "river-overview";
}

export function validateFixture(
  fixture: PrototypeFixture = prototypeFixture,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const person of fixture.persons) {
    if (ids.has(person.id)) errors.push(`duplicate id: ${person.id}`);
    ids.add(person.id);
    if (person.birthYear >= person.deathYear) {
      errors.push(`invalid lifespan: ${person.id}`);
    }
    if (!person.prototypeOnly) errors.push(`missing prototype flag: ${person.id}`);
    if (!(person.homeRegion in geoRegions)) {
      errors.push(`unknown home region: ${person.id}/${person.homeRegion}`);
    }
    if (!(person.endRegion in geoRegions)) {
      errors.push(`unknown end region: ${person.id}/${person.endRegion}`);
    }
  }

  for (const event of fixture.events) {
    if (ids.has(event.id)) errors.push(`duplicate id: ${event.id}`);
    ids.add(event.id);
    for (const personId of event.participantIds) {
      if (!fixture.persons.some((person) => person.id === personId)) {
        errors.push(`missing event participant: ${event.id}/${personId}`);
      }
    }
  }

  for (const relation of fixture.relations) {
    if (ids.has(relation.id)) errors.push(`duplicate id: ${relation.id}`);
    ids.add(relation.id);
    if (!fixture.persons.some((person) => person.id === relation.sourcePersonId)) {
      errors.push(`missing relation source: ${relation.id}`);
    }
    if (!fixture.persons.some((person) => person.id === relation.targetPersonId)) {
      errors.push(`missing relation target: ${relation.id}`);
    }
  }

  return errors;
}
