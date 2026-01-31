/**
 * Countdown Timer Module
 * Handles countdown calculations and display formatting
 * Smart display: shows "X days" normally, "Xh Xm Xs" only when < 24 hours
 */

const CountdownTimer = {
    // Store active timers
    timers: new Map(),
    
    /**
     * Calculate time remaining until a deadline
     * @param {string} dateString - ISO 8601 date string
     * @returns {Object} Time remaining breakdown
     */
    calculateRemaining(dateString) {
        const now = new Date();
        const deadline = new Date(dateString);
        const diff = deadline - now;
        
        if (diff <= 0) {
            return {
                total: 0,
                days: 0,
                hours: 0,
                minutes: 0,
                seconds: 0,
                isPassed: true
            };
        }
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        return {
            total: diff,
            days,
            hours,
            minutes,
            seconds,
            isPassed: false
        };
    },
    
    /**
     * Format countdown for display
     * Shows "X days" normally, "X mon Y days" for > 30, detailed countdown only < 24 hours
     * @param {Object} remaining - Time remaining breakdown
     * @returns {Object} Formatted display object
     */
    formatDisplay(remaining) {
        if (remaining.isPassed) {
            return {
                type: 'passed',
                value: 'Passed',
                unit: '',
                isDetailed: false
            };
        }
        
        // Less than 24 hours - show detailed countdown
        if (remaining.days === 0) {
            return {
                type: 'detailed',
                hours: String(remaining.hours).padStart(2, '0'),
                minutes: String(remaining.minutes).padStart(2, '0'),
                seconds: String(remaining.seconds).padStart(2, '0'),
                isDetailed: true
            };
        }
        
        // More than 30 days - show months + days
        if (remaining.days > 30) {
            const months = Math.floor(remaining.days / 30);
            const days = remaining.days % 30;
            const monthText = months === 1 ? 'month' : 'months';
            const dayText = days === 1 ? 'day' : 'days';

            if (days === 0) {
                return {
                    type: 'simple',
                    value: String(months).padStart(2, '0'),
                    unit: months === 1 ? 'month' : 'months',
                    isDetailed: false
                };
            }

            return {
                type: 'monthday',
                months: String(months).padStart(2, '0'),
                days: String(days).padStart(2, '0'),
                monthUnit: monthText,
                dayUnit: dayText,
                isDetailed: false
            };
        }

        // 1-30 days - show days only (zero-padded)
        const dayText = remaining.days === 1 ? 'day' : 'days';
        return {
            type: 'simple',
            value: String(remaining.days).padStart(2, '0'),
            unit: dayText,
            isDetailed: false
        };
    },
    
    /**
     * Get urgency status based on time remaining
     * @param {Object} remaining - Time remaining breakdown
     * @returns {string} Status class name
     */
    getStatus(remaining) {
        if (remaining.isPassed) return 'passed';
        if (remaining.days === 0) return 'critical';
        if (remaining.days <= 3) return 'critical';
        if (remaining.days <= 7) return 'urgent';
        if (remaining.days <= 14) return 'soon';
        if (remaining.days <= 30) return 'upcoming';
        return 'future';
    },
    
    /**
     * Update a countdown display element
     * @param {HTMLElement} container - Container element
     * @param {string} dateString - ISO 8601 date string
     */
    updateDisplay(container, dateString) {
        const remaining = this.calculateRemaining(dateString);
        const formatted = this.formatDisplay(remaining);
        const status = this.getStatus(remaining);
        
        // Update status on card
        const card = container.closest('.conference-card');
        if (card) {
            card.dataset.status = status;
        }
        
        // Update the countdown container
        container.className = 'countdown' + (formatted.isDetailed ? ' detailed' : '');
        
        if (formatted.type === 'passed') {
            container.innerHTML = `
                <span class="countdown-value">Passed</span>
            `;
        } else if (formatted.isDetailed) {
            container.innerHTML = `
                <div class="countdown-segment">
                    <span class="segment-value">${formatted.hours}</span>
                    <span class="segment-label">hrs</span>
                </div>
                <div class="countdown-segment">
                    <span class="segment-value">${formatted.minutes}</span>
                    <span class="segment-label">min</span>
                </div>
                <div class="countdown-segment">
                    <span class="segment-value">${formatted.seconds}</span>
                    <span class="segment-label">sec</span>
                </div>
            `;
        } else if (formatted.type === 'monthday') {
            container.innerHTML = `
                <span class="countdown-value">${formatted.months}</span>
                <span class="countdown-unit">${formatted.monthUnit}</span>
                <span class="countdown-value" style="margin-left: 8px;">${formatted.days}</span>
                <span class="countdown-unit">${formatted.dayUnit}</span>
            `;
        } else {
            container.innerHTML = `
                <span class="countdown-value">${formatted.value}</span>
                <span class="countdown-unit">${formatted.unit}</span>
            `;
        }
        
        return { remaining, formatted, status };
    },
    
    /**
     * Start a countdown timer for an element
     * @param {string} id - Unique identifier for this timer
     * @param {HTMLElement} container - Container element
     * @param {string} dateString - ISO 8601 date string
     * @param {Function} onComplete - Callback when countdown completes
     */
    startTimer(id, container, dateString, onComplete = null) {
        // Clear existing timer if any
        this.stopTimer(id);
        
        // Initial update
        const result = this.updateDisplay(container, dateString);
        
        // Only start interval if countdown is still active and < 24 hours
        if (!result.remaining.isPassed) {
            const interval = setInterval(() => {
                const newResult = this.updateDisplay(container, dateString);
                
                if (newResult.remaining.isPassed) {
                    this.stopTimer(id);
                    if (onComplete) {
                        onComplete();
                    }
                }
            }, result.formatted.isDetailed ? 1000 : 60000); // Update every second if detailed, every minute otherwise
            
            this.timers.set(id, interval);
        }
    },
    
    /**
     * Stop a countdown timer
     * @param {string} id - Timer identifier
     */
    stopTimer(id) {
        if (this.timers.has(id)) {
            clearInterval(this.timers.get(id));
            this.timers.delete(id);
        }
    },
    
    /**
     * Stop all timers
     */
    stopAllTimers() {
        this.timers.forEach((interval, id) => {
            clearInterval(interval);
        });
        this.timers.clear();
    },
    
    /**
     * Format a date for display in deadline list
     * @param {string} dateString - ISO 8601 date string
     * @param {string} endDateString - Optional end date for events
     * @returns {string} Formatted date string
     */
    formatDate(dateString, endDateString = null) {
        const date = new Date(dateString);
        const month = date.toLocaleDateString('en-US', { month: 'short' });
        const day = String(date.getDate()).padStart(2, '0');

        if (endDateString) {
            const endDate = new Date(endDateString);
            const endDay = String(endDate.getDate()).padStart(2, '0');
            // Same month
            if (date.getMonth() === endDate.getMonth()) {
                return `${month} ${day}-${endDay}`;
            }
            // Different months
            const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
            return `${month} ${day} - ${endMonth} ${endDay}`;
        }

        return `${month} ${day}`;
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CountdownTimer;
}
