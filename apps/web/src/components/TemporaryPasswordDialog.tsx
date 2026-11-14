import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ui } from './ui';

// Shows a temporary password ONCE (ADR 0016). It is kept only in this
// component's memory: closing the dialog forgets it for good.
export function TemporaryPasswordDialog({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="temporary-password-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
    >
      <div className={`${ui.card} w-full max-w-md`}>
        <h2 id="temporary-password-title" className="text-xl font-bold text-white">
          {t('clientUsers.passwordTitle')}
        </h2>
        <p className="mt-2 text-sm text-ink-400">
          {t('clientUsers.passwordFor')}{' '}
          <span dir="ltr" className="text-white">
            {email}
          </span>
        </p>

        <p
          dir="ltr"
          className="mt-4 select-all rounded-xl border border-gold-500/50 bg-ink-950 px-4 py-3 text-center font-mono text-lg text-gold-300"
        >
          {password}
        </p>

        <p className={`${ui.error} mt-4`}>{t('clientUsers.passwordWarning')}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className={ui.secondary}
            onClick={() => {
              void navigator.clipboard
                .writeText(password)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? t('clientUsers.copied') : t('clientUsers.copy')}
          </button>
          <button type="button" className={`${ui.primary} ms-auto`} onClick={onClose}>
            {t('clientUsers.passwordSaved')}
          </button>
        </div>
      </div>
    </div>
  );
}
