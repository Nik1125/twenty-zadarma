// Zadarma cabinet → SMS history JSON dump (browser console script).
//
// Zadarma's public API (/v1/sms/get/) doesn't return historical messages.
// The cabinet UI hits an internal endpoint `/sms/history/get` that returns
// the same shape we want, paginated. This script paginates through it and
// downloads `zadarma_sms_<DATE>.json` ready to feed into
// `zadarma-sms-json.mjs`.
//
// Auth notes (verified via live run on 2026-05-07):
// - `/sms/history/get` requires the CSRF header. Without it the server
//   returns 400 with "Integralność danych została naruszona. Prosimy o
//   odświeżenie strony.". The token name + value live on the Vuex store at
//   `$store.state.csrfHeaderToken` (an object `{name, value}`).
// - `X-Requested-With: XMLHttpRequest` is also required.
// - The response shape is `{ history: [...], paginate: { cntPage, ... } }`.
//   Note: `history` — NOT `list` (the cabinet's Vuex layer renames it to
//   `list` only after ingest; the wire format is `history`).
//
// How to run:
//   1. Open https://my.zadarma.com/sms/history/ and log in.
//   2. Adjust FROM / TO dates below to your migration window.
//   3. Open DevTools Console (F12 → Console).
//   4. Paste this whole script and press Enter.
//   5. The file downloads automatically when done.
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
  const DELAY_MS = 200;           // gap between requests; raise to 500-1000 if 429s appear

  // Pull the CSRF token off Vuex root. The cabinet exposes it as
  // {name, value} — `name` is the header name, `value` is the token.
  const root = document.querySelector('#app')?.__vue__;
  const csrf = root?.$store?.state?.csrfHeaderToken;
  if (!csrf?.name || !csrf?.value) {
    console.error('CSRF token not found on Vuex store. Are you logged in at https://my.zadarma.com/sms/history/ ?');
    return;
  }

  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    [csrf.name]: csrf.value,
  };

  const buildUrl = (page) =>
    '/sms/history/get?' +
    new URLSearchParams({
      search: '',
      direction: DIRECTION,
      sort: SORT,
      from_date: FROM,
      to_date: TO,
      currentPage: String(page),
      elementsOnPage: String(PER_PAGE),
    });

  const fetchPage = async (page) => {
    const res = await fetch(buildUrl(page), { credentials: 'include', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
    return res.json(); // { history: [...], paginate: { cntPage, currentPage, totalEntries } }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const all = [];

  // Probe page 1 to learn paginate.cntPage / totalEntries.
  const first = await fetchPage(1);
  const totalPages = first.paginate.cntPage;
  const totalEntries = first.paginate.totalEntries;
  all.push(...first.history);
  console.log(`Total SMS: ${totalEntries} across ${totalPages} pages`);

  // Fetch the rest, retrying on transient errors (typically 429).
  for (let p = 2; p <= totalPages; p++) {
    try {
      const data = await fetchPage(p);
      all.push(...data.history);
      console.log(`Page ${p}/${totalPages}, collected ${all.length}/${totalEntries}`);
    } catch (e) {
      console.warn(`Error on page ${p}: ${e.message} — retrying after 2s`);
      await sleep(2000);
      p--;
      continue;
    }
    await sleep(DELAY_MS);
  }

  // Stash on window for inspection + auto-download.
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
