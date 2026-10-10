// Tiny line-chart renderer on plain Canvas 2D (no chart library). Each chart draws one or more
// series that share an x axis (tick) and a y range computed from the visible data.

export interface Series {
  label: string;
  color: string;
  values: number[];
}

export interface ChartSpec {
  title: string;
  /** Fixed y range; omit for auto-scaling from the data. */
  yMin?: number;
  yMax?: number;
  /** Stack the series as filled areas (used for the herbivore/carnivore ratio). */
  stacked?: boolean;
  /** Format y-axis labels. */
  fmt?: (v: number) => string;
}

export class LineChart {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly spec: ChartSpec;

  constructor(parent: HTMLElement, spec: ChartSpec, height = 110) {
    this.spec = spec;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart';
    this.canvas.style.height = `${height}px`;
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
  }

  draw(ticks: number[], series: Series[]): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    // Match the backing store to the CSS size every draw so charts stay crisp on resize.
    const w = Math.max(50, Math.round(c.clientWidth * dpr));
    const h = Math.max(30, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = w / dpr;
    const H = h / dpr;
    ctx.clearRect(0, 0, W, H);

    const padL = 34;
    const padR = 6;
    ctx.font = '10px system-ui, sans-serif';
    // Legend goes beside the title if it fits, otherwise on its own row under it.
    const legendW = series.reduce((w, s) => w + ctx.measureText(s.label).width + 10, 0);
    const legendOwnRow = ctx.measureText(this.spec.title).width + legendW + 12 > W - padL - padR;
    const padT = legendOwnRow ? 28 : 16;
    const padB = 4;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n = ticks.length;
    const fmt = this.spec.fmt ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(2)));

    let lo = this.spec.yMin ?? Infinity;
    let hi = this.spec.yMax ?? -Infinity;
    if (this.spec.yMin === undefined || this.spec.yMax === undefined) {
      for (let i = 0; i < n; i++) {
        let stack = 0;
        for (const s of series) {
          const v = this.spec.stacked ? (stack += s.values[i]) : s.values[i];
          if (this.spec.yMin === undefined && v < lo) lo = v;
          if (this.spec.yMax === undefined && v > hi) hi = v;
        }
      }
      if (!Number.isFinite(lo)) lo = 0;
      if (!Number.isFinite(hi)) hi = 1;
      if (hi - lo < 1e-9) hi = lo + 1;
    }

    // Frame + title + y labels.
    ctx.fillStyle = '#8a97a3';
    ctx.textBaseline = 'top';
    ctx.fillText(this.spec.title, padL, 2);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(hi), padL - 4, padT - 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(lo), padL - 4, padT + plotH + 2);
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#2a333b';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, padT + 0.5, plotW, plotH);

    // Legend, right-aligned.
    let lx = W - padR;
    const ly = legendOwnRow ? 14 : 2;
    ctx.textBaseline = 'top';
    for (let k = series.length - 1; k >= 0; k--) {
      const label = series[k].label;
      const tw = ctx.measureText(label).width;
      lx -= tw;
      ctx.fillStyle = series[k].color;
      ctx.fillText(label, lx, ly);
      lx -= 10;
    }

    if (n < 2) return;
    const t0 = ticks[0];
    const t1 = ticks[n - 1];
    const xOf = (i: number) => padL + ((ticks[i] - t0) / (t1 - t0 || 1)) * plotW;
    const yOf = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    if (this.spec.stacked) {
      const base = new Float64Array(n);
      for (const s of series) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(xOf(i), yOf(base[i] + s.values[i]));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(xOf(i), yOf(base[i]));
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.75;
        ctx.fill();
        ctx.globalAlpha = 1;
        for (let i = 0; i < n; i++) base[i] += s.values[i];
      }
      return;
    }

    for (const s of series) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i);
        const y = yOf(s.values[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
  }
}
