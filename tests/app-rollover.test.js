const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../js/app.js');
const Rules = require('../js/deadline-utils.js');
const Calendar = require('../js/calendar.js');

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
    assert.equal(rolled.datesTBD, false);
    assert.equal(rolled.deadlines[0].date, '2028-03-05T23:59:00+01:00');
    assert.equal(rolled.deadlines[0].estimated, true);
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

test('very old records jump to the next viable edition and drop stale links', () => {
    const rolled = App.createNextYearConference({
        id: 'icml-2020',
        name: 'ICML',
        year: 2020,
        website: 'https://icml.cc/Conferences/2020',
        deadlines: [],
        location: {},
        links: { official: 'https://icml.cc/Conferences/2020' }
    }, new Date('2026-07-25T12:00:00Z'));

    assert.equal(rolled.year, 2027);
    assert.equal(rolled.website, '');
    assert.deepEqual(rolled.links, {});
});

test('side tracks cannot keep an old main submission edition alive', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    const deadlines = [
        { type: 'paper', label: 'Paper Submission', date: '2026-05-01T23:59:00-12:00' },
        { type: 'paper', label: 'Doctoral Consortium Submission', date: '2026-12-01T23:59:00-12:00' }
    ];

    assert.equal(App.allDeadlinesPassed(deadlines, now), true);
    assert.equal(Rules.isPrimarySubmissionDeadline(deadlines[1]), false);
});

test('deadline focus separates paper registration, papers, and conference dates', () => {
    const registration = { type: 'paper', label: 'Paper Registration Deadline', date: '2027-03-01' };
    const paper = { type: 'paper', label: 'Paper Submission', date: '2027-03-07' };
    const event = { type: 'event', label: 'Main Conference', date: '2027-10-10', endDate: '2027-10-16' };

    assert.equal(Rules.matchesFocus(registration, 'abstract'), true);
    assert.equal(Rules.matchesFocus(registration, 'paper'), false);
    assert.equal(Rules.matchesFocus(paper, 'paper'), true);
    assert.equal(Rules.matchesFocus(event, 'conference'), true);
});

test('conference focus preserves an upcoming event after paper rollover', () => {
    const source = {
        id: 'sample-2026',
        name: 'SAMPLE',
        year: 2026,
        category: 'other',
        location: {},
        deadlines: [
            { type: 'paper', label: 'Paper Submission', date: '2026-01-01' },
            { type: 'conference', label: 'Main Conference', date: '2026-09-10', endDate: '2026-09-12' }
        ]
    };
    const now = new Date('2026-07-25T12:00:00Z');
    App.catalog = [{ source, submission: App.resolveSubmissionEdition(source, now) }];

    App.selectDeadlineFocus('conference', now);
    assert.equal(App.conferences[0].id, 'sample-2026');
    assert.equal(App.conferences[0].deadlines[0].type, 'conference');

    App.selectDeadlineFocus('submissions', now);
    assert.equal(App.conferences[0].id, 'sample-2027');
    assert.equal(App.conferences[0].deadlines[0].estimated, true);
});

test('paper plus abstract omits TBA cards with no confirmed milestone', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    const placeholder = {
        id: 'sample-2027', name: 'SAMPLE', year: 2027, datesTBD: true, deadlines: []
    };
    App.catalog = [{ source: placeholder, event: placeholder, submission: placeholder }];

    App.selectDeadlineFocus('submissions', now);

    assert.equal(App.conferences.length, 0);
});

test('a newer submission edition and older upcoming event can coexist', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    const currentEvent = {
        id: 'sample-2026', name: 'SAMPLE', year: 2026, deadlines: [
            { type: 'conference', label: 'Main Conference', date: '2026-09-10', endDate: '2026-09-12' }
        ]
    };
    const nextSubmission = {
        id: 'sample-2027', name: 'SAMPLE', year: 2027, deadlines: [
            { type: 'paper', label: 'Paper Submission', date: '2026-11-01' }
        ]
    };

    assert.equal(App.chooseSubmissionSource([currentEvent, nextSubmission], now).id, 'sample-2027');
    assert.equal(App.chooseEventSource([currentEvent, nextSubmission], now).id, 'sample-2026');
});

test('date-only deadlines remain active through the listed day', () => {
    const deadline = { type: 'paper', label: 'Paper Submission', date: '2026-07-25' };

    assert.equal(Rules.isPassed(deadline, new Date('2026-07-25T12:00:00Z')), false);
    assert.equal(Rules.isPassed(deadline, new Date('2026-07-26T00:00:00Z')), true);
});

test('estimated primary dates remain visible but clearly marked approximate', () => {
    const resolved = App.resolveSubmissionEdition({
        id: 'sample-2027',
        name: 'SAMPLE',
        year: 2027,
        info: { pageLimit: 'stale prior-edition instructions' },
        deadlines: [{
            type: 'paper',
            label: 'Paper Submission',
            date: '2027-01-15',
            estimated: true
        }]
    }, new Date('2026-07-25T12:00:00Z'));

    assert.equal(resolved.datesTBD, false);
    assert.equal(resolved.deadlines.length, 1);
    assert.equal(resolved.deadlines[0].estimated, true);
    assert.deepEqual(resolved.info, {});
});

test('a passed estimated edition advances instead of remaining TBA in the old year', () => {
    const resolved = App.resolveSubmissionEdition({
        id: 'sample-2026',
        name: 'SAMPLE',
        year: 2026,
        location: {},
        links: {},
        deadlines: [{
            type: 'paper',
            label: 'Paper Submission',
            date: '2025-12-01',
            estimated: true
        }]
    }, new Date('2026-07-25T12:00:00Z'));

    assert.equal(resolved.id, 'sample-2027');
    assert.equal(resolved.datesTBD, false);
    assert.equal(resolved.deadlines[0].date, '2026-12-01');
});

test('rolled editions discard prior-edition instructions and notes', () => {
    const rolled = App.createNextYearConference({
        id: 'sample-2026',
        name: 'SAMPLE',
        year: 2026,
        location: {},
        links: { author: 'https://example.com/2026/authors' },
        info: { pageLimit: '8 pages' },
        notes: ['Old policy'],
        deadlines: []
    }, new Date('2026-07-25T12:00:00Z'));

    assert.deepEqual(rolled.links, {});
    assert.deepEqual(rolled.info, {});
    assert.deepEqual(rolled.notes, []);
});

test('deadline year shifting preserves timezone and handles leap day', () => {
    assert.equal(
        App.shiftDeadlineYear('2025-09-24T23:59:00-12:00', 1),
        '2026-09-24T23:59:00-12:00'
    );
    assert.equal(App.shiftDeadlineYear('2024-02-29', 1), '2025-02-28');
    assert.equal(App.formatApproximateDate('2026-09-24T23:59:00-12:00'), "Sep 24 '26");
});

test('calendar uses the published AoE date and expands conference ranges', () => {
    Calendar.conferences = [{
        id: 'sample-2026',
        name: 'SAMPLE',
        deadlines: [
            { type: 'paper', label: 'Paper Submission', date: '2026-07-28T23:59:00-12:00' },
            { type: 'conference', label: 'Main Conference', date: '2026-09-10', endDate: '2026-09-12' }
        ]
    }];

    assert.equal(Calendar.getDeadlinesForDate(new Date('2026-07-28T12:00:00')).length, 1);
    assert.equal(Calendar.getDeadlinesForDate(new Date('2026-07-29T12:00:00')).length, 0);
    assert.equal(Calendar.getDeadlinesForDate(new Date('2026-09-11T12:00:00')).length, 1);
});

test('scraped text is escaped and unsafe links are rejected', () => {
    assert.equal(Rules.escapeHTML('<img onerror=alert(1)>'), '&lt;img onerror=alert(1)&gt;');
    assert.equal(Rules.safeURL('javascript:alert(1)'), '');
    assert.match(Rules.safeURL('https://example.com/dates'), /^https:\/\/example\.com/);
});

test('written feedback is prefilled into GitHub without sending its text to analytics', () => {
    const url = new URL(App.buildFeedbackIssueURL('Please add a venue filter.', {
        deadlineFocus: 'conference',
        pageURL: 'https://awsaf49.github.io/paperrush/'
    }));

    assert.equal(url.origin + url.pathname, 'https://github.com/awsaf49/paperrush/issues/new');
    assert.equal(url.searchParams.get('title'), '[Feedback] PaperRush note');
    assert.match(url.searchParams.get('body'), /Please add a venue filter\./);
    assert.match(url.searchParams.get('body'), /Deadline view: conference/);
    assert.match(url.searchParams.get('body'), /awsaf49\.github\.io\/paperrush/);
    assert.equal(url.searchParams.get('labels'), 'feedback');
});
