import { KeyRound, LogOut, Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '../../api/authApi.js';
import * as engine from '../../offline/engine.js';
import { ConfirmDialog } from '../ui/Modal.jsx';
import logo from '../../assets/logo.png';
import { useAccess } from '../../hooks/useAccess.js';
import { initials } from '../../utils/format.js';
import { useCommandPaletteHotkey } from '../../hooks/useCommandPaletteHotkey.js';
import CommandPalette from './CommandPalette.jsx';
import NotificationBell from './NotificationBell.jsx';

export default function Navbar() {
  const { user } = useAccess();
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unsent, setUnsent] = useState(0);
  const [searching, setSearching] = useState(false);
  const openSearch = useCallback(() => setSearching(true), []);
  useCommandPaletteHotkey(openSearch);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const primaryRole = user?.roles[0];
  const roleText = primaryRole ? `${primaryRole.roleName}${primaryRole.plantName ? ` · ${primaryRole.plantName}` : ''}` : 'No role assigned';
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
    <header className="sticky top-0 z-50 bg-white h-16 flex items-center gap-3 px-4 border-b border-slate-200/80">
      <span className="bg-wrl absolute top-0 inset-x-0 h-[3px]" aria-hidden="true" />
      <Link to="/" className="flex items-center gap-3 min-w-0">
        <img src={logo} alt="Western Refrigeration" className="h-10 w-auto" />
        <div className="hidden xl:block leading-tight">
          <div className="text-lg font-bold text-blue-800 tracking-wide">QMAS</div>
          <div className="text-[11px] text-slate-400">Incoming Material Inspection &amp; Defect Notification</div>
        </div>
      </Link>

      <button type="button" onClick={openSearch}
        className="hidden md:flex items-center gap-2.5 ml-6 w-full max-w-md px-3.5 py-2 rounded-lg border border-slate-200 bg-canvas text-sm text-slate-500 hover:bg-white hover:border-blue-300 transition-colors cursor-pointer">
        <Search className="w-4 h-4" />
        <span className="flex-1 text-left">Search IMIR, DN, deviation, item, vendor…</span>
        <kbd className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded-md border border-slate-200 bg-white text-slate-500">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      <div className="ml-auto flex items-center">
      <button type="button" onClick={openSearch} aria-label="Search" className="md:hidden p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer"><Search className="w-5 h-5 text-slate-600" /></button>
      <NotificationBell />
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50 cursor-pointer"
        >
          <span className="w-10 h-10 bg-blue-800 rounded-full flex items-center justify-center text-sm font-semibold text-white">{initials(user?.fullName)}</span>
          <span className="hidden lg:block text-left">
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
            <div role="menu" className="animate-fadeIn absolute right-0 mt-2 w-72 z-50 card shadow-xl p-2">
              <div className="px-3 py-2 border-b border-slate-100 mb-1">
                <div className="text-sm font-semibold text-slate-800">{user?.fullName}</div>
                <div className="text-xs text-slate-400">{user?.employeeCode}</div>
                <ul className="mt-2 space-y-0.5">
                  {user?.roles.map((r) => (
                    <li key={`${r.roleCode}-${r.plantId}`} className="text-xs text-slate-600">
                      {r.roleName}
                      {r.plantName && <span className="text-slate-400"> · {r.plantName}</span>}
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
      {searching && <CommandPalette onClose={() => setSearching(false)} />}
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
