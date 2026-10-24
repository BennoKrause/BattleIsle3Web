// Computer player rebuilt from SDI_1C.EXE (src/engine/ai-original.ts, docs/research/AI.md).
import { describe, expect, it } from 'vitest';
import { gameData, hasGameData } from './helpers.ts';
import { createGame } from '../src/engine/setup.ts';
import { Game } from '../src/engine/game.ts';
import { OriginalAI } from '../src/engine/ai-original.ts';
import { Layer } from '../src/engine/state.ts';
import { distance } from '../src/engine/hex.ts';

async function game(id: number) {
  const data = await gameData();
  const g = new Game(data, createGame(data, await data.loadMission(id), { setId: 0, difficulty: 1 }));
  g.start();
  return g;
}

/** Ends turns until it is `player`'s turn. */
function turnOf(g: Game, player: number) {
  for (let i = 0; i < 12 && g.state.activePlayer !== player; i++) g.endTurn();
}

describe.skipIf(!hasGameData)('original computer player', () => {
  it('a damaged unit retreats to an own building (FUN_00430779)', async () => {
    const g = await game(104);
    const p = g.state.shops.find((sh) => sh.owner < 6 && sh.owner !== 0)!.owner;
    turnOf(g, p);
    const shop = g.state.shops.find((sh) => sh.owner === p)!;
    void shop;
    const u = g.unitsOf(p).find((x) => !x.container && g.shopEntrySlot(shop.id, x.id) >= 0 && g.canMove(x))!;
    u.group = 1;
    const ai = new OriginalAI(g);
    ai.begin();
    const order = (ai as any).orders.get(u.id);
    expect(order).toMatchObject({ kind: 1, prio: 30, code: 6 });
    const w = g.state.width, tx = order.target % w, ty = Math.trunc(order.target / w);
    expect(g.state.shopAt[order.target]).toBeGreaterThanOrEqual(0);
    const before = distance(u.x, u.y, tx, ty);
    for (let i = 0; i < 500 && ai.step(); i++);
    const after = u.container ? 0 : distance(u.x, u.y, tx, ty);
    expect(after).toBeLessThan(before);
  });

  it('occupying units are sent to enemy or neutral buildings (FUN_0041db47 / FUN_0042f620)', async () => {
    const g = await game(104);
    const ai = new OriginalAI(g);
    turnOf(g, g.state.activePlayer);
    ai.begin();
    const t = (ai as any).targets as { cat: number; art: number }[];
    expect(t.some((x) => x.cat === 1 && x.art === 1)).toBe(true);
    const orders = [...((ai as any).orders as Map<number, { code: number }>).values()];
    expect(orders.some((o) => o.code === 1)).toBe(true);
  });

  it('production respects the type limits of table 0x4ccd50', async () => {
    const g = await game(110);
    const ai = new OriginalAI(g) as any;
    ai.p = g.state.activePlayer;
    const limit = new Array(64).fill(1e9);
    // the special types are produced once without looking at the limit (FUN_0041bf8e)
    limit[0x13] = 0;
    ai.strategy = 8;
    expect(ai.chooseType([0x13, 3], limit)).toBe(0x13);
    expect(ai.strategy & 8).toBe(0);
    // a group only counts while its type is below the limit: 3 (last of 6, 0x10, 3) is used up -> fallback
    ai.strategy = 2;
    limit[3] = 0;
    expect(ai.chooseType([6, 3], limit)).not.toBe(3);
  });

  it('submarines dive at the start of their turn (phases 7-9, FUN_0041ba65)', async () => {
    const g = await game(110);
    const sub = g.state.units.find((u) => u.alive && !u.container && (u.type === 46 || u.type === 47) && u.owner !== 0);
    if (!sub) return;
    turnOf(g, sub.owner);
    sub.layer = Layer.WATER;
    const ai = new OriginalAI(g) as any;
    ai.begin();
    ai.orders.clear(); // only free units dive
    for (let i = 0; i < 500 && ai.step(); i++);
    expect(sub.alive ? sub.layer : Layer.SUBMERGED).toBe(Layer.SUBMERGED);
  });
});

describe.skipIf(!hasGameData)('fixed computer orders from the mission (FUN_0042c109 -> FUN_00427912)', () => {
  it('are read from the AI point records (bytes 72-79)', async () => {
    const g = await game(100);
    const u = g.state.units.find((x) => x.alive && x.x === 13 && x.y === 7)!;
    expect(u.aiOrder & 0xff).toBe(1);
    expect(u.aiPrio).toBe(100);
  });

  it('0x01: the unit holds its position and fights (order 2); 0x02: the unit waits (order 3)', async () => {
    const g = await game(101);
    const holder = g.state.units.find((x) => x.alive && x.x === 15 && x.y === 19)!; // flag 1, priority 140
    const waiter = g.state.units.find((x) => x.alive && x.x === 14 && x.y === 18)!; // flag 2, priority 100
    turnOf(g, holder.owner);
    const ai = new OriginalAI(g) as any;
    ai.begin();
    expect(ai.orders.get(holder.id)).toMatchObject({ kind: 2, prio: 140, code: 8 });
    expect(ai.orders.get(waiter.id)).toMatchObject({ kind: 3, prio: 100, code: 8 });
    const at = [holder.x, holder.y];
    for (let i = 0; i < 500 && ai.step(); i++);
    if (holder.alive) expect([holder.x, holder.y]).toEqual(at); // order 2 never moves
  });

  it('a weak unit loses its fixed order and becomes free', async () => {
    const g = await game(101);
    const holder = g.state.units.find((x) => x.alive && x.x === 15 && x.y === 19)!;
    turnOf(g, holder.owner);
    holder.group = 1;
    new OriginalAI(g).begin();
    expect(holder.aiOrder & 1).toBe(0);
  });
});
