// Uniform-grid spatial hash on the torus. Rebuilt from scratch every tick with a counting
// sort: O(n), no allocation, and items within a cell come out in slot order, so neighbour
// iteration order (and therefore the whole simulation) stays deterministic.
//
// Usage: after build(), the creatures in grid cell c are
//   cellItems[cellStart[c] .. cellStart[c+1])

export class SpatialHash {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
  /** Cell index of each slot from the last build (-1 for dead slots). */
  readonly slotCell: Int32Array;
  /** Scratch: next free position per cell while placing items. */
  private readonly cursor: Int32Array;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number, cellSize: number, capacity: number) {
    this.width = width;
    this.height = height;
    // Whole number of cells so the grid tiles the torus exactly.
    this.cols = Math.max(1, Math.floor(width / cellSize));
    this.rows = Math.max(1, Math.floor(height / cellSize));
    this.cellW = width / this.cols;
    this.cellH = height / this.rows;
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cellItems = new Int32Array(capacity);
    this.slotCell = new Int32Array(capacity);
    this.cursor = new Int32Array(this.cols * this.rows);
  }

  cellOf(x: number, y: number): number {
    let c = Math.floor(x / this.cellW);
    let r = Math.floor(y / this.cellH);
    if (c >= this.cols) c = this.cols - 1;
    if (r >= this.rows) r = this.rows - 1;
    return r * this.cols + c;
  }

  build(alive: Uint8Array, xs: Float64Array, ys: Float64Array): void {
    const start = this.cellStart;
    const slotCell = this.slotCell;
    start.fill(0);
    // Pass 1: count per cell (stored shifted by one so the prefix sum yields start offsets).
    for (let s = 0; s < alive.length; s++) {
      if (!alive[s]) {
        slotCell[s] = -1;
        continue;
      }
      const c = this.cellOf(xs[s], ys[s]);
      slotCell[s] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < this.cols * this.rows; c++) start[c + 1] += start[c];
    // Pass 2: place items at each cell's running write position.
    const cursor = this.cursor;
    cursor.set(start.subarray(0, this.cols * this.rows));
    for (let s = 0; s < alive.length; s++) {
      const c = slotCell[s];
      if (c < 0) continue;
      this.cellItems[cursor[c]++] = s;
    }
  }

  /**
   * Call `visit(slot)` for every item in the cells overlapping the square of half-size
   * `radius` around (x, y), wrapping across edges. Each cell is visited at most once even if
   * the radius exceeds half the world. Callers still need an exact distance check.
   */
  forEachNear(x: number, y: number, radius: number, visit: (slot: number) => void): void {
    const cols = this.cols;
    const rows = this.rows;
    let c0 = Math.floor((x - radius) / this.cellW);
    let c1 = Math.floor((x + radius) / this.cellW);
    let r0 = Math.floor((y - radius) / this.cellH);
    let r1 = Math.floor((y + radius) / this.cellH);
    if (c1 - c0 + 1 >= cols) {
      c0 = 0;
      c1 = cols - 1;
    }
    if (r1 - r0 + 1 >= rows) {
      r0 = 0;
      r1 = rows - 1;
    }
    for (let r = r0; r <= r1; r++) {
      const rr = ((r % rows) + rows) % rows;
      for (let c = c0; c <= c1; c++) {
        const cc = ((c % cols) + cols) % cols;
        const cell = rr * cols + cc;
        for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) visit(this.cellItems[k]);
      }
    }
  }

  get worldWidth(): number {
    return this.width;
  }

  get worldHeight(): number {
    return this.height;
  }
}
