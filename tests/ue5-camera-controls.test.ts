/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  UE5EditorCameraControls,
  resolveUE5CameraGesture,
  resolveUE5CameraMovement,
} from "../src/lib/viewport/ue5-editor-camera-controls.ts";

class FakeWindow extends EventTarget {}

class FakeDocument extends EventTarget {
  readonly defaultView = new FakeWindow();
  pointerLockElement: FakeElement | null = null;

  exitPointerLock(): void {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event("pointerlockchange"));
  }
}

class FakeElement extends EventTarget {
  readonly style = { cursor: "", touchAction: "" };
  readonly ownerDocument: FakeDocument;
  readonly clientHeight = 1_000;
  tabIndex = -1;
  private readonly attributes = new Map<string, string>();
  private readonly capturedPointers = new Set<number>();

  constructor(ownerDocument: FakeDocument) {
    super();
    this.ownerDocument = ownerDocument;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  focus(): void {}

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }

  async requestPointerLock(): Promise<void> {
    this.ownerDocument.pointerLockElement = this;
    this.ownerDocument.dispatchEvent(new Event("pointerlockchange"));
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
  const controls = new UE5EditorCameraControls(
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

test("maps UE5 perspective viewport mouse gestures without object interaction", () => {
  assert.equal(resolveUE5CameraGesture(2, false), "look");
  assert.equal(resolveUE5CameraGesture(1, false), "dolly-yaw");
  assert.equal(resolveUE5CameraGesture(4, false), "pan");
  assert.equal(resolveUE5CameraGesture(3, false), "pan");
  assert.equal(resolveUE5CameraGesture(1, true), "orbit");
  assert.equal(resolveUE5CameraGesture(4, true), "orbit-pan");
  assert.equal(resolveUE5CameraGesture(2, true), "orbit-dolly");
  assert.equal(resolveUE5CameraGesture(0, false), "none");
});

test("maps UE5 flight aliases, global/local lift, and FOV controls", () => {
  assert.deepEqual(resolveUE5CameraMovement(new Set(["KeyW", "KeyD", "KeyE"])), {
    forward: 1,
    right: 1,
    worldUp: 1,
    localUp: 0,
    fieldOfView: 0,
  });
  assert.deepEqual(
    resolveUE5CameraMovement(new Set(["Numpad2", "ArrowLeft", "PageDown", "KeyF", "KeyC"])),
    { forward: -1, right: -1, worldUp: -1, localUp: -1, fieldOfView: -1 },
  );
  assert.equal(resolveUE5CameraMovement(new Set(["KeyW", "KeyS"])).forward, 0);
});

test("supports look, pan, pivot orbit, pivot dolly, wheel travel, and artwork focus", () => {
  const look = createFixture();
  const beforeLook = look.camera.getWorldDirection(new THREE.Vector3());
  look.controls.applyDrag(80, -40, 2, false);
  const afterLook = look.camera.getWorldDirection(new THREE.Vector3());
  assert.ok(afterLook.x > beforeLook.x);
  assert.ok(afterLook.y > beforeLook.y);
  look.controls.dispose();

  const pan = createFixture();
  const panRotation = pan.camera.quaternion.clone();
  pan.controls.applyDrag(40, -20, 4, false);
  assert.ok(pan.camera.position.x > 0);
  assert.ok(pan.camera.position.y > 0);
  assert.ok(pan.camera.quaternion.angleTo(panRotation) < 1e-10);
  pan.controls.dispose();

  const orbit = createFixture();
  const orbitStart = orbit.camera.position.clone();
  orbit.controls.applyDrag(100, -30, 1, true);
  assert.ok(orbit.camera.position.distanceTo(orbitStart) > 0.1);
  assert.ok(Math.abs(orbit.camera.position.distanceTo(orbit.controls.pivot) - 10) < 1e-7);
  const toPivot = orbit.controls.pivot.clone().sub(orbit.camera.position).normalize();
  assert.ok(orbit.camera.getWorldDirection(new THREE.Vector3()).dot(toPivot) > 0.999999);
  orbit.controls.applyDrag(20, 0, 2, true);
  assert.ok(orbit.camera.position.distanceTo(orbit.controls.pivot) > 10);
  orbit.controls.dispose();

  const wheel = createFixture();
  const initialOffset = wheel.camera.position.clone().sub(wheel.controls.pivot);
  wheel.controls.applyWheel(-100);
  assertVectorClose(wheel.camera.position.clone().sub(wheel.controls.pivot), initialOffset);
  assert.equal(wheel.controls.movementSpeed, 64);
  wheel.controls.applyWheel(-100, true);
  assert.equal(wheel.controls.movementSpeed, 128);
  wheel.controls.focusArtwork();
  assertVectorClose(wheel.controls.pivot, new THREE.Vector3());
  assert.ok(Math.abs(wheel.camera.position.distanceTo(wheel.controls.pivot) - 10) < 1e-7);
  wheel.controls.dispose();
});

test("flies only while RMB is held and releases Pointer Lock and listeners", () => {
  const { camera, controls, element, ownerDocument } = createFixture();
  element.dispatchEvent(inputEvent("pointerdown", {
    pointerType: "mouse",
    pointerId: 1,
    button: 2,
    buttons: 2,
    altKey: false,
  }));
  assert.equal(ownerDocument.pointerLockElement, element);

  element.dispatchEvent(inputEvent("keydown", {
    code: "KeyW",
    repeat: false,
  }));
  controls.update(0.05);
  assert.ok(camera.position.z < 10);

  ownerDocument.dispatchEvent(inputEvent("pointerup", {
    pointerType: "mouse",
    pointerId: 1,
    button: 2,
    buttons: 0,
    altKey: false,
  }));
  assert.equal(ownerDocument.pointerLockElement, null);
  const releasedPosition = camera.position.clone();
  controls.update(0.05);
  assertVectorClose(camera.position, releasedPosition);

  controls.dispose();
  assert.equal(element.getAttribute("tabindex"), null);
  assert.equal(element.style.touchAction, "");
  element.dispatchEvent(inputEvent("keydown", { code: "KeyF", repeat: false }));
  assertVectorClose(camera.position, releasedPosition);
});
