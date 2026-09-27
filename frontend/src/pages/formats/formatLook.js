import { CalendarDays, ClipboardList, Hash, ListChecks, Ruler, ScanEye, TestTube2, ToggleLeft, Type } from 'lucide-react';

/** Icon and colour of each field type, shared by the builder palette, the format view and history. */
export const TYPE_LOOK = {
  MEASURE: [Ruler, 'bg-blue-100 text-blue-700'],
  OK_NOK: [ScanEye, 'bg-emerald-100 text-emerald-700'],
  CHOICE: [ListChecks, 'bg-violet-100 text-violet-700'],
  LOT_TEST: [TestTube2, 'bg-amber-100 text-amber-700'],
  TEXT: [Type, 'bg-slate-100 text-slate-700'],
  NUMBER: [Hash, 'bg-sky-100 text-sky-700'],
  DATE: [CalendarDays, 'bg-rose-100 text-rose-700'],
  YES_NO: [ToggleLeft, 'bg-teal-100 text-teal-700'],
};
export const SECTION_TONE = { RECORD: 'bg-slate-600', DIMENSIONAL: 'bg-blue-600', VISUAL: 'bg-emerald-600', RELIABILITY: 'bg-amber-500' };
/** Icon and tile colour of each section kind (format view, library, builder). */
export const SECTION_LOOK = {
  RECORD: [ClipboardList, 'bg-slate-100 text-slate-700'],
  DIMENSIONAL: [Ruler, 'bg-blue-100 text-blue-700'],
  VISUAL: [ScanEye, 'bg-emerald-100 text-emerald-700'],
  RELIABILITY: [TestTube2, 'bg-amber-100 text-amber-700'],
};
