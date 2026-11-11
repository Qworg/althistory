# The GitHub Pages site

The landing page at <https://qworg.github.io/althistory/>, deployed by
`.github/workflows/pages.yml` on every push to `main` that changes it.

```bash
node site/build.mjs          # builds into site/_site (needs Node 24+)
(cd frontend && npm run build:demo) && node site/build.mjs --demo frontend/dist-demo   # with the demo
npx serve site/_site         # or any static server (the demo needs one; the page alone opens from disk)
```

- `src/` is the site: `index.html` (the landing page), `agents.html` (setting up the CLI and MCP server), `social.html` (the social card), one stylesheet and one script, with no build step of their own.
- The walkthrough video, its captions (WebVTT; the video has none burned in) and its poster are copied in from `docs/media/` and `docs/images/`, which `npm run media` regenerates from the running app.
- The feature pictures are drawn, not screenshots: `build.mjs` writes four "moments" from the seed in place of `<!-- moment:trace|path|branch|review -->` (a traced chain, a causal path, a branch over its original, a review table). Lines are SVG; their text is HTML, so it reads on a phone.
- The hero timeline is interactive (`src/main.js`): point at an event, tap near one, or focus the timeline and use the arrow keys. The card names it, says how many later events it led to (those stay lit while the rest fades), and links straight to that event in the demo (`demo/?start=main#/timeline?event=<id>`; the ids come from the demo's recording). Once, after the drawing has drawn itself, it selects an event for a moment to show this; never with reduced motion. Keyboard selections are announced; a screen-reader list of the same events replaces `<!-- hero:events -->`.
- The hero's forking timeline is drawn by `build.mjs` from `media/src/seed/scenario.ts`, the history in those pictures, so the graphic and the screenshots always show the same events.
- `demo/` is the real frontend built with `npm run build:demo`, which answers its own API in the browser from a recording of the real backend. See `frontend/src/demo/README.md`. The Pages workflow builds it, runs its e2e suite, and only then publishes.
- `e2e/playwright.site.config.ts` builds the site and serves it as static files, then checks what review by eye has missed before: that every code panel's text is readable (4.5:1) in light and dark mode, and that neither page scrolls sideways at 390px (measured without mobile emulation, which would hide it). The Pages workflow runs it before it publishes: `npx playwright test -c playwright.site.config.ts` in `e2e/`.
