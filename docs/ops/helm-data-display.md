# Helm data displays: what each one is for

Each Helm display answers one operator question. This records the choices so later work does not re-litigate them. Method: `.claude/skills/wav-data-display/SKILL.md`.

## Current work in the queues (Flow)

- **Question / action:** Where is work waiting right now, and is a worker on it? Open Queue details or the legacy queue page for the queue that has work.
- **Data (`GET /admin/queues`):** per queue `waiting`, `active`, `delayed`, `failed`, `completed`, `paused`, as of the poll time. No job age, no history, no scheduled-versus-retry flag.
- **Default view: By queue.** Horizontal stacked bars (Recharts via `StackedBarList` in `packages/charts`), waiting plus running, ranked by their sum. Exact "N waiting · M running" text sits beside every bar. Only queues with waiting or running work are drawn; a sentence says how many have only delayed jobs or are empty.
- **Alternate: By stage.** The same counts grouped Discovery, Detail crawl and extraction, Enrichment, Search, plus an explicit "Other queues" bucket for queues outside those stages. Stage totals equal the queue totals (unit-tested). It answers "which part of the pipeline" rather than "which queue". A stage whose defined queues were not all reported reads "at least N … queues not reported".
- **Delayed is its own count.** It is never added to waiting and never called backlog or stuck, because 18 routine single delayed jobs (or one retry) say nothing about blockage. Waiting count alone is also not called stuck: without job age we say "work waiting".
- **Failed** is the retained failed-job count, labelled as such, shown only in Queue details and stage cards.
- **Queue details** is a collapsed, readable table of every queue (including totals) inside a keyboard-focusable scroll region. It was the old always-visible table; it is no longer under the chart by default.
- **Not built:** a queue-depth time series, throughput, wait time or rates. The API records none, and the UI says no queue history is recorded.

## Recent scrape results (Activity)

- **Question / action:** Which sources keep failing, and is one source finding fewer listings than before? Inspect that source's latest run.
- **Data (`GET /admin/runs`):** the 100 most recent scrape runs across all sources, newest first, with `success`, `listingsFound`, start/finish. No scrape-run deletion was found in `apps/api`, but the endpoint caps at 100, so that is the only window shown, and the display says older runs are not shown when the page is full.
- **Default view: Outcomes by source.** Stacked failed / succeeded / no-result runs per source, failing sources first. Failed and succeeded use danger and primary, not red and green: the dataviz validator shows red/green fails colour-vision separation.
- **Alternate: Listings found per run** for one chosen source, oldest to newest (existing `ScrapeRunChart`). Mixing sources in one listings-found chart compares source size, not health, so this view is per source. Same runs, same window.
- **Run details by source** (collapsed) gives exact counts, latest result and an Inspect action.
- **Not built:** inventory history (none stored), durations or rates.

## Other decisions

- The Overview "Jobs waiting or running" card uses the same split, and shows delayed as "not counted".
- A failed refresh keeps the last good queue reading and says it is the last successful reading; a never-loaded queue says unknown, not zero.
- Both charts keep one view choice in component state, so it survives the 15-second refresh. It is not in the URL.
- Chart colours use the ops `--clr-*` tokens (no raw hex). Contrast was checked with the dataviz validator for the grafana dark and light token sets and by axe in the browser.
