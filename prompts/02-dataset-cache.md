# Prompt 02 — Dataset download and persistent cache

Using `00-product-contract.md` and the current repository, implement the complete service-worker dataset lifecycle and the content script's initial CSV loading/indexing path.

Use one clearly named constant for the hosted HTTPS CSV URL so an operator can change it. Implement persistent CSV/cache metadata, strict header validation, streaming size enforcement, timeout, progress, conditional refresh every 15 minutes, 304 handling, last-good-cache preservation, bundled fallback, concurrent-request coalescing, install/startup initialization, and error reporting exactly as required by the contract.

Expose a narrow runtime message interface for content scripts to request the saved dataset and optionally force a refresh. Never allow arbitrary URLs through messages. In the content script, add a correct quoted-field CSV parser and build the normalized term and URL indexes while periodically yielding to the page. Publish load/index progress through `VIP_STATUS`.

Add no page highlighting yet. Verify at least these cases by tests, a lightweight mock harness, or clearly documented manual checks:

1. first online fetch;
2. later cache-only load;
3. conditional 304 refresh;
4. invalid header;
5. timeout/network failure with an existing cache;
6. offline fresh install using the bundled file;
7. oversized response rejection;
8. simultaneous requests causing one fetch.

Report what is automated versus manual and stop after this data layer is reliable.
