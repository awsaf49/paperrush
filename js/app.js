/**
 * Deadline Drop - Main Application
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

    /**
     * Initialize the application
     */
    async init() {
        try {
            console.log('🎯 Deadline Drop initializing...');

            // Load data
            this.loadData();

            // Set up event listeners
            this.setupFilters();
            this.setupDeadlineFilters();
            this.setupSearch();
            this.setupViewToggle();
            this.setupFeedback();

            // Initialize modal
            this.initModal();

            // Update category counts
            this.updateCategoryCounts();

            // Render conferences
            this.render();

            // Initialize timeline
            TimelineDrawer.init();

            // Update last updated date
            this.updateLastUpdated();

            // Update filter indicator position
            this.updateFilterIndicator();

            // Hide loading state
            document.getElementById('loading-state').classList.add('hidden');

            console.log('✅ Deadline Drop ready!');
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
            Calendar.setConferences(this.filteredConferences);
            Calendar.init(this.filteredConferences);
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
            Calendar.setConferences(this.filteredConferences);
            Calendar.render();
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
            message.textContent = this.searchQuery
                ? `No results for "${this.searchQuery}". Try a different search term.`
                : `No conferences have ${Rules.FOCUS_LABELS[this.activeDeadlineFilter].toLowerCase()} available yet.`;
            noResults.append(title, message);
            grid.parentNode.insertBefore(noResults, grid.nextSibling);
            return;
        }

        // Render each conference
        this.filteredConferences.forEach((conf, index) => {
            const card = this.createCard(conf, template, index);

            grid.appendChild(card);
        });

        // Apply snake ordering via CSS order after layout
        this.applySnakeOrder(grid);
    },
    
    /**
     * Apply snake ordering and animation delays based on actual layout
     * @param {HTMLElement} grid - Grid container
     */
    applySnakeOrder(grid) {
        const columns = this.getColumnCount(grid);
        const cards = Array.from(grid.querySelectorAll('.conference-card:not(.hidden)'));
        const delayPerCard = 0.35; // seconds between each card
        const initialDelay = 0.4; // wait for line to start

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
                const delay = initialDelay + (index * delayPerCard);
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
        
        // Store conference data for modal
        card.confData = conf;
        
        // Apply gradient to the gradient zone (top section only)
        const gradientZone = card.querySelector('.card-gradient-zone');
        const gradient = this.getCardGradient(conf.brandColor, conf.category);
        gradientZone.style.background = gradient;
        
        // Title (with estimated badge if needed)
        const confNameEl = card.querySelector('.conf-name');
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
            countdownContainer.innerHTML = '<span class="countdown-value">—</span>';
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
    openModal(conf, cardElement) {
        const overlay = document.getElementById('modal-overlay');
        const modal = overlay.querySelector('.modal-container');
        const gradient = this.getCardGradient(conf.brandColor, conf.category);

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

        const reportURL = new URL('https://github.com/awsaf49/paperrush/issues/new');
        reportURL.searchParams.set('template', 'feedback.yml');
        reportURL.searchParams.set('title', `[Deadline] ${conf.name} ${conf.year}`);
        reportLink.href = reportURL.href;
        
        // Set info
        document.getElementById('modal-page-limit').textContent = conf.info?.pageLimit || '—';
        document.getElementById('modal-review-type').textContent = conf.info?.reviewType || '—';
        document.getElementById('modal-acceptance-rate').textContent = conf.info?.acceptanceRate || '—';
        
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
            'All deadlines are in AoE (Anywhere on Earth) timezone'
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

        // Reset after animation completes
        setTimeout(() => {
            modal.style.transform = '';
            overlay.style.visibility = '';
            overlay.style.opacity = '';
            document.body.style.overflow = '';
            this.lastOpenedCard = null;
        }, 600);
    },
    
    /**
     * Initialize modal event listeners
     */
    initModal() {
        const overlay = document.getElementById('modal-overlay');
        const closeBtn = document.getElementById('modal-close');
        
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
    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        App.init();
        fetchGitHubStars();
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
        // Silently fail - keep showing "—"
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
