const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatDate,
    selectActiveConferences,
    renderConferencePage
} = require('../scripts/generate_conference_pages.js');

test('generated conference dates preserve the published timezone', () => {
    assert.equal(
        formatDate('2026-09-24T23:59:00-12:00'),
        'Sep 24, 2026 at 23:59 (UTC-12:00)'
    );
    assert.equal(
        formatDate('2027-04-26', '2027-04-30'),
        'Apr 26, 2027 – Apr 30, 2027'
    );
});

test('the generated directory resolves to one active page per conference series', () => {
    const entries = selectActiveConferences(new Date('2026-07-26T12:00:00Z'));
    const names = entries.map(entry => entry.conference.name.toLowerCase());

    assert.equal(entries.length, 27);
    assert.equal(new Set(names).size, entries.length);
    assert(entries.every(entry => entry.conference.id.endsWith(`-${entry.conference.year}`)));
});

test('confirmed leaf pages use official dates and canonical sources', () => {
    const entry = selectActiveConferences(new Date('2026-07-26T12:00:00Z'))
        .find(candidate => candidate.conference.id === 'iclr-2027');
    const html = renderConferencePage(entry, new Date('2026-07-26T12:00:00Z'));

    assert.match(html, /<link rel="canonical" href="https:\/\/awsaf49\.github\.io\/paperrush\/conferences\/iclr-2027\/">/);
    assert.match(html, /Published conference data/);
    assert.match(html, /Official deadline source/);
    assert.match(html, /data-countdown-date="2026-09-18T23:59:00-12:00" data-estimated="false"/);
    assert.match(html, /src="\.\.\/\.\.\/js\/conference-page\.js" defer/);
});

test('rolled estimates label prior-edition evidence without claiming it is current', () => {
    const conference = {
        id: 'sample-2027',
        name: 'SAMPLE',
        fullName: 'Sample Conference',
        year: 2027,
        category: 'ml',
        location: { city: 'TBD', country: 'TBD' },
        links: { previousEdition: 'https://example.com/2026' },
        deadlines: [{
            type: 'paper',
            label: 'Paper Submission',
            date: '2027-05-01',
            estimated: true
        }],
        activeDeadline: {
            type: 'paper',
            label: 'Paper Submission',
            date: '2027-05-01',
            estimated: true
        },
        isEstimated: true
    };
    const html = renderConferencePage(
        { source: conference, conference },
        new Date('2026-07-26T12:00:00Z')
    );

    assert.match(html, /href="https:\/\/example\.com\/2026"[^>]*>Previous edition source/);
    assert.doesNotMatch(html, />Official conference page/);
});
