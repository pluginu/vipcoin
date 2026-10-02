# Prompt 05 — Seen-post protection

Using `00-product-contract.md`, implement the optional seven-day seen-post feature across background, content script, popup, and CSS.

Canonicalize only recognized HTTP/HTTPS post URLs into hostname + normalized pathname. Track links inside likely feed/post/card containers and separately track the current page URL. On first observation remember the post; on later visits or appearances mark its container with a red outline and `SEEN BEFORE` badge. For a repeated current-post page, show a fixed red warning pill. Preserve the first-visit/session distinction so simply rescanning the current page does not instantly label it repeated.

Batch writes, merge safely with concurrent storage updates, retain the newest 25,000 entries, and prune anything older than seven days on extension maintenance. The feature must still operate when VIP highlighting is paused, provided seen tracking remains enabled. Turning tracking off removes visual marks but need not erase history. Clear history must immediately clear persisted data and every local/session marker.

Finish the popup toggle, retained count, and Clear history behavior. Verify recognized and unrecognized URL forms, query/fragment normalization, repeated feed cards, navigation within a single-page app, virtualized cards, expiration/cap, toggle interactions, and clearing. Report automated/manual evidence and stop.
