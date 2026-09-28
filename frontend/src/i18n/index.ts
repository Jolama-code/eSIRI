import en, { type I18nKey } from './en';
import sw from './sw';
import { useApp, type Language } from '../store/appStore';

export type { I18nKey };

const dicts = { en, sw } as const;

export type Params = Record<string, string | number>;

export function tr(lang: Language, key: I18nKey, params?: Params): string {
  let s: string = dicts[lang][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Translate using the current store language (outside React). */
export function t(key: I18nKey, params?: Params): string {
  return tr(useApp.getState().language, key, params);
}

export type TFunc = (key: I18nKey, params?: Params) => string;

/** React hook: re-renders when the language changes. */
export function useT(): TFunc {
  const lang = useApp((s) => s.language);
  return (key, params) => tr(lang, key, params);
}

export function useLang(): Language {
  return useApp((s) => s.language);
}
