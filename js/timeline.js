/**
 * Timeline Drawing Module
 * Draws SVG connections between cards in the snake grid layout
 */

const TimelineDrawer = {
    svg: null,
    grid: null,
    resizeObserver: null,
    
    /**
     * Initialize the timeline drawer
     */
    init() {
        this.svg = document.getElementById('timeline-svg');
        this.grid = document.getElementById('conference-grid');
        
        if (!this.svg || !this.grid) return;
        
        // Set up resize observer
        this.resizeObserver = new ResizeObserver(() => {
            this.draw();
        });
        this.resizeObserver.observe(this.grid);
        
        // Initial draw after cards are rendered
        setTimeout(() => this.draw(), 100);
    },
    
    /**
     * Get the number of columns in the grid
     * @returns {number} Number of columns
     */
    getColumnCount() {
        const cards = this.grid.querySelectorAll('.conference-card:not(.hidden)');
        if (cards.length === 0) return 4;
        
        const gridStyle = window.getComputedStyle(this.grid);
        const columns = gridStyle.getPropertyValue('grid-template-columns').split(' ').length;
        return columns;
    },
    
    /**
     * Get card positions for drawing connections
     * @returns {Array} Array of card center positions
     */
    getCardPositions() {
        const cards = this.grid.querySelectorAll('.conference-card:not(.hidden)');
        const positions = [];
        const gridRect = this.grid.getBoundingClientRect();
        
        cards.forEach((card, index) => {
            const rect = card.getBoundingClientRect();
            positions.push({
                index,
                x: rect.left - gridRect.left + rect.width / 2,
                y: rect.top - gridRect.top + rect.height / 2,
                top: rect.top - gridRect.top,
                bottom: rect.top - gridRect.top + rect.height,
                left: rect.left - gridRect.left,
                right: rect.left - gridRect.left + rect.width,
                width: rect.width,
                height: rect.height
            });
        });
        
        return positions;
    },
    
    /**
     * Calculate snake order position
     * @param {number} index - Card index
     * @param {number} columns - Number of columns
     * @returns {Object} Row and column position
     */
    getSnakePosition(index, columns) {
        const row = Math.floor(index / columns);
        const posInRow = index % columns;
        
        // Even rows: left to right, Odd rows: right to left
        const col = row % 2 === 0 ? posInRow : columns - 1 - posInRow;
        
        return { row, col, isReversed: row % 2 !== 0 };
    },
    
    /**
     * Draw the timeline connections
     */
    draw() {
        if (!this.svg || !this.grid) return;
        
        const cards = Array.from(this.grid.querySelectorAll('.conference-card:not(.hidden)'));
        if (cards.length < 2) {
            this.svg.innerHTML = '';
            return;
        }
        
        const columns = this.getColumnCount();
        
        // For mobile (single column), don't draw - use CSS timeline
        if (columns === 1) {
            this.svg.innerHTML = '';
            return;
        }
        
        // Sort cards by their CSS order property to get visual positions
        const sortedCards = cards.sort((a, b) => {
            const orderA = parseInt(a.style.order) || 0;
            const orderB = parseInt(b.style.order) || 0;
            return orderA - orderB;
        });
        
        // Get positions
        const gridRect = this.grid.getBoundingClientRect();
        const positions = sortedCards.map((card, index) => {
            const rect = card.getBoundingClientRect();
            return {
                index,
                x: rect.left - gridRect.left + rect.width / 2,
                y: rect.top - gridRect.top + rect.height / 2,
                top: rect.top - gridRect.top,
                bottom: rect.top - gridRect.top + rect.height,
                left: rect.left - gridRect.left,
                right: rect.left - gridRect.left + rect.width,
                width: rect.width,
                height: rect.height
            };
        });
        
        // Set SVG size
        this.svg.setAttribute('width', gridRect.width);
        this.svg.setAttribute('height', gridRect.height);
        this.svg.style.width = gridRect.width + 'px';
        this.svg.style.height = gridRect.height + 'px';
        
        // Build path connecting centers
        let pathData = '';
        
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            
            if (i === 0) {
                pathData = `M ${pos.x} ${pos.y}`;
            } else {
                const prev = positions[i - 1];
                const row = Math.floor(i / columns);
                const prevRow = Math.floor((i - 1) / columns);
                
                // Same row - direct line
                if (row === prevRow) {
                    pathData += ` L ${pos.x} ${pos.y}`;
                } else {
                    // Different row - go down then across
                    const midY = (prev.bottom + pos.top) / 2;
                    pathData += ` L ${prev.x} ${midY}`;
                    pathData += ` L ${pos.x} ${midY}`;
                    pathData += ` L ${pos.x} ${pos.y}`;
                }
            }
        }
        
        // Create SVG with animated gradient
        this.svg.innerHTML = `
            <defs>
                <linearGradient id="timeline-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#667eea;stop-opacity:0.8" />
                    <stop offset="50%" style="stop-color:#764ba2;stop-opacity:0.6" />
                    <stop offset="100%" style="stop-color:#f093fb;stop-opacity:0.4" />
                </linearGradient>
            </defs>
            <path d="${pathData}" />
        `;
    },
    
    /**
     * Redraw the timeline
     */
    redraw() {
        // Small delay to allow DOM to update
        setTimeout(() => this.draw(), 50);
    },
    
    /**
     * Cleanup
     */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        this.svg = null;
        this.grid = null;
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimelineDrawer;
}
