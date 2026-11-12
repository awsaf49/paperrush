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

test('submission opening dates never become author deadline countdowns', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    const opening = { type: 'paper', label: 'Paper Submission Opens', date: '2027-01-08' };
    const abstract = { type: 'abstract', label: 'Abstract Submission', date: '2027-01-14' };
    assert.equal(Rules.canonicalType(opening), 'event');
    assert.equal(Rules.isPrimarySubmissionDeadline(opening), false);
    assert.equal(App.findActiveDeadline([opening, abstract], now), abstract);
});

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

test('conference share URLs preserve the selected deadline focus', () => {
    App.activeDeadlineFilter = 'abstract';
    const url = new URL(App.buildConferenceURL(
        { id: 'iclr-2027' },
        'https://awsaf49.github.io/paperrush/?utm_source=test'
    ));

    assert.equal(url.searchParams.get('conference'), 'iclr-2027');
    assert.equal(url.searchParams.get('focus'), 'abstract');
    assert.equal(url.searchParams.get('utm_source'), 'test');
});

test('Rush Radar keeps estimated dates out of deadline-spacing comparisons', () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const conferences = [
        {
            id: 'iclr-2027', name: 'ICLR', year: 2027,
            activeDeadline: { type: 'abstract', label: 'Abstract', date: '2026-09-19T23:59:00-12:00', estimated: true }
        },
        {
            id: 'aistats-2027', name: 'AISTATS', year: 2027,
            activeDeadline: { type: 'abstract', label: 'Abstract', date: '2026-09-25T23:59:00-12:00', estimated: true }
        },
        {
            id: 'icml-2027', name: 'ICML', year: 2027,
            activeDeadline: { type: 'paper', label: 'Paper', date: '2027-01-28T23:59:00-12:00', estimated: false }
        }
    ];

    const analysis = App.analyzeRush(conferences, now);

    assert.equal(analysis.state, 'schedule');
    assert.equal(analysis.title, 'Next estimated deadline');
    assert.deepEqual(analysis.pair.map(conference => conference.name), ['ICLR']);
    assert.match(analysis.summary, /is estimated for Sep 19 '26\./);
    assert.equal(analysis.gapDays, undefined);
});

test('Rush Radar shows the next saved deadline for the CVPR and ICLR next-cycle selection', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const conferences = [
        { id: 'cvpr-2027', name: 'CVPR', year: 2027,
          activeDeadline: { type: 'abstract', label: 'Paper Registration Deadline', date: '2026-11-10T23:59:00-12:00' } },
        { id: 'iclr-2028', name: 'ICLR', year: 2028,
          activeDeadline: { type: 'abstract', label: 'Abstract Submission', date: '2027-09-18T23:59:00-12:00', estimated: true } }
    ];

    const analysis = App.analyzeRush(conferences, now);

    assert.equal(analysis.state, 'schedule');
    assert.equal(analysis.title, 'Next saved deadline');
    assert.equal(analysis.summary, "CVPR 2027 Paper Registration Deadline is due Nov 10 '26.");
    assert.equal(analysis.gapDays, undefined);
    assert.doesNotMatch(analysis.summary, /312|breathing room/);

    conferences[1].activeDeadline.estimated = false;
    assert.equal(App.analyzeRush(conferences, now).state, 'schedule');
});

test('Rush Radar compares nearby confirmed deadlines even with a closer estimated date', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const conferences = [
        { id: 'first-2027', name: 'First', year: 2027,
          activeDeadline: { type: 'paper', label: 'Paper Submission', date: '2026-11-10T23:59:00-12:00' } },
        { id: 'estimated-2027', name: 'Estimated', year: 2027,
          activeDeadline: { type: 'paper', label: 'Paper Submission', date: '2026-11-11T23:59:00-12:00', estimated: true } },
        { id: 'second-2027', name: 'Second', year: 2027,
          activeDeadline: { type: 'paper', label: 'Paper Submission', date: '2026-11-16T23:59:00-12:00' } }
    ];

    const analysis = App.analyzeRush(conferences, now);

    assert.equal(analysis.state, 'tight');
    assert.equal(analysis.title, '6 days between deadlines');
    assert.equal(analysis.gapDays, 6);
    assert.equal(analysis.estimated, false);
    assert.deepEqual(analysis.pair.map(conference => conference.name), ['First', 'Second']);
});

test('My Rush share links are stable, focused, and do not retain an open card', () => {
    const url = new URL(App.buildRushURL([
        { id: 'iclr-2027', name: 'ICLR' },
        { id: 'aaai-2027', name: 'AAAI' },
        { id: 'iclr-2027', name: 'ICLR' }
    ], 'https://awsaf49.github.io/paperrush/?conference=kdd-2027&utm_source=test'));

    assert.equal(url.searchParams.get('rush'), 'aaai,iclr');
    assert.equal(url.searchParams.get('focus'), 'submissions');
    assert.equal(url.searchParams.get('ref'), 'rush-share');
    assert.equal(url.searchParams.get('conference'), null);
    assert.equal(url.searchParams.get('utm_source'), 'test');
});

test('calendar links preserve deadline instants and date-only event ranges', () => {
    const conference = {
        id: 'sample-2027',
        name: 'SAMPLE',
        year: 2027,
        website: 'https://example.com/2027',
        location: { city: 'Montréal', country: 'Canada' },
        links: {}
    };
    const paper = {
        type: 'paper',
        label: 'Paper Submission',
        date: '2026-09-24T23:59:00-12:00',
        estimated: true
    };
    const event = {
        type: 'conference',
        label: 'Main Conference',
        date: '2027-04-26',
        endDate: '2027-04-30'
    };

    const google = new URL(App.buildGoogleCalendarURL(conference, paper));
    assert.equal(google.searchParams.get('dates'), '20260925T115900Z/20260925T122900Z');
    assert.match(google.searchParams.get('text'), /^\[Estimated\]/);

    const ics = App.buildICS(conference, event, new Date('2026-07-26T12:00:00Z'));
    assert.match(ics, /DTSTART;VALUE=DATE:20270426/);
    assert.match(ics, /DTEND;VALUE=DATE:20270501/);
    assert.match(ics, /URL:https:\/\/example\.com\/2027/);
});
