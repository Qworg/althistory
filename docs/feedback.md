# In-app feedback

Every page has a **Send feedback** button: the speech-bubble icon beside Help
in the header, **More → Send feedback** on a phone, a link at the foot of the
Help dialog, or **Shift+I** anywhere. It opens a short form (kind, title,
details), with a picture of the page and the app's state as they were the
moment it was asked for. The report becomes a GitHub issue (#49).

## How a report reaches GitHub

The app chooses one of two routes, and the reporter sees which:

| | The server files it | GitHub's prefilled form |
| --- | --- | --- |
| When | The API has `FEEDBACK_GITHUB_TOKEN` and `FEEDBACK_GITHUB_REPO` | Everywhere else: no token, the Pages demo, or the server refused |
| The reporter needs | Nothing | A GitHub account |
| The button | **Send report** | **Continue on GitHub** (opens a new tab) |
| The screenshot | Committed to `FEEDBACK_SCREENSHOT_BRANCH` and linked from the issue | Put on the clipboard to paste into the form; a **Download** button is the fallback |
| Afterwards | A link to the new issue | The form, filled in |

`GET /api/feedback/config` tells the app whether the server files reports, and
which repository to send people to (`FEEDBACK_GITHUB_REPO`, or the repository
the app was built for, `VITE_FEEDBACK_REPO`, default `Qworg/althistory`). If
the server answers `POST /api/feedback` with an error, a limit or "not
configured", the dialog keeps everything typed and offers the form.

A link to the form carries the report in its query, and GitHub refuses one much
longer than 8 KB. The captured state is trimmed until the link fits: the last
three errors, then only a summary. The reporter's own words are never trimmed.
If they alone are too long, the report goes on the clipboard as text and the
link asks for it to be pasted.

## What a report captures

The screenshot and the state are read before the dialog appears. Whatever
opened it (the More sheet, the Help dialog) has already closed, so neither is in
the picture. A small "Capturing the screen…" notice shows meanwhile, and is
left out of the picture too. While it shows, keys do nothing except Escape,
which cancels. The window and any panel that has been scrolled are drawn as
scrolled.

- **Screenshot.** What is in view, drawn by [html-to-image](https://github.com/bubkoo/html-to-image).
  That includes the D3 timeline and Cytoscape's canvases. It is at most 1600 px
  wide, and a JPEG when a PNG would pass 1.5 MB. If drawing takes over 8
  seconds, the dialog opens without one and says why.
- **Where.** The route (with `?event=` kept, the rest of the query dropped),
  the view, the graph's id and name, and whether this is the demo.
- **State.** The selected event and arc ids (up to 20 of each); the filters,
  with any text in them as counts ("3 actors", "a search of 12 characters") and
  the date range, arc levels, link weights and confidence as they are; the timeline's zoom and
  centre, the causal layout, the layout mode, the theme, and the panels open.
- **Environment.** The app's version and commit, the browser, the language,
  the window size and pixel ratio, whether the app is online, and how many
  offline writes are queued.
- **Recent errors.** The last 15 uncaught errors, unhandled rejections, errors
  an error boundary caught, and failed API calls (method, path, status, code,
  request id). Messages are capped, and anything shaped like a key or token is
  redacted.

A report holds **ids, not content**. The text of events, arcs, filters and
searches is never put in it, though whatever is on screen is in the
screenshot. No API key, request body or header is ever included. Two boxes
leave out the screenshot or the state, and **See what is sent** shows the issue
body the app builds. Two things can change it afterwards. The server
neutralises it again and adds a note that it filed the issue. A link too long
for GitHub drops the full state, keeping the summary.

## Setting up server filing

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens)
   for the one repository, with **Issues: write** and **Contents: write**.
   Contents is for the screenshots.
2. Set, for the API:

   ```env
   FEEDBACK_GITHUB_REPO=owner/name
   FEEDBACK_GITHUB_TOKEN=github_pat_...
   ```

   The compose file passes both through from `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FEEDBACK_GITHUB_REPO` | — | `owner/name`. Without a token, it still tells the app where the form is |
| `FEEDBACK_GITHUB_TOKEN` | — | The token the server files with. It never leaves the server |
| `FEEDBACK_SCREENSHOT_BRANCH` | `feedback-screenshots` | Where screenshots are committed. It is created from the default branch the first time |
| `FEEDBACK_LABELS` | `feedback` | Labels every report gets, comma-separated. A bug also gets `bug`, an idea `enhancement` |
| `FEEDBACK_RATE_PER_CLIENT` | `5` | Reports per client (API key, else address) per 15 minutes |
| `FEEDBACK_RATE_GLOBAL` | `30` | Reports per hour from all clients together |
| `FEEDBACK_GITHUB_API` | `https://api.github.com` | For GitHub Enterprise |

A misconfiguration turns server filing off, and is logged the first time
feedback is asked for. Examples: a repository not in `owner/name` form, a token
without a repository, or a token with spaces or control characters in it. A
screenshot branch that turns out to be the default branch is refused: the
issue is filed without the picture.

### What the server checks

Server filing lets anyone who can reach the app open issues with the server's
token, so the server does not trust what it is sent:

- **Mentions and references** in the title and body are neutralised, as
  Dependabot does: a zero-width space follows every `@` before a name
  character, every `#` or `GH-` before a digit, and the start of an issue,
  pull or commit number in a URL. So a report cannot notify anyone or
  cross-reference another repository's issues. Every narrower rule leaked
  (markup that renders away, such as `` `x`@a `` or `_a_@a`, left a live
  mention), so this one is blunt. An email address gets a space too, and the
  text still reads the same. A zero-width space also follows every `&`, so no
  character reference is decoded: `&#x40;` shows as written instead of
  becoming an `@`.
- **Sizes.** A title is one line of at most 200 characters, and a body at
  most 60,000, both measured after neutralising. A screenshot is at most 2 MB,
  and must start with the signature of the PNG, JPEG or WebP its data URL
  claims. That is a signature check, not a decoder.
- **Limits.** Reports are limited per address and across all addresses, as
  above (`429` with `Retry-After`). They are counted per address, not per key,
  because the bundled app sends one key for every visitor. Behind a proxy,
  set `TRUST_PROXY` so the address is the visitor's. When the entity routes need an API key
  (`API_AUTH_REQUIRED`), so does filing.
- **Failure.** If the screenshot cannot be stored, the issue is still filed
  and says so. If GitHub refuses the issue, the app gets `502`, or `503` with
  `Retry-After` when GitHub is limiting the token, and the dialog offers the
  form. If GitHub may have filed it but the server cannot tell, the answer is
  `502` with the code `FEEDBACK_MAYBE_FILED`: a timeout, a 5xx, or a reply it
  cannot read. The dialog then asks the reporter to check the repository before
  sending again.
- **Timeouts.** `/api/feedback` has a 45-second budget. A report's GitHub calls
  share 35 seconds, at most 10 each, and the issue always gets a full call's
  time. Once the server starts writing to GitHub the request is past its
  point of no return (see "A `408` means nothing was saved" in
  [api-integration.md](api-integration.md)). It answers with the real result
  rather than a `408`, so a retry never files the report twice.

Each issue ends with a note that the server filed it. The reporter may have no
GitHub account, so a reply on the issue may not reach them.

### Privacy

In a public repository the issue and its screenshot are public. The dialog
says so beside the screenshot. The screenshot branch starts from the default
branch's head, so it holds a copy of that tree, and its own commits are the
screenshots. To remove a screenshot, rewrite or delete the branch. The server
creates it again on the next report.

## Code

| Where | What |
| --- | --- |
| `frontend/src/components/feedback/` | The button, the dialog, the shortcut, capture (`screenshot.ts`, `captureContext.ts`, `diagnostics.ts`) and the issue body and link (`issueBody.ts`) |
| `timeline/src/services/feedback/FeedbackService.ts` | Configuration, checks, limits and the GitHub calls |
| `timeline/src/api/routes/feedback.ts` | `GET /api/feedback/config`, `POST /api/feedback` |
| `e2e/tests/feedback.spec.ts`, `e2e/demo/demo.spec.ts` | Both routes in a real browser, the phone layout, and the demo |
