import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { markTourDone, saveTourState, TOURS, tourFor, tourState } from '../../app/tours.js';
import { useAccess } from '../../hooks/useAccess.js';

const PAD = 6;
const CARD_W = 340;

/** Waits for the step's element (pages load their data first); null when it is not on this page. */
function findTarget(selector, timeout = 1500) {
  return new Promise((resolve) => {
    if (!selector) return resolve(null);
    const t0 = Date.now();
    const look = () => {
      const el = [...document.querySelectorAll(selector)].find((x) => x.getBoundingClientRect().width > 0);
      if (el) resolve(el);
      else if (Date.now() - t0 > timeout) resolve(null);
      else setTimeout(look, 100);
    };
    look();
  });
}

/**
 * Guided tours (app/tours.js): a spotlight on one element at a time with a short explanation.
 * Started from the ? menu, the Help Center, or the offer shown on a first visit to a page.
 * Keys: → / Enter next, ← back, Esc ends. Mounted once in the layout.
 */
export default function TourHost() {
  const { user, can } = useAccess();
  const { pathname } = useLocation();
  const [run, setRun] = useState(null); // { tour, i, dir }
  const [shown, setShown] = useState(null); // { el, rect } of the current step
  const [offer, setOffer] = useState(null); // a tour offered on this page
  const cardRef = useRef(null);
  const [cardH, setCardH] = useState(180);

  const end = useCallback((finished) => {
    if (run && finished) markTourDone(user?.id, run.tour.key);
    setRun(null);
    setShown(null);
  }, [run, user?.id]);

  // Start on request (menu, Help Center).
  useEffect(() => {
    const onStart = (e) => {
      const tour = TOURS.find((t) => t.key === e.detail?.key);
      if (!tour) return;
      setOffer(null);
      setRun({ tour, i: 0, dir: 1 });
    };
    window.addEventListener('qmas:start-tour', onStart);
    return () => window.removeEventListener('qmas:start-tour', onStart);
  }, []);

  // A tour ends when the user goes to another page.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      setRun(null);
      setShown(null);
    }
    lastPath.current = pathname;
  }, [pathname]);

  // First visit to a page with a tour: offer it (not while one runs; not if turned off or already seen).
  useEffect(() => {
    setOffer(null);
    if (!user || run) return undefined;
    const tour = tourFor(pathname, can);
    if (!tour) return undefined;
    const s = tourState(user.id);
    let seenThisSession = [];
    try { seenThisSession = JSON.parse(sessionStorage.getItem('qmas.tours.later') ?? '[]'); } catch { /* ignore */ }
    if (s.offersOff || s.done.includes(tour.key) || s.dismissed.includes(tour.key) || seenThisSession.includes(tour.key)) return undefined;
    const t = setTimeout(() => setOffer(tour), 1200);
    return () => clearTimeout(t);
  }, [pathname, user, can, run]);

  // Resolve the current step: find its element (skipping steps whose element is not here).
  useEffect(() => {
    if (!run) return undefined;
    let cancelled = false;
    const step = run.tour.steps[run.i];
    setShown(null);
    findTarget(step.target).then((el) => {
      if (cancelled) return;
      if (step.target && !el) {
        const next = run.i + run.dir;
        if (next < 0) setRun({ ...run, i: 0, dir: 1 });
        else if (next >= run.tour.steps.length) end(true);
        else setRun({ ...run, i: next });
        return;
      }
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => !cancelled && setShown({ el, rect: el?.getBoundingClientRect() ?? null }), el ? 350 : 0);
    });
    return () => { cancelled = true; };
  }, [run?.tour.key, run?.i]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the spotlight on the element while the page scrolls or resizes.
  useEffect(() => {
    if (!shown?.el) return undefined;
    const update = () => setShown((s) => (s?.el ? { ...s, rect: s.el.getBoundingClientRect() } : s));
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [shown?.el]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [shown, run?.i]);

  const go = useCallback((d) => {
    if (!run) return;
    const next = run.i + d;
    if (next >= run.tour.steps.length) end(true);
    else if (next >= 0) setRun({ ...run, i: next, dir: d });
  }, [run, end]);

  useEffect(() => {
    if (!run) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); end(false); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [run, go, end]);

  const later = () => {
    try {
      const list = JSON.parse(sessionStorage.getItem('qmas.tours.later') ?? '[]');
      sessionStorage.setItem('qmas.tours.later', JSON.stringify([...list, offer.key]));
    } catch { /* ignore */ }
    setOffer(null);
  };

  if (!run && offer) {
    return createPortal(
      <div role="dialog" aria-label="Page tour" className="animate-fadeIn fixed bottom-4 left-4 z-60 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-blue-200 bg-white p-4 shadow-lift">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-100 text-blue-700"><Compass className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">New here? Take a quick tour</p>
            <p className="mt-0.5 text-xs text-slate-600">{offer.title}: {offer.description} ({offer.steps.length} steps, about a minute)</p>
          </div>
          <button type="button" onClick={later} aria-label="Not now" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setOffer(null); setRun({ tour: offer, i: 0, dir: 1 }); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer">
            <Compass className="h-3.5 w-3.5" />Start tour
          </button>
          <button type="button" onClick={later} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer">Not now</button>
          <button type="button" onClick={() => { saveTourState(user?.id, { dismissed: [...tourState(user?.id).dismissed, offer.key] }); setOffer(null); }}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer">Don&apos;t show again</button>
        </div>
        <button type="button" onClick={() => { saveTourState(user?.id, { offersOff: true }); setOffer(null); }} className="mt-1 text-[11px] text-slate-400 hover:text-slate-600 hover:underline cursor-pointer">
          Stop offering tours (they stay in the ? menu)
        </button>
      </div>,
      document.body,
    );
  }
  if (!run || !shown) return null;

  const step = run.tour.steps[run.i];
  const total = run.tour.steps.length;
  const r = shown.rect;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Card below the element when it fits, else above, else beside; centred when there is no element.
  let top;
  let left;
  if (r) {
    const below = r.bottom + PAD + 12;
    const above = r.top - PAD - 12 - cardH;
    top = below + cardH < vh ? below : above > 8 ? above : Math.max(8, Math.min(vh - cardH - 8, r.top));
    left = Math.min(Math.max(8, r.left + r.width / 2 - CARD_W / 2), vw - CARD_W - 8);
    if (top === Math.max(8, Math.min(vh - cardH - 8, r.top)) && r.right + CARD_W + 20 < vw) left = r.right + PAD + 12;
  } else {
    top = Math.max(8, vh / 2 - cardH / 2);
    left = Math.max(8, vw / 2 - CARD_W / 2);
  }

  return createPortal(
    <div className="fixed inset-0 z-70" role="dialog" aria-modal="true" aria-label={`${run.tour.title}: ${step.title}`}>
      {/* Dim everything except the element; clicks outside the card do nothing (Esc or Skip ends). */}
      {r ? (
        <div className="pointer-events-none fixed rounded-xl ring-2 ring-blue-400 transition-all duration-200"
          style={{ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2, boxShadow: '0 0 0 9999px rgb(15 23 42 / 0.55)' }} />
      ) : <div className="fixed inset-0 bg-slate-900/55" />}
      <div ref={cardRef} className="animate-fadeIn fixed rounded-xl border border-slate-200 bg-white p-4 shadow-lift" style={{ top, left, width: CARD_W }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          <Compass className="h-3.5 w-3.5" />{run.tour.title}
          <span className="ml-auto font-medium normal-case tracking-normal text-slate-400">{run.i + 1} of {total}</span>
        </div>
        <h2 className="mt-1.5 text-base font-bold text-slate-900">{step.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.body}</p>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {run.tour.steps.map((_, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k <= run.i ? 'bg-blue-600' : 'bg-slate-200'}`} />)}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => end(false)} className="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline cursor-pointer">Skip tour</button>
          <div className="ml-auto flex gap-2">
            {run.i > 0 && (
              <button type="button" onClick={() => go(-1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                <ArrowLeft className="h-3.5 w-3.5" />Back
              </button>
            )}
            <button type="button" autoFocus onClick={() => go(1)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer">
              {run.i + 1 === total ? <><Check className="h-3.5 w-3.5" />Finish</> : <>Next<ArrowRight className="h-3.5 w-3.5" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
