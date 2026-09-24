import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Outlet, useLocation } from 'react-router-dom';
import * as engine from '../../offline/engine.js';
import Loader from '../ui/Loader.jsx';
import Navbar from './Navbar.jsx';
import Sidebar from './Sidebar.jsx';

const MOBILE_BREAKPOINT = 768;
const WIDE_BREAKPOINT = 1100;

/** App shell from WRL Tool Report: top bar, collapsible sidebar, scrolling content area. */
export default function Layout() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  // Wide screens start with the full menu; tablets start with the icon rail to leave room for tables.
  const [expanded, setExpanded] = useState(() => window.innerWidth >= WIDE_BREAKPOINT);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (mobile) setExpanded(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Offline entries are credited to the inspector who recorded them (shared tablets).
  const userId = useSelector((s) => s.auth.user?.id ?? null);
  useEffect(() => engine.setCurrentUser(userId), [userId]);

  // On a registered tablet, keep sending queued inspection entries in the background.
  useEffect(() => {
    let stop;
    engine.getDevice().then((d) => { if (d) stop = engine.startAutoSync(); }).catch(() => {});
    return () => stop?.();
  }, []);

  const toggle = useCallback(() => setExpanded((e) => !e), []);
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col h-screen">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar expanded={expanded} onToggle={toggle} isMobile={isMobile} />
        <main className={`flex-1 overflow-auto transition-all duration-300 ${isMobile ? 'ml-0' : expanded ? 'ml-64' : 'ml-[56px]'}`}>
          <Suspense fallback={<Loader />}>
            <div key={pathname} className="animate-page min-h-full">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
