const $ = id => document.getElementById(id);
const DEFAULTS = { enabled: true, customTerms: [] };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(type, payload = {}) {
  const tab = await activeTab();
  if (!tab?.id || !/^https:\/\/(?:[^/]+\.)?pump\.fun\//i.test(tab.url || '')) {
    return { ok: false, error: 'Open a pump.fun page first.' };
  }
  return await chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

async function render() {
  const stored = await chrome.storage.local.get(['enabled', 'customTerms', 'vipCsvLastError']);
  const settings = { ...DEFAULTS, ...stored };
  $('enabled').checked = settings.enabled;
  $('terms').replaceChildren(...settings.customTerms.map(term => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = term;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove ${term}`;
    remove.onclick = async () => {
      await chrome.storage.local.set({ customTerms: settings.customTerms.filter(x => x !== term) });
    };
    li.append(label, remove);
    return li;
  }));
  $('empty').hidden = settings.customTerms.length > 0;
  const result = await send('VIP_STATUS').catch(() => null);
  $('matches').textContent = result?.matches ?? 0;
  $('vip-count').textContent = result?.vipCount?.toLocaleString?.() ?? '—';
  const warning = stored.vipCsvLastError ? ` Hosted-list warning: ${stored.vipCsvLastError}` : '';
  $('status').textContent = (result?.error || result?.message || (result?.ok ? 'Watching this page for new matches.' : 'Open a pump.fun page first.')) + warning;
}

$('enabled').onchange = async event => chrome.storage.local.set({ enabled: event.target.checked });
$('add-form').onsubmit = async event => {
  event.preventDefault();
  const value = $('term').value.trim().replace(/^@/, '');
  if (!value) return;
  const { customTerms = [] } = await chrome.storage.local.get('customTerms');
  const exists = customTerms.some(x => x.toLocaleLowerCase() === value.toLocaleLowerCase());
  if (!exists) await chrome.storage.local.set({ customTerms: [...customTerms, value].slice(0, 500) });
  $('term').value = '';
};
$('rescan').onclick = async () => { $('status').textContent = 'Rescanning…'; await send('VIP_RESCAN'); setTimeout(render, 250); };
$('refresh-list').onclick = async () => {
  $('status').textContent = 'Refreshing hosted VIP list…';
  const result = await send('VIP_RELOAD', { force: true });
  $('status').textContent = result?.error || 'VIP list refreshed.';
  setTimeout(render, 400);
};
$('csv-file').onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  if (!/^profile_name,pump_handle,pump_profile_url,x_handle,x_url,followers\r?\n/i.test(text)) {
    $('status').textContent = 'That CSV does not have the expected VIP List columns.';
    return;
  }
  await chrome.storage.local.set({ vipCsvCache: text, vipCsvFetchedAt: Date.now(), vipCsvLastError: '' });
  $('status').textContent = 'Local VIP list loaded. Rescanning…';
  await send('VIP_RELOAD', { force: false });
  setTimeout(render, 300);
};

chrome.storage.onChanged.addListener(render);
render();
