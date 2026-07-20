/// <reference types="node" />

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildGeographyVolume,
  geographyContourAt,
  geographyKeyframes,
  geographyProfileAt,
} from "../src/lib/history/geography-volume.ts";
import {
  buildPersonThreadGeometry,
  historicalYearCount,
  historicalYears,
  historicalYearToIndex,
  historicalYearToY,
  isHistoricalYear,
  materializeAnnualHistoryDataset,
  nextHistoricalYear,
  validateRawHistoryDataset,
  yearIndexToHistoricalYear,
  type DatasetManifest,
  type EraRecord,
  type InterpolationRule,
  type LocationRecord,
  type PersonRecord,
  type RawHistoryDataset,
  type SourceRecord,
  type TrajectoryObservation,
} from "../src/lib/history/model.ts";
import { OceanFlowField } from "../src/lib/history/ocean-flow-field.ts";

const sourceRoot = new URL("../data/history/source/", import.meta.url);

async function json<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, sourceRoot), "utf8")) as T;
}

const rawDataset: RawHistoryDataset = {
  manifest: await json<DatasetManifest>("manifest.json"),
  eras: await json<EraRecord[]>("eras.json"),
  sources: await json<SourceRecord[]>("sources.json"),
  locations: await json<LocationRecord[]>("locations.json"),
  people: await json<PersonRecord[]>("people.json"),
  observations: await json<TrajectoryObservation[]>("observations.json"),
  interpolations: await json<InterpolationRule[]>("interpolations.json"),
};

const annualDataset = materializeAnnualHistoryDataset(rawDataset);

test("M2 source data satisfies the annual person trajectory contract", () => {
  assert.deepEqual(validateRawHistoryDataset(rawDataset), []);
  assert.equal(rawDataset.eras.length, 11);
  assert.equal(rawDataset.people.length, 44);
  for (const era of rawDataset.eras) {
    assert.equal(
      rawDataset.people.filter((person) => person.eraId === era.id).length,
      4,
      era.id,
    );
  }
});

test("historical time rejects year zero and round-trips every valid year", () => {
  assert.equal(isHistoricalYear(0), false);
  assert.equal(isHistoricalYear(-1), true);
  assert.equal(isHistoricalYear(1), true);
  assert.throws(() => historicalYearToIndex(0), /non-zero integer/);
  assert.equal(historicalYearCount(-2700, 1949), 4649);
  const years = historicalYears(-2700, 1949);
  assert.equal(years.length, 4649);
  assert.equal(years.includes(0), false);
  for (let index = 0; index < years.length; index += 1) {
    assert.equal(historicalYearToIndex(years[index]), index);
    assert.equal(yearIndexToHistoricalYear(index), years[index]);
  }
  assert.equal(nextHistoricalYear(-1), 1);
});

test("older years project higher on the shared geometry axis", () => {
  assert.ok(historicalYearToY(-2700) > historicalYearToY(-515));
  assert.ok(historicalYearToY(-515) > historicalYearToY(1949));
  assert.equal(historicalYearToY(1949), 0);
});

test("materialization creates one and only one slice for all 4,649 years", () => {
  assert.equal(annualDataset.yearSlices.length, 4649);
  assert.equal(annualDataset.yearSlices[0].historicalYear, -2700);
  assert.equal(annualDataset.yearSlices.at(-1)?.historicalYear, 1949);
  assert.equal(annualDataset.yearSlices.some((slice) => slice.historicalYear === 0), false);
  assert.equal(
    new Set(annualDataset.yearSlices.map((slice) => slice.yearIndex)).size,
    annualDataset.yearSlices.length,
  );
});

test("person-to-year and year-to-person indexes form the same membership set", () => {
  const membershipsFromPeople = new Set(
    annualDataset.personYears.map((personYear) =>
      `${personYear.yearIndex}:${personYear.id}`),
  );
  const membershipsFromSlices = new Set(
    annualDataset.yearSlices.flatMap((slice) =>
      slice.personYearIds.map((personYearId) => `${slice.yearIndex}:${personYearId}`)),
  );
  assert.deepEqual(membershipsFromSlices, membershipsFromPeople);
});

test("a life crossing BCE and CE remains index-contiguous without a fabricated year zero", () => {
  const trajectory = annualDataset.personYears
    .filter((personYear) => personYear.personId === "wang-zhaojun")
    .sort((a, b) => a.yearIndex - b.yearIndex);
  assert.equal(trajectory[0].historicalYear, -54);
  assert.equal(trajectory.at(-1)?.historicalYear, 19);
  assert.equal(trajectory.some((personYear) => personYear.historicalYear === 0), false);
  for (let index = 1; index < trajectory.length; index += 1) {
    assert.equal(trajectory[index].yearIndex, trajectory[index - 1].yearIndex + 1);
  }
});

test("missing locations remain unknown instead of becoming precise annual routes", () => {
  const confucius = annualDataset.personYears
    .filter((personYear) => personYear.personId === "confucius");
  const attested = confucius.find((personYear) => personYear.historicalYear === -500);
  const unknown = confucius.find((personYear) => personYear.historicalYear === -499);
  assert.equal(attested?.derivation, "attested");
  assert.equal(attested?.location?.locationId, "shandong");
  assert.equal(unknown?.derivation, "unknown");
  assert.equal(unknown?.location, null);
  assert.deepEqual(unknown?.observationRefs, []);
});

test("interpolation is opt-in, versioned, and keeps both endpoint observations", () => {
  const fixture = structuredClone(rawDataset);
  fixture.observations.push({
    id: "obs-confucius-central-test",
    personId: "confucius",
    startYear: -490,
    endYear: -490,
    locationId: "central-plains",
    summary: "test endpoint",
    evidenceStatus: "corroborated",
    sourceRefs: ["shiji-kongzi"],
  });
  fixture.interpolations.push({
    id: "rule-confucius-test",
    personId: "confucius",
    fromObservationId: "obs-confucius-shandong",
    toObservationId: "obs-confucius-central-test",
    startYear: -499,
    endYear: -491,
    method: "linear",
    uncertainty: 0.7,
    note: "test-only explicit interpolation",
  });
  const materialized = materializeAnnualHistoryDataset(fixture);
  const midpoint = materialized.personYears.find((personYear) =>
    personYear.personId === "confucius" && personYear.historicalYear === -495);
  assert.equal(midpoint?.derivation, "interpolated");
  assert.equal(midpoint?.interpolationRuleId, "rule-confucius-test");
  assert.deepEqual(midpoint?.observationRefs, [
    "obs-confucius-shandong",
    "obs-confucius-central-test",
  ]);
  assert.equal(midpoint?.uncertainty, 0.7);
});

test("dangling sources and overlapping located observations fail validation", () => {
  const missingSource = structuredClone(rawDataset);
  missingSource.people[0].sourceRefs = ["missing-source"];
  assert.ok(validateRawHistoryDataset(missingSource)
    .some((issue) => issue.includes("missing source")));

  const overlap = structuredClone(rawDataset);
  overlap.observations.push({
    ...overlap.observations.find((item) => item.personId === "confucius")!,
    id: "overlapping-observation",
    locationId: "central-plains",
  });
  assert.ok(validateRawHistoryDataset(overlap)
    .some((issue) => issue.includes("overlapping located observations")));
});

test("annual materialization is deterministic", () => {
  assert.deepEqual(
    materializeAnnualHistoryDataset(structuredClone(rawDataset)),
    annualDataset,
  );
});

test("person thread geometry keeps person and year identity on every data vertex", () => {
  const geometry = buildPersonThreadGeometry(annualDataset);
  assert.equal(geometry.ranges.length, annualDataset.people.length);
  assert.equal(geometry.positions.length, geometry.segmentCount * 2 * 3);
  assert.equal(geometry.colors.length, geometry.positions.length);
  assert.equal(geometry.alpha.length, geometry.segmentCount * 2);
  assert.equal(geometry.personIndices.length, geometry.alpha.length);
  assert.equal(geometry.yearIndices.length, geometry.alpha.length);
  assert.ok(geometry.ranges.every((range) => range.segmentCount > 0));
  for (let vertex = 0; vertex < geometry.alpha.length; vertex += 1) {
    assert.ok(geometry.personIndices[vertex] >= 0);
    assert.ok(geometry.personIndices[vertex] < annualDataset.people.length);
    assert.ok(Number.isInteger(geometry.yearIndices[vertex]));
    assert.ok(geometry.alpha[vertex] > 0 && geometry.alpha[vertex] <= 1);
  }
});

test("geography keyframes span the work and remain chronologically ordered", () => {
  assert.equal(geographyKeyframes[0].year, -2700);
  assert.equal(geographyKeyframes.at(-1)?.year, 1949);
  for (let index = 1; index < geographyKeyframes.length; index += 1) {
    assert.ok(geographyKeyframes[index].year > geographyKeyframes[index - 1].year);
  }
  assert.ok(geographyKeyframes.every((keyframe) => keyframe.prototypeOnly));
});

test("annual geography profiles interpolate smoothly between source keyframes", () => {
  const before = geographyProfileAt(-516);
  const current = geographyProfileAt(-515);
  const after = geographyProfileAt(-514);
  for (const key of Object.keys(current.weights) as Array<keyof typeof current.weights>) {
    assert.ok(Math.abs(current.weights[key] - before.weights[key]) < 0.01, key);
    assert.ok(Math.abs(after.weights[key] - current.weights[key]) < 0.01, key);
  }
});

test("every requested year produces a closed abstract geography contour", () => {
  const early = geographyContourAt(-2700, 48);
  const later = geographyContourAt(618, 48);
  assert.equal(early.length, 48);
  assert.equal(later.length, 48);
  assert.ok(early.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)));
  assert.ok(later.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)));
  const radialExtent = (contour: ReadonlyArray<readonly [number, number]>) =>
    Math.max(...contour.map(([x, z]) => Math.hypot(x, z)));
  assert.ok(radialExtent(later) > radialExtent(early));
});

test("adjacent annual contours stay continuous with no per-year jumps", () => {
  const samples = 48;
  for (const baseYear of [-2000, -770, -221, 618, 1271, 1911]) {
    const current = geographyContourAt(baseYear, samples);
    const next = geographyContourAt(nextHistoricalYear(baseYear), samples);
    let maxShift = 0;
    for (let index = 0; index < samples; index += 1) {
      maxShift = Math.max(
        maxShift,
        Math.hypot(next[index][0] - current[index][0], next[index][1] - current[index][1]),
      );
    }
    assert.ok(maxShift < 0.25, `year ${baseYear} shift ${maxShift}`);
  }
});

test("geography volume carries uncertainty and skips year zero", () => {
  const volume = buildGeographyVolume({
    startYear: -3,
    endYear: 3,
    contourSamples: 24,
    longitudinalStride: 4,
  });
  assert.equal(volume.annualSliceCount, 6);
  assert.equal(volume.sliceSegmentCount, 6 * 24);
  assert.equal(volume.slicePositions.length, volume.sliceSegmentCount * 2 * 3);
  assert.equal(volume.sliceYears[0], -3);
  assert.equal(volume.sliceYears.at(-1), 3);
  assert.equal(Array.from(volume.sliceYears).includes(0), false);
  assert.equal(volume.sliceUncertainty.length, volume.sliceYears.length);
  for (let vertex = 0; vertex < volume.sliceUncertainty.length; vertex += 1) {
    const value = volume.sliceUncertainty[vertex];
    assert.ok(value >= 0 && value <= 1);
    const expected = geographyProfileAt(volume.sliceYears[vertex]).uncertainty;
    assert.ok(Math.abs(value - expected) < 1e-6);
  }
});

const oceanField = new OceanFlowField({
  bounds: { minX: -514, maxX: 526, minZ: -360, maxZ: 440 },
  columns: 161,
  rows: 129,
  mouthX: 6,
  mouthZ: 4,
  seed: 1729,
});

test("ocean flow field stores a normalized vector and density at every cell", () => {
  assert.equal(oceanField.potential.length, 161 * 129);
  assert.equal(oceanField.velocity.length, 161 * 129 * 2);
  assert.equal(oceanField.density.length, 161 * 129);
  for (const [x, z] of [[6, 4], [-194, 80], [206, 80]] as const) {
    const sample = oceanField.sample(x, z);
    assert.ok(Math.abs(Math.hypot(sample.vx, sample.vz) - 1) < 1e-6);
    assert.ok(sample.density >= 0.5 && sample.density <= 1);
  }
});

test("ocean field opens the estuary before joining lateral currents", () => {
  const center = oceanField.sample(6, 4);
  const leftMouth = oceanField.sample(-26, 12);
  const rightMouth = oceanField.sample(38, 12);
  const leftSea = oceanField.sample(-194, 80);
  const rightSea = oceanField.sample(206, 80);
  assert.ok(center.vz > 0.95);
  assert.ok(leftMouth.vx < -0.5 && leftMouth.vz > 0.5);
  assert.ok(rightMouth.vx > 0.5 && rightMouth.vz > 0.5);
  assert.ok(leftSea.vx < -0.95);
  assert.ok(rightSea.vx > 0.95);
});

test("ocean streamlines remain bounded and follow the sampled field", () => {
  const path = oceanField.trace(38, 12, { maxDistance: 220, step: 3.6 });
  assert.ok(path.length > 50);
  assert.ok(path.at(-1)!.x > 220);
  assert.ok(path.every((point) => oceanField.contains(point.x, point.z)));
  for (let index = 0; index < path.length - 1; index += 8) {
    const point = path[index];
    const next = path[index + 1];
    const sample = oceanField.sample(point.x, point.z);
    const segmentLength = Math.hypot(next.x - point.x, next.z - point.z);
    const alignment = (
      (next.x - point.x) * sample.vx + (next.z - point.z) * sample.vz
    ) / segmentLength;
    assert.ok(alignment > 0.99);
  }
});

test("ocean flow field generation is deterministic for a fixed seed", () => {
  const duplicate = new OceanFlowField({
    bounds: { minX: -514, maxX: 526, minZ: -360, maxZ: 440 },
    columns: 161,
    rows: 129,
    mouthX: 6,
    mouthZ: 4,
    seed: 1729,
  });
  assert.deepEqual(duplicate.potential, oceanField.potential);
  assert.deepEqual(duplicate.velocity, oceanField.velocity);
  assert.deepEqual(duplicate.density, oceanField.density);
  assert.deepEqual(
    duplicate.trace(38, 12, { maxDistance: 220, step: 3.6 }),
    oceanField.trace(38, 12, { maxDistance: 220, step: 3.6 }),
  );
});
