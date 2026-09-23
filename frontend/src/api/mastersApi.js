import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

// Plants, vendors, items and the code/name lookups share one generic set of endpoints.
const masterTag = (resource) => ({ type: 'Master', id: resource });

export const mastersApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    getLookups: b.query({ query: () => '/masters/lookups', transformResponse: envelope, providesTags: ['Lookups'] }),

    getMasterList: b.query({
      query: ({ resource, ...params }) => ({ url: `/masters/${resource}`, params }),
      transformResponse: pagedEnvelope,
      providesTags: (_r, _e, { resource }) => [masterTag(resource)],
    }),
    createMaster: b.mutation({
      query: ({ resource, body }) => ({ url: `/masters/${resource}`, method: 'POST', body }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { resource }) => [masterTag(resource), 'Lookups'],
    }),
    updateMaster: b.mutation({
      query: ({ resource, id, body }) => ({ url: `/masters/${resource}/${id}`, method: 'PATCH', body }),
      transformResponse: envelope,
      invalidatesTags: (_r, _e, { resource }) => [masterTag(resource), 'Lookups'],
    }),

    // ── Sampling table ───────────────────────────────────────────────────────
    getSamplingPlans: b.query({ query: () => '/masters/sampling-plans', transformResponse: envelope, providesTags: ['Sampling'] }),
    createSamplingPlan: b.mutation({
      query: (body) => ({ url: '/masters/sampling-plans', method: 'POST', body }),
      transformResponse: envelope,
      invalidatesTags: ['Sampling'],
    }),
    updateSamplingPlan: b.mutation({
      query: ({ id, ...body }) => ({ url: `/masters/sampling-plans/${id}`, method: 'PUT', body }),
      transformResponse: envelope,
      invalidatesTags: ['Sampling'],
    }),
    lookupSample: b.query({
      query: ({ planId = 'default', inwardQty }) => ({ url: `/masters/sampling-plans/${planId}/lookup`, params: { inwardQty } }),
      transformResponse: envelope,
    }),

    // ── Number series ────────────────────────────────────────────────────────
    getNumberSeries: b.query({ query: () => '/masters/number-series', transformResponse: envelope, providesTags: ['NumberSeries'] }),
    createNumberSeries: b.mutation({
      query: (body) => ({ url: '/masters/number-series', method: 'POST', body }),
      transformResponse: envelope,
      invalidatesTags: ['NumberSeries'],
    }),
    setNumberSeriesStatus: b.mutation({
      query: ({ id, ...body }) => ({ url: `/masters/number-series/${id}`, method: 'PATCH', body }),
      transformResponse: envelope,
      invalidatesTags: ['NumberSeries'],
    }),
    previewNumber: b.mutation({
      query: (body) => ({ url: '/masters/number-series/preview', method: 'POST', body }),
      transformResponse: envelope,
    }),
  }),
});

export const {
  useGetLookupsQuery,
  useGetMasterListQuery,
  useCreateMasterMutation,
  useUpdateMasterMutation,
  useGetSamplingPlansQuery,
  useCreateSamplingPlanMutation,
  useUpdateSamplingPlanMutation,
  useLazyLookupSampleQuery,
  useGetNumberSeriesQuery,
  useCreateNumberSeriesMutation,
  useSetNumberSeriesStatusMutation,
  usePreviewNumberMutation,
} = mastersApi;
