# Contributing to PaperRush

Thanks for your interest in improving PaperRush! This project helps AI/ML researchers track conference deadlines with a beautiful, responsive interface. Your contributions help the research community stay organized.

**Quick Links:** [GitHub Issues](https://github.com/awsaf49/paperrush/issues) | [Roadmap](README.md#-roadmap) | [Live Demo](https://awsaf49.github.io/paperrush/)

---

## Quick Start

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/paperrush.git
cd paperrush

# 2. Create a branch for your changes
git checkout -b feat/add-new-conference

# 3. Make your changes and test locally
open index.html   # No build tools needed!

# 4. Commit and push
git add js/data.js
git commit -m "feat: add CONF 2026 deadline data"
git push origin feat/add-new-conference

# 5. Open a pull request on GitHub
```

---

## Ways to Contribute

| Type | Difficulty | Description |
|------|------------|-------------|
| **Update Deadlines** | Easy | Fix incorrect dates or add missing info to existing conferences |
| **Add Conference** | Easy | Add a new conference manually to `js/data.js` |
| **Add to Scraper** | Medium | Configure auto-updates for a new conference |
| **Add Category** | Medium | Add a new research category (e.g., HCI, Security) |
| **UI/UX** | Varies | Improve layout, fix bugs, enhance responsiveness |
| **Features** | Hard | Implement roadmap items (dark mode, calendar export, etc.) |

---

## Conference Data Guide

### Data Schema

All conference data lives in `js/data.js`. Each conference follows this schema:

```javascript
{
    id: "conf-2026",                    // Unique ID: lowercase-year
    name: "CONF",                       // Short display name
    fullName: "Full Conference Name",   // Optional: shown in modal
    year: 2026,
    category: "ml",                     // ml, cv, nlp, speech, robotics, other
    website: "https://conf.org/2026",
    brandColor: "#1E3A5F",              // Optional: hex color for theming

    location: {
        city: "City",
        country: "Country",
        flag: "🏳️",                     // Emoji flag
        venue: "Convention Center"      // Optional
    },

    deadlines: [
        {
            type: "paper",
            label: "Paper Submission",
            date: "2026-01-22T23:59:00-12:00",
            endDate: null,              // Only for events with date ranges
            status: "upcoming",         // Auto-calculated, don't set manually
            estimated: false            // true = uncertain date, shows "~" prefix
        }
    ],

    links: {
        official: "https://...",        // Conference homepage
        cfp: "https://...",             // Call for papers
        submission: "https://...",      // Submission portal
        template: "https://...",        // LaTeX template
        author: "https://..."           // Author guidelines
    },

    info: {
        pageLimit: "8 pages + unlimited references",
        reviewType: "Double-blind",
        submissionFormat: "PDF",
        acceptanceRate: "~25%"          // Optional
    },

    notes: [                            // Optional helpful tips
        "Supplementary materials due 1 week after",
        "Code submission encouraged"
    ],

    deskRejectReasons: [                // Optional common rejection reasons
        "Papers not properly anonymized",
        "Exceeds page limit"
    ]
}
```

### Deadline Types

| Type | Description | Example Label |
|------|-------------|---------------|
| `abstract` | Abstract submission | "Abstract Deadline" |
| `paper` | Full paper submission | "Paper Submission" |
| `supplementary` | Supplementary materials | "Supplementary Materials" |
| `rebuttal` | Author rebuttal period | "Rebuttal Period" |
| `notification` | Acceptance notification | "Notification" |
| `camera` | Camera-ready deadline | "Camera Ready" |
| `event` | Conference dates | "Main Conference" |

> **Tip:** For events spanning multiple days, use `endDate` to specify the range.

### Timezone & Date Formatting

```javascript
// AoE (Anywhere on Earth) - most common for submission deadlines
"2026-01-22T23:59:00-12:00"

// Specific timezone (e.g., EST)
"2026-01-22T23:59:00-05:00"

// Date only (no time component) - good for notifications, events
"2026-04-01"

// Uncertain/estimated dates - add estimated: true
{ type: "paper", date: "2026-01-15T23:59:00-12:00", estimated: true }
```

> **Important:** Use `-12:00` (AoE) for submission deadlines unless the conference specifies otherwise. This ensures researchers worldwide don't miss the deadline.

---

## Adding to the Scraper (Advanced)

The scraper automatically updates conference deadlines using an LLM. To add a new conference:

### 1. Add Scraper Configuration

Edit `scripts/scraper.py` and add to the `CONFERENCES` dict (around line 31):

```python
"newconf": {
    "name": "NewConf",
    "base": "https://newconf.org/{year}",    # {year} is replaced with current year
    "seeds": [
        "",                    # Landing page
        "dates",               # Important dates
        "call-for-papers",     # CFP page
        "author-guidelines",   # Submission guidelines
    ],
    "link_only": [             # Pages to link but not crawl
        "workshops",
        "tutorials",
        "reviewer-guidelines",
    ],
    "known_template": "https://github.com/newconf/author-kit",  # Optional
}
```

**Configuration fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Conference display name |
| `base` | Yes | Base URL template (use `{year}` or `{short_year}` for year placeholders) |
| `seeds` | Yes | URL paths to crawl for deadline info |
| `link_only` | No | URL paths to include as links but not parse |
| `known_template` | No | Direct link to LaTeX template |

### 2. Add Metadata Defaults

Edit `scripts/conference_metadata.json`:

```json
{
  "newconf": {
    "fullName": "New Conference on Something",
    "category": "ml",
    "brandColor": "#1E3A5F",
    "location": {
      "city": "TBD",
      "country": "TBD",
      "flag": "🌍",
      "venue": null
    }
  }
}
```

### 3. Update GitHub Workflow

Edit `.github/workflows/update-deadlines.yml` (line 27):

```yaml
ALL_CONFERENCES: 'cvpr,iccv,eccv,icml,neurips,iclr,aaai,acl,emnlp,naacl,interspeech,icassp,wacv,icip,iros,newconf'
```

### 4. Test Locally

```bash
# Install dependencies
pip install requests openai playwright html2text

# Set API key
export GEMINI_API_KEY="your-key-here"

# Test scraping the new conference
python scripts/scraper.py --conferences newconf --year 2026
```

---

## Adding a New Category

Adding a category requires changes across multiple files:

### Step 1: Define Category Metadata

Edit `js/data.js` (around line 1947):

```javascript
const CATEGORIES = {
    ml: { name: "Machine Learning", color: "#AF52DE" },
    cv: { name: "Computer Vision", color: "#007AFF" },
    nlp: { name: "NLP", color: "#34C759" },
    speech: { name: "Speech & Audio", color: "#FF9500" },
    robotics: { name: "Robotics", color: "#FF1493" },
    other: { name: "Other", color: "#8E8E93" },
    // Add your new category:
    hci: { name: "HCI", color: "#9B59B6" }
};
```

### Step 2: Add CSS Variable

Edit `css/styles.css` (around line 24):

```css
/* Category Colors */
--color-ml: #EF4444;
--color-cv: #007AFF;
--color-nlp: #34C759;
--color-speech: #FF9500;
--color-robotics: #FF1493;
--color-other: #8E8E93;
/* Add your new category: */
--color-hci: #9B59B6;
```

### Step 3: Add Card Gradient

Edit `js/app.js` in `getCardGradient()` function (around line 973):

```javascript
const gradients = {
    'ml': `...`,
    'cv': `...`,
    // Add your new category gradient:
    'hci': `
        radial-gradient(ellipse 100% 120% at 30% -20%, rgba(155, 89, 182, 0.6), transparent 50%),
        radial-gradient(ellipse 80% 100% at 100% 60%, rgba(142, 68, 173, 0.5), transparent 50%),
        radial-gradient(ellipse 120% 80% at -10% 90%, rgba(175, 122, 197, 0.4), transparent 50%),
        linear-gradient(150deg, #f5eef8 0%, #ebdef0 50%, #e8daef 100%)
    `
};
```

### Step 4: Add Filter Button

Edit `index.html` (around line 67):

```html
<button class="filter-pill" data-category="hci">
    <span class="filter-dot" style="--dot-color: #9B59B6"></span>
    <span>HCI</span>
    <span class="filter-count" id="count-hci">—</span>
</button>
```

### Step 5: Update Category Counter

Edit `js/app.js` in `updateCategoryCounts()` (line 434):

```javascript
const categories = ['all', 'ml', 'cv', 'nlp', 'speech', 'robotics', 'hci', 'other'];
```

### Step 6: Add Calendar Chip Style (Optional)

If needed, add category-specific calendar styling in `css/calendar.css`.

---

## Development Setup

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari)
- A text editor
- For scraper development: Python 3.8+ with pip

### Running Locally

```bash
# No build tools required!
# Simply open index.html in your browser
open index.html

# Or use a local server if you prefer
python -m http.server 8000
# Then visit http://localhost:8000
```

### Testing Checklist

- [ ] Cards render correctly in 4, 3, 2, and 1 column layouts
- [ ] Countdown timers update in real-time
- [ ] Search and filters work as expected
- [ ] Modal opens/closes properly
- [ ] Calendar view displays correctly
- [ ] Mobile layout (< 768px) looks good

### Scraper Dependencies

```bash
pip install requests openai playwright html2text

# For Playwright browser automation (optional, for JavaScript-heavy sites)
playwright install chromium
```

---

## Pull Request Guidelines

### Before Submitting

- [ ] Data edits follow the schema in `js/data.js`
- [ ] Test on both desktop and mobile widths
- [ ] One feature/fix per PR (easier to review)
- [ ] Update docs if behavior changes
- [ ] Include screenshots for UI changes

### Commit Message Format

```text
type: brief description

- feat: new feature
- fix: bug fix
- docs: documentation changes
- style: formatting, CSS changes
- refactor: code restructuring
- chore: maintenance tasks
```

Examples:

```text
feat: add ICLR 2027 deadline data
fix: correct CVPR camera-ready date
docs: update contributing guide with scraper info
style: improve mobile card spacing
```

### What to Avoid

- Don't commit secrets or API keys
- Don't add build tools or heavy dependencies
- Don't refactor unrelated code in the same PR
- Don't remove existing functionality without discussion

---

## File Reference

| Component | File | Purpose |
|-----------|------|---------|
| **Conference Data** | `js/data.js` | All conference information and categories |
| **Main Logic** | `js/app.js` | Filtering, sorting, rendering, modals |
| **Styles** | `css/styles.css` | Main CSS with category colors and animations |
| **Calendar View** | `js/calendar.js`, `css/calendar.css` | Calendar module and styles |
| **Countdown** | `js/countdown.js` | Real-time countdown timers |
| **Timeline** | `js/timeline.js` | SVG connector lines in modals |
| **Scraper** | `scripts/scraper.py` | LLM-powered deadline scraper |
| **Data Merger** | `scripts/update_from_scraper.py` | Merges scraped data into data.js |
| **Metadata** | `scripts/conference_metadata.json` | Default conference metadata |
| **Workflow** | `.github/workflows/update-deadlines.yml` | GitHub Actions automation |

---

## Questions?

- **Found a bug?** [Open an issue](https://github.com/awsaf49/paperrush/issues/new)
- **Have a feature idea?** Check the [Roadmap](README.md#-roadmap) first, then open an issue
- **Not sure where to start?** Look for issues labeled [`good first issue`](https://github.com/awsaf49/paperrush/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

We appreciate all contributions, from typo fixes to major features. Happy hacking!
