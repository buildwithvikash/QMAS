import { SUPPORT_KINDS, SUPPORT_PRIORITIES, SUPPORT_STATUSES } from '@qmas/shared';
import { Bug, CircleHelp, KeyRound, Lightbulb, TriangleAlert } from 'lucide-react';

/** Labels, badge colours and icons for Help & Support. */
export const kindOf = (v) => SUPPORT_KINDS.find((k) => k.value === v) ?? { value: v, label: v };
export const priorityOf = (v) => SUPPORT_PRIORITIES.find((k) => k.value === v) ?? { value: v, label: v };
export const statusOf = (v) => SUPPORT_STATUSES.find((k) => k.value === v) ?? { value: v, label: v };

export const KIND_LOOK = {
  BUG: { icon: Bug, tile: 'bg-rose-100 text-rose-600' },
  ISSUE: { icon: TriangleAlert, tile: 'bg-amber-100 text-amber-600' },
  ACCESS: { icon: KeyRound, tile: 'bg-violet-100 text-violet-600' },
  QUESTION: { icon: CircleHelp, tile: 'bg-blue-100 text-blue-600' },
  SUGGESTION: { icon: Lightbulb, tile: 'bg-emerald-100 text-emerald-600' },
};

export const STATUS_VARIANT = { OPEN: 'info', IN_PROGRESS: 'violet', WAITING: 'warning', RESOLVED: 'success', CLOSED: 'neutral' };
export const PRIORITY_VARIANT = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' };

/**
 * Opens the "Report a problem" form from anywhere (menu, help page, an error message).
 * `prefill` may set kind, module, title, description, reference.
 */
export const openReportIssue = (prefill = {}) => window.dispatchEvent(new CustomEvent('qmas:report-issue', { detail: prefill }));
