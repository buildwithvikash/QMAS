import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch } from 'react-redux';
import { sessionEnded } from '../../app/authSlice.js';
import { useLogoutMutation, useReportActivityMutation, useSessionPolicyQuery } from '../../api/authApi.js';
import * as offline from '../../offline/store.js';
import Button from '../ui/Button.jsx';

const KEY = 'qmas.lastActive';
const WARN_MS = 2 * 60_000; // warn this long before signing out
const REPORT_EVERY_MS = 60_000; // tell the server at most once a minute
const EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'scroll', 'mousemove'];
const IDLE_MESSAGE = 'You were signed out after a period without activity. Please sign in again.';

const readShared = () => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeShared = (t) => {
  try {
    localStorage.setItem(KEY, String(t));
  } catch { /* storage unavailable: this tab only */ }
};

/**
 * Signs the user out after the server's idle limit (IDLE_TIMEOUT_MIN, 30 minutes by default)
 * without typing, clicking, touching or scrolling, with a warning two minutes before. Activity
 * in any open tab counts for all of them, and is reported to the server, which enforces the same
 * limit. Registered tablets are exempt (they inspect offline for long spells).
 */
export default function IdleSignOut() {
  const { data: policy } = useSessionPolicyQuery();
  const [report] = useReportActivityMutation();
  const [logout] = useLogoutMutation();
  const dispatch = useDispatch();
  const [tablet, setTablet] = useState(null);
  const [left, setLeft] = useState(null); // ms until sign-out while the warning shows
  const lastLocal = useRef(Date.now());
  const lastReport = useRef(0);
  const limitMs = (policy?.idleMinutes ?? 0) * 60_000;

  useEffect(() => {
    offline.getMeta('device').then((d) => setTablet(!!d)).catch(() => setTablet(false));
  }, []);

  useEffect(() => {
    if (!limitMs || tablet !== false) return undefined;
    const now = Date.now();
    lastLocal.current = now;
    writeShared(now);
    let lastWrite = 0;
    const onActivity = () => {
      const t = Date.now();
      lastLocal.current = t;
      if (t - lastWrite > 5_000) {
        lastWrite = t;
        writeShared(t);
      }
      if (t - lastReport.current > REPORT_EVERY_MS) {
        lastReport.current = t;
        report();
      }
    };
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));

    const tick = setInterval(async () => {
      const idle = Date.now() - Math.max(lastLocal.current, readShared());
      if (idle >= limitMs) {
        clearInterval(tick);
        await logout().unwrap().catch(() => {});
        dispatch(sessionEnded(IDLE_MESSAGE));
      } else if (idle >= limitMs - WARN_MS) {
        setLeft(limitMs - idle);
      } else {
        setLeft(null);
      }
    }, 1_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      clearInterval(tick);
    };
  }, [limitMs, tablet, report, logout, dispatch]);

  if (left === null) return null;
  const secs = Math.max(0, Math.ceil(left / 1000));
  const stay = () => {
    const t = Date.now();
    lastLocal.current = t;
    writeShared(t);
    lastReport.current = t;
    report();
    setLeft(null);
  };
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/40 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="card shadow-2xl w-full max-w-sm p-5 text-center animate-fadeIn">
        <span className="inline-flex w-12 h-12 rounded-full bg-amber-50 items-center justify-center"><Clock className="w-6 h-6 text-amber-600" /></span>
        <h2 id="idle-title" className="mt-3 text-base font-semibold text-slate-900">Still there?</h2>
        <p className="mt-1 text-sm text-slate-600">
          For security you will be signed out in <span className="font-semibold tabular text-slate-900">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span> because there has been no activity for a while. Unsaved changes in open forms may be lost.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="ghost" onClick={async () => { await logout().unwrap().catch(() => {}); }}>Sign out now</Button>
          <Button onClick={stay} autoFocus>Stay signed in</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
