import assert from "node:assert/strict";
import test from "node:test";

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
