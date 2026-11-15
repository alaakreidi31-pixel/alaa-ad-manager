import { useTranslation } from 'react-i18next';
import { ui } from './ui';

// Opens the browser print window: print, or "Save as PDF".
export function PrintButton() {
  const { t } = useTranslation();
  return (
    <button type="button" data-print-hide className={ui.primary} onClick={() => window.print()}>
      {t('invoices.paper.print')}
    </button>
  );
}
