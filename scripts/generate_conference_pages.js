#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { CONFERENCES_DATA, CATEGORIES } = require('../js/data.js');
const Rules = require('../js/deadline-utils.js');
const App = require('../js/app.js');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'conferences');
const GENERATED_MARKER = path.join(OUTPUT_ROOT, '.generated-by-paperrush');
const SITE_URL = 'https://awsaf49.github.io/paperrush';
const SOCIAL_IMAGE = `${SITE_URL}/assets/paperrush-social.png`;

function escape(value) {
    return Rules.escapeHTML(value);
}

function json(value) {
    return JSON.stringify(value, null, 2).replaceAll('<', '\\u003c');
}

function safeLink(value) {
    return Rules.safeURL(value);
}

function officialLink(conference, source) {
    return safeLink(
        conference.links?.official || conference.links?.dates || conference.website ||
        source.links?.official || source.links?.dates || source.website
    );
}

function formatDate(value, endValue) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!match) return 'To be announced';
    const [, year, month, day, hour, minute] = match;
    let output = `${months[Number(month) - 1]} ${Number(day)}, ${year}`;
    if (hour && minute) {
        const zone = String(value).match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
        output += ` at ${hour}:${minute}${zone ? ` (${zone === 'Z' ? 'UTC' : `UTC${zone}`})` : ''}`;
    }
    if (endValue) {
        const end = formatDate(endValue);
        output += ` – ${end}`;
    }
    return output;
}

function countdownLabel(deadline, now) {
    const target = Rules.countdownTarget(deadline);
    const milliseconds = target instanceof Date ? target - now : NaN;
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Passed';
    const days = Math.ceil(milliseconds / 86400000);
    if (days > 60) return `in about ${Math.round(days / 30)} months`;
    return `in ${days} day${days === 1 ? '' : 's'}`;
}

function countdownAttributes(deadline) {
    if (!deadline?.date) return '';
    return ` data-countdown-date="${escape(deadline.date)}" data-estimated="${deadline.estimated ? 'true' : 'false'}"`;
}

function selectActiveConferences(now) {
    const grouped = new Map();
    CONFERENCES_DATA.conferences.forEach(source => {
        const normalized = {
            ...source,
            deadlines: Rules.deduplicateDeadlines(source.deadlines)
        };
        const key = normalized.name.toLowerCase();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(normalized);
    });

    return [...grouped.values()].map(editions => {
        const source = App.chooseSubmissionSource(editions, now);
        const conference = App.resolveSubmissionEdition(source, now);
        const submissionDeadlines = conference.deadlines.filter(deadline =>
            Rules.isPrimarySubmissionDeadline(deadline)
        );
        const confirmedEvents = conference.deadlines.filter(deadline =>
            Rules.matchesFocus(deadline, 'conference') && !deadline.estimated
        );
        const deadlines = [...submissionDeadlines, ...confirmedEvents].sort((a, b) =>
            Rules.countdownTarget(a) - Rules.countdownTarget(b)
        );
        const activeDeadline = deadlines.find(deadline => !Rules.isPassed(deadline, now)) || null;
        return { source, conference: { ...conference, deadlines, activeDeadline } };
    }).sort((a, b) => {
        const aTarget = a.conference.activeDeadline
            ? Rules.countdownTarget(a.conference.activeDeadline)
            : new Date('2099-12-31');
        const bTarget = b.conference.activeDeadline
            ? Rules.countdownTarget(b.conference.activeDeadline)
            : new Date('2099-12-31');
        return aTarget - bTarget;
    });
}

function eventSchema(conference, canonical) {
    const event = conference.deadlines.find(deadline =>
        Rules.matchesFocus(deadline, 'conference') && !deadline.estimated
    );
    const location = conference.location || {};
    if (!event || !location.city || location.city === 'TBD') return '';

    return `<script type="application/ld+json">
${json({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: `${conference.name} ${conference.year}`,
        startDate: event.date,
        endDate: event.endDate || event.date,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
            '@type': 'Place',
            name: location.venue || `${location.city}, ${location.country}`,
            address: {
                '@type': 'PostalAddress',
                addressLocality: location.city,
                addressCountry: location.country
            }
        },
        url: canonical
    })}
    </script>`;
}

function deadlineItems(conference, now) {
    if (!conference.deadlines.length) {
        return '<p class="empty-state">Official paper and abstract dates have not been announced.</p>';
    }
    return `<ol class="deadline-list">
${conference.deadlines.map(deadline => {
        const type = Rules.canonicalType(deadline);
        const passed = Rules.isPassed(deadline, now);
        const active = conference.activeDeadline === deadline;
        return `        <li class="deadline-row${active ? ' active' : ''}${passed ? ' passed' : ''}">
            <span class="deadline-node" aria-hidden="true"></span>
            <span class="deadline-copy">
                <span class="deadline-kind">${escape(type === 'conference' ? 'Conference' : type)}</span>
                <strong>${escape(deadline.label)}</strong>
                <time datetime="${escape(deadline.date)}">${deadline.estimated ? '~ ' : ''}${escape(formatDate(deadline.date, deadline.endDate))}</time>
            </span>
            <span class="deadline-state"${!passed ? countdownAttributes(deadline) : ''}>${passed ? 'Passed' : deadline.estimated ? 'Estimated' : 'Upcoming'}</span>
        </li>`;
    }).join('\n')}
    </ol>`;
}

function renderConferencePage(entry, now) {
    const { source, conference } = entry;
    const canonical = `${SITE_URL}/conferences/${conference.id}/`;
    const trackerURL = `${SITE_URL}/?conference=${encodeURIComponent(conference.id)}&focus=submissions`;
    const sourceURL = officialLink(conference, source);
    const sourceIsPriorEdition = conference.id !== source.id && sourceURL;
    const active = conference.activeDeadline;
    const category = CATEGORIES[conference.category]?.name || 'AI research';
    const title = `${conference.name} ${conference.year} Deadline: Paper & Abstract Dates | PaperRush`;
    const description = active
        ? `${conference.name} ${conference.year} ${active.label} is ${active.estimated ? 'estimated for' : 'scheduled for'} ${formatDate(active.date)}. Track paper, abstract, and conference dates on PaperRush.`
        : `Track ${conference.name} ${conference.year} paper, abstract, and conference dates on PaperRush.`;
    const status = conference.isEstimated || active?.estimated ? 'Estimated from the previous edition' : 'Published conference data';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="PaperRush">
    <meta property="og:title" content="${escape(title)}">
    <meta property="og:description" content="${escape(description)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${SOCIAL_IMAGE}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${SOCIAL_IMAGE}">
    <link rel="icon" type="image/svg+xml" href="../../assets/favicon.svg">
    <link rel="preload" href="../../assets/fonts/outfit-latin-variable.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="../../css/conference.css">
    <script type="application/ld+json">
${json({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: canonical,
        isPartOf: { '@type': 'WebSite', name: 'PaperRush', url: `${SITE_URL}/` },
        primaryImageOfPage: SOCIAL_IMAGE
    })}
    </script>
    ${eventSchema(conference, canonical)}
</head>
<body>
    <!-- Generated by scripts/generate_conference_pages.js. -->
    <div class="page-glow" aria-hidden="true"></div>
    <header class="page-header">
        <a class="brand" href="${SITE_URL}/"><i aria-hidden="true"></i>Paper<strong>Rush</strong></a>
        <a class="tracker-link" href="${trackerURL}">Open live tracker <span aria-hidden="true">→</span></a>
    </header>
    <main>
        <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${SITE_URL}/">PaperRush</a><span>/</span><a href="${SITE_URL}/conferences/">Conferences</a><span>/</span>${escape(conference.name)} ${conference.year}</nav>
        <section class="conference-hero">
            <div>
                <p class="eyebrow">${escape(category)} · ${escape(status)}</p>
                <h1>${escape(conference.name)} <em>${conference.year}</em></h1>
                <p class="full-name">${escape(conference.fullName || `${conference.name} conference`)}</p>
                <p class="location">${escape([conference.location?.city, conference.location?.country].filter(value => value && value !== 'TBD').join(', ') || 'Location to be announced')}</p>
            </div>
            <div class="next-card">
                <span>Next tracked milestone</span>
                <strong>${escape(active?.label || 'Dates to be announced')}</strong>
                <time datetime="${escape(active?.date || '')}">${active ? `${active.estimated ? '~ ' : ''}${escape(formatDate(active.date))}` : 'TBA'}</time>
                <b${countdownAttributes(active)}>${active ? active.estimated ? 'Estimated' : 'Upcoming' : 'Check back soon'}</b>
            </div>
        </section>

        <section class="deadline-section" aria-labelledby="deadline-heading">
            <div class="section-heading">
                <div><p>Submission timeline</p><h2 id="deadline-heading">Paper, abstract & conference dates</h2></div>
                ${sourceURL ? `<a href="${sourceURL}" target="_blank" rel="noopener">${sourceIsPriorEdition ? 'Previous edition source' : active?.estimated ? 'Official conference page' : 'Official deadline source'} ↗</a>` : ''}
            </div>
            ${deadlineItems(conference, now)}
        </section>

        <aside class="trust-note"><i aria-hidden="true"></i><p><strong>Verify before you submit.</strong> PaperRush combines automated, LLM-assisted extraction with validation rules. Conference websites remain the source of truth.</p></aside>
        <section class="page-cta"><p>Want this deadline in your calendar or personal watchlist?</p><a href="${trackerURL}">Open ${escape(conference.name)} in PaperRush <span aria-hidden="true">→</span></a></section>
    </main>
    <footer>PaperRush · Updated ${escape(CONFERENCES_DATA.lastUpdated.slice(0, 10))}</footer>
    <script src="../../js/conference-page.js" defer></script>
</body>
</html>
`;
}

function renderIndex(entries) {
    const cards = entries.map(({ conference }) => {
        const active = conference.activeDeadline;
        return `<a class="directory-card" href="./${conference.id}/">
            <span class="directory-category">${escape(CATEGORIES[conference.category]?.name || 'Conference')}</span>
            <span class="directory-title"><strong>${escape(conference.name)} ${conference.year}</strong><small>${escape(active?.label || 'Dates to be announced')}</small></span>
            <span class="directory-timing">
                <time datetime="${escape(active?.date || '')}">${active ? `${active.estimated ? '~ ' : ''}${escape(formatDate(active.date))}` : 'TBA'}</time>
                <b${countdownAttributes(active)}>${active ? active.estimated ? 'Estimated' : 'Upcoming' : 'Check back soon'}</b>
            </span>
        </a>`;
    }).join('\n');

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AI Conference Deadlines by Conference | PaperRush</title>
    <meta name="description" content="Browse paper, abstract, and conference dates for major AI, machine learning, computer vision, NLP, speech, and robotics conferences.">
    <link rel="canonical" href="${SITE_URL}/conferences/">
    <link rel="icon" type="image/svg+xml" href="../assets/favicon.svg">
    <link rel="stylesheet" href="../css/conference.css">
</head>
<body>
    <!-- Generated by scripts/generate_conference_pages.js. -->
    <div class="page-glow" aria-hidden="true"></div>
    <header class="page-header"><a class="brand" href="${SITE_URL}/"><i aria-hidden="true"></i>Paper<strong>Rush</strong></a><a class="tracker-link" href="${SITE_URL}/">Open live tracker <span aria-hidden="true">→</span></a></header>
    <main>
        <section class="directory-hero"><p class="eyebrow">Conference directory</p><h1>Every deadline,<br><em>one clean grid.</em></h1><p>Browse the active conference edition for every series tracked by PaperRush.</p></section>
        <section class="directory-grid">${cards}</section>
    </main>
    <footer>PaperRush · Free and open source</footer>
    <script src="../js/conference-page.js" defer></script>
</body>
</html>`;
}

function writeSitemap(entries) {
    const urls = [
        [`${SITE_URL}/`, 'weekly', '1.0'],
        [`${SITE_URL}/conferences/`, 'weekly', '0.9'],
        ...entries.map(({ conference }) => [
            `${SITE_URL}/conferences/${conference.id}/`,
            'weekly',
            '0.8'
        ]),
        [`${SITE_URL}/docs/workflow.html`, 'monthly', '0.4']
    ];
    const body = urls.map(([url, frequency, priority]) => `  <url>\n    <loc>${url}</loc>\n    <changefreq>${frequency}</changefreq>\n    <priority>${priority}</priority>\n  </url>`).join('\n');
    fs.writeFileSync(
        path.join(ROOT, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
    );
}

function main() {
    const now = new Date();
    const entries = selectActiveConferences(now);
    if (fs.existsSync(OUTPUT_ROOT) && !fs.existsSync(GENERATED_MARKER)) {
        throw new Error('Refusing to replace conferences/: generated marker is missing.');
    }
    if (fs.existsSync(OUTPUT_ROOT)) fs.rmSync(OUTPUT_ROOT, { recursive: true });
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.writeFileSync(GENERATED_MARKER, 'Owned by scripts/generate_conference_pages.js\n');
    fs.writeFileSync(path.join(OUTPUT_ROOT, 'index.html'), renderIndex(entries));

    entries.forEach(entry => {
        const directory = path.join(OUTPUT_ROOT, entry.conference.id);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'index.html'), renderConferencePage(entry, now));
    });
    writeSitemap(entries);
    console.log(`Generated ${entries.length} conference pages and sitemap.xml`);
}

if (require.main === module) main();

module.exports = { formatDate, countdownLabel, selectActiveConferences, renderConferencePage };
