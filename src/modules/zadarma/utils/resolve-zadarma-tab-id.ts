import { MetadataApiClient } from 'twenty-client-sdk/metadata';

// Resolves the INSTALLED id of the "Zadarma" tab on the standard Person record
// page, so the inbox can deep-link a click straight to the chat tab via the URL
// hash (`/object/person/:id#<tabId>`).
//
// Version-safe by design: older Twenty servers do NOT expose
// `PageLayout.universalIdentifier` (matching the Person layout by its UID 500s
// the whole resolver — hit on the Algeness 2.x server). So instead of
// identifying the Person layout, we scan the RECORD_PAGE layouts and return the
// tab titled "Zadarma" — this App only ever adds that tab to the Person layout.
// Uses only fields present on every version (PageLayout.id/type,
// PageLayoutTab.id/title). The installed tab id is per-install and not portable,
// so it must be resolved at runtime. Runs once on inbox mount.
const ZADARMA_TAB_TITLE = 'Zadarma';

export const resolveZadarmaTabId = async (
  meta: MetadataApiClient,
): Promise<string | null> => {
  const layoutsRes = (await meta.query({
    getPageLayouts: { id: true, type: true },
  })) as { getPageLayouts?: Array<{ id: string; type: string | null }> };
  const recordLayouts = (layoutsRes.getPageLayouts ?? []).filter(
    (p) => p.type === 'RECORD_PAGE',
  );
  for (const layout of recordLayouts) {
    const tabsRes = (await meta.query({
      getPageLayoutTabs: {
        __args: { pageLayoutId: layout.id },
        id: true,
        title: true,
      },
    })) as { getPageLayoutTabs?: Array<{ id: string; title: string | null }> };
    const tab = (tabsRes.getPageLayoutTabs ?? []).find(
      (t) => t.title === ZADARMA_TAB_TITLE,
    );
    if (tab) return tab.id;
  }
  return null;
};
