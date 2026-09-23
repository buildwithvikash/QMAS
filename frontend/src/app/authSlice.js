import { createSlice } from '@reduxjs/toolkit';

/**
 * The signed-in user. Tokens are httpOnly cookies the app never sees; only the user profile,
 * roles and permissions live here, and they are reloaded from /auth/me on every start
 * (nothing is persisted to localStorage).
 */
const authSlice = createSlice({
  name: 'auth',
  initialState: { user: null, status: 'loading' }, // loading | authenticated | anonymous
  reducers: {
    setSession(state, { payload }) {
      state.user = payload;
      state.status = 'authenticated';
    },
    sessionEnded(state) {
      state.user = null;
      state.status = 'anonymous';
    },
  },
});

export const { setSession, sessionEnded } = authSlice.actions;
export default authSlice.reducer;
