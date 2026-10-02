(() => {
  const MAX_TEXT_NODES = 5000;
  const CARD_SELECTOR = '[data-testid*="token" i], article, li, [class*="card" i], [class*="coin" i]';
  let settings = { enabled: true, customTerms: [] };
  let vip = { terms: [], urls: new Set(), count: 0 };
  let timer = null;
  let scanning = false;
  let scanAgain = false;
  let status = { matches: 0, vipCount: 0, message: 'Loading VIP list…' };

  function parseCSV(text) {
    const rows = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(value); value = ''; }
      else if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
      else value += char;
    }
    if (value || row.length) { row.push(value); rows.push(row); }
    return rows;
  }

  function normalize(value) {
    return String(value || '').trim().replace(/^@/, '').toLocaleLowerCase();
  }

  function makeVipIndex(csv) {
    const rows = parseCSV(csv);
    const headers = rows.shift()?.map(x => x.trim()) || [];
    const index = Object.fromEntries(headers.map((name, i) => [name, i]));
    const terms = new Set(), urls = new Set();
    let count = 0;
    for (const row of rows) {
      if (!row.some(Boolean)) continue;
      count++;
      for (const field of ['profile_name', 'pump_handle', 'x_handle']) {
        const term = normalize(row[index[field]]);
        if (term.length >= 3) terms.add(term);
      }
      for (const field of ['pump_profile_url', 'x_url']) {
        const value = row[index[field]]?.trim();
        if (!value) continue;
        try {
          const url = new URL(value);
          urls.add((url.origin + url.pathname).toLocaleLowerCase().replace(/\/$/, ''));
          const last = normalize(url.pathname.split('/').filter(Boolean).pop());
          if (last.length >= 3) terms.add(last);
        } catch {}
      }
    }
    return { terms: [...terms].sort((a, b) => b.length - a.length), urls, count };
  }

  async function loadVip() {
    const remote = await chrome.runtime.sendMessage({ type: 'VIP_FETCH_REMOTE', force: false });
    if (!remote?.ok) throw new Error(remote?.error || 'Could not load the VIP list.');
    const csv = remote.csv || await fetch(chrome.runtime.getURL('vip_list.csv')).then(r => r.text());
    vip = makeVipIndex(csv);
    status.vipCount = vip.count;
    status.message = remote.warning ? `Using cached VIP list: ${remote.warning}` : `VIP list loaded from ${remote.source}.`;
  }

  function boundary(char) { return !char || !/[\p{L}\p{N}_]/u.test(char); }
  function rangesFor(text, terms, exactBoundary) {
    const lower = text.toLocaleLowerCase(), ranges = [];
    for (const term of terms) {
      if (!term) continue;
      let from = 0, at;
      while ((at = lower.indexOf(term, from)) !== -1) {
        const end = at + term.length;
        if (!exactBoundary || (boundary(lower[at - 1]) && boundary(lower[end]))) ranges.push([at, end]);
        from = at + Math.max(1, term.length);
        if (ranges.length > 100) return ranges;
      }
    }
    return ranges;
  }

  function clear() {
    CSS.highlights?.delete('vip-coin-list-match');
    CSS.highlights?.delete('vip-coin-custom-match');
    document.querySelectorAll('[data-vip-coin-match]').forEach(el => el.removeAttribute('data-vip-coin-match'));
  }

  function markContainer(element) {
    const card = element.closest(CARD_SELECTOR) || element.closest('a')?.parentElement;
    if (!card || card === document.body || card === document.documentElement) return;
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.setAttribute('data-vip-coin-match', '');
  }

  async function scan() {
    if (scanning) { scanAgain = true; return; }
    scanning = true; scanAgain = false;
    try {
      clear();
      if (!settings.enabled) { status = { matches: 0, vipCount: vip.count, message: 'Highlighting is paused.' }; return; }
      const vipHighlight = new Highlight(), customHighlight = new Highlight();
      const nodes = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || !node.textContent.trim() || node.textContent.length > 4000 || parent.closest('script,style,noscript,textarea,input,select,option,[contenteditable="true"],[hidden],[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while (nodes.length < MAX_TEXT_NODES && (node = walker.nextNode())) nodes.push(node);
      let matches = 0;
      for (const textNode of nodes) {
        const listRanges = rangesFor(textNode.textContent, vip.terms, true);
        const customRanges = rangesFor(textNode.textContent, settings.customTerms.map(normalize).filter(Boolean), false);
        for (const [start, end] of listRanges) {
          const range = new Range(); range.setStart(textNode, start); range.setEnd(textNode, end); vipHighlight.add(range); matches++;
          markContainer(textNode.parentElement);
        }
        for (const [start, end] of customRanges) {
          const range = new Range(); range.setStart(textNode, start); range.setEnd(textNode, end); customHighlight.add(range); matches++;
        }
      }
      for (const anchor of document.querySelectorAll('a[href]')) {
        let url; try { const u = new URL(anchor.href); url = (u.origin + u.pathname).toLocaleLowerCase().replace(/\/$/, ''); } catch { continue; }
        if (vip.urls.has(url)) { markContainer(anchor); matches++; }
      }
      CSS.highlights?.set('vip-coin-list-match', vipHighlight);
      CSS.highlights?.set('vip-coin-custom-match', customHighlight);
      status = { matches, vipCount: vip.count, message: nodes.length === MAX_TEXT_NODES ? 'Page scanned (large-page limit reached).' : 'Watching this page for new matches.' };
    } catch (error) {
      status = { ...status, error: error.message };
    } finally {
      scanning = false;
      if (scanAgain) schedule(100);
    }
  }

  function schedule(delay = 350) { clearTimeout(timer); timer = setTimeout(scan, delay); }
  async function initialize() {
    settings = { ...settings, ...await chrome.storage.local.get(['enabled', 'customTerms']) };
    if (typeof settings.enabled !== 'boolean') settings.enabled = true;
    if (!Array.isArray(settings.customTerms)) settings.customTerms = [];
    await loadVip();
    schedule(0);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.customTerms) settings.customTerms = changes.customTerms.newValue || [];
    if (changes.vipCsvUrl || changes.vipCsvCache) loadVip().then(() => schedule(0)); else schedule(0);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'VIP_STATUS') respond({ ok: true, ...status });
    else if (message.type === 'VIP_RESCAN') { schedule(0); respond({ ok: true }); }
    else if (message.type === 'VIP_RELOAD') {
      chrome.runtime.sendMessage({ type: 'VIP_FETCH_REMOTE', force: message.force === true }).then(async remote => {
        if (!remote?.ok) throw new Error(remote?.error || 'Could not refresh the VIP list.');
        const csv = remote.csv || await fetch(chrome.runtime.getURL('vip_list.csv')).then(r => r.text());
        vip = makeVipIndex(csv); status.vipCount = vip.count; schedule(0);
        respond({ ok: true, source: remote.source, warning: remote.warning });
      }).catch(error => respond({ ok: false, error: error.message }));
      return true;
    }
  });
  new MutationObserver(() => schedule()).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  initialize();
})();
