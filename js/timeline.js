/**
 * Timeline Drawing Module
 * Draws SVG connections between cards in the snake grid layout
 * with smooth bezier curves and animated gradient
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
     * Get the number of columns based on ACTUAL container size
     * Must match app.js calculation!
     */
    getColumnCount() {
        if (!this.grid) return 4;

        const containerWidth = this.grid.clientWidth;
        const cardMinWidth = 280;
        const gap = 72;

        const maxColumns = Math.floor((containerWidth + gap) / (cardMinWidth + gap));
        return Math.max(1, Math.min(maxColumns, 4));
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
     * Check if two positions are on the same visual row
     * Based on actual Y positions, not calculated indices
     */
    isSameRow(pos1, pos2) {
        const threshold = 50; // pixels tolerance
        return Math.abs(pos1.y - pos2.y) < threshold;
    },

    /**
     * Draw the timeline connections with smooth bezier curves
     */
    draw() {
        if (!this.svg || !this.grid) return;

        // Get cards in DOM order (which is chronological - sorted by deadline)
        const cards = Array.from(this.grid.querySelectorAll('.conference-card:not(.hidden)'));
        if (cards.length < 2) {
            this.svg.innerHTML = '';
            return;
        }

        // For mobile (single column), don't draw
        if (window.innerWidth <= 680) {
            this.svg.innerHTML = '';
            return;
        }

        // Get positions in chronological order (DOM order)
        // The CSS order property positions them visually in snake pattern
        const gridRect = this.grid.getBoundingClientRect();
        const positions = cards.map((card, index) => {
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

        // Build path connecting cards in chronological order
        // Cards are in DOM order (chronological), positions are their visual locations
        let pathData = '';

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];

            if (i === 0) {
                pathData = `M ${pos.x} ${pos.y}`;
            } else {
                const prev = positions[i - 1];
                const sameRow = this.isSameRow(prev, pos);

                if (sameRow) {
                    // Same row - straight line
                    pathData += ` L ${pos.x} ${pos.y}`;
                } else {
                    // Row transition - smooth S-curve
                    const midY = (prev.y + pos.y) / 2;
                    pathData += ` C ${prev.x} ${midY}, ${pos.x} ${midY}, ${pos.x} ${pos.y}`;
                }
            }
        }

        // Animation timing (must match app.js)
        const delayPerCard = 0.35; // seconds between each card
        const initialDelay = 0.4; // wait before starting

        const lineColor = '#9CA3AF';
        const lineColorLight = '#D1D5DB';

        // Build path segments (one per connection between cards)
        const segments = [];
        for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1];
            const pos = positions[i];
            const sameRow = this.isSameRow(prev, pos);

            let segmentPath;
            if (sameRow) {
                segmentPath = `M ${prev.x} ${prev.y} L ${pos.x} ${pos.y}`;
            } else {
                const midY = (prev.y + pos.y) / 2;
                segmentPath = `M ${prev.x} ${prev.y} C ${prev.x} ${midY}, ${pos.x} ${midY}, ${pos.x} ${pos.y}`;
            }
            segments.push(segmentPath);
        }

        // Create SVG with segments and nodes (all hidden initially)
        this.svg.innerHTML = `
            <defs>
                <filter id="timeline-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            <!-- Line segments - each draws progressively -->
            ${segments.map((seg, i) => `
                <path
                    d="${seg}"
                    fill="none"
                    stroke="${lineColor}"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    opacity="0"
                    class="timeline-segment"
                    data-index="${i}"
                />
            `).join('')}

            <!-- Node markers (bubbles) -->
            ${positions.map((pos, i) => {
                const size = i === 0 ? 8 : 5;
                return `
                    <g class="timeline-node" data-index="${i}" style="opacity: 0; transform: scale(0); transform-origin: ${pos.x}px ${pos.y}px;">
                        <circle cx="${pos.x}" cy="${pos.y}" r="${size + 3}" fill="${lineColorLight}" />
                        <circle cx="${pos.x}" cy="${pos.y}" r="${size}" fill="${lineColor}" />
                        <circle cx="${pos.x}" cy="${pos.y}" r="${size - 2}" fill="white" opacity="0.4" />
                    </g>
                `;
            }).join('')}
        `;

        const segmentEls = this.svg.querySelectorAll('.timeline-segment');
        const nodeEls = this.svg.querySelectorAll('.timeline-node');
        const drawDuration = delayPerCard * 0.6; // line draws in 60% of the interval

        // Animate: first node appears, then segment draws + next node appears
        nodeEls.forEach((node, i) => {
            const nodeDelay = (initialDelay + (i * delayPerCard)) * 1000;

            // Show node (bubble) with scale animation
            setTimeout(() => {
                node.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                node.style.opacity = '1';
                node.style.transform = 'scale(1)';
            }, Math.max(0, nodeDelay - 80)); // slightly before card

            // Draw segment leading TO this node (segment i-1 leads to node i)
            if (i > 0 && segmentEls[i - 1]) {
                const segment = segmentEls[i - 1];
                const segLength = segment.getTotalLength();
                const segStartDelay = (initialDelay + ((i - 1) * delayPerCard) + 0.15) * 1000;

                // Setup for draw animation (solid line first)
                segment.style.strokeDasharray = segLength;
                segment.style.strokeDashoffset = segLength;
                segment.style.opacity = '1';

                // Trigger draw animation
                setTimeout(() => {
                    segment.style.transition = `stroke-dashoffset ${drawDuration}s ease-out`;
                    segment.style.strokeDashoffset = '0';

                    // After draw completes, switch to dashed pattern
                    setTimeout(() => {
                        segment.style.transition = 'none';
                        segment.style.strokeDasharray = '6 8';
                        segment.style.strokeDashoffset = '0';
                    }, drawDuration * 1000 + 50);
                }, Math.max(0, segStartDelay));
            }
        });
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
