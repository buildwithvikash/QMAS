import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGetNotificationsQuery, useReadAllNotificationsMutation, useReadNotificationMutation } from '../../api/dnApi.js';
import { formatRelative } from '../../utils/format.js';

/** In-app notifications: hand-offs, reminders and closures for the signed-in user. */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useGetNotificationsQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true });
  const [markRead] = useReadNotificationMutation();
  const [markAll] = useReadAllNotificationsMutation();
  const navigate = useNavigate();
  const unread = data?.unread ?? 0;

  const go = (n) => {
    if (!n.readAt) markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative mr-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer">
        <Bell className="w-5 h-5 text-slate-600" />
        {unread > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="animate-fadeIn absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] z-50 rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
              <span className="text-sm font-bold text-slate-800">Notifications</span>
              {unread > 0 && (
                <button type="button" onClick={() => markAll()} className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer">
                  <CheckCheck className="w-3.5 h-3.5" />Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-[26rem] overflow-auto divide-y divide-slate-100">
              {!data?.items.length && <li className="px-4 py-6 text-sm text-slate-400 text-center">No notifications yet.</li>}
              {data?.items.map((n) => (
                <li key={n.id}>
                  <button type="button" role="menuitem" onClick={() => go(n)} className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 cursor-pointer ${n.readAt ? '' : 'bg-blue-50/50'}`}>
                    <div className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-600 shrink-0" aria-label="Unread" />}
                      <div className="min-w-0">
                        <div className={`text-sm ${n.readAt ? 'text-slate-600' : 'font-semibold text-slate-800'}`}>{n.title}</div>
                        {n.body && <div className="text-xs text-slate-500 line-clamp-2 whitespace-pre-line">{n.body}</div>}
                        <div className="text-[11px] text-slate-400 mt-0.5">{formatRelative(n.createdAt)}</div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
