const test = require('node:test');
const assert = require('node:assert/strict');

global.DeadlineRules = require('../js/deadline-utils.js');
global.CONFERENCES_DATA = require(process.env.PAPERRUSH_DATA_FILE || '../js/data.js').CONFERENCES_DATA;
const App = require('../js/app.js');

test('data freshness exposes healthy, overdue, and stale weekly updates', () => {
    const now = new Date('2026-09-16T12:00:00Z');

    assert.equal(App.getDataFreshness('2026-09-08T12:00:00Z', now).level, 'fresh');
    assert.equal(App.getDataFreshness('2026-09-07T12:00:00Z', now).level, 'late');
    assert.equal(App.getDataFreshness('2026-09-01T12:00:00Z', now).level, 'stale');
    assert.equal(App.getDataFreshness('not-a-date', now).relativeLabel, 'Unknown');
});

test('published data resolves to safe active primary dates', () => {
    App.activeDeadlineFilter = 'submissions';
    App.loadData();

    assert.ok(App.conferences.length > 0);
    assert.equal(new Set(App.conferences.map(conf => conf.name.toLowerCase())).size, App.conferences.length);

    App.conferences.forEach(conf => {
        assert.ok(conf.activeDeadline, `${conf.id} has no active submission milestone`);
        if (conf.activeDeadline.estimated) {
            assert.equal(conf.isEstimated, true, `${conf.id} does not label its estimate`);
        }
        assert.equal(
            global.DeadlineRules.isPassed(conf.activeDeadline),
            false,
            `${conf.id} uses a passed countdown`
        );
    });

    // Protect known facts while that edition exists, even after submissions close.
    const iclr = global.CONFERENCES_DATA.conferences.find(conf => conf.id === 'iclr-2027');
    if (!iclr) return;
    const iclrAbstract = iclr.deadlines.find(deadline => deadline.type === 'abstract');
    const iclrPaper = iclr.deadlines.find(deadline => deadline.type === 'paper');
    assert.equal(iclrAbstract.date, '2026-09-18T23:59:00-12:00');
    assert.equal(iclrPaper.date, '2026-09-25T23:59:00-12:00');
    assert.equal(iclrAbstract.estimated, false);
    assert.equal(iclrPaper.estimated, false);
    const iclrConference = iclr.deadlines.find(deadline => deadline.type === 'conference');
    assert.equal(iclrConference.date, '2027-04-26');
    assert.equal(iclrConference.endDate, '2027-04-28');
    assert.equal(iclr.location.city, 'California');
});

test('conference focus exposes only confirmed upcoming event ranges', () => {
    App.loadData();
    App.selectDeadlineFocus('conference');

    App.conferences.forEach(conf => {
        assert.ok(conf.deadlines.length > 0);
        conf.deadlines.forEach(deadline => {
            assert.equal(global.DeadlineRules.canonicalType(deadline), 'conference');
            assert.equal(deadline.estimated, false);
            assert.equal(global.DeadlineRules.isPassed(deadline), false);
        });
    });
});

test('agreed conference expansion has verified or clearly estimated milestones', () => {
    const byName = new Map();
    global.CONFERENCES_DATA.conferences.forEach(conf => {
        if (!byName.has(conf.name) || byName.get(conf.name).year < conf.year) {
            byName.set(conf.name, conf);
        }
    });
    const byId = new Map(global.CONFERENCES_DATA.conferences.map(conf => [conf.id, conf]));
    const additions = ['IJCAI', 'MLSys', 'CoRL', 'COLT', 'MICCAI', 'BMVC', '3DV'];

    additions.forEach(name => assert.ok(byName.has(name), `${name} is missing from published data`));

    ['IJCAI', 'MLSys', 'CoRL', 'COLT', 'BMVC'].forEach(name => {
        const source = byName.get(name);
        const rolled = App.resolveSubmissionEdition(source);
        const primaryDeadlines = rolled.deadlines.filter(deadline =>
            global.DeadlineRules.isPrimarySubmissionDeadline(deadline)
        );
        const estimationStates = new Set(
            primaryDeadlines.map(deadline => Boolean(deadline.estimated))
        );

        assert.ok(rolled.year >= source.year, `${name} rolled backwards`);
        if (rolled.datesTBD) {
            assert.equal(primaryDeadlines.length, 0, `${name} marks TBA but publishes dates`);
            assert.equal(rolled.isEstimated, true);
            return;
        }
        assert.ok(primaryDeadlines.length > 0, `${name} has no main submission deadline`);
        assert.equal(estimationStates.size, 1, `${name} mixes confirmed and estimated main dates`);
        assert.equal(Boolean(rolled.isEstimated), estimationStates.has(true));
    });

    const miccai = byId.get('miccai-2027');
    if (miccai) {
        assert.ok(miccai.deadlines.some(deadline =>
            deadline.type === 'conference' && !deadline.estimated && deadline.date === '2027-09-26'
        ));
    }

    const threeDv = byId.get('3dv-2027');
    if (threeDv) {
        const threeDvPaper = threeDv.deadlines.find(deadline => deadline.type === 'paper');
        assert.equal(threeDvPaper.date, '2026-08-28T11:00:00-07:00');
        assert.equal(threeDvPaper.estimated, false);
    }
});
