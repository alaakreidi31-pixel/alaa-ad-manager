import { useTranslation } from 'react-i18next';
import { FinanceReportView } from '../../components/FinanceReport';
import { PerformanceReportView } from '../../components/PerformanceReport';

// /admin/reports (phase 7): campaign performance, comparison, agency finance.
export function ReportsPage() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 self-start">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('reports.title')}</h1>
      <PerformanceReportView scope="admin" />
      <FinanceReportView />
    </section>
  );
}
