// Browser smoke test: starts the Vite dev server, loads the app in the pre-installed Chromium,
// lets it run for 30 s, then checks for console errors, a living population and a non-blank
// canvas, and saves docs/screenshot.png.
//
//   node scripts/e2e.ts [--seconds 30]

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values } = parseArgs({ options: { seconds: { type: 'string', default: '30' }, port: { type: 'string', default: '5179' } } });
const seconds = Number(values.seconds);
const port = Number(values.port);
const url = `http://localhost:${port}/`;

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server did not start:\n${serverLog}`);
}

let failed = false;
const fail = (msg: string) => {
  console.error(`FAIL: ${msg}`);
  failed = true;
};

try {
  await waitForServer();
  console.log(`dev server up at ${url}`);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => 'terrarium' in window);
  // Run at 5× for most of the time so the screenshot shows some evolution, but keep a plain
  // 1× period too, which is what a visitor sees.
  await page.waitForTimeout(5000);
  await page.evaluate(() => (window as any).terrarium.setSpeed(5));
  await page.waitForTimeout((seconds - 8) * 1000);
  await page.evaluate(() => (window as any).terrarium.setSpeed(1));
  // Click on a creature so the screenshot shows the inspector + network diagram.
  const pos = await page.evaluate(() => {
    const w = (window as any).terrarium.world;
    const p = w.pool;
    // Pick the most energetic creature so it is unlikely to die before we look at it.
    let s = -1;
    for (let i = 0; i < p.capacity; i++) if (p.alive[i] && (s < 0 || p.energy[i] > p.energy[s])) s = i;
    const c = document.getElementById('world')!.getBoundingClientRect();
    return { x: c.left + (p.x[s] / w.cfg.worldWidth) * c.width, y: c.top + (p.y[s] / w.cfg.worldHeight) * c.height };
  });
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const w = (window as any).terrarium.world;
    const canvas = document.getElementById('world') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Count distinct-ish colours on a sparse grid: a blank canvas has one.
    const colours = new Set<number>();
    let nonBlack = 0;
    for (let i = 0; i < img.length; i += 4 * 97) {
      colours.add(((img[i] >> 3) << 10) | ((img[i + 1] >> 3) << 5) | (img[i + 2] >> 3));
      if (img[i] + img[i + 1] + img[i + 2] > 40) nonBlack++;
    }
    return {
      tick: w.tick,
      population: w.population,
      colours: colours.size,
      nonBlack,
      inspector: document.getElementById('inspector')!.textContent ?? '',
      hud: document.getElementById('hud')!.textContent ?? '',
    };
  });
  console.log(`after ${seconds}s: ${info.hud}`);
  console.log(`canvas: ${info.colours} distinct colours, ${info.nonBlack} non-black samples`);
  mkdirSync('docs', { recursive: true });
  await page.screenshot({ path: 'docs/screenshot.png' });
  console.log('saved docs/screenshot.png');

  if (errors.length) fail(`console errors:\n  ${errors.join('\n  ')}`);
  if (!(info.population > 0)) fail(`population is ${info.population}`);
  if (!(info.tick > 0)) fail('simulation did not advance');
  if (info.colours < 10 || info.nonBlack < 100) fail('canvas looks blank');
  if (!info.inspector.includes('generation')) fail('inspector did not show the clicked creature');

  // Performance check: a dense world held at ~2,200 creatures (pool cap) at 1× speed.
  await page.evaluate(() => {
    const t = (window as any).terrarium;
    t.setWorld(new t.World({ seed: 7, initialPopulation: 2200, maxCreatures: 2200, foodMax: 80, foodGrowthRate: 0.03 }));
    t.setSpeed(1);
    t.setRunning(true);
  });
  await page.waitForTimeout(3000); // let the JIT and frame timing settle
  const samples: { fps: number; pop: number; ms: number; draw: number }[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1000);
    samples.push(
      await page.evaluate(() => {
        const t = (window as any).terrarium;
        return { fps: t.fps, pop: t.world.population, ms: t.msPerTick, draw: t.drawMs };
      }),
    );
  }
  const meanFps = samples.reduce((a, b) => a + b.fps, 0) / samples.length;
  const meanPop = samples.reduce((a, b) => a + b.pop, 0) / samples.length;
  const meanMs = samples.reduce((a, b) => a + b.ms, 0) / samples.length;
  const meanDraw = samples.reduce((a, b) => a + b.draw, 0) / samples.length;
  console.log(
    `dense perf: mean population ${meanPop.toFixed(0)}, ${meanFps.toFixed(1)} fps, ` +
      `${meanMs.toFixed(1)} ms per sim tick, ${meanDraw.toFixed(1)} ms per draw`,
  );
  await page.screenshot({ path: 'docs/screenshot-dense.png' });
  await browser.close();
} catch (e) {
  fail(String(e));
} finally {
  server.kill();
}
console.log(failed ? 'E2E FAILED' : 'E2E PASSED');
process.exit(failed ? 1 : 0);
