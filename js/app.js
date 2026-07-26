/**
 * PaperRush - Main Application
 * Conference Deadline Tracker
 */

const Rules = typeof globalThis !== 'undefined' && globalThis.DeadlineRules
    ? globalThis.DeadlineRules
    : require('./deadline-utils.js');

const App = {
    catalog: [],
    conferences: [],
    filteredConferences: [],
    activeFilter: 'all',
    activeDeadlineFilter: 'submissions',
    searchQuery: '',
    hasAnimated: false,
    viewMode: 'card', // 'card' or 'calendar'
    savedConferences: new Set(),
    showSavedOnly: false,
    currentModalConference: null,
    heroTimer: null,
    calendarAssetsPromise: null,
    sharedRushSlugs: new Set(),
    rushRadarSignature: '',

    /**
     * Initialize the application
     */
    async init() {
        try {
            console.log('PaperRush initializing...');

            this.loadSavedConferences();
            this.loadSharedRush();

            // Load data
            this.loadData();

            // Set up event listeners
            this.setupFilters();
            this.setupDeadlineFilters();
            this.setupSearch();
            this.setupViewToggle();
            this.setupMobileFilters();
            this.setupSavedFilters();
            this.setupRushRadar();
            this.setupHero();
            this.setupFeedback();

            // Initialize modal
            this.initModal();

            // Update category counts
            this.updateCategoryCounts();

            // Render conferences
            this.render();

            // Deep links open the requested card after it exists in the grid.
            this.openConferenceFromURL();

            // Initialize timeline
            TimelineDrawer.init();

            // Update last updated date
            this.updateLastUpdated();

            // Update filter indicator position
            this.updateFilterIndicator();

            // Hide loading state
            document.body.classList.add('app-ready');
            document.getElementById('loading-state').classList.add('hidden');

            console.log('PaperRush ready.');
        } catch (error) {
            console.error('❌ Error initializing app:', error);
            // Still hide loading and show error
            const loadingState = document.getElementById('loading-state');
            if (loadingState) {
                loadingState.textContent = 'PaperRush could not load. Please refresh or report this issue.';
                loadingState.style.color = 'red';
            }
        }
    },
    
    /**
     * Load conference data
     */
    loadData() {
        const now = new Date();
        const normalized = CONFERENCES_DATA.conferences.map(conf => ({
            ...conf,
            deadlines: Rules.deduplicateDeadlines(conf.deadlines)
        }));

        // Keep both views of each series. Submission mode can safely advance
        // to the next edition while conference mode retains a still-upcoming
        // event from the current edition.
        const seriesByName = new Map();
        normalized.forEach(source => {
            const key = source.name.toLowerCase();
            if (!seriesByName.has(key)) seriesByName.set(key, []);
            seriesByName.get(key).push(source);
        });

        this.catalog = [...seriesByName.values()].map(editions => {
            const source = this.chooseSubmissionSource(editions, now);
            return {
                source,
                event: this.chooseEventSource(editions, now),
                submission: this.resolveSubmissionEdition(source, now)
            };
        });
        this.selectDeadlineFocus(this.activeDeadlineFilter, now);
    },

    chooseSubmissionSource(editions, now = new Date()) {
        const withActiveSubmission = editions.map(source => ({
            source,
            active: source.deadlines
                .filter(deadline => this.isSubmissionDeadline(deadline) &&
                    !deadline.estimated && !Rules.isPassed(deadline, now))
                .sort((a, b) => Rules.countdownTarget(a) - Rules.countdownTarget(b))[0]
        })).filter(candidate => candidate.active);

        if (withActiveSubmission.length > 0) {
            return withActiveSubmission.sort((a, b) =>
                Rules.countdownTarget(a.active) - Rules.countdownTarget(b.active)
            )[0].source;
        }

        return [...editions].sort((a, b) =>
            b.year - a.year || Number(Boolean(a.isEstimated)) - Number(Boolean(b.isEstimated))
        )[0];
    },

    chooseEventSource(editions, now = new Date()) {
        const withUpcomingEvent = editions.map(source => ({
            source,
            active: source.deadlines
                .filter(deadline => Rules.matchesFocus(deadline, 'conference') &&
                    !deadline.estimated && !Rules.isPassed(deadline, now))
                .sort((a, b) => Rules.countdownTarget(a) - Rules.countdownTarget(b))[0]
        })).filter(candidate => candidate.active);

        if (withUpcomingEvent.length > 0) {
            return withUpcomingEvent.sort((a, b) =>
                Rules.countdownTarget(a.active) - Rules.countdownTarget(b.active)
            )[0].source;
        }

        return this.chooseSubmissionSource(editions, now);
    },

    shouldPreferConference(candidate, existing) {
        return candidate.year > existing.year ||
            (candidate.year === existing.year && existing.isEstimated && !candidate.isEstimated) ||
            (candidate.year === existing.year &&
                Boolean(existing.isEstimated) === Boolean(candidate.isEstimated) &&
                candidate.deadlines.length > existing.deadlines.length);
    },

    resolveSubmissionEdition(conf, now = new Date()) {
        const primaryDeadlines = conf.deadlines.filter(deadline =>
            this.isSubmissionDeadline(deadline)
        );
        const hasPrimaryDeadlines = primaryDeadlines.length > 0;
        if (hasPrimaryDeadlines && primaryDeadlines.every(deadline => deadline.estimated)) {
            if (conf.year <= now.getUTCFullYear() &&
                primaryDeadlines.every(deadline => Rules.isPassed(deadline, now))) {
                return this.createNextYearConference(conf, now);
            }
            return {
                ...conf,
                // An estimated submission cycle must not expose author rules
                // copied from a previous edition.
                info: {},
                datesTBD: false,
                isEstimated: true
            };
        }

        const shouldRoll = hasPrimaryDeadlines
            ? this.allDeadlinesPassed(conf.deadlines, now)
            : conf.year <= now.getUTCFullYear();
        return shouldRoll ? this.createNextYearConference(conf, now) : conf;
    },

    selectDeadlineFocus(focus, now = new Date()) {
        this.activeDeadlineFilter = Rules.FOCUS_LABELS[focus] ? focus : 'submissions';
        const selected = [];

        this.catalog.forEach(({ source, event, submission }) => {
            const base = this.activeDeadlineFilter === 'conference'
                ? event || source
                : this.activeDeadlineFilter === 'all' ? source : submission;
            const visibleDeadlines = base.deadlines.filter(deadline =>
                Rules.matchesFocus(deadline, this.activeDeadlineFilter)
            );

            if (this.activeDeadlineFilter === 'conference') {
                const upcomingEvents = visibleDeadlines.filter(deadline =>
                    !deadline.estimated && !Rules.isPassed(deadline, now)
                );
                if (upcomingEvents.length === 0) return;
                visibleDeadlines.splice(0, visibleDeadlines.length, ...upcomingEvents);
            } else if (['submissions', 'paper', 'abstract'].includes(this.activeDeadlineFilter) &&
                !visibleDeadlines.some(deadline =>
                    !Rules.isPassed(deadline, now)
                )) {
                return;
            } else if (visibleDeadlines.length === 0) {
                return;
            }

            const activeDeadline = this.findActiveDeadline(
                visibleDeadlines,
                now,
                this.activeDeadlineFilter
            );
            selected.push({
                ...base,
                deadlines: visibleDeadlines,
                allDeadlines: base.deadlines,
                isEstimated: visibleDeadlines.length > 0 &&
                    visibleDeadlines.every(deadline => deadline.estimated),
                activeDeadline,
                sortDate: activeDeadline
                    ? Rules.countdownTarget(activeDeadline)
                    : new Date('2099-12-31')
            });
        });

        this.conferences = selected;
        this.sortConferences();
        this.filteredConferences = [...this.conferences];
    },
    
    /**
     * Check whether the main author submission window has closed
     * @param {Array} deadlines - Array of deadline objects
     * @param {Date} now - Current time, injectable for tests
     * @returns {boolean} True if no main submission deadline remains
     */
    allDeadlinesPassed(deadlines, now = new Date()) {
        const submissionDeadlines = deadlines.filter(deadline =>
            this.isSubmissionDeadline(deadline) && !deadline.estimated
        );

        return submissionDeadlines.length === 0 ||
            submissionDeadlines.every(deadline => Rules.isPassed(deadline, now));
    },

    /**
     * Identify main-track, author-facing submission deadlines.
     * Administrative, review, workshop, and conference-event dates must not
     * keep an obsolete edition on the site.
     */
    isSubmissionDeadline(deadline) {
        return Rules.isPrimarySubmissionDeadline(deadline);
    },

    /**
     * Estimate the next edition by shifting main-track dates. Scraped dates
     * replace these records as soon as the new edition is published.
     * @param {Object} conf - Original conference object
     * @returns {Object} New conference with clearly marked approximate dates
     */
    createNextYearConference(conf, now = new Date()) {
        const yearOffset = ['ICCV', 'ECCV'].includes(conf.name.toUpperCase()) ? 2 : 1;
        let nextYear = conf.year + yearOffset;
        while (nextYear <= now.getUTCFullYear()) {
            nextYear += yearOffset;
        }

        const hasVersionedWebsite = new RegExp(`(?:${conf.year}|${String(conf.year).slice(-2)})(?:/|$)`).test(conf.website || '');
        const yearDelta = nextYear - conf.year;
        const estimatedDeadlines = conf.deadlines
            .filter(deadline => this.isSubmissionDeadline(deadline))
            .map(deadline => ({
                ...deadline,
                date: this.shiftDeadlineYear(deadline.date, yearDelta),
                endDate: deadline.endDate
                    ? this.shiftDeadlineYear(deadline.endDate, yearDelta)
                    : deadline.endDate,
                status: 'upcoming',
                estimated: true,
                sourceUrl: undefined,
                url: undefined
            }))
            .filter(deadline => Rules.parseDate(deadline.date));
        
        return {
            ...conf,
            id: `${conf.id.split('-')[0]}-${nextYear}`,
            year: nextYear,
            website: hasVersionedWebsite ? '' : conf.website,
            deadlines: estimatedDeadlines,
            links: {},
            info: {},
            notes: [],
            location: {
                ...conf.location,
                city: 'TBD',
                country: 'TBD',
                flag: '🌍',
                venue: 'TBD'
            },
            activeDeadline: null,
            sortDate: new Date('2099-12-31'),
            isEstimated: true,
            datesTBD: estimatedDeadlines.length === 0
        };
    },

    shiftDeadlineYear(value, yearDelta) {
        if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
        const targetYear = Number(value.slice(0, 4)) + yearDelta;
        let monthDay = value.slice(4, 10);
        if (monthDay === '-02-29' &&
            new Date(Date.UTC(targetYear, 1, 29)).getUTCMonth() !== 1) {
            monthDay = '-02-28';
        }
        return `${targetYear}${monthDay}${value.slice(10)}`;
    },

    formatApproximateDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return String(value || '');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[Number(match[2]) - 1]} ${match[3]} '${match[1].slice(2)}`;
    },
    
    /**
     * Find the next active (not passed) deadline
     * @param {Array} deadlines - Array of deadline objects
     * @returns {Object|null} Active deadline or null
     */
    findActiveDeadline(deadlines, now = new Date(), focus = 'submissions') {

        // Sort all deadlines by date first
        const sortedDeadlines = deadlines.filter(deadline =>
            Rules.matchesFocus(deadline, focus)
        ).sort((a, b) =>
            Rules.countdownTarget(a) - Rules.countdownTarget(b)
        );

        // Find first non-passed deadline
        for (const deadline of sortedDeadlines) {
            if (!Rules.isPassed(deadline, now)) {
                return deadline;
            }
        }

        // The next edition should be shown once author submissions close.
        return null;
    },
    
    /**
     * Sort conferences by next deadline
     */
    sortConferences() {
        this.conferences.sort((a, b) => a.sortDate - b.sortDate);
    },
    
    /**
     * Set up filter button event listeners
     */
    setupFilters() {
        const filterButtons = document.querySelectorAll('.filter-pill');

        filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Update active state
                filterButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                // Apply filter
                this.activeFilter = button.dataset.category;
                this.applyFilter();

                this.trackEvent('category_filter_changed', {
                    category: this.activeFilter,
                    deadline_focus: this.activeDeadlineFilter
                });

                // Update indicator position
                this.updateFilterIndicator();
            });
        });
    },

    /**
     * Set up the research-milestone filter. Paper + abstract is the default,
     * while conference mode deliberately keeps upcoming event editions.
     */
    setupDeadlineFilters() {
        const buttons = document.querySelectorAll('.deadline-filter-pill');
        let requestedFocus = null;

        try {
            requestedFocus = new URLSearchParams(window.location.search).get('focus') ||
                window.localStorage.getItem('paperrush-deadline-focus');
        } catch (_error) {
            // Storage can be disabled without affecting the filter.
        }

        if (Rules.FOCUS_LABELS[requestedFocus] && requestedFocus !== this.activeDeadlineFilter) {
            this.selectDeadlineFocus(requestedFocus);
            this.updateCategoryCounts();
            this.applyFilter();
        }

        const updateUI = () => {
            buttons.forEach(button => {
                const active = button.dataset.deadlineFilter === this.activeDeadlineFilter;
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            const summary = document.getElementById('deadline-filter-summary');
            if (summary) {
                summary.textContent = `${this.conferences.length} conference${this.conferences.length === 1 ? '' : 's'}`;
            }
            requestAnimationFrame(() => this.updateDeadlineFilterIndicator());
        };

        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const focus = button.dataset.deadlineFilter;
                if (!Rules.FOCUS_LABELS[focus]) return;

                this.selectDeadlineFocus(focus);
                this.updateCategoryCounts();
                this.applyFilter();

                try {
                    window.localStorage.setItem('paperrush-deadline-focus', focus);
                    const url = new URL(window.location.href);
                    url.searchParams.set('focus', focus);
                    window.history.replaceState({}, '', url);
                } catch (_error) {
                    // Filtering still works when URL or storage APIs are blocked.
                }

                updateUI();
                this.trackEvent('deadline_filter_changed', { deadline_focus: focus });
            });
        });

        updateUI();
    },

    /**
     * Update the sliding filter indicator position
     */
    updateFilterIndicator() {
        const indicator = document.getElementById('filter-indicator');
        const activeButton = document.querySelector('.filter-pill.active');
        const filterGroup = document.getElementById('filter-group');

        if (!indicator || !activeButton || !filterGroup) return;

        // Only show on desktop
        if (window.innerWidth <= 768) {
            indicator.style.opacity = '0';
            return;
        }

        indicator.style.opacity = '1';

        // Calculate position relative to filter group
        const groupRect = filterGroup.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();

        // Account for filter-group padding (4px)
        const padding = 4;
        const left = buttonRect.left - groupRect.left;
        const width = buttonRect.width;

        indicator.style.width = `${width}px`;
        indicator.style.left = `${left}px`;
        indicator.style.height = `${buttonRect.height}px`;
    },

    updateDeadlineFilterIndicator() {
        const indicator = document.getElementById('deadline-filter-indicator');
        const activeButton = document.querySelector('.deadline-filter-pill.active');
        const filterGroup = document.getElementById('deadline-filter-group');
        if (!indicator || !activeButton || !filterGroup) return;

        const groupRect = filterGroup.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();
        indicator.style.width = `${buttonRect.width}px`;
        indicator.style.left = `${buttonRect.left - groupRect.left + filterGroup.scrollLeft}px`;
        indicator.style.height = `${buttonRect.height}px`;
    },

    setupMobileFilters() {
        const toggle = document.getElementById('filter-drawer-toggle');
        const drawer = document.getElementById('filter-drawer');
        if (!toggle || !drawer) return;

        const setOpen = open => {
            drawer.classList.toggle('open', open);
            toggle.classList.toggle('active', open);
            toggle.setAttribute('aria-expanded', String(open));
        };

        toggle.addEventListener('click', event => {
            event.stopPropagation();
            setOpen(!drawer.classList.contains('open'));
        });
        drawer.addEventListener('click', event => event.stopPropagation());
        document.addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && drawer.classList.contains('open')) {
                setOpen(false);
                toggle.focus();
            }
        });
    },

    conferenceKey(conference) {
        return String(conference?.name || conference || '').trim().toLowerCase();
    },

    loadSavedConferences() {
        try {
            const saved = JSON.parse(window.localStorage.getItem('paperrush-saved') || '[]');
            this.savedConferences = new Set(Array.isArray(saved) ? saved : []);
        } catch (_error) {
            this.savedConferences = new Set();
        }
    },

    loadSharedRush() {
        try {
            const value = new URLSearchParams(window.location.search).get('rush') || '';
            const slugs = value.split(',')
                .map(slug => slug.trim().toLowerCase())
                .filter(slug => /^[a-z0-9-]+$/.test(slug))
                .slice(0, 20);
            this.sharedRushSlugs = new Set(slugs);
        } catch (_error) {
            this.sharedRushSlugs = new Set();
        }
    },

    persistSavedConferences() {
        try {
            window.localStorage.setItem(
                'paperrush-saved',
                JSON.stringify([...this.savedConferences].sort())
            );
        } catch (_error) {
            // Saving is optional; the current session still works without storage.
        }
    },

    isConferenceSaved(conference) {
        return this.savedConferences.has(this.conferenceKey(conference));
    },

    setupSavedFilters() {
        document.querySelectorAll('.saved-filter-toggle').forEach(button => {
            button.addEventListener('click', () => {
                this.showSavedOnly = !this.showSavedOnly;
                this.updateSavedUI();
                this.applyFilter();
                this.trackEvent('saved_filter_changed', {
                    enabled: this.showSavedOnly,
                    saved_count: this.savedConferences.size
                });
            });
        });
        this.updateSavedUI();
    },

    toggleSavedConference(conference) {
        const key = this.conferenceKey(conference);
        if (!key) return false;

        const willSave = !this.savedConferences.has(key);
        if (willSave) {
            this.savedConferences.add(key);
        } else {
            this.savedConferences.delete(key);
        }
        this.persistSavedConferences();
        this.updateSavedUI();
        this.trackEvent('conference_saved', {
            conference: conference.id,
            saved: willSave,
            saved_count: this.savedConferences.size
        });
        return willSave;
    },

    updateSavedUI() {
        document.querySelectorAll('.saved-count').forEach(element => {
            element.textContent = this.savedConferences.size;
        });
        document.querySelectorAll('.saved-filter-toggle').forEach(button => {
            button.classList.toggle('active', this.showSavedOnly);
            button.setAttribute('aria-pressed', String(this.showSavedOnly));
        });

        document.querySelectorAll('.conference-card').forEach(card => {
            const saveButton = card.querySelector('.card-save-button');
            if (!saveButton) return;
            const saved = this.savedConferences.has(this.conferenceKey(card.confData));
            saveButton.classList.toggle('saved', saved);
            saveButton.setAttribute('aria-pressed', String(saved));
            saveButton.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${card.confData.name}`);
        });

        if (this.currentModalConference) {
            const modalSave = document.getElementById('modal-action-save');
            const saved = this.isConferenceSaved(this.currentModalConference);
            modalSave?.classList.toggle('saved', saved);
            modalSave?.setAttribute('aria-pressed', String(saved));
            const label = modalSave?.querySelector('span');
            if (label) label.textContent = saved ? 'Saved' : 'Save';
        }

        this.updateRushRadar();
    },

    seriesSlug(conference) {
        const id = String(conference?.id || '');
        const fromId = id.replace(/-\d{4}$/, '');
        if (fromId) return fromId.toLowerCase();
        return this.conferenceKey(conference).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    },

    categoryColor(category) {
        return {
            ml: '#EF4444',
            cv: '#3B82F6',
            nlp: '#34C759',
            speech: '#FF9500',
            robotics: '#FF2D95',
            other: '#8E8E93'
        }[category] || '#8E8E93';
    },

    getSubmissionConferencePool(now = new Date()) {
        return this.catalog.map(({ submission }) => {
            const deadlines = (submission?.deadlines || []).filter(deadline =>
                Rules.matchesFocus(deadline, 'submissions') && !Rules.isPassed(deadline, now)
            );
            const activeDeadline = this.findActiveDeadline(deadlines, now, 'submissions');
            return activeDeadline ? { ...submission, deadlines, activeDeadline } : null;
        }).filter(Boolean).sort((a, b) =>
            Rules.countdownTarget(a.activeDeadline) - Rules.countdownTarget(b.activeDeadline)
        );
    },

    getRushConferences(now = new Date()) {
        const pool = this.getSubmissionConferencePool(now);
        if (this.sharedRushSlugs.size > 0) {
            return pool.filter(conference => this.sharedRushSlugs.has(this.seriesSlug(conference)));
        }
        return pool.filter(conference => this.isConferenceSaved(conference));
    },

    analyzeRush(conferences, now = new Date()) {
        const milestones = (conferences || []).map(conference => ({
            conference,
            target: Rules.countdownTarget(conference.activeDeadline)
        })).filter(item => item.target instanceof Date && item.target > now)
            .sort((a, b) => a.target - b.target);

        if (milestones.length === 0) {
            return {
                state: 'empty',
                title: 'No active milestones yet',
                summary: 'PaperRush could not find an upcoming paper or abstract date in this selection.'
            };
        }
        if (milestones.length === 1) {
            return {
                state: 'single',
                title: 'One target on your radar',
                summary: 'Save another conference and PaperRush will compare the deadline spacing.',
                pair: [milestones[0].conference],
                estimated: Boolean(milestones[0].conference.activeDeadline?.estimated)
            };
        }

        let closest = null;
        for (let index = 1; index < milestones.length; index += 1) {
            const gap = milestones[index].target - milestones[index - 1].target;
            if (!closest || gap < closest.gap) {
                closest = { gap, pair: [milestones[index - 1], milestones[index]] };
            }
        }

        const gapDays = Math.max(0, Math.round(closest.gap / 86400000));
        const [first, second] = closest.pair.map(item => item.conference);
        const spacing = gapDays === 0
            ? 'fall on the same day'
            : `are ${gapDays} day${gapDays === 1 ? '' : 's'} apart`;
        const estimated = Boolean(first.activeDeadline?.estimated || second.activeDeadline?.estimated);
        const estimateNote = estimated ? ' At least one of these dates is estimated.' : '';
        const title = gapDays <= 7
            ? 'A tight handoff'
            : gapDays <= 21 ? 'A busy stretch' : 'Some breathing room';

        return {
            state: gapDays <= 7 ? 'tight' : gapDays <= 21 ? 'busy' : 'clear',
            title,
            summary: `${first.name} ${first.year} and ${second.name} ${second.year} ${spacing}.${estimateNote}`,
            pair: [first, second],
            gapDays,
            estimated
        };
    },

    setupRushRadar() {
        document.getElementById('rush-radar-share')?.addEventListener('click', () => {
            this.shareRush();
        });
        document.getElementById('rush-radar-download')?.addEventListener('click', () => {
            this.downloadRushCard();
        });
        document.getElementById('rush-radar-import')?.addEventListener('click', () => {
            this.importSharedRush();
        });
        this.updateRushRadar();
    },

    setRushRadarStatus(message) {
        const status = document.getElementById('rush-radar-status');
        if (status) status.textContent = message;
    },

    updateRushRadar(now = new Date()) {
        if (typeof document === 'undefined') return;
        const panel = document.getElementById('rush-radar');
        if (!panel) return;

        const conferences = this.getRushConferences(now);
        if (conferences.length === 0) {
            panel.classList.add('hidden');
            return;
        }

        const shared = this.sharedRushSlugs.size > 0;
        const analysis = this.analyzeRush(conferences, now);
        const kicker = document.getElementById('rush-radar-kicker');
        const title = document.getElementById('rush-radar-title');
        const summary = document.getElementById('rush-radar-summary');
        const chips = document.getElementById('rush-radar-chips');
        const importButton = document.getElementById('rush-radar-import');

        panel.classList.remove('hidden');
        panel.dataset.state = analysis.state;
        if (kicker) kicker.textContent = shared ? 'A shared Rush' : 'Rush Radar';
        if (title) title.textContent = analysis.title;
        if (summary) {
            summary.textContent = shared && analysis.state === 'single'
                ? 'This shared list has one upcoming submission milestone.'
                : analysis.summary;
        }
        importButton?.classList.toggle('hidden', !shared);

        if (chips) {
            chips.innerHTML = '';
            conferences.forEach(conference => {
                const chip = document.createElement('span');
                const dot = document.createElement('i');
                const name = document.createElement('strong');
                const date = document.createElement('span');
                chip.className = 'rush-radar-chip';
                chip.style.setProperty('--chip-color', this.categoryColor(conference.category));
                name.textContent = `${conference.name} ${conference.year}`;
                date.textContent = `${conference.activeDeadline.estimated ? '~ ' : ''}${this.formatApproximateDate(conference.activeDeadline.date)}`;
                chip.append(dot, name, date);
                chips.appendChild(chip);
            });
        }

        const signature = `${shared ? 'shared' : 'saved'}:${conferences.map(item => item.id).join(',')}`;
        if (signature !== this.rushRadarSignature) {
            this.rushRadarSignature = signature;
            this.trackEvent('rush_radar_viewed', {
                conference_count: conferences.length,
                spacing_state: analysis.state,
                shared
            });
        }
    },

    importSharedRush() {
        if (this.sharedRushSlugs.size === 0) return;
        const imported = this.getSubmissionConferencePool().filter(conference =>
            this.sharedRushSlugs.has(this.seriesSlug(conference))
        );
        imported.forEach(conference => this.savedConferences.add(this.conferenceKey(conference)));
        this.persistSavedConferences();
        this.sharedRushSlugs.clear();
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('rush');
            url.searchParams.delete('ref');
            window.history.replaceState({}, '', url);
        } catch (_error) {
            // Importing still works if URL APIs are restricted.
        }
        this.updateSavedUI();
        this.setRushRadarStatus('Added to My Rush on this device.');
        this.trackEvent('rush_imported', { conference_count: imported.length });
    },

    setupHero() {
        const next = document.getElementById('hero-next');
        next?.addEventListener('click', () => {
            const conferenceId = next.dataset.conferenceId;
            let card = conferenceId
                ? document.querySelector(`.conference-card[data-conference-id="${CSS.escape(conferenceId)}"]`)
                : null;
            if (!card && conferenceId) {
                this.showSavedOnly = false;
                this.activeFilter = 'all';
                this.searchQuery = '';
                document.querySelectorAll('.filter-pill').forEach(button => {
                    button.classList.toggle('active', button.dataset.category === 'all');
                });
                const input = document.getElementById('search-input');
                if (input) input.value = '';
                this.updateSavedUI();
                this.applyFilter();
                card = document.querySelector(`.conference-card[data-conference-id="${CSS.escape(conferenceId)}"]`);
            }
            if (!card) return;
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => this.openModal(card.confData, card), 260);
        });
    },

    /**
     * Set up search functionality
     */
    setupSearch() {
        const searchInput = document.getElementById('search-input');
        const searchClear = document.getElementById('search-clear');

        if (!searchInput) return;

        // Real-time search
        searchInput.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase().trim();
            this.applyFilter();
        });

        // Clear button
        if (searchClear) {
            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                this.searchQuery = '';
                this.applyFilter();
                searchInput.focus();
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Cmd+K or Ctrl+K to focus search
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }

            // / to focus search (when not already in an input)
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                searchInput.focus();
            }

            // Escape to clear and blur search
            if (e.key === 'Escape' && document.activeElement === searchInput) {
                searchInput.value = '';
                this.searchQuery = '';
                this.applyFilter();
                searchInput.blur();
            }
        });
    },

    /**
     * Set up view toggle between card and calendar views
     */
    setupViewToggle() {
        const toggleBtns = document.querySelectorAll('.view-toggle-btn');
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setViewMode(btn.dataset.view);
            });
        });

        // Initialize indicator position
        this.updateViewToggleIndicator();
    },

    loadCalendarAssets() {
        if (typeof globalThis.PaperRushCalendar !== 'undefined') return Promise.resolve();
        if (this.calendarAssetsPromise) return this.calendarAssetsPromise;

        this.calendarAssetsPromise = new Promise((resolve, reject) => {
            const stylesheet = document.createElement('link');
            const script = document.createElement('script');
            let loaded = 0;
            const complete = () => {
                loaded += 1;
                if (loaded === 2) resolve();
            };
            const fail = () => reject(new Error('Calendar view could not load.'));

            stylesheet.rel = 'stylesheet';
            stylesheet.href = 'css/calendar.css';
            stylesheet.onload = complete;
            stylesheet.onerror = fail;
            script.src = 'js/calendar.js';
            script.onload = complete;
            script.onerror = fail;
            document.head.append(stylesheet, script);
        });

        return this.calendarAssetsPromise;
    },

    /**
     * Update the liquid glass indicator position for view toggle
     */
    updateViewToggleIndicator() {
        const indicator = document.getElementById('view-toggle-indicator');
        const activeBtn = document.querySelector('.view-toggle-btn.active');
        const container = document.getElementById('view-toggle');

        if (!indicator || !activeBtn || !container) return;

        const containerRect = container.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();

        const left = btnRect.left - containerRect.left;
        indicator.style.left = `${left}px`;
        indicator.style.width = `${btnRect.width}px`;
    },

    /**
     * Switch between card and calendar view modes
     * @param {string} mode - 'card' or 'calendar'
     */
    setViewMode(mode) {
        if (mode === 'calendar' && typeof globalThis.PaperRushCalendar === 'undefined') {
            const calendarButton = document.querySelector('[data-view="calendar"]');
            calendarButton?.setAttribute('aria-busy', 'true');
            this.loadCalendarAssets()
                .then(() => this.setViewMode('calendar'))
                .catch(error => console.error(error))
                .finally(() => calendarButton?.removeAttribute('aria-busy'));
            return;
        }

        this.viewMode = mode;

        // Update toggle button states
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === mode);
        });

        // Update indicator position
        this.updateViewToggleIndicator();

        // Show/hide containers
        const cardContainer = document.querySelector('.timeline-container');
        const calendarContainer = document.getElementById('calendar-container');

        if (mode === 'card') {
            cardContainer.classList.remove('hidden');
            calendarContainer.classList.add('hidden');
            // Re-apply snake order after container is visible
            requestAnimationFrame(() => {
                const grid = document.getElementById('conference-grid');
                this.applySnakeOrder(grid);
                TimelineDrawer.redraw();
            });
        } else {
            cardContainer.classList.add('hidden');
            calendarContainer.classList.remove('hidden');
            globalThis.PaperRushCalendar.setConferences(this.filteredConferences);
            globalThis.PaperRushCalendar.init(this.filteredConferences);
        }
    },

    /**
     * Apply the current filter and search
     */
    applyFilter() {
        // Start with all conferences or filtered by category
        if (this.activeFilter === 'all') {
            this.filteredConferences = [...this.conferences];
        } else {
            this.filteredConferences = this.conferences.filter(conf =>
                conf.category === this.activeFilter
            );
        }

        if (this.showSavedOnly) {
            this.filteredConferences = this.filteredConferences.filter(conf =>
                this.isConferenceSaved(conf)
            );
        }

        // Apply search filter
        if (this.searchQuery) {
            this.filteredConferences = this.filteredConferences.filter(conf => {
                const name = conf.name.toLowerCase();
                const fullName = `${conf.name} ${conf.year}`.toLowerCase();
                const location = `${conf.location.city} ${conf.location.country}`.toLowerCase();
                const category = conf.category.toLowerCase();

                return (
                    name.includes(this.searchQuery) ||
                    fullName.includes(this.searchQuery) ||
                    location.includes(this.searchQuery) ||
                    category.includes(this.searchQuery)
                );
            });
        }

        this.render();
        TimelineDrawer.redraw();

        // Sync with calendar if in calendar view
        if (this.viewMode === 'calendar') {
            globalThis.PaperRushCalendar?.setConferences(this.filteredConferences);
            globalThis.PaperRushCalendar?.render();
        }
    },

    /**
     * Update category count badges
     */
    updateCategoryCounts() {
        const categories = ['all', 'ml', 'cv', 'nlp', 'speech', 'robotics', 'other'];

        categories.forEach(cat => {
            const countEl = document.getElementById(`count-${cat}`);
            if (!countEl) return;

            if (cat === 'all') {
                countEl.textContent = this.conferences.length;
            } else {
                const count = this.conferences.filter(c => c.category === cat).length;
                countEl.textContent = count;
            }
        });
    },
    
    /**
     * Render all conference cards
     */
    render() {
        const grid = document.getElementById('conference-grid');
        const template = document.getElementById('card-template');

        // Stop existing timers
        CountdownTimer.stopAllTimers();

        // Clear grid
        grid.innerHTML = '';

        // Remove any existing no results message
        const existingNoResults = document.querySelector('.no-results');
        if (existingNoResults) {
            existingNoResults.remove();
        }

        // Show no results message if needed
        if (this.filteredConferences.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-results';
            const title = document.createElement('h3');
            const message = document.createElement('p');
            title.textContent = 'No conferences found';
            message.textContent = this.showSavedOnly && this.savedConferences.size === 0
                ? 'Save a conference to build your personal deadline list.'
                : this.searchQuery
                    ? `No results for "${this.searchQuery}". Try a different search term.`
                    : `No conferences have ${Rules.FOCUS_LABELS[this.activeDeadlineFilter].toLowerCase()} available yet.`;
            noResults.append(title, message);
            grid.parentNode.insertBefore(noResults, grid.nextSibling);
            this.updateHero();
            return;
        }

        // Render each conference
        this.filteredConferences.forEach((conf, index) => {
            const card = this.createCard(conf, template, index);

            grid.appendChild(card);
        });

        // Apply snake ordering via CSS order after layout
        this.applySnakeOrder(grid);
        this.updateSavedUI();
        this.updateHero();
    },

    updateHero() {
        const conference = this.filteredConferences[0] || this.conferences[0];
        const next = document.getElementById('hero-next');
        const name = document.getElementById('hero-next-name');
        const label = document.getElementById('hero-next-label');
        const category = document.getElementById('hero-next-category');
        const countdown = document.getElementById('hero-next-countdown');
        const date = document.getElementById('hero-next-date');
        const count = document.getElementById('hero-series-count');
        if (!next || !conference) return;

        if (count) count.textContent = this.catalog.length;
        next.dataset.conferenceId = conference.id;
        name.textContent = `${conference.name} ${conference.year}`;
        label.textContent = conference.activeDeadline?.estimated
            ? `Estimated ${conference.activeDeadline.label}`
            : conference.activeDeadline?.label || 'Dates to be announced';
        category.textContent = CATEGORIES[conference.category]?.name || 'Conference';

        const updateCountdown = () => {
            if (!conference.activeDeadline) {
                countdown.textContent = 'TBA';
                date.textContent = 'Official dates have not been announced';
                return;
            }
            if (Rules.isOngoing(conference.activeDeadline)) {
                countdown.textContent = 'Live now';
                date.textContent = CountdownTimer.formatDate(
                    conference.activeDeadline.date,
                    conference.activeDeadline.endDate
                );
                return;
            }

            const remaining = CountdownTimer.calculateRemaining(
                Rules.countdownTarget(conference.activeDeadline)
            );
            const formatted = CountdownTimer.formatDisplay(remaining);
            const prefix = conference.activeDeadline.estimated ? '~ ' : '';
            if (formatted.type === 'monthday') {
                countdown.textContent = `${prefix}${formatted.months}mo ${formatted.days}d`;
            } else if (formatted.type === 'detailed') {
                countdown.textContent = `${prefix}${formatted.hours}h ${formatted.minutes}m`;
            } else {
                countdown.textContent = `${prefix}${formatted.value} ${formatted.unit}`;
            }
            date.textContent = `${conference.activeDeadline.estimated ? 'Approx. ' : ''}${this.formatApproximateDate(conference.activeDeadline.date)}`;
        };

        clearInterval(this.heroTimer);
        updateCountdown();
        this.heroTimer = setInterval(updateCountdown, 30000);
    },
    
    /**
     * Apply snake ordering and animation delays based on actual layout
     * @param {HTMLElement} grid - Grid container
     */
    applySnakeOrder(grid) {
        const columns = this.getColumnCount(grid);
        const cards = Array.from(grid.querySelectorAll('.conference-card:not(.hidden)'));
        const delayPerCard = 0.055;
        const initialDelay = 0.08;

        // Remove existing placeholders
        grid.querySelectorAll('.grid-placeholder').forEach(p => p.remove());

        const totalCards = cards.length;
        const lastRowIndex = Math.floor((totalCards - 1) / columns);
        const cardsInLastRow = totalCards % columns || columns;
        const placeholdersNeeded = cardsInLastRow < columns ? columns - cardsInLastRow : 0;

        cards.forEach((card, index) => {
            const row = Math.floor(index / columns);
            const posInRow = index % columns;

            // Even rows: normal order, Odd rows: reversed
            const visualIndex = row % 2 === 0
                ? row * columns + posInRow
                : row * columns + (columns - 1 - posInRow);

            card.style.order = visualIndex;

            // Animation delay based on chronological index (follows snake path)
            // Only animate on first load, not on tab switch
            if (!this.hasAnimated) {
                const delay = initialDelay + (Math.min(index, 8) * delayPerCard);
                card.style.animationDelay = `${delay}s`;
                card.style.animationPlayState = 'running';
            } else {
                // Skip animation on subsequent renders (tab switch, filter change)
                card.style.animation = 'none';
                card.style.opacity = '1';
            }
        });

        // Mark animation as complete after first render
        this.hasAnimated = true;

        // Add placeholders for incomplete last row (snake alignment)
        if (placeholdersNeeded > 0) {
            const isOddRow = lastRowIndex % 2 === 1;
            for (let i = 0; i < placeholdersNeeded; i++) {
                const placeholder = document.createElement('div');
                placeholder.className = 'grid-placeholder';
                // Odd rows: placeholders at start (low order), Even rows: at end (high order)
                if (isOddRow) {
                    placeholder.style.order = lastRowIndex * columns + i;
                } else {
                    placeholder.style.order = lastRowIndex * columns + cardsInLastRow + i;
                }
                grid.appendChild(placeholder);
            }
        }
    },

    /**
     * Get current column count based on actual rendered layout
     * @param {HTMLElement} grid - Grid container
     */
    getColumnCount(grid) {
        const container = grid || document.getElementById('conference-grid');
        if (!container) return 1;

        const card = container.querySelector('.conference-card:not(.hidden)')
            || container.querySelector('.conference-card');
        if (!card) return 1;

        const containerWidth = container.clientWidth;
        const cardWidth = card.getBoundingClientRect().width;
        const styles = window.getComputedStyle(container);
        const columnGap = parseFloat(styles.columnGap) || 0;

        const maxColumns = Math.floor((containerWidth + columnGap) / (cardWidth + columnGap));
        return Math.max(1, Math.min(maxColumns, 4));
    },
    
    /**
     * Create a conference card element
     * @param {Object} conf - Conference data
     * @param {HTMLTemplateElement} template - Card template
     * @param {number} index - Card index
     * @returns {HTMLElement} Card element
     */
    createCard(conf, template, index) {
        const card = template.content.cloneNode(true).querySelector('.conference-card');
        
        // Set card ID and category
        card.dataset.conferenceId = conf.id;
        card.dataset.category = conf.category;
        card.id = `conference-${conf.id}`;
        
        // Store conference data for modal
        card.confData = conf;

        const saveButton = card.querySelector('.card-save-button');
        const saved = this.isConferenceSaved(conf);
        saveButton.classList.toggle('saved', saved);
        saveButton.setAttribute('aria-pressed', String(saved));
        saveButton.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${conf.name}`);
        saveButton.addEventListener('click', event => {
            event.stopPropagation();
            const isSaved = this.toggleSavedConference(conf);
            saveButton.classList.toggle('saved', isSaved);
            saveButton.setAttribute('aria-pressed', String(isSaved));
            saveButton.setAttribute('aria-label', `${isSaved ? 'Remove' : 'Save'} ${conf.name}`);
            if (this.showSavedOnly && !isSaved) this.applyFilter();
        });
        
        // Apply gradient to the gradient zone (top section only)
        const gradientZone = card.querySelector('.card-gradient-zone');
        const gradient = this.getCardGradient(conf.brandColor, conf.category);
        gradientZone.style.background = gradient;
        
        // Title (with estimated badge if needed)
        const confNameEl = card.querySelector('.conf-name');
        confNameEl.id = `conference-title-${conf.id}`;
        card.setAttribute('aria-labelledby', confNameEl.id);
        confNameEl.textContent = `${conf.name} ${conf.year}`;
        if (conf.datesTBD) {
            const badge = document.createElement('span');
            badge.className = 'estimated-badge';
            badge.title = 'Official dates have not been announced';
            badge.textContent = 'TBA';
            confNameEl.append(' ', badge);
        } else if (conf.isEstimated) {
            const badge = document.createElement('span');
            badge.className = 'estimated-badge';
            badge.title = 'Dates are approximate and not yet official';
            badge.textContent = 'Approx';
            confNameEl.append(' ', badge);
        }
        card.querySelector('.conf-location').textContent = `${conf.location.city}, ${conf.location.country} ${conf.location.flag}`;
        
        // Active deadline
        const deadlineSection = card.querySelector('.card-deadline');
        const deadlineLabel = card.querySelector('.deadline-label');
        const countdownContainer = card.querySelector('.countdown');
        
        if (conf.activeDeadline) {
            deadlineLabel.textContent = conf.activeDeadline.label;

            if (conf.activeDeadline.estimated) {
                deadlineLabel.textContent = `Estimated ${conf.activeDeadline.label}`;
                CountdownTimer.startTimer(
                    conf.id,
                    countdownContainer,
                    Rules.countdownTarget(conf.activeDeadline),
                    () => {
                        this.loadData();
                        this.applyFilter();
                    },
                    { approximate: true }
                );
            } else if (Rules.isOngoing(conf.activeDeadline)) {
                deadlineLabel.textContent = 'Conference in progress';
                countdownContainer.innerHTML = '<span class="countdown-value countdown-live">Live now</span>';
            } else {
                CountdownTimer.startTimer(
                    conf.id,
                    countdownContainer,
                    Rules.countdownTarget(conf.activeDeadline),
                    () => {
                        this.loadData();
                        this.applyFilter();
                    }
                );
            }
        } else if (conf.datesTBD) {
            deadlineLabel.textContent = 'Dates to be announced';
            countdownContainer.innerHTML = '<span class="countdown-value">TBA</span>';
        } else {
            deadlineLabel.textContent = 'All Deadlines Passed';
            deadlineSection.classList.add('passed');
            countdownContainer.innerHTML = '<span class="countdown-value">-</span>';
        }
        
        // Deadlines list - render ALL deadlines (scrollable)
        const deadlinesList = card.querySelector('.deadlines-list');
        const deadlinesContainer = card.querySelector('.card-deadlines-list');

        // Sort deadlines by date before rendering
        const sortedDeadlines = [...conf.deadlines].sort((a, b) =>
            Rules.countdownTarget(a) - Rules.countdownTarget(b)
        );

        const now = new Date();

        // Find the first upcoming deadline index
        let activeIndex = -1;
        for (let i = 0; i < sortedDeadlines.length; i++) {
            if (!Rules.isPassed(sortedDeadlines[i], now)) {
                activeIndex = i;
                break;
            }
        }

        // Render ALL deadlines
        sortedDeadlines.forEach((deadline, i) => {
            const li = document.createElement('li');
            const isPassed = Rules.isPassed(deadline, now);
            const isActive = i === activeIndex;

            li.className = 'deadline-item ' + (isPassed ? 'passed' : (isActive ? 'active' : 'upcoming'));

            const statusIcon = isPassed ? '✓' : (isActive ? '●' : '○');

            const dateStr = deadline.endDate
                ? CountdownTimer.formatDate(deadline.date, deadline.endDate)
                : CountdownTimer.formatDate(deadline.date);

            const icon = document.createElement('span');
            const type = document.createElement('span');
            const date = document.createElement('span');
            icon.className = 'status-icon';
            type.className = 'deadline-type';
            date.className = `deadline-date${deadline.estimated ? ' estimated' : ''}`;
            icon.textContent = statusIcon;
            type.textContent = deadline.label;
            date.textContent = deadline.estimated
                ? `~${this.formatApproximateDate(deadline.date)}`
                : dateStr;
            if (deadline.estimated) date.title = 'Approximate date';
            li.append(icon, type, date);

            deadlinesList.appendChild(li);
        });

        // Auto-scroll to show: 1 last passed + current deadline at top
        // Each item is ~28px (24px height + 4px gap)
        const itemHeight = 28;
        let scrollToIndex = 0;

        if (activeIndex === -1) {
            // All passed - scroll to show last 5
            scrollToIndex = Math.max(0, sortedDeadlines.length - 5);
        } else if (activeIndex > 0) {
            // Has passed deadlines - show 1 passed before current
            scrollToIndex = activeIndex - 1;
        }

        // Set initial scroll position after DOM renders
        if (deadlinesContainer && scrollToIndex > 0) {
            setTimeout(() => {
                deadlinesContainer.scrollTop = scrollToIndex * itemHeight;
            }, 50);
        }
        
        // Click to open modal with fly animation
        card.addEventListener('click', (e) => {
            this.openModal(conf, card);
        });
        
        return card;
    },
    
    /**
     * Open modal with conference details
     * @param {Object} conf - Conference data
     * @param {HTMLElement} cardElement - The clicked card element
     */
    openModal(conf, cardElement, options = {}) {
        const overlay = document.getElementById('modal-overlay');
        const modal = overlay.querySelector('.modal-container');
        const gradient = this.getCardGradient(conf.brandColor, conf.category);
        this.currentModalConference = conf;
        this.updateModalActions(conf);
        if (options.updateURL !== false) this.updateConferenceURL(conf);
        this.trackEvent('card_opened', {
            conference: conf.id,
            deadline_focus: this.activeDeadlineFilter,
            estimated: Boolean(conf.isEstimated)
        });

        // Disable transition temporarily to set initial position
        modal.style.transition = 'none';

        // Calculate fly animation from card position
        if (cardElement) {
            const cardRect = cardElement.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            // Calculate center of screen
            const centerX = windowWidth / 2;
            const centerY = windowHeight / 2;

            // Calculate card center
            const cardCenterX = cardRect.left + cardRect.width / 2;
            const cardCenterY = cardRect.top + cardRect.height / 2;

            // Calculate offset from center
            const offsetX = cardCenterX - centerX;
            const offsetY = cardCenterY - centerY;

            // Calculate scale (card size vs modal size)
            const modalWidth = Math.min(560, windowWidth - 48);
            const scale = cardRect.width / modalWidth;

            // Set initial position (at card location, scaled down)
            modal.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
            modal.style.borderRadius = '16px';

            // Store card reference for close animation
            this.lastOpenedCard = cardElement;
        }

        // Set header gradient
        const header = overlay.querySelector('.modal-gradient-header');
        header.style.background = gradient;

        // Set title, full name, and location
        document.getElementById('modal-title').textContent = `${conf.name} ${conf.year}`;
        document.getElementById('modal-fullname').textContent = conf.fullName || '';
        document.getElementById('modal-location').textContent = `${conf.location.city}, ${conf.location.country} ${conf.location.flag}`;
        
        // Set countdown
        const countdownLabel = document.getElementById('modal-countdown-label');
        const countdownValue = document.getElementById('modal-countdown-value');
        
        if (conf.activeDeadline) {
            countdownLabel.textContent = conf.activeDeadline.label;
            if (Rules.isOngoing(conf.activeDeadline)) {
                countdownLabel.textContent = 'Conference status';
                countdownValue.textContent = 'Happening now';
                countdownValue.title = '';
            } else {
                const approximate = Boolean(conf.activeDeadline.estimated);
                const prefix = approximate ? '~ ' : '';

                if (approximate) {
                    countdownLabel.textContent = `Estimated ${conf.activeDeadline.label}`;
                }

                const remaining = CountdownTimer.calculateRemaining(
                    Rules.countdownTarget(conf.activeDeadline)
                );
                const format = CountdownTimer.formatDisplay(remaining);

                if (format.type === 'monthday') {
                    countdownValue.textContent = `${prefix}${format.months} ${format.monthUnit} ${format.days} ${format.dayUnit}`;
                } else if (format.type === 'detailed') {
                    countdownValue.textContent = `${prefix}${format.hours} hrs : ${format.minutes} min : ${format.seconds} sec`;
                } else {
                    countdownValue.textContent = `${prefix}${format.value} ${format.unit}`;
                }

                countdownValue.title = approximate
                    ? 'Approximate countdown based on the previous edition'
                    : '';
            }
        } else if (conf.datesTBD) {
            countdownLabel.textContent = 'Status';
            countdownValue.textContent = 'Dates to be announced';
        } else {
            countdownLabel.textContent = 'Status';
            countdownValue.textContent = 'All Deadlines Passed';
        }
        
        // Set links
        const officialLink = document.getElementById('modal-link-official');
        const cfpLink = document.getElementById('modal-link-cfp');
        const templateLink = document.getElementById('modal-link-template');
        const authorLink = document.getElementById('modal-link-author');
        const datesLink = document.getElementById('modal-link-dates');
        const reportLink = document.getElementById('modal-link-report');

        const setExternalLink = (element, value) => {
            const safeURL = Rules.safeURL(value);
            if (safeURL) {
                element.href = safeURL;
                element.classList.remove('hidden');
            } else {
                element.removeAttribute('href');
                element.classList.add('hidden');
            }
        };
        
        setExternalLink(officialLink, conf.links?.official || conf.website);
        setExternalLink(cfpLink, conf.links?.author || conf.links?.cfp);
        setExternalLink(templateLink, conf.links?.template);
        setExternalLink(authorLink, conf.links?.authorGuide);
        setExternalLink(datesLink, conf.links?.dates);

        officialLink.onclick = () => this.trackEvent('official_source_clicked', {
            conference: conf.id,
            source_type: 'official'
        });
        datesLink.onclick = () => this.trackEvent('official_source_clicked', {
            conference: conf.id,
            source_type: 'dates'
        });

        const reportURL = new URL('https://github.com/awsaf49/paperrush/issues/new');
        reportURL.searchParams.set('template', 'feedback.yml');
        reportURL.searchParams.set('title', `[Deadline] ${conf.name} ${conf.year}`);
        reportLink.href = reportURL.href;
        
        // Set info
        document.getElementById('modal-page-limit').textContent = conf.info?.pageLimit || '-';
        document.getElementById('modal-review-type').textContent = conf.info?.reviewType || '-';
        document.getElementById('modal-acceptance-rate').textContent = conf.info?.acceptanceRate || '-';
        
        // Set deadlines list
        const deadlinesList = document.getElementById('modal-deadlines-list');
        const deadlinesTitle = document.getElementById('modal-deadlines-title');
        deadlinesTitle.textContent = Rules.FOCUS_LABELS[this.activeDeadlineFilter];
        deadlinesList.innerHTML = '';
        const now = new Date();

        // Sort deadlines by date before rendering
        const sortedDeadlines = [...conf.deadlines].sort((a, b) =>
            Rules.countdownTarget(a) - Rules.countdownTarget(b)
        );

        sortedDeadlines.forEach((deadline, i) => {
            const li = document.createElement('li');
            const isPassed = Rules.isPassed(deadline, now);
            const isActive = !isPassed && conf.activeDeadline && deadline.label === conf.activeDeadline.label;
            
            li.className = isPassed ? 'passed' : (isActive ? 'active' : '');
            
            const statusIcon = isPassed ? '✓' : (isActive ? '●' : '○');
            const dateStr = deadline.endDate 
                ? CountdownTimer.formatDate(deadline.date, deadline.endDate)
                : CountdownTimer.formatDate(deadline.date);
            
            const icon = document.createElement('span');
            const type = document.createElement('span');
            const date = document.createElement('span');
            icon.className = 'status-icon';
            type.className = 'deadline-type';
            date.className = 'deadline-date';
            icon.textContent = statusIcon;
            type.textContent = deadline.label;
            date.textContent = deadline.estimated
                ? `~${this.formatApproximateDate(deadline.date)}`
                : dateStr;
            if (deadline.estimated) date.title = 'Approximate date';
            li.append(icon, type, date);
            deadlinesList.appendChild(li);
        });
        
        // Set notes
        const notesList = document.getElementById('modal-notes-list');
        notesList.innerHTML = '';
        
        const defaultNotes = [
            'Check official website for latest updates',
            'Times use the timezone published by the conference; date-only entries have no confirmed submission time'
        ];
        const notes = conf.notes?.length ? conf.notes : defaultNotes;
        
        // Add desk reject reasons if available
        if (conf.deskRejectReasons) {
            conf.deskRejectReasons.forEach(reason => {
                const li = document.createElement('li');
                li.textContent = `⛔ ${reason}`;
                notesList.appendChild(li);
            });
        }
        
        notes.forEach(note => {
            const li = document.createElement('li');
            li.textContent = note;
            notesList.appendChild(li);
        });
        
        // Show modal with fly animation
        overlay.style.visibility = 'visible';
        overlay.style.opacity = '1';
        document.body.style.overflow = 'hidden';

        // Force browser to render initial position, then re-enable transition and animate
        modal.offsetHeight; // Force reflow

        setTimeout(() => {
            // Re-enable transition
            modal.style.transition = '';
            // Trigger animation
            overlay.classList.add('active');
        }, 30);
    },
    
    // Store last opened card for close animation
    lastOpenedCard: null,

    /**
     * Close modal
     */
    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        const modal = overlay.querySelector('.modal-container');

        // Animate back toward card if we have a reference
        if (this.lastOpenedCard) {
            const cardRect = this.lastOpenedCard.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            const centerX = windowWidth / 2;
            const centerY = windowHeight / 2;
            const cardCenterX = cardRect.left + cardRect.width / 2;
            const cardCenterY = cardRect.top + cardRect.height / 2;
            const offsetX = cardCenterX - centerX;
            const offsetY = cardCenterY - centerY;

            const modalWidth = Math.min(560, windowWidth - 48);
            const scaleX = cardRect.width / modalWidth;
            const scaleY = cardRect.height / (windowHeight * 0.7);
            const scale = Math.min(scaleX, scaleY, 0.5);

            modal.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        }

        overlay.classList.remove('active');
        this.clearConferenceURL();

        // Reset after animation completes
        setTimeout(() => {
            modal.style.transform = '';
            overlay.style.visibility = '';
            overlay.style.opacity = '';
            document.body.style.overflow = '';
            this.lastOpenedCard = null;
            this.currentModalConference = null;
        }, 600);
    },
    
    /**
     * Initialize modal event listeners
     */
    initModal() {
        const overlay = document.getElementById('modal-overlay');
        const closeBtn = document.getElementById('modal-close');
        const save = document.getElementById('modal-action-save');
        const google = document.getElementById('modal-action-google');
        const download = document.getElementById('modal-action-ics');
        const share = document.getElementById('modal-action-share');
        
        // Close on button click
        closeBtn.addEventListener('click', () => this.closeModal());
        
        // Close on overlay click (outside modal)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.closeModal();
            }
        });
        
        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });

        save?.addEventListener('click', () => {
            if (!this.currentModalConference) return;
            const saved = this.toggleSavedConference(this.currentModalConference);
            this.updateModalActions(this.currentModalConference);
            this.setModalActionStatus(saved ? 'Saved to My Rush.' : 'Removed from My Rush.');
            if (this.showSavedOnly && !saved) this.applyFilter();
        });
        google?.addEventListener('click', () => {
            if (!this.currentModalConference) return;
            this.trackEvent('calendar_added', {
                conference: this.currentModalConference.id,
                calendar_type: 'google'
            });
        });
        download?.addEventListener('click', () => {
            if (!this.currentModalConference) return;
            this.downloadCalendar(this.currentModalConference);
        });
        share?.addEventListener('click', () => {
            if (this.currentModalConference) this.shareConference(this.currentModalConference);
        });
    },

    setModalActionStatus(message) {
        const status = document.getElementById('modal-action-status');
        if (status) status.textContent = message;
    },

    updateModalActions(conference) {
        const save = document.getElementById('modal-action-save');
        const google = document.getElementById('modal-action-google');
        const download = document.getElementById('modal-action-ics');
        const deadline = conference.activeDeadline || conference.deadlines?.[0];
        const saved = this.isConferenceSaved(conference);

        save?.classList.toggle('saved', saved);
        save?.setAttribute('aria-pressed', String(saved));
        const saveLabel = save?.querySelector('span');
        if (saveLabel) saveLabel.textContent = saved ? 'Saved' : 'Save';

        if (google) {
            if (deadline) {
                google.href = this.buildGoogleCalendarURL(conference, deadline);
                google.classList.remove('disabled');
                google.removeAttribute('aria-disabled');
            } else {
                google.removeAttribute('href');
                google.classList.add('disabled');
                google.setAttribute('aria-disabled', 'true');
            }
        }
        if (download) download.disabled = !deadline;
        this.setModalActionStatus('');
    },

    buildConferenceURL(conference, baseURL) {
        const fallback = 'https://awsaf49.github.io/paperrush/';
        const url = new URL(baseURL || (typeof window !== 'undefined' ? window.location.href : fallback));
        url.searchParams.set('conference', conference.id);
        url.searchParams.set('focus', this.activeDeadlineFilter || 'submissions');
        return url.toString();
    },

    buildRushURL(conferences, baseURL) {
        const fallback = 'https://awsaf49.github.io/paperrush/';
        const url = new URL(baseURL || (typeof window !== 'undefined' ? window.location.href : fallback));
        const slugs = [...new Set((conferences || []).map(conference =>
            this.seriesSlug(conference)
        ).filter(Boolean))].sort();
        url.searchParams.delete('conference');
        url.searchParams.set('rush', slugs.join(','));
        url.searchParams.set('focus', 'submissions');
        url.searchParams.set('ref', 'rush-share');
        return url.toString();
    },

    formatRushCountdown(deadline, now = new Date()) {
        const target = Rules.countdownTarget(deadline);
        const remaining = target instanceof Date ? target - now : NaN;
        if (!Number.isFinite(remaining) || remaining <= 0) return 'passed';
        const days = Math.ceil(remaining / 86400000);
        const approximate = deadline?.estimated ? '~' : '';
        if (days > 60) {
            const months = Math.max(1, Math.round(days / 30.44));
            return `in ${approximate}${months} month${months === 1 ? '' : 's'}`;
        }
        return `in ${approximate}${days} day${days === 1 ? '' : 's'}`;
    },

    async createRushCardBlob(conferences = this.getRushConferences(), now = new Date()) {
        if (typeof document === 'undefined') throw new Error('Share cards require a browser.');
        const selection = (conferences || []).filter(conference => conference.activeDeadline);
        if (selection.length === 0) throw new Error('Save a conference before creating a card.');
        if (document.fonts?.ready) await document.fonts.ready;

        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        const context = canvas.getContext('2d');
        const analysis = this.analyzeRush(selection, now);
        const roundRect = (x, y, width, height, radius) => {
            context.beginPath();
            context.roundRect(x, y, width, height, radius);
        };
        const drawWrappedText = (text, x, y, maxWidth, lineHeight, maxLines = 2) => {
            const words = String(text).split(/\s+/);
            const lines = [];
            let line = '';
            words.forEach(word => {
                const candidate = line ? `${line} ${word}` : word;
                if (context.measureText(candidate).width > maxWidth && line) {
                    lines.push(line);
                    line = word;
                } else {
                    line = candidate;
                }
            });
            if (line) lines.push(line);
            lines.slice(0, maxLines).forEach((value, index) => {
                context.fillText(value, x, y + index * lineHeight);
            });
            return y + Math.min(lines.length, maxLines) * lineHeight;
        };

        const background = context.createLinearGradient(0, 0, 1200, 630);
        background.addColorStop(0, '#f9fbff');
        background.addColorStop(0.58, '#f4f6fb');
        background.addColorStop(1, '#fbf2f0');
        context.fillStyle = background;
        context.fillRect(0, 0, 1200, 630);
        context.fillStyle = 'rgba(238, 206, 242, 0.5)';
        context.beginPath();
        context.arc(1110, -20, 240, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(255, 93, 77, 0.2)';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(1110, -20, 185, 0, Math.PI * 2);
        context.stroke();

        context.fillStyle = '#ffffff';
        context.strokeStyle = '#17182b';
        context.lineWidth = 4;
        context.beginPath();
        context.arc(82, 69, 19, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.strokeStyle = '#ff5d4d';
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(82, 69);
        context.lineTo(93, 55);
        context.stroke();

        context.fillStyle = '#17182b';
        context.font = '700 29px Outfit, sans-serif';
        context.fillText('Paper', 115, 78);
        const paperWidth = context.measureText('Paper').width;
        context.fillStyle = '#ff5d4d';
        context.fillText('Rush', 115 + paperWidth, 78);

        context.fillStyle = '#b54738';
        context.font = '760 17px Outfit, sans-serif';
        context.fillText('MY SUBMISSION SEASON', 70, 137);
        context.fillStyle = '#17182b';
        context.font = '760 50px Outfit, sans-serif';
        context.fillText(analysis.title, 70, 194);
        context.fillStyle = '#62636f';
        context.font = '500 23px Outfit, sans-serif';
        drawWrappedText(analysis.summary, 70, 232, 1000, 29, 2);

        selection.slice(0, 4).forEach((conference, index) => {
            const column = index % 2;
            const row = Math.floor(index / 2);
            const x = 70 + column * 540;
            const y = 305 + row * 112;
            roundRect(x, y, 520, 94, 20);
            context.fillStyle = 'rgba(255, 255, 255, 0.82)';
            context.fill();
            context.strokeStyle = 'rgba(23, 24, 43, 0.07)';
            context.lineWidth = 1;
            context.stroke();

            context.fillStyle = this.categoryColor(conference.category);
            context.beginPath();
            context.arc(x + 24, y + 27, 6, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#17182b';
            context.font = '700 23px Outfit, sans-serif';
            context.fillText(`${conference.name} ${conference.year}`, x + 42, y + 34, 285);
            context.fillStyle = '#737480';
            context.font = '500 16px Outfit, sans-serif';
            const label = conference.activeDeadline.label.length > 42
                ? `${conference.activeDeadline.label.slice(0, 39)}...`
                : conference.activeDeadline.label;
            context.fillText(label, x + 24, y + 64, 320);
            context.fillStyle = '#ff5d4d';
            context.font = '650 17px "JetBrains Mono", monospace';
            context.textAlign = 'right';
            context.fillText(this.formatRushCountdown(conference.activeDeadline, now), x + 496, y + 55);
            context.textAlign = 'left';
        });

        if (selection.length > 4) {
            context.fillStyle = '#777883';
            context.font = '600 16px Outfit, sans-serif';
            context.fillText(`+${selection.length - 4} more conference${selection.length - 4 === 1 ? '' : 's'} in the shared link`, 70, 548);
        } else {
            context.fillStyle = '#17182b';
            context.font = '650 18px Outfit, sans-serif';
            context.fillText('Build yours - free, no sign-in.', 70, 538);
        }
        context.fillStyle = '#777883';
        context.font = '500 16px Outfit, sans-serif';
        context.fillText('Dates may change. Please verify official conference sources.', 70, 588);
        context.textAlign = 'right';
        context.font = '650 17px Outfit, sans-serif';
        context.fillText('awsaf49.github.io/paperrush', 1130, 588);

        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create image.')), 'image/png');
        });
    },

    async downloadRushCard() {
        const conferences = this.getRushConferences();
        if (conferences.length === 0) return;
        this.setRushRadarStatus('Preparing the share card...');
        try {
            const blob = await this.createRushCardBlob(conferences);
            const objectURL = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectURL;
            link.download = 'paperrush-my-rush.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectURL), 0);
            this.setRushRadarStatus('Share card saved.');
            this.trackEvent('rush_card_downloaded', { conference_count: conferences.length });
        } catch (_error) {
            this.setRushRadarStatus('The image could not be created. The share link still works.');
        }
    },

    async shareRush() {
        const conferences = this.getRushConferences();
        if (conferences.length === 0) return;
        const url = this.buildRushURL(conferences);
        const names = conferences.slice(0, 3).map(conference => conference.name);
        const remainder = conferences.length - names.length;
        const list = `${names.join(', ')}${remainder > 0 ? `, and ${remainder} more` : ''}`;
        const title = 'My submission season | PaperRush';
        const text = `I am using PaperRush to keep an eye on ${list}. Dates can change, so please verify the official conference pages. Corrections are welcome.`;

        try {
            if (navigator.share) {
                const shareData = { title, text, url };
                try {
                    const blob = await this.createRushCardBlob(conferences);
                    const file = new File([blob], 'paperrush-my-rush.png', { type: 'image/png' });
                    if (navigator.canShare?.({ files: [file] })) shareData.files = [file];
                } catch (_error) {
                    // The useful link should still be shareable if image generation fails.
                }
                await navigator.share(shareData);
                this.setRushRadarStatus('Shared. Thank you.');
                this.trackEvent('rush_shared', { conference_count: conferences.length, method: 'native' });
                return;
            }
            await navigator.clipboard.writeText(url);
            this.setRushRadarStatus('Share link copied.');
            this.trackEvent('rush_shared', { conference_count: conferences.length, method: 'clipboard' });
        } catch (error) {
            if (error?.name === 'AbortError') return;
            const input = document.createElement('textarea');
            input.value = url;
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
            this.setRushRadarStatus('Share link copied.');
            this.trackEvent('rush_shared', { conference_count: conferences.length, method: 'fallback' });
        }
    },

    updateConferenceURL(conference) {
        try {
            window.history.replaceState({}, '', this.buildConferenceURL(conference));
        } catch (_error) {
            // Deep links are additive; modal behavior does not depend on them.
        }
    },

    clearConferenceURL() {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('conference');
            window.history.replaceState({}, '', url);
        } catch (_error) {
            // Ignore restricted history APIs.
        }
    },

    openConferenceFromURL() {
        let conferenceId = '';
        try {
            conferenceId = new URLSearchParams(window.location.search).get('conference') || '';
        } catch (_error) {
            return;
        }
        if (!conferenceId) return;

        requestAnimationFrame(() => {
            const card = document.querySelector(
                `.conference-card[data-conference-id="${CSS.escape(conferenceId)}"]`
            );
            if (card) this.openModal(card.confData, null, { updateURL: false });
        });
    },

    async shareConference(conference) {
        const url = this.buildConferenceURL(conference);
        const deadline = conference.activeDeadline;
        const title = `${conference.name} ${conference.year} deadline | PaperRush`;
        const text = deadline
            ? `${deadline.estimated ? 'Estimated ' : ''}${deadline.label}: ${this.formatApproximateDate(deadline.date)}`
            : 'Track this conference on PaperRush.';

        try {
            if (navigator.share) {
                await navigator.share({ title, text, url });
                this.setModalActionStatus('Shared.');
                this.trackEvent('conference_shared', { conference: conference.id, method: 'native' });
                return;
            }
            await navigator.clipboard.writeText(url);
            this.setModalActionStatus('Link copied.');
            this.trackEvent('conference_shared', { conference: conference.id, method: 'clipboard' });
        } catch (error) {
            if (error?.name === 'AbortError') return;
            const input = document.createElement('textarea');
            input.value = url;
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
            this.setModalActionStatus('Link copied.');
            this.trackEvent('conference_shared', { conference: conference.id, method: 'fallback' });
        }
    },

    calendarRange(deadline) {
        const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(deadline.date || '');
        if (isDateOnly) {
            const start = deadline.date.replaceAll('-', '');
            const lastDate = deadline.endDate || deadline.date;
            const end = new Date(`${lastDate}T00:00:00Z`);
            end.setUTCDate(end.getUTCDate() + 1);
            return {
                allDay: true,
                start,
                end: end.toISOString().slice(0, 10).replaceAll('-', '')
            };
        }

        const startDate = Rules.parseDate(deadline.date, false);
        if (!startDate) return null;
        const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
        const format = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        return { allDay: false, start: format(startDate), end: format(endDate) };
    },

    buildGoogleCalendarURL(conference, deadline) {
        const range = this.calendarRange(deadline);
        if (!range) return '#';
        const url = new URL('https://calendar.google.com/calendar/render');
        const official = Rules.safeURL(conference.links?.official || conference.links?.dates || conference.website);
        const location = [conference.location?.city, conference.location?.country]
            .filter(value => value && value !== 'TBD')
            .join(', ');
        url.searchParams.set('action', 'TEMPLATE');
        url.searchParams.set(
            'text',
            `${deadline.estimated ? '[Estimated] ' : ''}${conference.name} ${conference.year}: ${deadline.label}`
        );
        url.searchParams.set('dates', `${range.start}/${range.end}`);
        url.searchParams.set(
            'details',
            `Tracked by PaperRush. Verify the official source before relying on this date.${official ? `\n\nOfficial source: ${official}` : ''}`
        );
        if (location) url.searchParams.set('location', location);
        return url.toString();
    },

    escapeICSText(value) {
        return String(value || '')
            .replaceAll('\\', '\\\\')
            .replaceAll(';', '\\;')
            .replaceAll(',', '\\,')
            .replaceAll('\n', '\\n');
    },

    buildICS(conference, deadline, now = new Date()) {
        const range = this.calendarRange(deadline);
        if (!range) return '';
        const official = Rules.safeURL(conference.links?.official || conference.links?.dates || conference.website);
        const location = [conference.location?.city, conference.location?.country]
            .filter(value => value && value !== 'TBD')
            .join(', ');
        const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const title = `${deadline.estimated ? '[Estimated] ' : ''}${conference.name} ${conference.year}: ${deadline.label}`;
        const description = `Tracked by PaperRush. Verify the official source before relying on this date.${official ? `\nOfficial source: ${official}` : ''}`;
        const dateLines = range.allDay
            ? [`DTSTART;VALUE=DATE:${range.start}`, `DTEND;VALUE=DATE:${range.end}`]
            : [`DTSTART:${range.start}`, `DTEND:${range.end}`];

        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//PaperRush//Conference Deadlines//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:${this.escapeICSText(`${conference.id}-${Rules.canonicalType(deadline)}@paperrush`)}`,
            `DTSTAMP:${stamp}`,
            ...dateLines,
            `SUMMARY:${this.escapeICSText(title)}`,
            `DESCRIPTION:${this.escapeICSText(description)}`,
            location ? `LOCATION:${this.escapeICSText(location)}` : '',
            official ? `URL:${official}` : '',
            'END:VEVENT',
            'END:VCALENDAR'
        ].filter(Boolean).join('\r\n');
    },

    downloadCalendar(conference) {
        const deadline = conference.activeDeadline || conference.deadlines?.[0];
        if (!deadline) return;
        const content = this.buildICS(conference, deadline);
        const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
        const link = document.createElement('a');
        const objectURL = URL.createObjectURL(blob);
        link.href = objectURL;
        link.download = `${conference.id}-${Rules.canonicalType(deadline)}.ics`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectURL), 0);
        this.setModalActionStatus('Calendar file downloaded.');
        this.trackEvent('calendar_added', { conference: conference.id, calendar_type: 'ics' });
    },

    setupFeedback() {
        const trigger = document.getElementById('feedback-trigger');
        const panel = document.getElementById('feedback-panel');
        const close = document.getElementById('feedback-close');
        const status = document.getElementById('feedback-status');
        const form = document.getElementById('feedback-form');
        const message = document.getElementById('feedback-message');
        const count = document.getElementById('feedback-count');
        if (!trigger || !panel) return;

        const setStatus = (text, state = 'success') => {
            if (!status) return;
            status.textContent = text;
            status.dataset.state = state;
        };

        const setOpen = open => {
            panel.classList.toggle('hidden', !open);
            trigger.setAttribute('aria-expanded', String(open));
            if (open) panel.querySelector('.feedback-option')?.focus();
        };

        trigger.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
        close?.addEventListener('click', () => setOpen(false));

        document.querySelectorAll('.feedback-option').forEach(button => {
            button.addEventListener('click', () => {
                const feedbackType = button.dataset.feedback;
                const recorded = this.trackEvent('quick_feedback', {
                    feedback_type: feedbackType,
                    deadline_focus: this.activeDeadlineFilter
                });
                setStatus(
                    recorded ? 'Thanks - feedback recorded.' : 'Analytics is blocked; use the note or report form.',
                    recorded ? 'success' : 'error'
                );
                panel.classList.add('submitted');
                if (recorded) {
                    setTimeout(() => {
                        setOpen(false);
                        panel.classList.remove('submitted');
                        setStatus('');
                    }, 1400);
                } else {
                    panel.classList.remove('submitted');
                }
            });
        });

        message?.addEventListener('input', () => {
            if (count) count.textContent = `${message.value.length} / 500`;
        });

        form?.addEventListener('submit', event => {
            event.preventDefault();
            const note = message?.value.trim() || '';
            if (!note) {
                setStatus('Write a short note first.', 'error');
                message?.focus();
                return;
            }

            const issueURL = this.buildFeedbackIssueURL(note, {
                deadlineFocus: this.activeDeadlineFilter,
                pageURL: window.location.href
            });
            window.open(issueURL, '_blank', 'noopener,noreferrer');
            this.trackEvent('text_feedback_opened', {
                feedback_length: note.length,
                deadline_focus: this.activeDeadlineFilter
            });
            setStatus('Your note is ready on GitHub. Review it, then submit the issue.');
        });

        document.addEventListener('click', event => {
            if (!panel.classList.contains('hidden') &&
                !panel.contains(event.target) && event.target !== trigger) {
                setOpen(false);
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.classList.contains('hidden')) {
                setOpen(false);
                trigger.focus();
            }
        });
    },

    buildFeedbackIssueURL(message, context = {}) {
        const issueURL = new URL('https://github.com/awsaf49/paperrush/issues/new');
        const pageURL = context.pageURL || '';
        const body = [
            message.trim(),
            '',
            '---',
            'PaperRush context',
            `- Deadline view: ${context.deadlineFocus || 'unknown'}`,
            pageURL ? `- Page: ${pageURL}` : ''
        ].filter(Boolean).join('\n');

        issueURL.searchParams.set('title', '[Feedback] PaperRush note');
        issueURL.searchParams.set('body', body);
        issueURL.searchParams.set('labels', 'feedback');
        return issueURL.toString();
    },

    trackEvent(name, parameters = {}) {
        if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
            window.gtag('event', name, parameters);
            return true;
        }
        return false;
    },
    
    /**
     * Get OpenAI-style vibrant mesh gradient for a card based on category
     * Each category has a UNIQUE pattern, not just different colors
     * @param {string} brandColor - Conference brand color
     * @param {string} category - Conference category
     * @returns {string} Full gradient CSS string
     */
    getCardGradient(brandColor, category) {
        // Unique patterns per category - different positions, sizes, angles
        const gradients = {
            // ML - Diagonal sweep from top-left, warm red/coral feel
            'ml': `
                radial-gradient(ellipse 150% 80% at -30% -20%, rgba(239, 68, 68, 0.7), transparent 50%),
                radial-gradient(ellipse 100% 100% at 120% 20%, rgba(248, 113, 113, 0.6), transparent 45%),
                radial-gradient(ellipse 80% 60% at 50% 120%, rgba(252, 165, 165, 0.45), transparent 50%),
                linear-gradient(160deg, #fef2f2 0%, #fee2e2 60%, #fecaca 100%)
            `,
            // CV - Horizontal wave, ocean blues
            'cv': `
                radial-gradient(ellipse 100% 150% at 50% -50%, rgba(59, 130, 246, 0.6), transparent 50%),
                radial-gradient(ellipse 150% 100% at -30% 50%, rgba(6, 182, 212, 0.55), transparent 45%),
                radial-gradient(ellipse 100% 80% at 120% 80%, rgba(139, 92, 246, 0.4), transparent 50%),
                linear-gradient(180deg, #dbeafe 0%, #e0f2fe 50%, #ede9fe 100%)
            `,
            // NLP - Vertical gradient bands, forest/nature feel
            'nlp': `
                radial-gradient(ellipse 60% 150% at 0% 50%, rgba(50, 220, 130, 0.65), transparent 50%),
                radial-gradient(ellipse 60% 150% at 100% 50%, rgba(50, 200, 200, 0.55), transparent 50%),
                radial-gradient(ellipse 100% 60% at 50% -20%, rgba(80, 180, 255, 0.35), transparent 50%),
                linear-gradient(90deg, #d1fae5 0%, #ccfbf1 50%, #dbeafe 100%)
            `,
            // Speech - Soft peach/orange wave, warm audio feel
            'speech': `
                radial-gradient(ellipse 120% 100% at -10% -10%, rgba(253, 186, 116, 0.6), transparent 55%),
                radial-gradient(ellipse 130% 80% at 80% -20%, rgba(251, 146, 60, 0.5), transparent 50%),
                radial-gradient(ellipse 100% 120% at 110% 90%, rgba(253, 186, 116, 0.45), transparent 50%),
                linear-gradient(160deg, #fff7ed 0%, #ffedd5 50%, #fff7ed 100%)
            `,
            // Robotics - Hot pink/magenta, bold and techy
            'robotics': `
                radial-gradient(ellipse 100% 120% at -20% 30%, rgba(255, 20, 147, 0.6), transparent 50%),
                radial-gradient(ellipse 80% 100% at 110% 70%, rgba(255, 105, 180, 0.5), transparent 50%),
                radial-gradient(ellipse 120% 80% at 50% -30%, rgba(255, 182, 193, 0.4), transparent 50%),
                linear-gradient(170deg, #fff0f5 0%, #ffe4ec 50%, #ffebf0 100%)
            `,
            // Other - Corner accents, creative/artistic feel
            'other': `
                radial-gradient(ellipse 100% 100% at -20% -20%, rgba(167, 139, 250, 0.6), transparent 50%),
                radial-gradient(ellipse 100% 100% at 120% 120%, rgba(244, 114, 182, 0.55), transparent 50%),
                radial-gradient(ellipse 80% 80% at 50% 50%, rgba(96, 165, 250, 0.3), transparent 60%),
                linear-gradient(135deg, #ede9fe 0%, #fce7f3 50%, #dbeafe 100%)
            `
        };
        
        return gradients[category] || gradients['other'];
    },

    /**
     * Convert hex color to rgba
     * @param {string} hex - Hex color code
     * @param {number} alpha - Alpha value (0-1)
     * @returns {string} RGBA color string
     */
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },
    
    /**
     * Update the "Last updated" display
     */
    updateLastUpdated() {
        const dateEl = document.getElementById('update-date');
        if (CONFERENCES_DATA.lastUpdated) {
            const date = new Date(CONFERENCES_DATA.lastUpdated);
            dateEl.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
    }
};

if (typeof document !== 'undefined') {
    // Give the branded hero one paint before building the full card catalog.
    document.addEventListener('DOMContentLoaded', () => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            App.init();
            fetchGitHubStars();
        }));
    });

// Fetch GitHub star count
async function fetchGitHubStars() {
    const starCountEl = document.getElementById('star-count');
    if (!starCountEl) return;

    try {
        const response = await fetch('https://api.github.com/repos/awsaf49/paperrush');
        if (response.ok) {
            const data = await response.json();
            const stars = data.stargazers_count;
            // Format: 1234 -> "1.2k" for large numbers
            starCountEl.textContent = stars >= 1000
                ? (stars / 1000).toFixed(1) + 'k'
                : stars;
        }
    } catch (e) {
        // Silently fail - keep showing "-"
    }
}

    // Handle visibility change (pause/resume timers)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            CountdownTimer.stopAllTimers();
        } else {
            App.render();
        }
    });
}

// Handle resize to update snake ordering and filter indicator
if (typeof window !== 'undefined') {
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            App.render();
            TimelineDrawer.redraw();
            App.updateFilterIndicator();
            App.updateDeadlineFilterIndicator();
        }, 150);
    });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
}
