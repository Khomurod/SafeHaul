'use strict';

const {
  computeApplicationRollupDeltas,
  computeLeadRollupDeltas,
} = require('../../dashboardStatsRollup');

function snap(exists, data) {
  return {
    exists,
    data: () => data,
  };
}

describe('dashboardStatsRollup deltas', () => {
  test('application create increments apps and hired when already hired', () => {
    const d = computeApplicationRollupDeltas(snap(false, null), snap(true, { status: 'Hired' }));
    expect(d).toEqual({ applicationsTotal: 1, hiredTotal: 1 });
  });

  test('application create not hired', () => {
    const d = computeApplicationRollupDeltas(snap(false, null), snap(true, { status: 'New Application' }));
    expect(d).toEqual({ applicationsTotal: 1, hiredTotal: 0 });
  });

  test('application delete removes hired', () => {
    const d = computeApplicationRollupDeltas(snap(true, { status: 'Approved' }), snap(false, null));
    expect(d).toEqual({ applicationsTotal: -1, hiredTotal: -1 });
  });

  test('application status to hired bumps hired only', () => {
    const d = computeApplicationRollupDeltas(
      snap(true, { status: 'In Process' }),
      snap(true, { status: 'Hired' }),
    );
    expect(d).toEqual({ applicationsTotal: 0, hiredTotal: 1 });
  });

  test('application irrelevant update returns null', () => {
    const d = computeApplicationRollupDeltas(
      snap(true, { status: 'New Application', firstName: 'A' }),
      snap(true, { status: 'New Application', firstName: 'B' }),
    );
    expect(d).toBeNull();
  });

  test('lead create and delete', () => {
    expect(computeLeadRollupDeltas(snap(false, null), snap(true, {}))).toEqual({ leadsTotal: 1 });
    expect(computeLeadRollupDeltas(snap(true, {}), snap(false, null))).toEqual({ leadsTotal: -1 });
    expect(computeLeadRollupDeltas(snap(true, { a: 1 }), snap(true, { a: 2 }))).toBeNull();
  });
});
