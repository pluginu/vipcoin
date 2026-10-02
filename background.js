const VIP_CSV_URL = 'https://pluginu.github.io/vipcoin/web/vip_list.csv';
const REFRESH_MINUTES = 15;
const REFRESH_ALARM = 'refresh-vip-list';
const EXPECTED_HEADER = /^profile_name,pump_handle,pump_profile_url,x_handle,x_url,followers(?:\r?\n|$)/i;

let pendingFetch;

async function reportDownload(stage, detail, received = 0, total = 0) {
  await chrome.storage.local.set({ vipDownloadProgress: { stage, detail, received, total } });
}

async function readDownload(response) {
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let csv = '', received = 0, lastUpdate = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > 20 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('The hosted VIP CSV is larger than 20 MB.');
    }
    csv += decoder.decode(value, { stream: true });
    if (Date.now() - lastUpdate > 150) {
      await reportDownload('downloading', 'Downloading VIP list…', received, total);
      lastUpdate = Date.now();
    }
  }
  csv += decoder.decode();
  await reportDownload('loading', 'Loading downloaded file…', received, total);
  return csv;
}

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
    await reportDownload('downloading', 'Connecting to VIP list server…');
    const response = await fetch(VIP_CSV_URL, {
      headers,
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000)
    });
    const fetchedAt = Date.now();
    if (response.status === 304 && stored.vipCsvCache) {
      await chrome.storage.local.set({ vipCsvFetchedAt: fetchedAt, vipCsvLastError: '' });
      await reportDownload('ready', 'VIP list is up to date.');
      return { ok: true, csv: stored.vipCsvCache, source: 'hosted URL (unchanged)', fetchedAt };
    }
    if (!response.ok) throw new Error(`CSV server returned HTTP ${response.status}.`);
    const csv = await readDownload(response);
    if (csv.length > 20 * 1024 * 1024) throw new Error('The hosted VIP CSV is larger than 20 MB.');
    if (!EXPECTED_HEADER.test(csv)) throw new Error('The hosted file does not have the expected VIP List columns.');
    await chrome.storage.local.set({
      vipCsvCache: csv,
      vipCsvFetchedAt: fetchedAt,
      vipCsvEtag: response.headers.get('etag') || '',
      vipCsvLastModified: response.headers.get('last-modified') || '',
      vipCsvLastError: ''
    });
    await reportDownload('ready', 'VIP list downloaded and saved.');
    return { ok: true, csv, source: 'hosted URL', fetchedAt };
  } catch (error) {
    await chrome.storage.local.set({ vipCsvLastError: error.message });
    if (stored.vipCsvCache) {
      await reportDownload('ready', 'Using saved VIP list.');
      return { ok: true, csv: stored.vipCsvCache, source: 'stale cache', warning: error.message, fetchedAt: stored.vipCsvFetchedAt };
    }
    const bundled = await fetch(chrome.runtime.getURL('vip_list.csv'));
    if (!bundled.ok) {
      await reportDownload('error', error.message);
      throw error;
    }
    await reportDownload('ready', 'Using offline VIP list.');
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
