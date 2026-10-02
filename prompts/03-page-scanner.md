# Prompt 03 — Efficient live-page scanner

Using `00-product-contract.md`, implement VIP and custom-rule matching in `content.js` and the visual treatment in `content.css`.

Build a Unicode-aware whole-term matcher optimized for a large VIP set (for example, a character trie rather than one regex per VIP). Match exact normalized profile URLs on anchors. Compile custom rules into safe regex matchers implementing exact, contains, starts, ends, regex, case-sensitivity, and enabled state.

Use the CSS Custom Highlight API with `Range` objects so text nodes are never rewritten. Track ranges and matched containers so rescans remove stale highlights and counts rather than accumulating them. Add the green VIP highlight/card badge and blue custom highlight.

Implement all skip rules and limits from the contract. Add debounced `MutationObserver` handling, viewport rescans on scroll, and the two-second safety pass for virtualized feeds. Scanning must remain pausable through the stored `enabled` flag and must react to storage changes without a page reload.

Create a small local HTML fixture or test harness containing plain text, punctuation boundaries, Unicode text, anchors, editable/hidden areas, dynamically inserted content, changed text, recycled cards, and large text. Verify correct matches, nonmatches, cleanup, and bounded behavior. Do not implement seen-post tracking in this stage.

Report changed files, tests/checks, known browser-only verification, and stop.
