/**
 * Deadline Drop - Main Application
 * Conference Deadline Tracker
 */

const App = {
    conferences: [],
    filteredConferences: [],
    activeFilter: 'all',
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
            this.setupSearch();
            this.setupViewToggle();

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
                loadingState.innerHTML = `<p style="color: red;">Error loading: ${error.message}</p>`;
            }
        }
    },
    
    /**
     * Load conference data
     */
    loadData() {
        // Use the data from data.js
        this.conferences = CONFERENCES_DATA.conferences.map(conf => {
            // Check if all deadlines have passed
            const allPassed = this.allDeadlinesPassed(conf.deadlines);
            
            if (allPassed) {
                // Create next year version with estimated deadlines
                return this.createNextYearConference(conf);
            }
            
            // Find the next upcoming deadline
            const activeDeadline = this.findActiveDeadline(conf.deadlines);
            return {
                ...conf,
                activeDeadline,
                sortDate: activeDeadline ? new Date(activeDeadline.date) : new Date('2099-12-31')
            };
        });
        
        // Sort by next deadline
        this.sortConferences();
        this.filteredConferences = [...this.conferences];
    },
    
    /**
     * Check if all deadlines for a conference have passed
     * @param {Array} deadlines - Array of deadline objects
     * @returns {boolean} True if all deadlines passed
     */
    allDeadlinesPassed(deadlines) {
        const now = new Date();
        return deadlines.every(d => new Date(d.date) <= now);
    },
    
    /**
     * Create next year's conference with estimated deadlines
     * @param {Object} conf - Original conference object
     * @returns {Object} New conference with bumped year and estimated deadlines
     */
    createNextYearConference(conf) {
        const nextYear = conf.year + 1;

        // For estimates, only keep key deadlines: abstract, paper submission, main event
        const keyDeadlines = conf.deadlines.filter(d => {
            const label = (d.label || '').toLowerCase();
            const type = (d.type || '').toLowerCase();

            // Keep abstract submission
            if (type === 'abstract' || label.includes('abstract')) return true;

            // Keep main paper submission (but not workshops, tutorials, etc.)
            if (type === 'paper' && label.includes('paper') &&
                !label.includes('workshop') && !label.includes('tutorial') &&
                !label.includes('demo') && !label.includes('position')) return true;

            // Keep main conference event
            if (type === 'event' && label.includes('conference')) return true;

            return false;
        });

        // Bump deadline dates by 1 year and mark as estimated
        const newDeadlines = keyDeadlines.map(d => {
            const oldDate = new Date(d.date);
            const newDate = new Date(oldDate);
            newDate.setFullYear(newDate.getFullYear() + 1);

            // Also bump end date if exists
            let newEndDate = null;
            if (d.endDate) {
                const oldEndDate = new Date(d.endDate);
                newEndDate = new Date(oldEndDate);
                newEndDate.setFullYear(newEndDate.getFullYear() + 1);
            }

            return {
                ...d,
                date: newDate.toISOString(),
                endDate: newEndDate ? newEndDate.toISOString().split('T')[0] : d.endDate,
                status: 'upcoming',
                estimated: true
            };
        });
        
        const activeDeadline = this.findActiveDeadline(newDeadlines);
        
        return {
            ...conf,
            id: `${conf.id.split('-')[0]}-${nextYear}`,
            year: nextYear,
            deadlines: newDeadlines,
            location: {
                ...conf.location,
                city: 'TBD',
                country: 'TBD',
                flag: '🌍',
                venue: 'TBD'
            },
            activeDeadline,
            sortDate: activeDeadline ? new Date(activeDeadline.date) : new Date('2099-12-31'),
            isEstimated: true
        };
    },
    
    /**
     * Find the next active (not passed) deadline
     * @param {Array} deadlines - Array of deadline objects
     * @returns {Object|null} Active deadline or null
     */
    findActiveDeadline(deadlines) {
        const now = new Date();

        // Sort all deadlines by date first
        const sortedDeadlines = [...deadlines].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );

        // Filter out only notification and camera-ready (keep events for bidding, etc.)
        const relevantDeadlines = sortedDeadlines.filter(d =>
            d.type !== 'notification' &&
            d.type !== 'camera'
        );

        // Find first non-passed deadline
        for (const deadline of relevantDeadlines) {
            const deadlineDate = new Date(deadline.date);
            if (deadlineDate > now) {
                return deadline;
            }
        }

        // If all relevant deadlines passed, check for conference event
        const conferenceEvent = sortedDeadlines.find(d =>
            d.type === 'event' &&
            d.label.toLowerCase().includes('conference') &&
            new Date(d.date) > now
        );
        if (conferenceEvent) {
            return conferenceEvent;
        }

        // All deadlines passed
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
            noResults.innerHTML = `
                <div class="no-results-icon">🔍</div>
                <h3>No conferences found</h3>
                <p>${this.searchQuery
                    ? `No results for "${this.searchQuery}". Try a different search term.`
                    : 'No conferences in this category yet.'
                }</p>
            `;
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
        if (conf.isEstimated) {
            confNameEl.innerHTML = `${conf.name} ${conf.year} <span class="estimated-badge" title="Dates are approximate based on previous year">Approx</span>`;
        } else {
            confNameEl.textContent = `${conf.name} ${conf.year}`;
        }
        card.querySelector('.conf-location').textContent = `${conf.location.city}, ${conf.location.country} ${conf.location.flag}`;
        
        // Active deadline
        const deadlineSection = card.querySelector('.card-deadline');
        const deadlineLabel = card.querySelector('.deadline-label');
        const countdownContainer = card.querySelector('.countdown');
        
        if (conf.activeDeadline) {
            deadlineLabel.textContent = conf.activeDeadline.label;
            
            // Start countdown
            CountdownTimer.startTimer(
                conf.id,
                countdownContainer,
                conf.activeDeadline.date,
                () => {
                    // On complete, refresh the card
                    this.loadData();
                    this.applyFilter();
                }
            );
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
            new Date(a.date) - new Date(b.date)
        );

        const now = new Date();

        // Find the first upcoming deadline index
        let activeIndex = -1;
        for (let i = 0; i < sortedDeadlines.length; i++) {
            if (new Date(sortedDeadlines[i].date) > now) {
                activeIndex = i;
                break;
            }
        }

        // Render ALL deadlines
        sortedDeadlines.forEach((deadline, i) => {
            const li = document.createElement('li');
            const deadlineDate = new Date(deadline.date);
            const isPassed = deadlineDate <= now;
            const isActive = i === activeIndex;

            li.className = 'deadline-item ' + (isPassed ? 'passed' : (isActive ? 'active' : 'upcoming'));

            const statusIcon = isPassed ? '✓' : (isActive ? '●' : '○');

            const dateStr = deadline.endDate
                ? CountdownTimer.formatDate(deadline.date, deadline.endDate)
                : CountdownTimer.formatDate(deadline.date);

            const estimatedMark = deadline.estimated
                ? '<span class="approx-mark" title="Approximate date">~</span>'
                : '';

            li.innerHTML = `
                <span class="status-icon">${statusIcon}</span>
                <span class="deadline-type">${deadline.label}</span>
                <span class="deadline-date ${deadline.estimated ? 'estimated' : ''}">${estimatedMark}${dateStr}</span>
            `;

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
            const remaining = CountdownTimer.calculateRemaining(conf.activeDeadline.date);
            const format = CountdownTimer.formatDisplay(remaining);

            if (format.type === 'monthday') {
                countdownValue.textContent = `${format.months} ${format.monthUnit} ${format.days} ${format.dayUnit}`;
            } else if (format.type === 'detailed') {
                countdownValue.textContent = `${format.hours} hrs : ${format.minutes} min : ${format.seconds} sec`;
            } else {
                countdownValue.textContent = `${format.value} ${format.unit}`;
            }
        } else {
            countdownLabel.textContent = 'Status';
            countdownValue.textContent = 'All Deadlines Passed';
        }
        
        // Set links
        const officialLink = document.getElementById('modal-link-official');
        const cfpLink = document.getElementById('modal-link-cfp');
        const templateLink = document.getElementById('modal-link-template');
        const authorLink = document.getElementById('modal-link-author');
        
        if (conf.links.official || conf.website) {
            officialLink.href = conf.links.official || conf.website;
            officialLink.classList.remove('hidden');
        } else {
            officialLink.classList.add('hidden');
        }
        
        if (conf.links.author || conf.links.cfp) {
            cfpLink.href = conf.links.author || conf.links.cfp;
            cfpLink.classList.remove('hidden');
        } else {
            cfpLink.classList.add('hidden');
        }
        
        if (conf.links.template) {
            templateLink.href = conf.links.template;
            templateLink.classList.remove('hidden');
        } else {
            templateLink.classList.add('hidden');
        }
        
        if (conf.links.authorGuide) {
            authorLink.href = conf.links.authorGuide;
            authorLink.classList.remove('hidden');
        } else {
            authorLink.classList.add('hidden');
        }
        
        // Set info
        document.getElementById('modal-page-limit').textContent = conf.info?.pageLimit || '—';
        document.getElementById('modal-review-type').textContent = conf.info?.reviewType || '—';
        document.getElementById('modal-acceptance-rate').textContent = conf.info?.acceptanceRate || '—';
        
        // Set deadlines list
        const deadlinesList = document.getElementById('modal-deadlines-list');
        deadlinesList.innerHTML = '';
        const now = new Date();

        // Sort deadlines by date before rendering
        const sortedDeadlines = [...conf.deadlines].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );

        sortedDeadlines.forEach((deadline, i) => {
            const li = document.createElement('li');
            const deadlineDate = new Date(deadline.date);
            const isPassed = deadlineDate <= now;
            const isActive = !isPassed && conf.activeDeadline && deadline.label === conf.activeDeadline.label;
            
            li.className = isPassed ? 'passed' : (isActive ? 'active' : '');
            
            const statusIcon = isPassed ? '✓' : (isActive ? '●' : '○');
            const dateStr = deadline.endDate 
                ? CountdownTimer.formatDate(deadline.date, deadline.endDate)
                : CountdownTimer.formatDate(deadline.date);
            
            const modalEstimatedMark = deadline.estimated
                ? '<span class="approx-mark" title="Approximate date">~</span>'
                : '';

            li.innerHTML = `
                <span class="status-icon">${statusIcon}</span>
                <span class="deadline-type">${deadline.label}</span>
                <span class="deadline-date">${modalEstimatedMark}${dateStr}</span>
            `;
            deadlinesList.appendChild(li);
        });
        
        // Set notes
        const notesList = document.getElementById('modal-notes-list');
        notesList.innerHTML = '';
        
        const defaultNotes = [
            'Check official website for latest updates',
            'All deadlines are in AoE (Anywhere on Earth) timezone'
        ];
        const notes = conf.notes || defaultNotes;
        
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Handle visibility change (pause/resume timers)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        CountdownTimer.stopAllTimers();
    } else {
        App.render();
    }
});

// Handle resize to update snake ordering and filter indicator
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        App.render();
        TimelineDrawer.redraw();
        App.updateFilterIndicator();
    }, 150);
});

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
}
