const VIP_CSV_URL = 'https://pluginu.github.io/vipcoin/web/vip_list.csv';
const REFRESH_MINUTES = 15;
const REFRESH_ALARM = 'refresh-vip-list';
const EXPECTED_HEADER = /^profile_name,pump_handle,pump_profile_url,x_handle,x_url,followers(?:\r?\n|$)/i;

let pendingFetch;

async function fetchVipList(force = false) {
  const stored = await chrome.storage.local.get([
    'vipCsvCache', 'vipCsvFetchedAt', 'vipCsvEtag', 'vipCsvLastModified'
  ]);
  // Startup and page loads use the persistent copy, regardless of its age.
  // Only scheduled refreshes or an explicit forced reload contact the server.
  if (!force && stored.vipCsvCache) {
    return { ok: true, csv: stored.vipCsvCache, source: 'cache', fetchedAt: stored.vipCsvFetchedAt };
  }

  const headers = {};
  if (stored.vipCsvCache && stored.vipCsvEtag) headers['If-None-Match'] = stored.vipCsvEtag;
  if (stored.vipCsvCache && stored.vipCsvLastModified) headers['If-Modified-Since'] = stored.vipCsvLastModified;

  try {
    const response = await fetch(VIP_CSV_URL, {
      headers,
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000)
    });
    const fetchedAt = Date.now();
    if (response.status === 304 && stored.vipCsvCache) {
      await chrome.storage.local.set({ vipCsvFetchedAt: fetchedAt, vipCsvLastError: '' });
      return { ok: true, csv: stored.vipCsvCache, source: 'hosted URL (unchanged)', fetchedAt };
    }
    if (!response.ok) throw new Error(`CSV server returned HTTP ${response.status}.`);
    const csv = await response.text();
    if (csv.length > 20 * 1024 * 1024) throw new Error('The hosted VIP CSV is larger than 20 MB.');
    if (!EXPECTED_HEADER.test(csv)) throw new Error('The hosted file does not have the expected VIP List columns.');
    await chrome.storage.local.set({
      vipCsvCache: csv,
      vipCsvFetchedAt: fetchedAt,
      vipCsvEtag: response.headers.get('etag') || '',
      vipCsvLastModified: response.headers.get('last-modified') || '',
      vipCsvLastError: ''
    });
    return { ok: true, csv, source: 'hosted URL', fetchedAt };
  } catch (error) {
    await chrome.storage.local.set({ vipCsvLastError: error.message });
    if (stored.vipCsvCache) {
      return { ok: true, csv: stored.vipCsvCache, source: 'stale cache', warning: error.message, fetchedAt: stored.vipCsvFetchedAt };
    }
    const bundled = await fetch(chrome.runtime.getURL('vip_list.csv'));
    if (!bundled.ok) throw error;
    return { ok: true, csv: await bundled.text(), source: 'bundled file', warning: error.message };
  }
}

function loadVipList(force = false) {
  if (!pendingFetch) pendingFetch = fetchVipList(force).finally(() => { pendingFetch = null; });
  return pendingFetch;
}

async function initialize() {
  if (!await chrome.alarms.get(REFRESH_ALARM)) {
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  }
  await loadVipList();
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM) loadVipList(true).catch(console.error);
});
chrome.runtime.onInstalled.addListener(() => initialize().catch(console.error));
chrome.runtime.onStartup.addListener(() => initialize().catch(console.error));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'VIP_FETCH_REMOTE') return;
  loadVipList(message.force === true)
    .then(respond)
    .catch(error => respond({ ok: false, error: error.message }));
  return true;
});
