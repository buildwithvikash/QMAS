import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { Provider } from 'react-redux';
import App from './App.jsx';
import { installCrashReporting } from './app/crashReport.js';
import { store } from './app/store.js';
import './index.css';
import ErrorBoundary from './components/layout/ErrorBoundary.jsx';

installCrashReporting();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <ErrorBoundary full>
        <App />
      </ErrorBoundary>
      <Toaster position="top-right" toastOptions={{ duration: 3500, style: { fontSize: '14px' } }} />
    </Provider>
  </StrictMode>,
);
