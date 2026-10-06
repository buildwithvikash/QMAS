import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

/** Reversal requests: asked on a record page, decided by an admin (Administration → Reversal Requests). */
export const reversalApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Reversal', 'Imir', 'Deviation', 'Dn', 'Tasks'] })
  .injectEndpoints({
    endpoints: (b) => ({
      getRecordReversal: b.query({
        query: ({ entityType, entityId }) => `/reversals/record/${entityType}/${entityId}`,
        transformResponse: envelope,
        providesTags: (_r, _e, { entityId }) => [{ type: 'Reversal', id: entityId }, 'Reversal'],
      }),
      getMyReversals: b.query({ query: () => '/reversals/mine', transformResponse: envelope, providesTags: ['Reversal'] }),
      requestReversal: b.mutation({
        query: (body) => ({ url: '/reversals', method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: ['Reversal', 'Imir', 'Deviation', 'Dn'],
      }),
      withdrawReversal: b.mutation({
        query: (id) => ({ url: `/reversals/${id}/withdraw`, method: 'POST' }),
        transformResponse: envelope,
        invalidatesTags: ['Reversal'],
      }),
      getReversals: b.query({ query: (params) => ({ url: '/reversals', params }), transformResponse: pagedEnvelope, providesTags: ['Reversal'] }),
      getReversal: b.query({ query: (id) => `/reversals/${id}`, transformResponse: envelope, providesTags: ['Reversal'] }),
      approveReversal: b.mutation({
        query: ({ id, ...body }) => ({ url: `/reversals/${id}/approve`, method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: ['Reversal', 'Imir', 'Deviation', 'Dn', 'Tasks'],
      }),
      rejectReversal: b.mutation({
        query: ({ id, ...body }) => ({ url: `/reversals/${id}/reject`, method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: ['Reversal', 'Imir', 'Deviation', 'Dn'],
      }),
    }),
  });

export const {
  useGetRecordReversalQuery,
  useGetMyReversalsQuery,
  useRequestReversalMutation,
  useWithdrawReversalMutation,
  useGetReversalsQuery,
  useGetReversalQuery,
  useApproveReversalMutation,
  useRejectReversalMutation,
} = reversalApi;
