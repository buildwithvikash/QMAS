import { useEffect } from 'react';

/**
 * While `dirty`, the browser asks before closing or reloading the page, so typed work on a form
 * (Deviation Form, DN, quantities) is not lost by accident.
 */
export function useUnsavedWarning(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
