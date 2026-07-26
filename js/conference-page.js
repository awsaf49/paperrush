(() => {
    const DAY = 86_400_000;

    function targetDate(value) {
        if (!value) return null;
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
        const target = new Date(dateOnly ? `${value}T23:59:59` : value);
        return Number.isNaN(target.getTime()) ? null : target;
    }

    function countdown(value, estimated) {
        const target = targetDate(value);
        if (!target) return 'Date to be announced';

        const remaining = target.getTime() - Date.now();
        if (remaining <= 0) return 'Passed';

        const days = Math.ceil(remaining / DAY);
        if (days > 60) {
            const months = Math.max(1, Math.round(days / 30.44));
            return `in ${estimated ? '~' : ''}${months} month${months === 1 ? '' : 's'}`;
        }
        return `in ${estimated ? '~' : ''}${days} day${days === 1 ? '' : 's'}`;
    }

    function refreshCountdowns() {
        document.querySelectorAll('[data-countdown-date]').forEach(element => {
            element.textContent = countdown(
                element.dataset.countdownDate,
                element.dataset.estimated === 'true'
            );
        });
    }

    refreshCountdowns();
    window.setInterval(refreshCountdowns, 60_000);
})();
