# VIP Coin Highlighter

A local Chrome extension for highlighting Pump.fun profiles found in `vip_list.csv`, plus any custom words or phrases you add.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open or reload Pump.fun.

The bundled CSV is loaded automatically. You can configure a public HTTPS CSV URL in the popup; the extension refreshes it at most every 15 minutes and caches the last good copy for offline use. You can also pause highlighting, add custom terms, rescan, or load a local CSV with the same columns.

VIP list matches are yellow and custom-term matches are blue. Matching works on content that Pump.fun loads later without requiring a page refresh.
