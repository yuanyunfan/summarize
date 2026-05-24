---
title: "Verification matrix"
kicker: "project"
summary: "Required gates for feature and bug-fix changes."
read_when:
  - "Before marking a feature or bug fix as done."
  - "When choosing which tests to run for extension, daemon, settings, or prompt changes."
---

# Verification Matrix

Goal: every user-visible change must prove the path users actually exercise. Prefer a small failing probe first, then the narrow fix, then the matching gate below.

## Default Gates

- General source-only change: `pnpm -s check`
- Chrome extension runtime change: `pnpm -s verify:extension-runtime`
- User-visible extension/daemon/LLM behavior: `pnpm -s verify:local`
- Prompt or summary-quality change: `pnpm -s verify:quality`

`verify:quality` is a live local smoke. It uses the configured model path and fails if the output is clearly overlong or resembles a paragraph-by-paragraph rewrite.

## Change Matrix

### UI / Sidepanel

- Add a DOM or Playwright probe for the exact visible state.
- If data arrives by SSE, mock the SSE event and assert the rendered DOM.
- Run: `pnpm -C apps/chrome-extension test:chrome`

### Daemon / SSE / Cross-Boundary Metadata

- Test the producer shape and the stream/session forwarding layer.
- Assert metadata survives later partial `meta` patches.
- Run targeted daemon tests plus `pnpm -s check`.

### Settings / Defaults / Migrations

- Test empty storage, old storage without schema version, explicit user choice, invalid values, and save/load roundtrip.
- Run the payload test that proves the effective daemon request uses migrated settings.

### Prompt / LLM Output Quality

- Add deterministic prompt contract assertions for instructions, upper bounds, and anti-rewrite language.
- Run `pnpm -s verify:quality` for live model behavior before declaring user-visible quality fixes done.

### Extension Build / Installed Runtime

- Build the unpacked extension.
- Run Chrome extension E2E.
- Restart and check the daemon.
- Run real-browser smoke when the bug depends on a user-installed unpacked extension.

## Required Evidence In Final Replies

- Name the exact failing probe or regression test added.
- Report the highest relevant gate that passed.
- For extension changes, mention whether the unpacked extension was rebuilt and whether the daemon was restarted.
- If a live quality smoke was skipped or failed due missing credentials, say that explicitly.
