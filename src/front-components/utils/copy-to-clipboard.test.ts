import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from './copy-to-clipboard';

// vitest runs in a node-only environment; the exec-command and selected-only
// branches require a real DOM and are exercised by browser smoke tests
// (light + dark theme) instead. The clipboard-api and failed branches both
// short-circuit before touching `document`, so they unit-test cleanly here.

const ORIGINAL_CLIPBOARD = (
  globalThis as unknown as { navigator?: { clipboard?: unknown } }
).navigator?.clipboard;

const setNavigatorClipboard = (
  clipboard: { writeText: (text: string) => Promise<void> } | null,
) => {
  const nav = (globalThis as unknown as {
    navigator: { clipboard?: unknown };
  }).navigator;
  if (clipboard === null) {
    delete (nav as { clipboard?: unknown }).clipboard;
    return;
  }
  Object.defineProperty(nav, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
};

describe('copyToClipboard', () => {
  beforeEach(() => {
    setNavigatorClipboard(null);
  });

  afterEach(() => {
    if (ORIGINAL_CLIPBOARD !== undefined) {
      setNavigatorClipboard(
        ORIGINAL_CLIPBOARD as { writeText: (text: string) => Promise<void> },
      );
    } else {
      setNavigatorClipboard(null);
    }
    vi.restoreAllMocks();
  });

  it('returns clipboard-api when navigator.clipboard.writeText succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard({ writeText });
    const outcome = await copyToClipboard('hello');
    expect(outcome).toBe('clipboard-api');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns failed when both clipboard API and document are absent', async () => {
    // node test env has no `document`; clipboard removed in beforeEach
    const outcome = await copyToClipboard('nope');
    expect(outcome).toBe('failed');
  });

  it('returns failed when clipboard API rejects and document is absent', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked by policy'));
    setNavigatorClipboard({ writeText });
    const outcome = await copyToClipboard('nope');
    expect(outcome).toBe('failed');
    expect(writeText).toHaveBeenCalled();
  });
});
