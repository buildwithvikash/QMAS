import { PERMISSIONS as P } from '@qmas/shared';
import { matchPath } from 'react-router-dom';

/**
 * Guided tours: short step-by-step walks through a page for people who are new, or have
 * forgotten. Each step points at an element (`target`, a CSS selector; most pages share the
 * data-tour anchors of the page header, stat cards and tables) with a title and a line or two.
 * Steps whose element is not on the page (e.g. a button the user's role does not have) are skipped;
 * a step without a target shows in the middle of the screen.
 *   path: where the tour runs (a route pattern); startPath: where "Start" opens it from the Help
 *   Center (none for pages that need a record, e.g. one lot); permission: who sees it.
 */
export const TOURS = [
  {
    key: 'welcome', title: 'Welcome to QMAS', description: 'Find your way around: the menu, search, your tasks, notifications and help.',
    path: '/', startPath: '/', permission: P.DASHBOARD_VIEW,
    steps: [
      { title: 'Welcome to QMAS', body: 'This short tour shows where things are. Use Next (or the → key) to move on; Esc ends it at any time. You can take it again from the ? menu.' },
      { target: '[data-tour="sidebar"]', title: 'The menu', body: 'Every part of QMAS you have access to: incoming lots, deviations, DNs, reports, formats and more. It only shows what your role allows.' },
      { target: '[data-tour="search"]', title: 'Search everything', body: 'Find an IMIR, DN, deviation, item or vendor by number or name. Shortcut: Ctrl K from any page.' },
      { target: 'section[aria-label="Your work"]', title: 'Your work', body: 'What is waiting for you, most urgent first, with its priority and due date. The chips above the table show one kind of task; the button on a row opens it.' },
      { target: '[data-tour="bell"]', title: 'Notifications', body: 'Every hand-off to you shows here (and by mail): lots to inspect, reviews, approvals, reminders.' },
      { target: '[data-tour="help"]', title: 'Help & support', body: 'Report a problem from the page you are on, open the Help Center, or take the tour of the current page.' },
      { target: '[data-tour="theme"]', title: 'Light or dark', body: 'Switch between light and dark screens. Your choice is remembered on this device.' },
      { target: '[data-tour="user-menu"]', title: 'Your account', body: 'Your roles and plants, change password, appearance, and sign out.' },
      { title: 'You are ready', body: 'Most pages have their own short tour: open the ? menu and choose "Tour of this page". The Help Center lists them all.' },
    ],
  },
  {
    key: 'imir-list', title: 'Incoming lots', description: 'The lots that arrived from SAP, their status and how to find one.',
    path: '/imirs', startPath: '/imirs', permission: P.IMIR_VIEW,
    steps: [
      { target: '[data-tour="page-header"]', title: 'Incoming lots', body: 'Every inward lot from SAP (QA32) with its inspection report (IMIR). New lots arrive by themselves every few minutes.' },
      { target: '[data-tour="stats"]', title: 'Lots by status', body: 'How many lots are waiting, being inspected, in review or closed. Click a card to show only those lots.' },
      { target: '[data-tour="filters"]', title: 'Find lots', body: 'Filter by GRN date, plant, vendor or status, or search by IMIR, GRN, item or vendor. Filter builds more precise filters.' },
      { target: '[data-tour="table"]', title: 'Open a lot', body: 'Click an IMIR number to open the lot and inspect it. Columns can be chosen with the Columns button; ticked rows can be exported.' },
      { target: '[data-tour="page-actions"]', title: 'Pull from SAP now', body: 'Lots come in automatically; SAP sync pulls new ones immediately if you are waiting for one.' },
    ],
  },
  {
    key: 'imir', title: 'Inspecting a lot (IMIR)', description: 'Fill the inspection report: readings, checks, remarks, and submit it for review.',
    path: '/imirs/:id', permission: P.IMIR_VIEW, needs: 'Open any lot from Incoming Lots, then choose "Tour of this page" in the ? menu.',
    steps: [
      { target: 'section[aria-label="Route"]', title: 'Where the lot is', body: 'The route of the lot: inspection, Incharge review, and closure (or deviation). The current step is marked.' },
      { target: '[data-tour="imir-info"]', title: 'Lot details from SAP', body: 'GRN, vendor, item, quantity and the inspection format used. These come from SAP and the approved format.' },
      { target: '[data-tour="imir-status"]', title: 'Progress', body: 'How much of the report is filled, who has the lot now and since when.' },
      { target: '[data-tour="imir-before"]', title: 'Before you inspect', body: 'Check points that failed before or are drifting: look at these first.' },
      { target: '[data-tour="imir-model"]', title: 'Model', body: 'Enter the model the lot is for. It is needed before the report can be submitted.' },
      { target: 'section[aria-label="Dimensional test"], section[aria-label="Visual & reliability tests"], section[aria-label="Lot details"]', title: 'The inspection sheet', body: 'Type each reading in X1, X2…; Enter moves to the next cell. Out-of-limit values turn red. Visual checks: tap once for OK, twice for Not OK. Add a remark in the Remark column.' },
      { target: '[data-tour="imir-actions"]', title: 'Save and submit', body: 'Changes save by themselves. "go to next" jumps to the next empty entry; Submit report sends the lot to the Incharge when everything is filled.' },
      { target: '#imir-history', title: 'History', body: 'Everything that happened to the lot: who entered what and when, reviews and decisions.' },
    ],
  },
  {
    key: 'formats', title: 'Format library', description: 'Find an item\'s inspection format and start a new one or a change.',
    path: '/formats', startPath: '/formats', permission: P.FORMATS_VIEW,
    steps: [
      { target: '[data-tour="page-header"]', title: 'Inspection formats', body: 'One inspection format per item. Lots of an item without an approved format wait until one is approved.' },
      { target: '[data-tour="stats"]', title: 'At a glance', body: 'Items with and without a format, drafts in progress and formats waiting for approval. Click a card to filter.' },
      { target: '[data-tour="table"]', title: 'Open an item', body: 'Open an item to see its approved format, drafts, versions and history, and to start a change.' },
      { target: '[data-tour="page-actions"]', title: 'New format', body: 'Start a format for an item from scratch or from a copy. To load many existing formats at once, use Import Formats in the menu.' },
    ],
  },
  {
    key: 'builder', title: 'Building a format', description: 'Add sections and check points, set limits, preview what the inspector sees, and submit.',
    path: '/formats/versions/:id/edit', permission: P.FORMATS_CREATE, needs: 'Open a draft (Edit Format on an item), then choose "Tour of this page" in the ? menu.',
    steps: [
      { target: 'aside[aria-label="Field palette"]', title: 'Field palette', body: 'Click a field to add it: lot details (once per lot), measurements, OK / Not OK checks, choices and reliability tests. Search finds a field quickly.' },
      { target: '[data-tour="builder-info"]', title: 'Format information', body: 'Format no., common format no. and reference standard. The arrow folds this away.' },
      { target: '[data-tour="builder-section"]', title: 'Sections as tables', body: 'Each section is a table: type straight into the cells. Drag rows by the grip to reorder; LSL and USL fill themselves from a specification like 57 ± 0.3. Paste from Excel adds many measurements at once.' },
      { target: '[data-tour="builder-settings"]', title: 'Field settings', body: 'Click a row to set everything about it here: type, limits, options that pass or fail, required, and help for the inspector.' },
      { target: '[data-tour="builder-mode"]', title: 'Preview', body: 'Preview shows the sheet exactly as the inspector will fill it. Try readings there; nothing is saved.' },
      { target: '[data-tour="builder-submit"]', title: 'Save and submit', body: 'Save draft keeps your work (Ctrl+S). Save & submit sends it for approval; the approved version is used for new lots.' },
    ],
  },
  {
    key: 'format-import', title: 'Importing formats from Excel', description: 'Fill the template, check it, correct items on screen and import.',
    path: '/formats/import', startPath: '/formats/import', permission: P.FORMATS_IMPORT,
    steps: [
      { target: '[data-tour="page-actions"]', title: 'Start with the template', body: 'Download the template: one row per check point, with the item code on every row.' },
      { target: '[data-tour="import-upload"]', title: 'Check the file', body: 'Choose the file and press Check file. Nothing is saved yet; every problem is listed with its row number.' },
      { title: 'Review and correct', body: 'After the check, click an item to see its rows and a preview. Fix values, add or delete rows, and Apply & re-check. Then Import creates approved version 1 for every ready item.' },
    ],
  },
  {
    key: 'deviations', title: 'Deviations', description: 'Lots held for a deviation decision and where each one stands.',
    path: '/deviations', startPath: '/deviations', permission: P.DEVIATION_VIEW,
    steps: [
      { target: '[data-tour="page-header"]', title: 'Deviations', body: 'Lots that failed inspection and were held for a decision: the department reviews, then the IQC Head decides (with senior escalation when needed).' },
      { target: '[data-tour="stats"]', title: 'By stage', body: 'How many deviations are at each stage. Click a card to see only those.' },
      { target: '[data-tour="table"]', title: 'Open a deviation', body: 'Open one to fill the form, approve, or see who holds it now and its full history.' },
    ],
  },
  {
    key: 'dns', title: 'Defect notifications & CAPA', description: 'Supplier DNs and the vendor\'s corrective actions.',
    path: '/dns', startPath: '/dns', permission: P.DN_VIEW,
    steps: [
      { target: '[data-tour="page-header"]', title: 'Defect notifications', body: 'DNs raised to vendors for rejected or deviated lots, with their CAPA (corrective and preventive action).' },
      { target: '[data-tour="stats"]', title: 'Open and overdue', body: 'DNs waiting for CAPA, overdue ones and closed ones. Click a card to filter.' },
      { target: '[data-tour="table"]', title: 'Open a DN', body: 'Open a DN to add the vendor\'s CAPA and documents, approve or return it, or mail the DN PDF to yourself.' },
    ],
  },
  {
    key: 'reports', title: 'Reports', description: 'Registers, KPIs and charts, and how to download them.',
    path: '/reports', startPath: '/reports', permission: P.REPORTS_VIEW,
    steps: [
      { target: '[data-tour="page-header"]', title: 'Reports', body: 'Registers and KPIs for your plants, with charts that make trends easy to read.' },
      { target: 'main [role="tablist"]', title: 'Pick a report', body: 'Overview, lots, vendors, items, deviations and ageing. Each tab has its own figures and charts.' },
      { target: '[data-tour="table"]', title: 'Details and download', body: 'The rows behind the charts. Filter, choose columns, and download to Excel or CSV.' },
    ],
  },
  {
    key: 'help', title: 'Getting help', description: 'Guides, reporting a problem and following your tickets.',
    path: '/help', startPath: '/help', permission: null,
    steps: [
      { target: 'input[aria-label="Search the help guides"]', title: 'Search the guides', body: 'Type a few words (e.g. "forgot password", "tablet offline") to find the answer.' },
      { target: '[data-tour="help-actions"]', title: 'Ask the support team', body: 'Report a bug, ask a question, request access or suggest an idea. Paste a screenshot with Ctrl+V.' },
      { target: '#help-tours', title: 'Guided tours', body: 'All the tours in one place. Start one any time you want a reminder.' },
    ],
  },
];

export const tourFor = (pathname, can) => TOURS.find((t) => can(t.permission) && matchPath({ path: t.path, end: true }, pathname)) ?? null;
export const startTour = (key) => window.dispatchEvent(new CustomEvent('qmas:start-tour', { detail: { key } }));

// ── What the user has seen (this device) ─────────────────────────────────────────────────────
const storeKey = (userId) => `qmas.tours.${userId ?? 'anon'}`;
export function tourState(userId) {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(userId)) ?? '{}');
    return { done: v.done ?? [], dismissed: v.dismissed ?? [], offersOff: !!v.offersOff };
  } catch {
    return { done: [], dismissed: [], offersOff: false };
  }
}
export function saveTourState(userId, patch) {
  const next = { ...tourState(userId), ...patch };
  try {
    localStorage.setItem(storeKey(userId), JSON.stringify(next));
  } catch {
    /* storage blocked: tours still work, they are just offered again */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('qmas:tours-changed'));
  return next;
}
export const markTourDone = (userId, key) => {
  const s = tourState(userId);
  if (!s.done.includes(key)) saveTourState(userId, { done: [...s.done, key] });
};
