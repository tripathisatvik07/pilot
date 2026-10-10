// Canvas 2D renderer. It only reads World state; it never mutates it.

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

  // Creatures are added in milestone 2.
  private drawCreatures(_world: World, _opts: RenderOptions): void {}
}
