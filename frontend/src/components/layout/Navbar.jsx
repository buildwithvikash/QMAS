import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '../../api/authApi.js';
import * as engine from '../../offline/engine.js';
import { ConfirmDialog } from '../ui/Modal.jsx';
import logo from '../../assets/logo.png';
import { useAccess } from '../../hooks/useAccess.js';
import { initials } from '../../utils/format.js';
import NotificationBell from './NotificationBell.jsx';

export default function Navbar() {
  const { user } = useAccess();
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unsent, setUnsent] = useState(0);

  const primaryRole = user?.roles[0];
  const roleText = primaryRole ? `${primaryRole.roleName}${primaryRole.plantSapCode ? ` · ${primaryRole.plantSapCode}` : ''}` : 'No role assigned';
  const moreRoles = (user?.roles.length ?? 0) - 1;

  // Unsent tablet entries stay on the tablet and are sent when their inspector signs in again;
  // signing out is allowed, but only after saying so.
  const askSignOut = async () => {
    setMenuOpen(false);
    const n = await engine.unsentCount().catch(() => 0);
    if (n) setUnsent(n);
    else signOut();
  };

  const signOut = async () => {
    setUnsent(0);
    await logout();
    toast.success('Signed out');
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-50 bg-white h-16 flex items-center px-4 shadow-sm border-b border-slate-200">
      <Link to="/" className="flex items-center gap-3 min-w-0">
        <img src={logo} alt="Western Refrigeration" className="h-10 w-auto" />
        <div className="hidden sm:block leading-tight">
          <div className="text-lg font-bold text-blue-800 tracking-wide">QMAS</div>
          <div className="text-[11px] text-slate-400">Incoming Material Inspection &amp; Defect Notification</div>
        </div>
      </Link>

      <div className="ml-auto flex items-center">
      <NotificationBell />
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50 cursor-pointer"
        >
          <span className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center text-sm font-bold text-white">{initials(user?.fullName)}</span>
          <span className="hidden sm:block text-left">
            <span className="block text-sm font-semibold text-slate-800">{user?.fullName}</span>
            <span className="block text-xs text-slate-400">
              {roleText}
              {moreRoles > 0 && ` +${moreRoles}`}
            </span>
          </span>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div role="menu" className="animate-fadeIn absolute right-0 mt-2 w-72 z-50 rounded-xl border border-slate-200 bg-white shadow-xl p-2">
              <div className="px-3 py-2 border-b border-slate-100 mb-1">
                <div className="text-sm font-semibold text-slate-800">{user?.fullName}</div>
                <div className="text-xs text-slate-400">{user?.employeeCode}</div>
                <ul className="mt-2 space-y-0.5">
                  {user?.roles.map((r) => (
                    <li key={`${r.roleCode}-${r.plantId}`} className="text-xs text-slate-600">
                      {r.roleName}
                      {r.plantName && <span className="text-slate-400"> · {r.plantName} ({r.plantSapCode})</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <Link role="menuitem" to="/change-password" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50">
                <KeyRound className="w-4 h-4 text-slate-400" /> Change password
              </Link>
              <button role="menuitem" type="button" onClick={askSignOut} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-rose-600 hover:bg-rose-50 cursor-pointer">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          </>
        )}
      </div>
      </div>
      {unsent > 0 && (
        <ConfirmDialog
          title="Entries not sent yet"
          variant="primary"
          confirmLabel="Sign out anyway"
          message={`This tablet has ${unsent} inspection entr${unsent === 1 ? 'y' : 'ies'} or photo(s) not yet sent to the server. They stay safely on the tablet and are sent when the inspector who recorded them signs in again with a connection. To be safe, sync first or save a backup (This Tablet page).`}
          onConfirm={signOut}
          onCancel={() => setUnsent(0)}
        />
      )}
    </header>
  );
}
