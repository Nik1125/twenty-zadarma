// Copies text to the clipboard with a fallback chain that tolerates Twenty
// App iframe sandboxing.
//
// Twenty embeds front-components in a sandboxed iframe; some hosts omit the
// `allow="clipboard-write"` permission policy, which makes the modern
// `navigator.clipboard.writeText` reject silently. The legacy
// `document.execCommand('copy')` does not require a permissions policy and
// works there. As a last resort we just leave the text selected so the user
// can press Ctrl/⌘+C manually.

export type CopyOutcome = 'clipboard-api' | 'exec-command' | 'selected-only' | 'failed';

const tryClipboardApi = async (text: string): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

const tryExecCommand = (text: string): boolean => {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
  }
  return ok;
};

// `target` (optional) is the element whose text is being copied. When all
// programmatic strategies fail we fall back to selecting the text inside that
// element so the user can copy with the keyboard.
export const copyToClipboard = async (
  text: string,
  target?: HTMLElement | null,
): Promise<CopyOutcome> => {
  if (await tryClipboardApi(text)) return 'clipboard-api';
  if (tryExecCommand(text)) return 'exec-command';
  if (target && typeof window !== 'undefined') {
    try {
      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return 'selected-only';
    } catch {
      // fall through
    }
  }
  return 'failed';
};
