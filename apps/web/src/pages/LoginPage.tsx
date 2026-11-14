import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/auth-context';
import {
  AuthApiError,
  changeTemporaryPassword,
  login,
  verifyTwoFactor,
  type AuthErrorCode,
  type LoginResult,
} from '../lib/auth-api';

type Step =
  | { name: 'password' }
  | { name: 'code'; challengeToken: string }
  | { name: 'new_password'; changeToken: string };

const inputClass =
  'mt-1.5 w-full rounded-xl border border-ink-700 bg-ink-950 px-4 py-3 text-white placeholder:text-ink-400 focus:border-gold-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/40';
const buttonClass =
  'mt-6 w-full rounded-xl bg-gold-400 px-4 py-3 text-sm font-bold text-ink-950 transition hover:bg-gold-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-60';

function errorOf(error: unknown): AuthErrorCode {
  return error instanceof AuthApiError ? error.code : 'server_unreachable';
}

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>({ name: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      setPassword(''); // never keep the password longer than needed
      next(result);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  }

  // Goes to the next step the API asked for, or into the app.
  function next(result: LoginResult) {
    if (result.status === 'two_factor_required') {
      setStep({ name: 'code', challengeToken: result.challengeToken });
      setCode('');
    } else if (result.status === 'password_change_required') {
      setStep({ name: 'new_password', changeToken: result.changeToken });
    } else {
      signIn(result.session);
      void navigate('/', { replace: true });
    }
  }

  async function submitNewPassword(event: FormEvent) {
    event.preventDefault();
    if (step.name !== 'new_password') return;
    if (newPassword !== confirmation) {
      setError('password_mismatch');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await changeTemporaryPassword(step.changeToken, newPassword);
      setNewPassword('');
      setConfirmation('');
      next(result);
    } catch (caught) {
      const reason = errorOf(caught);
      setError(reason);
      // The 10-minute step expired: start again from the password.
      if (reason === 'password_change_expired') setStep({ name: 'password' });
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (step.name !== 'code') return;
    setBusy(true);
    setError(null);
    try {
      signIn(await verifyTwoFactor(step.challengeToken, code));
      void navigate('/', { replace: true });
    } catch (caught) {
      const reason = errorOf(caught);
      setError(reason);
      setCode('');
      // The 5-minute second step expired: start again from the password.
      if (reason === 'login_step_expired') setStep({ name: 'password' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl shadow-black/50 sm:p-8">
      <h1 className="text-2xl font-bold text-white">
        {step.name === 'password'
          ? t('auth.title')
          : step.name === 'new_password'
            ? t('auth.newPasswordTitle')
            : t('auth.codeTitle')}
      </h1>
      <p className="mt-1 text-sm text-ink-400">
        {step.name === 'password'
          ? t('auth.subtitle')
          : step.name === 'new_password'
            ? t('auth.newPasswordHelp')
            : useRecovery
              ? t('auth.recoveryHelp')
              : t('auth.codeHelp')}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {t(`auth.errors.${error}`)}
        </p>
      )}

      {step.name === 'password' ? (
        <form onSubmit={(event) => void submitPassword(event)} className="mt-6" noValidate>
          <label className="block text-sm font-semibold text-white">
            {t('auth.email')}
            <input
              type="email"
              dir="ltr"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold text-white">
            {t('auth.password')}
            <input
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={busy || !email || !password} className={buttonClass}>
            {busy ? t('auth.wait') : t('auth.continue')}
          </button>
        </form>
      ) : step.name === 'new_password' ? (
        <form onSubmit={(event) => void submitNewPassword(event)} className="mt-6" noValidate>
          <label className="block text-sm font-semibold text-white">
            {t('auth.newPassword')}
            <input
              type="password"
              dir="ltr"
              autoFocus
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold text-white">
            {t('auth.confirmPassword')}
            <input
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newPassword || !confirmation}
            className={buttonClass}
          >
            {busy ? t('auth.wait') : t('auth.savePassword')}
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => void submitCode(event)} className="mt-6" noValidate>
          <label className="block text-sm font-semibold text-white">
            {useRecovery ? t('auth.recoveryCode') : t('auth.code')}
            <input
              key={useRecovery ? 'recovery' : 'totp'}
              type="text"
              dir="ltr"
              autoFocus
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 11 : 6}
              placeholder={useRecovery ? 'XXXXX-XXXXX' : '000000'}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className={`${inputClass} text-center font-mono text-xl tracking-[0.3em]`}
            />
          </label>
          <button type="submit" disabled={busy || !code} className={buttonClass}>
            {busy ? t('auth.wait') : t('auth.verify')}
          </button>
          <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setCode('');
                setError(null);
              }}
              className="text-gold-300 underline-offset-4 hover:underline"
            >
              {useRecovery ? t('auth.useApp') : t('auth.useRecovery')}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep({ name: 'password' });
                setError(null);
              }}
              className="text-ink-400 underline-offset-4 hover:text-white hover:underline"
            >
              {t('auth.back')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
