/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  RiverCameraControls,
  resolveRiverDragMode,
} from "../src/lib/viewport/river-camera-controls.ts";

class FakeWindow extends EventTarget {}

class FakeDocument extends EventTarget {
  readonly defaultView = new FakeWindow();
}

class FakeElement extends EventTarget {
  readonly style = { cursor: "", touchAction: "" };
  readonly ownerDocument: FakeDocument;
  readonly clientHeight = 1_000;
  private readonly capturedPointers = new Set<number>();

  constructor(ownerDocument: FakeDocument) {
    super();
    this.ownerDocument = ownerDocument;
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }
}

function inputEvent(type: string, properties: Record<string, unknown>): Event {
  const event = new Event(type, { cancelable: true });
  for (const [property, value] of Object.entries(properties)) {
    Object.defineProperty(event, property, { configurable: true, value });
  }
  return event;
}

function createFixture() {
  const ownerDocument = new FakeDocument();
  const element = new FakeElement(ownerDocument);
  const camera = new THREE.PerspectiveCamera(48, 1.6, 0.1, 1_600);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  const controls = new RiverCameraControls(
    camera,
    element as unknown as HTMLElement,
    { pivot: new THREE.Vector3(), focusDistance: 10 },
  );
  return { camera, controls, element, ownerDocument };
}

function assertVectorClose(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  epsilon = 1e-7,
): void {
  assert.ok(actual.distanceTo(expected) <= epsilon, `${actual.toArray()} != ${expected.toArray()}`);
}

test("maps single-mouse buttons to drag modes without keyboard or modifiers", () => {
  assert.equal(resolveRiverDragMode(0), "orbit");
  assert.equal(resolveRiverDragMode(1), "pan");
  assert.equal(resolveRiverDragMode(2), "pan");
  assert.equal(resolveRiverDragMode(3), "none");
  assert.equal(resolveRiverDragMode(-1), "none");
});

test("orbits around the pivot with damping and keeps the pivot centered", () => {
  const { camera, controls } = createFixture();
  const start = camera.position.clone();
  controls.applyDrag(120, -30, "orbit");
  assert.ok(camera.position.distanceTo(start) > 0.1);
  assert.ok(Math.abs(camera.position.distanceTo(controls.pivot) - 10) < 1e-7);
  const toPivot = controls.pivot.clone().sub(camera.position).normalize();
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(toPivot) > 0.999999);

  for (let step = 0; step < 600; step += 1) controls.update(1 / 60);
  const settled = camera.position.clone();
  controls.update(1 / 60);
  assertVectorClose(camera.position, settled, 1e-5);
  controls.dispose();
});

test("pans with right or middle drag without rotating the camera", () => {
  const { camera, controls } = createFixture();
  const rotation = camera.quaternion.clone();
  controls.applyDrag(40, -20, "pan");
  assert.ok(camera.position.x > 0);
  assert.ok(camera.position.y > 0);
  assert.ok(camera.quaternion.angleTo(rotation) < 1e-10);
  assertVectorClose(
    controls.pivot,
    new THREE.Vector3(camera.position.x, camera.position.y, 0),
  );
  controls.dispose();
});

test("dollies with the wheel inside clamped distance and returns via double-click", () => {
  const { camera, controls, element, ownerDocument } = createFixture();
  controls.applyWheel(-120);
  assert.ok(camera.position.distanceTo(controls.pivot) < 10);
  controls.applyWheel(4000);
  assert.ok(camera.position.distanceTo(controls.pivot) <= 700);
  controls.applyWheel(-4000);
  assert.ok(camera.position.distanceTo(controls.pivot) >= 3);

  controls.applyDrag(80, 20, "orbit");
  element.dispatchEvent(inputEvent("dblclick", { button: 0 }));
  assertVectorClose(controls.pivot, new THREE.Vector3());
  assert.ok(Math.abs(camera.position.distanceTo(controls.pivot) - 10) < 1e-7);
  controls.dispose();
  ownerDocument.dispatchEvent(new Event("blur"));
});

test("drives drags through pointer events and cleans up on dispose", () => {
  const { camera, controls, element, ownerDocument } = createFixture();
  element.dispatchEvent(inputEvent("pointerdown", {
    pointerType: "mouse",
    pointerId: 7,
    button: 0,
    buttons: 1,
  }));
  ownerDocument.dispatchEvent(inputEvent("pointermove", {
    pointerType: "mouse",
    pointerId: 7,
    movementX: 60,
    movementY: 0,
  }));
  assert.ok(camera.position.x < 0 || camera.position.z < 10);
  assert.equal(element.style.cursor, "grabbing");

  ownerDocument.dispatchEvent(inputEvent("pointerup", {
    pointerType: "mouse",
    pointerId: 7,
    button: 0,
    buttons: 0,
  }));
  assert.equal(element.style.cursor, "");

  controls.dispose();
  assert.equal(element.style.touchAction, "");
  const released = camera.position.clone();
  element.dispatchEvent(inputEvent("pointerdown", {
    pointerType: "mouse",
    pointerId: 8,
    button: 0,
    buttons: 1,
  }));
  ownerDocument.dispatchEvent(inputEvent("pointermove", {
    pointerType: "mouse",
    pointerId: 8,
    movementX: 60,
    movementY: 0,
  }));
  assertVectorClose(camera.position, released);
});
