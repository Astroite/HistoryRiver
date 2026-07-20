/**
 * M2 history domain contract.
 *
 * Historical years use signed civil notation: BCE is negative, CE is positive,
 * and year zero is invalid. Geometry ordering uses yearIndex so no renderer has
 * to invent its own BCE/CE conversion.
 */

export const RIVER_START_YEAR = -2700;
export const CONTENT_END_YEAR = 1949;
export const UNITS_PER_YEAR = 0.025;
export const DATASET_VERSION = "m2.1.0";

export type ChronologyStatus =
  | "attested"
  | "estimated"
  | "disputed"
  | "traditional";

export type EvidenceStatus =
  | "direct"
  | "corroborated"
  | "inferred"
  | "contested"
  | "traditional";

export type Derivation = "attested" | "bounded" | "interpolated" | "unknown";
export type LifeState = "active" | "possibly-active" | "outside-range" | "unknown";
export type SliceCoverage = "curated" | "partial" | "empty" | "unreviewed";
export type Domain = "thought" | "statecraft" | "military" | "culture" | "craft";

export interface DatasetManifest {
  id: string;
  version: string;
  title: string;
  startYear: number;
  endYear: number;
  historicalYearConvention: "signed-no-year-zero";
  selectionPolicy: string;
}

export interface EraRecord {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
  order: number;
  targetPeople: number;
  coverageNote: string;
}

export interface SourceRecord {
  id: string;
  title: string;
  creator: string;
  publisher: string;
  locator: string;
  url: string;
  sourceType: "primary" | "scholarly" | "reference" | "institutional";
  accessedAt: string;
}

export interface LocationRecord {
  id: string;
  label: string;
  /** Abstract east/west and north/south placement; not precise coordinates. */
  position: readonly [number, number];
  uncertainty: number;
  note: string;
}

export interface PersonRecord {
  id: string;
  canonicalName: string;
  aliases: string[];
  eraId: string;
  birthYear: number | null;
  deathYear: number | null;
  trajectoryStartYear: number;
  trajectoryEndYear: number;
  chronologyStatus: ChronologyStatus;
  domains: Domain[];
  selectionReason: string;
  sourceRefs: string[];
  /** Curatorial rendering weight only; never treated as a historical fact. */
  visualWeight: number;
}

export interface TrajectoryObservation {
  id: string;
  personId: string;
  startYear: number;
  endYear: number;
  locationId: string | null;
  summary: string;
  evidenceStatus: EvidenceStatus;
  sourceRefs: string[];
}

export interface InterpolationRule {
  id: string;
  personId: string;
  fromObservationId: string;
  toObservationId: string;
  startYear: number;
  endYear: number;
  method: "linear";
  uncertainty: number;
  note: string;
}

export interface RawHistoryDataset {
  manifest: DatasetManifest;
  eras: EraRecord[];
  sources: SourceRecord[];
  locations: LocationRecord[];
  people: PersonRecord[];
  observations: TrajectoryObservation[];
  interpolations: InterpolationRule[];
}

export interface HistoricalLocation {
  locationId: string;
  position: readonly [number, number];
  uncertainty: number;
}

export interface PersonYear {
  id: string;
  personId: string;
  historicalYear: number;
  yearIndex: number;
  lifeState: LifeState;
  location: HistoricalLocation | null;
  derivation: Derivation;
  observationRefs: string[];
  interpolationRuleId: string | null;
  uncertainty: number;
}

export interface YearSlice {
  historicalYear: number;
  yearIndex: number;
  personYearIds: string[];
  coverage: SliceCoverage;
  datasetVersion: string;
}

export interface AnnualHistoryDataset {
  manifest: DatasetManifest & {
    yearCount: number;
    personCount: number;
    personYearCount: number;
  };
  eras: EraRecord[];
  locations: LocationRecord[];
  people: PersonRecord[];
  personYears: PersonYear[];
  yearSlices: YearSlice[];
}

export function isHistoricalYear(year: number): boolean {
  return Number.isInteger(year) && year !== 0;
}

export function assertHistoricalYear(year: number, label = "historical year"): void {
  if (!isHistoricalYear(year)) {
    throw new Error(`${label} must be a non-zero integer, received ${year}`);
  }
}

export function nextHistoricalYear(year: number): number {
  assertHistoricalYear(year);
  return year === -1 ? 1 : year + 1;
}

export function previousHistoricalYear(year: number): number {
  assertHistoricalYear(year);
  return year === 1 ? -1 : year - 1;
}

export function historicalYearToIndex(
  year: number,
  startYear = RIVER_START_YEAR,
): number {
  assertHistoricalYear(startYear, "startYear");
  assertHistoricalYear(year);
  if (year < startYear) throw new Error(`${year} precedes dataset start ${startYear}`);
  const index = year - startYear - (startYear < 0 && year > 0 ? 1 : 0);
  if (index < 0) throw new Error(`invalid yearIndex for ${year}`);
  return index;
}

export function yearIndexToHistoricalYear(
  yearIndex: number,
  startYear = RIVER_START_YEAR,
): number {
  assertHistoricalYear(startYear, "startYear");
  if (!Number.isInteger(yearIndex) || yearIndex < 0) {
    throw new Error(`yearIndex must be a non-negative integer, received ${yearIndex}`);
  }
  const rawYear = startYear + yearIndex;
  return startYear < 0 && rawYear >= 0 ? rawYear + 1 : rawYear;
}

export function historicalYearCount(startYear: number, endYear: number): number {
  assertHistoricalYear(startYear, "startYear");
  assertHistoricalYear(endYear, "endYear");
  if (endYear < startYear) throw new Error("endYear must not precede startYear");
  return historicalYearToIndex(endYear, startYear) + 1;
}

export function historicalYears(startYear: number, endYear: number): number[] {
  const count = historicalYearCount(startYear, endYear);
  return Array.from({ length: count }, (_, index) =>
    yearIndexToHistoricalYear(index, startYear));
}

export function historicalYearToY(year: number): number {
  const index = historicalYearToIndex(year, RIVER_START_YEAR);
  const endIndex = historicalYearToIndex(CONTENT_END_YEAR, RIVER_START_YEAR);
  return (endIndex - index) * UNITS_PER_YEAR;
}

export function formatHistoricalYear(year: number): string {
  assertHistoricalYear(year);
  return year < 0 ? `公元前 ${Math.abs(year)} 年` : `${year} 年`;
}

export function personYearId(personId: string, yearIndex: number): string {
  return `${personId}:${yearIndex}`;
}

function containsYear(startYear: number, endYear: number, year: number): boolean {
  const startIndex = historicalYearToIndex(startYear);
  const endIndex = historicalYearToIndex(endYear);
  const index = historicalYearToIndex(year);
  return index >= startIndex && index <= endIndex;
}

function sourceIds(dataset: RawHistoryDataset): Set<string> {
  return new Set(dataset.sources.map((source) => source.id));
}

export function validateRawHistoryDataset(dataset: RawHistoryDataset): string[] {
  const issues: string[] = [];
  const ids = <T extends { id: string }>(records: T[], label: string) => {
    const seen = new Set<string>();
    for (const record of records) {
      if (!record.id.trim()) issues.push(`${label} has an empty id`);
      if (seen.has(record.id)) issues.push(`duplicate ${label} id ${record.id}`);
      seen.add(record.id);
    }
    return seen;
  };

  const eraIds = ids(dataset.eras, "era");
  const sourceIdSet = sourceIds(dataset);
  ids(dataset.sources, "source");
  const locationIds = ids(dataset.locations, "location");
  const personIds = ids(dataset.people, "person");
  const observationIds = ids(dataset.observations, "observation");
  ids(dataset.interpolations, "interpolation");

  if (dataset.manifest.historicalYearConvention !== "signed-no-year-zero") {
    issues.push("manifest historicalYearConvention must be signed-no-year-zero");
  }
  for (const [label, year] of [
    ["manifest.startYear", dataset.manifest.startYear],
    ["manifest.endYear", dataset.manifest.endYear],
  ] as const) {
    if (!isHistoricalYear(year)) issues.push(`${label} is invalid: ${year}`);
  }
  if (dataset.manifest.startYear !== RIVER_START_YEAR
    || dataset.manifest.endYear !== CONTENT_END_YEAR) {
    issues.push("manifest boundaries must match the M2 rendering contract");
  }

  const checkRefs = (owner: string, refs: string[]) => {
    if (refs.length === 0) issues.push(`${owner} has no source references`);
    for (const ref of refs) {
      if (!sourceIdSet.has(ref)) issues.push(`${owner} references missing source ${ref}`);
    }
  };

  const sortedEras = [...dataset.eras].sort((a, b) => a.order - b.order);
  if (sortedEras.length !== 11) issues.push(`expected 11 coverage eras, received ${sortedEras.length}`);
  for (let index = 0; index < sortedEras.length; index += 1) {
    const era = sortedEras[index];
    if (!isHistoricalYear(era.startYear) || !isHistoricalYear(era.endYear)) {
      issues.push(`era ${era.id} contains year zero or a non-integer boundary`);
    }
    if (era.endYear < era.startYear) issues.push(`era ${era.id} has inverted boundaries`);
    if (index > 0 && nextHistoricalYear(sortedEras[index - 1].endYear) !== era.startYear) {
      issues.push(`era coverage gap or overlap before ${era.id}`);
    }
  }
  if (sortedEras[0]?.startYear !== dataset.manifest.startYear
    || sortedEras.at(-1)?.endYear !== dataset.manifest.endYear) {
    issues.push("era matrix must cover the complete dataset boundary");
  }

  for (const location of dataset.locations) {
    if (location.uncertainty < 0 || location.uncertainty > 1) {
      issues.push(`location ${location.id} uncertainty is outside 0..1`);
    }
    if (!location.position.every(Number.isFinite)) {
      issues.push(`location ${location.id} has a non-finite position`);
    }
  }

  for (const person of dataset.people) {
    if (!eraIds.has(person.eraId)) issues.push(`person ${person.id} references missing era ${person.eraId}`);
    checkRefs(`person ${person.id}`, person.sourceRefs);
    for (const year of [person.trajectoryStartYear, person.trajectoryEndYear]) {
      if (!isHistoricalYear(year)) issues.push(`person ${person.id} has invalid trajectory year ${year}`);
    }
    if (person.trajectoryEndYear < person.trajectoryStartYear) {
      issues.push(`person ${person.id} has inverted trajectory range`);
    }
    if (person.trajectoryStartYear < dataset.manifest.startYear
      || person.trajectoryEndYear > dataset.manifest.endYear) {
      issues.push(`person ${person.id} trajectory exceeds dataset boundary`);
    }
    if (person.birthYear !== null && !isHistoricalYear(person.birthYear)) {
      issues.push(`person ${person.id} has invalid birth year`);
    }
    if (person.deathYear !== null && !isHistoricalYear(person.deathYear)) {
      issues.push(`person ${person.id} has invalid death year`);
    }
    if (person.visualWeight < 0 || person.visualWeight > 1) {
      issues.push(`person ${person.id} visualWeight is outside 0..1`);
    }
  }

  const observationsByPerson = new Map<string, TrajectoryObservation[]>();
  for (const observation of dataset.observations) {
    if (!personIds.has(observation.personId)) {
      issues.push(`observation ${observation.id} references missing person ${observation.personId}`);
    }
    if (observation.locationId !== null && !locationIds.has(observation.locationId)) {
      issues.push(`observation ${observation.id} references missing location ${observation.locationId}`);
    }
    checkRefs(`observation ${observation.id}`, observation.sourceRefs);
    if (!isHistoricalYear(observation.startYear) || !isHistoricalYear(observation.endYear)) {
      issues.push(`observation ${observation.id} has an invalid year`);
    }
    if (observation.endYear < observation.startYear) {
      issues.push(`observation ${observation.id} has inverted boundaries`);
    }
    const records = observationsByPerson.get(observation.personId) ?? [];
    records.push(observation);
    observationsByPerson.set(observation.personId, records);
  }

  for (const [personId, observations] of observationsByPerson) {
    for (const year of historicalYears(
      Math.max(dataset.manifest.startYear, Math.min(...observations.map((item) => item.startYear))),
      Math.min(dataset.manifest.endYear, Math.max(...observations.map((item) => item.endYear))),
    )) {
      const located = observations.filter((item) =>
        item.locationId !== null && containsYear(item.startYear, item.endYear, year));
      if (located.length > 1) {
        issues.push(`person ${personId} has overlapping located observations in ${year}`);
        break;
      }
    }
  }

  for (const rule of dataset.interpolations) {
    if (!personIds.has(rule.personId)) issues.push(`interpolation ${rule.id} has missing person`);
    const from = dataset.observations.find((item) => item.id === rule.fromObservationId);
    const to = dataset.observations.find((item) => item.id === rule.toObservationId);
    if (!observationIds.has(rule.fromObservationId) || !observationIds.has(rule.toObservationId)) {
      issues.push(`interpolation ${rule.id} has missing endpoint observation`);
      continue;
    }
    if (from?.personId !== rule.personId || to?.personId !== rule.personId) {
      issues.push(`interpolation ${rule.id} endpoint belongs to another person`);
    }
    if (!from?.locationId || !to?.locationId) {
      issues.push(`interpolation ${rule.id} endpoints must have locations`);
    }
    if (rule.startYear === 0 || rule.endYear === 0 || rule.endYear < rule.startYear) {
      issues.push(`interpolation ${rule.id} has invalid bounds`);
    }
    if (rule.uncertainty < 0 || rule.uncertainty > 1) {
      issues.push(`interpolation ${rule.id} uncertainty is outside 0..1`);
    }
  }

  return issues;
}

function lifeStateFor(person: PersonRecord): LifeState {
  return person.chronologyStatus === "attested" ? "active" : "possibly-active";
}

function interpolatedLocation(
  rule: InterpolationRule,
  year: number,
  observationMap: Map<string, TrajectoryObservation>,
  locationMap: Map<string, LocationRecord>,
): HistoricalLocation | null {
  const from = observationMap.get(rule.fromObservationId);
  const to = observationMap.get(rule.toObservationId);
  const fromLocation = from?.locationId ? locationMap.get(from.locationId) : undefined;
  const toLocation = to?.locationId ? locationMap.get(to.locationId) : undefined;
  if (!fromLocation || !toLocation) return null;
  const startIndex = historicalYearToIndex(rule.startYear);
  const endIndex = historicalYearToIndex(rule.endYear);
  const yearIndex = historicalYearToIndex(year);
  const progress = endIndex === startIndex ? 0 : (yearIndex - startIndex) / (endIndex - startIndex);
  return {
    locationId: `${fromLocation.id}->${toLocation.id}`,
    position: [
      fromLocation.position[0] + (toLocation.position[0] - fromLocation.position[0]) * progress,
      fromLocation.position[1] + (toLocation.position[1] - fromLocation.position[1]) * progress,
    ],
    uncertainty: rule.uncertainty,
  };
}

export function materializeAnnualHistoryDataset(
  dataset: RawHistoryDataset,
): AnnualHistoryDataset {
  const issues = validateRawHistoryDataset(dataset);
  if (issues.length > 0) throw new Error(`History dataset is invalid:\n${issues.join("\n")}`);

  const locationMap = new Map(dataset.locations.map((location) => [location.id, location]));
  const observationMap = new Map(dataset.observations.map((observation) => [observation.id, observation]));
  const observationsByPerson = new Map<string, TrajectoryObservation[]>();
  const rulesByPerson = new Map<string, InterpolationRule[]>();
  for (const observation of dataset.observations) {
    const records = observationsByPerson.get(observation.personId) ?? [];
    records.push(observation);
    observationsByPerson.set(observation.personId, records);
  }
  for (const rule of dataset.interpolations) {
    const records = rulesByPerson.get(rule.personId) ?? [];
    records.push(rule);
    rulesByPerson.set(rule.personId, records);
  }

  const personYears: PersonYear[] = [];
  for (const person of [...dataset.people].sort((a, b) => a.id.localeCompare(b.id))) {
    const observations = observationsByPerson.get(person.id) ?? [];
    const rules = rulesByPerson.get(person.id) ?? [];
    for (const historicalYear of historicalYears(person.trajectoryStartYear, person.trajectoryEndYear)) {
      const yearIndex = historicalYearToIndex(historicalYear, dataset.manifest.startYear);
      const observation = observations.find((item) =>
        item.locationId !== null && containsYear(item.startYear, item.endYear, historicalYear));
      const rule = rules.find((item) => containsYear(item.startYear, item.endYear, historicalYear));
      const location = observation?.locationId ? locationMap.get(observation.locationId) : undefined;

      let derivedLocation: HistoricalLocation | null = null;
      let derivation: Derivation = "unknown";
      let refs: string[] = [];
      let interpolationRuleId: string | null = null;
      let uncertainty = 1;

      if (observation && location) {
        derivation = observation.startYear === observation.endYear ? "attested" : "bounded";
        derivedLocation = {
          locationId: location.id,
          position: location.position,
          uncertainty: Math.max(location.uncertainty,
            observation.evidenceStatus === "direct" ? 0.08
              : observation.evidenceStatus === "corroborated" ? 0.2
                : observation.evidenceStatus === "traditional" ? 0.78 : 0.52),
        };
        refs = [observation.id];
        uncertainty = derivedLocation.uncertainty;
      } else if (rule) {
        derivation = "interpolated";
        derivedLocation = interpolatedLocation(rule, historicalYear, observationMap, locationMap);
        refs = [rule.fromObservationId, rule.toObservationId];
        interpolationRuleId = rule.id;
        uncertainty = rule.uncertainty;
      }

      personYears.push({
        id: personYearId(person.id, yearIndex),
        personId: person.id,
        historicalYear,
        yearIndex,
        lifeState: lifeStateFor(person),
        location: derivedLocation,
        derivation,
        observationRefs: refs,
        interpolationRuleId,
        uncertainty,
      });
    }
  }

  const membersByIndex = new Map<number, string[]>();
  for (const personYear of personYears) {
    const members = membersByIndex.get(personYear.yearIndex) ?? [];
    members.push(personYear.id);
    membersByIndex.set(personYear.yearIndex, members);
  }
  const eraByYear = (year: number) => dataset.eras.find((era) =>
    containsYear(era.startYear, era.endYear, year));
  const yearSlices = historicalYears(dataset.manifest.startYear, dataset.manifest.endYear)
    .map((historicalYear) => {
      const yearIndex = historicalYearToIndex(historicalYear, dataset.manifest.startYear);
      const members = (membersByIndex.get(yearIndex) ?? []).sort();
      const era = eraByYear(historicalYear);
      return {
        historicalYear,
        yearIndex,
        personYearIds: members,
        coverage: members.length > 0 ? "partial" : era ? "empty" : "unreviewed",
        datasetVersion: dataset.manifest.version,
      } satisfies YearSlice;
    });

  return {
    manifest: {
      ...dataset.manifest,
      yearCount: yearSlices.length,
      personCount: dataset.people.length,
      personYearCount: personYears.length,
    },
    eras: [...dataset.eras].sort((a, b) => a.order - b.order),
    locations: [...dataset.locations].sort((a, b) => a.id.localeCompare(b.id)),
    people: [...dataset.people].sort((a, b) => a.id.localeCompare(b.id)),
    personYears,
    yearSlices,
  };
}

export interface PersonThreadGeometry {
  positions: Float32Array;
  colors: Float32Array;
  alpha: Float32Array;
  personIndices: Float32Array;
  yearIndices: Float32Array;
  segmentCount: number;
  ranges: Array<{ personId: string; personIndex: number; startSegment: number; segmentCount: number }>;
}

export interface RenderPersonRecord {
  id: string;
  domain: Domain;
  visualWeight: number;
}

/** [personIndex, historicalYear, yearIndex, x, z, uncertainty] */
export type RenderPersonYear = readonly [
  personIndex: number,
  historicalYear: number,
  yearIndex: number,
  positionX: number | null,
  positionZ: number | null,
  uncertainty: number,
];

export interface RenderHistoryDataset {
  manifest: {
    version: string;
    personCount: number;
    personYearCount: number;
  };
  people: RenderPersonRecord[];
  personYears: RenderPersonYear[];
}

const domainColors: Record<Domain, readonly [number, number, number]> = {
  thought: [0.56, 0.72, 0.78],
  statecraft: [0.82, 0.63, 0.39],
  military: [0.69, 0.38, 0.32],
  culture: [0.72, 0.58, 0.76],
  craft: [0.42, 0.69, 0.58],
};

function stableLane(id: string): number {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * 2 - 1;
}

export function buildPersonThreadGeometry(
  dataset: Pick<AnnualHistoryDataset, "people" | "personYears">,
): PersonThreadGeometry {
  const people = dataset.people.map((person) => ({
    id: person.id,
    domain: person.domains[0] ?? "culture" as Domain,
    visualWeight: person.visualWeight,
  }));
  const personIndex = new Map(people.map((person, index) => [person.id, index]));
  const personYears: RenderPersonYear[] = dataset.personYears.map((record) => [
    personIndex.get(record.personId)!,
    record.historicalYear,
    record.yearIndex,
    record.location?.position[0] ?? null,
    record.location?.position[1] ?? null,
    record.uncertainty,
  ]);
  return buildRenderPersonThreadGeometry({
    manifest: {
      version: "test-or-database",
      personCount: people.length,
      personYearCount: personYears.length,
    },
    people,
    personYears,
  });
}

export function buildRenderPersonThreadGeometry(
  dataset: RenderHistoryDataset,
): PersonThreadGeometry {
  const personYearsByPerson = new Map<number, RenderPersonYear[]>();
  for (const personYear of dataset.personYears) {
    const records = personYearsByPerson.get(personYear[0]) ?? [];
    records.push(personYear);
    personYearsByPerson.set(personYear[0], records);
  }
  const segmentCount = [...personYearsByPerson.values()]
    .reduce((sum, records) => sum + Math.max(0, records.length - 1), 0);
  const vertexCount = segmentCount * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const alpha = new Float32Array(vertexCount);
  const personIndices = new Float32Array(vertexCount);
  const yearIndices = new Float32Array(vertexCount);
  const ranges: PersonThreadGeometry["ranges"] = [];
  let vertex = 0;
  let segment = 0;

  const pointFor = (record: RenderPersonYear, lane: number): readonly [number, number, number] => {
    const certainty = 1 - record[5];
    const geographicX = record[3] === null ? 0 : record[3] * 0.32 * certainty;
    const geographicZ = record[4] === null ? 0 : record[4] * 0.22 * certainty;
    const riverMeander = Math.sin(record[2] * 0.0037 + lane * 3) * 1.6;
    return [
      6 + lane * 5.8 + geographicX + riverMeander,
      historicalYearToY(record[1]),
      lane * 1.8 + geographicZ,
    ];
  };

  dataset.people.forEach((person, personIndex) => {
    const records = [...(personYearsByPerson.get(personIndex) ?? [])]
      .sort((a, b) => a[2] - b[2]);
    const startSegment = segment;
    const lane = stableLane(person.id);
    const color = domainColors[person.domain];
    for (let index = 0; index < records.length - 1; index += 1) {
      const current = records[index];
      const next = records[index + 1];
      if (next[2] !== current[2] + 1) continue;
      const currentPoint = pointFor(current, lane);
      const nextPoint = pointFor(next, lane);
      for (const [record, point] of [[current, currentPoint], [next, nextPoint]] as const) {
        positions.set(point, vertex * 3);
        colors.set(color, vertex * 3);
        alpha[vertex] = (0.18 + (1 - record[5]) * 0.62)
          * (0.55 + person.visualWeight * 0.45);
        personIndices[vertex] = personIndex;
        yearIndices[vertex] = record[2];
        vertex += 1;
      }
      segment += 1;
    }
    ranges.push({
      personId: person.id,
      personIndex,
      startSegment,
      segmentCount: segment - startSegment,
    });
  });

  return { positions, colors, alpha, personIndices, yearIndices, segmentCount, ranges };
}

// ---------------------------------------------------------------------------
// Abstract geography retained as an explicitly artistic background layer.
// It is not a historical boundary database and is not derived from person data.
// ---------------------------------------------------------------------------

export const abstractChina = {
  coastline: [
    [9, -6], [10, -3], [10, 0], [9, 3], [7, 6], [4, 8],
  ] as ReadonlyArray<readonly [number, number]>,
  rivers: {
    yellow: [
      [-11, -2], [-8, -3], [-5, -5], [-2, -4], [0, -1], [3, 0], [7, -1], [10, 0],
    ] as ReadonlyArray<readonly [number, number]>,
    yangtze: [
      [-11, 5], [-7, 5], [-3, 6], [0, 5], [3, 5], [6, 4], [9, 4],
    ] as ReadonlyArray<readonly [number, number]>,
  },
} as const;
