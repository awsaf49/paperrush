# 🏃‍♂️💨 Catch Me If You Can (PaperRush)

> **Race against conference deadlines** — A beautiful, modern conference deadline tracker for AI/ML researchers.

**Live Demo:** [https://awsaf49.github.io/paperrush/](https://awsaf49.github.io/paperrush/)

---

## ✨ Features

### 🎨 Beautiful UI/UX
- **OpenAI-inspired mesh gradients** — Each conference category has unique, vibrant gradient patterns
- **Apple-like modal expansion** — Click any card to see detailed info with smooth animations
- **Clean typography** — Outfit font for headings, JetBrains Mono for countdowns
- **Responsive design** — Works perfectly on desktop, tablet, and mobile (4→3→2→1 column layout)
- **Snake grid ordering** — Cards flow naturally: Row 1 (1→2→3→4), Row 2 (8←7←6←5), etc.

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

### 🔍 Category Filtering
Filter conferences by type:
- **ML** — Machine Learning (ICML, NeurIPS, ICLR)
- **Vision** — Computer Vision (CVPR, ICCV, ECCV)
- **NLP** — Natural Language Processing (ACL, EMNLP, NAACL)
- **Speech** — Speech/Audio (ICASSP, Interspeech)
- **Other** — Miscellaneous (AAAI, IJCAI)

### 🤖 Auto-Updates via GitHub Actions + Gemini
- Weekly automated updates every Monday at 9 AM UTC
- Gemini AI searches for latest deadline information
- Commits changes automatically to keep data fresh

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Fonts | Google Fonts (Outfit, JetBrains Mono) |
| Hosting | GitHub Pages (free) |
| Auto-updates | GitHub Actions + Google Gemini API |
| Design | CSS Custom Properties, Flexbox, Grid |

**No build tools required!** Just static files that work anywhere.

---

## 📁 Project Structure

```
paperrush/
├── index.html              # Main HTML file with card & modal templates
├── css/
│   └── styles.css          # All styles (~1100 lines)
├── js/
│   ├── data.js             # Conference data (auto-updated by Gemini)
│   ├── app.js              # Main application logic
│   ├── countdown.js        # Countdown timer module
│   └── timeline.js         # Timeline connector SVG drawing
├── assets/
│   └── logos/              # Conference logo SVGs/PNGs
├── scripts/
│   └── update_deadlines.py # Gemini-powered update script
├── .github/
│   └── workflows/
│       └── update-deadlines.yml  # GitHub Actions workflow
└── README.md
```

---

## 🎨 Design Details

### Gradient Patterns by Category

Each category has a **unique gradient pattern**, not just different colors:

| Category | Pattern | Colors |
|----------|---------|--------|
| **ML** | Diagonal sweep from top-left | Pink → Orange → Yellow |
| **Vision** | Horizontal wave | Blue → Cyan → Purple |
| **NLP** | Vertical bands | Green → Teal → Cyan |
| **Speech** | Radial burst from bottom | Orange → Yellow → Pink |
| **Other** | Corner accents | Violet → Magenta → Blue |

### Card Layout

```
┌─────────────────────────────┐
│  [Logo]  Conference Name    │  ← Gradient Zone
│          Location 🏳️        │
│                             │
│      PAPER SUBMISSION       │
│          12 days            │
├─────────────────────────────┤  ← Divider
│  ✓ Abstract      Jan 23     │  ← White Zone
│  ● Paper         Jan 30     │    (Fixed 5 slots
│  ○ Notification  May 01     │     for alignment)
│  ○ Camera Ready  Jun 15     │
│  ○ Conference    Jul 06-11  │
│                             │
│      Tap for details        │
└─────────────────────────────┘
```

### Status Icons
- ✓ **Passed** — Deadline has passed (gray, strikethrough)
- ● **Active** — Current deadline (green dot)
- ○ **Upcoming** — Future deadline (gray circle)

### Modal Structure
```
┌───────────────────────────────────────┐
│ [X]                                   │
│         [Logo]                        │  ← Gradient Header
│    Conference Name 2026               │
│    City, Country 🏳️                   │
│  ┌─────────────────────────┐          │
│  │ PAPER SUBMISSION        │          │
│  │ 2 months 15 days        │          │
│  └─────────────────────────┘          │
├───────────────────────────────────────┤
│ 📎 Quick Links                        │
│ ┌─────────────┐ ┌─────────────┐       │
│ │🌐 Website   │ │📄 CFP       │       │
│ └─────────────┘ └─────────────┘       │
│ ┌─────────────┐ ┌─────────────┐       │
│ │📝 Template  │ │📖 Guidelines│       │
│ └─────────────┘ └─────────────┘       │
├───────────────────────────────────────┤
│ 📊 Key Information                    │
│ ┌──────────┬──────────┬──────────┐    │
│ │Page Limit│Review    │Acceptance│    │
│ │ 9 pages  │Double-bl │  ~25%   │    │
│ └──────────┴──────────┴──────────┘    │
├───────────────────────────────────────┤
│ 📅 All Deadlines                      │
│  ✓ Abstract       Jan 23, 2026        │
│  ● Paper          Jan 30, 2026        │
│  ○ Notification   May 01, 2026        │
│  ○ Camera Ready   Jun 15, 2026        │
│  ○ Conference     Jul 06-11, 2026     │
├───────────────────────────────────────┤
│ ⚠️ Important Notes & Desk Reject      │
│ ┌─────────────────────────────────┐   │
│ │ • Exceeds 9-page limit          │   │
│ │ • Author names visible in PDF   │   │
│ │ • Wrong template format         │   │
│ └─────────────────────────────────┘   │
└───────────────────────────────────────┘
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
        { type: "notification", label: "Notification", date: "2026-04-01T23:59:00-12:00", status: "upcoming", estimated: true },
        { type: "camera", label: "Camera Ready", date: "2026-05-15T23:59:00-12:00", status: "upcoming", estimated: true },
        { type: "event", label: "Conference", date: "2026-06-15", endDate: "2026-06-20", status: "upcoming" }
    ],
    links: {
        official: "https://conf.cc/2026",
        author: "https://conf.cc/2026/cfp",
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
    ],
    deskRejectReasons: [
        "Exceeds page limit",
        "Wrong template"
    ]
}
```

### Adding Conference Logos

1. Add SVG or PNG to `assets/logos/`
2. Name it `confname.svg` (lowercase, matching conference name)
3. Fallback: Shows first 2 letters if logo not found

---

## 🤖 Setting Up Auto-Updates

### 1. Get Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create API key (free tier available)

### 2. Add GitHub Secret

1. Go to your repo → Settings → Secrets → Actions
2. Click "New repository secret"
3. Name: `GEMINI_API_KEY`
4. Value: Your API key

### 3. Enable Actions

1. Go to repo → Actions tab
2. Enable workflows if prompted

The workflow runs automatically every Monday at 9 AM UTC, or manually via "Run workflow" button.

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
| `links` | ✅ | Object with official, author, template URLs |
| `info` | ❌ | Object with pageLimit, reviewType, acceptanceRate |
| `notes` | ❌ | Array of important notes |
| `deskRejectReasons` | ❌ | Array of common desk reject reasons |
| `isEstimated` | Auto | Set automatically when year rolls over |

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
- ICML, ICLR, NeurIPS, AAAI, AISTATS, UAI, COLT

### Computer Vision (CV)
- CVPR, ICCV, ECCV, WACV, BMVC

### Natural Language Processing (NLP)
- ACL, EMNLP, NAACL, EACL, COLING

### Speech & Audio
- INTERSPEECH, ICASSP, ASRU, SLT

### Other
- IJCAI, KDD, WWW, SIGIR, RecSys

---

## 🛣️ Roadmap

- [ ] Dark mode support
- [ ] Calendar export (ICS)
- [ ] Email/push notifications
- [ ] Timezone selector
- [ ] Search functionality
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
  <b>Never miss a paper deadline again! 🎯</b>
</p>