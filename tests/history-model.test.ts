import assert from "node:assert/strict";
import test from "node:test";

import {
  createLifePath,
  createObservationWindow,
  guideStateAtSeconds,
  historicalYearToY,
  personPositionAt,
  prototypeFixture,
  validateFixture,
} from "../lib/history/model.ts";

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
