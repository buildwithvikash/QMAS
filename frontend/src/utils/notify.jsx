import toast from 'react-hot-toast';

/**
 * Success message that says what happened and, when useful, offers the next place to go
 * (e.g. "Deviation DEV… raised for SCM — Open"). `go` is the page's navigate call, since the
 * toaster sits outside the router.
 */
export function done(message, link) {
  if (!link) return toast.success(message);
  return toast.success((t) => (
    <span className="flex items-center gap-3">
      <span>{message}</span>
      <button type="button" className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
        onClick={() => { toast.dismiss(t.id); link.go(); }}>
        {link.label}
      </button>
    </span>
  ), { duration: 6000 });
}
