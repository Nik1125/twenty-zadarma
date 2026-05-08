import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from './copy-to-clipboard';

// vitest runs in a node-only env (no DOM). The select-target branches need
// a real `window`/`document`/`Range` and are exercised by the browser smoke
// test in the PR. Here we only test what survives without DOM:
//   - With no target and no DOM: returns 'no-target' regardless of whether
//     the clipboard API is available.
//   - When the clipboard API is present but rejects: still returns
//     'no-target' (programmatic copy is fire-and-forget, never affects
//     outcome).

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

  it('returns no-target when no target is supplied', async () => {
    setNavigatorClipboard(null);
    const outcome = await copyToClipboard('hello');
    expect(outcome).toBe('no-target');
  });

  it('still attempts programmatic clipboard write when clipboard API present', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard({ writeText });
    const outcome = await copyToClipboard('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
    // No target supplied — outcome reports selection state, not write success
    expect(outcome).toBe('no-target');
  });

  it('does not throw when clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    setNavigatorClipboard({ writeText });
    await expect(copyToClipboard('hello')).resolves.toBe('no-target');
    expect(writeText).toHaveBeenCalled();
  });
});
