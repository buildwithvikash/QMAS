import { lazy, Suspense } from 'react';
import { useSelector } from 'react-redux';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useMeQuery } from './api/authApi.js';
import { NotFound, RequireAuth, RequirePermission } from './components/layout/guards.jsx';
import Layout from './components/layout/Layout.jsx';
import Loader from './components/ui/Loader.jsx';
import { ROUTE_SECTIONS } from './config/routes.config.jsx';

const LoginPage = lazy(() => import('./pages/auth/LoginPage.jsx'));
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage.jsx'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage.jsx'));

const routes = ROUTE_SECTIONS.flatMap((s) => s.items);

export default function App() {
  useMeQuery(); // restores the session from the httpOnly cookie on start
  const status = useSelector((s) => s.auth.status);
  if (status === 'loading') return <Loader fullScreen label="Starting QMAS…" />;

  return (
    <BrowserRouter>
      <Suspense fallback={<Loader fullScreen />}>
        <Routes>
          <Route path="/login" element={status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage />} />
          {/* Public: reachable signed in or not (a reset link may be opened on a shared PC). */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route element={<Layout />}>
              {routes.map((r) => (
                <Route key={r.path} path={r.path} element={<RequirePermission permission={r.permission}>{r.element}</RequirePermission>} />
              ))}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
