import { getPlanVersion, notifyPlanChanged } from '../planEvents';

describe('plan change signal', () => {
  it('starts at zero for an account and goes up each time that account\'s plan changes', () => {
    const before = getPlanVersion('A-events');

    notifyPlanChanged('A-events');
    notifyPlanChanged('A-events');

    expect(getPlanVersion('A-events')).toBe(before + 2);
  });

  it('keeps each account\'s count separate', () => {
    const b = getPlanVersion('B-events');

    notifyPlanChanged('A-events');

    expect(getPlanVersion('B-events')).toBe(b);
  });
});
