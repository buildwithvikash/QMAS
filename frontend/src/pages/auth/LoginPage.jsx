import { loginSchema } from '@qmas/shared';
import { ArrowRight, Eye, EyeOff, Globe, Info, Lock, User } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLoginMutation } from '../../api/authApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import AuthShell from './AuthShell.jsx';

// "Remember me" keeps only the employee code on this device (never the password).
const REMEMBER_KEY = 'qmas.rememberedEmployeeCode';
const readRemembered = () => {
  try { return localStorage.getItem(REMEMBER_KEY) ?? ''; } catch { return ''; }
};
const writeRemembered = (code) => {
  try {
    if (code) localStorage.setItem(REMEMBER_KEY, code);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch { /* storage blocked: nothing to remember */ }
};

export default function LoginPage() {
  const [login, { isLoading, error }] = useLoginMutation();
  const [remembered] = useState(readRemembered);
  const form = useZodForm(loginSchema, { employeeCode: remembered, password: '' });
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(Boolean(remembered));
  const navigate = useNavigate();
  const location = useLocation();
  // Why the last session ended (signed out by an administrator, account locked, password reset).
  const endedMessage = useSelector((s) => s.auth.endedMessage);
  const notice = location.state?.notice ?? endedMessage;
  const deniedNow = error?.data?.code === 'EXTERNAL_ACCESS_DENIED' ? error.data.message : null;
  const denied = deniedNow ?? (!error && endedMessage && /company network/.test(endedMessage) ? endedMessage : null);

  const submit = async (e) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    try {
      const { user } = await login(data).unwrap();
      writeRemembered(remember ? data.employeeCode : '');
      toast.success(`Welcome, ${user.fullName}`);
      navigate(user.mustChangePassword ? '/change-password' : (location.state?.from ?? '/'), { replace: true });
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };

  return (
    <AuthShell title="Welcome to QMAS" subtitle="Sign in to continue to your account">
      <form onSubmit={submit} noValidate className="space-y-5">
        {notice && !error && !denied && (
          <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />{notice}
          </p>
        )}
        {denied ? (
          // Outside the company network without approved external access.
          <div role="alert" className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
            <Globe className="w-5 h-5 mt-0.5 shrink-0" />
            <div><p className="font-semibold">Access denied: outside the company network</p><p className="mt-0.5">{denied}</p></div>
          </div>
        ) : <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />}
        <TextInput
          label="Employee code"
          size="lg"
          icon={User}
          autoFocus={!remembered}
          autoComplete="username"
          autoCapitalize="characters"
          value={form.values.employeeCode}
          onChange={(e) => form.set('employeeCode', e.target.value)}
          error={form.error('employeeCode')}
        />
        <div>
          <TextInput
            label="Password"
            size="lg"
            icon={Lock}
            autoFocus={Boolean(remembered)}
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            value={form.values.password}
            onChange={(e) => form.set('password', e.target.value)}
            error={form.error('password')}
            trailing={
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            }
          />
        </div>
        <div className="flex items-center justify-between gap-3 -mt-1">
          <label className="inline-flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 rounded accent-blue-600 cursor-pointer" />
            Remember me
          </label>
          <Link to="/forgot-password" className="text-sm font-medium text-blue-700 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full py-4! text-base! rounded-xl! shadow-lg shadow-blue-600/25" loading={isLoading}>
          Sign in {!isLoading && <ArrowRight className="w-5 h-5" />}
        </Button>
      </form>
    </AuthShell>
  );
}
