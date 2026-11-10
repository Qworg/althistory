# The GitHub Pages site

The landing page at <https://qworg.github.io/althistory/>, deployed by
`.github/workflows/pages.yml` on every push to `main` that changes it.

```bash
node site/build.mjs          # builds into site/_site (needs Node 24+)
npx serve site/_site         # or any static server; opening index.html directly also works
```

- `src/` is the page: plain HTML, CSS and a few lines of JavaScript, no build step of its own.
- The screenshots and the walkthrough video are copied in from `docs/images/` and `docs/media/`, which `npm run media` regenerates from the running app. Regenerate them there, not here.
- The hero's forking timeline is drawn by `build.mjs` from `media/src/seed/scenario.ts`, the history in those pictures, so the graphic and the screenshots always show the same events.
