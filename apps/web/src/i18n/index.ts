import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'alaa.language';

function isLanguage(value: unknown): value is Language {
  return value === 'ar' || value === 'en';
}

// Browser storage can be unavailable (privacy mode, blocked storage): never crash because of it.
function readSavedLanguage(): Language | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

function saveLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Ignore: the choice simply will not be remembered.
  }
}

// 1) The user's saved choice  2) the browser language  3) English
function detectLanguage(): Language {
  const saved = readSavedLanguage();
  if (saved) return saved;
  const browserLanguages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return browserLanguages.some((lang) => lang.toLowerCase().startsWith('ar')) ? 'ar' : 'en';
}

// Arabic is right-to-left: lang + dir on <html> flip the whole layout
// (all spacing in the UI uses logical properties: ms/me/ps/pe/start/end).
function applyToDocument(language: Language): void {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

const initialLanguage = detectLanguage();
applyToDocument(initialLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false,
  },
});

export async function changeLanguage(language: Language): Promise<void> {
  applyToDocument(language);
  saveLanguage(language);
  await i18n.changeLanguage(language);
}

export function currentLanguage(): Language {
  return isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';
}

export default i18n;
