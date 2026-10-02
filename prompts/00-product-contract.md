# Product contract: clean-room VIP Coin rebuild

Build a dependency-free Chrome Manifest V3 extension named **VIP Coin**. It identifies watched profiles and custom user terms on ordinary HTTP/HTTPS pages, highlights matches without rewriting page DOM, and optionally warns when a post has been seen before. Also provide a static informational site and a standard-library-only Python utility for maintaining the CSV dataset.

## Product principles

- Local-first: custom rules, cached data, settings, and seen-post history stay in `chrome.storage.local`.
- No analytics, telemetry, account system, cookies, injected remote code, or transmission of browsing history.
- Remote access is limited to retrieving the public VIP CSV from a configurable HTTPS URL.
- The last valid downloaded dataset remains usable offline. A bundled CSV is the first-install fallback.
- No build system or package manager is required. Use plain HTML, CSS, JavaScript, and Python's standard library.
- Support modern Chrome with the CSS Custom Highlight API.
- Browser-internal/protected pages are explicitly unsupported.

## Repository outputs

```text
manifest.json
background.js
content.js
content.css
popup.html
popup.css
popup.js
index.html
README.md
vip_list.csv
vip_inactive.csv
web/vip_list.csv
icons/...
scripts/merge_vip_dataset.py
scripts/test_merge_vip_dataset.py
```

## Extension architecture

- A Manifest V3 service worker owns remote dataset fetching, conditional HTTP refresh, cache metadata, download progress, alarms, and periodic pruning of seen-post history.
- A content script owns CSV parsing/indexing, visible-page matching, highlights, match counts, live DOM observation, URL matching, and seen-post detection.
- A popup owns settings and rule editing, status/progress display, and history clearing.
- Components communicate through `chrome.runtime` messages and react to `chrome.storage.onChanged`.

## Manifest and permissions

- Manifest version 3.
- Permissions: `storage`, `activeTab`, `unlimitedStorage`, and `alarms`.
- Host permissions and content-script matches: `http://*/*` and `https://*/*`.
- Service worker: `background.js`.
- Popup: `popup.html`.
- Bundle `vip_list.csv` as a web-accessible resource for HTTP/HTTPS matches.
- Include 16, 32, 48, and 128 pixel extension icons.

## Dataset behavior

The exact CSV columns are:

```text
profile_name,pump_handle,pump_profile_url,x_handle,x_url,followers
```

At runtime, index nonblank profile names, Pump handles, X handles, and the final path component of valid profile URLs. Strip leading `@`, trim whitespace, case-fold, and ignore terms shorter than three characters. Also index normalized URL origin + pathname values, ignoring query strings, fragments, and trailing slashes. Count nonempty data rows as loaded VIP profiles.

The service worker must:

- On first use, fetch the hosted CSV; enforce a 15-second timeout and 20 MiB maximum.
- Validate that the expected header is present before replacing the saved dataset.
- Persist CSV text, fetch time, ETag, Last-Modified, last error, and progress.
- Reuse a saved copy on startup/page loads without a network request.
- Every 15 minutes, use conditional headers (`If-None-Match`, `If-Modified-Since`) and accept HTTP 304.
- Preserve the last valid cached copy on all network/validation errors.
- Fall back to bundled `vip_list.csv` when no cache and no network are available.
- Coalesce concurrent fetch requests so only one download is active.
- Publish useful stages: downloading, loading, indexing, ready, and error.

## Page matching

- VIP text matches are case-insensitive whole words/phrases with Unicode-aware letter/number/underscore boundaries.
- Exact normalized profile URLs are VIP matches.
- User rules support: `exact`, `contains`, `starts`, `ends`, and JavaScript `regex`; each has enabled and case-sensitive flags.
- Invalid regex rules must never crash scanning. The popup rejects them with a readable error.
- Cap a rule at 500 characters and custom rules at 100.
- Use `Range` objects and the CSS Custom Highlight API; do not wrap or replace text nodes.
- Highlight VIP text in green and custom matches in blue. Add a green outline and a small VIP badge to a reasonable containing card for VIP matches.
- Skip scripts, styles, controls, hidden/ARIA-hidden regions, and editable content. Skip individual text nodes over 4,000 characters.
- Cap a single text node at 100 ranges and bound each scan batch to keep pages responsive.
- Observe inserted nodes, text changes, and link `href` changes. Debounce work.
- Recheck viewport cards after scrolling and every two seconds to handle virtualized feeds.
- Reset stale ranges and container counts safely when content changes or matching is disabled.

## Settings and popup

Defaults: `{ enabled: true, customRules: [], trackSeenPosts: false }`.

Each custom rule has `{ id, value, mode, caseSensitive, enabled }`. Migrate a legacy string array named `customTerms` into enabled, case-insensitive `contains` rules and remove the legacy key.

The popup shows:

- Global enable toggle.
- Current-page match count and number of loaded profiles.
- Dataset loading progress and the Download → Load → Index → Ready stages.
- Current status or warning.
- Seen-post protection toggle, retained count, and Clear history.
- Rule form, match-mode explanation, case-sensitive option, per-rule enable toggle, and delete button.
- Clear messaging when the active tab is unsupported or must be refreshed after installation.

## Seen-post protection

- Disabled by default.
- Store canonical IDs derived only from HTTP/HTTPS hostname + pathname; ignore query/fragment and remove a trailing slash.
- Recognize common post paths: `/status/`, Instagram-style `/p/`, `/reel/`, `/reels/`, `/tv/`, Reddit `/comments/`, `/posts/`, `/permalink/`, and `/coin/`.
- Mark repeated feed cards with a red outline and `SEEN BEFORE` badge. Show a fixed warning pill for a repeated current post page.
- Treat a post as new on first observation, then persist it. Avoid immediately calling the current page a repeat within the same first visit.
- Retain entries seven days, cap at 25,000 newest entries, batch writes briefly, and prune on startup/periodic maintenance.
- Clear history must reset persisted and in-page/session state.

## Dataset maintenance tool

Use only Python's standard library. The command accepts an incoming CSV and optional active, inactive, and web-copy paths plus `--dry-run`.

- Validate required columns using UTF-8 with optional BOM.
- Identify active records loosely by a normalized X handle taken from `x_handle` or an x.com/twitter.com profile URL.
- Never overwrite an existing active record merely because a newer row differs.
- Treat the same X identity as a duplicate unless both records have conflicting nonempty Pump handles or Pump profile URLs; report and skip conflicts.
- Store records without an X identity in `vip_inactive.csv`, deduplicated by Pump URL, then Pump handle, then full row.
- Migrate legacy incomplete rows out of the active file.
- If a later complete record shares a Pump identity with an inactive record, promote it and remove the inactive copy.
- Write atomically. Synchronize `web/vip_list.csv` after active changes. A dry run writes nothing.
- Exit nonzero on invalid input; use a distinct nonzero result when conflicts were skipped.
- Include unit tests for normalization, new/duplicate/conflicting records, inactive deduplication/migration, and promotion.

## Static site and documentation

Create a responsive, accessible, dark-themed single-page site explaining the product, privacy model, installation, matching types, and hosted CSV. It must work as a GitHub Pages root without a build step. Display the CSV URL, offer a copy button, and report its row count when reachable.

The README must explain installation, permissions, privacy, remote-cache behavior, offline fallback, protected-page limitations, seen-post retention, GitHub Pages publishing, dataset schema, merge usage, dry run, exit behavior, and tests.

## Quality gates

- No `eval`, remote script, `innerHTML` with untrusted data, or collection/transmission of page content.
- Extension CSP-compatible; no inline JavaScript in extension pages.
- All user-controlled UI text is inserted with `textContent` or safe DOM APIs.
- All message paths fail safely when a tab/content script is unavailable.
- Python tests pass with `python3 -m unittest discover -s scripts -p 'test_*.py'`.
- JSON and JavaScript parse successfully and the extension loads unpacked without manifest errors.
