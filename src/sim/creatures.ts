// Structure-of-arrays creature storage. Each field is its own typed array indexed by slot,
// so the hot loops walk contiguous memory and there is zero per-creature allocation or GC.
// A slot is either alive or on the free list; free slots are reused LIFO, which is
// deterministic, so the same seed always assigns the same creature to the same slot.

import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_OUTPUTS } from './config.ts';
import { GENOME_LENGTH } from './genome.ts';

/** Floats of brain activation stored per creature: inputs, hidden, outputs. */
export const ACT_STRIDE = BRAIN_INPUTS + BRAIN_HIDDEN + BRAIN_OUTPUTS;
export const ACT_HIDDEN = BRAIN_INPUTS;
export const ACT_OUTPUT = BRAIN_INPUTS + BRAIN_HIDDEN;

/** Names of per-slot Float64 fields, used by (de)serialisation so nothing is forgotten. */
export const FLOAT_FIELDS = [
  'x',
  'y',
  'heading',
  'speed',
  'energy',
  'age',
  'attackTimer',
  'reproTimer',
] as const;
/** Names of per-slot Int32 fields. */
export const INT_FIELDS = ['id', 'parentId', 'generation', 'lineage', 'children', 'kills'] as const;

export type FloatField = (typeof FLOAT_FIELDS)[number];
export type IntField = (typeof INT_FIELDS)[number];

export class CreaturePool {
  readonly capacity: number;
  count = 0;

  readonly alive: Uint8Array;

  // Dynamic state (serialised).
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Radians; 0 = +x. */
  readonly heading: Float64Array;
  /** Scalar speed along the heading, units/tick. */
  readonly speed: Float64Array;
  readonly energy: Float64Array;
  readonly age: Float64Array;
  /** Ticks until the creature may attack again. */
  readonly attackTimer: Float64Array;
  /** Ticks until the creature may reproduce again. */
  readonly reproTimer: Float64Array;
  readonly id: Int32Array;
  readonly parentId: Int32Array;
  readonly generation: Int32Array;
  /** Lineage id: inherited, but a large mutation founds a new lineage. */
  readonly lineage: Int32Array;
  readonly children: Int32Array;
  readonly kills: Int32Array;
  /** capacity × GENOME_LENGTH. */
  readonly genomes: Float32Array;
  /** capacity × ACT_STRIDE: last tick's inputs, hidden and outputs (for the inspector). */
  readonly act: Float32Array;

  // Derived state: recomputed from the genome at birth (never serialised).
  readonly size: Float64Array;
  readonly maxSpeed: Float64Array;
  readonly visionRange: Float64Array;
  readonly fov: Float64Array;
  readonly metabolism: Float64Array;
  readonly diet: Float64Array;
  readonly reproThreshold: Float64Array;
  readonly maxEnergy: Float64Array;
  /** Energy burned per tick at rest. */
  readonly basalRate: Float64Array;
  /** Plant efficiency (1 − diet)^p and meat efficiency diet^p. */
  readonly plantEff: Float64Array;
  readonly meatEff: Float64Array;

  // Per-tick scratch (never serialised).
  /** Slot of the creature this one would attack this tick, or -1. */
  readonly target: Int32Array;

  /** Free slots, used as a stack. */
  private readonly free: Int32Array;
  private freeTop = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float64Array(capacity);
    const n = () => new Int32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.x = f();
    this.y = f();
    this.heading = f();
    this.speed = f();
    this.energy = f();
    this.age = f();
    this.attackTimer = f();
    this.reproTimer = f();
    this.id = n();
    this.parentId = n();
    this.generation = n();
    this.lineage = n();
    this.children = n();
    this.kills = n();
    this.genomes = new Float32Array(capacity * GENOME_LENGTH);
    this.act = new Float32Array(capacity * ACT_STRIDE);
    this.size = f();
    this.maxSpeed = f();
    this.visionRange = f();
    this.fov = f();
    this.metabolism = f();
    this.diet = f();
    this.reproThreshold = f();
    this.maxEnergy = f();
    this.basalRate = f();
    this.plantEff = f();
    this.meatEff = f();
    this.target = n();
    this.free = new Int32Array(capacity);
    this.resetFreeList();
  }

  /** Mark every slot free; slot 0 will be handed out first. */
  resetFreeList(): void {
    this.alive.fill(0);
    this.count = 0;
    this.freeTop = 0;
    for (let i = this.capacity - 1; i >= 0; i--) this.free[this.freeTop++] = i;
  }

  get isFull(): boolean {
    return this.freeTop === 0;
  }

  /** Take a free slot (or -1 if full). Caller must fill in all fields. */
  allocate(): number {
    if (this.freeTop === 0) return -1;
    const slot = this.free[--this.freeTop];
    this.alive[slot] = 1;
    this.count++;
    return slot;
  }

  release(slot: number): void {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.count--;
    this.free[this.freeTop++] = slot;
  }

  /** Snapshot of the free-list stack, bottom to top (part of the deterministic state). */
  freeList(): number[] {
    return Array.from(this.free.subarray(0, this.freeTop));
  }

  restoreFreeList(list: readonly number[]): void {
    this.freeTop = list.length;
    this.free.set(list);
  }

  genomeView(slot: number): Float32Array {
    return this.genomes.subarray(slot * GENOME_LENGTH, (slot + 1) * GENOME_LENGTH);
  }
}
