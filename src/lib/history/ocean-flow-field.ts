export interface OceanFlowBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface OceanFlowSample {
  vx: number;
  vz: number;
  density: number;
  potential: number;
}

export interface OceanFlowPoint {
  x: number;
  z: number;
  distance: number;
  density: number;
  potential: number;
}

export interface OceanFlowFieldOptions {
  bounds: OceanFlowBounds;
  columns: number;
  rows: number;
  mouthX: number;
  mouthZ: number;
  seed: number;
}

export interface TraceOptions {
  direction?: 1 | -1;
  maxDistance: number;
  step: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const bilinear = (
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  tx: number,
  tz: number,
) => {
  const top = topLeft * (1 - tx) + topRight * tx;
  const bottom = bottomLeft * (1 - tx) + bottomRight * tx;
  return top * (1 - tz) + bottom * tz;
};

function hash2(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 17.17) * 43758.5453;
  return value - Math.floor(value);
}

function smoothNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const top = hash2(x0, z0, seed) * (1 - sx) + hash2(x0 + 1, z0, seed) * sx;
  const bottom = hash2(x0, z0 + 1, seed) * (1 - sx)
    + hash2(x0 + 1, z0 + 1, seed) * sx;
  return top * (1 - sz) + bottom * sz;
}

/**
 * Static two-dimensional velocity field used by every ocean visual layer.
 * The vectors are the normalized gradient of a scalar potential, which keeps
 * neighboring streamlines ordered and prevents the random curls that read as roots.
 */
export class OceanFlowField {
  readonly bounds: OceanFlowBounds;
  readonly columns: number;
  readonly rows: number;
  readonly potential: Float32Array;
  readonly velocity: Float32Array;
  readonly density: Float32Array;

  private readonly cellWidth: number;
  private readonly cellDepth: number;

  constructor(options: OceanFlowFieldOptions) {
    const { bounds, columns, rows, mouthX, mouthZ, seed } = options;
    if (columns < 3 || rows < 3) {
      throw new Error("OceanFlowField requires at least a 3 x 3 grid");
    }
    this.bounds = bounds;
    this.columns = columns;
    this.rows = rows;
    this.cellWidth = (bounds.maxX - bounds.minX) / (columns - 1);
    this.cellDepth = (bounds.maxZ - bounds.minZ) / (rows - 1);
    this.potential = new Float32Array(columns * rows);
    this.velocity = new Float32Array(columns * rows * 2);
    this.density = new Float32Array(columns * rows);

    for (let row = 0; row < rows; row += 1) {
      const z = bounds.minZ + row * this.cellDepth;
      for (let column = 0; column < columns; column += 1) {
        const x = bounds.minX + column * this.cellWidth;
        const dx = x - mouthX;
        const dz = z - mouthZ;
        const sideward = Math.hypot(dx, 24);
        const estuaryForward = 38
          * Math.tanh(dz / 42)
          * Math.exp(-(dx * dx) / (92 * 92));
        const broadCurrent = 9.5 * Math.sin(x * 0.0105 + z * 0.0048 + seed * 0.17)
          + 6.5 * Math.sin(x * 0.0041 - z * 0.0108 + seed * 0.31)
          + 3.2 * Math.sin(x * 0.017 - z * 0.0035 + seed * 0.07);
        this.potential[this.index(column, row)] = sideward
          + dz * 0.085
          + estuaryForward
          + broadCurrent;
      }
    }

    for (let row = 0; row < rows; row += 1) {
      const z = bounds.minZ + row * this.cellDepth;
      for (let column = 0; column < columns; column += 1) {
        const x = bounds.minX + column * this.cellWidth;
        const left = this.potential[this.index(Math.max(0, column - 1), row)];
        const right = this.potential[this.index(Math.min(columns - 1, column + 1), row)];
        const back = this.potential[this.index(column, Math.max(0, row - 1))];
        const front = this.potential[this.index(column, Math.min(rows - 1, row + 1))];
        const xSpan = column === 0 || column === columns - 1
          ? this.cellWidth
          : this.cellWidth * 2;
        const zSpan = row === 0 || row === rows - 1
          ? this.cellDepth
          : this.cellDepth * 2;
        const gradientX = (right - left) / xSpan;
        const gradientZ = (front - back) / zSpan;
        const speed = Math.max(0.0001, Math.hypot(gradientX, gradientZ));
        const offset = this.index(column, row) * 2;
        this.velocity[offset] = gradientX / speed;
        this.velocity[offset + 1] = gradientZ / speed;

        const dx = (x - mouthX) / 116;
        const dz = (z - mouthZ) / 150;
        const mouthInfluence = Math.exp(-(dx * dx + dz * dz));
        const localVariation = smoothNoise(x * 0.018, z * 0.018, seed + 41);
        this.density[this.index(column, row)] = clamp(
          0.58 + mouthInfluence * 0.27 + localVariation * 0.2,
          0.5,
          1,
        );
      }
    }
  }

  contains(x: number, z: number, margin = 0): boolean {
    return x >= this.bounds.minX + margin
      && x <= this.bounds.maxX - margin
      && z >= this.bounds.minZ + margin
      && z <= this.bounds.maxZ - margin;
  }

  sample(x: number, z: number, target?: OceanFlowSample): OceanFlowSample {
    const gx = clamp(
      (x - this.bounds.minX) / this.cellWidth,
      0,
      this.columns - 1,
    );
    const gz = clamp(
      (z - this.bounds.minZ) / this.cellDepth,
      0,
      this.rows - 1,
    );
    const x0 = Math.min(this.columns - 2, Math.floor(gx));
    const z0 = Math.min(this.rows - 2, Math.floor(gz));
    const tx = gx - x0;
    const tz = gz - z0;
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const topLeft = this.index(x0, z0);
    const topRight = this.index(x1, z0);
    const bottomLeft = this.index(x0, z1);
    const bottomRight = this.index(x1, z1);
    const velocityX = bilinear(
      this.velocity[topLeft * 2],
      this.velocity[topRight * 2],
      this.velocity[bottomLeft * 2],
      this.velocity[bottomRight * 2],
      tx,
      tz,
    );
    const velocityZ = bilinear(
      this.velocity[topLeft * 2 + 1],
      this.velocity[topRight * 2 + 1],
      this.velocity[bottomLeft * 2 + 1],
      this.velocity[bottomRight * 2 + 1],
      tx,
      tz,
    );
    const speed = Math.max(0.0001, Math.hypot(velocityX, velocityZ));
    const result = target ?? { vx: 0, vz: 0, density: 0, potential: 0 };
    result.vx = velocityX / speed;
    result.vz = velocityZ / speed;
    result.density = bilinear(
      this.density[topLeft],
      this.density[topRight],
      this.density[bottomLeft],
      this.density[bottomRight],
      tx,
      tz,
    );
    result.potential = bilinear(
      this.potential[topLeft],
      this.potential[topRight],
      this.potential[bottomLeft],
      this.potential[bottomRight],
      tx,
      tz,
    );
    return result;
  }

  trace(seedX: number, seedZ: number, options: TraceOptions): OceanFlowPoint[] {
    const direction = options.direction ?? 1;
    const points: OceanFlowPoint[] = [];
    const sample = this.sample(seedX, seedZ);
    let x = seedX;
    let z = seedZ;
    let distance = 0;
    const midpoint = { vx: 0, vz: 0, density: 0, potential: 0 };
    points.push({ x, z, distance, density: sample.density, potential: sample.potential });

    while (distance < options.maxDistance) {
      const current = this.sample(x, z, sample);
      const remaining = options.maxDistance - distance;
      const step = Math.min(options.step, remaining);
      const midX = x + current.vx * direction * step * 0.5;
      const midZ = z + current.vz * direction * step * 0.5;
      this.sample(midX, midZ, midpoint);
      const nextX = x + midpoint.vx * direction * step;
      const nextZ = z + midpoint.vz * direction * step;
      if (!this.contains(nextX, nextZ, options.step * 0.5)) break;
      x = nextX;
      z = nextZ;
      distance += step;
      points.push({
        x,
        z,
        distance,
        density: midpoint.density,
        potential: midpoint.potential,
      });
    }
    return points;
  }

  private index(column: number, row: number): number {
    return row * this.columns + column;
  }
}
