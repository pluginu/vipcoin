# Prompt 04 — Complete popup and custom rules

Using `00-product-contract.md`, finish the popup and its integration with the service worker/content script.

Implement the global enable toggle, page match count, loaded profile count, dataset progress stages, readable status/warnings, and full custom-rule editor. A rule needs a stable unique ID, value, mode, case-sensitive flag, enabled flag, and deletion. Enforce the 500-character and 100-rule limits. Validate regex syntax before saving and explain each matching mode in the UI.

Perform the `customTerms` legacy migration in a deterministic, safe way in every component that may encounter old storage before the popup has opened. Use safe DOM construction and `textContent` for user values. React to storage changes from other extension contexts. Avoid duplicate rendering loops and handle closed/unsupported/no-content-script tabs gracefully.

Make progress semantics consistent across the background, content script, and popup. Do not poll at an unnecessarily aggressive rate; prefer storage events and a modest status interval only where needed.

Verify adding, toggling, deleting, invalid regex rejection, limit errors, migration, pause/resume, dynamic page matches, unsupported tabs, download progress, and offline warning presentation. Report the results and stop.
