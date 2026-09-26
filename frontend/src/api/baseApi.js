import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { sessionEnded, setSession } from '../app/authSlice.js';

const rawBaseQuery = fetchBaseQuery({ baseUrl: '/api/v1', credentials: 'include' });
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password'];

// One refresh at a time; concurrent 401s wait for the same attempt.
let refreshing = null;

/**
 * On 401, refreshes the session once (rotating refresh token cookie) and retries the request.
 * If the refresh fails the user is signed out. REFRESH_RACE means another tab refreshed first,
 * so the new cookie is already in place and a retry is enough.
 */
async function baseQueryWithReauth(args, api, extraOptions) {
  let result = await rawBaseQuery(args, api, extraOptions);
  const url = typeof args === 'string' ? args : args.url;
  if (result.error?.status !== 401 || NO_REFRESH.some((p) => url.startsWith(p))) return result;

  refreshing ??= rawBaseQuery({ url: '/auth/refresh', method: 'POST' }, api, extraOptions).finally(() => {
    refreshing = null;
  });
  const refreshed = await refreshing;
  if (!refreshed.error || refreshed.error.data?.code === 'REFRESH_RACE') {
    if (refreshed.data?.data?.user) api.dispatch(setSession(refreshed.data.data.user));
    result = await rawBaseQuery(args, api, extraOptions);
  } else {
    // No cache reset here: the app-level /auth/me query would refetch and loop. Cached data from
    // the previous user is dropped when the next user signs in (see authApi login).
    // Ended by an administrator (signed out, locked, password reset): say so on the sign-in page.
    const why = refreshed.error.data?.code === 'SESSION_ENDED' ? refreshed.error.data.message : null;
    api.dispatch(sessionEnded(why));
  }
  return result;
}

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Me', 'Users', 'Roles', 'Master', 'Lookups', 'Sampling', 'NumberSeries', 'Audit'],
  endpoints: () => ({}),
});

/** Unwraps the { success, data, meta } envelope. */
export const envelope = (response) => response.data;
export const pagedEnvelope = (response) => ({ rows: response.data, meta: response.meta });
