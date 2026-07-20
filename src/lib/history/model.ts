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
  evidencePositions: Float32Array;
  evidenceColors: Float32Array;
  evidenceAlpha: Float32Array;
  evidencePersonIndices: Float32Array;
  evidenceYearIndices: Float32Array;
  evidenceDerivations: Float32Array;
  evidenceSegmentCount: number;
  anchorPositions: Float32Array;
  anchorPersonIndices: Float32Array;
  ranges: PersonThreadRange[];
  evidenceRanges: PersonEvidenceRange[];
}

export interface PersonThreadRange {
  personId: string;
  personIndex: number;
  startSegment: number;
  segmentCount: number;
  bounds: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  };
}

export interface PersonEvidenceRange {
  personId: string;
  personIndex: number;
  evidenceSpanIndex: number;
  startSegment: number;
  segmentCount: number;
  startYear: number;
  endYear: number;
  locationIndex: number;
  derivation: RenderDerivationCode;
  uncertainty: number;
}

export interface RenderPersonRecord {
  id: string;
  canonicalName: string;
  domain: Domain;
  visualWeight: number;
  birthYear: number | null;
  deathYear: number | null;
  trajectoryStartYear: number;
  trajectoryEndYear: number;
}

export interface RenderLocationRecord {
  id: string;
  label: string;
}

export const RENDER_DERIVATION = {
  unknown: 0,
  attested: 1,
  bounded: 2,
  interpolated: 3,
} as const;

export type RenderDerivationCode = typeof RENDER_DERIVATION[keyof typeof RENDER_DERIVATION];

/**
 * [personIndex, historicalYear, yearIndex, x, z, uncertainty,
 *  derivationCode, locationIndex, evidenceSpanIndex]
 */
export type RenderPersonYear = readonly [
  personIndex: number,
  historicalYear: number,
  yearIndex: number,
  positionX: number | null,
  positionZ: number | null,
  uncertainty: number,
  derivationCode: RenderDerivationCode,
  locationIndex: number,
  evidenceSpanIndex: number,
];

export interface RenderHistoryDataset {
  manifest: {
    version: string;
    personCount: number;
    personYearCount: number;
  };
  locations: RenderLocationRecord[];
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
  const locations = new Map<string, LocationRecord>();
  for (const record of dataset.personYears) {
    if (!record.location || locations.has(record.location.locationId)) continue;
    locations.set(record.location.locationId, {
      id: record.location.locationId,
      label: record.location.locationId,
      position: record.location.position,
      uncertainty: record.location.uncertainty,
      note: "test geometry location",
    });
  }
  return buildRenderPersonThreadGeometry(buildRenderHistoryDataset({
    manifest: {
      id: "test-or-database",
      version: "test-or-database",
      title: "test-or-database",
      startYear: RIVER_START_YEAR,
      endYear: CONTENT_END_YEAR,
      historicalYearConvention: "signed-no-year-zero",
      selectionPolicy: "test-or-database",
      yearCount: 0,
      personCount: dataset.people.length,
      personYearCount: dataset.personYears.length,
    },
    locations: [...locations.values()],
    people: dataset.people,
    personYears: dataset.personYears,
  }));
}

function renderDerivationCode(derivation: Derivation): RenderDerivationCode {
  return RENDER_DERIVATION[derivation];
}

function evidenceKey(record: PersonYear): string | null {
  if (!record.location) return null;
  if (record.interpolationRuleId) return `interpolation:${record.interpolationRuleId}`;
  return `observation:${record.observationRefs.join(",")}:${record.location.locationId}`;
}

export function buildRenderHistoryDataset(
  dataset: Pick<AnnualHistoryDataset, "manifest" | "locations" | "people" | "personYears">,
): RenderHistoryDataset {
  const people = dataset.people.map((person) => ({
    id: person.id,
    canonicalName: person.canonicalName,
    domain: person.domains[0] ?? "culture" as Domain,
    visualWeight: person.visualWeight,
    birthYear: person.birthYear,
    deathYear: person.deathYear,
    trajectoryStartYear: person.trajectoryStartYear,
    trajectoryEndYear: person.trajectoryEndYear,
  }));
  const personIndex = new Map(people.map((person, index) => [person.id, index]));
  const locationIndex = new Map(dataset.locations.map((location, index) => [location.id, index]));
  const spanByRecordId = new Map<string, number>();
  let nextSpan = 0;

  for (const person of dataset.people) {
    const records = dataset.personYears
      .filter((record) => record.personId === person.id)
      .sort((a, b) => a.yearIndex - b.yearIndex);
    let previousKey: string | null = null;
    let previousYearIndex = -2;
    let activeSpan = -1;
    for (const record of records) {
      const key = evidenceKey(record);
      if (key === null) {
        previousKey = null;
        activeSpan = -1;
      } else if (key !== previousKey || record.yearIndex !== previousYearIndex + 1) {
        activeSpan = nextSpan;
        nextSpan += 1;
        previousKey = key;
      }
      spanByRecordId.set(record.id, activeSpan);
      previousYearIndex = record.yearIndex;
    }
  }

  return {
    manifest: {
      version: dataset.manifest.version,
      personCount: dataset.manifest.personCount,
      personYearCount: dataset.manifest.personYearCount,
    },
    locations: dataset.locations.map((location) => ({ id: location.id, label: location.label })),
    people,
    personYears: dataset.personYears.map((record) => [
      personIndex.get(record.personId)!,
      record.historicalYear,
      record.yearIndex,
      record.location?.position[0] ?? null,
      record.location?.position[1] ?? null,
      record.uncertainty,
      renderDerivationCode(record.derivation),
      record.location ? locationIndex.get(record.location.locationId) ?? -1 : -1,
      spanByRecordId.get(record.id) ?? -1,
    ]),
  };
}

interface CurvePoint {
  position: readonly [number, number, number];
  yearIndex: number;
  alpha: number;
}

function extrapolate(
  point: readonly [number, number, number],
  neighbor: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    point[0] * 2 - neighbor[0],
    point[1] * 2 - neighbor[1],
    point[2] * 2 - neighbor[2],
  ];
}

function distanceInterval(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  const dz = right[2] - left[2];
  return Math.max(0.0001, Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz)));
}

function weightedPoint(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  leftWeight: number,
  rightWeight: number,
): readonly [number, number, number] {
  return [
    left[0] * leftWeight + right[0] * rightWeight,
    left[1] * leftWeight + right[1] * rightWeight,
    left[2] * leftWeight + right[2] * rightWeight,
  ];
}

function centripetalPoint(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
  u: number,
): readonly [number, number, number] {
  const t0 = 0;
  const t1 = t0 + distanceInterval(p0, p1);
  const t2 = t1 + distanceInterval(p1, p2);
  const t3 = t2 + distanceInterval(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const a1 = weightedPoint(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
  const a2 = weightedPoint(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
  const a3 = weightedPoint(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
  const b1 = weightedPoint(a1, a2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
  const b2 = weightedPoint(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
  return weightedPoint(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
}

function smoothCurve(points: CurvePoint[], subdivisions = 3): CurvePoint[] {
  if (points.length < 2) return points;
  const result: CurvePoint[] = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const p0 = index > 0
      ? points[index - 1].position
      : extrapolate(current.position, next.position);
    const p3 = index + 2 < points.length
      ? points[index + 2].position
      : extrapolate(next.position, current.position);
    for (let step = 1; step <= subdivisions; step += 1) {
      const u = step / subdivisions;
      result.push({
        position: centripetalPoint(p0, current.position, next.position, p3, u),
        yearIndex: current.yearIndex + (next.yearIndex - current.yearIndex) * u,
        alpha: current.alpha + (next.alpha - current.alpha) * u,
      });
    }
  }
  return result;
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
  const positionValues: number[] = [];
  const colorValues: number[] = [];
  const alphaValues: number[] = [];
  const personIndexValues: number[] = [];
  const yearIndexValues: number[] = [];
  const evidencePositionValues: number[] = [];
  const evidenceColorValues: number[] = [];
  const evidenceAlphaValues: number[] = [];
  const evidencePersonIndexValues: number[] = [];
  const evidenceYearIndexValues: number[] = [];
  const evidenceDerivationValues: number[] = [];
  const anchorPositionValues: number[] = [];
  const anchorPersonIndexValues: number[] = [];
  const ranges: PersonThreadGeometry["ranges"] = [];
  const evidenceRanges: PersonThreadGeometry["evidenceRanges"] = [];
  let segment = 0;
  let evidenceSegment = 0;

  const lifePointFor = (record: RenderPersonYear, lane: number): readonly [number, number, number] => {
    const riverMeander = Math.sin(record[2] * 0.0037 + lane * 3) * 1.6;
    return [
      6 + lane * 5.8 + riverMeander,
      historicalYearToY(record[1]),
      lane * 1.8,
    ];
  };

  const evidencePointFor = (
    record: RenderPersonYear,
    lane: number,
  ): readonly [number, number, number] => {
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
    const lifeAlpha = 0.26 + person.visualWeight * 0.24;
    const lifeCurve = smoothCurve(records.map((record) => ({
      position: lifePointFor(record, lane),
      yearIndex: record[2],
      alpha: lifeAlpha,
    })));
    const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const includeInBounds = (point: readonly [number, number, number]) => {
      for (let axis = 0; axis < 3; axis += 1) {
        boundsMin[axis] = Math.min(boundsMin[axis], point[axis]);
        boundsMax[axis] = Math.max(boundsMax[axis], point[axis]);
      }
    };

    for (let index = 0; index < lifeCurve.length - 1; index += 1) {
      const current = lifeCurve[index];
      const next = lifeCurve[index + 1];
      for (const point of [current, next]) {
        positionValues.push(...point.position);
        colorValues.push(...color);
        alphaValues.push(point.alpha);
        personIndexValues.push(personIndex);
        yearIndexValues.push(point.yearIndex);
        includeInBounds(point.position);
      }
      segment += 1;
    }

    const evidenceRuns = new Map<number, RenderPersonYear[]>();
    for (const record of records) {
      if (record[8] < 0 || record[3] === null || record[4] === null) continue;
      const run = evidenceRuns.get(record[8]) ?? [];
      run.push(record);
      evidenceRuns.set(record[8], run);
    }
    for (const [evidenceSpanIndex, run] of evidenceRuns) {
      const rawCurve = run.map((record) => ({
        position: evidencePointFor(record, lane),
        yearIndex: record[2],
        alpha: (0.18 + (1 - record[5]) * 0.62)
          * (0.55 + person.visualWeight * 0.45),
      }));
      for (const point of rawCurve) includeInBounds(point.position);
      const first = run[0];
      const last = run[run.length - 1];
      if (run.length === 1) {
        anchorPositionValues.push(...rawCurve[0].position);
        anchorPersonIndexValues.push(personIndex);
        evidenceRanges.push({
          personId: person.id,
          personIndex,
          evidenceSpanIndex,
          startSegment: evidenceSegment,
          segmentCount: 0,
          startYear: first[1],
          endYear: first[1],
          locationIndex: first[7],
          derivation: first[6],
          uncertainty: first[5],
        });
        continue;
      }

      const curve = smoothCurve(rawCurve);
      const fadeSteps = Math.max(1, Math.min(4, Math.floor((curve.length - 1) / 2)));
      for (let index = 0; index < curve.length; index += 1) {
        const edgeDistance = Math.min(index, curve.length - 1 - index);
        const edgeFade = 0.25 + Math.min(1, edgeDistance / fadeSteps) * 0.75;
        curve[index] = { ...curve[index], alpha: curve[index].alpha * edgeFade };
      }
      const startEvidenceSegment = evidenceSegment;
      anchorPositionValues.push(...curve[0].position, ...curve[curve.length - 1].position);
      anchorPersonIndexValues.push(personIndex, personIndex);
      for (let index = 0; index < curve.length - 1; index += 1) {
        const current = curve[index];
        const next = curve[index + 1];
        for (const point of [current, next]) {
          evidencePositionValues.push(...point.position);
          evidenceColorValues.push(...color);
          evidenceAlphaValues.push(point.alpha);
          evidencePersonIndexValues.push(personIndex);
          evidenceYearIndexValues.push(point.yearIndex);
          evidenceDerivationValues.push(first[6]);
        }
        evidenceSegment += 1;
      }
      evidenceRanges.push({
        personId: person.id,
        personIndex,
        evidenceSpanIndex,
        startSegment: startEvidenceSegment,
        segmentCount: evidenceSegment - startEvidenceSegment,
        startYear: first[1],
        endYear: last[1],
        locationIndex: first[7],
        derivation: first[6],
        uncertainty: run.reduce((sum, record) => sum + record[5], 0) / run.length,
      });
    }

    ranges.push({
      personId: person.id,
      personIndex,
      startSegment,
      segmentCount: segment - startSegment,
      bounds: { min: boundsMin, max: boundsMax },
    });
  });

  return {
    positions: new Float32Array(positionValues),
    colors: new Float32Array(colorValues),
    alpha: new Float32Array(alphaValues),
    personIndices: new Float32Array(personIndexValues),
    yearIndices: new Float32Array(yearIndexValues),
    segmentCount: segment,
    evidencePositions: new Float32Array(evidencePositionValues),
    evidenceColors: new Float32Array(evidenceColorValues),
    evidenceAlpha: new Float32Array(evidenceAlphaValues),
    evidencePersonIndices: new Float32Array(evidencePersonIndexValues),
    evidenceYearIndices: new Float32Array(evidenceYearIndexValues),
    evidenceDerivations: new Float32Array(evidenceDerivationValues),
    evidenceSegmentCount: evidenceSegment,
    anchorPositions: new Float32Array(anchorPositionValues),
    anchorPersonIndices: new Float32Array(anchorPersonIndexValues),
    ranges,
    evidenceRanges,
  };
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
