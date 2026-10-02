const EXPECTED_HEADER = /^profile_name,pump_handle,pump_profile_url,x_handle,x_url,followers(?:\r?\n|$)/i;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'VIP_FETCH_REMOTE') return;
  (async () => {
    const stored = await chrome.storage.local.get(['vipCsvUrl', 'vipCsvCache', 'vipCsvFetchedAt']);
    const url = stored.vipCsvUrl || '';
    if (!url) return { ok: true, csv: stored.vipCsvCache || '', source: stored.vipCsvCache ? 'local cache' : 'bundled file' };
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('The VIP CSV URL is invalid.'); }
    if (parsed.protocol !== 'https:') throw new Error('The VIP CSV URL must use HTTPS.');
    const fresh = stored.vipCsvCache && Date.now() - Number(stored.vipCsvFetchedAt || 0) < 15 * 60 * 1000;
    if (!message.force && fresh) return { ok: true, csv: stored.vipCsvCache, source: 'cache', fetchedAt: stored.vipCsvFetchedAt };
    try {
      const response = await fetch(parsed.href, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error(`CSV server returned HTTP ${response.status}.`);
      const csv = await response.text();
      if (!EXPECTED_HEADER.test(csv)) throw new Error('The hosted file does not have the expected VIP List columns.');
      if (csv.length > 20 * 1024 * 1024) throw new Error('The hosted VIP CSV is larger than 20 MB.');
      const fetchedAt = Date.now();
      await chrome.storage.local.set({ vipCsvCache: csv, vipCsvFetchedAt: fetchedAt, vipCsvLastError: '' });
      return { ok: true, csv, source: 'hosted URL', fetchedAt };
    } catch (error) {
      await chrome.storage.local.set({ vipCsvLastError: error.message });
      if (stored.vipCsvCache) return { ok: true, csv: stored.vipCsvCache, source: 'stale cache', warning: error.message, fetchedAt: stored.vipCsvFetchedAt };
      throw error;
    }
  })().then(respond).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
