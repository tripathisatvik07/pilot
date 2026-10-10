// Browser entry point: owns the World, the animation loop and the UI wiring. All simulation
// logic lives in src/sim; this file only decides *when* to tick and what to draw.

import { TRAITS } from './sim/config.ts';
import { wrapDelta } from './sim/geometry.ts';
import { hashSeed } from './sim/rng.ts';
import { World, type WorldSnapshot } from './sim/world.ts';
import { LineChart } from './ui/charts.ts';
import { Inspector } from './ui/inspector.ts';
import { Renderer } from './ui/renderer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('world');
const hud = $<HTMLDivElement>('hud');

// --- State -------------------------------------------------------------------------------
let world = new World({ seed: 1 });
world.recordSample();
const renderer = new Renderer(canvas, world);
let running = true;
let speed = 1;
let showRays = false;
let showHeatmap = true;
/** Max milliseconds of simulation per animation frame, so 50× never freezes the page. */
const FRAME_BUDGET_MS = 14;

// --- Controls ------------------------------------------------------------------------------
const controls = $('controls');
controls.innerHTML = `
  <h2>Simulation</h2>
  <div class="row">
    <button id="play" title="Space">Pause</button>
    <button id="step" title="Advance one tick (S)">Step</button>
    <label>Speed <input id="speed" type="range" min="1" max="50" value="1" /> <span id="speedLabel">1×</span></label>
  </div>
  <div class="row">
    <label>Seed <input id="seed" type="text" value="1" /></label>
    <button id="reset">Reset</button>
  </div>
  <div class="row">
    <label><input id="rays" type="checkbox" /> Vision rays</label>
    <label><input id="heat" type="checkbox" checked /> Food heatmap</label>
  </div>
  <div class="row">
    <button id="export">Export JSON</button>
    <button id="importBtn">Import JSON</button>
    <input id="import" type="file" accept="application/json,.json" hidden />
  </div>
  <div id="status" class="muted"></div>`;

const playBtn = $<HTMLButtonElement>('play');
const speedInput = $<HTMLInputElement>('speed');
const speedLabel = $<HTMLSpanElement>('speedLabel');
const seedInput = $<HTMLInputElement>('seed');
const status = $<HTMLDivElement>('status');

function setRunning(r: boolean): void {
  running = r;
  playBtn.textContent = r ? 'Pause' : 'Play';
}
playBtn.onclick = () => setRunning(!running);
$('step').onclick = () => {
  setRunning(false);
  world.step();
  refreshPanels();
};
speedInput.oninput = () => {
  speed = Number(speedInput.value);
  speedLabel.textContent = `${speed}×`;
};
$('reset').onclick = () => {
  const seed = hashSeed(seedInput.value);
  setWorld(new World({ seed }));
  status.textContent = `Reset with seed ${seed}.`;
};
$<HTMLInputElement>('rays').onchange = (e) => (showRays = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>('heat').onchange = (e) => (showHeatmap = (e.target as HTMLInputElement).checked);

$('export').onclick = () => {
  const json = JSON.stringify(world.serialize());
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `terrarium-seed${world.cfg.seed}-tick${world.tick}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = `Exported tick ${world.tick} (${(json.length / 1e6).toFixed(1)} MB).`;
};
const fileInput = $<HTMLInputElement>('import');
$('importBtn').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const snap = JSON.parse(await file.text()) as WorldSnapshot;
    setWorld(World.deserialize(snap));
    seedInput.value = String(world.cfg.seed);
    status.textContent = `Loaded ${file.name}: tick ${world.tick}, ${world.population} creatures.`;
  } catch (err) {
    status.textContent = `Import failed: ${(err as Error).message}`;
  }
  fileInput.value = '';
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setRunning(!running);
  } else if (e.key === 's') {
    setRunning(false);
    world.step();
    refreshPanels();
  }
});

// --- Inspector (click to select) ---------------------------------------------------------
const inspector = new Inspector($('inspector'));
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const wx = ((e.clientX - rect.left) / rect.width) * world.cfg.worldWidth;
  const wy = ((e.clientY - rect.top) / rect.height) * world.cfg.worldHeight;
  inspector.select(world, pickCreature(wx, wy));
});

/** Nearest living creature within a generous click radius, or -1. */
function pickCreature(x: number, y: number): number {
  const p = world.pool;
  let best = -1;
  let bestD = 15 * 15;
  for (let s = 0; s < p.capacity; s++) {
    if (!p.alive[s]) continue;
    const dx = wrapDelta(x, p.x[s], world.cfg.worldWidth);
    const dy = wrapDelta(y, p.y[s], world.cfg.worldHeight);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// --- Charts ------------------------------------------------------------------------------------
const chartsRoot = $('charts');
chartsRoot.innerHTML = '<h2>Charts</h2>';
const popChart = new LineChart(chartsRoot, { title: 'Population', yMin: 0 });
const ratioChart = new LineChart(chartsRoot, { title: 'Herbivore / carnivore share', yMin: 0, yMax: 1, stacked: true, fmt: (v) => `${Math.round(v * 100)}%` }, 80);
const traitChart = new LineChart(chartsRoot, { title: 'Mean traits (0–1 = trait range)', yMin: 0, yMax: 1 }, 140);
const genChart = new LineChart(chartsRoot, { title: 'Max generation', yMin: 0 }, 80);
const TRAIT_COLORS = ['#e6c84f', '#5ab4e6', '#b48cf0', '#f08cc8', '#f0a050', '#e05555', '#70d0a0'];

// --- Event log ----------------------------------------------------------------------------------
const logRoot = $('log');
logRoot.innerHTML = '<h2>Event log</h2><ul></ul>';
const logList = logRoot.querySelector('ul')!;
let lastLogKey = '';

function refreshPanels(): void {
  inspector.update(world);
  const samples = world.stats.samples;
  const ticks = samples.map((s) => s.tick);
  popChart.draw(ticks, [
    { label: 'total', color: '#d6dde3', values: samples.map((s) => s.population) },
    { label: 'herb', color: '#5fd07a', values: samples.map((s) => s.herbivores) },
    { label: 'carn', color: '#e05555', values: samples.map((s) => s.carnivores) },
  ]);
  ratioChart.draw(ticks, [
    { label: 'herb', color: '#5fd07a', values: samples.map((s) => (s.population ? s.herbivores / s.population : 0)) },
    { label: 'carn', color: '#e05555', values: samples.map((s) => (s.population ? s.carnivores / s.population : 0)) },
  ]);
  traitChart.draw(
    ticks,
    TRAITS.map((t, i) => ({
      label: t.key.slice(0, 5),
      color: TRAIT_COLORS[i],
      values: samples.map((s) => (s.meanTraits[i] - t.min) / (t.max - t.min)),
    })),
  );
  genChart.draw(ticks, [{ label: 'max gen', color: '#b48cf0', values: samples.map((s) => s.maxGeneration) }]);

  const events = world.stats.events;
  const key = `${events.length}:${events[events.length - 1]?.tick ?? -1}`;
  if (key !== lastLogKey) {
    lastLogKey = key;
    logList.innerHTML = events
      .slice()
      .reverse()
      .map((e) => `<li><b>[${e.tick}]</b> ${e.text}</li>`)
      .join('');
  }
}

function setWorld(w: World): void {
  world = w;
  world.recordSampleIfNeeded();
  renderer.attach(world);
  inspector.select(world, -1);
  lastLogKey = '';
  refreshPanels();
}

// --- Main loop ----------------------------------------------------------------------------------
window.addEventListener('resize', () => renderer.resize(world));
let lastPanel = 0;
let fpsFrames = 0;
let fpsT0 = performance.now();
let fps = 0;
/** Mean ms spent in world.step() per tick over the last second (shown in the HUD). */
let msPerTick = 0;
let stepMs = 0;
/** Mean ms per frame spent drawing the world canvas. */
let drawMs = 0;
let drawMsAcc = 0;
let ticksThisSecond = 0;
let tps = 0;

function frame(now: number): void {
  if (running) {
    const t0 = performance.now();
    for (let i = 0; i < speed; i++) {
      world.step();
      ticksThisSecond++;
      if (performance.now() - t0 > FRAME_BUDGET_MS) break;
    }
    stepMs += performance.now() - t0;
  }
  const d0 = performance.now();
  renderer.draw(world, { showHeatmap, showRays, selectedSlot: inspector.selectedSlot });
  drawMsAcc += performance.now() - d0;

  fpsFrames++;
  if (now - fpsT0 >= 1000) {
    fps = (fpsFrames * 1000) / (now - fpsT0);
    tps = (ticksThisSecond * 1000) / (now - fpsT0);
    msPerTick = ticksThisSecond > 0 ? stepMs / ticksThisSecond : 0;
    drawMs = drawMsAcc / fpsFrames;
    drawMsAcc = 0;
    stepMs = 0;
    fpsFrames = 0;
    ticksThisSecond = 0;
    fpsT0 = now;
  }
  const latest = world.stats.latest();
  const season = world.food.seasonFactor(world.tick) >= 1 ? 'summer' : 'winter';
  hud.textContent =
    `tick ${world.tick} · pop ${world.population}` +
    (latest ? ` (herb ${latest.herbivores} / carn ${latest.carnivores}) · max gen ${latest.maxGeneration}` : '') +
    ` · ${season} · ${fps.toFixed(0)} fps · ${tps.toFixed(0)} ticks/s · ${msPerTick.toFixed(1)} ms/tick · draw ${drawMs.toFixed(1)} ms`;

  // Panels are comparatively expensive DOM/canvas work; ~5 Hz is plenty for humans.
  if (now - lastPanel > 200) {
    lastPanel = now;
    refreshPanels();
  }
  requestAnimationFrame(frame);
}
refreshPanels();
requestAnimationFrame(frame);

// Exposed for debugging in the console and for the Playwright smoke test.
(window as unknown as { terrarium: unknown }).terrarium = {
  get world() {
    return world;
  },
  World,
  setWorld,
  setRunning,
  get fps() {
    return fps;
  },
  get drawMs() {
    return drawMs;
  },
  get msPerTick() {
    return msPerTick;
  },
  setSpeed(v: number) {
    speedInput.value = String(v);
    speedInput.dispatchEvent(new Event('input'));
  },
};
