import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

/** Network access control: own status, company ranges and external-access grants. */
export const networkApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['NetworkStatus', 'NetworkSettings', 'ExternalAccess'] })
  .injectEndpoints({
    endpoints: (b) => ({
      getNetworkStatus: b.query({ query: () => '/network/status', transformResponse: envelope, providesTags: ['NetworkStatus'] }),
      getNetworkSettings: b.query({ query: () => '/network/settings', transformResponse: envelope, providesTags: ['NetworkSettings'] }),
      saveNetworkSettings: b.mutation({
        query: (body) => ({ url: '/network/settings', method: 'PUT', body }),
        transformResponse: envelope,
        invalidatesTags: ['NetworkSettings', 'NetworkStatus'],
      }),
      getExternalAccess: b.query({ query: (params) => ({ url: '/network/grants', params }), transformResponse: pagedEnvelope, providesTags: ['ExternalAccess'] }),
      grantExternalAccess: b.mutation({
        query: (body) => ({ url: '/network/grants', method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: ['ExternalAccess', 'NetworkStatus'],
      }),
      revokeExternalAccess: b.mutation({
        query: ({ id, ...body }) => ({ url: `/network/grants/${id}/revoke`, method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: ['ExternalAccess', 'NetworkStatus'],
      }),
    }),
  });

export const {
  useGetNetworkStatusQuery,
  useGetNetworkSettingsQuery,
  useSaveNetworkSettingsMutation,
  useGetExternalAccessQuery,
  useGrantExternalAccessMutation,
  useRevokeExternalAccessMutation,
} = networkApi;
