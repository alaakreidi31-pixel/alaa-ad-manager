import { useTranslation } from 'react-i18next';
import { PerformanceReportView } from '../../components/PerformanceReport';

// /reports in the client portal (phase 7): its own campaigns only.
export function ClientReportsPage() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 self-start">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('reports.clientTitle')}</h1>
      <PerformanceReportView scope="client" />
    </section>
  );
}
