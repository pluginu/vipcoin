(() => {
  const MAX_INITIAL_TEXT_NODES = 5000;
  const MAX_BATCH_TEXT_NODES = 2000;
  const CARD_SELECTOR = '[data-testid*="token" i], article, li, [class*="card" i], [class*="coin" i]';
  const SKIP_SELECTOR = 'script,style,noscript,textarea,input,select,option,[contenteditable="true"],[hidden],[aria-hidden="true"]';
  let settings = { enabled: true, customRules: [] };
  let vip = { trie: new Map(), urls: new Set(), count: 0 };
  let customMatchers = [];
  let vipHighlight = new Highlight();
  let customHighlight = new Highlight();
  let nodeMatches = new WeakMap();
  let anchorMatches = new WeakMap();
  let containerCounts = new WeakMap();
  let pendingRoots = new Set();
  let timer = null;
  let scanning = false;
  let scanAgain = false;
  let totalMatches = 0;
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

  // A character trie rejects non-matching first letters immediately. Matching cost
  // follows the page text, rather than multiplying every node by every VIP record.
  function makeTrie(terms) {
    const root = new Map();
    for (const term of terms) {
      let node = root;
      for (const char of term) {
        if (!node.has(char)) node.set(char, new Map());
        node = node.get(char);
      }
      node.terminal = true;
    }
    return root;
  }

  function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function compileCustomRules(rules) {
    return rules.filter(rule => rule?.enabled !== false && rule?.value).flatMap(rule => {
      try {
        let source = rule.mode === 'regex' ? rule.value : escapeRegex(rule.value.trim()).replace(/\s+/g, '\\s+');
        if (['exact', 'starts'].includes(rule.mode)) source = `(?<![\\p{L}\\p{N}_])${source}`;
        if (['exact', 'ends'].includes(rule.mode)) source += `(?![\\p{L}\\p{N}_])`;
        return [new RegExp(source, rule.caseSensitive ? 'gu' : 'giu')];
      } catch { return []; }
    });
  }

  function makeVipIndex(csv) {
    const rows = parseCSV(csv);
    const headers = rows.shift()?.map(x => x.trim()) || [];
    const columns = Object.fromEntries(headers.map((name, i) => [name, i]));
    const terms = new Set(), urls = new Set();
    let count = 0;
    for (const row of rows) {
      if (!row.some(Boolean)) continue;
      count++;
      for (const field of ['profile_name', 'pump_handle', 'x_handle']) {
        const term = normalize(row[columns[field]]);
        if (term.length >= 3) terms.add(term);
      }
      for (const field of ['pump_profile_url', 'x_url']) {
        const value = row[columns[field]]?.trim();
        if (!value) continue;
        try {
          const url = new URL(value);
          urls.add((url.origin + url.pathname).toLocaleLowerCase().replace(/\/$/, ''));
          const handle = normalize(url.pathname.split('/').filter(Boolean).pop());
          if (handle.length >= 3) terms.add(handle);
        } catch {}
      }
    }
    return { trie: makeTrie(terms), urls, count };
  }

  async function loadVip(force = false) {
    const remote = await chrome.runtime.sendMessage({ type: 'VIP_FETCH_REMOTE', force });
    if (!remote?.ok) throw new Error(remote?.error || 'Could not load the VIP list.');
    const csv = remote.csv || await fetch(chrome.runtime.getURL('vip_list.csv')).then(r => r.text());
    vip = makeVipIndex(csv);
    status.vipCount = vip.count;
    status.message = remote.warning ? `Using cached VIP list: ${remote.warning}` : `VIP list loaded from ${remote.source}.`;
  }

  function boundary(char) { return !char || !/[\p{L}\p{N}_]/u.test(char); }

  function rangesFor(text, trie, exactBoundary) {
    const lower = text.toLocaleLowerCase(), ranges = [];
    for (let start = 0; start < lower.length && ranges.length < 100; start++) {
      let node = trie.get(lower[start]);
      if (!node || (exactBoundary && !boundary(lower[start - 1]))) continue;
      let end = start + 1;
      while (node) {
        if (node.terminal && (!exactBoundary || boundary(lower[end]))) ranges.push([start, end]);
        node = end < lower.length ? node.get(lower[end]) : null;
        end++;
      }
    }
    return ranges;
  }

  function customRangesFor(text) {
    const ranges = [];
    for (const regex of customMatchers) {
      regex.lastIndex = 0;
      let match;
      while (ranges.length < 100 && (match = regex.exec(text))) {
        if (!match[0].length) { regex.lastIndex += text.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1; continue; }
        ranges.push([match.index, match.index + match[0].length]);
      }
      if (ranges.length >= 100) break;
    }
    return ranges;
  }

  function matchContainer(element, delta) {
    const card = element?.closest?.(CARD_SELECTOR) || element?.closest?.('a')?.parentElement;
    if (!card || card === document.body || card === document.documentElement) return null;
    const count = Math.max(0, (containerCounts.get(card) || 0) + delta);
    containerCounts.set(card, count);
    if (count) {
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.setAttribute('data-vip-coin-match', '');
    } else card.removeAttribute('data-vip-coin-match');
    return card;
  }

  function forgetTextNode(textNode) {
    const old = nodeMatches.get(textNode);
    if (!old) return;
    old.vip.forEach(range => vipHighlight.delete(range));
    old.custom.forEach(range => customHighlight.delete(range));
    if (old.container) matchContainer(old.container, -1);
    totalMatches = Math.max(0, totalMatches - old.count);
    nodeMatches.delete(textNode);
  }

  function scanTextNode(textNode) {
    forgetTextNode(textNode);
    const parent = textNode.parentElement;
    const text = textNode.textContent;
    if (!parent || !text.trim() || text.length > 4000 || parent.closest(SKIP_SELECTOR)) return;
    const listRanges = rangesFor(text, vip.trie, true);
    const ownRanges = customRangesFor(text);
    const vipRanges = [], customRanges = [];
    for (const [start, end] of listRanges) {
      const range = new Range(); range.setStart(textNode, start); range.setEnd(textNode, end);
      vipHighlight.add(range); vipRanges.push(range);
    }
    for (const [start, end] of ownRanges) {
      const range = new Range(); range.setStart(textNode, start); range.setEnd(textNode, end);
      customHighlight.add(range); customRanges.push(range);
    }
    const count = vipRanges.length + customRanges.length;
    const container = vipRanges.length ? matchContainer(parent, 1) : null;
    nodeMatches.set(textNode, { vip: vipRanges, custom: customRanges, count, container });
    totalMatches += count;
  }

  function scanAnchor(anchor) {
    const old = anchorMatches.get(anchor);
    if (old) { matchContainer(old, -1); totalMatches = Math.max(0, totalMatches - 1); anchorMatches.delete(anchor); }
    let url;
    try { const parsed = new URL(anchor.href); url = (parsed.origin + parsed.pathname).toLocaleLowerCase().replace(/\/$/, ''); }
    catch { return; }
    if (vip.urls.has(url)) {
      const container = matchContainer(anchor, 1);
      if (container) { anchorMatches.set(anchor, container); totalMatches++; }
    }
  }

  function collect(root, limit) {
    const texts = [], anchors = [];
    if (root.nodeType === Node.TEXT_NODE) texts.push(root);
    else if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_NODE) {
      if (root.matches?.('a[href]')) anchors.push(root);
      root.querySelectorAll?.('a[href]').forEach(anchor => anchors.push(anchor));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while (texts.length < limit && (node = walker.nextNode())) texts.push(node);
    }
    return { texts, anchors };
  }

  function resetHighlights() {
    document.querySelectorAll('[data-vip-coin-match]').forEach(el => el.removeAttribute('data-vip-coin-match'));
    vipHighlight = new Highlight(); customHighlight = new Highlight();
    CSS.highlights.set('vip-coin-list-match', vipHighlight);
    CSS.highlights.set('vip-coin-custom-match', customHighlight);
    nodeMatches = new WeakMap(); anchorMatches = new WeakMap(); containerCounts = new WeakMap();
    totalMatches = 0;
  }

  async function scan(full = false) {
    if (scanning) { scanAgain = true; return; }
    scanning = true; scanAgain = false;
    try {
      if (full) { resetHighlights(); pendingRoots = new Set([document.body]); }
      if (!settings.enabled) { resetHighlights(); pendingRoots.clear(); status = { matches: 0, vipCount: vip.count, message: 'Highlighting is paused.' }; return; }
      const roots = [...pendingRoots]; pendingRoots.clear();
      let scanned = 0, limited = false;
      for (const root of roots) {
        if (!root?.isConnected) continue;
        const remaining = (full ? MAX_INITIAL_TEXT_NODES : MAX_BATCH_TEXT_NODES) - scanned;
        if (remaining <= 0) { limited = true; break; }
        const { texts, anchors } = collect(root, remaining);
        scanned += texts.length;
        texts.forEach(scanTextNode); anchors.forEach(scanAnchor);
      }
      status = {
        matches: totalMatches,
        vipCount: vip.count,
        message: limited ? 'Page scanned (large-page batch limit reached).' : 'Watching this page for new matches.'
      };
    } catch (error) {
      status = { ...status, error: error.message };
    } finally {
      scanning = false;
      if (scanAgain || pendingRoots.size) schedule(50);
    }
  }

  function schedule(delay = 100, full = false) {
    clearTimeout(timer);
    timer = setTimeout(() => scan(full), delay);
  }

  function queueVisibleCards() {
    if (!settings.enabled) return;
    const height = window.innerHeight, width = window.innerWidth;
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= height && rect.right >= 0 && rect.left <= width) pendingRoots.add(card);
    }
    if (pendingRoots.size) schedule(50);
  }

  async function initialize() {
    const stored = await chrome.storage.local.get(['enabled', 'customRules', 'customTerms']);
    if (!Array.isArray(stored.customRules) && Array.isArray(stored.customTerms)) {
      stored.customRules = stored.customTerms.map((value, index) => ({ id: `migrated-${index}`, value, mode: 'contains', caseSensitive: false, enabled: true }));
      await chrome.storage.local.set({ customRules: stored.customRules });
      await chrome.storage.local.remove('customTerms');
    }
    settings = { ...settings, ...stored, customRules: stored.customRules || [] };
    if (typeof settings.enabled !== 'boolean') settings.enabled = true;
    customMatchers = compileCustomRules(settings.customRules);
    await loadVip();
    schedule(0, true);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.customRules) {
      settings.customRules = changes.customRules.newValue || [];
      customMatchers = compileCustomRules(settings.customRules);
    }
    if (changes.vipCsvCache) loadVip().then(() => schedule(0, true));
    else if (changes.enabled || changes.customRules) schedule(0, true);
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'VIP_STATUS') respond({ ok: true, ...status });
    else if (message.type === 'VIP_RELOAD') {
      loadVip(message.force === true).then(() => {
        schedule(0, true); respond({ ok: true, source: 'hosted URL' });
      }).catch(error => respond({ ok: false, error: error.message }));
      return true;
    }
  });

  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') pendingRoots.add(mutation.target);
      else if (mutation.type === 'attributes') pendingRoots.add(mutation.target);
      else mutation.addedNodes.forEach(node => pendingRoots.add(node));
    }
    if (pendingRoots.size) schedule();
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href'] });

  // Virtualized feeds may recycle existing cards without inserting a new subtree.
  // Recheck only viewport cards after scrolling, plus a low-cost periodic safety pass.
  let scrollTimer = 0;
  addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = 0; queueVisibleCards(); }, 120);
  }, { passive: true, capture: true });
  setInterval(queueVisibleCards, 2000);

  initialize().catch(error => { status = { ...status, error: error.message }; });
})();
