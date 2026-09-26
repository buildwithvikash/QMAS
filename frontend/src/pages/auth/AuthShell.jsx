import bg from '../../assets/login-bg.avif';
import logo from '../../assets/logo.png';

/** The sign-in frame: plant photo on the left, a card on the right (sign in, forgot / reset password). */
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden md:block md:w-1/2 bg-cover bg-center relative" style={{ backgroundImage: `url(${bg})` }}>
        <div className="absolute inset-0 bg-slate-900/60" />
        <div className="absolute inset-0 flex flex-col justify-center px-12 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">Western Refrigeration Pvt. Ltd</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-balance">Incoming Material Inspection &amp; Defect Notification</h1>
          <p className="mt-4 max-w-md text-slate-200">From inward lot to final decision: inspection formats, IMIR, deviation and CAPA in one place.</p>
        </div>
      </div>
      <div className="flex w-full md:w-1/2 items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8">
          <div className="flex flex-col items-center mb-8 text-center">
            <img src={logo} alt="Western Refrigeration" className="h-14 w-auto mb-3" />
            <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
