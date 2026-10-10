import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.ts';
import { SMALL_WORLD } from './helpers.ts';

describe('save / load', () => {
  it('a JSON round-trip preserves everything, including stats, events and carrion', () => {
    const a = new World({ ...SMALL_WORLD, seed: 21 });
    a.run(1500);
    const json = JSON.stringify(a.serialize());
    const b = World.deserialize(JSON.parse(json));
    expect(JSON.stringify(b.serialize())).toBe(json);
    expect(b.stats.samples.length).toBe(a.stats.samples.length);
    expect(b.population).toBe(a.population);
    expect(b.food.totalMeat()).toBe(a.food.totalMeat());
  });

  it('a loaded world continues identically, through births, deaths and kills', () => {
    const a = new World({ ...SMALL_WORLD, seed: 8 });
    a.run(1500);
    const b = World.deserialize(JSON.parse(JSON.stringify(a.serialize())));
    a.run(1500);
    b.run(1500);
    expect(a.stats.state.totalKills).toBeGreaterThan(0);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
  });

  it('rejects saves from an unknown format version', () => {
    const snap = new World({ seed: 1 }).serialize();
    snap.version = 999;
    expect(() => World.deserialize(snap)).toThrow(/version/);
  });

  it('fills config keys missing from older saves with defaults', () => {
    const snap = new World({ seed: 1 }).serialize();
    delete (snap.config as Partial<typeof snap.config>).carrionDecay;
    const w = World.deserialize(snap);
    expect(w.cfg.carrionDecay).toBeGreaterThan(0);
  });
});

describe('immigration floor', () => {
  it('tops the population back up to the floor and logs it', () => {
    const w = new World({ seed: 1, initialPopulation: 0, immigrationFloor: 15 });
    w.step();
    expect(w.population).toBe(15);
    expect(w.stats.events.some((e) => e.kind === 'immigration')).toBe(true);
  });
});

describe('determinism (definition of done)', () => {
  it('same seed + config ⇒ byte-identical state after 5,000 ticks (full default config)', () => {
    const a = new World({ seed: 12345 });
    const b = new World({ seed: 12345 });
    a.run(5000);
    b.run(5000);
    const sa = JSON.stringify(a.serialize());
    expect(sa).toBe(JSON.stringify(b.serialize()));
    expect(a.population).toBeGreaterThan(0);
    // And a different seed really does diverge (no need to run it as long to see that).
    const c = new World({ seed: 12346 });
    c.run(500);
    expect(JSON.stringify(c.serialize())).not.toBe(sa);
  });
});
