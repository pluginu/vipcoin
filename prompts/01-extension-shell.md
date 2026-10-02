# Prompt 01 — Extension shell

Using `00-product-contract.md`, create the smallest functional Chrome Manifest V3 extension shell.

Implement `manifest.json`, a service-worker stub, content-script stub, popup HTML/CSS/JS, a valid bundled `vip_list.csv` containing the exact header plus 2–3 synthetic rows, and independently created placeholder icons in all required sizes. Do not use third-party dependencies or remote assets.

At this stage:

- The extension must load unpacked without errors.
- The popup must have the final major sections and a polished dark/green visual baseline, but controls may report that later stages are not implemented.
- The content script must respond to a `VIP_STATUS` runtime message with a safe placeholder object.
- The popup must handle HTTP/HTTPS tabs, protected tabs, and a missing content script without throwing.
- Put all extension-page JavaScript in external files; do not use inline handlers.
- Add a short README section explaining how to load the unpacked extension.

Run syntax/JSON checks available locally. Then report changed files, checks actually run, and manual Chrome checks still required. Stop after the shell is sound.
