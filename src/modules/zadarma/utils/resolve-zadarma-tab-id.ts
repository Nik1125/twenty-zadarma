import { MetadataApiClient } from 'twenty-client-sdk/metadata';

// Resolves the INSTALLED id of the "Zadarma" tab on the standard Person record
// page, so the inbox can deep-link a click straight to that tab via the URL
// hash (`/object/person/:id#<tabId>`).
//
// Why runtime resolution: the installed PageLayoutTab id is NOT portable — it
// is regenerated on every (re)install and differs per workspace (local ≠
// Coolify ≠ Algeness), AND the PageLayoutTab metadata type does not expose
// `universalIdentifier`, so we can't match by our manifest UID. We match
// instead by the tab's title within the standard Person layout (only this App
// adds a "Zadarma" tab there).

const STANDARD_PERSON_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER =
  '20202020-a102-4002-8002-ae0a1ea11002';
const ZADARMA_TAB_TITLE = 'Zadarma';

export const resolveZadarmaTabId = async (
  meta: MetadataApiClient,
): Promise<string | null> => {
  const layoutsRes = (await meta.query({
    getPageLayouts: { id: true, universalIdentifier: true },
  })) as {
    getPageLayouts?: Array<{ id: string; universalIdentifier: string | null }>;
  };
  const personLayout = (layoutsRes.getPageLayouts ?? []).find(
    (p) =>
      p.universalIdentifier ===
      STANDARD_PERSON_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  );
  if (!personLayout) return null;

  const tabsRes = (await meta.query({
    getPageLayoutTabs: {
      __args: { pageLayoutId: personLayout.id },
      id: true,
      title: true,
    },
  })) as { getPageLayoutTabs?: Array<{ id: string; title: string | null }> };
  const tab = (tabsRes.getPageLayoutTabs ?? []).find(
    (t) => t.title === ZADARMA_TAB_TITLE,
  );
  return tab?.id ?? null;
};
