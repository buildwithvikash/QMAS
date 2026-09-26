import { forgotPasswordSchema } from '@qmas/shared';
import { ArrowLeft, MailCheck, User } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForgotPasswordMutation } from '../../api/authApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import AuthShell from './AuthShell.jsx';

/** "Forgot password": sends a one-time reset link to the e-mail address on the account. */
export default function ForgotPasswordPage() {
  const [ask, { isLoading, error }] = useForgotPasswordMutation();
  const form = useZodForm(forgotPasswordSchema, { login: '' });
  const [sent, setSent] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    try {
      setSent((await ask(data).unwrap()).message);
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };

  return (
    <AuthShell title="Forgot your password?" subtitle={sent ? null : 'Enter your employee code or e-mail address. We will e-mail you a link to set a new password.'}>
      {sent ? (
        <div className="text-center space-y-4">
          <span className="inline-flex w-12 h-12 rounded-full bg-emerald-50 items-center justify-center"><MailCheck className="w-6 h-6 text-emerald-600" /></span>
          <p className="text-sm text-slate-700">{sent}</p>
          <p className="text-xs text-slate-500">No mail after a few minutes? Check spam, or ask the QMAS administrator: your account may have no e-mail address.</p>
          <Link to="/login" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"><ArrowLeft className="w-4 h-4" />Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
          <TextInput
            label="Employee code or e-mail"
            icon={User}
            autoComplete="username"
            autoFocus
            value={form.values.login}
            onChange={(e) => form.set('login', e.target.value)}
            error={form.error('login')}
          />
          <Button type="submit" size="lg" className="w-full" loading={isLoading}>Send reset link</Button>
          <p className="text-center">
            <Link to="/login" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-700"><ArrowLeft className="w-3.5 h-3.5" />Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
