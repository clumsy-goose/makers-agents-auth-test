import type React from 'react';
import styles from './CodeViewer.module.css';

/* ── Token factory ── */
const token = (cls: string) =>
  function Token({ t }: { t: string }) { return <span className={cls}>{t}</span>; };

const Cmt = token(styles.cmt);
const Kw  = token(styles.kw);
const Fn  = token(styles.fn);
const Str = token(styles.str);
const Op  = token(styles.op);
const Va  = token(styles.va);

interface LineProps { n: number; children?: React.ReactNode }
const L = ({ n, children }: LineProps) => (
  <div className={styles.line}>
    <span className={styles.ln}>{String(n).padStart(2, ' ')}</span>
    <span className={styles.lc}>{children ?? ' '}</span>
  </div>
);

/* Indentation shorthand */
const I = () => <span className={styles.indent} />;
const I2 = () => <><span className={styles.indent} /><span className={styles.indent} /></>;

export default function CodeViewer() {
  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.fileIcon}>⬡</span>
          <span className={styles.filename}>agents/chat/index.ts<span className={styles.sep}></span></span>
        </div>
        <span className={styles.badge}>READ ONLY</span>
      </div>

      {/* ── Code body ── */}
      <div className={styles.body}>
        {/* CRT scanline overlay */}
        <div className={styles.scanline} aria-hidden />

        <div className={styles.code}>
          {/* ── Header comment ── */}
          <L n={1}>
            <Cmt t="// Platform JWT auth — verified at the edge control plane" />
          </L>
          <L n={2} />

          {/* ── Config: edgeone.json ── */}
          <L n={3}>
            <Cmt t="// edgeone.json — one block protects every Agent route" />
          </L>
          <L n={4}>
            <Str t='"agents"' /><Op t=": {" />
          </L>
          <L n={5}>
            <I /><Str t='"auth"' /><Op t=": {" />
          </L>
          <L n={6}>
            <I2 /><Str t='"type"' /><Op t=": " /><Str t='"jwt"' /><Op t="," />
          </L>
          <L n={7}>
            <I2 /><Str t='"algorithm"' /><Op t=": " /><Str t='"RS256"' /><Op t="," />
          </L>
          <L n={8}>
            <I2 /><Cmt t="// public keys only — the private key never leaves your issuer" />
          </L>
          <L n={9}>
            <I2 /><Str t='"verificationKeys"' /><Op t=": [" /><Str t='"-----BEGIN PUBLIC KEY-----"' /><Op t="]," />
          </L>
          <L n={10}>
            <I /><Op t="}," />
          </L>
          <L n={11}>
            <Op t="}" />
          </L>
          <L n={12} />

          {/* ── Agent entry ── */}
          <L n={13}>
            <Kw t="export " /><Kw t="async " /><Kw t="function " /><Fn t="onRequest" />
            <Op t="(" /><Va t="context" /><Op t=") {" />
          </L>
          <L n={14}>
            <I /><Cmt t="// 1. Read the identity the edge layer injected" />
          </L>
          <L n={15}>
            <I /><Kw t="const " /><Va t="userId" /><Op t=" = " />
            <Va t="context" /><Op t="." /><Va t="request" /><Op t="." />
            <Va t="headers" /><Op t="." /><Fn t="get" /><Op t="(" />
            <Str t="'makers-user-id'" /><Op t=");" />
          </L>
          <L n={16} />
          <L n={17}>
            <I /><Cmt t="// 2. No token parsing, no secret — signature + exp" />
          </L>
          <L n={18}>
            <I /><Cmt t="//    were already checked (401 never reaches here)" />
          </L>
          <L n={19}>
            <I /><Kw t="if " /><Op t="(!" /><Va t="userId" /><Op t=") " />
            <Kw t="return " /><Fn t="unauthorizedResponse" /><Op t="();" />
          </L>
          <L n={20} />
          <L n={21}>
            <I /><Cmt t="// 3. From here on userId is trusted and cannot be forged" />
          </L>
          <L n={22}>
            <I /><Cmt t="//    (a client-sent header is stripped at the edge)" />
          </L>
          <L n={23}>
            <I /><Kw t="const " /><Va t="permission" /><Op t=" = " />
            <Kw t="await " /><Fn t="getPermissionByUserId" /><Op t="(" />
            <Va t="userId" /><Op t=");" />
          </L>
          <L n={24}>
            <I /><Kw t="if " /><Op t="(" /><Va t="permission" /><Op t=" === " />
            <Va t="0" /><Op t=") {" />
          </L>
          <L n={25}>
            <I2 /><Cmt t="// read-only user…" />
          </L>
          <L n={26}>
            <I /><Op t="} " /><Kw t="else " /><Kw t="if " /><Op t="(" />
            <Va t="permission" /><Op t=" === " /><Va t="1" /><Op t=") {" />
          </L>
          <L n={27}>
            <I2 /><Cmt t="// read-write user…" />
          </L>
          <L n={28}>
            <I /><Op t="} " /><Kw t="else " /><Op t="{" />
          </L>
          <L n={29}>
            <I2 /><Cmt t="// unknown / not found → deny" />
          </L>
          <L n={30}>
            <I /><Op t="}" />
          </L>
          <L n={31}>
            <Op t="}" />
          </L>
          <L n={32} />

          {/* ── Request shape ── */}
          <L n={33}>
            <Cmt t="// Client sends: Authorization: Bearer &lt;RS256 jwt&gt;" />
          </L>
          <L n={34}>
            <Cmt t="// Edge writes:  makers-user-id: &lt;jwt.sub&gt;" />
          </L>
        </div>
      </div>

      {/* ── Footer tag ── */}
      <div className={styles.footer}>
        <span className={styles.footerDot} />
        <span>EdgeOne Makers · Platform JWT Auth (RS256)</span>
      </div>
    </div>
  );
}
