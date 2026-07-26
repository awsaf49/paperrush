const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../js/app.js');

const aaai2026Deadlines = [
    {
        type: 'paper',
        label: 'Paper Submission',
        date: '2025-08-01T23:59:00-12:00'
    },
    {
        type: 'event',
        label: 'AAAI Conference',
        date: '2026-02-17'
    }
];

test('future conference date does not keep a closed edition current', () => {
    const now = new Date('2025-08-02T12:00:00Z');

    assert.equal(App.allDeadlinesPassed(aaai2026Deadlines, now), true);
    assert.equal(App.findActiveDeadline(aaai2026Deadlines, now), null);
});

test('future main paper deadline keeps the current edition active', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    const deadlines = [
        {
            type: 'paper',
            label: 'Paper Submission',
            date: '2026-07-28T23:59:00-12:00'
        }
    ];

    assert.equal(App.allDeadlinesPassed(deadlines, now), false);
    assert.equal(App.findActiveDeadline(deadlines, now), deadlines[0]);
});

test('biennial conferences roll forward by two years', () => {
    const rolled = App.createNextYearConference({
        id: 'eccv-2026',
        name: 'ECCV',
        year: 2026,
        deadlines: [{
            type: 'paper',
            label: 'Paper Submission',
            date: '2026-03-05T23:59:00+01:00'
        }],
        location: {},
        links: {}
    });

    assert.equal(rolled.year, 2028);
    assert.equal(rolled.datesTBD, true);
    assert.deepEqual(rolled.deadlines, []);
});

test('missing dates roll to a clearly labeled future placeholder', () => {
    const rolled = App.createNextYearConference({
        id: 'icassp-2026',
        name: 'ICASSP',
        year: 2026,
        deadlines: [],
        location: {},
        links: {}
    });

    assert.equal(rolled.year, 2027);
    assert.equal(rolled.datesTBD, true);
    assert.deepEqual(rolled.deadlines, []);
});
