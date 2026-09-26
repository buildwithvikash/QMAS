import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

/** Review, deviation, escalation and My Tasks (Sprint D). */
export const workflowApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Imir', 'Deviation', 'Tasks', 'DeptChain'] })
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
      getMyTasks: b.query({ query: () => '/tasks/me', transformResponse: envelope, providesTags: ['Tasks'] }),
      getMyRecent: b.query({ query: () => '/tasks/recent', transformResponse: envelope, providesTags: ['Tasks'] }),
      getDeptChains: b.query({ query: () => '/masters/dept-approval-chains', transformResponse: envelope, providesTags: ['DeptChain'] }),
      updateDeptChain: b.mutation({
        query: ({ department, ...body }) => ({ url: `/masters/dept-approval-chains/${department}`, method: 'PUT', body }),
        transformResponse: envelope,
        invalidatesTags: ['DeptChain'],
      }),
    }),
  });

export const {
  useImirActionMutation,
  useGetDeviationsQuery,
  useGetDeviationQuery,
  useDeviationActionMutation,
  useGetMyTasksQuery,
  useGetDeptChainsQuery,
  useUpdateDeptChainMutation,
  useGetMyRecentQuery,
  useGetDeviationCountsQuery,
} = workflowApi;
