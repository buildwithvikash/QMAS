import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { ROUTE_SECTIONS } from '../config/routes.config.jsx';

/**
 * Permission checks for the UI. The API enforces every permission again; this only decides
 * what to show, so hiding a button is never the only protection.
 */
export function useAccess() {
  const user = useSelector((s) => s.auth.user);
  return useMemo(() => {
    const perms = new Set(user?.permissions ?? []);
    const can = (permission) => !permission || perms.has(permission);
    const menu = ROUTE_SECTIONS.map((section) => ({ ...section, items: section.items.filter((i) => !i.hidden && can(i.permission)) })).filter(
      (s) => s.items.length > 0,
    );
    return { user, can, menu };
  }, [user]);
}
