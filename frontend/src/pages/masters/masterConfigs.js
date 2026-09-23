import {
  itemCreateSchema,
  itemUpdateSchema,
  lookupCreateSchema,
  lookupUpdateSchema,
  plantCreateSchema,
  plantUpdateSchema,
  vendorCreateSchema,
  vendorUpdateSchema,
} from '@qmas/shared';
import { Building2, Factory, Gauge, Package, Ruler, Tags } from 'lucide-react';

/**
 * One entry per simple master. Fields drive both the table and the add/edit form:
 *   { name, label, type: 'text' | 'code' | 'select', required, list?, sortable?, lookup?, width?, hint?, readOnlyOnEdit? }
 * `lookup` names a list from /masters/lookups for select options.
 */
const lookupFields = [
  { name: 'code', label: 'Code', type: 'code', required: true, list: true, sortable: true, mono: true },
  { name: 'name', label: 'Name', type: 'text', required: true, list: true, sortable: true },
];

export const MASTER_CONFIGS = {
  plants: {
    title: 'Plants',
    subtitle: 'Plant codes used for plant-wise access and document numbers',
    icon: Factory,
    singular: 'plant',
    defaultSort: 'sapCode',
    createSchema: plantCreateSchema,
    updateSchema: plantUpdateSchema,
    fields: [
      { name: 'sapCode', label: 'SAP plant code', type: 'text', required: true, list: true, sortable: true, mono: true, inputMode: 'numeric', hint: '4 digits, e.g. 1115' },
      { name: 'shortCode', label: 'Short code', type: 'text', required: true, list: true, sortable: true, mono: true, inputMode: 'numeric', hint: '2 digits, used by numbering option 2' },
      { name: 'name', label: 'Plant name', type: 'text', required: true, list: true, sortable: true },
    ],
  },
  vendors: {
    title: 'Vendors',
    subtitle: 'Suppliers; normally filled from SAP inward data',
    icon: Building2,
    singular: 'vendor',
    defaultSort: 'vendorCode',
    createSchema: vendorCreateSchema,
    updateSchema: vendorUpdateSchema,
    fields: [
      { name: 'vendorCode', label: 'Vendor code', type: 'code', required: true, list: true, sortable: true, mono: true, readOnlyOnEdit: true },
      { name: 'name', label: 'Vendor name', type: 'text', required: true, list: true, sortable: true },
    ],
    extraColumns: [{ key: 'source', header: 'Source' }],
  },
  items: {
    title: 'Items',
    subtitle: 'Item codes; each has one inspection format',
    icon: Package,
    singular: 'item',
    defaultSort: 'itemCode',
    searchPlaceholder: 'Search item code or description…',
    createSchema: itemCreateSchema,
    updateSchema: itemUpdateSchema,
    fields: [
      { name: 'itemCode', label: 'Item code', type: 'code', required: true, list: true, sortable: true, mono: true, readOnlyOnEdit: true },
      { name: 'description', label: 'Description', type: 'text', required: true, list: true, sortable: true, wide: true },
      { name: 'categoryId', label: 'Category', type: 'select', lookup: 'itemCategories', listKey: 'categoryName', list: true, sortKey: 'categoryName' },
      { name: 'uomId', label: 'Unit of measure', type: 'select', lookup: 'uoms', listKey: 'uomCode', list: true },
      { name: 'drawingNo', label: 'Drawing no.', type: 'text', list: true, mono: true, hint: 'Filled from Windchill once connected' },
      { name: 'drawingRev', label: 'Drawing revision', type: 'text' },
    ],
  },
  'item-categories': {
    title: 'Item Categories',
    subtitle: 'Groups of items',
    icon: Tags,
    singular: 'item category',
    defaultSort: 'code',
    createSchema: lookupCreateSchema,
    updateSchema: lookupUpdateSchema,
    fields: lookupFields,
  },
  uoms: {
    title: 'Units of Measure',
    subtitle: 'Units for quantities and specifications',
    icon: Ruler,
    singular: 'unit',
    defaultSort: 'code',
    createSchema: lookupCreateSchema,
    updateSchema: lookupUpdateSchema,
    fields: lookupFields,
  },
  instruments: {
    title: 'Instruments',
    subtitle: 'Measuring instruments and methods used in inspection formats',
    icon: Gauge,
    singular: 'instrument',
    defaultSort: 'code',
    createSchema: lookupCreateSchema,
    updateSchema: lookupUpdateSchema,
    fields: lookupFields,
  },
};
