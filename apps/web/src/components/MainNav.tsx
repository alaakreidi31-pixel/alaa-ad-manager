import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useAuth } from '../auth/auth-context';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 text-sm font-semibold transition ${
    isActive ? 'bg-ink-800 text-gold-300' : 'text-white hover:text-gold-300'
  }`;

// Administration menu (SUPER_ADMIN only). Client accounts have no menu yet.
export function MainNav() {
  const { t } = useTranslation();
  const { state } = useAuth();
  if (state.status !== 'signed_in' || state.user.role !== 'SUPER_ADMIN') return null;

  return (
    <nav aria-label={t('nav.label')} className="flex items-center gap-1">
      <NavLink to="/" end className={linkClass}>
        {t('nav.home')}
      </NavLink>
      <NavLink to="/admin/clients" className={linkClass}>
        {t('nav.clients')}
      </NavLink>
    </nav>
  );
}
