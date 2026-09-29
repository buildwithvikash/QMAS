import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

/** System health, error log and mail retry (Administration, system.monitor). */
export const systemApi = baseApi.enhanceEndpoints({ addTagTypes: ['SystemHealth', 'ErrorLog'] }).injectEndpoints({
  endpoints: (b) => ({
    getSystemHealth: b.query({ query: () => '/system/health', transformResponse: envelope, providesTags: ['SystemHealth'] }),
    getErrors: b.query({ query: (params) => ({ url: '/system/errors', params }), transformResponse: pagedEnvelope, providesTags: ['ErrorLog'] }),
    getError: b.query({ query: (id) => `/system/errors/${id}`, transformResponse: envelope, providesTags: (_r, _e, id) => [{ type: 'ErrorLog', id }] }),
    resolveError: b.mutation({
      query: ({ id, note }) => ({ url: `/system/errors/${id}/resolve`, method: 'POST', body: { note } }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { id }) => ['ErrorLog', { type: 'ErrorLog', id }, 'SystemHealth'],
    }),
    reopenError: b.mutation({
      query: (id) => ({ url: `/system/errors/${id}/reopen`, method: 'POST' }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, id) => ['ErrorLog', { type: 'ErrorLog', id }, 'SystemHealth'],
    }),
    resolveAllErrors: b.mutation({ query: (note) => ({ url: '/system/errors/resolve-all', method: 'POST', body: { note } }), transformResponse: envelope, invalidatesTags: ['ErrorLog', 'SystemHealth'] }),
    retryFailedMail: b.mutation({ query: () => ({ url: '/system/mail/retry-failed', method: 'POST' }), transformResponse: envelope, invalidatesTags: ['SystemHealth'] }),
  }),
});

export const {
  useGetSystemHealthQuery, useGetErrorsQuery, useGetErrorQuery, useResolveErrorMutation, useReopenErrorMutation, useResolveAllErrorsMutation, useRetryFailedMailMutation,
} = systemApi;
