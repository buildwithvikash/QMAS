import { loginSchema } from '@qmas/shared';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLoginMutation } from '../../api/authApi.js';
import bg from '../../assets/login-bg.avif';
import logo from '../../assets/logo.png';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';

export default function LoginPage() {
  const [login, { isLoading, error }] = useLoginMutation();
  const form = useZodForm(loginSchema, { employeeCode: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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
            <h2 className="text-2xl font-bold text-slate-800">Sign in to QMAS</h2>
            <p className="text-sm text-slate-500 mt-1">Use your employee code and QMAS password.</p>
          </div>

          <form onSubmit={submit} noValidate className="space-y-4">
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
            <Button type="submit" size="lg" className="w-full" loading={isLoading}>Sign in</Button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-400">Forgot your password? Ask the QMAS administrator to reset it.</p>
        </div>
      </div>
    </div>
  );
}
