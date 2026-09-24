import { baseApi, envelope } from './baseApi.js';

/** Global search across IMIRs, deviations, DNs, items and vendors (Ctrl+K). */
export const searchApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    search: b.query({ query: (q) => ({ url: '/search', params: { q } }), transformResponse: envelope, keepUnusedDataFor: 30 }),
  }),
});

export const { useSearchQuery } = searchApi;
