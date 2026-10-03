(() => {
  const MAX_INITIAL_TEXT_NODES = 5000;
  const MAX_BATCH_TEXT_NODES = 2000;
  const CARD_SELECTOR = '[data-testid*="token" i], article, li, [class*="card" i], [class*="coin" i]';
  const POST_CONTAINER_SELECTOR = 'article, [data-testid*="post" i], [class*="post" i], [data-testid*="token" i], [class*="card" i], [class*="coin" i], li';
  const SKIP_SELECTOR = 'script,style,noscript,textarea,input,select,option,[contenteditable="true"],[hidden],[aria-hidden="true"]';
  const SEEN_POST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_SEEN_POSTS = 25000;
  const MAX_RECORDED_PROFILES = 10000;
  const MAX_ENRICHMENT_LINKS = 3;
  const PROFILE_PATH = /\/(?:profile|profiles|user|users|u)\/([^/?#]+)/i;
  const ENRICHMENT_WORDS = /\b(?:created|creation|origin|details?|about|joined)\b/i;
  const POST_PATHS = [/\/status\/[^/]+/i, /\/(?:p|reel|reels|tv)\/[^/]+/i, /\/comments\/[^/]+/i, /\/posts\/[^/]+/i, /\/permalink\/[^/]+/i, /\/coin\/[^/]+/i];
  let settings = { enabled: true, customRules: [], trackSeenPosts: false, recordProfiles: false, enrichProfiles: false };
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
  let seenPosts = {};
  let knownSeenPosts = new Set();
  let postContainers = new WeakMap();
  let pendingSeenPosts = {};
  let seenWriteTimer = null;
  let activePagePostId = '';
  let activeProfileUrl = '';
  let profileTimer = null;
  const enrichedThisSession = new Set();
  const sessionPagePosts = new Set();
  let progress = { stage: 'loading', detail: 'Loading VIP list…', percent: null };
  const yieldToPage = () => new Promise(resolve => setTimeout(resolve, 0));
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

  function profileIdentity(value = location.href) {
    try {
      const url = new URL(value, location.href);
      const match = url.pathname.match(PROFILE_PATH);
      if (!match || !/^https?:$/.test(url.protocol)) return null;
      url.search = ''; url.hash = '';
      return { id: `${url.hostname.toLocaleLowerCase()}${url.pathname.replace(/\/$/, '').toLocaleLowerCase()}`, url: url.href.replace(/\/$/, ''), handle: decodeURIComponent(match[1]) };
    } catch { return null; }
  }

  function textOf(selector, root = document) {
    return root.querySelector(selector)?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 500) || '';
  }

  function profileSnapshot(identity) {
    const socialUrls = [...document.querySelectorAll('a[href]')].map(a => a.href).filter(href => /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|instagram\.com|tiktok\.com|youtube\.com)\//i.test(href)).slice(0, 20);
    const title = textOf('h1') || document.querySelector('meta[property="og:title"]')?.content?.trim() || document.title;
    const description = document.querySelector('meta[name="description"]')?.content?.trim() || document.querySelector('meta[property="og:description"]')?.content?.trim() || textOf('[class*="bio" i], [data-testid*="bio" i]');
    return { id: identity.id, url: identity.url, host: location.hostname, handle: identity.handle, title: title.slice(0, 300), description: description.slice(0, 1000), socialUrls: [...new Set(socialUrls)], firstVisitedAt: Date.now(), lastVisitedAt: Date.now(), visits: 1 };
  }

  async function enrichProfile(identity) {
    if (!settings.enrichProfiles || enrichedThisSession.has(identity.id)) return [];
    enrichedThisSession.add(identity.id);
    const links = [...document.querySelectorAll('a[href]')].flatMap(anchor => {
      try {
        const url = new URL(anchor.href, location.href);
        const label = `${anchor.textContent || ''} ${anchor.getAttribute('aria-label') || ''} ${url.pathname}`;
        return url.origin === location.origin && url.href !== identity.url && ENRICHMENT_WORDS.test(label) ? [url.href] : [];
      } catch { return []; }
    });
    const selected = [...new Set(links)].slice(0, MAX_ENRICHMENT_LINKS), details = [];
    for (const url of selected) {
      try {
        const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(8000) });
        if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) continue;
        const html = await response.text();
        if (html.length > 2_000_000) continue;
        const page = new DOMParser().parseFromString(html, 'text/html');
        details.push({ url, title: (page.querySelector('meta[property="og:title"]')?.content || page.title || '').trim().slice(0, 300), description: (page.querySelector('meta[name="description"]')?.content || page.querySelector('meta[property="og:description"]')?.content || '').trim().slice(0, 1000) });
      } catch {}
    }
    return details;
  }

  async function recordCurrentProfile() {
    if (!settings.recordProfiles) return;
    const identity = profileIdentity();
    if (!identity) return;
    const snapshot = profileSnapshot(identity);
    const enrichment = await enrichProfile(identity);
    const { recordedProfiles = {} } = await chrome.storage.local.get('recordedProfiles');
    const previous = recordedProfiles[identity.id];
    recordedProfiles[identity.id] = { ...previous, ...snapshot, firstVisitedAt: previous?.firstVisitedAt || snapshot.firstVisitedAt, visits: (previous?.visits || 0) + (activeProfileUrl === identity.url ? 0 : 1), enrichment: enrichment.length ? enrichment : previous?.enrichment || [], enrichedAt: enrichment.length ? Date.now() : previous?.enrichedAt || null };
    activeProfileUrl = identity.url;
    const bounded = Object.fromEntries(Object.entries(recordedProfiles).sort((a, b) => Number(b[1].lastVisitedAt) - Number(a[1].lastVisitedAt)).slice(0, MAX_RECORDED_PROFILES));
    await chrome.storage.local.set({ recordedProfiles: bounded });
  }

  function scheduleProfileRecord(delay = 700) {
    if (!settings.recordProfiles) return;
    clearTimeout(profileTimer);
    profileTimer = setTimeout(() => recordCurrentProfile().catch(console.error), delay);
  }

  function postIdFromURL(value) {
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol) || !POST_PATHS.some(pattern => pattern.test(url.pathname))) return '';
      return `${url.hostname.toLocaleLowerCase()}${url.pathname.replace(/\/$/, '')}`;
    } catch { return ''; }
  }

  function clearSeenMarks() {
    document.querySelectorAll('[data-vip-coin-seen]').forEach(element => element.removeAttribute('data-vip-coin-seen'));
    document.documentElement.removeAttribute('data-vip-coin-page-seen');
    postContainers = new WeakMap();
  }

  async function flushSeenPosts() {
    const additions = pendingSeenPosts;
    pendingSeenPosts = {};
    const { seenPosts: stored = {} } = await chrome.storage.local.get('seenPosts');
    const cutoff = Date.now() - SEEN_POST_TTL_MS;
    const merged = Object.fromEntries(Object.entries({ ...stored, ...additions })
      .filter(([, timestamp]) => Number(timestamp) >= cutoff)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, MAX_SEEN_POSTS));
    seenPosts = merged;
    await chrome.storage.local.set({ seenPosts: merged });
  }

  function rememberPost(id) {
    if (!id || seenPosts[id] || pendingSeenPosts[id]) return;
    const timestamp = Date.now();
    seenPosts[id] = timestamp;
    pendingSeenPosts[id] = timestamp;
    clearTimeout(seenWriteTimer);
    seenWriteTimer = setTimeout(() => flushSeenPosts().catch(console.error), 250);
  }

  function trackPostAnchor(anchor) {
    if (!settings.trackSeenPosts) return;
    const id = postIdFromURL(anchor.href);
    if (!id) return;
    const container = anchor.closest(POST_CONTAINER_SELECTOR) || anchor;
    const previousId = postContainers.get(container);
    if (previousId === id) return;
    postContainers.set(container, id);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (knownSeenPosts.has(id) || seenPosts[id] || pendingSeenPosts[id]) container.setAttribute('data-vip-coin-seen', '');
    else rememberPost(id);
  }

  function trackCurrentPage() {
    if (!settings.trackSeenPosts) return;
    const id = postIdFromURL(location.href);
    if (id === activePagePostId) return;
    activePagePostId = id;
    if (!id) { document.documentElement.removeAttribute('data-vip-coin-page-seen'); return; }
    if (knownSeenPosts.has(id) || sessionPagePosts.has(id)) document.documentElement.setAttribute('data-vip-coin-page-seen', '');
    else {
      document.documentElement.removeAttribute('data-vip-coin-page-seen');
      sessionPagePosts.add(id);
      rememberPost(id);
    }
  }

  // A character trie rejects non-matching first letters immediately. Matching cost
  // follows the page text, rather than multiplying every node by every VIP record.
  async function makeTrie(terms) {
    let processed = 0;
    const root = new Map();
    for (const term of terms) {
      let node = root;
      for (const char of term) {
        if (!node.has(char)) node.set(char, new Map());
        node = node.get(char);
      }
      node.terminal = true;
      if (++processed % 500 === 0) {
        progress = { stage: 'indexing', detail: `Building search index: ${processed.toLocaleString()} / ${terms.size.toLocaleString()} terms`, percent: 75 + Math.round(processed / terms.size * 24) };
        await yieldToPage();
      }
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

  async function makeVipIndex(csv) {
    progress = { stage: 'loading', detail: 'Reading VIP file…', percent: 50 };
    await yieldToPage();
    const rows = parseCSV(csv);
    const headers = rows.shift()?.map(x => x.trim()) || [];
    const columns = Object.fromEntries(headers.map((name, i) => [name, i]));
    const terms = new Set(), urls = new Set();
    let count = 0;
    progress = { stage: 'indexing', detail: 'Indexing VIP profiles…', percent: 55 };
    await yieldToPage();
    for (const row of rows) {
      if (!row.some(Boolean)) continue;
      count++;
      if (count % 250 === 0) {
        progress = { stage: 'indexing', detail: `Indexing profiles: ${count.toLocaleString()} / ${rows.length.toLocaleString()}`, percent: 55 + Math.round(count / rows.length * 20) };
        await yieldToPage();
      }
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
    return { trie: await makeTrie(terms), urls, count };
  }

  async function loadVip(force = false) {
    progress = { stage: 'loading', detail: 'Loading saved list or waiting for download…', percent: null };
    const remote = await chrome.runtime.sendMessage({ type: 'VIP_FETCH_REMOTE', force });
    if (!remote?.ok) throw new Error(remote?.error || 'Could not load the VIP list.');
    const csv = remote.csv || await fetch(chrome.runtime.getURL('vip_list.csv')).then(r => r.text());
    vip = await makeVipIndex(csv);
    progress = { stage: 'ready', detail: `${vip.count.toLocaleString()} VIP profiles ready`, percent: 100 };
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
    trackPostAnchor(anchor);
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
      if (!settings.enabled) {
        resetHighlights();
        if (!settings.trackSeenPosts) { pendingRoots.clear(); status = { matches: 0, vipCount: vip.count, message: 'VIP Coin is paused.' }; return; }
      }
      const roots = [...pendingRoots]; pendingRoots.clear();
      let scanned = 0, limited = false;
      for (const root of roots) {
        if (!root?.isConnected) continue;
        const remaining = (full ? MAX_INITIAL_TEXT_NODES : MAX_BATCH_TEXT_NODES) - scanned;
        if (remaining <= 0) { limited = true; break; }
        const { texts, anchors } = collect(root, remaining);
        scanned += texts.length;
        if (settings.enabled) texts.forEach(scanTextNode);
        anchors.forEach(scanAnchor);
      }
      status = {
        matches: settings.enabled ? totalMatches : 0,
        vipCount: vip.count,
        message: !settings.enabled ? 'VIP highlighting is paused; seen-post tracking is active.' : limited ? 'Page scanned (large-page batch limit reached).' : 'Watching this page for new matches.'
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
    trackCurrentPage();
    if (profileIdentity()?.url !== activeProfileUrl) scheduleProfileRecord();
    if (!settings.enabled && !settings.trackSeenPosts) return;
    const height = window.innerHeight, width = window.innerWidth;
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= height && rect.right >= 0 && rect.left <= width) pendingRoots.add(card);
    }
    if (pendingRoots.size) schedule(50);
  }

  async function initialize() {
    const stored = await chrome.storage.local.get(['enabled', 'customRules', 'customTerms', 'trackSeenPosts', 'seenPosts', 'recordProfiles', 'enrichProfiles']);
    if (!Array.isArray(stored.customRules) && Array.isArray(stored.customTerms)) {
      stored.customRules = stored.customTerms.map((value, index) => ({ id: `migrated-${index}`, value, mode: 'contains', caseSensitive: false, enabled: true }));
      await chrome.storage.local.set({ customRules: stored.customRules });
      await chrome.storage.local.remove('customTerms');
    }
    settings = { ...settings, ...stored, customRules: stored.customRules || [] };
    const cutoff = Date.now() - SEEN_POST_TTL_MS;
    seenPosts = Object.fromEntries(Object.entries(stored.seenPosts || {}).filter(([, timestamp]) => Number(timestamp) >= cutoff));
    knownSeenPosts = new Set(Object.keys(seenPosts));
    if (typeof settings.enabled !== 'boolean') settings.enabled = true;
    customMatchers = compileCustomRules(settings.customRules);
    await loadVip();
    trackCurrentPage();
    scheduleProfileRecord();
    schedule(0, true);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.customRules) {
      settings.customRules = changes.customRules.newValue || [];
      customMatchers = compileCustomRules(settings.customRules);
    }
    if (changes.trackSeenPosts) {
      settings.trackSeenPosts = changes.trackSeenPosts.newValue === true;
      if (!settings.trackSeenPosts) { activePagePostId = ''; clearSeenMarks(); }
      else { trackCurrentPage(); pendingRoots.add(document.body); }
    }
    if (changes.recordProfiles) {
      settings.recordProfiles = changes.recordProfiles.newValue === true;
      if (!settings.recordProfiles) { clearTimeout(profileTimer); activeProfileUrl = ''; }
      else scheduleProfileRecord(0);
    }
    if (changes.enrichProfiles) {
      settings.enrichProfiles = changes.enrichProfiles.newValue === true;
      const identity = profileIdentity();
      if (settings.enrichProfiles) { if (identity) enrichedThisSession.delete(identity.id); scheduleProfileRecord(0); }
    }
    if (changes.seenPosts) {
      seenPosts = changes.seenPosts.newValue || {};
      knownSeenPosts = new Set([...knownSeenPosts].filter(id => seenPosts[id]));
      if (!Object.keys(seenPosts).length) {
        knownSeenPosts = new Set(); sessionPagePosts.clear(); activePagePostId = '';
        pendingSeenPosts = {}; clearTimeout(seenWriteTimer); clearSeenMarks();
      }
    }
    if (changes.vipCsvCache) loadVip().then(() => schedule(0, true));
    else if (changes.enabled || changes.customRules) schedule(0, true);
    else if (changes.trackSeenPosts && settings.trackSeenPosts) schedule(0);
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'VIP_STATUS') respond({ ok: true, ...status, progress });
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
    scheduleProfileRecord();
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href'] });

  // Virtualized feeds may recycle existing cards without inserting a new subtree.
  // Recheck only viewport cards after scrolling, plus a low-cost periodic safety pass.
  let scrollTimer = 0;
  addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = 0; queueVisibleCards(); }, 120);
  }, { passive: true, capture: true });
  setInterval(queueVisibleCards, 2000);

  initialize().catch(error => { progress = { stage: 'error', detail: error.message, percent: null }; status = { ...status, error: error.message }; });
})();
