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
      invalidatesTags: (_r, _e, id) => ['Users', { type: 'Users', id }],
    }),

    // ── Roles & permissions ──────────────────────────────────────────────────
    getRoles: b.query({ query: () => '/roles', transformResponse: envelope, providesTags: ['Roles'] }),
    getPermissions: b.query({ query: () => '/permissions', transformResponse: envelope }),
    setRolePermissions: b.mutation({
      query: ({ code, permissions }) => ({ url: `/roles/${code}/permissions`, method: 'PUT', body: { permissions } }),
      transformResponse: envelope,
      invalidatesTags: ['Roles', 'Me'],
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
  useGetRolesQuery,
  useGetPermissionsQuery,
  useSetRolePermissionsMutation,
  useGetAuditChangesQuery,
  useGetAuthEventsQuery,
  useGetAuditTablesQuery,
} = adminApi;
