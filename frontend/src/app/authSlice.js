import { createSlice } from '@reduxjs/toolkit';

/**
 * The signed-in user. Tokens are httpOnly cookies the app never sees; only the user profile,
 * roles and permissions live here, and they are reloaded from /auth/me on every start
 * (nothing is persisted to localStorage).
 */
const authSlice = createSlice({
  name: 'auth',
  // endedMessage: why the session ended (signed out by an administrator, account locked…), for the sign-in page.
  initialState: { user: null, status: 'loading', endedMessage: null }, // status: loading | authenticated | anonymous
  reducers: {
    setSession(state, { payload }) {
      state.user = payload;
      state.status = 'authenticated';
      state.endedMessage = null;
    },
    sessionEnded(state, { payload }) {
      state.user = null;
      state.status = 'anonymous';
      state.endedMessage = typeof payload === 'string' ? payload : null;
    },
  },
});

export const { setSession, sessionEnded } = authSlice.actions;
export default authSlice.reducer;
