/**
 * Calendar Module for Conference Deadline Tracker
 * Provides day, week, month, and year views for conference deadlines
 */

const Calendar = {
    // State
    currentDate: new Date(),
    viewMode: 'month', // day, week, month, year
    conferences: [],

    // Day names
    dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthNames: [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ],

    /**
     * Initialize the calendar
     * @param {Array} conferences - Array of conference objects
     */
    init(conferences) {
        this.conferences = conferences || [];
        this.setupEventListeners();
        this.render();
    },

    /**
     * Set conferences data (called when filters change)
     * @param {Array} conferences - Filtered conference array
     */
    setConferences(conferences) {
        this.conferences = conferences || [];
    },

    /**
     * Set up event listeners for calendar navigation
     */
    setupEventListeners() {
        // Navigation buttons
        document.getElementById('cal-prev')?.addEventListener('click', () => this.prev());
        document.getElementById('cal-next')?.addEventListener('click', () => this.next());
        document.getElementById('cal-today')?.addEventListener('click', () => this.goToToday());

        // View tabs
        document.querySelectorAll('.cal-view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.setView(tab.dataset.calview);
            });
        });

        // Initialize indicator position
        this.updateViewIndicator();
    },

    /**
     * Update the liquid glass indicator position for calendar view tabs
     */
    updateViewIndicator() {
        const indicator = document.getElementById('cal-view-indicator');
        const activeTab = document.querySelector('.cal-view-tab.active');
        const container = document.getElementById('calendar-view-tabs');

        if (!indicator || !activeTab || !container) return;

        const containerRect = container.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();

        const left = tabRect.left - containerRect.left;
        indicator.style.left = `${left}px`;
        indicator.style.width = `${tabRect.width}px`;
    },

    /**
     * Navigate to previous period
     */
    prev() {
        switch (this.viewMode) {
            case 'day':
                this.currentDate.setDate(this.currentDate.getDate() - 1);
                break;
            case 'week':
                this.currentDate.setDate(this.currentDate.getDate() - 7);
                break;
            case 'month':
                this.currentDate.setMonth(this.currentDate.getMonth() - 1);
                break;
            case 'year':
                this.currentDate.setFullYear(this.currentDate.getFullYear() - 1);
                break;
        }
        this.render();
    },

    /**
     * Navigate to next period
     */
    next() {
        switch (this.viewMode) {
            case 'day':
                this.currentDate.setDate(this.currentDate.getDate() + 1);
                break;
            case 'week':
                this.currentDate.setDate(this.currentDate.getDate() + 7);
                break;
            case 'month':
                this.currentDate.setMonth(this.currentDate.getMonth() + 1);
                break;
            case 'year':
                this.currentDate.setFullYear(this.currentDate.getFullYear() + 1);
                break;
        }
        this.render();
    },

    /**
     * Go to today's date
     */
    goToToday() {
        this.currentDate = new Date();
        this.render();
    },

    /**
     * Set the view mode
     * @param {string} view - day, week, month, or year
     */
    setView(view) {
        this.viewMode = view;

        // Update active tab
        document.querySelectorAll('.cal-view-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.calview === view);
        });

        // Update indicator position
        this.updateViewIndicator();

        this.render();
    },

    /**
     * Main render method - dispatches to appropriate view renderer
     */
    render() {
        this.updateTitle();

        const body = document.getElementById('calendar-body');
        if (!body) return;

        switch (this.viewMode) {
            case 'day':
                body.innerHTML = this.renderDayView();
                break;
            case 'week':
                body.innerHTML = this.renderWeekView();
                break;
            case 'month':
                body.innerHTML = this.renderMonthView();
                break;
            case 'year':
                body.innerHTML = this.renderYearView();
                break;
        }

        // Attach chip click handlers
        this.attachChipHandlers();
    },

    /**
     * Update the calendar title based on current view and date
     */
    updateTitle() {
        const titleEl = document.getElementById('cal-title');
        if (!titleEl) return;

        switch (this.viewMode) {
            case 'day':
                const dayOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                titleEl.textContent = this.currentDate.toLocaleDateString('en-US', dayOptions);
                break;
            case 'week':
                const weekStart = this.getWeekStart(this.currentDate);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                const startMonth = this.monthNames[weekStart.getMonth()];
                const endMonth = this.monthNames[weekEnd.getMonth()];
                if (startMonth === endMonth) {
                    titleEl.textContent = `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
                } else {
                    titleEl.textContent = `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
                }
                break;
            case 'month':
                titleEl.textContent = `${this.monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`;
                break;
            case 'year':
                titleEl.textContent = this.currentDate.getFullYear().toString();
                break;
        }
    },

    /**
     * Get the start of the week (Sunday) for a given date
     * @param {Date} date
     * @returns {Date}
     */
    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - day);
        return d;
    },

    /**
     * Get all deadlines for a specific date (deduplicated per conference)
     * @param {Date} date
     * @returns {Array} Array of {conference, deadline} objects
     */
    getDeadlinesForDate(date) {
        const dateStr = date.toISOString().split('T')[0];
        const results = [];
        const seen = new Set(); // Track conf-id to show only one per conference per day

        this.conferences.forEach(conf => {
            conf.deadlines.forEach(deadline => {
                const deadlineDate = new Date(deadline.date);
                const deadlineDateStr = deadlineDate.toISOString().split('T')[0];

                if (deadlineDateStr === dateStr && !seen.has(conf.id)) {
                    seen.add(conf.id);
                    results.push({ conference: conf, deadline });
                }
            });
        });

        return results;
    },

    /**
     * Get all deadlines for a specific month
     * @param {number} year
     * @param {number} month (0-11)
     * @returns {Array}
     */
    getDeadlinesForMonth(year, month) {
        const results = [];

        this.conferences.forEach(conf => {
            conf.deadlines.forEach(deadline => {
                const deadlineDate = new Date(deadline.date);
                if (deadlineDate.getFullYear() === year && deadlineDate.getMonth() === month) {
                    results.push({ conference: conf, deadline });
                }
            });
        });

        return results;
    },

    /**
     * Check if a date is today
     * @param {Date} date
     * @returns {boolean}
     */
    isToday(date) {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    },

    /**
     * Check if a date is in the past
     * @param {Date} date
     * @returns {boolean}
     */
    isPast(date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const compareDate = new Date(date);
        compareDate.setHours(0, 0, 0, 0);
        return compareDate < today;
    },

    /**
     * Create a chip element HTML for a conference deadline
     * @param {Object} conference
     * @param {Object} deadline
     * @param {boolean} isPast
     * @returns {string}
     */
    createChip(conference, deadline, isPast = false) {
        const pastClass = isPast ? 'past' : '';
        // Shorten deadline label for display
        const shortLabel = this.shortenDeadlineLabel(deadline.label);
        return `
            <div class="cal-chip category-${conference.category} ${pastClass}"
                 data-conf-id="${conference.id}"
                 title="${conference.name} ${conference.year} - ${deadline.label}">
                <span class="chip-dot"></span>
                <span class="chip-text">
                    <span class="chip-name">${conference.name}</span>
                    <span class="chip-separator">·</span>
                    <span class="chip-label">${shortLabel}</span>
                </span>
            </div>
        `;
    },

    /**
     * Shorten deadline label for compact display
     * @param {string} label
     * @returns {string}
     */
    shortenDeadlineLabel(label) {
        const lower = label.toLowerCase();
        if (lower.includes('paper') && lower.includes('submission')) return 'Paper Submission';
        if (lower.includes('abstract') && lower.includes('submission')) return 'Abstract Submission';
        if (lower.includes('abstract')) return 'Abstract';
        if (lower.includes('rebuttal')) return 'Rebuttal';
        if (lower.includes('camera') && lower.includes('ready')) return 'Camera Ready';
        if (lower.includes('camera')) return 'Camera Ready';
        if (lower.includes('notification')) return 'Notification';
        if (lower.includes('workshop')) return 'Workshop';
        if (lower.includes('tutorial')) return 'Tutorial';
        if (lower.includes('supplementary')) return 'Supplementary';
        if (lower.includes('conference')) return 'Conference';
        if (lower.includes('registration')) return 'Registration';
        // Truncate if too long
        if (label.length > 30) return label.substring(0, 27) + '…';
        return label;
    },

    /**
     * Render the month view
     * @returns {string} HTML string
     */
    renderMonthView() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        // First day of month and total days
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay(); // Days to pad at start
        const totalDays = lastDay.getDate();

        // Build grid
        let html = '<div class="cal-month-grid">';

        // Weekday headers
        html += '<div class="cal-weekday-header">';
        this.dayNames.forEach(day => {
            html += `<div class="cal-weekday">${day}</div>`;
        });
        html += '</div>';

        // Calculate how many cells we need
        const totalCells = Math.ceil((startPadding + totalDays) / 7) * 7;

        // Day cells
        for (let i = 0; i < totalCells; i++) {
            const dayNum = i - startPadding + 1;
            const isCurrentMonth = dayNum > 0 && dayNum <= totalDays;
            const cellDate = new Date(year, month, dayNum);

            let classes = ['cal-day-cell'];
            if (!isCurrentMonth) classes.push('other-month');
            if (isCurrentMonth && this.isToday(cellDate)) classes.push('today');
            if (isCurrentMonth && this.isPast(cellDate)) classes.push('past');

            // Get deadlines for this date
            const deadlines = isCurrentMonth ? this.getDeadlinesForDate(cellDate) : [];

            html += `<div class="${classes.join(' ')}" data-date="${cellDate.toISOString().split('T')[0]}">`;
            if (isCurrentMonth) {
                html += `<div class="cal-day-number">${dayNum}</div>`;
                html += '<div class="cal-chips-container">';
                deadlines.forEach(({ conference, deadline }) => {
                    html += this.createChip(conference, deadline, this.isPast(cellDate));
                });
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Render the week view
     * @returns {string} HTML string
     */
    renderWeekView() {
        const weekStart = this.getWeekStart(this.currentDate);

        let html = '<div class="cal-week-grid">';

        // Header row with day names and dates
        html += '<div class="cal-week-header">';
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const isToday = this.isToday(date);

            html += `<div class="cal-week-day-header ${isToday ? 'today' : ''}">`;
            html += `<div class="cal-week-day-name">${this.dayNames[i]}</div>`;
            html += `<div class="cal-week-day-number">${date.getDate()}</div>`;
            html += '</div>';
        }
        html += '</div>';

        // Content cells
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const isPastDate = this.isPast(date);
            const deadlines = this.getDeadlinesForDate(date);

            html += `<div class="cal-week-cell ${isPastDate ? 'past' : ''}" data-date="${date.toISOString().split('T')[0]}">`;
            html += '<div class="cal-week-chips-container">';
            deadlines.forEach(({ conference, deadline }) => {
                html += this.createWeekChip(conference, deadline, isPastDate);
            });
            html += '</div>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Create a week chip element (larger with deadline type)
     * @param {Object} conference
     * @param {Object} deadline
     * @param {boolean} isPast
     * @returns {string}
     */
    createWeekChip(conference, deadline, isPast = false) {
        const pastClass = isPast ? 'past' : '';
        return `
            <div class="cal-week-chip category-${conference.category} ${pastClass}"
                 data-conf-id="${conference.id}">
                <span class="cal-week-chip-name">${conference.name} ${conference.year}</span>
                <span class="cal-week-chip-type">${deadline.label}</span>
            </div>
        `;
    },

    /**
     * Render the day view
     * @returns {string} HTML string
     */
    renderDayView() {
        const deadlines = this.getDeadlinesForDate(this.currentDate);
        const isPastDate = this.isPast(this.currentDate);

        let html = '<div class="cal-day-view">';

        if (deadlines.length === 0) {
            html += `
                <div class="cal-day-empty">
                    <div class="cal-day-empty-icon">📅</div>
                    <h3>No deadlines on this day</h3>
                    <p>Navigate to another day or switch to month view</p>
                </div>
            `;
        } else {
            html += '<div class="cal-day-list">';
            deadlines.forEach(({ conference, deadline }) => {
                html += this.createDayCard(conference, deadline, isPastDate);
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Create a day card element (full-width deadline card)
     * @param {Object} conference
     * @param {Object} deadline
     * @param {boolean} isPast
     * @returns {string}
     */
    createDayCard(conference, deadline, isPast = false) {
        const pastClass = isPast ? 'past' : '';
        const time = this.formatDeadlineTime(deadline.date);

        return `
            <div class="cal-day-card category-${conference.category} ${pastClass}"
                 data-conf-id="${conference.id}">
                <div class="cal-day-card-dot"></div>
                <div class="cal-day-card-content">
                    <div class="cal-day-card-name">${conference.name} ${conference.year}</div>
                    <div class="cal-day-card-type">${deadline.label}</div>
                    <div class="cal-day-card-time">${time}</div>
                </div>
            </div>
        `;
    },

    /**
     * Format deadline time
     * @param {string} dateStr
     * @returns {string}
     */
    formatDeadlineTime(dateStr) {
        const date = new Date(dateStr);

        // Check if time is set (not midnight)
        if (date.getHours() === 0 && date.getMinutes() === 0) {
            return 'All Day';
        }

        // Check for AoE timezone (-12:00)
        if (dateStr.includes('-12:00')) {
            return '11:59 PM AoE';
        }

        const options = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
        return date.toLocaleTimeString('en-US', options);
    },

    /**
     * Render the year view - shows 12 mini-month calendars with chips on days
     * @returns {string} HTML string
     */
    renderYearView() {
        const year = this.currentDate.getFullYear();
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const today = new Date();

        let html = '<div class="cal-year-grid">';

        for (let month = 0; month < 12; month++) {
            const isCurrent = year === currentYear && month === currentMonth;
            const isPast = year < currentYear || (year === currentYear && month < currentMonth);
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const startPadding = firstDay.getDay();
            const totalDays = lastDay.getDate();

            let monthClasses = 'cal-mini-month';
            if (isCurrent) monthClasses += ' current';
            if (isPast) monthClasses += ' past';

            html += `<div class="${monthClasses}" data-month="${month}">`;
            html += `<div class="cal-mini-month-header">`;
            html += `<span class="cal-mini-month-name">${this.monthNames[month]}</span>`;
            html += `</div>`;

            // Mini calendar grid
            html += '<div class="cal-mini-grid">';

            // Weekday headers (S M T W T F S)
            const shortDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            shortDays.forEach(d => {
                html += `<div class="cal-mini-weekday">${d}</div>`;
            });

            // Day cells
            const totalCells = Math.ceil((startPadding + totalDays) / 7) * 7;
            for (let i = 0; i < totalCells; i++) {
                const dayNum = i - startPadding + 1;
                const isValidDay = dayNum > 0 && dayNum <= totalDays;
                const cellDate = new Date(year, month, dayNum);
                const isToday = isValidDay &&
                    cellDate.getDate() === today.getDate() &&
                    cellDate.getMonth() === today.getMonth() &&
                    cellDate.getFullYear() === today.getFullYear();

                // Get deadlines for this day
                const deadlines = isValidDay ? this.getDeadlinesForDate(cellDate) : [];
                const hasDeadlines = deadlines.length > 0;

                let cellClass = 'cal-mini-day';
                if (!isValidDay) cellClass += ' empty';
                if (isToday) cellClass += ' today';
                if (hasDeadlines) cellClass += ' has-deadline';

                html += `<div class="${cellClass}">`;
                if (isValidDay) {
                    html += `<span class="cal-mini-day-num">${dayNum}</span>`;
                    if (hasDeadlines) {
                        // Show abbreviation chips stacked vertically
                        html += '<div class="cal-mini-day-chips">';
                        deadlines.forEach(({ conference }) => {
                            html += `<span class="cal-mini-chip category-${conference.category}"
                                          data-conf-id="${conference.id}"
                                          title="${conference.name}">${conference.name}</span>`;
                        });
                        html += '</div>';
                    }
                }
                html += '</div>';
            }

            html += '</div>'; // cal-mini-grid
            html += '</div>'; // cal-mini-month
        }

        html += '</div>';
        return html;
    },

    /**
     * Attach click handlers to all chips and cards
     */
    attachChipHandlers() {
        // Chip clicks (month and week views)
        document.querySelectorAll('.cal-chip, .cal-week-chip, .cal-day-card').forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                const confId = chip.dataset.confId;
                this.openConferenceModal(confId);
            });
        });

        // Mini chip clicks (year view)
        document.querySelectorAll('.cal-mini-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                const confId = chip.dataset.confId;
                this.openConferenceModal(confId);
            });
        });

        // Mini month clicks (year view) - navigate to that month
        document.querySelectorAll('.cal-mini-month').forEach(miniMonth => {
            miniMonth.addEventListener('click', (e) => {
                // Don't navigate if clicking on a chip
                if (e.target.closest('.cal-mini-chip')) return;

                const month = parseInt(miniMonth.dataset.month);
                this.currentDate.setMonth(month);
                this.setView('month');
            });
        });

        // Day cell clicks (month view) - navigate to day view
        document.querySelectorAll('.cal-day-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                // Don't navigate if clicking on a chip
                if (e.target.closest('.cal-chip')) return;

                const dateStr = cell.dataset.date;
                if (dateStr) {
                    this.currentDate = new Date(dateStr);
                    this.setView('day');
                }
            });
        });
    },

    /**
     * Open the conference modal for a given conference ID
     * @param {string} confId
     */
    openConferenceModal(confId) {
        // Find the conference
        const conference = this.conferences.find(c => c.id === confId);
        if (!conference) return;

        // Use App's openModal method
        if (typeof App !== 'undefined' && App.openModal) {
            App.openModal(conference, null);
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Calendar;
}
