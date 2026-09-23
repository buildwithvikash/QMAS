import { sessionEnded, setSession } from '../app/authSlice.js';
import { baseApi, envelope } from './baseApi.js';

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
        } catch {
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
    logout: b.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await queryFulfilled.catch(() => {});
        dispatch(sessionEnded());
      },
    }),
  }),
});

export const { useMeQuery, useLoginMutation, useChangePasswordMutation, useLogoutMutation } = authApi;
