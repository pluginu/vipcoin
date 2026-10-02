const $ = id => document.getElementById(id);
const DEFAULTS = { enabled: true, customRules: [] };
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
  if (!tab?.id || !/^https:\/\/(?:[^/]+\.)?pump\.fun\//i.test(tab.url || '')) return { ok: false, error: 'Open a pump.fun page first.' };
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
  const stored = await chrome.storage.local.get(['enabled', 'customRules', 'customTerms']);
  if (!Array.isArray(stored.customRules) && Array.isArray(stored.customTerms)) {
    stored.customRules = stored.customTerms.map(value => ({ id: crypto.randomUUID(), value, mode: 'contains', caseSensitive: false, enabled: true }));
    await chrome.storage.local.set({ customRules: stored.customRules });
    await chrome.storage.local.remove('customTerms');
  }
  settings = { ...DEFAULTS, ...stored, customRules: stored.customRules || [] };
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

async function renderStatus() {
  const stored = await chrome.storage.local.get('vipCsvLastError');
  const result = await send('VIP_STATUS').catch(() => null);
  $('matches').textContent = result?.matches ?? 0;
  $('vip-count').textContent = result?.vipCount?.toLocaleString?.() ?? '—';
  const warning = stored.vipCsvLastError ? ` Hosted-list warning: ${stored.vipCsvLastError}` : '';
  $('status').textContent = (result?.error || result?.message || (result?.ok ? 'Watching the live timeline.' : 'Open a pump.fun page first.')) + warning;
}

function showHint() { $('match-hint').textContent = HINTS[$('mode').value]; }

$('enabled').onchange = async event => { settings.enabled = event.target.checked; await chrome.storage.local.set({ enabled: settings.enabled }); };
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
  renderRules(); renderStatus();
});

loadSettings().then(() => {
  renderRules(); showHint(); renderStatus(); setInterval(renderStatus, 1200);
}).catch(error => { $('rule-error').textContent = error.message; });
