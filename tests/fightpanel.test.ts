import { describe, expect, it } from 'vitest';
import { barHeights, totalBars } from '../src/ui/fightpanel.ts';

// Rules read from MS_FIGTR.DLL FGT_Fight (W_FGT.C): the larger value fills the tube (31 px), the other one
// proportionally (31 / larger * smaller, truncated).
describe('fight window bars', () => {
  it('fills the tube of the larger value and scales the other', () => {
    expect(barHeights(560, 280)).toEqual([31, 15]);
    expect(barHeights(100, 400)).toEqual([7, 31]);
    expect(barHeights(300, 300)).toEqual([31, 31]);
  });
  it('degenerates to empty bars for zero values instead of NaN', () => {
    expect(barHeights(0, 0)).toEqual([0, 31]);
    expect(barHeights(0, 5)).toEqual([0, 31]);
  });
  it('total bars: 100 + 10 per unit lost by the opponent, the smaller bar runs twice as fast when far behind', () => {
    expect(totalBars(0, 0)).toMatchObject({ left: 100, right: 100, leftSpeed: 1, rightSpeed: 1 });
    expect(totalBars(2, 7)).toMatchObject({ left: 150, right: 50, leftSpeed: 1, rightSpeed: 2 });
    expect(totalBars(7, 2)).toMatchObject({ left: 50, right: 150, leftSpeed: 2, rightSpeed: 1 });
    expect(totalBars(3, 4)).toMatchObject({ left: 110, right: 90, leftSpeed: 1, rightSpeed: 1 });
  });
});
