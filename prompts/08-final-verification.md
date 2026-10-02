# Prompt 08 — Final audit and release readiness

Audit the complete clean-room implementation against every line of `00-product-contract.md`. Fix any discrepancy you find; do not merely list it.

Perform these audits:

1. **Functional:** install/startup/offline/update flows, all rule modes, live DOM updates, pause/resume, URL matching, seen-post behavior, clearing, and popup status.
2. **Security/privacy:** permissions are minimal for the stated behavior; no telemetry, page-content transmission, arbitrary fetch targets, remote code, unsafe HTML injection, `eval`, secrets, or browsing-history leakage.
3. **Resilience:** malformed CSV, invalid regex, storage races, absent tabs/content scripts, fetch timeout, HTTP error/304, oversized files, virtualized/recycled content, and storage clearing.
4. **Performance:** bounded scan batches/ranges, no one-regex-per-VIP design, debounced observers, no hot polling, yielded indexing, and no unbounded history.
5. **Accessibility/UI:** labels, keyboard operation, focus, contrast, meaningful status text, compact popup layout, and responsive static site.
6. **Maintenance:** Python tests, dry run, atomic writes, conflict safety, inactive migration/promotion, and synchronized web copy.

Run all available automated checks. Add small deterministic tests or fixtures where important behavior is otherwise unverified. Validate JSON, parse all JavaScript, run Python tests, compare CSV headers/copies, and inspect the repository for accidental secrets, generated caches, and unnecessary dependencies. Do not delete real user datasets.

End with a release report containing:

- pass/fail per product-contract section;
- exact commands and results;
- manual Chrome tests still required;
- permissions and outbound-network summary;
- storage keys and retention summary;
- known limitations;
- final file inventory.

The implementation is complete only when all automatable gates pass and remaining browser-only checks are explicit.
