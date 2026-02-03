<p align="center">
  <img src="https://img.shields.io/badge/status-active-success.svg" alt="Status">
  <img src="https://img.shields.io/github/license/awsaf49/paperrush" alt="License">
  <img src="https://img.shields.io/github/stars/awsaf49/paperrush?style=social" alt="Stars">
</p>

<h1 align="center">⏱️ Conference Deadline Tracker</h1>

<p align="center">
  <strong>Never miss a paper deadline again!</strong><br>
  A beautiful conference deadline tracker for AI/ML researchers
</p>

<p align="center">
  <a href="https://awsaf49.github.io/paperrush/">🌐 Live Demo</a> •
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
<img width="700" height="606" alt="image" align="center" src="https://github.com/user-attachments/assets/31b2f33f-8c2d-47d4-8407-4b74028d0b32" />
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎨 **Beautiful UI** | OpenAI-inspired gradients, Apple-like animations, glassmorphism |
| 📅 **Calendar View** | Day/Week/Month/Year views with deadline chips |
| ⏱️ **Live Countdown** | Real-time timers with smart formatting |
| 🔄 **Auto-Updates** | LLM-powered scraper keeps deadlines current |
| 🔍 **Smart Search** | Filter by category, search with `⌘K` |
| 📱 **Responsive** | Works on desktop, tablet, and mobile |

### Conferences Tracked

| Category | Conferences |
|----------|-------------|
| **ML** | ICML, NeurIPS, ICLR, AAAI |
| **Vision** | CVPR, ICCV, ECCV, WACV, ICIP |
| **NLP** | ACL, EMNLP, NAACL |
| **Speech** | Interspeech, ICASSP |
| **Robotics** | IROS |

---

## 🚀 Quick Start

### Option 1: Use Directly
Visit **[https://awsaf49.github.io/paperrush/](https://awsaf49.github.io/paperrush/)** — no installation needed!

### Option 2: Self-Host

```bash
# Clone the repo
git clone https://github.com/awsaf49/paperrush.git
cd paperrush

# Open in browser (no build required!)
open index.html
```

### Option 3: Deploy Your Own

1. **Fork** this repository
2. Go to **Settings → Pages**
3. Set source to `main` branch
4. Your site is live at `https://yourusername.github.io/paperrush/`

---

## 🤖 Auto-Update System

PaperRush uses an LLM-powered scraper to automatically update conference deadlines.

### Setup (Optional)

To enable auto-updates on your fork:

1. Get a [Gemini API key](https://aistudio.google.com/apikey) (free tier available)
2. Add it as a GitHub Secret: `Settings → Secrets → Actions → GEMINI_API_KEY`

### Trigger Methods

| Method | How |
|--------|-----|
| **Weekly** | Automatic every Monday 6 AM UTC |
| **On Push** | Include `[scrape]` in commit message |
| **Manual** | Actions → "Update Conference Deadlines" → Run |

### System Architecture

```
🌐 Conference Websites → 🤖 Gemini LLM → 📄 JSON → 📦 data.js → 🌍 GitHub Pages → 🖥️ Browser
```

📊 **See full interactive workflow diagrams**: [`docs/workflow.html`](docs/workflow.html)

---

## 🤝 Contributing

We welcome contributions! See **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for the complete guide.

**Quick start:** Edit `js/data.js` and submit a PR:

```javascript
{
    id: "conf-2026",
    name: "CONF",
    year: 2026,
    category: "ml",  // ml, cv, nlp, speech, robotics, other
    website: "https://conf.cc/",
    location: { city: "City", country: "Country", flag: "🏳️" },
    deadlines: [
        { type: "paper", label: "Paper Submission", date: "2026-01-22T23:59:00-12:00" },
        { type: "notification", label: "Notification", date: "2026-04-01" },
        { type: "event", label: "Conference", date: "2026-06-15", endDate: "2026-06-20" }
    ],
    links: { official: "https://conf.cc/2026" }
}
```

> **Tip:** Use `-12:00` timezone for AoE (Anywhere on Earth) deadlines.

**No build tools needed** — just edit and refresh! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for adding conferences to the scraper, creating new categories, and more

---

## 📊 Data Format Reference

<details>
<summary><strong>Deadline Types</strong></summary>

| Type | Description |
|------|-------------|
| `abstract` | Abstract submission |
| `paper` | Full paper submission |
| `rebuttal` | Author rebuttal period |
| `notification` | Acceptance notification |
| `camera` | Camera-ready deadline |
| `event` | Conference dates (use `endDate` for range) |

</details>

<details>
<summary><strong>Categories</strong></summary>

| Category | Color | Conferences |
|----------|-------|-------------|
| `ml` | Purple | ICML, NeurIPS, ICLR, AAAI |
| `cv` | Blue | CVPR, ICCV, ECCV, WACV, ICIP |
| `nlp` | Green | ACL, EMNLP, NAACL |
| `speech` | Orange | Interspeech, ICASSP |
| `robotics` | Hot Pink | IROS |
| `other` | Gray | Others |

</details>

<details>
<summary><strong>Full Conference Schema</strong></summary>

```javascript
{
    id: "conf-2026",           // Unique ID
    name: "CONF",              // Short name
    fullName: "Full Name",     // Optional
    year: 2026,
    category: "ml",
    website: "https://...",
    brandColor: "#1E3A5F",     // Optional hex color
    location: {
        city: "City",
        country: "Country",
        flag: "🏳️",
        venue: "Venue"         // Optional
    },
    deadlines: [...],
    links: {
        official: "...",
        cfp: "...",            // Call for papers
        template: "...",       // LaTeX template
        author: "..."          // Author guidelines
    },
    info: {
        pageLimit: "8 pages",
        reviewType: "Double-blind",
        acceptanceRate: "~25%"
    },
    notes: ["Note 1", "Note 2"],
    deskRejectReasons: ["Reason 1"]
}
```

</details>

---

## 🛣️ Roadmap

- [ ] Dark mode
- [ ] Calendar export (ICS)
- [ ] Email notifications
- [ ] Timezone selector
- [ ] Favorite conferences
- [ ] PWA offline support
- [x] ~~More conferences (robotics, HCI, security)~~ Added IROS, ICIP, WACV
- [ ] More conferences (HCI, security)

See [Issues](https://github.com/awsaf49/paperrush/issues) for detailed tasks.

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vanilla HTML/CSS/JS |
| Fonts | Outfit, JetBrains Mono |
| Hosting | GitHub Pages |
| Scraper | Python + Gemini API |
| Automation | GitHub Actions |

**No build tools.** No npm. No webpack. Just clean, simple code.

---

## 📄 License

Apache 2.0 License — free to use, modify, and distribute.

---

<p align="center">
  <strong>⭐ Star this repo if you find it useful!</strong><br><br>
  Built with ❤️ by <a href="https://github.com/awsaf49">Awsaf Rahman</a>
</p>
