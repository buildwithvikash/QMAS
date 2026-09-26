import { loginSchema } from '@qmas/shared';
import { Eye, EyeOff, Info, Lock, User } from 'lucide-react';
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

export default function LoginPage() {
  const [login, { isLoading, error }] = useLoginMutation();
  const form = useZodForm(loginSchema, { employeeCode: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Why the last session ended (signed out by an administrator, account locked, password reset).
  const endedMessage = useSelector((s) => s.auth.endedMessage);
  const notice = location.state?.notice ?? endedMessage;

  const submit = async (e) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    try {
      const { user } = await login(data).unwrap();
      toast.success(`Welcome, ${user.fullName}`);
      navigate(user.mustChangePassword ? '/change-password' : (location.state?.from ?? '/'), { replace: true });
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };

  return (
    <AuthShell title="Sign in to QMAS" subtitle="Use your employee code and QMAS password.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {notice && !error && (
          <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />{notice}
          </p>
        )}
        <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
        <TextInput
          label="Employee code"
          icon={User}
          autoComplete="username"
          autoCapitalize="characters"
          value={form.values.employeeCode}
          onChange={(e) => form.set('employeeCode', e.target.value)}
          error={form.error('employeeCode')}
        />
        <div className="relative">
          <TextInput
            label="Password"
            icon={Lock}
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            value={form.values.password}
            onChange={(e) => form.set('password', e.target.value)}
            error={form.error('password')}
          />
          <button
            type="button"
            onClick={() => setShowPass((s) => !s)}
            aria-label={showPass ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-[30px] p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex justify-end -mt-1">
          <Link to="/forgot-password" className="text-xs font-medium text-blue-700 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isLoading}>Sign in</Button>
      </form>
    </AuthShell>
  );
}
