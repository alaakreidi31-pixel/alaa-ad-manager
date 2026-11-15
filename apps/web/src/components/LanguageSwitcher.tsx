import { useTranslation } from 'react-i18next';
import { changeLanguage, type Language } from '../i18n';

// Shows the OTHER language, written in that language (standard practice).
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const target: Language = i18n.resolvedLanguage === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      onClick={() => void changeLanguage(target)}
      aria-label={t('language.switchLabel')}
      className="rounded-full border border-sky-400/45 px-4 py-1.5 text-sm font-semibold text-sky-300 transition hover:border-sky-300 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
    >
      <span lang={target}>{target === 'ar' ? 'عربي' : 'English'}</span>
    </button>
  );
}
