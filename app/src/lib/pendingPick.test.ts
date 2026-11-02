import { setPendingPick, takePendingPick } from './pendingPick';

describe('pendingPick', () => {
  it('hands the course over once', () => {
    setPendingPick('L1');
    expect(takePendingPick()).toBe('L1');
    expect(takePendingPick()).toBeNull();
  });

  it('keeps only the latest and can be cleared', () => {
    setPendingPick('L1');
    setPendingPick('L2');
    expect(takePendingPick()).toBe('L2');
    setPendingPick('L3');
    setPendingPick(null);
    expect(takePendingPick()).toBeNull();
  });
});
