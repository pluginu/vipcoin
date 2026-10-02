# VIP Coin Highlighter

A local Chrome extension for highlighting Pump.fun profiles found in `vip_list.csv`, plus any custom words or phrases you add.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open or reload Pump.fun.

The extension automatically downloads `https://pluginu.github.io/vipcoin/web/vip_list.csv` when it is installed or restarted and checks it every 15 minutes. It uses conditional requests and caches the last good copy for fast startup and offline use. The bundled CSV is the fallback for a fresh offline install. You can also pause highlighting, add custom terms, rescan, or load a local CSV with the same columns.

VIP list matches are yellow and custom-term matches are blue. Matching works on content that Pump.fun loads later without requiring a page refresh.

## GitHub Pages

The project site lives in `index.html` and can be published directly from the repository root with GitHub Pages. A web-accessible copy of the dataset lives at `web/vip_list.csv`.

After Pages is enabled for the `main` branch and repository root, the hosted CSV URL will be:

```text
https://pluginu.github.io/vipcoin/web/vip_list.csv
```

The URL is built into the extension; no popup setup is needed. Keep `vip_list.csv` and `web/vip_list.csv` in sync when updating the list; the root copy remains the extension's offline fallback.
