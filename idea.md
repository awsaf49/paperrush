# Conference Deadline Tracker — Product Specification

**Project Name:** Conference Deadline Tracker  
**Author:** Awsaf Rahman  
**Version:** 1.0  
**Date:** January 2026  
**Deployment:** `awsaf49.github.io/conference-deadline`

---

## 1. Executive Summary

A visually stunning, Apple/OpenAI-inspired web application that automatically tracks academic conference deadlines for top-tier ML, CV, NLP, and related venues. The system uses GitHub Actions with Gemini API to autonomously fetch, parse, and update deadline information weekly, presenting it in an elegant snake-grid layout with live countdown timers.

---

## 2. Goals & Non-Goals

### 2.1 Goals
- Track 24+ top-tier academic conferences across ML, CV, NLP, Speech, and related fields
- Automatically fetch and parse deadline information from official conference websites
- Display dynamic countdown timers for the most urgent deadline per conference
- Show all deadline phases (abstract → paper → supplementary → notification → etc.)
- Estimate future dates based on historical patterns when official dates unavailable
- Provide filtering by research area (ML, CV, NLP, Speech, etc.)
- Deploy as a static site on GitHub Pages with zero server costs
- Achieve a premium, Apple/OpenAI-level aesthetic

### 2.2 Non-Goals (for v1.0)
- User authentication or personalized watchlists
- Email/push notifications
- Calendar export (.ics integration)
- Mobile app
- Dark/light mode toggle
- Real-time collaborative features

---

## 3. System Architecture

### 3.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        WEEKLY UPDATE FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   GitHub Actions    →    Fetch Conference    →    Gemini API    │
│   (Monday 00:00 UTC)      Websites                (Parse Data)  │
│                                                                  │
│                              ↓                                   │
│                                                                  │
│                      Update JSON Data    →    Commit to Repo    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        USER EXPERIENCE FLOW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User Visits    →    Load JSON    →    Sort by    →    Render  │
│   Website             Data              Urgency         Grid    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Key Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Hosting | GitHub Pages | Free static site hosting |
| Automation | GitHub Actions | Weekly scheduled updates |
| AI Parser | Gemini 3 Flash | Extract dates from webpages |
| Frontend | Vanilla HTML/CSS/JS | Fast, no build step needed |
| Data Store | JSON file in repo | Simple, version-controlled |

### 3.3 Why This Architecture?

- **Zero cost**: GitHub Pages + Actions are free; Gemini has generous free tier
- **Zero maintenance**: No servers to manage, no databases to backup
- **Automatic updates**: Deadlines refresh weekly without manual intervention
- **Fast loading**: Static files served from GitHub's CDN
- **Transparent**: All data and code visible in public repo

---

## 4. Data Model

### 4.1 Conference Configuration (Manual)

Each conference has static metadata that rarely changes:

| Field | Description | Example |
|-------|-------------|---------|
| ID | Unique identifier | `icml` |
| Name | Short name | `ICML` |
| Full Name | Complete name | `International Conference on Machine Learning` |
| Category | Research area | `ml` |
| Tier | Ranking | `A*` |
| Official URL | Main website | `https://icml.cc/` |
| Logo | Image file | `icml.png` |
| Historical Patterns | Typical deadline months | Abstract: Jan, Paper: Feb, Event: Jul |
| Deadline Sequence | Order of milestones | abstract → paper → supplementary → notification → ... |

### 4.2 Conference Data (Auto-Updated)

Dynamic information fetched weekly:

| Field | Description | Example |
|-------|-------------|---------|
| Year | Conference year | `2026` |
| Status | Data confidence | `confirmed` / `estimated` / `not_found` |
| Location | City, Country, Venue | Vienna, Austria |
| Deadlines | All milestone dates | Paper: Jan 30, 2026 23:59 AoE |
| Next Deadline | Most urgent upcoming | Paper Submission in 5 days |
| Links | Official, Submission, Guidelines | URLs |
| Is Estimated | Whether date is from pattern | `true` / `false` |

### 4.3 Deadline Lifecycle

```
UNKNOWN → ESTIMATED → CONFIRMED
              ↓
    ┌─────────────────────────────┐
    │    DEADLINE PROGRESSION     │
    │                             │
    │  upcoming → active → passed │
    │                             │
    │  active = within 30 days    │
    └─────────────────────────────┘
              ↓
         NEXT YEAR
    (cycle repeats with estimates)
```

### 4.4 Deadline Types Tracked

| Deadline | Description | Typical Timeline |
|----------|-------------|------------------|
| Abstract | Abstract submission | 1-2 weeks before paper |
| Paper | Full paper submission | Main deadline |
| Supplementary | Additional materials | 1 week after paper |
| Notification | Accept/reject decision | 2-3 months after paper |
| Rebuttal Start | Response period begins | Shortly after reviews |
| Rebuttal End | Response period ends | 1-2 weeks |
| Camera Ready | Final version due | 1 month before event |
| Author Registration | At least one author registers | Before camera ready |
| Event Start | Conference begins | — |
| Event End | Conference ends | — |

---

## 5. Conference List

### 5.1 Full Roster (24 Conferences)

#### Machine Learning (7)
| Conference | Full Name | Tier | Website |
|------------|-----------|------|---------|
| ICML | International Conference on Machine Learning | A* | icml.cc |
| ICLR | International Conference on Learning Representations | A* | iclr.cc |
| NeurIPS | Conference on Neural Information Processing Systems | A* | neurips.cc |
| AAAI | AAAI Conference on Artificial Intelligence | A* | aaai.org |
| IJCAI | International Joint Conference on AI | A* | ijcai.org |
| AISTATS | AI and Statistics | A | aistats.org |
| CoRL | Conference on Robot Learning | A | corl.org |

#### Computer Vision (6)
| Conference | Full Name | Tier | Website |
|------------|-----------|------|---------|
| CVPR | Computer Vision and Pattern Recognition | A* | cvpr.thecvf.com |
| ICCV | International Conference on Computer Vision | A* | iccv.thecvf.com |
| ECCV | European Conference on Computer Vision | A* | eccv.ecva.net |
| WACV | Winter Conference on Applications of CV | A | wacv.thecvf.com |
| ACCV | Asian Conference on Computer Vision | A | accv.asia |
| BMVC | British Machine Vision Conference | A | bmvc.org |

#### NLP & Speech (4)
| Conference | Full Name | Tier | Website |
|------------|-----------|------|---------|
| ACL | Association for Computational Linguistics | A* | aclweb.org |
| EMNLP | Empirical Methods in NLP | A* | aclweb.org |
| NAACL | North American Chapter of ACL | A | naacl.org |
| Interspeech | Intl. Speech Communication Association | A* | interspeech.org |

#### Signal Processing (2)
| Conference | Full Name | Tier | Website |
|------------|-----------|------|---------|
| ICASSP | Acoustics, Speech and Signal Processing | A* | icassp.org |
| ICIP | Image Processing | A | icip.org |

#### Other Top Venues (5)
| Conference | Full Name | Category | Tier | Website |
|------------|-----------|----------|------|---------|
| KDD | Knowledge Discovery and Data Mining | Data | A* | kdd.org |
| MICCAI | Medical Image Computing | Medical | A* | miccai.org |
| SIGGRAPH | Computer Graphics | Graphics | A* | siggraph.org |
| SIGGRAPH Asia | Computer Graphics (Asia) | Graphics | A* | asia.siggraph.org |
| MLSys | Machine Learning and Systems | Systems | A | mlsys.org |

### 5.2 Category Summary

```
ML General:     7 conferences
Vision:         6 conferences
NLP/Speech:     4 conferences
Signal:         2 conferences
Data Mining:    1 conference
Medical:        1 conference
Graphics:       2 conferences
Systems:        1 conference
─────────────────────────────
Total:         24 conferences
```

---

## 6. UI/UX Design Specification

### 6.1 Design Philosophy

**Inspiration:** Apple (clean, spacious), OpenAI (modern, professional), Hugging Face (friendly)

**Key Principles:**
1. **Generous Whitespace** — Let elements breathe
2. **Subtle Depth** — Soft shadows, no harsh borders
3. **Refined Typography** — Clean sans-serif (Inter/SF Pro)
4. **Muted Palette** — Soft backgrounds with vibrant accents
5. **Micro-interactions** — Subtle hover states, smooth transitions
6. **Clear Hierarchy** — Countdown is the hero element

### 6.2 Color System

#### Base Colors
| Role | Color | Usage |
|------|-------|-------|
| Background Primary | `#FAFAFA` | Page background |
| Background Secondary | `#FFFFFF` | Card background |
| Background Tertiary | `#F5F5F7` | Subtle sections |
| Text Primary | `#1D1D1F` | Headlines |
| Text Secondary | `#6E6E73` | Body text |
| Text Tertiary | `#86868B` | Captions |

#### Category Accent Colors
| Category | Color | Hex |
|----------|-------|-----|
| ML | Purple | `#AF52DE` |
| Vision | Blue | `#007AFF` |
| NLP | Green | `#34C759` |
| Signal | Orange | `#FF9500` |
| Data | Red | `#FF3B30` |
| Medical | Pink | `#FF2D55` |
| Graphics | Cyan | `#5AC8FA` |
| Systems | Gray | `#8E8E93` |

#### Status Colors
| Status | Color | Condition |
|--------|-------|-----------|
| Urgent | Red `#FF3B30` | < 7 days |
| Soon | Orange `#FF9500` | 7-30 days |
| Upcoming | Green `#34C759` | > 30 days |
| Passed | Gray `#8E8E93` | Completed |

### 6.3 Snake Grid Layout

Cards flow in a snake/S-curve pattern. Position 1 = most urgent deadline.

```
Desktop (4 columns):

   [1] ───────► [2] ───────► [3] ───────► [4]
                                          │
                                          ▼
   [8] ◄─────── [7] ◄─────── [6] ◄─────── [5]
    │
    ▼
   [9] ───────► [10] ──────► [11] ──────► [12]
                                          │
                                          ▼
   [16] ◄────── [15] ◄────── [14] ◄────── [13]


Tablet (3 columns):

   [1] ────► [2] ────► [3]
                       │
                       ▼
   [6] ◄──── [5] ◄──── [4]
    │
    ▼
   [7] ────► [8] ────► [9]


Mobile (1 column):

   [1]
    ↓
   [2]
    ↓
   [3]
    ↓
   ...
```

### 6.4 Card Design

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   [LOGO]   ICML 2026                          [ML] [A*]     │
│            Vienna, Austria 🇦🇹                               │
│                                                              │
│   ─────────────────────────────────────────────────────     │
│                                                              │
│   🔥 Paper Submission                                        │
│                                                              │
│       12      05      32      18                            │
│      days    hours    min     sec                           │
│                                                              │
│   ─────────────────────────────────────────────────────     │
│                                                              │
│   ✓  Abstract         Jan 23  (passed)                      │
│   ●  Supplementary    Feb 06                                │
│   ○  Notification     ~May 01  (estimated)                  │
│   ○  Camera Ready     ~Jun 15  (estimated)                  │
│   ○  Conference       Jul 20-25                             │
│                                                              │
│   ─────────────────────────────────────────────────────     │
│                                                              │
│   [Official Site →]  [Author Guide →]  [Reviewer Guide →]   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Card Elements

| Element | Description |
|---------|-------------|
| Logo | Conference logo (200×200px) |
| Name + Year | e.g., "ICML 2026" |
| Location | City, Country with flag emoji |
| Category Badge | Colored pill (ML, CV, etc.) |
| Tier Badge | A* or A rating |
| Active Deadline Label | Current phase name |
| Countdown Timer | Days, Hours, Minutes, Seconds |
| Deadline List | All phases with status indicators |
| Links | Official site, Author/Reviewer guidelines |

#### Card States

| State | Visual Treatment |
|-------|------------------|
| Default | White background, subtle shadow |
| Hover | Elevated shadow, slight scale (1.02×) |
| Urgent (<7 days) | Subtle red glow/border |
| Active Deadline | Pulsing dot indicator |

### 6.5 Countdown Timer Design

The countdown is the **hero element** of each card.

```
        12          05          32          18
       days       hours        min         sec

- Large, bold numbers (48px)
- Gradient text effect using category color
- Tabular/monospace numerals for stability
- Small caps labels below each unit
```

**Behavior:**
- Updates every second
- When reaches zero → automatically switches to next deadline
- Shows "PASSED" briefly before transitioning

### 6.6 Filter Bar

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Show:  [All]  [ML]  [Vision]  [NLP]  [Speech]  [Data]  [Medical] │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

- Pill/chip style buttons
- Each category uses its accent color when active
- Smooth animation when filtering (cards fade/slide)
- "All" is selected by default

### 6.7 Header

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   📅  Conference Deadline Tracker                                    │
│                                                                      │
│   Track submission deadlines for top-tier AI conferences            │
│   Last updated: January 27, 2026                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.8 Responsive Behavior

| Breakpoint | Columns | Card Width |
|------------|---------|------------|
| Mobile (<768px) | 1 | Full width |
| Tablet (768-1023px) | 2-3 | ~300px |
| Desktop (1024-1439px) | 3-4 | ~280px |
| Wide (≥1440px) | 4 | ~320px max |

### 6.9 Animations & Transitions

| Interaction | Animation |
|-------------|-----------|
| Page load | Cards fade in sequentially (staggered) |
| Filter change | Cards slide/fade to new positions |
| Card hover | Subtle lift (translateY -4px) + shadow |
| Countdown tick | Number crossfade |
| Deadline passes | Card pulses, then reorders |

---

## 7. Automation System

### 7.1 Update Schedule

- **Frequency:** Every Monday at 00:00 UTC
- **Trigger:** GitHub Actions cron job
- **Manual Override:** Can be triggered manually if needed

### 7.2 Update Process

```
Step 1: Load Configuration
        ↓
        Read list of 24 conferences and their official URLs
        
Step 2: Fetch Webpages
        ↓
        For each conference, fetch the official website
        Handle errors gracefully (retry, timeout)
        
Step 3: Parse with Gemini
        ↓
        Send webpage content to Gemini 3 Flash
        Extract: dates, location, links
        Confidence score for each extraction
        
Step 4: Validate & Merge
        ↓
        Compare with previous data
        Flag significant changes
        Use historical estimates for missing data
        
Step 5: Generate JSON
        ↓
        Create updated conferences.json
        Include metadata (last_updated, source)
        
Step 6: Commit & Deploy
        ↓
        Commit JSON to repository
        GitHub Pages auto-deploys
```

### 7.3 Gemini Parsing Strategy

**Input to Gemini:**
- Conference name and year
- Raw webpage text content
- Historical deadline patterns (for reference)
- Expected deadline types to find

**Output from Gemini:**
- Structured JSON with all found dates
- Location information
- Relevant links
- Confidence score (0-1)
- Notes about any ambiguity

**Fallback Logic:**
1. If Gemini finds dates → use them (mark as "confirmed")
2. If Gemini is uncertain → use historical pattern (mark as "estimated")
3. If website unreachable → keep previous data (mark as "cached")

### 7.4 Rate Limiting Strategy

| Scenario | Approach |
|----------|----------|
| Normal (24 conferences) | Process all in single run |
| API limits hit | Batch: 8 conferences per day (Mon/Tue/Wed) |
| Website blocks | Rotate user agents, add delays |

---

## 8. Error Handling

### 8.1 Data Fetch Errors

| Error | Response |
|-------|----------|
| Website unreachable | Use cached data + show "Last checked: X days ago" |
| Website structure changed | Flag for manual review, use estimates |
| Gemini API error | Retry 3×, then use historical estimates |
| Rate limit exceeded | Queue for next day's batch |
| Invalid date format | Log error, skip that field |

### 8.2 Display Edge Cases

| Situation | Display |
|-----------|---------|
| No dates found | Gray card, "Dates TBA", show historical estimate |
| Conference not yet announced | "~Month Year (estimated from 2025)" |
| All deadlines passed | Show "Next Year" with estimated dates |
| Deadline extended | Update immediately, show "Extended!" badge briefly |
| Conference cancelled | Red "Cancelled" badge |
| Multiple tracks | Show main track only |

### 8.3 Countdown Edge Cases

| Situation | Behavior |
|-----------|----------|
| Countdown hits zero | Animate transition, switch to next deadline |
| All deadlines passed | Switch to "Event in X days" or "Next year" |
| Estimated date | Show "~" prefix, slightly muted styling |
| Timezone ambiguity | Default to AoE, note in tooltip |

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Set up GitHub repository
- [ ] Create conference configuration with all 24 conferences
- [ ] Collect conference logos
- [ ] Design basic page layout
- [ ] Create static card component (no interactivity)

### Phase 2: Visual Design (Week 2)
- [ ] Implement snake grid layout
- [ ] Style cards with Apple/OpenAI aesthetic
- [ ] Add hover animations
- [ ] Implement responsive breakpoints
- [ ] Design filter bar

### Phase 3: Backend Automation (Week 3)
- [ ] Build webpage fetcher
- [ ] Create Gemini integration
- [ ] Build JSON generation logic
- [ ] Set up GitHub Actions workflow
- [ ] Test with 5 conferences

### Phase 4: Interactivity (Week 4)
- [ ] Implement live countdown timers
- [ ] Add filter functionality
- [ ] Handle deadline transitions
- [ ] Add loading states
- [ ] Implement card reordering

### Phase 5: Polish & Launch (Week 5)
- [ ] Fine-tune animations
- [ ] Cross-browser testing
- [ ] Mobile testing
- [ ] Performance optimization
- [ ] Deploy to GitHub Pages
- [ ] Announce!

### Phase 6: Monitoring (Ongoing)
- [ ] Weekly accuracy checks
- [ ] Fix parsing errors
- [ ] Add requested conferences
- [ ] Gather user feedback

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Deadline accuracy | >95% correct dates |
| Update reliability | 0 missed weekly updates |
| Page load time | <2 seconds |
| Mobile usability | Fully functional |
| User feedback | Positive reception |

---

## 11. Future Enhancements (v2.0+)

| Feature | Priority | Value |
|---------|----------|-------|
| Calendar export (.ics) | High | One-click add to Google Calendar |
| Email notifications | High | Alert X days before deadline |
| Dark mode | Medium | User preference |
| Personal watchlist | Medium | Track only your conferences |
| Historical charts | Low | Visualize deadline patterns |
| Submission portal links | Low | Direct link to OpenReview/CMT |
| Mobile PWA | Low | Install as app |

---

## 12. Appendix

### A. Timezone Reference

**AoE (Anywhere on Earth)** = UTC-12

Most ML conferences use AoE for deadlines. This means:
- When it's 23:59 AoE, it's already the next day in most of the world
- A "January 30 AoE" deadline = January 31, 11:59 AM UTC

### B. Conference URL Patterns

| Conference | Typical URL Format |
|------------|-------------------|
| ICML | icml.cc/Conferences/YYYY |
| ICLR | iclr.cc/Conferences/YYYY |
| NeurIPS | neurips.cc/Conferences/YYYY |
| CVPR | cvpr.thecvf.com/Conferences/YYYY |
| ECCV | eccvYYYY.ecva.net |
| ACL | YYYY.aclweb.org |

### C. Logo Specifications

- **Format:** PNG with transparency
- **Size:** 200×200 pixels
- **Style:** Official logo or clean icon
- **Source:** Conference websites, Wikipedia

### D. Deadline Estimation Patterns

Based on historical data, typical patterns:

| Conference | Abstract | Paper | Notification | Event |
|------------|----------|-------|--------------|-------|
| ICML | Late Jan | Early Feb | May | July |
| NeurIPS | Mid May | Late May | Sep | Dec |
| CVPR | Mid Nov | Late Nov | Feb | June |
| ICLR | Late Sep | Early Oct | Jan | May |
| ACL | Mid Jan | Late Jan | May | July |

---

*Document Version: 1.0*  
*Last Updated: January 2026*