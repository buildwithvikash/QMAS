import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu or small panel opened from a button, drawn at the top level of the page (a portal) so it
 * is never hidden under sticky headers or clipped by scrolling containers. It closes on a click
 * outside, on Esc, when the page scrolls or resizes (not when its own content scrolls), and when an
 * element marked `data-close` inside it is clicked.
 *   <PopMenu button={({ open, toggle }) => <button onClick={toggle}>…</button>}>…</PopMenu>
 */
export default function PopMenu({ button, children, align = 'right', width = 'w-56', role = 'menu', className = 'p-1.5 max-h-80 overflow-auto' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: align === 'left' ? r.left : undefined, right: align === 'right' ? window.innerWidth - r.right : undefined });
    const shut = (e) => { if (!panel.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    const resize = () => setOpen(false);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', resize);
    document.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', esc);
    };
  }, [open, align]);
  return (
    <span ref={ref} className="inline-flex">
      {button({ open, toggle: () => setOpen((o) => !o), close: () => setOpen(false) })}
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div ref={panel} role={role} className={`fixed z-50 ${width} card shadow-lift animate-fadeIn ${className}`} style={pos}
            onClick={(e) => e.target.closest('[data-close]') && setOpen(false)}>
            {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}
