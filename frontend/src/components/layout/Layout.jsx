import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Outlet } from 'react-router-dom';
import * as engine from '../../offline/engine.js';
import Loader from '../ui/Loader.jsx';
import Navbar from './Navbar.jsx';
import Sidebar from './Sidebar.jsx';

const MOBILE_BREAKPOINT = 768;

/** App shell from WRL Tool Report: top bar, collapsible sidebar, scrolling content area. */
export default function Layout() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  const [expanded, setExpanded] = useState(() => window.innerWidth >= MOBILE_BREAKPOINT);

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

  return (
    <div className="flex flex-col h-screen">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar expanded={expanded} onToggle={toggle} isMobile={isMobile} />
        <main className={`flex-1 overflow-auto transition-all duration-300 ${isMobile ? 'ml-0' : expanded ? 'ml-64' : 'ml-[56px]'}`}>
          <Suspense fallback={<Loader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
