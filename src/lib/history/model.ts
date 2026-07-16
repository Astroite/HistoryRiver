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

export interface Person {
  id: EntityId;
  label: string;
  role: string;
  birthYear: number;
  deathYear: number;
  origin: readonly [number, number];
  drift: readonly [number, number];
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
    { id: "p01", label: "行者·松", role: "游学者", birthYear: -566, deathYear: -480, origin: [-9, 5], drift: [12, -4], influence: influence(0.72, 0.18, 0.08, 0.92, 0.64), prototypeOnly: true },
    { id: "p02", label: "辩者·羽", role: "论辩者", birthYear: -558, deathYear: -486, origin: [-6, -4], drift: [9, 8], influence: influence(0.62, 0.26, 0.05, 0.84, 0.58), prototypeOnly: true },
    { id: "p03", label: "史官·砚", role: "记述者", birthYear: -552, deathYear: -472, origin: [7, 6], drift: [-8, -7], influence: influence(0.55, 0.34, 0.04, 0.62, 0.83), prototypeOnly: true },
    { id: "p04", label: "学者·兰", role: "授业者", birthYear: -548, deathYear: -468, origin: [4, -7], drift: [-7, 11], influence: influence(0.78, 0.22, 0.03, 0.96, 0.81), prototypeOnly: true },
    { id: "p05", label: "策士·衡", role: "策议者", birthYear: -546, deathYear: -478, origin: [10, 1], drift: [-12, 3], influence: influence(0.74, 0.88, 0.22, 0.54, 0.36), prototypeOnly: true },
    { id: "p06", label: "将者·岳", role: "军政人物", birthYear: -544, deathYear: -488, origin: [-10, -1], drift: [14, -2], influence: influence(0.69, 0.66, 0.95, 0.18, 0.16), prototypeOnly: true },
    { id: "p07", label: "工者·璧", role: "技艺者", birthYear: -541, deathYear: -470, origin: [1, 9], drift: [5, -13], influence: influence(0.48, 0.13, 0.07, 0.45, 0.91), prototypeOnly: true },
    { id: "p08", label: "隐者·泉", role: "思想者", birthYear: -539, deathYear: -462, origin: [-3, 10], drift: [1, -12], influence: influence(0.64, 0.08, 0.02, 0.89, 0.67), prototypeOnly: true },
    { id: "p09", label: "使者·舟", role: "行旅者", birthYear: -538, deathYear: -475, origin: [-11, 2], drift: [17, 4], influence: influence(0.51, 0.58, 0.12, 0.36, 0.42), prototypeOnly: true },
    { id: "p10", label: "法者·矩", role: "制度论者", birthYear: -536, deathYear: -466, origin: [8, -6], drift: [-11, 8], influence: influence(0.76, 0.94, 0.28, 0.71, 0.31), prototypeOnly: true },
    { id: "p11", label: "农者·禾", role: "民生论者", birthYear: -534, deathYear: -458, origin: [11, 4], drift: [-15, -1], influence: influence(0.57, 0.24, 0.06, 0.73, 0.69), prototypeOnly: true },
    { id: "p12", label: "医者·芷", role: "医理研究者", birthYear: -531, deathYear: -455, origin: [-8, -7], drift: [10, 12], influence: influence(0.49, 0.07, 0.02, 0.58, 0.88), prototypeOnly: true },
    { id: "p13", label: "乐者·钟", role: "礼乐研究者", birthYear: -529, deathYear: -454, origin: [5, 8], drift: [-8, -11], influence: influence(0.53, 0.16, 0.03, 0.61, 0.96), prototypeOnly: true },
    { id: "p14", label: "守者·城", role: "治理者", birthYear: -527, deathYear: -460, origin: [9, 7], drift: [-13, -6], influence: influence(0.68, 0.82, 0.52, 0.32, 0.29), prototypeOnly: true },
    { id: "p15", label: "问者·简", role: "求学者", birthYear: -525, deathYear: -448, origin: [-5, 7], drift: [9, -9], influence: influence(0.46, 0.11, 0.04, 0.79, 0.55), prototypeOnly: true },
    { id: "p16", label: "述者·帛", role: "传述者", birthYear: -523, deathYear: -450, origin: [2, -9], drift: [-3, 14], influence: influence(0.59, 0.19, 0.03, 0.81, 0.86), prototypeOnly: true },
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

export function personPositionAt(
  person: Person,
  year: number,
  fixture: PrototypeFixture = prototypeFixture,
): WorldPosition {
  const lifeProgress = clamp01(
    (year - person.birthYear) / (person.deathYear - person.birthYear),
  );
  const phase = hash01(person.id, fixture.seed) * Math.PI * 2;
  let x =
    person.origin[0] +
    person.drift[0] * lifeProgress +
    Math.sin(lifeProgress * Math.PI * 3 + phase) * 1.35;
  let z =
    person.origin[1] +
    person.drift[1] * lifeProgress +
    Math.cos(lifeProgress * Math.PI * 2 + phase) * 1.1;

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
  const activeCurve = 0.28 + Math.sin(lifeProgress * Math.PI) * 0.72;
  return person.influence[dimension] * activeCurve;
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
