# Screenshots and walkthrough video

This package regenerates every picture of the interface in the repository:
the README images and [`docs/walkthrough.md`](../docs/walkthrough.md)
(`docs/images/*.png`), and the new-user walkthrough video
(`docs/media/walkthrough.mp4`). It is a separate package, like `e2e/`, so its
dependencies (Revideo brings its own Vite and Puppeteer) stay out of the app.

```bash
cd media
npm ci
npx playwright install chromium   # once per machine

npm run generate                  # everything (~2 min)
npm run generate -- --skip-build  # reuse the last backend/frontend build
npm run capture                   # screenshots only, no video
npm run video                     # re-render the video from the last capture
npm run typecheck
```

Rerun it whenever the interface changes, look at the diff of
`docs/images/`, and commit the images and the video together.

## What a run does

1. **Build** the backend (`timeline/`, `npm run build`) and a production
   build of the frontend into `media/.build/frontend` (never `frontend/dist`).
2. **Start** both on free ports: the backend in local mode on a fresh
   temporary data directory with a one-off admin key, and `vite preview`
   proxying `/api` to it. The process environment overrides
   `timeline/.env.local`, so your own settings cannot leak in. In particular,
   `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are blanked, which keeps ingestion
   on the deterministic pattern reader and means a run costs nothing.
3. **Seed** the demo graph ([`src/seed/scenario.ts`](src/seed/scenario.ts))
   through the public HTTP API, the same routes the UI and CLI use.
4. **Capture** the tour ([`src/capture/tour.ts`](src/capture/tour.ts)) with
   Playwright at 1600×900, 2× pixel density, `en-US` and UTC. Each step
   writes a screenshot and records the screen regions the video points at
   into `out/shots/manifest.json`.
5. **Write the stills** ([`src/images.ts`](src/images.ts)): downscaled and,
   where useful, cropped copies in `docs/images/`.
6. **Render the video** ([`src/video/`](src/video)) with
   [Revideo](https://github.com/midrender/revideo), re-encode it with x264 to
   keep it small, and take `docs/images/walkthrough-poster.png` from it.

Everything is torn down afterwards; the temporary data directory is deleted.

## Changing things

| To change | Edit |
| --- | --- |
| The history being shown | [`src/seed/scenario.ts`](src/seed/scenario.ts) |
| Which screens are captured, and what is clicked | [`src/capture/tour.ts`](src/capture/tour.ts) |
| Which stills the docs get, and their crops | `README_IMAGES` in [`src/images.ts`](src/images.ts) |
| The narration, chapter order and camera moves | [`src/video/storyboard.ts`](src/video/storyboard.ts) |
| How the video looks (captions, outlines, pointer, title cards) | [`src/video/walkthrough.tsx`](src/video/walkthrough.tsx) |

The storyboard refers to shots and regions by name (`shot: 'timeline'`,
`focus: 'tooltip'`). A name the capture did not record fails the render with
a message naming it, so the tour and the storyboard cannot silently drift.

The tour waits for content the seed produces (an event count, a review
table), never for a fixed delay. If the UI changes so a step can no longer
find what it waits for, the capture fails rather than photographing a broken
screen. Fix the step, don't add a sleep.

## Notes

- **Determinism.** The data, locale, timezone, viewport and fonts are pinned
  (the video bundles Inter and JetBrains Mono through `@fontsource`), so
  reruns on one machine produce the same pictures. A different OS or
  Chromium build can still change anti-aliasing slightly.
- **Pressures.** The scenario includes three tight clusters of events (bank
  and market; protest and demonstration; Parliament and legislation) because
  the inference engine only infers a pressure from two or more matching
  events within 30 days. Remove them and the pressure panel reads zero.
- **Telemetry.** Revideo's renderer reports anonymous usage unless
  `DISABLE_TELEMETRY` is set; `src/video/render.ts` sets it.
- **Embedding the video.** GitHub strips a README `<video>` tag whose `src`
  is a file in the repository (relative, `raw.githubusercontent.com` and
  `/raw/` URLs alike); it only plays video it hosts at
  `github.com/user-attachments/...`. So the README's player points at an
  uploaded copy of `docs/media/walkthrough.mp4`, and regenerating does not
  update it on its own: after `npm run media`, drag the new mp4 into a GitHub
  issue or PR comment box and put the `user-attachments` URL it gives you in
  the README's `<video src="...">`. The download link next to the player
  always serves the repository copy.
