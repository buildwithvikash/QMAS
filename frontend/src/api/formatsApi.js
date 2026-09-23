import { baseApi, envelope, pagedEnvelope } from './baseApi.js';

const versionTag = (id) => ({ type: 'FormatVersion', id });

export const formatsApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Formats', 'FormatVersion'] })
  .injectEndpoints({
    endpoints: (b) => ({
      getFormatLibrary: b.query({ query: (params) => ({ url: '/formats', params }), transformResponse: pagedEnvelope, providesTags: ['Formats'] }),
      getApprovalQueue: b.query({ query: () => '/formats/queue', transformResponse: envelope, providesTags: ['Formats'] }),
      getItemFormat: b.query({ query: (itemId) => `/formats/items/${itemId}`, transformResponse: envelope, providesTags: ['Formats'] }),
      getFormatVersion: b.query({ query: (id) => `/formats/versions/${id}`, transformResponse: envelope, providesTags: (_r, _e, id) => [versionTag(id)] }),
      compareVersions: b.query({ query: ({ a, b: bId }) => ({ url: '/formats/compare', params: { a, b: bId } }), transformResponse: envelope, providesTags: ['Formats'] }),
      getMergePreview: b.query({ query: (id) => `/formats/versions/${id}/merge-preview`, transformResponse: envelope, providesTags: ['Formats'] }),
      sanLookup: b.query({ query: (params) => ({ url: '/formats/san-lookup', params }), transformResponse: envelope }),

      createDraft: b.mutation({
        query: ({ itemId, ...body }) => ({ url: `/formats/items/${itemId}/drafts`, method: 'POST', body }),
        transformResponse: envelope,
        invalidatesTags: ['Formats'],
      }),
      saveDraft: b.mutation({
        query: ({ id, ...body }) => ({ url: `/formats/versions/${id}`, method: 'PUT', body }),
        transformResponse: envelope,
        invalidatesTags: (_r, _e, { id }) => ['Formats', versionTag(id)],
      }),
      formatAction: b.mutation({
        query: ({ id, ...body }) => ({ url: `/formats/versions/${id}/actions`, method: 'POST', body }),
        transformResponse: envelope,
        // Approval can change other versions (superseded, queue), so refresh all format data.
        invalidatesTags: ['Formats', 'FormatVersion'],
      }),
      resolveConflicts: b.mutation({
        query: ({ id, ...body }) => ({ url: `/formats/versions/${id}/conflicts`, method: 'PUT', body }),
        transformResponse: envelope,
        invalidatesTags: ['Formats', 'FormatVersion'],
      }),
      checkImport: b.mutation({ query: (formData) => ({ url: '/formats/import/check', method: 'POST', body: formData }), transformResponse: envelope }),
      runImport: b.mutation({ query: (formData) => ({ url: '/formats/import', method: 'POST', body: formData }), transformResponse: envelope, invalidatesTags: ['Formats', 'Master'] }),
    }),
  });

export const {
  useGetFormatLibraryQuery,
  useGetApprovalQueueQuery,
  useGetItemFormatQuery,
  useGetFormatVersionQuery,
  useCompareVersionsQuery,
  useGetMergePreviewQuery,
  useLazySanLookupQuery,
  useCreateDraftMutation,
  useSaveDraftMutation,
  useFormatActionMutation,
  useResolveConflictsMutation,
  useCheckImportMutation,
  useRunImportMutation,
} = formatsApi;

/** Downloads the import template (a file response, so not through RTK Query). */
export async function downloadImportTemplate() {
  const res = await fetch('/api/v1/formats/import/template', { credentials: 'include' });
  if (!res.ok) throw new Error(res.status === 401 ? 'Your session has ended. Sign in again.' : 'Could not download the template.');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: 'QMAS-format-import-template.xlsx' });
  a.click();
  URL.revokeObjectURL(url);
}
