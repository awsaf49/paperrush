# ⏱️ Conference Deadline Tracker

> **Gotta Catch 'Em All** — A beautiful, modern conference deadline tracker for AI/ML researchers.

**Live Demo:** [https://awsaf49.github.io/paperrush/](https://awsaf49.github.io/paperrush/)

---

## ✨ Features

### 🎨 Beautiful UI/UX
- **OpenAI-inspired mesh gradients** — Each conference category has unique, vibrant gradient patterns
- **Apple-like modal expansion** — Click any card to see detailed info with smooth animations
- **Clean typography** — Outfit font for headings, JetBrains Mono for countdowns
- **Responsive design** — Works perfectly on desktop, tablet, and mobile (4→3→2→1 column layout)
- **Snake grid ordering** — Cards flow naturally: Row 1 (1→2→3→4), Row 2 (8←7←6←5), etc.

### 🎯 Title Effects
- **Stopwatch "o"** — The "o" in "C**o**nference" is a ticking stopwatch
- **Racing "D"** — The "D" in "**D**eadline" has a checkered racing flag pattern
- **Location Pin** — A map pin marks the "a" in "Tr**a**cker"
- **Pokémon Theme** — "Gotta Catch 'Em All" subtitle with gradient and icons

### ⏱️ Smart Countdown System
- Shows **"X days"** for deadlines > 24 hours away
- Shows **"X months Y days"** for deadlines > 30 days away
- Switches to **detailed countdown** (hours:minutes:seconds) when < 24 hours remain
- Real-time updates every second

### 🔄 Auto Year Rollover
- When all deadlines pass, conference automatically advances to next year
- Dates are estimated based on previous year (+1 year)
- Shows **"EST"** badge to indicate estimated dates
- Location becomes "TBD" until updated with real info

### 📋 Rich Conference Details (Modal)
Click any card to see:
- **Quick Links**: Official Website, Call for Papers, LaTeX Template, Author Guidelines
- **Key Info**: Page Limit, Review Type, Acceptance Rate
- **All Deadlines**: Complete timeline with status indicators
- **Important Notes & Desk Reject Reasons**: Critical submission guidelines

### 🔍 Category Filtering & Search
Filter conferences by type:
- **ML** — Machine Learning (ICML, NeurIPS, ICLR)
- **Vision** — Computer Vision (CVPR, ICCV, ECCV)
- **NLP** — Natural Language Processing (ACL, EMNLP, NAACL)
- **Speech** — Speech/Audio (ICASSP, Interspeech)
- **Other** — Miscellaneous (AAAI, IJCAI)

Use `⌘K` (or `Ctrl+K`) to quickly search conferences.

### 🤖 Auto-Updates via GitHub Actions + LLM Scraper
- **Weekly automated updates** every Monday at 6 AM UTC
- **On-demand scraping** by including `[scrape]` in commit message
- **Manual trigger** from GitHub Actions UI
- LLM-powered scraper extracts deadlines from conference websites
- Smart merging preserves existing data when scrapes fail

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Fonts | Google Fonts (Outfit, JetBrains Mono) |
| Hosting | GitHub Pages (free) |
| Scraper | Python + OpenRouter API (LLM extraction) |
| Auto-updates | GitHub Actions |
| Design | CSS Custom Properties, Flexbox, Grid |

**No build tools required!** Just static files that work anywhere.

---

## 📁 Project Structure

```
paperrush/
├── index.html                  # Main HTML file with card & modal templates
├── css/
│   └── styles.css              # All styles (~1200 lines)
├── js/
│   ├── data.js                 # Conference data (auto-updated by scraper)
│   ├── app.js                  # Main application logic
│   ├── countdown.js            # Countdown timer module
│   └── timeline.js             # Timeline connector SVG drawing
├── scripts/
│   ├── scraper.py              # LLM-powered conference scraper
│   ├── scraper_to_datajs.py    # Converts scraper output to data.js format
│   ├── update_from_scraper.py  # Orchestrates scraping and updating
│   └── conference_metadata.json # Static metadata for conferences
├── .github/
│   └── workflows/
│       └── update-deadlines.yml # GitHub Actions workflow
├── CLAUDE.md                   # AI assistant instructions
└── README.md
```

---

## 🚀 Deployment

### Option 1: GitHub Pages (Recommended)

1. **Fork or clone this repo**
2. **Enable GitHub Pages**:
   - Go to Settings → Pages
   - Source: Deploy from branch
   - Branch: `main` / `/ (root)`
   - Save
3. **Wait 2 minutes** — Your site is live!

### Option 2: Any Static Host

Just upload all files to:
- Netlify
- Vercel
- Cloudflare Pages
- Any web server

---

## 🤖 Setting Up Auto-Updates

### 1. Get OpenRouter API Key

1. Go to [OpenRouter](https://openrouter.ai/)
2. Create an account and get API key

### 2. Add GitHub Secret

1. Go to your repo → Settings → Secrets → Actions
2. Click "New repository secret"
3. Name: `OPENROUTER_API_KEY`
4. Value: Your API key

### 3. Trigger Methods

| Method | How to Trigger |
|--------|----------------|
| **Weekly Schedule** | Automatic every Monday 6 AM UTC |
| **On Push** | Include `[scrape]` in commit message |
| **Manual** | Go to Actions → "Update Conference Deadlines" → "Run workflow" |

### Example: Push with Scraping

```bash
git add .
git commit -m "feat: add new feature [scrape]"
git push
```

This will deploy your changes AND run the scraper to update all conference deadlines.

### Example: Push without Scraping

```bash
git add .
git commit -m "fix: some bug fix"
git push
```

This only deploys your changes without triggering the scraper.

---

## 🔧 Manual Scraping

### Scrape Specific Conferences

```bash
python scripts/update_from_scraper.py --conferences cvpr,icml --year 2026
```

### Dry Run (Preview Without Writing)

```bash
python scripts/update_from_scraper.py --conferences cvpr --year 2026 --dry-run
```

### Supported Conferences

`cvpr`, `iccv`, `eccv`, `icml`, `neurips`, `iclr`, `aaai`, `acl`, `emnlp`, `naacl`, `interspeech`, `icassp`

---

## 🔧 Configuration

### Adding/Editing Conferences

Edit `js/data.js`:

```javascript
{
    id: "conf-2026",
    name: "CONF",
    fullName: "Full Conference Name",
    year: 2026,
    category: "ml",  // ml, cv, nlp, speech, other
    website: "https://conf.cc/",
    brandColor: "#1E3A5F",
    location: {
        city: "City",
        country: "Country",
        flag: "🏳️",
        venue: "Venue Name"
    },
    deadlines: [
        { type: "abstract", label: "Abstract", date: "2026-01-15T23:59:00-12:00", status: "upcoming" },
        { type: "paper", label: "Paper Submission", date: "2026-01-22T23:59:00-12:00", status: "upcoming" },
        { type: "notification", label: "Notification", date: "2026-04-01T23:59:00-12:00", status: "upcoming" },
        { type: "camera", label: "Camera Ready", date: "2026-05-15T23:59:00-12:00", status: "upcoming" },
        { type: "event", label: "Conference", date: "2026-06-15", endDate: "2026-06-20", status: "upcoming" }
    ],
    links: {
        official: "https://conf.cc/2026",
        cfp: "https://conf.cc/2026/cfp",
        template: "https://conf.cc/2026/template",
        authorGuide: "https://conf.cc/2026/guidelines"
    },
    info: {
        pageLimit: "8 pages",
        reviewType: "Double-blind",
        acceptanceRate: "~25%"
    },
    notes: [
        "Important note 1",
        "Important note 2"
    ]
}
```

### Adding Conference Metadata

Edit `scripts/conference_metadata.json` to add static info (used by scraper):

```json
{
    "conf": {
        "fullName": "Conference on Something",
        "category": "ml",
        "brandColor": "#1E3A5F",
        "location": {
            "city": "City",
            "country": "Country",
            "flag": "🏳️"
        }
    }
}
```

---

## 📊 Data Fields Reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier (e.g., "icml-2026") |
| `name` | ✅ | Short name (e.g., "ICML") |
| `fullName` | ❌ | Full conference name |
| `year` | ✅ | Conference year |
| `category` | ✅ | ml, cv, nlp, speech, other |
| `website` | ✅ | Main website URL |
| `brandColor` | ❌ | Hex color for theming |
| `location` | ✅ | Object with city, country, flag, venue |
| `deadlines` | ✅ | Array of deadline objects |
| `links` | ✅ | Object with official, cfp, template URLs |
| `info` | ❌ | Object with pageLimit, reviewType, acceptanceRate |
| `notes` | ❌ | Array of important notes |

### Deadline Types
- `abstract` — Abstract submission
- `paper` — Full paper submission
- `notification` — Author notification
- `camera` — Camera-ready deadline
- `event` — Conference dates (use `endDate` for range)

### Deadline Fields
- `type` — Deadline type (see above)
- `label` — Display name
- `date` — ISO 8601 date with timezone (AoE = `-12:00`)
- `endDate` — Optional end date for events
- `status` — passed, active, upcoming (auto-calculated)
- `estimated` — Boolean, shows `~` prefix on dates

---

## 🎯 Conferences Included

### Machine Learning (ML)
- ICML, ICLR, NeurIPS, AAAI

### Computer Vision (CV)
- CVPR, ICCV, ECCV

### Natural Language Processing (NLP)
- ACL, EMNLP, NAACL

### Speech & Audio
- INTERSPEECH, ICASSP

---

## 🛣️ Roadmap

- [ ] Dark mode support
- [ ] Calendar export (ICS)
- [ ] Email/push notifications
- [ ] Timezone selector
- [ ] Favorite/bookmark conferences
- [ ] PWA support for offline access
- [ ] More conferences (robotics, HCI, security, etc.)

---

## 🙏 Credits

- **Design Inspiration**: Apple, OpenAI
- **Fonts**: [Google Fonts](https://fonts.google.com/) (Outfit, JetBrains Mono)
- **Icons**: Native emoji + inline SVG
- **Built by**: [Awsaf Rahman](https://awsaf49.github.io)

---

## 📄 License

MIT License — Feel free to use, modify, and distribute!

---

<p align="center">
  <b>Never miss a paper deadline again! ⏱️📍</b>
</p>
