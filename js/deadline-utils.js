/**
 * Shared deadline classification, date, and safety helpers.
 */
const DeadlineRules = {
    FOCUS_LABELS: {
        submissions: 'Paper + abstract',
        paper: 'Paper only',
        abstract: 'Abstract only',
        conference: 'Conference dates',
        all: 'All dates'
    },

    PRIMARY_EXCLUSIONS: [
        'workshop', 'tutorial', 'demo', 'dataset', 'benchmark', 'position',
        'art ', 'art submission', 'education', 'industry', 'doctoral',
        'student', 'competition', 'affinity', 'show and tell', 'social',
        'reviewer', 'review', 'bidding', 'camera', 'notification', 'decision',
        'rebuttal', 'conference', 'journal', 'presentation request', 'one-page',
        'late breaking', 'revision'
    ],

    canonicalType(deadline) {
        const type = String(deadline?.type || '').toLowerCase();
        const label = String(deadline?.label || '').toLowerCase();

        if (this.isConferenceEvent(deadline)) return 'conference';
        if (/camera[ -]?ready|final (version|manuscript)/.test(label)) return 'camera';
        if (/notification|decision|acceptance|accepted|rejection|results? released/.test(label)) return 'notification';
        if (/rebuttal|author response|author feedback|reviews released/.test(label)) return 'rebuttal';
        if (/workshop/.test(label) || type === 'workshop') return 'workshop';
        if (/tutorial/.test(label) || type === 'tutorial') return 'tutorial';
        if (/paper (and|&) supplement.*submission/.test(label)) return 'paper';
        if (/supplement|video submission/.test(label) || type === 'supplementary') return 'supplementary';
        if (/abstract/.test(label) || /paper (registration|enrollment)/.test(label)) return 'abstract';
        if (/paper|submission/.test(label) || type === 'paper') return 'paper';
        if (['abstract', 'notification', 'rebuttal', 'camera'].includes(type)) return type;
        return type || 'event';
    },

    isConferenceEvent(deadline) {
        const type = String(deadline?.type || '').toLowerCase();
        const label = String(deadline?.label || '').toLowerCase().trim();
        if (type === 'conference') return true;
        if (type !== 'event') return false;
        if (/deadline|submission|registration|notification|proposal|application|profile|site|discussion|review/.test(label)) {
            return false;
        }
        return Boolean(deadline?.endDate) && /conference|annual meeting|main event/.test(label) ||
            /^(main )?conference( dates?)?$/.test(label) ||
            /^[a-z0-9-]+ conference$/.test(label);
    },

    isPrimarySubmissionDeadline(deadline) {
        const type = this.canonicalType(deadline);
        if (type !== 'paper' && type !== 'abstract') return false;

        const label = String(deadline?.label || '').toLowerCase();
        return !this.PRIMARY_EXCLUSIONS.some(term => label.includes(term));
    },

    matchesFocus(deadline, focus) {
        const type = this.canonicalType(deadline);
        if (focus === 'all') return true;
        if (focus === 'conference') return type === 'conference';
        if (!this.isPrimarySubmissionDeadline(deadline)) return false;
        if (focus === 'paper') return type === 'paper';
        if (focus === 'abstract') return type === 'abstract';
        return type === 'paper' || type === 'abstract';
    },

    parseDate(value, endOfDay = true) {
        if (!value || typeof value !== 'string') return null;
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
        const parsed = new Date(dateOnly
            ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
            : value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    },

    isPassed(deadline, now = new Date()) {
        const isConference = this.canonicalType(deadline) === 'conference';
        const comparisonValue = isConference && deadline.endDate
            ? deadline.endDate
            : deadline.date;
        const comparisonDate = this.parseDate(comparisonValue, true);
        return !comparisonDate || comparisonDate <= now;
    },

    isOngoing(deadline, now = new Date()) {
        if (this.canonicalType(deadline) !== 'conference') return false;
        const starts = this.parseDate(deadline.date, false);
        const ends = this.parseDate(deadline.endDate || deadline.date, true);
        return Boolean(starts && ends && starts <= now && now <= ends);
    },

    countdownTarget(deadline) {
        const startsAtBeginning = this.canonicalType(deadline) === 'conference';
        return this.parseDate(deadline.date, !startsAtBeginning) || deadline.date;
    },

    normalizeLabel(label) {
        return String(label || '')
            .toLowerCase()
            .replace(/\b(deadline|due|date)\b/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    },

    deduplicateDeadlines(deadlines) {
        const bestByKey = new Map();

        (deadlines || []).forEach(deadline => {
            const type = this.canonicalType(deadline);
            const parsed = this.parseDate(deadline.date, type !== 'conference');
            if (!parsed) return;

            const semantic = this.isPrimarySubmissionDeadline(deadline)
                ? type
                : `${type}:${this.normalizeLabel(deadline.label)}`;
            const key = `${semantic}:${parsed.toISOString()}`;
            const normalized = { ...deadline, type };
            const existing = bestByKey.get(key);

            if (!existing || this.deadlineQuality(normalized) > this.deadlineQuality(existing)) {
                bestByKey.set(key, normalized);
            }
        });

        return [...bestByKey.values()].sort((a, b) =>
            this.parseDate(a.date, this.canonicalType(a) !== 'conference') -
            this.parseDate(b.date, this.canonicalType(b) !== 'conference')
        );
    },

    deadlineQuality(deadline) {
        let score = deadline.estimated ? 0 : 4;
        if (/T\d{2}:\d{2}/.test(deadline.date || '')) score += 2;
        if (/[+-]\d{2}:\d{2}$|Z$/.test(deadline.date || '')) score += 2;
        if (deadline.endDate) score += 1;
        return score - String(deadline.label || '').length / 1000;
    },

    escapeHTML(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    },

    safeURL(value) {
        if (!value) return '';
        try {
            const url = new URL(value, typeof window !== 'undefined' ? window.location.href : 'https://example.com');
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch (_error) {
            return '';
        }
    }
};

if (typeof globalThis !== 'undefined') {
    globalThis.DeadlineRules = DeadlineRules;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeadlineRules;
}
