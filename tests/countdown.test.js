const test = require('node:test');
const assert = require('node:assert/strict');
const CountdownTimer = require('../js/countdown.js');

function countdownContainer() {
    return {
        className: '',
        innerHTML: '',
        title: '',
        closest: () => null
    };
}

test('estimated deadlines render a relative countdown with an approximate marker', () => {
    const container = countdownContainer();
    const deadline = new Date(Date.now() + (75 * 24 * 60 * 60 * 1000));

    const result = CountdownTimer.updateDisplay(container, deadline, { approximate: true });

    assert.equal(result.remaining.isPassed, false);
    assert.match(container.className, /approximate/);
    assert.match(container.innerHTML, /countdown-estimated[^>]*>~<\/span>/);
    assert.match(container.innerHTML, /countdown-unit/);
    assert.match(container.title, /Approximate countdown/);
});

test('confirmed deadlines do not show the approximate marker', () => {
    const container = countdownContainer();
    const deadline = new Date(Date.now() + (10 * 24 * 60 * 60 * 1000));

    CountdownTimer.updateDisplay(container, deadline);

    assert.doesNotMatch(container.className, /approximate/);
    assert.doesNotMatch(container.innerHTML, />~<\/span>/);
    assert.equal(container.title, '');
});
