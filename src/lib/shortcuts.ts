export type GlobalShortcutAction = 'send-prompt' | 'open-keys' | 'new-chat';

export interface ShortcutKeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

export interface ShortcutContext {
  hasOpenModal: boolean;
}

/**
 * Matches global keyboard shortcuts consistently across macOS (Cmd) and Windows/Linux (Ctrl).
 * - Cmd/Ctrl + Enter -> 'send-prompt' (suppressed while a modal dialog is open)
 * - Cmd/Ctrl + K     -> 'open-keys'
 * - Cmd/Ctrl + N     -> 'new-chat'
 */
export function matchGlobalShortcut(
  event: ShortcutKeyEventLike,
  context: ShortcutContext
): GlobalShortcutAction | null {
  if (event.defaultPrevented || event.isComposing) return null;
  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  if (!hasPrimaryModifier || event.altKey || event.shiftKey) return null;

  const key = event.key.toLowerCase();

  if (key === 'k') {
    return 'open-keys';
  }

  if (key === 'n') {
    return 'new-chat';
  }

  if (key === 'enter') {
    if (context.hasOpenModal) return null;
    return 'send-prompt';
  }

  return null;
}

export function isApplePlatform(platformOrUserAgent?: string): boolean {
  const source =
    platformOrUserAgent ??
    (typeof navigator !== 'undefined'
      ? `${navigator.platform || ''} ${navigator.userAgent || ''}`
      : '');
  return /mac|iphone|ipad|ipod/i.test(source);
}

export function formatShortcutHint(
  keyLabel: string,
  platformOrUserAgent?: string
): string {
  const isMac = isApplePlatform(platformOrUserAgent);
  return isMac ? `⌘${keyLabel}` : `Ctrl+${keyLabel}`;
}
