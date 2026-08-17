# The Long Dark — progress site

Public build progress for **The Long Dark**, a roguelike bullet-heaven horror shmup
made in Godot 4.7 and headed for Steam.

**Site:** https://remwayai.github.io/the-long-dark-progress/  
**Skills catalog:** https://remwayai.github.io/the-long-dark-progress/skills.html

This repo holds *only* the site. The game source, design documents and internal
audit notes stay in the private repo.

## What gets published

`tools/sync.mjs` reads the ticket board out of the private repo and writes
`data/board.json` with a deliberately narrow slice:

- ticket number, title, stream, state, dates
- rolled-up counts for the charts

Issue **bodies are never published** — that is where the blunt internal notes live.
The single exception is opt-in: a comment that begins with `TEST:` on an issue
labelled `needs:you` (or `needs:playtest`). Only the text after `TEST:` reaches
the page, and only as escaped plain text.

## The inbox

When an agent finishes something a human has to look at, play, or plug in:

```bash
gh issue edit <n> --repo remwayai/the-long-dark --add-label "needs:you"
gh issue comment <n> --repo remwayai/the-long-dark --body "TEST: what to look at, and the question to answer"
```

It appears in **Waiting on you** at the top of the site. Closing the issue removes it.

## Refreshing the data

Automatic, via `.github/workflows/sync.yml` — every 30 minutes, on push, and on
demand. It needs one secret:

> **`BOARD_TOKEN`** — a fine-grained personal access token, resource owner
> `remwayai`, repository `remwayai/the-long-dark` only, permission
> **Issues: Read-only**. Nothing else. Add it under
> Settings → Secrets and variables → Actions in *this* repo.

Until that secret exists the workflow still deploys the site, it just publishes
whatever `data/board.json` was last committed. Either agent can refresh it by hand:

```bash
BOARD_TOKEN=$(gh auth token) node tools/sync.mjs
git commit -am 'data: refresh board' && git push
```

## Layout

| Path | What |
|---|---|
| `index.html` | the page |
| `assets/style.css` | dark palette; categorical hues validated against the `#141416` chart surface |
| `assets/app.js` | renderer — no dependencies, no build step |
| `tools/sync.mjs` | board reader / JSON generator |
| `data/board.json` | generated, committed |
| `skills.html` | public catalog of agent skills (titles + one-liners only) |
| `data/skills.json` | skill catalog data |
