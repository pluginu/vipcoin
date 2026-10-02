# VIP Coin Highlighter

A local Chrome extension for highlighting VIP profiles on any website using `vip_list.csv`, plus any custom words or phrases you add.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the extension popup and turn on the highlighting toggle.
5. Refresh the website you want to scan after installing and turning on the extension.

The extension automatically downloads `https://pluginu.github.io/vipcoin/web/vip_list.csv` once when no local copy exists and saves it in persistent browser storage. Startup, extension updates, and page loads reuse that saved copy without contacting the server. Background checks run every 15 minutes using conditional requests; an unchanged list is not downloaded again, and a successful update replaces the saved copy. The last good copy remains available offline. The bundled CSV is the fallback for a fresh offline install. Users cannot replace the official list with a local file.

The toggle controls highlighting across all HTTP and HTTPS websites. Browser internal pages and other protected pages do not allow extensions to scan their content.

VIP list matches are yellow and custom-rule matches are blue. Custom rules support exact, contains, starts-with, ends-with, regex, and case-sensitive matching. Mutation, scroll, and periodic viewport scanning catch content that websites load or recycle later without requiring a page refresh.

## GitHub Pages

The project site lives in `index.html` and can be published directly from the repository root with GitHub Pages. A web-accessible copy of the dataset lives at `web/vip_list.csv`.

After Pages is enabled for the `main` branch and repository root, the hosted CSV URL will be:

```text
https://pluginu.github.io/vipcoin/web/vip_list.csv
```

The URL is built into the extension; no popup setup is needed. Keep `vip_list.csv` and `web/vip_list.csv` in sync when updating the list; the root copy remains the extension's offline fallback.
