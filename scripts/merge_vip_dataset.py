#!/usr/bin/env python3
"""Merge new VIP records into the canonical CSV without overwriting existing rows.

An X handle is a deliberately loose first-pass identifier.  Pump handles and Pump
profile URLs are used as corroborating attributes so a reused/mistyped X handle
does not silently combine two people.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit


DEFAULT_MAIN = Path(__file__).resolve().parents[1] / "vip_list.csv"
EXPECTED_FIELDS = (
    "profile_name",
    "pump_handle",
    "pump_profile_url",
    "x_handle",
    "x_url",
    "followers",
)
X_HOSTS = {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}


def normalize_handle(value: str) -> str:
    """Return a case-insensitive handle from an @handle or profile URL."""
    value = (value or "").strip()
    if not value:
        return ""
    candidate = value
    if "://" in value or value.lower().startswith(tuple(f"{h}/" for h in X_HOSTS)):
        parsed = urlsplit(value if "://" in value else f"https://{value}")
        if parsed.hostname and parsed.hostname.lower() in X_HOSTS:
            parts = [unquote(part) for part in parsed.path.split("/") if part]
            candidate = parts[0] if parts else ""
    candidate = candidate.strip().lstrip("@").rstrip("/")
    return candidate.casefold() if re.fullmatch(r"[A-Za-z0-9_]{1,50}", candidate) else ""


def x_identity(row: dict[str, str]) -> str:
    return normalize_handle(row.get("x_handle", "")) or normalize_handle(row.get("x_url", ""))


def normalize_pump_handle(value: str) -> str:
    return (value or "").strip().lstrip("@").casefold()


def normalize_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc:
        return value.rstrip("/").casefold()
    return urlunsplit(
        (parsed.scheme.casefold(), parsed.netloc.casefold(), parsed.path.rstrip("/"), "", "")
    )


def identity_conflicts(existing: dict[str, str], incoming: dict[str, str]) -> list[str]:
    """Find contradictory non-empty attributes that suggest different people."""
    checks = {
        "pump_handle": normalize_pump_handle,
        "pump_profile_url": normalize_url,
    }
    conflicts = []
    for field, normalizer in checks.items():
        left, right = normalizer(existing.get(field, "")), normalizer(incoming.get(field, ""))
        if left and right and left != right:
            conflicts.append(field)
    return conflicts


def row_signature(row: dict[str, str]) -> tuple[str, ...]:
    return tuple((row.get(field) or "").strip() for field in EXPECTED_FIELDS)


def inactive_identity(row: dict[str, str]) -> tuple[str, str] | tuple[str, ...]:
    """Return a stable identity for an incomplete profile when one is available."""
    pump_url = normalize_url(row.get("pump_profile_url", ""))
    if pump_url:
        return ("pump_profile_url", pump_url)
    pump_handle = normalize_pump_handle(row.get("pump_handle", ""))
    if pump_handle:
        return ("pump_handle", pump_handle)
    return ("row", *row_signature(row))


def supporting_identities(row: dict[str, str]) -> set[tuple[str, str]]:
    identities = set()
    pump_url = normalize_url(row.get("pump_profile_url", ""))
    pump_handle = normalize_pump_handle(row.get("pump_handle", ""))
    if pump_url:
        identities.add(("pump_profile_url", pump_url))
    if pump_handle:
        identities.add(("pump_handle", pump_handle))
    return identities


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames or []
        missing = [field for field in EXPECTED_FIELDS if field not in fields]
        if missing:
            raise ValueError(f"{path}: missing required columns: {', '.join(missing)}")
        return fields, [{key: value or "" for key, value in row.items()} for row in reader]


def write_csv_atomic(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def merge(
    main_rows: list[dict[str, str]],
    incoming_rows: list[dict[str, str]],
    inactive_rows: list[dict[str, str]] | None = None,
) -> tuple[list[dict[str, str]], list[dict[str, str]], dict[str, int]]:
    merged = []
    inactive = list(inactive_rows or [])
    by_x: dict[str, list[dict[str, str]]] = {}
    for row in main_rows:
        identity = x_identity(row)
        if identity:
            merged.append(row)
            by_x.setdefault(identity, []).append(row)
        else:
            # Keep legacy incomplete profiles, but remove them from the runtime dataset.
            inactive.append({field: (row.get(field) or "").strip() for field in EXPECTED_FIELDS})

    deduplicated_inactive = []
    inactive_keys = set()
    for row in inactive:
        key = inactive_identity(row)
        if key not in inactive_keys:
            deduplicated_inactive.append(row)
            inactive_keys.add(key)
    inactive = deduplicated_inactive
    stats = {
        "added": 0,
        "duplicate": 0,
        "conflict": 0,
        "migrated_inactive": len(main_rows) - len(merged),
        "inactive_added": 0,
        "inactive_duplicate": 0,
        "promoted": 0,
    }
    for line_number, row in enumerate(incoming_rows, start=2):
        identity = x_identity(row)
        if not identity:
            clean_row = {field: (row.get(field) or "").strip() for field in EXPECTED_FIELDS}
            if not any(clean_row.values()):
                continue
            key = inactive_identity(clean_row)
            if key in inactive_keys:
                stats["inactive_duplicate"] += 1
                continue
            inactive.append(clean_row)
            inactive_keys.add(key)
            stats["inactive_added"] += 1
            continue

        matches = by_x.get(identity, [])
        if matches:
            conflict_fields = sorted({field for match in matches for field in identity_conflicts(match, row)})
            if conflict_fields:
                stats["conflict"] += 1
                print(
                    f"skip line {line_number}: @{identity} conflicts on {', '.join(conflict_fields)}",
                    file=sys.stderr,
                )
            else:
                stats["duplicate"] += 1
            continue

        clean_row = {field: row.get(field, "") for field in EXPECTED_FIELDS}
        merged.append(clean_row)
        by_x[identity] = [clean_row]
        stats["added"] += 1
        # A completed import promotes the matching Pump profile out of inactive storage.
        incoming_support = supporting_identities(clean_row)
        if incoming_support:
            old_count = len(inactive)
            inactive = [
                candidate
                for candidate in inactive
                if not (supporting_identities(candidate) & incoming_support)
            ]
            promoted = old_count - len(inactive)
            if promoted:
                stats["promoted"] += promoted
                inactive_keys = {inactive_identity(candidate) for candidate in inactive}
    return merged, inactive, stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="CSV file containing candidate VIP records")
    parser.add_argument("--main", type=Path, default=DEFAULT_MAIN, help="canonical CSV to update")
    parser.add_argument(
        "--web-copy",
        type=Path,
        default=None,
        help="copy the updated CSV here (default: web/vip_list.csv beside the default main file)",
    )
    parser.add_argument(
        "--inactive",
        type=Path,
        default=None,
        help="store rows without an X handle here (default: vip_inactive.csv beside the main file)",
    )
    parser.add_argument("--dry-run", action="store_true", help="report the merge without changing files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    main_path = args.main.resolve()
    input_path = args.input.resolve()
    inactive_path = args.inactive.resolve() if args.inactive else main_path.parent / "vip_inactive.csv"
    web_copy = args.web_copy
    if web_copy is None and main_path == DEFAULT_MAIN.resolve():
        web_copy = main_path.parent / "web" / main_path.name

    try:
        fields, main_rows = read_csv(main_path)
        _, incoming_rows = read_csv(input_path)
        inactive_fields, inactive_rows = (
            read_csv(inactive_path) if inactive_path.exists() else (list(EXPECTED_FIELDS), [])
        )
        merged, inactive, stats = merge(main_rows, incoming_rows, inactive_rows)
        active_changed = bool(stats["added"] or stats["migrated_inactive"])
        inactive_changed = bool(
            stats["inactive_added"] or stats["migrated_inactive"] or stats["promoted"]
        )
        if not args.dry_run and active_changed:
            write_csv_atomic(main_path, fields, merged)
            if web_copy:
                web_path = web_copy.resolve()
                web_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(main_path, web_path)
        if not args.dry_run and inactive_changed:
            write_csv_atomic(inactive_path, inactive_fields, inactive)
    except (OSError, ValueError, csv.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    action = "would add" if args.dry_run else "added"
    inactive_action = "would save" if args.dry_run else "saved"
    print(
        f"{action} {stats['added']} active record(s); {inactive_action} "
        f"{stats['inactive_added']} inactive record(s); migrated {stats['migrated_inactive']} legacy "
        f"inactive record(s); promoted {stats['promoted']} completed record(s); "
        f"ignored {stats['duplicate']} active duplicate(s) "
        f"and {stats['inactive_duplicate']} inactive duplicate(s); skipped {stats['conflict']} conflict(s)"
    )
    return 0 if not stats["conflict"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
