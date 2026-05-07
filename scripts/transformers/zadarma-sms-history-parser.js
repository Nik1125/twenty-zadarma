// Zadarma cabinet → SMS history JSON dump (browser console script).
//
// Zadarma's `/v1/sms/get/` API doesn't return historical messages — only
// allows sending. The cabinet UI hits an internal endpoint
// `/sms/history/get` that returns the same shape we want, paginated. This
// script paginates through it and downloads `zadarma_sms_<DATE>.json` ready
// to feed into `zadarma-sms-json.mjs`.
//
// How to run:
//   1. Open https://my.zadarma.com/sms/history/ and log in.
//   2. Adjust FROM / TO dates below to your migration window.
//   3. Open DevTools Console (F12 → Console).
//   4. Paste this whole script and press Enter.
//   5. Watch the progress log; the file downloads automatically when done.
//
// Each record is identical to Zadarma's official JSON SMS export:
//   { id, sender, phonenumber, message, cost_per_one_part, cost, currency,
//     parts, date, error, status, direction }
// `date` is in the cabinet's display timezone (typically Europe/Warsaw).

(async () => {
  const FROM = '2025-05-08 00:00:00';
  const TO   = '2026-05-07 23:59:59';
  const PER_PAGE = 100;          // up to 100 per request
  const DIRECTION = 'all';        // 'all' | 'in' | 'out'
  const SORT = 'desc';
  const DELAY_MS = 250;           // gap between requests; increase if you hit 429

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const buildUrl = (page) => {
    const p = new URLSearchParams({
      search: '',
      direction: DIRECTION,
      sort: SORT,
      from_date: FROM,
      to_date: TO,
      currentPage: String(page),
      elementsOnPage: String(PER_PAGE),
    });
    return `/sms/history/get?${p.toString()}`;
  };

  const fetchPage = async (page) => {
    const res = await fetch(buildUrl(page), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
    return res.json();
  };

  // 1. Probe page 1 to learn paginate.cntPage / totalEntries.
  const first = await fetchPage(1);
  // Response shape: { list: [...], paginate: { cntPage, currentPage, totalEntries, elementsOnPage } }
  const totalPages = first.paginate?.cntPage
    ?? Math.ceil((first.paginate?.totalEntries ?? first.list.length) / PER_PAGE);
  const totalEntries = first.paginate?.totalEntries ?? first.list.length;
  console.log(`Total SMS: ${totalEntries} across ${totalPages} pages`);

  const all = [...first.list];

  // 2. Fetch the rest, retrying on transient errors (typically 429).
  for (let p = 2; p <= totalPages; p++) {
    try {
      const data = await fetchPage(p);
      all.push(...data.list);
      console.log(`Page ${p}/${totalPages}, collected ${all.length}/${totalEntries}`);
    } catch (e) {
      console.warn(`Error on page ${p}:`, e.message, '— retrying after 2s');
      await sleep(2000);
      p--;
      continue;
    }
    await sleep(DELAY_MS);
  }

  // 3. Stash on window for inspection + auto-download.
  window.__sms = all;
  console.log(`Done. Collected ${all.length} SMS. Available as window.__sms`);

  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zadarma_sms_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
})();
