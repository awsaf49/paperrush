/**
 * Deadline Drop - Main Application
 * Conference Deadline Tracker
 */

const App = {
    conferences: [],
    filteredConferences: [],
    activeFilter: 'all',
    
    /**
     * Initialize the application
     */
    async init() {
        console.log('🎯 Deadline Drop initializing...');
        
        // Load data
        this.loadData();
        
        // Set up event listeners
        this.setupFilters();
        
        // Initialize modal
        this.initModal();
        
        // Render conferences
        this.render();
        
        // Initialize timeline
        TimelineDrawer.init();
        
        // Update last updated date
        this.updateLastUpdated();
        
        // Hide loading state
        document.getElementById('loading-state').classList.add('hidden');
        
        console.log('✅ Deadline Drop ready!');
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
        
        // Bump all deadline dates by 1 year and mark as estimated
        const newDeadlines = conf.deadlines.map(d => {
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
        
        // Filter out event type, find first upcoming deadline
        const submissionDeadlines = deadlines.filter(d => 
            d.type !== 'event' && 
            d.type !== 'notification' && 
            d.type !== 'camera'
        );
        
        // Find first non-passed deadline
        for (const deadline of submissionDeadlines) {
            const deadlineDate = new Date(deadline.date);
            if (deadlineDate > now) {
                return deadline;
            }
        }
        
        // If all submission deadlines passed, return event date
        const eventDeadline = deadlines.find(d => d.type === 'event');
        if (eventDeadline) {
            const eventDate = new Date(eventDeadline.date);
            if (eventDate > now) {
                return eventDeadline;
            }
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
            });
        });
    },
    
    /**
     * Apply the current filter
     */
    applyFilter() {
        if (this.activeFilter === 'all') {
            this.filteredConferences = [...this.conferences];
        } else {
            this.filteredConferences = this.conferences.filter(conf => 
                conf.category === this.activeFilter
            );
        }
        
        this.render();
        TimelineDrawer.redraw();
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
        
        // Get column count for snake ordering
        const columns = this.getColumnCount();
        
        // Render each conference with snake order
        this.filteredConferences.forEach((conf, index) => {
            const card = this.createCard(conf, template, index);
            
            // Apply snake ordering via CSS order
            const row = Math.floor(index / columns);
            const posInRow = index % columns;
            
            // Even rows: normal order, Odd rows: reversed
            let visualIndex;
            if (row % 2 === 0) {
                visualIndex = row * columns + posInRow;
            } else {
                visualIndex = row * columns + (columns - 1 - posInRow);
            }
            
            card.style.order = visualIndex;
            
            grid.appendChild(card);
        });
    },
    
    /**
     * Get current column count based on viewport
     */
    getColumnCount() {
        const width = window.innerWidth;
        if (width <= 600) return 1;
        if (width <= 900) return 2;
        if (width <= 1200) return 3;
        return 4;
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
        
        // Logo
        const logoImg = card.querySelector('.logo-img');
        const logoContainer = card.querySelector('.card-logo');
        
        // Try to load logo (SVG first, then PNG), fall back to text
        const logoName = conf.name.toLowerCase();
        logoImg.src = `assets/logos/${logoName}.svg`;
        logoImg.alt = conf.name;
        logoImg.onerror = () => {
            // Try PNG
            logoImg.onerror = () => {
                // Fall back to text placeholder
                logoContainer.innerHTML = `<span class="logo-placeholder">${conf.name.substring(0, 2)}</span>`;
            };
            logoImg.src = `assets/logos/${logoName}.png`;
        };
        
        // Title (with estimated badge if needed)
        const confNameEl = card.querySelector('.conf-name');
        if (conf.isEstimated) {
            confNameEl.innerHTML = `${conf.name} ${conf.year} <span class="estimated-badge">Est</span>`;
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
        
        // Deadlines list - always render 5 slots for consistency
        const deadlinesList = card.querySelector('.deadlines-list');
        const MAX_SLOTS = 5;
        
        // Determine which deadline is currently active (first non-passed one)
        const now = new Date();
        let activeIndex = -1;
        for (let i = 0; i < conf.deadlines.length; i++) {
            const deadline = conf.deadlines[i];
            const deadlineDate = new Date(deadline.date);
            if (deadlineDate > now) {
                activeIndex = i;
                break;
            }
        }
        
        // Render deadlines
        for (let i = 0; i < MAX_SLOTS; i++) {
            const li = document.createElement('li');
            
            if (i < conf.deadlines.length) {
                const deadline = conf.deadlines[i];
                const deadlineDate = new Date(deadline.date);
                const isPassed = deadlineDate <= now;
                const isActive = i === activeIndex;
                
                li.className = 'deadline-item ' + (isPassed ? 'passed' : (isActive ? 'active' : 'upcoming'));
                
                const statusIcon = isPassed ? '✓' : (isActive ? '●' : '○');
                
                const dateStr = deadline.endDate 
                    ? CountdownTimer.formatDate(deadline.date, deadline.endDate)
                    : CountdownTimer.formatDate(deadline.date);
                
                const estimatedMark = deadline.estimated ? '~' : '';
                
                li.innerHTML = `
                    <span class="status-icon">${statusIcon}</span>
                    <span class="deadline-type">${deadline.label}</span>
                    <span class="deadline-date ${deadline.estimated ? 'estimated' : ''}">${estimatedMark}${dateStr}</span>
                `;
            } else {
                // Empty slot for alignment
                li.className = 'deadline-item empty';
                li.innerHTML = `
                    <span class="status-icon">○</span>
                    <span class="deadline-type">—</span>
                    <span class="deadline-date">—</span>
                `;
            }
            
            deadlinesList.appendChild(li);
        }
        
        // Click to open modal
        card.addEventListener('click', () => {
            this.openModal(conf);
        });
        
        return card;
    },
    
    /**
     * Open modal with conference details
     * @param {Object} conf - Conference data
     */
    openModal(conf) {
        const overlay = document.getElementById('modal-overlay');
        const gradient = this.getCardGradient(conf.brandColor, conf.category);
        
        // Set header gradient
        const header = overlay.querySelector('.modal-gradient-header');
        header.style.background = gradient;
        
        // Set logo
        const logoImg = document.getElementById('modal-logo-img');
        const logoText = document.getElementById('modal-logo-text');
        const logoName = conf.name.toLowerCase();
        
        logoImg.src = `assets/logos/${logoName}.svg`;
        logoImg.onerror = () => {
            logoImg.onerror = () => {
                logoImg.style.display = 'none';
                logoText.textContent = conf.name.substring(0, 2);
                logoText.style.display = 'block';
            };
            logoImg.src = `assets/logos/${logoName}.png`;
        };
        logoImg.style.display = 'block';
        logoText.style.display = 'none';
        
        // Set title and location
        document.getElementById('modal-title').textContent = `${conf.name} ${conf.year}`;
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
        
        conf.deadlines.forEach((deadline, i) => {
            const li = document.createElement('li');
            const deadlineDate = new Date(deadline.date);
            const isPassed = deadlineDate <= now;
            const isActive = !isPassed && conf.activeDeadline && deadline.label === conf.activeDeadline.label;
            
            li.className = isPassed ? 'passed' : (isActive ? 'active' : '');
            
            const statusIcon = isPassed ? '✓' : (isActive ? '●' : '○');
            const dateStr = deadline.endDate 
                ? CountdownTimer.formatDate(deadline.date, deadline.endDate)
                : CountdownTimer.formatDate(deadline.date);
            
            li.innerHTML = `
                <span class="status-icon">${statusIcon}</span>
                <span class="deadline-type">${deadline.label}</span>
                <span class="deadline-date">${deadline.estimated ? '~' : ''}${dateStr}</span>
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
        
        // Show modal
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    },
    
    /**
     * Close modal
     */
    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
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
            // ML - Diagonal sweep from top-left, warm sunset feel
            'ml': `
                radial-gradient(ellipse 150% 80% at -30% -20%, rgba(255, 80, 180, 0.7), transparent 50%),
                radial-gradient(ellipse 100% 100% at 120% 20%, rgba(255, 180, 50, 0.6), transparent 45%),
                radial-gradient(ellipse 80% 60% at 50% 120%, rgba(255, 120, 100, 0.35), transparent 50%),
                linear-gradient(160deg, #fff0f5 0%, #fffaf0 60%, #fff5f5 100%)
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
            // Speech - Radial burst from bottom, warm energy feel
            'speech': `
                radial-gradient(ellipse 120% 100% at 50% 130%, rgba(251, 146, 60, 0.65), transparent 55%),
                radial-gradient(ellipse 100% 100% at -20% -20%, rgba(253, 224, 71, 0.5), transparent 50%),
                radial-gradient(ellipse 80% 80% at 120% 0%, rgba(251, 113, 133, 0.45), transparent 50%),
                linear-gradient(0deg, #ffedd5 0%, #fef3c7 50%, #fee2e2 100%)
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

// Handle resize to update snake ordering
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        App.render();
        TimelineDrawer.redraw();
    }, 150);
});

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
}
