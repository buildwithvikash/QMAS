import {
  lookupCreateSchema,
  lookupUpdateSchema,
  plantCreateSchema,
  plantUpdateSchema,
} from '@qmas/shared';
import { Factory, Gauge } from 'lucide-react';

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
