import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

/** Defect notifications, notifications, reports and dashboard (Sprint E). */
export const dnApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Dn', 'Imir', 'Tasks', 'Notifications', 'Dashboard'] })
  .injectEndpoints({
    endpoints: (b) => ({
      getDns: b.query({ query: (params) => ({ url: '/dns', params }), transformResponse: pagedEnvelope, providesTags: ['Dn'] }),
      getDnCounts: b.query({ query: (params) => ({ url: '/dns/counts', params }), transformResponse: envelope, providesTags: ['Dn'] }),
      getDn: b.query({ query: (id) => `/dns/${id}`, transformResponse: envelope, providesTags: (_r, _e, id) => [{ type: 'Dn', id }] }),
      getDnSource: b.query({ query: (id) => `/dns/${id}/source`, transformResponse: envelope, keepUnusedDataFor: 0 }),
      createDn: b.mutation({ query: (body) => ({ url: '/dns', method: 'POST', body }), transformResponse: envelope, invalidatesTags: ['Dn', 'Imir', 'Dashboard'] }),
      updateDn: b.mutation({
        query: ({ id, ...body }) => ({ url: `/dns/${id}`, method: 'PUT', body }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => ['Dn', { type: 'Dn', id }],
      }),
      dnAction: b.mutation({
        query: ({ id, ...body }) => ({ url: `/dns/${id}/actions`, method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => ['Dn', { type: 'Dn', id }, 'Imir', 'Tasks', 'Dashboard'],
      }),
      uploadDnFile: b.mutation({
        query: ({ id, formData }) => ({ url: `/dns/${id}/attachments`, method: 'POST', body: formData }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => [{ type: 'Dn', id }],
      }),
      deleteDnFile: b.mutation({ query: ({ fileId }) => ({ url: `/files/${fileId}`, method: 'DELETE' }), invalidatesTags: (_r, _e, { dnId }) => [{ type: 'Dn', id: dnId }] }),
      mailDnToSelf: b.mutation({ query: (id) => ({ url: `/dns/${id}/mail-self`, method: 'POST' }), transformResponse: envelope }),

      getNotifications: b.query({ query: () => '/notifications', transformResponse: (r) => ({ items: r.data, unread: r.meta.unread }), providesTags: ['Notifications'] }),
      readNotification: b.mutation({ query: (id) => ({ url: `/notifications/${id}/read`, method: 'POST' }), invalidatesTags: ['Notifications'] }),
      readAllNotifications: b.mutation({ query: () => ({ url: '/notifications/read-all', method: 'POST' }), invalidatesTags: ['Notifications'] }),

      getReports: b.query({ query: () => '/reports', transformResponse: envelope }),
      getReport: b.query({ query: ({ key, ...params }) => ({ url: `/reports/${key}`, params }), transformResponse: envelope }),
      getDashboard: b.query({ query: () => '/dashboard/summary', transformResponse: envelope, providesTags: ['Dashboard'] }),
    }),
  });

export const {
  useGetDnsQuery,
  useGetDnQuery,
  useGetDnSourceQuery,
  useCreateDnMutation,
  useUpdateDnMutation,
  useDnActionMutation,
  useUploadDnFileMutation,
  useDeleteDnFileMutation,
  useMailDnToSelfMutation,
  useGetNotificationsQuery,
  useReadNotificationMutation,
  useReadAllNotificationsMutation,
  useGetReportsQuery,
  useGetReportQuery,
  useGetDashboardQuery,
  useGetDnCountsQuery,
} = dnApi;
