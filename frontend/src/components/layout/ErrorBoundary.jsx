import { Bug, Home, RotateCw, TriangleAlert } from 'lucide-react';
import { Component } from 'react';
import { reportCrash } from '../../app/crashReport.js';
import { openReportIssue } from '../../pages/help/helpLook.js';

/**
 * Catches a crash while drawing a page, so the user sees what happened instead of a blank screen.
 * The crash goes to the error log with a reference; "Report this problem" opens a Help & Support
 * ticket already filled in. `resetKey` (the page address) clears the error when the user moves on.
 * `full` is the outermost boundary (no layout around it, no ticket dialog available).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reference: null, key: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, reference: null, key: props.resetKey } : null;
  }

  componentDidCatch(error, info) {
    reportCrash({ message: error?.message ?? String(error), stack: error?.stack, componentStack: info?.componentStack, kind: 'render' })
      .then((reference) => this.setState({ reference }));
  }

  render() {
    const { error, reference } = this.state;
    if (!error) return this.props.children;
    const { full = false } = this.props;
    const report = () => openReportIssue({
      kind: 'BUG',
      title: `Page crashed: ${String(error.message ?? error).slice(0, 100)}`,
      description: `The page stopped working and showed "Something went wrong".\n\nError: ${String(error.message ?? error).slice(0, 500)}${reference ? `\nReference: ${reference}` : ''}\n\nWhat I was doing: `,
      reference: reference ?? '',
    });
    return (
      <div className={`flex flex-col items-center justify-center px-6 py-20 text-center ${full ? 'min-h-screen bg-canvas' : ''}`} role="alert">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-rose-100 text-rose-600"><TriangleAlert className="h-8 w-8" /></span>
        <h1 className="mt-5 text-xl font-bold text-slate-900">Something went wrong on this page</h1>
        <p className="mt-2 max-w-md text-sm text-slate-600">
          The error has been logged for the QMAS team. Your saved work is safe; reload the page to continue.
        </p>
        {reference && <p className="mt-2 text-xs text-slate-500">Reference <span className="font-mono font-semibold text-slate-700">{reference}</span></p>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer">
            <RotateCw className="h-4 w-4" />Reload page
          </button>
          {!full && (
            <button type="button" onClick={report} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              <Bug className="h-4 w-4 text-rose-500" />Report this problem
            </button>
          )}
          <a href="/" className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            <Home className="h-4 w-4" />Dashboard
          </a>
        </div>
        <details className="mt-6 max-w-xl text-left">
          <summary className="cursor-pointer text-xs text-slate-400">Technical details</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-100 p-3 text-[11px] text-slate-700 whitespace-pre-wrap">{String(error.stack ?? error.message ?? error)}</pre>
        </details>
      </div>
    );
  }
}
