/**
 * AuthGate — auth context + on-demand login modal
 * ==================================================
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchUser,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  type AuthUser,
} from '../api';
import { useT, type MessageKeys } from '../i18n';
import styles from './AuthGate.module.css';

type Mode = 'login' | 'register';
type Phase = 'probing' | 'ready';

// ── Context ───────────────────────────────────────────────

interface AuthGateContextValue {
  /** null = guest; non-null = signed in. */
  user: AuthUser | null;
  /** Sign out — drops the stored JWT, sets user to null, UI returns to guest state. */
  signOut: () => Promise<void>;
  /** Open the login modal (called by user action or 401 fallback). */
  openSignIn: () => void;
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null);

/** Hook for descendants to read auth state and open the modal. */
export function useAuthGate(): AuthGateContextValue {
  const ctx = useContext(AuthGateContext);
  if (!ctx) throw new Error('useAuthGate must be used within <AuthGate>');
  return ctx;
}

// Map backend error codes → i18n keys.
const ERR_KEY: Record<string, MessageKeys> = {
  invalid_credentials: 'auth.err.invalid_credentials',
  username_taken: 'auth.err.username_taken',
  invalid_username: 'auth.err.invalid_username',
  invalid_password: 'auth.err.invalid_password',
  bad_request: 'auth.err.bad_request',
  db_error: 'auth.err.db_error',
  server_misconfigured: 'auth.err.server_misconfigured',
  auth_required: 'auth.err.auth_required',
};

// ── Provider ─────────────────────────────────────────────

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const [phase, setPhase] = useState<Phase>('probing');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Initial probe — determines whether we boot in guest or signed-in mode.
  useEffect(() => {
    let cancelled = false;
    fetchUser().then(u => {
      if (cancelled) return;
      setUser(u);
      setPhase('ready');
    });
    return () => { cancelled = true; };
  }, []);

  // Global 401 listener — any business request that fails opens the modal.
  useEffect(() => {
    const onAuthRequired = () => {
      setUser(null);
      setModalOpen(true);
    };
    window.addEventListener('eo:auth-required', onAuthRequired);
    return () => window.removeEventListener('eo:auth-required', onAuthRequired);
  }, []);

  const handleAuthed = useCallback((u: AuthUser) => {
    setUser(u);
    setModalOpen(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const openSignIn = useCallback(() => {
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  // Probe phase — render an empty shell so the page doesn't flash.
  if (phase === 'probing') {
    return <div className={styles.probeShell} aria-busy="true" />;
  }

  return (
    <AuthGateContext.Provider value={{ user, signOut: handleSignOut, openSignIn }}>
      {children}
      {modalOpen && !user && (
        <AuthModal onAuthed={handleAuthed} onClose={closeModal} />
      )}
    </AuthGateContext.Provider>
  );
}

// ── Login modal ──────────────────────────────────────────

interface AuthModalProps {
  onAuthed: (u: AuthUser) => void;
  onClose: () => void;
}

function AuthModal({ onAuthed, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>('login');
  const { t } = useT();

  // ESC closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={onClose}
    >
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={t('auth.modal.dismiss')}
        >
          <XIcon />
        </button>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
            onClick={() => setMode('login')}
          >
            {t('auth.tab.login')}
          </button>
          <button
            type="button"
            role="tab"
            className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
            onClick={() => setMode('register')}
          >
            {t('auth.tab.register')}
          </button>
        </div>

        {mode === 'login' ? (
          <CredentialsForm
            key="login"
            titleKey="auth.login.title"
            hintKey="auth.login.hint"
            submitKey="auth.login.submit"
            swapQKey="auth.login.swap.q"
            swapCtaKey="auth.login.swap.cta"
            autocompleteMode="login"
            action={apiLogin}
            onAuthed={onAuthed}
            onSwap={() => setMode('register')}
          />
        ) : (
          <CredentialsForm
            key="register"
            titleKey="auth.register.title"
            hintKey="auth.register.hint"
            submitKey="auth.register.submit"
            swapQKey="auth.register.swap.q"
            swapCtaKey="auth.register.swap.cta"
            autocompleteMode="register"
            action={apiRegister}
            onAuthed={onAuthed}
            onSwap={() => setMode('login')}
          />
        )}
      </div>
    </div>
  );
}

// ── Shared form ──────────────────────────────────────────

interface FormProps {
  titleKey: MessageKeys;
  hintKey: MessageKeys;
  submitKey: MessageKeys;
  swapQKey: MessageKeys;
  swapCtaKey: MessageKeys;
  autocompleteMode: 'login' | 'register';
  action: (u: string, p: string) => Promise<AuthUser>;
  onAuthed: (u: AuthUser) => void;
  onSwap: () => void;
}

function CredentialsForm({
  titleKey, hintKey, submitKey, swapQKey, swapCtaKey,
  autocompleteMode, action, onAuthed, onSwap,
}: FormProps) {
  const { t } = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKeys | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  // Reset visibility when switching forms — avoids password flashing if the
  // user toggles "show password" in register and then jumps to login.
  useEffect(() => {
    setShowPassword(false);
  }, [autocompleteMode]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    if (!username.trim() || !password) {
      setErrorKey('auth.error.empty');
      return;
    }
    setSubmitting(true);
    try {
      const u = await action(username.trim(), password);
      onAuthed(u);
    } catch (err) {
      const code = (err as Error).message;
      setErrorKey(ERR_KEY[code] ?? 'auth.err.unknown');
    } finally {
      setSubmitting(false);
    }
  }, [username, password, action, onAuthed]);

  const passwordAutocomplete = autocompleteMode === 'register' ? 'new-password' : 'current-password';

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      <header className={styles.formHeader}>
        <h2 className={styles.formTitle}>{t(titleKey)}</h2>
        <p className={styles.formHint}>{t(hintKey)}</p>
      </header>

      {errorKey && (
        <div className={styles.alert} role="alert">
          <span>{t(errorKey)}</span>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="auth-username">
          {t('auth.field.username')}
        </label>
        <input
          ref={usernameRef}
          id="auth-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          className={`${styles.input} ${errorKey && !username ? styles.inputError : ''}`}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('auth.field.username.placeholder')}
          disabled={submitting}
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="auth-password">
          {t('auth.field.password')}
        </label>
        <div className={styles.passwordWrap}>
          <input
            id="auth-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete={passwordAutocomplete}
            className={`${styles.input} ${styles.inputWithToggle} ${errorKey && !password ? styles.inputError : ''}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={submitting}
            required
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? t('auth.password.hide') : t('auth.password.show')}
            aria-pressed={showPassword}
            tabIndex={-1}
            disabled={submitting}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        className={styles.submit}
        disabled={submitting}
      >
        {submitting && <span className={styles.spinner} aria-hidden />}
        {submitting ? t('auth.submit.busy') : t(submitKey)}
      </button>

      <p className={styles.swap}>
        {t(swapQKey)}
        <button type="button" className={styles.swapBtn} onClick={onSwap}>
          {t(swapCtaKey)}
        </button>
      </p>
    </form>
  );
}

// ── Inline SVG icons (stroke-width 1.5) ──

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12C4.5 7.5 8 5 12 5s7.5 2.5 9.5 7c-2 4.5-5.5 7-9.5 7s-7.5-2.5-9.5-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.5 10.5 0 0 1 12 6c4 0 7.5 2.5 9.5 7-.6 1.4-1.5 2.6-2.5 3.6" />
      <path d="M6.5 7.5C4.7 8.9 3.4 10.7 2.5 12c2 4.5 5.5 7 9.5 7 1.7 0 3.3-.4 4.7-1.2" />
      <path d="M9.9 9.9a3 3 0 1 0 4.2 4.2" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
