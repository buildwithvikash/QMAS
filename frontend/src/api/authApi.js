import { sessionEnded, setSession } from '../app/authSlice.js';
import * as offline from '../offline/store.js';
import { baseApi, envelope } from './baseApi.js';

/** On a registered tablet the last signed-in user is kept, so inspection can continue offline. */
async function rememberOnTablet(user) {
  try {
    if (await offline.getMeta('device')) await offline.setMeta('user', user);
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

const storeSession = async (_arg, { dispatch, queryFulfilled }) => {
  try {
    const { data } = await queryFulfilled;
    dispatch(setSession(data.user));
  } catch {
    /* errors are shown by the calling form */
  }
};

export const authApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    me: b.query({
      query: () => '/auth/me',
      transformResponse: envelope,
      providesTags: ['Me'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(setSession(data.user));
          rememberOnTablet(data.user);
        } catch (err) {
          // No network on a registered tablet: continue as the last user, offline.
          if (err?.error?.status === 'FETCH_ERROR') {
            const cached = await offline.getMeta('user').catch(() => null);
            if (cached && (await offline.getMeta('device').catch(() => null))) {
              dispatch(setSession({ ...cached, offline: true }));
              return;
            }
          }
          dispatch(sessionEnded());
        }
      },
    }),
    login: b.mutation({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      transformResponse: envelope,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          // Never show a previous user's cached lists to the next user on a shared tablet/PC.
          dispatch(baseApi.util.invalidateTags(['Users', 'Roles', 'Master', 'Lookups', 'Sampling', 'NumberSeries', 'Audit']));
          dispatch(setSession(data.user));
          rememberOnTablet(data.user);
        } catch {
          /* shown by the sign-in form */
        }
      },
    }),
    changePassword: b.mutation({
      query: (body) => ({ url: '/auth/change-password', method: 'POST', body }),
      transformResponse: envelope,
      onQueryStarted: storeSession,
    }),
    sessionPolicy: b.query({ query: () => '/auth/session-policy', transformResponse: envelope }),
    reportActivity: b.mutation({ query: () => ({ url: '/auth/activity', method: 'POST' }) }),
    forgotPassword: b.mutation({ query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }), transformResponse: envelope }),
    checkResetLink: b.query({ query: (token) => ({ url: '/auth/reset-password', params: { token } }), transformResponse: envelope, keepUnusedDataFor: 0 }),
    resetPassword: b.mutation({ query: (body) => ({ url: '/auth/reset-password', method: 'POST', body }), transformResponse: envelope }),
    logout: b.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await queryFulfilled.catch(() => {});
        await offline.deleteMeta('user').catch(() => {});
        dispatch(sessionEnded());
      },
    }),
  }),
});

export const {
  useMeQuery, useLoginMutation, useChangePasswordMutation, useLogoutMutation, useForgotPasswordMutation, useCheckResetLinkQuery, useResetPasswordMutation,
  useSessionPolicyQuery, useReportActivityMutation,
} = authApi;
