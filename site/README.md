# The GitHub Pages site

The landing page at <https://qworg.github.io/althistory/>, deployed by
`.github/workflows/pages.yml` on every push to `main` that changes it.

```bash
node site/build.mjs          # builds into site/_site (needs Node 24+)
(cd frontend && npm run build:demo) && node site/build.mjs --demo frontend/dist-demo   # with the demo
npx serve site/_site         # or any static server (the demo needs one; the page alone opens from disk)
```

- `src/` is the page: plain HTML, CSS and a few lines of JavaScript, no build step of its own.
- The screenshots and the walkthrough video are copied in from `docs/images/` and `docs/media/`, which `npm run media` regenerates from the running app. Regenerate them there, not here.
- The hero's forking timeline is drawn by `build.mjs` from `media/src/seed/scenario.ts`, the history in those pictures, so the graphic and the screenshots always show the same events.
- `demo/` is the real frontend built with `npm run build:demo`, which answers its own API in the browser from a recording of the real backend. See `frontend/src/demo/README.md`. The Pages workflow builds it, runs its e2e suite, and only then publishes.
