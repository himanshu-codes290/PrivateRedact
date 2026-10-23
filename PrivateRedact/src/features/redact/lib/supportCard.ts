/** localStorage key for "don't show the support card again". A per-browser convenience only. */
export const SUPPORT_CARD_HIDDEN_KEY = 'privateredact.support-card.hidden';

/** Whether the user has asked not to see the card again (false if storage is unavailable). */
export function isSupportCardHidden(): boolean {
  try {
    return localStorage.getItem(SUPPORT_CARD_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSupportCardHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(SUPPORT_CARD_HIDDEN_KEY, '1');
    else localStorage.removeItem(SUPPORT_CARD_HIDDEN_KEY);
  } catch {
    // Private mode or blocked storage: the card simply shows again next time.
  }
}
