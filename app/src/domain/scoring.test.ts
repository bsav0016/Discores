import {
  clampStrokes,
  formatRelative,
  holesScored,
  isComplete,
  isOldEnough,
  parThroughScored,
  relativeToPar,
  totalStrokes,
} from './scoring';

const pars = [3, 3, 4, 3];

describe('scoring', () => {
  it('totals strokes', () => {
    expect(totalStrokes({ 1: 3, 2: 4, 3: 5 })).toBe(12);
    expect(totalStrokes({})).toBe(0);
  });

  it('only counts par for scored holes', () => {
    expect(parThroughScored(pars, { 1: 3, 3: 5 })).toBe(7);
  });

  it('computes relative to par on a partial round', () => {
    expect(relativeToPar(pars, { 1: 2, 2: 3 })).toBe(-1);
    expect(relativeToPar(pars, { 1: 4, 2: 4, 3: 4, 4: 3 })).toBe(2);
  });

  it('formats relative scores', () => {
    expect(formatRelative(0)).toBe('E');
    expect(formatRelative(3)).toBe('+3');
    expect(formatRelative(-2)).toBe('-2');
  });

  it('detects completion for every player', () => {
    const full = { 1: 3, 2: 3, 3: 4, 4: 3 };
    expect(holesScored(full)).toBe(4);
    expect(isComplete(4, [full, full])).toBe(true);
    expect(isComplete(4, [full, { 1: 3 }])).toBe(false);
    expect(isComplete(4, [])).toBe(false);
  });

  it('clamps strokes', () => {
    expect(clampStrokes(0)).toBe(1);
    expect(clampStrokes(99)).toBe(30);
    expect(clampStrokes(4.4)).toBe(4);
  });

  it('enforces the 13+ rule by birth year', () => {
    const now = new Date('2026-10-04');
    expect(isOldEnough(2013, now)).toBe(true);
    expect(isOldEnough(2014, now)).toBe(false);
  });
});
