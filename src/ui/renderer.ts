// Canvas 2D renderer. It only reads World state; it never mutates it.

import { VISION_RAYS } from '../sim/config.ts';
import type { World } from '../sim/world.ts';

export interface RenderOptions {
  showHeatmap: boolean;
  showRays: boolean;
  selectedSlot: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  // The food grid is tiny (60×40). We paint it into an offscreen canvas at 1 px per cell
  // and let drawImage's bilinear smoothing scale it up: a soft heatmap for almost no cost.
  private readonly heatCanvas: HTMLCanvasElement;
  private readonly heatCtx: CanvasRenderingContext2D;
  private heatImage: ImageData;
  /** World units → canvas pixels. */
  scale = 1;

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.heatCanvas = document.createElement('canvas');
    const hctx = this.heatCanvas.getContext('2d');
    if (!hctx) throw new Error('Canvas 2D not supported');
    this.heatCtx = hctx;
    this.heatImage = hctx.createImageData(1, 1);
    this.attach(world);
  }

  /** (Re)bind to a world, e.g. after reset or load, since grid size may change. */
  attach(world: World): void {
    this.heatCanvas.width = world.food.cols;
    this.heatCanvas.height = world.food.rows;
    this.heatImage = this.heatCtx.createImageData(world.food.cols, world.food.rows);
    this.resize(world);
  }

  /** Fit the canvas to its container while keeping the world's aspect ratio. */
  resize(world: World): void {
    const parent = this.canvas.parentElement;
    const availW = parent ? parent.clientWidth : 1200;
    const availH = parent ? parent.clientHeight : 800;
    const s = Math.max(0.1, Math.min(availW / world.cfg.worldWidth, availH / world.cfg.worldHeight));
    const dpr = window.devicePixelRatio || 1;
    this.scale = s * dpr;
    this.canvas.width = Math.round(world.cfg.worldWidth * this.scale);
    this.canvas.height = Math.round(world.cfg.worldHeight * this.scale);
    this.canvas.style.width = `${Math.round(world.cfg.worldWidth * s)}px`;
    this.canvas.style.height = `${Math.round(world.cfg.worldHeight * s)}px`;
  }

  draw(world: World, opts: RenderOptions): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07090a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (opts.showHeatmap) this.drawHeatmap(world);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.drawCreatures(world, opts);
  }

  private drawHeatmap(world: World): void {
    const { food, fertility } = world.food;
    const data = this.heatImage.data;
    const max = world.cfg.foodMax;
    for (let i = 0; i < food.length; i++) {
      const t = Math.min(1, food[i] / max);
      const f = fertility[i];
      // Dark soil tinted by fertility, green by current plant energy.
      const o = i * 4;
      data[o] = 18 + 22 * f;
      data[o + 1] = 16 + 14 * f + 150 * t;
      data[o + 2] = 14 + 40 * t;
      data[o + 3] = 255;
    }
    this.heatCtx.putImageData(this.heatImage, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(this.heatCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  private drawCreatures(world: World, opts: RenderOptions): void {
    const ctx = this.ctx;
    const p = world.pool;
    const r = world.cfg.bodyRadius;

    if (opts.showRays) this.drawAllRays(world);

    // Bucket creatures by quantised colour so we issue ~40 fills instead of one per
    // creature: changing fillStyle and filling is the expensive part of Canvas 2D.
    const buckets: number[][] = this.buckets;
    for (const b of buckets) b.length = 0;
    for (let s = 0; s < p.capacity; s++) {
      if (!p.alive[s]) continue;
      const d = Math.min(DIET_STEPS - 1, Math.floor(p.diet[s] * DIET_STEPS));
      const e = Math.max(0, Math.min(ENERGY_STEPS - 1, Math.floor((p.energy[s] / p.maxEnergy[s]) * ENERGY_STEPS)));
      buckets[d * ENERGY_STEPS + e].push(s);
    }
    for (let b = 0; b < buckets.length; b++) {
      const list = buckets[b];
      if (list.length === 0) continue;
      ctx.fillStyle = this.styles[b];
      ctx.beginPath();
      for (const s of list) {
        const size = p.size[s] * r;
        const h = p.heading[s];
        const c = Math.cos(h);
        const sn = Math.sin(h);
        const x = p.x[s];
        const y = p.y[s];
        // Long nose along the heading, two short rear corners: direction reads at a glance.
        ctx.moveTo(x + c * size * 1.6, y + sn * size * 1.6);
        ctx.lineTo(x - c * size + sn * size * 0.9, y - sn * size - c * size * 0.9);
        ctx.lineTo(x - c * size - sn * size * 0.9, y - sn * size + c * size * 0.9);
        ctx.closePath();
      }
      ctx.fill();
    }

    const sel = opts.selectedSlot;
    if (sel >= 0 && p.alive[sel]) {
      this.drawRays(world, sel, 'rgba(255,255,255,0.7)');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / this.scale;
      ctx.beginPath();
      ctx.arc(p.x[sel], p.y[sel], p.size[sel] * r * 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawAllRays(world: World): void {
    const ctx = this.ctx;
    const p = world.pool;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    for (let s = 0; s < p.capacity; s++) if (p.alive[s]) this.rayPath(world, s);
    ctx.stroke();
  }

  private drawRays(world: World, s: number, style: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = style;
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    this.rayPath(world, s);
    ctx.stroke();
  }

  /** Add the creature's vision rays (evenly spread across its FOV) to the current path. */
  private rayPath(world: World, s: number): void {
    const p = world.pool;
    const ctx = this.ctx;
    const n = VISION_RAYS;
    const fov = p.fov[s];
    const range = p.visionRange[s];
    for (let k = 0; k < n; k++) {
      const a = p.heading[s] - fov / 2 + (fov * (k + 0.5)) / n;
      ctx.moveTo(p.x[s], p.y[s]);
      ctx.lineTo(p.x[s] + Math.cos(a) * range, p.y[s] + Math.sin(a) * range);
    }
  }

  private readonly buckets: number[][] = Array.from({ length: DIET_STEPS * ENERGY_STEPS }, () => []);
  private readonly styles: string[] = buildStyles();
}

const DIET_STEPS = 10;
const ENERGY_STEPS = 4;

/** Hue runs green (herbivore) → red (carnivore); lightness rises with stored energy. */
function buildStyles(): string[] {
  const out: string[] = [];
  for (let d = 0; d < DIET_STEPS; d++) {
    for (let e = 0; e < ENERGY_STEPS; e++) {
      const hue = 120 * (1 - (d + 0.5) / DIET_STEPS);
      const light = 30 + 40 * ((e + 0.5) / ENERGY_STEPS);
      out.push(`hsl(${hue.toFixed(0)}, 85%, ${light.toFixed(0)}%)`);
    }
  }
  return out;
}

/** Colour for one creature (used by the inspector to match the map). */
export function creatureColor(diet: number, energyFrac: number): string {
  const hue = 120 * (1 - diet);
  const light = 30 + 40 * Math.max(0, Math.min(1, energyFrac));
  return `hsl(${hue.toFixed(0)}, 85%, ${light.toFixed(0)}%)`;
}
