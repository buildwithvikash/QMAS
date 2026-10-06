import { PERMISSIONS as P } from '@qmas/shared';
import { BarChart3, ClipboardCheck, FileSpreadsheet, FileWarning, FileX2, Home, KeyRound, ShieldCheck, Tablet } from 'lucide-react';

/**
 * Help Center guides: short answers to the questions users ask most, per part of QMAS.
 * `permission` shows a topic only to people who can use that part (null: everyone).
 * `to` links to the page the answer talks about.
 */
export const HELP_TOPICS = [
  {
    key: 'start',
    title: 'Getting started',
    icon: Home,
    tone: 'bg-blue-100 text-blue-600',
    permission: null,
    articles: [
      { q: 'How do I find a lot, IMIR, DN or deviation quickly?', a: 'Press Ctrl+K (⌘K on a Mac) or click the search box at the top. Type a number, item code, vendor or a few words; press Enter to open the result.' },
      { q: 'Where do I see what I have to do?', a: 'The Dashboard shows your open tasks with their due times. The bell at the top lists notifications; the same notices also arrive by mail when your account has an e-mail address.', to: '/' },
      { q: 'Why was I signed out?', a: 'QMAS signs you out after 30 minutes without activity, when you sign in on another device, or when an administrator ends your session or resets your password. Sign in again; unsaved form entries may need to be typed again.' },
      { q: 'The page looks wrong or old after an update', a: 'Press Ctrl+F5 to reload the page without the browser cache. If it still looks wrong, report a bug with a screenshot.' },
    ],
  },
  {
    key: 'account',
    title: 'Sign in & account',
    icon: KeyRound,
    tone: 'bg-violet-100 text-violet-600',
    permission: null,
    articles: [
      { q: 'I forgot my password', a: 'On the sign-in page choose "Forgot password?" and enter your employee code or e-mail. A one-time link is mailed to you. No mail? Your account may have no e-mail address: ask the QMAS administrator to reset it.' },
      { q: 'How do I change my password?', a: 'Open your name at the top right and choose "Change password". Use at least 10 characters with a letter and a digit, and not your employee code.', to: '/change-password' },
      { q: 'My account is locked', a: 'Too many wrong passwords lock the account for a while. Wait and try again, or ask the administrator to unlock it.' },
      { q: 'I cannot see a menu or page I need', a: 'Menus follow your roles. Raise an "Access request" ticket naming the page, plant and reason; the administrator assigns the role.' },
    ],
  },
  {
    key: 'imir',
    title: 'Incoming inspection',
    icon: ClipboardCheck,
    tone: 'bg-emerald-100 text-emerald-600',
    permission: P.IMIR_VIEW,
    articles: [
      { q: 'Where do the incoming lots come from?', a: 'Lots are pulled from SAP (QA32) automatically. A lot without an approved inspection format waits under "Waiting for format" until the format is approved.', to: '/imirs' },
      { q: 'How do I inspect a lot?', a: 'Open the lot from Incoming Lots, fill the observations for each sample on the inspection sheet, attach photos for visual checks if needed, then submit. The IQC Incharge reviews it next.' },
      { q: 'A value is outside the limit — what happens?', a: 'The cell turns red and the lot result becomes Not OK. After review the lot can be accepted under deviation, or rejected with a defect notification.' },
      { q: 'The IMIR was sent back to me', a: 'The reviewer reverted it with a remark. Open it from your tasks, correct the observations and submit again.' },
    ],
  },
  {
    key: 'tablet',
    title: 'Tablet inspection',
    icon: Tablet,
    tone: 'bg-cyan-100 text-cyan-600',
    permission: P.IMIR_INSPECT,
    articles: [
      { q: 'Can I inspect without network?', a: 'Yes. Check out the lots on "This Tablet" while online; entries are saved on the tablet and sent when the connection is back and you sign in again.', to: '/tablet' },
      { q: 'A lot is "checked out to another tablet"', a: 'Only one tablet may hold a lot. Finish and sync on that tablet, or ask the IQC Incharge to release the lock on the Tablets page.' },
      { q: 'Before signing out on a shared tablet', a: 'Sync first. Unsent entries stay on the tablet and are sent when the same inspector signs in again.' },
    ],
  },
  {
    key: 'deviation',
    title: 'Deviation',
    icon: FileWarning,
    tone: 'bg-amber-100 text-amber-600',
    permission: P.DEVIATION_VIEW,
    articles: [
      { q: 'How does a deviation get approved?', a: 'A held lot goes to SCM and VD together; whichever initiator accepts it first is responsible. They fill the deviation form, the department Sub-Head and Head approve, and the IQC Head takes the final decision. Senior authorities decide escalated cases. Once the department has approved the deviation, the lot can no longer be rejected; the IQC In-Charge verifies the OK / Not-OK quantities after segregation or rework. A recommendation to reject the lot goes to the department Head first (approve or send back), then the IQC Head rejects the lot.', to: '/deviations' },
      { q: 'Can I use QMAS from home or another site?', a: 'QMAS works only from the company network (office or VPN). To work from outside, ask the administrator for external access: it is approved for a set period with a reason and ends by itself. The badge in the top bar shows whether you are on the company network or outside it.' },
      { q: 'I took a wrong decision. Can it be undone?', a: 'Yes, your own decision, as long as nobody else has acted on the record since. Open Help & Support → Reversal (or Request reversal on the IMIR, deviation or DN page), choose the decision and give a reason. An admin reviews it under Administration → Reversal Requests and reverses it or declines. Every reversal is kept in the audit trail.', to: '/help/reversal' },
      { q: 'Who approves in my department?', a: 'The approval chain per department and plant is set under Master Config › Deviation Approval.', to: '/masters/approval-chain' },
      { q: 'The deviation is overdue', a: 'Overdue steps are escalated automatically and the next person is told. Open the deviation to see who holds it now.' },
    ],
  },
  {
    key: 'dn',
    title: 'Defect notification & CAPA',
    icon: FileX2,
    tone: 'bg-rose-100 text-rose-600',
    permission: P.DN_VIEW,
    articles: [
      { q: 'When is a DN raised?', a: 'For rejected lots or lots accepted under deviation, the IQC Incharge raises a defect notification to the vendor from the IMIR.', to: '/dns' },
      { q: 'How is the vendor CAPA recorded?', a: 'Enter the vendor’s corrective and preventive action on the DN and attach their CAPA document. The IQC Head approves it or returns it with a remark.' },
      { q: 'Can I mail a DN to myself?', a: 'Yes, use "Mail to me" on the DN page to receive the PDF and forward it to the vendor.' },
    ],
  },
  {
    key: 'formats',
    title: 'Inspection formats',
    icon: FileSpreadsheet,
    tone: 'bg-sky-100 text-sky-600',
    permission: P.FORMATS_VIEW,
    articles: [
      { q: 'How do I create or change a format?', a: 'Open the item in the Format Library and start a draft (from the current version, another item or blank with the custom builder). Add sections and checkpoints, then submit it for approval.', to: '/formats' },
      { q: 'What is a merge conflict?', a: 'Two drafts changed the same checkpoint. The approver chooses which change to keep on the Resolve conflicts page before approving.' },
      { q: 'Where is the history of a format?', a: 'Every draft, submission, approval and change is on the item’s History tab, with who did it and when.' },
    ],
  },
  {
    key: 'reports',
    title: 'Reports',
    icon: BarChart3,
    tone: 'bg-indigo-100 text-indigo-600',
    permission: P.REPORTS_VIEW,
    articles: [
      { q: 'How do I export a report?', a: 'Open Reports, choose the tab and period, then use Download for Excel or CSV. Filters you apply are kept in the export.', to: '/reports' },
      { q: 'The numbers look different from SAP', a: 'Reports count lots by GRN date in QMAS. Lots still waiting in SAP sync are not included yet; check SAP Sync or report an issue with the lot number.' },
    ],
  },
  {
    key: 'admin',
    title: 'Administration',
    icon: ShieldCheck,
    tone: 'bg-slate-200 text-slate-700',
    permission: P.USERS_VIEW,
    articles: [
      { q: 'How do I give someone access?', a: 'Under Users, edit the user and add a role with its plant and validity. Roles & Permissions shows what each role can do.', to: '/admin/users' },
      { q: 'How do I see who changed a record?', a: 'The Audit Trail lists every change with the old and new values, who made it and when, plus the sign-in log.', to: '/admin/audit' },
    ],
  },
];
