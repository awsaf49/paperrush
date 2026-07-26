# PaperRush Launch Kit

## Tone

Be useful before being promotional. Describe PaperRush as a small open-source tool, not a definitive authority. Acknowledge that deadline trackers already exist and state the automated-data limitation before someone has to ask.

Use: "I built," "I hope this is useful," and "corrections are welcome."

Avoid: "the best," "never miss a deadline," "100% accurate," and manufactured urgency.

## Show HN

**Title:** Show HN: PaperRush - a small, open-source AI conference deadline tracker

**Post:**

> Hi HN - I built PaperRush after I nearly relied on a stale conference date. It tracks paper, abstract, and conference dates for 27 AI research conference series, with countdowns, a personal watchlist, calendar export, and links to official sources.
>
> I know conference deadline trackers already exist; I am not claiming to have invented the category. My focus is on separating paper/abstract deadlines, clearly marking next-year estimates, and automatically rolling closed editions forward without presenting an old year as current.
>
> An important caveat: collection is automated and LLM-assisted, so PaperRush is a planning aid rather than a source of truth. The site asks users to verify the official conference page, and corrections are very welcome.
>
> It is free, has no sign-in, and the code is open source. I would appreciate feedback on incorrect dates, missing conferences, or places where the interface is confusing.

Follow the current [Show HN guidelines](https://news.ycombinator.com/showhn.html); submit only after the public build works end to end.

## r/MachineLearning

Post in the current self-promotion thread rather than creating a promotional main-feed post:

> I made a small free/open-source tool called PaperRush for tracking AI conference paper, abstract, and event dates. It came from nearly relying on a stale AAAI date, so the main design goal is safe year rollover and obvious labels on estimated dates.
>
> The data pipeline is automated and LLM-assisted, which means mistakes are possible. Every card links back to an official source, and I would genuinely appreciate corrections or suggestions for missing conferences.
>
> No account is required: https://awsaf49.github.io/paperrush/

Use the community's current [self-promotion thread](https://www.reddit.com/r/MachineLearning/comments/1ul5bgf/d_selfpromotion_thread/).

## Lab Message

> I built a small deadline tracker for paper and abstract dates after almost using a stale conference year. It is free and needs no account. If you try it, please treat it as a planning aid and verify the official conference page. I would be grateful for corrections: https://awsaf49.github.io/paperrush/

## Social Post

> I nearly planned around an old AAAI deadline, so I built PaperRush: a free, open-source tracker for AI conference paper, abstract, and event dates.
>
> Estimates are marked, official sources are linked, and no sign-in is required. It is automated, so corrections are very welcome.
>
> https://awsaf49.github.io/paperrush/

Attach a real "My Rush" image rather than a generic promotional graphic.

## Calm Replies

**"This date is wrong."**

> Thank you for catching it. Could you share the official page you used? I will verify it and fix the record. This is exactly why the site keeps the source link visible.

**"Other deadline trackers already exist."**

> Absolutely. I use and respect several of them. PaperRush is a small open-source alternative focused on paper/abstract filtering, explicit estimates, and safe edition rollover.

**"LLMs should not be trusted with deadlines."**

> That is a fair concern. The automation helps collect candidate dates, but the site does not present it as authoritative. Estimates are labeled, validation rules catch common rollover failures, and the official conference page remains the source of truth.

**"You are promoting your own project."**

> Yes - I built it and wanted to share it in the designated project thread. It is free, open source, and I am mainly looking for corrections and practical feedback.

## Release Checklist

1. Verify the production site on desktop and mobile.
2. Submit `sitemap.xml` through [Google Search Console](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
3. Set the repository social preview using [GitHub's instructions](https://docs.github.com/en/enterprise-cloud@latest/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).
4. Share in one community at a time and respond before posting elsewhere.
5. Track official-source clicks, watchlist saves, calendar additions, Rush shares, referred visits, and corrections.
