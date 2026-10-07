import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

/** Review, deviation, escalation and My Tasks (Sprint D). */
export const workflowApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Imir', 'Deviation', 'Tasks'] })
  .injectEndpoints({
    endpoints: (b) => ({
      imirAction: b.mutation({
        query: ({ id, ...body }) => ({ url: `/imirs/${id}/actions`, method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => ['Imir', { type: 'Imir', id }, 'Deviation', 'Tasks'],
      }),
      getDeviations: b.query({ query: (params) => ({ url: '/deviations', params }), transformResponse: pagedEnvelope, providesTags: ['Deviation'] }),
      getDeviationCounts: b.query({ query: (params) => ({ url: '/deviations/counts', params }), transformResponse: envelope, providesTags: ['Deviation'] }),
      getDeviation: b.query({ query: (id) => `/deviations/${id}`, transformResponse: envelope, providesTags: (_r, _e, id) => [{ type: 'Deviation', id }] }),
      deviationAction: b.mutation({
        query: ({ id, ...body }) => ({ url: `/deviations/${id}/actions`, method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => ['Deviation', { type: 'Deviation', id }, 'Imir', 'Tasks'],
      }),
      setDeviationInchargeRemark: b.mutation({
        query: ({ id, ...body }) => ({ url: `/deviations/${id}/incharge-remark`, method: 'PUT', body }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => [{ type: 'Deviation', id }],
      }),
      getMyTasks: b.query({ query: () => '/tasks/me', transformResponse: envelope, providesTags: ['Tasks'] }),
      getMyRecent: b.query({ query: () => '/tasks/recent', transformResponse: envelope, providesTags: ['Tasks'] }),
    }),
  });

export const {
  useImirActionMutation,
  useGetDeviationsQuery,
  useGetDeviationQuery,
  useDeviationActionMutation,
  useSetDeviationInchargeRemarkMutation,
  useGetMyTasksQuery,
  useGetMyRecentQuery,
  useGetDeviationCountsQuery,
} = workflowApi;
