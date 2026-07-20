/// <reference types="node" />

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  materializeAnnualHistoryDataset,
  type AnnualHistoryDataset,
  type DatasetManifest,
  type EraRecord,
  type InterpolationRule,
  type LocationRecord,
  type PersonRecord,
  type RawHistoryDataset,
  type SourceRecord,
  type TrajectoryObservation,
} from "../src/lib/history/model.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(repositoryRoot, "data/history/source");
const migrationPath = resolve(repositoryRoot, "data/history/migrations/001_initial.sql");
const buildRoot = resolve(repositoryRoot, "data/history/build");
const generatedRoot = resolve(repositoryRoot, "src/data/history/generated");

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(sourceRoot, name), "utf8")) as T;
}

async function loadRawDataset(): Promise<RawHistoryDataset> {
  const [manifest, eras, sources, locations, people, observations, interpolations] =
    await Promise.all([
      readJson<DatasetManifest>("manifest.json"),
      readJson<EraRecord[]>("eras.json"),
      readJson<SourceRecord[]>("sources.json"),
      readJson<LocationRecord[]>("locations.json"),
      readJson<PersonRecord[]>("people.json"),
      readJson<TrajectoryObservation[]>("observations.json"),
      readJson<InterpolationRule[]>("interpolations.json"),
    ]);
  return { manifest, eras, sources, locations, people, observations, interpolations };
}

function insertDatabase(
  database: DatabaseSync,
  raw: RawHistoryDataset,
  annual: AnnualHistoryDataset,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`INSERT INTO dataset_manifest VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      raw.manifest.id,
      raw.manifest.version,
      raw.manifest.title,
      raw.manifest.startYear,
      raw.manifest.endYear,
      raw.manifest.historicalYearConvention,
      raw.manifest.selectionPolicy,
    );
    const insertEra = database.prepare(`INSERT INTO eras VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const era of raw.eras) {
      insertEra.run(era.id, era.label, era.startYear, era.endYear, era.order,
        era.targetPeople, era.coverageNote);
    }
    const insertSource = database.prepare(`INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const source of raw.sources) {
      insertSource.run(source.id, source.title, source.creator, source.publisher,
        source.locator, source.url, source.sourceType, source.accessedAt);
    }
    const insertLocation = database.prepare(`INSERT INTO locations VALUES (?, ?, ?, ?, ?, ?)`);
    for (const location of raw.locations) {
      insertLocation.run(location.id, location.label, location.position[0], location.position[1],
        location.uncertainty, location.note);
    }
    const insertPerson = database.prepare(`INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertAlias = database.prepare(`INSERT INTO person_aliases VALUES (?, ?)`);
    const insertPersonSource = database.prepare(`INSERT INTO person_sources VALUES (?, ?)`);
    for (const person of raw.people) {
      insertPerson.run(person.id, person.canonicalName, person.eraId, person.birthYear,
        person.deathYear, person.trajectoryStartYear, person.trajectoryEndYear,
        person.chronologyStatus, JSON.stringify(person.domains), person.selectionReason,
        person.visualWeight);
      for (const alias of person.aliases) insertAlias.run(person.id, alias);
      for (const sourceId of person.sourceRefs) insertPersonSource.run(person.id, sourceId);
    }
    const insertObservation = database.prepare(`INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertObservationSource = database.prepare(`INSERT INTO observation_sources VALUES (?, ?)`);
    for (const observation of raw.observations) {
      insertObservation.run(observation.id, observation.personId, observation.startYear,
        observation.endYear, observation.locationId, observation.summary,
        observation.evidenceStatus);
      for (const sourceId of observation.sourceRefs) {
        insertObservationSource.run(observation.id, sourceId);
      }
    }
    const insertInterpolation = database.prepare(`INSERT INTO interpolation_rules VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const rule of raw.interpolations) {
      insertInterpolation.run(rule.id, rule.personId, rule.fromObservationId,
        rule.toObservationId, rule.startYear, rule.endYear, rule.method,
        rule.uncertainty, rule.note);
    }
    const insertPersonYear = database.prepare(`INSERT INTO person_years VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const personYear of annual.personYears) {
      insertPersonYear.run(personYear.id, personYear.personId, personYear.historicalYear,
        personYear.yearIndex, personYear.lifeState, personYear.location?.locationId ?? null,
        personYear.location?.position[0] ?? null, personYear.location?.position[1] ?? null,
        personYear.derivation, JSON.stringify(personYear.observationRefs),
        personYear.interpolationRuleId, personYear.uncertainty);
    }
    const insertSlice = database.prepare(`INSERT INTO year_slices VALUES (?, ?, ?, ?)`);
    const insertMember = database.prepare(`INSERT INTO year_slice_members VALUES (?, ?)`);
    for (const slice of annual.yearSlices) {
      insertSlice.run(slice.historicalYear, slice.yearIndex, slice.coverage, slice.datasetVersion);
      for (const personYearId of slice.personYearIds) insertMember.run(slice.yearIndex, personYearId);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function auditDatabase(database: DatabaseSync, annual: AnnualHistoryDataset): void {
  const foreignKeyIssues = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyIssues.length > 0) throw new Error("SQLite foreign key audit failed");
  const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (integrity.integrity_check !== "ok") throw new Error(`SQLite integrity check: ${integrity.integrity_check}`);
  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM people) AS people,
      (SELECT COUNT(*) FROM person_years) AS person_years,
      (SELECT COUNT(*) FROM year_slices) AS year_slices,
      (SELECT COUNT(*) FROM year_slices WHERE historical_year = 0) AS zero_years
  `).get() as { people: number; person_years: number; year_slices: number; zero_years: number };
  if (counts.people !== annual.manifest.personCount
    || counts.person_years !== annual.manifest.personYearCount
    || counts.year_slices !== annual.manifest.yearCount
    || counts.zero_years !== 0) {
    throw new Error(`SQLite count audit failed: ${JSON.stringify(counts)}`);
  }
}

async function expectedArtifacts(raw: RawHistoryDataset, annual: AnnualHistoryDataset) {
  const runtime = {
    manifest: annual.manifest,
    eras: annual.eras,
    locations: annual.locations,
    people: annual.people,
    personYears: annual.personYears,
  };
  const personIndex = new Map(annual.people.map((person, index) => [person.id, index]));
  const renderData = {
    manifest: {
      version: annual.manifest.version,
      personCount: annual.manifest.personCount,
      personYearCount: annual.manifest.personYearCount,
    },
    people: annual.people.map((person) => ({
      id: person.id,
      domain: person.domains[0] ?? "culture",
      visualWeight: person.visualWeight,
    })),
    personYears: annual.personYears.map((record) => [
      personIndex.get(record.personId),
      record.historicalYear,
      record.yearIndex,
      record.location?.position[0] ?? null,
      record.location?.position[1] ?? null,
      record.uncertainty,
    ]),
  };
  const slices = {
    datasetVersion: annual.manifest.version,
    startYear: annual.manifest.startYear,
    endYear: annual.manifest.endYear,
    yearSlices: annual.yearSlices,
  };
  const eraCoverage = annual.eras.map((era) => ({
    eraId: era.id,
    label: era.label,
    targetPeople: era.targetPeople,
    actualPeople: annual.people.filter((person) => person.eraId === era.id).length,
  }));
  const sourceText = canonicalJson(raw);
  const runtimeText = canonicalJson(runtime);
  const renderDataText = canonicalJson(renderData);
  const slicesText = canonicalJson(slices);
  const reportText = canonicalJson({
    datasetVersion: annual.manifest.version,
    sourceDigest: digest(sourceText),
    runtimeDigest: digest(runtimeText),
    renderDataDigest: digest(renderDataText),
    yearSlicesDigest: digest(slicesText),
    sourceCount: raw.sources.length,
    observationCount: raw.observations.length,
    interpolationCount: raw.interpolations.length,
    personCount: annual.manifest.personCount,
    personYearCount: annual.manifest.personYearCount,
    yearSliceCount: annual.manifest.yearCount,
    emptySliceCount: annual.yearSlices.filter((slice) => slice.coverage === "empty").length,
    eraCoverage,
  });
  return new Map([
    ["annual-person-years.json", runtimeText],
    ["render-data.json", renderDataText],
    ["year-slices.json", slicesText],
    ["build-report.json", reportText],
  ]);
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const raw = await loadRawDataset();
  const annual = materializeAnnualHistoryDataset(raw);
  await mkdir(buildRoot, { recursive: true });
  const databasePath = resolve(buildRoot, "history.sqlite");
  await rm(databasePath, { force: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(await readFile(migrationPath, "utf8"));
    insertDatabase(database, raw, annual);
    auditDatabase(database, annual);
  } finally {
    database.close();
  }

  const artifacts = await expectedArtifacts(raw, annual);
  await mkdir(generatedRoot, { recursive: true });
  for (const [name, expected] of artifacts) {
    const path = resolve(generatedRoot, name);
    if (checkOnly) {
      let actual = "";
      try {
        actual = await readFile(path, "utf8");
      } catch {
        throw new Error(`Missing generated artifact ${name}; run npm run data:build`);
      }
      if (actual !== expected) {
        throw new Error(`Generated artifact ${name} is stale; run npm run data:build`);
      }
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, expected);
    }
  }
  const action = checkOnly ? "verified" : "built";
  process.stdout.write(
    `History data ${action}: ${annual.manifest.personCount} people, `
    + `${annual.manifest.personYearCount} person-years, ${annual.manifest.yearCount} year slices.\n`,
  );
}

await main();
