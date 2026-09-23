/**
 * UserPill — header user badge + account menu (top-right).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { API, authHeaders, type AuthUser } from '../api';
import styles from './UserPill.module.css';

interface UserPillProps {
  user: AuthUser;
  onSignOut: () => Promise<void>;
}

interface MeMeta {
  exp?: number;
  sub: string;
}

export default function UserPill({ user, onSignOut }: UserPillProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<MeMeta>({ sub: user.id });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Refresh exp on open (exp lives inside the JWT, so ask the server).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API.authUser, { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { user: AuthUser; exp?: number };
        if (!cancelled) setMeta({ sub: data.user.id, exp: data.exp });
      } catch {
        /* noop — fall back to the cached user.id, exp shows as — */
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // ESC closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const initial = user.username.charAt(0).toUpperCase();

  const expText = (() => {
    if (!meta.exp) return '—';
    const d = new Date(meta.exp * 1000);
    return d.toLocaleString();
  })();

  const handleSignOut = useCallback(async () => {
    setOpen(false);
    await onSignOut();
  }, [onSignOut]);

  return (
    <div className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.pill}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={open ? t('pill.collapse') : t('pill.expand')}
      >
        <span className={styles.avatar} aria-hidden>{initial}</span>
        <span className={styles.username}>{user.username}</span>
        <span className={styles.statusDot} aria-hidden />
      </button>

      {open && (
        <>
          <div className={styles.menuBackdrop} onClick={() => setOpen(false)} aria-hidden />
          <div className={styles.menu} role="menu">
            <div className={styles.menuTop}>
              <span className={styles.menuAvatar} aria-hidden>{initial}</span>
              <div className={styles.menuUserMain}>
                <div className={styles.menuUserPrimary}>{user.username}</div>
                <div className={styles.menuUserSecondary}>{t('pill.you')}</div>
              </div>
            </div>

            <dl className={styles.menuMeta}>
              <div className={styles.metaRow}>
                <dt className={styles.metaLabel}>{t('pill.userId')}</dt>
                <dd className={styles.metaValue}><strong>{shortenUuid(meta.sub)}</strong></dd>
              </div>
              <div className={styles.metaRow}>
                <dt className={styles.metaLabel}>{t('pill.expiresAt')}</dt>
                <dd className={styles.metaValue}><strong>{expText}</strong></dd>
              </div>
            </dl>

            <button type="button" className={styles.signOut} onClick={handleSignOut}>
              <SignOutIcon />
              {t('pill.signout')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function shortenUuid(s: string): string {
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3" />
      <path d="M21 12H10M17 8l4 4-4 4" />
    </svg>
  );
}
