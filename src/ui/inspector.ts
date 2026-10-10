// Creature inspector: identity, traits, live state and a diagram of its neural network with
// the activations from the last tick (node colour = activation, edge colour/width = weight).

import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_OUTPUTS, TRAITS, VISION_RAYS } from '../sim/config.ts';
import { ACT_STRIDE } from '../sim/creatures.ts';
import { B2_OFFSET, GENOME_LENGTH, W1_OFFSET, W2_OFFSET } from '../sim/genome.ts';
import type { World } from '../sim/world.ts';
import { creatureColor } from './renderer.ts';

const INPUT_LABELS: string[] = [];
for (let k = 0; k < VISION_RAYS; k++) INPUT_LABELS.push(`r${k} food`, `r${k} near`, `r${k} size`);
INPUT_LABELS.push('energy', 'speed', 'bias', 'osc');
const OUTPUT_LABELS = ['turn', 'thrust', 'eat/atk', 'repro'];

export class Inspector {
  private readonly root: HTMLElement;
  private readonly info: HTMLDivElement;
  private readonly nn: HTMLCanvasElement;
  private readonly nnCtx: CanvasRenderingContext2D;
  /** Creature id being followed (slots get reused, ids never are). */
  selectedId = -1;
  selectedSlot = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = '<h2>Inspector</h2>';
    this.info = document.createElement('div');
    this.info.innerHTML = '<p class="muted">Click a creature to inspect it.</p>';
    root.appendChild(this.info);
    this.nn = document.createElement('canvas');
    this.nn.className = 'nn';
    this.nn.style.height = '260px';
    this.nn.style.display = 'none';
    root.appendChild(this.nn);
    const ctx = this.nn.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.nnCtx = ctx;
  }

  select(world: World, slot: number): void {
    this.selectedSlot = slot;
    this.selectedId = slot >= 0 ? world.pool.id[slot] : -1;
    this.update(world);
  }

  /** Re-resolve the slot (it may have died) and redraw. */
  update(world: World): void {
    const p = world.pool;
    const s = this.selectedSlot;
    if (this.selectedId < 0) return;
    if (s < 0 || !p.alive[s] || p.id[s] !== this.selectedId) {
      this.info.innerHTML = `<p class="muted">Creature #${this.selectedId} has died. Click another.</p>`;
      this.nn.style.display = 'none';
      this.selectedSlot = -1;
      return;
    }
    const diet = p.diet[s];
    const kind = diet > world.cfg.carnivoreThreshold ? 'carnivore' : 'herbivore';
    const rows: [string, string][] = [
      ['id', `#${p.id[s]} <span style="color:${creatureColor(diet, p.energy[s] / p.maxEnergy[s])}">■</span> ${kind}`],
      ['parent', p.parentId[s] ? `#${p.parentId[s]}` : 'founder'],
      ['generation', String(p.generation[s])],
      ['lineage', `L${p.lineage[s]}`],
      ['age', `${p.age[s].toFixed(0)} / ${world.cfg.maxAge}`],
      ['energy', `${p.energy[s].toFixed(1)} / ${p.maxEnergy[s].toFixed(0)}`],
      ['speed', p.speed[s].toFixed(2)],
      ['children / kills', `${p.children[s]} / ${p.kills[s]}`],
      ['basal cost/tick', p.basalRate[s].toFixed(3)],
    ];
    const traitArrays = [p.size, p.maxSpeed, p.visionRange, p.fov, p.metabolism, p.diet, p.reproThreshold];
    TRAITS.forEach((t, i) => rows.push([t.label, traitArrays[i][s].toFixed(2)]));
    this.info.innerHTML = `<div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>`;
    this.nn.style.display = 'block';
    this.drawNet(world, s);
  }

  private drawNet(world: World, s: number): void {
    const c = this.nn;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, Math.round(c.clientWidth * dpr));
    const h = Math.max(50, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = this.nnCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = w / dpr;
    const H = h / dpr;
    ctx.clearRect(0, 0, W, H);

    const g = world.pool.genomes;
    const gOff = s * GENOME_LENGTH;
    const act = world.pool.act;
    const aOff = s * ACT_STRIDE;
    const layerX = [62, W * 0.5, W - 78];
    const yFor = (count: number, i: number) => 8 + ((H - 16) * (i + 0.5)) / count;

    // Edges first so nodes sit on top. Only draw strong-ish weights to keep it readable.
    const edge = (x0: number, y0: number, x1: number, y1: number, wgt: number) => {
      const a = Math.min(1, Math.abs(wgt) / 2);
      if (a < 0.12) return;
      ctx.strokeStyle = wgt > 0 ? `rgba(90,200,120,${a})` : `rgba(230,90,90,${a})`;
      ctx.lineWidth = 0.5 + a * 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    for (let hI = 0; hI < BRAIN_HIDDEN; hI++) {
      for (let i = 0; i < BRAIN_INPUTS; i++) {
        edge(layerX[0], yFor(BRAIN_INPUTS, i), layerX[1], yFor(BRAIN_HIDDEN, hI), g[gOff + W1_OFFSET + hI * BRAIN_INPUTS + i]);
      }
    }
    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      for (let hI = 0; hI < BRAIN_HIDDEN; hI++) {
        edge(layerX[1], yFor(BRAIN_HIDDEN, hI), layerX[2], yFor(BRAIN_OUTPUTS, o), g[gOff + W2_OFFSET + o * BRAIN_HIDDEN + hI]);
      }
    }

    // Nodes: fill colour encodes activation (-1 red … 0 grey … +1 green).
    const node = (x: number, y: number, v: number, r: number) => {
      const t = Math.max(-1, Math.min(1, v));
      const col = t >= 0 ? `rgb(${60 - 30 * t},${70 + 150 * t},${70 - 20 * t})` : `rgb(${70 - 160 * t},${70 + 20 * t},${70 + 20 * t})`;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#aab';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    };
    ctx.font = '9px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < BRAIN_INPUTS; i++) {
      const y = yFor(BRAIN_INPUTS, i);
      node(layerX[0], y, act[aOff + i], 4.5);
      ctx.fillStyle = '#8a97a3';
      ctx.textAlign = 'right';
      ctx.fillText(INPUT_LABELS[i], layerX[0] - 8, y);
    }
    for (let hI = 0; hI < BRAIN_HIDDEN; hI++) node(layerX[1], yFor(BRAIN_HIDDEN, hI), act[aOff + BRAIN_INPUTS + hI], 6);
    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      const y = yFor(BRAIN_OUTPUTS, o);
      const v = act[aOff + BRAIN_INPUTS + BRAIN_HIDDEN + o];
      node(layerX[2], y, v, 8);
      ctx.fillStyle = '#d6dde3';
      ctx.textAlign = 'left';
      ctx.fillText(OUTPUT_LABELS[o], layerX[2] + 11, y - 5);
      ctx.fillStyle = '#8a97a3';
      ctx.fillText(`${v >= 0 ? '+' : ''}${v.toFixed(2)} b${g[gOff + B2_OFFSET + o].toFixed(1)}`, layerX[2] + 11, y + 6);
    }
  }

  get element(): HTMLElement {
    return this.root;
  }
}
