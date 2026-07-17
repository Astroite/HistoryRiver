import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeographyVolume,
  geographyContourAt,
  geographyKeyframes,
  geographyProfileAt,
} from "../src/lib/history/geography-volume.ts";
import { OceanFlowField } from "../src/lib/history/ocean-flow-field.ts";
import {
  activeCurveAt,
  buildFigureThreads,
  createLifePath,
  createObservationWindow,
  geoRegions,
  guideStateAtSeconds,
  historicalYearToY,
  influenceAt,
  personPositionAt,
  prototypeFixture,
  themeColorFor,
  validateFixture,
} from "../src/lib/history/model.ts";

test("prototype fixture has stable identities and valid references", () => {
  assert.deepEqual(validateFixture(), []);
  assert.equal(prototypeFixture.persons.length, 16);
  assert.ok(prototypeFixture.persons.every((person) => person.prototypeOnly));
});

test("older years project higher on the shared time axis", () => {
  assert.ok(historicalYearToY(-2700) > historicalYearToY(-515));
  assert.ok(historicalYearToY(-515) > historicalYearToY(1949));
});

test("observation window remains twenty years wide", () => {
  const window = createObservationWindow(-515);
  assert.equal(window.endYear - window.startYear, 20);
  assert.equal(window.focusYear, -515);
});

test("curated event pulls participants toward its center", () => {
  const event = prototypeFixture.events[0];
  const person = prototypeFixture.persons.find(
    (candidate) => candidate.id === event.participantIds[0],
  );
  assert.ok(person);

  const atEvent = personPositionAt(person, event.year);
  const beforeEvent = personPositionAt(person, event.year - 7);
  const distance = (position: { x: number; z: number }) =>
    Math.hypot(position.x - event.center[0], position.z - event.center[1]);

  assert.ok(distance(atEvent) < distance(beforeEvent));
});

test("life path includes both endpoints and keeps the same person identity", () => {
  const person = prototypeFixture.persons[0];
  const path = createLifePath(person);
  assert.deepEqual(path[0], personPositionAt(person, person.birthYear));
  assert.deepEqual(path.at(-1), personPositionAt(person, person.deathYear));
});

test("the 75 second guide follows the frozen design contract", () => {
  assert.equal(guideStateAtSeconds(0), "river-overview");
  assert.equal(guideStateAtSeconds(25), "entering-window");
  assert.equal(guideStateAtSeconds(38), "slice");
  assert.equal(guideStateAtSeconds(50), "person-focus");
  assert.equal(guideStateAtSeconds(60), "relation-focus");
  assert.equal(guideStateAtSeconds(69), "river-overview");
});

test("active curve rises from birth to a mid-life peak and falls", () => {
  const birth = activeCurveAt(0);
  const peak = activeCurveAt(0.5);
  const death = activeCurveAt(1);
  assert.ok(peak > birth);
  assert.ok(peak > death);
  assert.ok(activeCurveAt(0.25) > birth && activeCurveAt(0.25) < peak);
  for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
    const value = activeCurveAt(progress);
    assert.ok(value >= 0 && value <= 1);
  }
});

test("influenceAt reuses the shared active curve", () => {
  const person = prototypeFixture.persons[0];
  const midYear = Math.round((person.birthYear + person.deathYear) / 2);
  const progress =
    (midYear - person.birthYear) / (person.deathYear - person.birthYear);
  const expected = person.influence.overall * activeCurveAt(progress);
  assert.ok(Math.abs(influenceAt(person, midYear, "overall") - expected) < 1e-9);
  assert.equal(influenceAt(person, person.birthYear - 1, "overall"), 0);
});

test("every person is anchored to a known abstract-China region", () => {
  for (const person of prototypeFixture.persons) {
    assert.ok(person.homeRegion in geoRegions, `home ${person.id}`);
    assert.ok(person.endRegion in geoRegions, `end ${person.id}`);
  }
});

test("theme colors are deterministic sRGB triples within the unit range", () => {
  for (const person of prototypeFixture.persons) {
    const color = themeColorFor(person);
    const again = themeColorFor(person);
    assert.equal(color.length, 3);
    assert.deepEqual(color, again);
    for (const channel of color) {
      assert.ok(channel >= 0 && channel <= 1);
    }
  }
});

test("figure thread geometry packs two vertices per sample with valid attributes", () => {
  const threads = buildFigureThreads(prototypeFixture, { stepYears: 1 });
  assert.equal(threads.personCount, prototypeFixture.persons.length);
  assert.equal(threads.positions.length, threads.vertexCount * 3);
  assert.equal(threads.baseInfluence.length, threads.vertexCount * 4);
  assert.equal(threads.themeColor.length, threads.vertexCount * 3);

  let totalCount = 0;
  for (const range of threads.ranges) {
    totalCount += range.count;
    assert.equal(range.count % 2, 0, `${range.id} has vertex pairs`);
  }
  assert.equal(totalCount, threads.vertexCount);

  for (let vertex = 0; vertex < threads.vertexCount; vertex += 1) {
    assert.ok(threads.activeCurve[vertex] >= 0 && threads.activeCurve[vertex] <= 1);
    assert.ok(threads.entityIds[vertex] >= 0 && threads.entityIds[vertex] < threads.personCount);
    assert.ok(threads.sides[vertex] === -1 || threads.sides[vertex] === 1);
  }
});

test("each figure thread starts at birth and ends at death on the shared time axis", () => {
  const threads = buildFigureThreads(prototypeFixture, { stepYears: 1 });
  for (const range of threads.ranges) {
    const person = prototypeFixture.persons[range.index];
    const firstY = threads.positions[range.start * 3 + 1];
    const lastVertex = range.start + range.count - 1;
    const lastY = threads.positions[lastVertex * 3 + 1];
    assert.ok(Math.abs(firstY - historicalYearToY(person.birthYear)) < 1e-3);
    assert.ok(Math.abs(lastY - historicalYearToY(person.deathYear)) < 1e-3);
  }
});

test("geography keyframes span the full work and remain chronologically ordered", () => {
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
  // 相邻年份轮廓必须逐点接近，才能稳定连成纵向纤维、不在镜头移动时跳变。
  for (const baseYear of [-2000, -770, -221, 618, 1271, 1911]) {
    const current = geographyContourAt(baseYear, samples);
    const next = geographyContourAt(baseYear + 1, samples);
    assert.equal(current.length, samples);
    assert.equal(next.length, samples);
    let maxShift = 0;
    for (let index = 0; index < samples; index += 1) {
      maxShift = Math.max(
        maxShift,
        Math.hypot(next[index][0] - current[index][0], next[index][1] - current[index][1]),
      );
    }
    assert.ok(maxShift < 0.25, `year ${baseYear}→${baseYear + 1} shift ${maxShift}`);
  }
});

test("volume geometry carries per-vertex uncertainty aligned with profiles", () => {
  const startYear = -2700;
  const endYear = -2680;
  const volume = buildGeographyVolume({
    startYear,
    endYear,
    contourSamples: 24,
    longitudinalStride: 4,
  });
  assert.equal(volume.sliceUncertainty.length, volume.sliceYears.length);
  assert.equal(
    volume.longitudinalUncertainty.length,
    volume.longitudinalYears.length,
  );
  for (let vertex = 0; vertex < volume.sliceUncertainty.length; vertex += 1) {
    const value = volume.sliceUncertainty[vertex];
    assert.ok(value >= 0 && value <= 1, `uncertainty in range: ${value}`);
    const expected = geographyProfileAt(volume.sliceYears[vertex]).uncertainty;
    assert.ok(Math.abs(value - expected) < 1e-6);
  }
  // 早期资料最稀疏：起始年份的不确定度应高于统一王朝时期。
  assert.ok(geographyProfileAt(startYear).uncertainty > geographyProfileAt(-221).uncertainty);
});

test("geography volume stacks exactly one horizontal contour per integer year", () => {
  const volume = buildGeographyVolume({
    startYear: -3,
    endYear: 3,
    contourSamples: 24,
    longitudinalStride: 4,
  });
  assert.equal(volume.annualSliceCount, 7);
  assert.equal(volume.sliceSegmentCount, 7 * 24);
  assert.equal(volume.slicePositions.length, volume.sliceSegmentCount * 2 * 3);
  assert.equal(volume.sliceYears[0], -3);
  assert.equal(volume.sliceYears.at(-1), 3);
  assert.ok(volume.longitudinalSegmentCount > 0);
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

test("ocean potential advances coherently along left, right, and distant currents", () => {
  const seeds = [
    [-26, 12],
    [38, 12],
    [-194, 80],
    [206, 80],
  ] as const;

  for (const [x, z] of seeds) {
    const path = oceanField.trace(x, z, { maxDistance: 260, step: 3.6 });
    assert.ok(path.length > 20);
    let advancingSteps = 0;
    for (let index = 0; index < path.length - 1; index += 1) {
      if (path[index + 1].potential >= path[index].potential - 0.02) {
        advancingSteps += 1;
      }
    }
    assert.ok(advancingSteps / (path.length - 1) >= 0.98);
    assert.ok(path.at(-1)!.potential > path[0].potential + 120);
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
