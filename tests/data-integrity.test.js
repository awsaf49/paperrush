const test = require('node:test');
const assert = require('node:assert/strict');

global.DeadlineRules = require('../js/deadline-utils.js');
global.CONFERENCES_DATA = require('../js/data.js').CONFERENCES_DATA;
const App = require('../js/app.js');

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

    const iclr = App.conferences.find(conf => conf.id === 'iclr-2027');
    assert.ok(iclr, 'ICLR 2027 should be visible in Paper + abstract');
    const iclrAbstract = iclr.deadlines.find(deadline => deadline.type === 'abstract');
    const iclrPaper = iclr.deadlines.find(deadline => deadline.type === 'paper');
    assert.equal(iclrAbstract.date, '2026-09-18T23:59:00-12:00');
    assert.equal(iclrPaper.date, '2026-09-25T23:59:00-12:00');
    assert.equal(iclrAbstract.estimated, false);
    assert.equal(iclrPaper.estimated, false);
    const publishedIclr = global.CONFERENCES_DATA.conferences.find(conf => conf.id === 'iclr-2027');
    const iclrConference = publishedIclr.deadlines.find(deadline => deadline.type === 'conference');
    assert.equal(iclrConference.date, '2027-04-26');
    assert.equal(iclrConference.endDate, '2027-04-28');
    assert.equal(publishedIclr.location.city, 'California');
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
    const byName = new Map(global.CONFERENCES_DATA.conferences.map(conf => [conf.name, conf]));
    const additions = ['IJCAI', 'MLSys', 'CoRL', 'COLT', 'MICCAI', 'BMVC', '3DV'];

    additions.forEach(name => assert.ok(byName.has(name), `${name} is missing from published data`));

    ['IJCAI', 'MLSys', 'CoRL', 'COLT', 'BMVC'].forEach(name => {
        const rolled = App.resolveSubmissionEdition(
            byName.get(name),
            new Date('2026-07-26T12:00:00Z')
        );
        assert.equal(rolled.year, 2027, `${name} did not roll to its next submission cycle`);
        assert.ok(rolled.deadlines.every(deadline => deadline.estimated));
    });

    const miccai = byName.get('MICCAI');
    assert.ok(miccai.deadlines.some(deadline =>
        deadline.type === 'conference' && !deadline.estimated && deadline.date === '2027-09-26'
    ));
    assert.ok(miccai.deadlines.filter(global.DeadlineRules.isPrimarySubmissionDeadline.bind(global.DeadlineRules))
        .every(deadline => deadline.estimated));

    const threeDvPaper = byName.get('3DV').deadlines.find(deadline => deadline.type === 'paper');
    assert.equal(threeDvPaper.date, '2026-08-28T11:00:00-07:00');
    assert.equal(threeDvPaper.estimated, false);
});
