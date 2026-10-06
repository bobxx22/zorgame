/* The panel's language: English or Ukrainian. The choice lives in this
   browser (localStorage); without one - the browser's language. Texts sit
   next to each other at the call site: tr('Runs', 'Запуски'). Names of the
   game (style names, engine words) are not translated. */

import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'uk';
/* a text in both languages, as the server sends explanations */
export interface Text {
  en: string;
  uk: string;
}

const KEY = 'zoria-lab-lang';
const subscribers = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'uk') return saved;
  } catch {
    /* storage is closed (private window): fall back to the browser's language */
  }
  return navigator.language.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

let current: Lang = initial();
document.documentElement.lang = current;

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  current = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* the choice lasts until reload */
  }
  for (const notify of subscribers) notify();
}

/* re-renders the component when the language changes */
export function useLang(): Lang {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => current,
  );
}

export const tr = (en: string, uk: string): string => (current === 'uk' ? uk : en);
export const txt = (text: Text): string => text[current];
