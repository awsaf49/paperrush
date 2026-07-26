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

test('estimated leaf pages are explicit, canonical, and do not claim Event markup', () => {
    const entry = selectActiveConferences(new Date('2026-07-26T12:00:00Z'))
        .find(candidate => candidate.conference.id === 'iclr-2027');
    const html = renderConferencePage(entry, new Date('2026-07-26T12:00:00Z'));

    assert.match(html, /<link rel="canonical" href="https:\/\/awsaf49\.github\.io\/paperrush\/conferences\/iclr-2027\/">/);
    assert.match(html, /Estimated from the previous edition/);
    assert.match(html, /Official conference page/);
    assert.match(html, /data-countdown-date="2026-09-19T23:59:00-12:00" data-estimated="true"/);
    assert.match(html, /src="\.\.\/\.\.\/js\/conference-page\.js" defer/);
    assert.doesNotMatch(html, /"@type": "Event"/);
});
