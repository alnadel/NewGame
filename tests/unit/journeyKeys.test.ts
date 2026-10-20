// The Journey's arrow keys follow the snaking road on screen (docs/UI_V2.md §10.2): each chapter is
// two rows of five, the second running right to left, so a key moves to the node it points at.
import { describe, expect, it } from 'vitest';
import { journeyStep } from '../../src/ui/screens/journey.ts';

describe('Journey arrow keys', () => {
  it('walk along a row and stop at its ends', () => {
    expect(journeyStep(1, 'ArrowRight', 200)).toBe(2);
    expect(journeyStep(5, 'ArrowRight', 200)).toBeNull();
    expect(journeyStep(1, 'ArrowLeft', 200)).toBeNull();
    // Row 2 runs right to left: 6 is on the right, 10 on the left.
    expect(journeyStep(6, 'ArrowLeft', 200)).toBe(7);
    expect(journeyStep(6, 'ArrowRight', 200)).toBeNull();
    expect(journeyStep(10, 'ArrowLeft', 200)).toBeNull();
    expect(journeyStep(9, 'ArrowRight', 200)).toBe(8);
  });

  it('move straight up and down, across chapters', () => {
    expect(journeyStep(2, 'ArrowDown', 200)).toBe(9);
    expect(journeyStep(9, 'ArrowDown', 200)).toBe(12);
    expect(journeyStep(12, 'ArrowUp', 200)).toBe(9);
    expect(journeyStep(5, 'ArrowDown', 200)).toBe(6);
    expect(journeyStep(10, 'ArrowDown', 200)).toBe(11);
    expect(journeyStep(3, 'ArrowUp', 200)).toBeNull();
    expect(journeyStep(196, 'ArrowDown', 200)).toBeNull();
    expect(journeyStep(1, 'Enter', 200)).toBeNull();
  });
});
