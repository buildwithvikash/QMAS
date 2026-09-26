import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

export const adminApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    // ── Users ────────────────────────────────────────────────────────────────
    getUsers: b.query({
      query: (params) => ({ url: '/users', params }),
      transformResponse: pagedEnvelope,
      providesTags: ['Users'],
    }),
    getUser: b.query({
      query: (id) => `/users/${id}`,
      transformResponse: envelope,
      providesTags: (_r, _e, id) => [{ type: 'Users', id }],
    }),
    createUser: b.mutation({
      query: (body) => ({ url: '/users', method: 'POST', body }),
      transformResponse: envelope,
      invalidatesTags: ['Users', 'Roles'],
    }),
    updateUser: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}`, method: 'PATCH', body }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { id }) => ['Users', { type: 'Users', id }],
    }),
    setUserRoles: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}/roles`, method: 'PUT', body }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { id }) => ['Users', { type: 'Users', id }, 'Roles'],
    }),
    resetPassword: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}/reset-password`, method: 'POST', body }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { id }) => ['Users', { type: 'Users', id }],
    }),
    unlockUser: b.mutation({
      query: (id) => ({ url: `/users/${id}/unlock`, method: 'POST' }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, id) => ['Users', { type: 'Users', id }, 'Audit'],
    }),

    // ── Sessions, locks, sign-outs ───────────────────────────────────────────
    getUserSummary: b.query({ query: () => '/users/summary', transformResponse: envelope, providesTags: ['Users'] }),
    getActiveSessions: b.query({ query: () => '/users/sessions', transformResponse: envelope, providesTags: ['Users'] }),
    getUserSessions: b.query({ query: (id) => `/users/${id}/sessions`, transformResponse: envelope, providesTags: (_r, _e, id) => [{ type: 'Users', id }] }),
    lockUser: b.mutation({
      query: ({ id, reason }) => ({ url: `/users/${id}/lock`, method: 'POST', body: { reason } }),
      transformResponse: envelope,
      invalidatesTags: ['Users', 'Audit'],
    }),
    forceLogoutUser: b.mutation({ query: (id) => ({ url: `/users/${id}/force-logout`, method: 'POST' }), transformResponse: envelope, invalidatesTags: ['Users', 'Audit'] }),
    endSession: b.mutation({ query: (sessionId) => ({ url: `/users/sessions/${sessionId}/end`, method: 'POST' }), transformResponse: envelope, invalidatesTags: ['Users', 'Audit'] }),
    endAllSessions: b.mutation({ query: () => ({ url: '/users/sessions/end-all', method: 'POST' }), transformResponse: envelope, invalidatesTags: ['Users', 'Audit'] }),
    sendResetLink: b.mutation({ query: (id) => ({ url: `/users/${id}/send-reset-link`, method: 'POST' }), transformResponse: envelope, invalidatesTags: ['Audit'] }),

    // ── Roles & permissions ──────────────────────────────────────────────────
    getRoles: b.query({ query: () => '/roles', transformResponse: envelope, providesTags: ['Roles'] }),
    getPermissions: b.query({ query: () => '/permissions', transformResponse: envelope }),
    setRolePermissions: b.mutation({
      query: ({ code, permissions }) => ({ url: `/roles/${code}/permissions`, method: 'PUT', body: { permissions } }),
      transformResponse: envelope,
      invalidatesTags: ['Roles', 'Me'],
    }),
    createRole: b.mutation({
      query: (body) => ({ url: '/roles', method: 'POST', body }),
      transformResponse: envelope,
      invalidatesTags: ['Roles', 'Lookups'],
    }),
    updateRole: b.mutation({
      query: ({ code, ...body }) => ({ url: `/roles/${code}`, method: 'PATCH', body }),
      transformResponse: envelope,
      invalidatesTags: ['Roles', 'Lookups', 'Me'],
    }),
    deleteRole: b.mutation({
      query: (code) => ({ url: `/roles/${code}`, method: 'DELETE' }),
      transformResponse: envelope,
      invalidatesTags: ['Roles', 'Lookups'],
    }),

    // ── Audit ────────────────────────────────────────────────────────────────
    getAuditChanges: b.query({
      query: (params) => ({ url: '/audit/changes', params }),
      transformResponse: pagedEnvelope,
      providesTags: ['Audit'],
    }),
    getAuthEvents: b.query({
      query: (params) => ({ url: '/audit/auth-events', params }),
      transformResponse: pagedEnvelope,
      providesTags: ['Audit'],
    }),
    getAuditTables: b.query({ query: () => '/audit/tables', transformResponse: envelope }),
  }),
});

export const {
  useGetUsersQuery,
  useGetUserQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useSetUserRolesMutation,
  useResetPasswordMutation,
  useUnlockUserMutation,
  useGetUserSummaryQuery,
  useGetActiveSessionsQuery,
  useGetUserSessionsQuery,
  useLockUserMutation,
  useForceLogoutUserMutation,
  useEndSessionMutation,
  useEndAllSessionsMutation,
  useSendResetLinkMutation,
  useGetRolesQuery,
  useGetPermissionsQuery,
  useSetRolePermissionsMutation,
  useCreateRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
  useGetAuditChangesQuery,
  useGetAuthEventsQuery,
  useGetAuditTablesQuery,
} = adminApi;
