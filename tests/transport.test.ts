// Loading and unloading of transporters together with movement (SDI_1C.EXE FUN_0043e34f, FUN_00436afa, FUN_004436b5,
// FUN_004425fd, FUN_00442f96, FUN_004369cf).
import { describe, expect, it } from 'vitest';
import { gameData, hasGameData } from './helpers.ts';
import { createGame, createUnit } from '../src/engine/setup.ts';
import { Game } from '../src/engine/game.ts';
import { canBoard, canLoad } from '../src/engine/movement.ts';
import { UCF } from '../src/engine/classes.ts';
import { UnitFlag, type UnitState } from '../src/engine/state.ts';

/** Mission 104 with a ground transporter and a unit it can carry, both of player 0, next to each other. */
async function setup() {
  const data = await gameData();
  const state = createGame(data, await data.loadMission(104), { setId: 0, difficulty: 1 });
  const g = new Game(data, state);
  g.start();
  const cls = data.unitClasses;
  // a ground transporter (not plane, not ship) and a passenger it can take
  let carrierType = -1, passengerType = -1;
  for (const c of cls) {
    if (!(c.flags & UCF.TRANSPORTER) || (c.flags & UCF.PLANE) || (c.flags >>> 31) || c.moveRange < 16) continue;
    const p = cls.find((q) => q.index !== c.index && !(q.flags & UCF.PLANE) && !(q.flags >>> 31) && q.moveRange >= 16
      && (c.transportMask & q.transportClass) && c.transportVolume >= q.weight * 2);
    if (p) { carrierType = c.index; passengerType = p.index; break; }
  }
  const own = g.unitsOf(0).find((u) => !u.container)!;
  const fields = g.w.neighbours(own.x, own.y).filter((p) => p && g.w.playable(p.x, p.y) && state.unitAt[p.y * state.width + p.x] < 0 && state.shopAt[p.y * state.width + p.x] < 0)!;
  const place = (type: number, p: { x: number; y: number }) => {
    const u = createUnit(state, data, type, 0, p.x, p.y);
    state.unitAt[p.y * state.width + p.x] = u.id;
    return u;
  };
  const carrier = place(carrierType, fields[0]!);
  const passenger = place(passengerType, fields[1]!);
  state.activePlayer = 0;
  return { g, state, data, carrier, passenger, carrierType, passengerType, place, fields };
}

const field = (g: Game, u: UnitState) => g.w.idx(u.x, u.y);

describe.skipIf(!hasGameData)('transporters', () => {
  it('a unit boards an own transporter, moves with it and cannot leave in the same turn', async () => {
    const { g, carrier, passenger } = await setup();
    expect(g.moveArea(passenger.id).targets.has(field(g, carrier))).toBe(true);
    expect(g.moveUnit(passenger.id, field(g, carrier)).ok).toBe(true);
    expect(passenger.container).toEqual({ kind: 'unit', id: carrier.id });
    expect(carrier.cargo).toContain(passenger.id);
    expect(g.canMove(passenger)).toBe(false); // boarded this turn (flags 0x120)
    // the transporter drives on, the passenger goes along
    const to = [...g.moveArea(carrier.id).targets.keys()].find((f) => g.state.unitAt[f] < 0 && g.state.shopAt[f] < 0)!;
    expect(g.moveUnit(carrier.id, to).ok).toBe(true);
    expect([passenger.x, passenger.y]).toEqual([carrier.x, carrier.y]);
  });

  it('next turn the passenger leaves from the place of the transporter; fuel counts from there', async () => {
    const { g, state, carrier, passenger } = await setup();
    g.moveUnit(passenger.id, field(g, carrier));
    const alive = state.players.filter((p) => p.alive).length;
    for (let i = 0; i < alive; i++) g.endTurn();
    expect(state.activePlayer).toBe(0);
    expect(g.canMove(passenger)).toBe(true);
    const area = g.moveArea(passenger.id);
    const out = [...area.targets.keys()].find((f) => state.unitAt[f] < 0 && state.shopAt[f] < 0)!;
    const fuel = passenger.fuel, d = g.w.cls(passenger).fuelUsage;
    const { x, y } = { x: out % state.width, y: Math.trunc(out / state.width) };
    expect(g.moveUnit(passenger.id, out).ok).toBe(true);
    expect(passenger.container).toBeNull();
    expect(carrier.cargo).not.toContain(passenger.id);
    expect(state.unitAt[out]).toBe(passenger.id);
    const steps = Math.max(Math.abs(x - carrier.x), 0) >= 0 ? (await import('../src/engine/hex.ts')).distance(carrier.x, carrier.y, x, y) : 0;
    expect(passenger.fuel).toBe(Math.max(0, fuel - steps * d));
    expect(passenger.flags & UnitFlag.MOVED).toBeTruthy();
  });

  it('no boarding into a foreign transporter, even with class flag 0x04000000 (FUN_0043e34f)', async () => {
    const { g, carrier, passenger } = await setup();
    carrier.owner = 1;
    expect(canBoard(g.w, carrier, passenger)).toBe(false);
    expect(g.moveArea(passenger.id).targets.has(field(g, carrier))).toBe(false);
    // the weight / class test alone (FUN_00436afa) would let foreign units in with flag 0x04000000
    void canLoad;
  });

  it('a loaded transporter boarding another hands its cargo over (FUN_004425fd)', async () => {
    const { g, state, data, carrier, passenger, carrierType, place, fields } = await setup();
    // second transporter of the same type with the passenger inside, next to the first one
    const p2 = fields[2];
    if (!p2) return;
    const small = place(carrierType, p2);
    if (!canBoard(g.w, carrier, small)) return; // this transporter cannot carry its own kind
    state.unitAt[field(g, passenger)] = -1;
    passenger.x = small.x; passenger.y = small.y;
    passenger.container = { kind: 'unit', id: small.id };
    small.cargo.push(passenger.id);
    g.moveUnit(small.id, field(g, carrier));
    expect(carrier.cargo).toContain(small.id);
    expect(carrier.cargo).toContain(passenger.id);
    expect(small.cargo).toHaveLength(0);
    expect(passenger.container).toEqual({ kind: 'unit', id: carrier.id });
    void data;
  });

  it('a destroyed transporter takes its cargo with it (FUN_004369cf)', async () => {
    const { g, carrier, passenger } = await setup();
    g.moveUnit(passenger.id, field(g, carrier));
    g.destroyUnit(carrier, 1, 'damage');
    expect(passenger.alive).toBe(false);
  });
});
