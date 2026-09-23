import { changePasswordSchema, PASSWORD_RULES_TEXT } from '@qmas/shared';
import { KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useChangePasswordMutation, useLogoutMutation } from '../../api/authApi.js';
import logo from '../../assets/logo.png';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';

/** Stand-alone page (outside the app shell) so it also works for a forced first-time change. */
export default function ChangePasswordPage() {
  const { user } = useAccess();
  const [changePassword, { isLoading, error }] = useChangePasswordMutation();
  const [logout] = useLogoutMutation();
  const form = useZodForm(changePasswordSchema, { currentPassword: '', newPassword: '', confirm: '' });
  const navigate = useNavigate();
  const forced = user?.mustChangePassword;

  const submit = async (e) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    if (form.values.confirm !== form.values.newPassword) {
      form.setServerErrors({ confirm: 'The two new passwords do not match.' });
      return;
    }
    try {
      await changePassword(data).unwrap();
      toast.success('Password changed. Other devices have been signed out.');
      navigate('/', { replace: true });
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };

  const formLevel = error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : '';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img src={logo} alt="Western Refrigeration" className="h-12 w-auto mb-3" />
          <div className="p-2 rounded-lg bg-blue-50 mb-2"><KeyRound className="w-5 h-5 text-blue-600" /></div>
          <h1 className="text-xl font-bold text-slate-800">{forced ? 'Set your own password' : 'Change password'}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {forced ? 'You signed in with a temporary password. Choose a new one to continue.' : 'Changing your password signs you out on other devices.'}
          </p>
        </div>
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormError message={formLevel} />
          <TextInput
            label={forced ? 'Temporary password' : 'Current password'}
            type="password"
            autoComplete="current-password"
            value={form.values.currentPassword}
            onChange={(e) => form.set('currentPassword', e.target.value)}
            error={form.error('currentPassword')}
          />
          <TextInput
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={PASSWORD_RULES_TEXT}
            value={form.values.newPassword}
            onChange={(e) => form.set('newPassword', e.target.value)}
            error={form.error('newPassword')}
          />
          <TextInput
            label="Repeat new password"
            type="password"
            autoComplete="new-password"
            value={form.values.confirm}
            onChange={(e) => form.set('confirm', e.target.value)}
            error={form.error('confirm')}
          />
          <Button type="submit" size="lg" className="w-full" loading={isLoading}>Save new password</Button>
          {forced ? (
            <button type="button" onClick={() => logout()} className="w-full text-sm text-slate-500 hover:text-slate-700 cursor-pointer">Sign out instead</button>
          ) : (
            <button type="button" onClick={() => navigate(-1)} className="w-full text-sm text-slate-500 hover:text-slate-700 cursor-pointer">Cancel</button>
          )}
        </form>
      </div>
    </div>
  );
}
