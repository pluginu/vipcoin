const $ = id => document.getElementById(id);
const DEFAULTS = { enabled: true, customRules: [], trackSeenPosts: false, recordProfiles: false, enrichProfiles: false };
const SEEN_POST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HINTS = {
  exact: 'Matches a whole word or phrase: “Ann” will not match “Anna”.',
  contains: 'Matches anywhere in text: “ann” also matches “Joanna”.',
  starts: 'Matches at the start of a word: “Ang” matches “Angela”.',
  ends: 'Matches at the end of a word: “ley” matches “Riley”.',
  regex: 'JavaScript expression without / delimiters. Unicode and global matching are automatic.'
};
let settings = DEFAULTS;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(type, payload = {}) {
  const tab = await activeTab();
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) return { ok: false, error: 'Open a website to use VIP Coin. Browser internal pages are not supported.' };
  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function validateRule(rule) {
  if (!['exact', 'contains', 'starts', 'ends', 'regex'].includes(rule.mode)) throw new Error('Choose a valid match type.');
  if (!rule.value) throw new Error('Enter a keyword or expression.');
  if (rule.value.length > 500) throw new Error('Rules must be 500 characters or fewer.');
  let source = rule.mode === 'regex' ? rule.value : escapeRegex(rule.value).replace(/\s+/g, '\\s+');
  if (['exact', 'starts'].includes(rule.mode)) source = `(?<![\\p{L}\\p{N}_])${source}`;
  if (['exact', 'ends'].includes(rule.mode)) source += `(?![\\p{L}\\p{N}_])`;
  new RegExp(source, rule.caseSensitive ? 'gu' : 'giu');
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['enabled', 'customRules', 'customTerms', 'trackSeenPosts', 'recordProfiles', 'enrichProfiles']);
  if (!Array.isArray(stored.customRules) && Array.isArray(stored.customTerms)) {
    stored.customRules = stored.customTerms.map(value => ({ id: crypto.randomUUID(), value, mode: 'contains', caseSensitive: false, enabled: true }));
    await chrome.storage.local.set({ customRules: stored.customRules });
    await chrome.storage.local.remove('customTerms');
  }
  settings = { ...DEFAULTS, ...stored, customRules: stored.customRules || [] };
}

async function renderProfiles() {
  const { recordedProfiles = {} } = await chrome.storage.local.get('recordedProfiles');
  $('record-profiles').checked = settings.recordProfiles;
  $('enrich-profiles').checked = settings.enrichProfiles;
  $('enrich-profiles').disabled = !settings.recordProfiles;
  document.querySelector('.sub-setting').classList.toggle('disabled', !settings.recordProfiles);
  $('profile-count').textContent = Object.keys(recordedProfiles).length.toLocaleString();
}

async function renderSeenPosts() {
  const { seenPosts = {} } = await chrome.storage.local.get('seenPosts');
  const cutoff = Date.now() - SEEN_POST_TTL_MS;
  $('track-seen-posts').checked = settings.trackSeenPosts;
  $('seen-count').textContent = Object.values(seenPosts).filter(timestamp => Number(timestamp) >= cutoff).length.toLocaleString();
}

function renderRules() {
  $('enabled').checked = settings.enabled;
  $('rule-count').textContent = settings.customRules.length;
  $('empty').hidden = settings.customRules.length > 0;
  $('rules').replaceChildren(...settings.customRules.map(rule => {
    const li = document.createElement('li');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox'; toggle.checked = rule.enabled !== false; toggle.title = `Enable ${rule.value}`;
    toggle.onchange = async () => { rule.enabled = toggle.checked; await chrome.storage.local.set({ customRules: settings.customRules }); };
    const text = document.createElement('span');
    const value = document.createElement('strong'); value.textContent = rule.value;
    const detail = document.createElement('small'); detail.textContent = `${rule.mode}${rule.caseSensitive ? ' · case sensitive' : ''}`;
    text.append(value, detail);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '×'; remove.title = `Remove ${rule.value}`;
    remove.onclick = async () => {
      settings.customRules = settings.customRules.filter(item => item.id !== rule.id);
      await chrome.storage.local.set({ customRules: settings.customRules }); renderRules();
    };
    li.append(toggle, text, remove);
    return li;
  }));
}

function renderProgress(download, page) {
  const current = ['downloading', 'loading', 'error'].includes(download?.stage) ? download : page || download;
  if (!current) return;
  const stages = ['downloading', 'loading', 'indexing', 'ready'];
  const step = stages.indexOf(current.stage);
  let percent = current.percent;
  let value = percent == null ? '' : `${percent}%`;
  if (current.stage === 'downloading') {
    percent = current.total > 0 ? Math.min(49, current.received / current.total * 49) : null;
    value = current.received ? `${(current.received / 1024).toFixed(0)} KB${current.total ? ` / ${(current.total / 1024).toFixed(0)} KB` : ''}` : '';
  }
  if (current.stage === 'ready') percent = 100;
  $('progress-label').textContent = current.detail;
  $('progress-value').textContent = value;
  if (percent == null) $('load-progress').removeAttribute('value');
  else $('load-progress').value = percent;
  document.querySelector('.load-progress').classList.toggle('failed', current.stage === 'error');
  document.querySelectorAll('[data-step]').forEach((element, index) => {
    element.classList.toggle('active', index === step);
    element.classList.toggle('complete', index < step);
  });
}

async function renderStatus() {
  const stored = await chrome.storage.local.get(['vipCsvLastError', 'vipDownloadProgress']);
  const result = await send('VIP_STATUS').catch(() => null);
  renderProgress(stored.vipDownloadProgress, result?.progress);
  $('matches').textContent = result?.matches ?? 0;
  $('vip-count').textContent = result?.vipCount?.toLocaleString?.() ?? '—';
  const warning = stored.vipCsvLastError ? ` Hosted-list warning: ${stored.vipCsvLastError}` : '';
  $('status').textContent = (!settings.enabled ? 'VIP Coin is paused. Turn on the toggle to resume.' : result?.error || result?.message || (result?.ok ? 'Watching this page for new matches.' : 'Refresh this page after installing and turning on the extension.')) + warning;
}

function showHint() { $('match-hint').textContent = HINTS[$('mode').value]; }

$('enabled').onchange = async event => { settings.enabled = event.target.checked; await chrome.storage.local.set({ enabled: settings.enabled }); };
$('track-seen-posts').onchange = async event => {
  settings.trackSeenPosts = event.target.checked;
  await chrome.storage.local.set({ trackSeenPosts: settings.trackSeenPosts });
};
$('record-profiles').onchange = async event => {
  settings.recordProfiles = event.target.checked;
  if (!settings.recordProfiles) settings.enrichProfiles = false;
  await chrome.storage.local.set({ recordProfiles: settings.recordProfiles, enrichProfiles: settings.enrichProfiles });
  renderProfiles();
};
$('enrich-profiles').onchange = async event => {
  settings.enrichProfiles = settings.recordProfiles && event.target.checked;
  await chrome.storage.local.set({ enrichProfiles: settings.enrichProfiles });
};
$('clear-profiles').onclick = async () => {
  await chrome.storage.local.set({ recordedProfiles: {} });
  await renderProfiles();
};
$('clear-seen').onclick = async () => {
  await chrome.storage.local.set({ seenPosts: {} });
  await renderSeenPosts();
};
$('mode').onchange = showHint;
$('rule-form').onsubmit = async event => {
  event.preventDefault(); $('rule-error').textContent = '';
  try {
    const rule = { id: crypto.randomUUID(), value: $('term').value.trim(), mode: $('mode').value, caseSensitive: $('case-sensitive').checked, enabled: true };
    validateRule(rule);
    if (settings.customRules.length >= 100) throw new Error('You can save up to 100 custom rules.');
    settings.customRules.push(rule);
    await chrome.storage.local.set({ customRules: settings.customRules });
    $('term').value = ''; renderRules();
  } catch (error) { $('rule-error').textContent = error.message; }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled) settings.enabled = changes.enabled.newValue;
  if (changes.customRules) settings.customRules = changes.customRules.newValue || [];
  if (changes.trackSeenPosts) settings.trackSeenPosts = changes.trackSeenPosts.newValue === true;
  if (changes.recordProfiles) settings.recordProfiles = changes.recordProfiles.newValue === true;
  if (changes.enrichProfiles) settings.enrichProfiles = changes.enrichProfiles.newValue === true;
  renderRules(); renderSeenPosts(); renderProfiles(); renderStatus();
});

loadSettings().then(() => {
  renderRules(); renderSeenPosts(); renderProfiles(); showHint(); renderStatus(); setInterval(renderStatus, 250);
}).catch(error => { $('rule-error').textContent = error.message; });
