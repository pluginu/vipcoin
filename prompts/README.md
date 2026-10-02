# Rebuild VIP Coin from prompts

This folder is a clean-room, sequential specification for rebuilding VIP Coin without trusting or reusing the existing implementation. Give the prompts to a capable coding agent **in numeric order**. Each prompt assumes the files produced by earlier prompts are present.

## How to use the sequence

1. Start in a new, empty Git repository.
2. Copy `00-product-contract.md` into the agent's context. It is the authoritative product contract and should remain in context for every later step.
3. Run prompts `01` through `08` in order. Use a fresh agent/session if desired, but always provide the product contract and current repository.
4. Do not advance when a prompt's acceptance checks fail. Ask the agent to fix the current stage first.
5. Use placeholder branding or independently created artwork if you want a legally and visually independent implementation.

The prompts deliberately specify behavior and interfaces, not source code. A rebuild should not need any file from the original repository. The one unavoidable input is a CSV dataset conforming to the schema below; a tiny synthetic fixture is enough during development.

## Sequence

| Prompt | Deliverable |
| --- | --- |
| `00-product-contract.md` | Shared requirements, architecture, schemas, and constraints |
| `01-extension-shell.md` | Loadable MV3 extension and basic popup |
| `02-dataset-cache.md` | Remote CSV download, validation, cache, fallback, and refresh |
| `03-page-scanner.md` | Efficient DOM text/URL matching and live-page rescanning |
| `04-popup-and-rules.md` | Full popup, custom rules, status, and progress UI |
| `05-seen-post-protection.md` | Seven-day duplicate-post tracking and warnings |
| `06-dataset-maintenance.md` | Safe Python merge utility and unit tests |
| `07-site-docs-and-assets.md` | Static project page, icons, and operator documentation |
| `08-final-verification.md` | Security, privacy, performance, and functional audit |

## CSV contract

The active dataset must use this exact header order:

```csv
profile_name,pump_handle,pump_profile_url,x_handle,x_url,followers
```

Only active records with an X identity belong in the downloadable runtime list. Incomplete records belong in a separate local maintenance file and must never inflate the extension's production index.

## Suggested agent preamble

Prepend this to prompts `01` through `08`:

> Work only from the product contract and the current repository. Do not search for, copy, or inspect the original VIP Coin implementation. Preserve completed behavior from earlier stages. Make the requested changes, run the stated checks, and report changed files, checks run, and any remaining limitation. Do not claim a check passed unless you executed it.
