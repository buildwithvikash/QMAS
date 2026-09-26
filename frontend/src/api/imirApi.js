import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

const imirTag = (id) => ({ type: 'Imir', id });

export const imirApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Imir', 'Devices', 'SapSync'] })
  .injectEndpoints({
    endpoints: (b) => ({
      getImirs: b.query({ query: (params) => ({ url: '/imirs', params }), transformResponse: pagedEnvelope, providesTags: ['Imir'] }),
      getImirCounts: b.query({ query: (params) => ({ url: '/imirs/counts', params }), transformResponse: envelope, providesTags: ['Imir'] }),
      getImir: b.query({ query: (id) => `/imirs/${id}`, transformResponse: envelope, providesTags: (_r, _e, id) => [imirTag(id)] }),
      // Field-level change history; refreshed whenever the lot changes.
      getImirChanges: b.query({ query: (id) => `/imirs/${id}/changes`, transformResponse: envelope, providesTags: (_r, _e, id) => [imirTag(id), 'Imir'] }),
      saveInspection: b.mutation({
        query: ({ id, ...body }) => ({ url: `/imirs/${id}/inspection`, method: 'PUT', body }),
        transformResponse: envelope,
        // The screen keeps its own copy while typing; only lists are refreshed.
        invalidatesTags: ['Imir'],
      }),
      submitImir: b.mutation({
        query: ({ id, ...body }) => ({ url: `/imirs/${id}/actions`, method: 'POST', body: { action: 'submit', ...body } }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => ['Imir', imirTag(id)],
      }),
      uploadAttachment: b.mutation({
        query: ({ id, formData }) => ({ url: `/imirs/${id}/attachments`, method: 'POST', body: formData }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => [imirTag(id)],
      }),
      deleteAttachment: b.mutation({
        query: ({ fileId }) => ({ url: `/files/${fileId}`, method: 'DELETE' }),
        invalidatesTags: (_r, _e, { imirId }) => [imirTag(imirId)],
      }),

      // Devices (admin) and tablet setup
      getDevices: b.query({ query: () => '/devices', transformResponse: envelope, providesTags: ['Devices'] }),
      createDevice: b.mutation({ query: (body) => ({ url: '/devices', method: 'POST', body }), transformResponse: envelope, invalidatesTags: ['Devices'] }),
      updateDevice: b.mutation({ query: ({ id, ...body }) => ({ url: `/devices/${id}`, method: 'PATCH', body }), transformResponse: envelope, invalidatesTags: ['Devices', 'Imir'] }),
      releaseLots: b.mutation({ query: (body) => ({ url: '/sync/release', method: 'POST', body }), transformResponse: envelope, invalidatesTags: ['Imir', 'Devices'] }),

      // SAP integration
      getSapStatus: b.query({ query: () => '/integration/sap/status', transformResponse: envelope, providesTags: ['SapSync'] }),
      runSapSync: b.mutation({ query: () => ({ url: '/integration/sap/sync', method: 'POST' }), transformResponse: envelope, invalidatesTags: ['SapSync', 'Imir', 'Master'] }),
      addMockLot: b.mutation({ query: (body) => ({ url: '/integration/sap/mock-lots', method: 'POST', body }), transformResponse: envelope, invalidatesTags: ['SapSync'] }),
    }),
  });

export const {
  useGetImirsQuery,
  useGetImirQuery,
  useGetImirChangesQuery,
  useSaveInspectionMutation,
  useSubmitImirMutation,
  useUploadAttachmentMutation,
  useDeleteAttachmentMutation,
  useGetDevicesQuery,
  useCreateDeviceMutation,
  useUpdateDeviceMutation,
  useReleaseLotsMutation,
  useGetSapStatusQuery,
  useRunSapSyncMutation,
  useAddMockLotMutation,
  useGetImirCountsQuery,
} = imirApi;
