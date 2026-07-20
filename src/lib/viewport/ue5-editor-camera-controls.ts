import * as THREE from "three";

export type UE5CameraGesture =
  | "none"
  | "look"
  | "dolly-yaw"
  | "pan"
  | "orbit"
  | "orbit-pan"
  | "orbit-dolly";

export interface UE5CameraMovementAxes {
  forward: number;
  right: number;
  worldUp: number;
  localUp: number;
  fieldOfView: number;
}

export interface UE5EditorCameraOptions {
  pivot: THREE.Vector3;
  focusDistance: number;
  initialSpeedLevel?: number;
  lookSensitivity?: number;
  minOrbitDistance?: number;
  maxOrbitDistance?: number;
}

const LEFT_BUTTON = 1;
const RIGHT_BUTTON = 2;
const MIDDLE_BUTTON = 4;
const SPEEDS = [4, 8, 16, 32, 64, 128, 256, 512] as const;
const MAX_PITCH = THREE.MathUtils.degToRad(89);

const keyGroups = {
  forward: ["KeyW", "Numpad8", "ArrowUp"],
  backward: ["KeyS", "Numpad2", "ArrowDown"],
  left: ["KeyA", "Numpad4", "ArrowLeft"],
  right: ["KeyD", "Numpad6", "ArrowRight"],
  worldUp: ["KeyE", "Numpad9", "PageUp"],
  worldDown: ["KeyQ", "Numpad7", "PageDown"],
  localUp: ["KeyR"],
  localDown: ["KeyF"],
  widerFov: ["KeyZ", "Numpad1"],
  narrowerFov: ["KeyC", "Numpad3"],
} as const;

const flightKeyCodes = new Set<string>(Object.values(keyGroups).flat());

function hasAnyKey(keys: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((code) => keys.has(code));
}

function keyAxis(
  keys: ReadonlySet<string>,
  positive: readonly string[],
  negative: readonly string[],
): number {
  return Number(hasAnyKey(keys, positive)) - Number(hasAnyKey(keys, negative));
}

export function resolveUE5CameraGesture(
  buttons: number,
  altKey: boolean,
): UE5CameraGesture {
  if (altKey) {
    if (buttons & LEFT_BUTTON) return "orbit";
    if (buttons & MIDDLE_BUTTON) return "orbit-pan";
    if (buttons & RIGHT_BUTTON) return "orbit-dolly";
  }
  if ((buttons & (LEFT_BUTTON | RIGHT_BUTTON)) === (LEFT_BUTTON | RIGHT_BUTTON)) {
    return "pan";
  }
  if (buttons & MIDDLE_BUTTON) return "pan";
  if (buttons & RIGHT_BUTTON) return "look";
  if (buttons & LEFT_BUTTON) return "dolly-yaw";
  return "none";
}

export function resolveUE5CameraMovement(
  keys: ReadonlySet<string>,
): UE5CameraMovementAxes {
  return {
    forward: keyAxis(keys, keyGroups.forward, keyGroups.backward),
    right: keyAxis(keys, keyGroups.right, keyGroups.left),
    worldUp: keyAxis(keys, keyGroups.worldUp, keyGroups.worldDown),
    localUp: keyAxis(keys, keyGroups.localUp, keyGroups.localDown),
    fieldOfView: keyAxis(keys, keyGroups.widerFov, keyGroups.narrowerFov),
  };
}

/**
 * UE5 perspective-viewport navigation for one Three.js camera.
 *
 * This controller intentionally knows nothing about scene objects, picking, or
 * product state. Its only semantic target is the supplied artwork pivot.
 */
export class UE5EditorCameraControls {
  readonly pivot: THREE.Vector3;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly element: HTMLElement;
  private readonly focusTarget: THREE.Vector3;
  private readonly keys = new Set<string>();
  private readonly ownerDocument: Document;
  private readonly ownerWindow: (Window & typeof globalThis) | null;
  private readonly lookSensitivity: number;
  private readonly minOrbitDistance: number;
  private readonly maxOrbitDistance: number;
  private readonly focusDistance: number;
  private readonly originalCursor: string;
  private readonly originalTouchAction: string;
  private readonly originalTabIndex: string | null;
  private buttons = 0;
  private activePointerId: number | null = null;
  private speedLevel: number;
  private orbitDistance: number;
  private pointerLocked = false;
  private disposed = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    options: UE5EditorCameraOptions,
  ) {
    this.camera = camera;
    this.element = element;
    this.pivot = options.pivot.clone();
    this.focusTarget = options.pivot.clone();
    this.focusDistance = options.focusDistance;
    this.lookSensitivity = options.lookSensitivity ?? 0.0022;
    this.minOrbitDistance = options.minOrbitDistance ?? 1;
    this.maxOrbitDistance = options.maxOrbitDistance ?? 1_200;
    this.speedLevel = THREE.MathUtils.clamp(
      options.initialSpeedLevel ?? 4,
      0,
      SPEEDS.length - 1,
    );
    this.orbitDistance = Math.max(
      this.minOrbitDistance,
      this.camera.position.distanceTo(this.pivot),
    );
    this.ownerDocument = element.ownerDocument;
    this.ownerWindow = this.ownerDocument.defaultView;
    this.originalCursor = element.style.cursor;
    this.originalTouchAction = element.style.touchAction;
    this.originalTabIndex = element.getAttribute("tabindex");

    element.tabIndex = 0;
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("contextmenu", this.onContextMenu);
    element.addEventListener("keydown", this.onKeyDown);
    element.addEventListener("keyup", this.onKeyUp);
    element.addEventListener("blur", this.onElementBlur);
    this.ownerDocument.addEventListener("mousemove", this.onMouseMove);
    this.ownerDocument.addEventListener("pointerup", this.onPointerUp);
    this.ownerDocument.addEventListener("pointercancel", this.onPointerUp);
    this.ownerDocument.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.ownerWindow?.addEventListener("blur", this.onWindowBlur);
  }

  get movementSpeed(): number {
    return SPEEDS[this.speedLevel];
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !(this.buttons & RIGHT_BUTTON)) return;
    const delta = THREE.MathUtils.clamp(deltaSeconds, 0, 0.05);
    const axes = resolveUE5CameraMovement(this.keys);

    if (axes.fieldOfView !== 0) {
      this.camera.fov = THREE.MathUtils.clamp(
        this.camera.fov + axes.fieldOfView * 35 * delta,
        20,
        100,
      );
      this.camera.updateProjectionMatrix();
    }

    const movement = new THREE.Vector3();
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    movement.addScaledVector(forward, axes.forward);
    movement.addScaledVector(right, axes.right);
    movement.y += axes.worldUp;
    movement.addScaledVector(localUp, axes.localUp);
    if (movement.lengthSq() === 0) return;

    const accelerated = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    movement.normalize().multiplyScalar(this.movementSpeed * (accelerated ? 4 : 1) * delta);
    this.translateCameraAndPivot(movement);
  }

  applyDrag(
    deltaX: number,
    deltaY: number,
    buttons = this.buttons,
    altKey = false,
  ): void {
    switch (resolveUE5CameraGesture(buttons, altKey)) {
      case "look":
        this.look(deltaX, deltaY);
        break;
      case "dolly-yaw":
        this.look(deltaX, 0);
        this.translateAlongView(-deltaY * this.worldUnitsPerPixel());
        break;
      case "pan":
      case "orbit-pan":
        this.pan(deltaX, deltaY);
        break;
      case "orbit":
        this.orbit(deltaX, deltaY);
        break;
      case "orbit-dolly":
        this.dollyAroundPivot(deltaX);
        break;
      case "none":
        break;
    }
  }

  applyWheel(deltaY: number, adjustSpeed = false): void {
    if (deltaY === 0) return;
    const direction = Math.sign(deltaY);
    if (adjustSpeed) {
      this.speedLevel = THREE.MathUtils.clamp(
        this.speedLevel - direction,
        0,
        SPEEDS.length - 1,
      );
      return;
    }
    this.translateAlongView(-direction * this.movementSpeed * 0.35);
  }

  focusArtwork(): void {
    this.focusTargetAt(this.focusTarget, this.focusDistance);
  }

  focusTargetAt(target: THREE.Vector3, distance: number): void {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const clampedDistance = THREE.MathUtils.clamp(
      distance,
      this.minOrbitDistance,
      this.maxOrbitDistance,
    );
    this.pivot.copy(target);
    this.camera.position.copy(this.pivot).addScaledVector(forward, -clampedDistance);
    this.camera.lookAt(this.pivot);
    this.orbitDistance = clampedDistance;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("wheel", this.onWheel);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    this.element.removeEventListener("keydown", this.onKeyDown);
    this.element.removeEventListener("keyup", this.onKeyUp);
    this.element.removeEventListener("blur", this.onElementBlur);
    this.ownerDocument.removeEventListener("mousemove", this.onMouseMove);
    this.ownerDocument.removeEventListener("pointerup", this.onPointerUp);
    this.ownerDocument.removeEventListener("pointercancel", this.onPointerUp);
    this.ownerDocument.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.ownerWindow?.removeEventListener("blur", this.onWindowBlur);
    this.endGesture();
    this.element.style.cursor = this.originalCursor;
    this.element.style.touchAction = this.originalTouchAction;
    if (this.originalTabIndex === null) this.element.removeAttribute("tabindex");
    else this.element.setAttribute("tabindex", this.originalTabIndex);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || this.disposed) return;
    this.buttons = event.buttons;
    this.activePointerId = event.pointerId;
    this.element.focus({ preventScroll: true });
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer Lock still provides unbounded motion when capture is unavailable.
    }
    if (event.button === 2 && event.buttons === RIGHT_BUTTON && !event.altKey) {
      this.requestPointerLock();
    }
    this.updateCursor(event.altKey);
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    this.buttons = event.buttons;
    if (this.buttons === 0) this.endGesture();
    else this.updateCursor(event.altKey);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.disposed || this.buttons === 0) return;
    if (event.buttons !== 0) this.buttons = event.buttons;
    this.applyDrag(event.movementX, event.movementY, this.buttons, event.altKey);
    this.updateCursor(event.altKey);
    event.preventDefault();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    this.applyWheel(event.deltaY, Boolean(this.buttons & RIGHT_BUTTON));
    event.preventDefault();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.buttons & RIGHT_BUTTON) {
      if (flightKeyCodes.has(event.code) || event.code.startsWith("Shift")) {
        this.keys.add(event.code);
        event.preventDefault();
      }
      return;
    }
    if (event.code === "KeyF" && !event.repeat) {
      this.focusArtwork();
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.keys.delete(event.code)) event.preventDefault();
  };

  private readonly onElementBlur = (): void => {
    if (!this.pointerLocked) this.keys.clear();
  };

  private readonly onWindowBlur = (): void => {
    this.endGesture();
  };

  private readonly onPointerLockChange = (): void => {
    const isLocked = this.ownerDocument.pointerLockElement === this.element;
    if (this.pointerLocked && !isLocked) this.endGesture(false);
    this.pointerLocked = isLocked;
    if (isLocked) this.element.style.cursor = "none";
  };

  private requestPointerLock(): void {
    if (!this.element.requestPointerLock || this.ownerDocument.pointerLockElement) return;
    try {
      const request = this.element.requestPointerLock();
      if (request) void request.catch(() => undefined);
    } catch {
      // Pointer capture remains as the bounded-drag fallback.
    }
  }

  private endGesture(exitPointerLock = true): void {
    this.buttons = 0;
    this.keys.clear();
    if (this.activePointerId !== null) {
      try {
        if (this.element.hasPointerCapture(this.activePointerId)) {
          this.element.releasePointerCapture(this.activePointerId);
        }
      } catch {
        // The browser may have released capture before this cleanup runs.
      }
      this.activePointerId = null;
    }
    if (exitPointerLock && this.ownerDocument.pointerLockElement === this.element) {
      this.ownerDocument.exitPointerLock();
    }
    this.element.style.cursor = this.originalCursor;
  }

  private updateCursor(altKey: boolean): void {
    const gesture = resolveUE5CameraGesture(this.buttons, altKey);
    this.element.style.cursor = gesture === "look" ? "none" : "grabbing";
  }

  private look(deltaX: number, deltaY: number): void {
    const rotation = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    rotation.y -= deltaX * this.lookSensitivity;
    rotation.x = THREE.MathUtils.clamp(
      rotation.x - deltaY * this.lookSensitivity,
      -MAX_PITCH,
      MAX_PITCH,
    );
    rotation.z = 0;
    this.camera.quaternion.setFromEuler(rotation);
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    this.pivot.copy(this.camera.position).addScaledVector(forward, this.orbitDistance);
  }

  private pan(deltaX: number, deltaY: number): void {
    const scale = this.worldUnitsPerPixel();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const movement = right.multiplyScalar(deltaX * scale)
      .add(localUp.multiplyScalar(-deltaY * scale));
    this.translateCameraAndPivot(movement);
  }

  private orbit(deltaX: number, deltaY: number): void {
    const offset = this.camera.position.clone().sub(this.pivot);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaX * this.lookSensitivity;
    spherical.phi -= deltaY * this.lookSensitivity;
    spherical.makeSafe();
    this.camera.position.copy(this.pivot).add(offset.setFromSpherical(spherical));
    this.camera.lookAt(this.pivot);
    this.orbitDistance = spherical.radius;
  }

  private dollyAroundPivot(deltaX: number): void {
    const offset = this.camera.position.clone().sub(this.pivot);
    const distance = THREE.MathUtils.clamp(
      offset.length() * Math.exp(deltaX * 0.01),
      this.minOrbitDistance,
      this.maxOrbitDistance,
    );
    if (offset.lengthSq() === 0) offset.set(0, 0, 1);
    this.camera.position.copy(this.pivot).add(offset.normalize().multiplyScalar(distance));
    this.camera.lookAt(this.pivot);
    this.orbitDistance = distance;
  }

  private translateAlongView(distance: number): void {
    const movement = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(distance);
    this.translateCameraAndPivot(movement);
  }

  private translateCameraAndPivot(movement: THREE.Vector3): void {
    this.camera.position.add(movement);
    this.pivot.add(movement);
  }

  private worldUnitsPerPixel(): number {
    const viewportHeight = Math.max(this.element.clientHeight, 1);
    return (
      2
      * Math.max(this.orbitDistance, this.minOrbitDistance)
      * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
      / viewportHeight
    );
  }
}
