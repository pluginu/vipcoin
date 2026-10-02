# Prompt 06 — Dataset maintenance utility

Using `00-product-contract.md`, implement `scripts/merge_vip_dataset.py` and comprehensive `unittest` coverage in `scripts/test_merge_vip_dataset.py` using Python's standard library only.

Follow every identity, conflict, inactive-storage, promotion, atomic-write, synchronization, dry-run, reporting, and exit-code rule in the contract. Preserve the canonical active CSV's field order. Normalize X identities from `@handle`, plain handle, x.com URL, or twitter.com URL while rejecting values that are not plausible profile handles. Normalize comparison URLs without query/fragment/trailing slash. Never silently merge contradictory people.

Tests must cover at least:

- handle and legacy Twitter URL normalization;
- a new active record;
- an active duplicate that does not overwrite old data;
- conflicting Pump identity fields;
- incomplete rows and inactive deduplication;
- migration of incomplete legacy active rows;
- promotion when complete data arrives;
- dry-run making no writes;
- atomic output and web-copy synchronization;
- malformed/missing columns and expected exit behavior.

Run `python3 -m unittest discover -s scripts -p 'test_*.py'` and show the result. Also run a dry-run against temporary synthetic CSVs. Never use production data to make the tests pass.
