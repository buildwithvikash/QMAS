import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

/** Help & Support tickets. */
export const supportApi = baseApi.enhanceEndpoints({ addTagTypes: ['Support'] }).injectEndpoints({
  endpoints: (b) => ({
    getTickets: b.query({ query: (params) => ({ url: '/support/tickets', params }), transformResponse: pagedEnvelope, providesTags: ['Support'] }),
    getTicketCounts: b.query({ query: (scope) => ({ url: '/support/tickets/counts', params: { scope } }), transformResponse: envelope, providesTags: ['Support'] }),
    getTicket: b.query({ query: (id) => `/support/tickets/${id}`, transformResponse: envelope, providesTags: (_r, _e, id) => [{ type: 'Support', id }] }),
    getSupportTeam: b.query({ query: () => '/support/team', transformResponse: envelope }),
    createTicket: b.mutation({ query: (body) => ({ url: '/support/tickets', method: 'POST', body }), transformResponse: envelope, invalidatesTags: ['Support'] }),
    commentTicket: b.mutation({
      query: ({ id, ...body }) => ({ url: `/support/tickets/${id}/comments`, method: 'POST', body }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { id }) => ['Support', { type: 'Support', id }],
    }),
    updateTicket: b.mutation({
      query: ({ id, ...body }) => ({ url: `/support/tickets/${id}`, method: 'PATCH', body }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { id }) => ['Support', { type: 'Support', id }],
    }),
    uploadTicketFile: b.mutation({
      query: ({ id, formData }) => ({ url: `/support/tickets/${id}/attachments`, method: 'POST', body: formData }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Support', id }],
    }),
  }),
});

export const {
  useGetTicketsQuery, useGetTicketCountsQuery, useGetTicketQuery, useGetSupportTeamQuery,
  useCreateTicketMutation, useCommentTicketMutation, useUpdateTicketMutation, useUploadTicketFileMutation,
} = supportApi;

export const ticketFileUrl = (ticketId, fileId) => `/api/v1/support/tickets/${ticketId}/attachments/${fileId}`;
