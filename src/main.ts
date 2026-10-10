// Browser entry point: owns the World, the animation loop and the UI wiring.

import { World } from './sim/world.ts';
import { Renderer } from './ui/renderer.ts';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

let world = new World({ seed: 1 });
const renderer = new Renderer(canvas, world);
let running = true;

window.addEventListener('resize', () => renderer.resize(world));

function frame(): void {
  if (running) world.step();
  renderer.draw(world, { showHeatmap: true, showRays: false, selectedSlot: -1 });
  hud.textContent = `tick ${world.tick} · population ${world.population}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for debugging in the console and for the Playwright smoke test.
(window as unknown as { terrarium: unknown }).terrarium = {
  get world() {
    return world;
  },
  set world(w: World) {
    world = w;
  },
  pause(p: boolean) {
    running = !p;
  },
};
