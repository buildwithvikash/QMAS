import { resetWithTokenSchema } from '@qmas/shared';
import { ArrowLeft, Eye, EyeOff, Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCheckResetLinkQuery, useResetPasswordMutation } from '../../api/authApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import AuthShell from './AuthShell.jsx';

/** Opened from the e-mailed link: choose a new password (every device is signed out). */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token);
  const { data: link, isLoading, error: checkError } = useCheckResetLinkQuery(token, { skip: !valid });
  const [reset, { isLoading: saving, error }] = useResetPasswordMutation();
  const form = useZodForm(resetWithTokenSchema, { token, newPassword: '', confirmPassword: '' });
  const [show, setShow] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    try {
      const r = await reset(data).unwrap();
      navigate('/login', { replace: true, state: { notice: `Password changed for ${r.employeeCode}. Sign in with the new password.` } });
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };

  if (valid && isLoading) return <Loader fullScreen label="Checking the link…" />;
  const problem = !valid ? 'This reset link is not complete. Open the link from the e-mail again, or ask for a new one.' : checkError ? apiError(checkError).message : link && !link.valid ? link.message : null;

  return (
    <AuthShell title="Set a new password" subtitle={problem ? null : `For ${link.fullName} (${link.employeeCode})`}>
      {problem ? (
        <div className="text-center space-y-4">
          <span className="inline-flex w-12 h-12 rounded-full bg-amber-50 items-center justify-center"><TriangleAlert className="w-6 h-6 text-amber-600" /></span>
          <p className="text-sm text-slate-700">{problem}</p>
          <div className="flex justify-center gap-4 text-sm">
            <Link to="/forgot-password" className="font-medium text-blue-700 hover:underline">Ask for a new link</Link>
            <Link to="/login" className="inline-flex items-center gap-1 text-slate-500 hover:text-blue-700"><ArrowLeft className="w-4 h-4" />Sign in</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormError message={error && !Object.keys(apiError(error).fieldErrors).filter((k) => k !== 'token').length ? apiError(error).message : form.error('token') ?? ''} />
          <div className="relative">
            <TextInput label="New password" icon={Lock} type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus
              value={form.values.newPassword} onChange={(e) => form.set('newPassword', e.target.value)} error={form.error('newPassword')}
              hint="At least 10 characters, with a letter and a digit; must not contain your employee code." />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-[30px] p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <TextInput label="Repeat new password" icon={Lock} type={show ? 'text' : 'password'} autoComplete="new-password"
            value={form.values.confirmPassword} onChange={(e) => form.set('confirmPassword', e.target.value)} error={form.error('confirmPassword')} />
          <p className="text-xs text-slate-500">Every device signed in to this account will be signed out.</p>
          <Button type="submit" size="lg" className="w-full" loading={saving}>Set new password</Button>
        </form>
      )}
    </AuthShell>
  );
}
