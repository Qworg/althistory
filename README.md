# althistory
Generating historical-ish timelines and events for real and fictional places

## Tests

- Backend + frontend unit/integration suites: `./run-tests.sh`
- End-to-end (real browser, production build, stubbed API): see
  [`e2e/README.md`](e2e/README.md)

```bash
cd e2e
npm ci
npx playwright install chromium
npx playwright test
```
