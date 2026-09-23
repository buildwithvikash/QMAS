import { ShieldX } from 'lucide-react';
import { useSelector } from 'react-redux';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAccess } from '../../hooks/useAccess.js';

/** Signed-in users only; a temporary password must be changed before anything else. */
export function RequireAuth() {
  const { status, user } = useSelector((s) => s.auth);
  const location = useLocation();
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user?.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function RequirePermission({ permission, children }) {
  const { can } = useAccess();
  return can(permission) ? children : <Forbidden />;
}

export function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center px-4">
      <ShieldX className="w-10 h-10 text-slate-300" />
      <h1 className="text-lg font-semibold text-slate-700">You do not have access to this page</h1>
      <p className="text-sm text-slate-500 max-w-md">Ask your administrator for the role that grants it.</p>
      <Link to="/" className="text-sm font-semibold text-blue-600 hover:underline">Go to the dashboard</Link>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center px-4">
      <h1 className="text-lg font-semibold text-slate-700">Page not found</h1>
      <Link to="/" className="text-sm font-semibold text-blue-600 hover:underline">Go to the dashboard</Link>
    </div>
  );
}
