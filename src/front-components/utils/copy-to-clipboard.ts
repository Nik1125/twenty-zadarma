// Selects `target` text and (best-effort) attempts to write `text` to the
// clipboard.
//
// Why we don't trust programmatic copy:
//
// Twenty front-components run inside a sandboxed iframe. Depending on the
// host's `allow="clipboard-write"` permission policy and browser version,
// both `navigator.clipboard.writeText` and `document.execCommand('copy')`
// may resolve / return `true` while writing nothing — the sandbox silently
// no-ops the underlying clipboard mutation. There is no API to verify the
// write succeeded without `clipboard-read` permission, which is even more
// restricted.
//
// So this helper takes a select-first approach: it always selects the text
// of `target` (so the user has a reliable Ctrl/⌘+C path) and *additionally*
// attempts a programmatic copy as a no-cost shortcut. The returned outcome
// reports whether selection happened, not whether the clipboard was
// actually mutated — the UI should always tell the user "press Ctrl/⌘+C"
// because we can't truthfully claim "copied".

export type CopyOutcome = 'selected' | 'no-target';

const attemptProgrammaticCopy = async (text: string): Promise<void> => {
  // Async — fire and forget. We don't await success because we can't trust
  // it. If it works, great; if not, the user still has the selection.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to execCommand
    }
  }
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    const previousSelection = saveSelection();
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore — selection on `target` (set before this call) is the user's
      // fallback.
    } finally {
      document.body.removeChild(ta);
      restoreSelection(previousSelection);
    }
  }
};

const saveSelection = (): Range | null => {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0).cloneRange();
};

const restoreSelection = (range: Range | null): void => {
  if (!range || typeof window === 'undefined') return;
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
};

const selectTarget = (target: HTMLElement): boolean => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
};

export const copyToClipboard = async (
  text: string,
  target?: HTMLElement | null,
): Promise<CopyOutcome> => {
  const selected = target ? selectTarget(target) : false;
  // Best-effort programmatic copy after selection is in place. Selection
  // saved/restored inside attemptProgrammaticCopy so the user-visible
  // `target` selection survives the ephemeral textarea hop.
  await attemptProgrammaticCopy(text);
  return selected ? 'selected' : 'no-target';
};
