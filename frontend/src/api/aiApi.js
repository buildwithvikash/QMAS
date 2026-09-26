import { baseApi, envelope } from './baseApi.js';

/** Quality insights (history, drift, risk; no AI) and the Claude-backed AI features. */
export const aiApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Insights', 'AiStatus'] })
  .injectEndpoints({
    endpoints: (b) => ({
      getAiStatus: b.query({ query: () => '/ai/status', transformResponse: envelope, providesTags: ['AiStatus'] }),
      getLotInsights: b.query({ query: (id) => `/insights/imirs/${id}`, transformResponse: envelope, providesTags: (_r, _e, id) => [{ type: 'Insights', id }] }),
      getInsightsOverview: b.query({ query: () => '/insights/overview', transformResponse: envelope, providesTags: ['Insights'] }),
      imirSummary: b.mutation({ query: ({ id, refresh }) => ({ url: `/ai/imirs/${id}/summary`, method: 'POST', body: { refresh: !!refresh } }), transformResponse: envelope }),
      capaAssessment: b.mutation({ query: ({ id, refresh, cycleNo }) => ({ url: `/ai/dns/${id}/capa-assessment`, method: 'POST', body: { refresh: !!refresh, ...(cycleNo ? { cycleNo } : {}) } }), transformResponse: envelope }),
      rootCause: b.mutation({ query: ({ id, refresh }) => ({ url: `/ai/dns/${id}/root-cause`, method: 'POST', body: { refresh: !!refresh } }), transformResponse: envelope }),
      aiSearch: b.mutation({ query: (q) => ({ url: '/ai/search', method: 'POST', body: { q } }), transformResponse: envelope }),
      aiChat: b.mutation({ query: (messages) => ({ url: '/ai/chat', method: 'POST', body: { messages } }), transformResponse: envelope }),
      tidyObservation: b.mutation({ query: (body) => ({ url: '/ai/observations/tidy', method: 'POST', body }), transformResponse: envelope }),
    }),
  });

export const {
  useGetAiStatusQuery,
  useGetLotInsightsQuery,
  useGetInsightsOverviewQuery,
  useImirSummaryMutation,
  useCapaAssessmentMutation,
  useRootCauseMutation,
  useAiSearchMutation,
  useAiChatMutation,
  useTidyObservationMutation,
} = aiApi;
