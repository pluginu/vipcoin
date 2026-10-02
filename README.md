# VIP Coin

A local Chrome extension for spotting VIP profiles on any website using `vip_list.csv`, plus any custom words or phrases you add.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the extension popup and turn on the VIP Coin toggle.
5. Refresh the website you want to scan after installing and turning on the extension.

The extension automatically downloads `https://pluginu.github.io/vipcoin/web/vip_list.csv` once when no local copy exists and saves it in persistent browser storage. Startup, extension updates, and page loads reuse that saved copy without contacting the server. Background checks run every 15 minutes using conditional requests; an unchanged list is not downloaded again, and a successful update replaces the saved copy. The last good copy remains available offline. The bundled CSV is the fallback for a fresh offline install. Users cannot replace the official list with a local file.

The toggle controls detection across all HTTP and HTTPS websites. Browser internal pages and other protected pages do not allow extensions to scan their content.

VIP list matches use a crypto-green highlight and custom-rule matches are blue. Custom rules support exact, contains, starts-with, ends-with, regex, and case-sensitive matching. Mutation, scroll, and periodic viewport scanning catch content that websites load or recycle later without requiring a page refresh.

The optional **Seen-post protection** toggle remembers recognized post permalinks locally and displays a red warning when the same post appears again. Entries expire automatically after seven days, and **Clear history** deletes them immediately. The tracker recognizes common post URL formats used by Pump.fun, X, Instagram, Reddit, and other sites with post or permalink paths.

## GitHub Pages

The project site lives in `index.html` and can be published directly from the repository root with GitHub Pages. A web-accessible copy of the dataset lives at `web/vip_list.csv`.

After Pages is enabled for the `main` branch and repository root, the hosted CSV URL will be:

```text
https://pluginu.github.io/vipcoin/web/vip_list.csv
```

The URL is built into the extension; no popup setup is needed. Keep `vip_list.csv` and `web/vip_list.csv` in sync when updating the list; the root copy remains the extension's offline fallback.

## Merge new records

Use the merge helper with another CSV that has the same columns:

```bash
python3 scripts/merge_vip_dataset.py path/to/new_records.csv
```

The script uses a case-insensitive `x_handle` (or the handle in `x_url`) as a loose identifier. New handles are appended to `vip_list.csv` and the web copy is synchronized. Existing handles are left unchanged. If an existing X handle has a different non-empty Pump handle or Pump profile URL, the row is reported as a conflict and skipped. Rows without an X handle are retained in the separate `vip_inactive.csv` file and are not downloaded or indexed by the extension, so they do not affect production performance. Legacy incomplete rows are migrated there automatically. If a later import supplies X data for the same Pump profile, the completed row is promoted to the active list and removed from the inactive file. Preview the result without writing files with `--dry-run`.
