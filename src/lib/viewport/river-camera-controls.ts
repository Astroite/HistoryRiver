import * as THREE from "three";

export type RiverDragMode = "orbit" | "pan" | "none";

/**
 * Mouse-only drag mapping for the artwork viewport: left button orbits the
 * pivot, middle/right button pans. No keyboard, pointer lock, or modifiers.
 */
export function resolveRiverDragMode(button: number): RiverDragMode {
  if (button === 0) return "orbit";
  if (button === 1 || button === 2) return "pan";
  return "none";
}

export interface RiverCameraControlsOptions {
  pivot: THREE.Vector3;
  focusDistance: number;
  minDistance?: number;
  maxDistance?: number;
  rotateSpeed?: number;
}

const MIN_POLAR = 0.06;
const MAX_POLAR = Math.PI - 0.06;

/**
 * Single-mouse camera navigation for the history river artwork: drag to orbit,
 * right/middle drag to pan, wheel to dolly, double-click to return to the
 * whole-artwork view. The controller knows nothing about scene objects or
 * product state; its only semantic target is the supplied artwork pivot.
 */
export class RiverCameraControls {
  readonly pivot: THREE.Vector3;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly element: HTMLElement;
  private readonly focusTarget: THREE.Vector3;
  private readonly focusDistance: number;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly rotateSpeed: number;
  private readonly ownerDocument: Document;
  private readonly ownerWindow: (Window & typeof globalThis) | null;
  private readonly originalCursor: string;
  private readonly originalTouchAction: string;
  private activePointerId: number | null = null;
  private dragMode: RiverDragMode = "none";
  private orbitVelocity = { theta: 0, phi: 0 };
  private disposed = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    options: RiverCameraControlsOptions,
  ) {
    this.camera = camera;
    this.element = element;
    this.pivot = options.pivot.clone();
    this.focusTarget = options.pivot.clone();
    this.focusDistance = options.focusDistance;
    this.minDistance = options.minDistance ?? 3;
    this.maxDistance = options.maxDistance ?? 700;
    this.rotateSpeed = options.rotateSpeed ?? 0.0052;
    this.ownerDocument = element.ownerDocument;
    this.ownerWindow = this.ownerDocument.defaultView;
    this.originalCursor = element.style.cursor;
    this.originalTouchAction = element.style.touchAction;

    element.style.touchAction = "none";
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("dblclick", this.onDoubleClick);
    element.addEventListener("contextmenu", this.onContextMenu);
    this.ownerDocument.addEventListener("pointermove", this.onPointerMove);
    this.ownerDocument.addEventListener("pointerup", this.onPointerUp);
    this.ownerDocument.addEventListener("pointercancel", this.onPointerUp);
    this.ownerWindow?.addEventListener("blur", this.onWindowBlur);
  }

  get distance(): number {
    return this.camera.position.distanceTo(this.pivot);
  }

  /** Applies orbit inertia after the drag ends. */
  update(deltaSeconds: number): void {
    if (this.disposed || this.dragMode !== "none") return;
    const delta = THREE.MathUtils.clamp(deltaSeconds, 0, 0.05);
    const { theta, phi } = this.orbitVelocity;
    if (Math.abs(theta) < 1e-4 && Math.abs(phi) < 1e-4) return;
    this.orbitByRadians(theta * delta * 60, phi * delta * 60);
    const decay = Math.exp(-delta * 5.2);
    this.orbitVelocity.theta *= decay;
    this.orbitVelocity.phi *= decay;
  }

  applyDrag(deltaX: number, deltaY: number, mode: RiverDragMode = this.dragMode): void {
    if (mode === "orbit") {
      this.orbitByRadians(deltaX * this.rotateSpeed, deltaY * this.rotateSpeed);
      this.orbitVelocity.theta = deltaX * this.rotateSpeed;
      this.orbitVelocity.phi = deltaY * this.rotateSpeed;
    } else if (mode === "pan") {
      this.pan(deltaX, deltaY);
      this.orbitVelocity.theta = 0;
      this.orbitVelocity.phi = 0;
    }
  }

  applyWheel(deltaY: number): void {
    if (deltaY === 0 || this.disposed) return;
    const offset = this.camera.position.clone().sub(this.pivot);
    const distance = THREE.MathUtils.clamp(
      offset.length() * Math.exp(deltaY * 0.0011),
      this.minDistance,
      this.maxDistance,
    );
    if (offset.lengthSq() === 0) offset.set(0, 0, 1);
    this.camera.position.copy(this.pivot).add(offset.normalize().multiplyScalar(distance));
    this.camera.lookAt(this.pivot);
  }

  focusArtwork(): void {
    this.focusTargetAt(this.focusTarget, this.focusDistance);
  }

  focusTargetAt(target: THREE.Vector3, distance: number): void {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const clampedDistance = THREE.MathUtils.clamp(
      distance,
      this.minDistance,
      this.maxDistance,
    );
    this.pivot.copy(target);
    this.camera.position.copy(this.pivot).addScaledVector(forward, -clampedDistance);
    this.camera.lookAt(this.pivot);
    this.orbitVelocity.theta = 0;
    this.orbitVelocity.phi = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("wheel", this.onWheel);
    this.element.removeEventListener("dblclick", this.onDoubleClick);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    this.ownerDocument.removeEventListener("pointermove", this.onPointerMove);
    this.ownerDocument.removeEventListener("pointerup", this.onPointerUp);
    this.ownerDocument.removeEventListener("pointercancel", this.onPointerUp);
    this.ownerWindow?.removeEventListener("blur", this.onWindowBlur);
    this.endDrag();
    this.element.style.cursor = this.originalCursor;
    this.element.style.touchAction = this.originalTouchAction;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") {
      if (event.pointerType === "touch" && event.button !== 0) return;
    }
    if (this.disposed || this.activePointerId !== null) return;
    const mode = resolveRiverDragMode(event.button);
    if (mode === "none") return;
    this.dragMode = mode;
    this.activePointerId = event.pointerId;
    this.orbitVelocity.theta = 0;
    this.orbitVelocity.phi = 0;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a convenience, not a requirement.
    }
    this.element.style.cursor = "grabbing";
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.disposed || this.activePointerId !== event.pointerId || this.dragMode === "none") {
      return;
    }
    this.applyDrag(event.movementX, event.movementY);
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) return;
    this.endDrag();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    this.applyWheel(event.deltaY);
    event.preventDefault();
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.focusArtwork();
    event.preventDefault();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onWindowBlur = (): void => {
    this.endDrag();
  };

  private endDrag(): void {
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
    this.dragMode = "none";
    this.element.style.cursor = this.originalCursor;
  }

  private orbitByRadians(theta: number, phi: number): void {
    const offset = this.camera.position.clone().sub(this.pivot);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= theta;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - phi, MIN_POLAR, MAX_POLAR);
    spherical.makeSafe();
    this.camera.position.copy(this.pivot).add(offset.setFromSpherical(spherical));
    this.camera.lookAt(this.pivot);
  }

  private pan(deltaX: number, deltaY: number): void {
    const scale = this.worldUnitsPerPixel();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const movement = right.multiplyScalar(deltaX * scale)
      .add(localUp.multiplyScalar(-deltaY * scale));
    this.camera.position.add(movement);
    this.pivot.add(movement);
  }

  private worldUnitsPerPixel(): number {
    const viewportHeight = Math.max(this.element.clientHeight, 1);
    return (
      2
      * Math.max(this.distance, this.minDistance)
      * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
      / viewportHeight
    );
  }
}
