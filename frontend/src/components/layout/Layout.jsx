import { Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
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
