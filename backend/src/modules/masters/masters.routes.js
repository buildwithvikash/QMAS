import { Router } from 'express';
import {
  itemCreateSchema,
  itemUpdateSchema,
  lookupCreateSchema,
  lookupUpdateSchema,
  PERMISSIONS,
  plantCreateSchema,
  plantUpdateSchema,
  vendorCreateSchema,
  vendorUpdateSchema,
} from '@qmas/shared';
import { requirePermission } from '../../middlewares/auth.js';
import { ok } from '../../shared/http.js';
import { crudRouter } from './crud.js';
import { checkItemRefs, checkPlantDeactivation, getLookups } from './masters.service.js';

const META = 'x.id, x.is_active, x.created_at, x.updated_at, x.row_version';

const lookup = (label, table) =>
  crudRouter({
    label,
    table,
    writable: { code: 'code', name: 'name', isActive: 'is_active' },
    select: `${META}, x.code, x.name`,
    search: ['x.code', 'x.name'],
    sortable: { code: 'x.code', name: 'x.name' },
    defaultSort: 'code',
    createSchema: lookupCreateSchema,
    updateSchema: lookupUpdateSchema,
  });

const router = Router();

router.use(
  '/plants',
  crudRouter({
    label: 'Plant',
    table: 'core.plant',
    writable: { sapCode: 'sap_code', shortCode: 'short_code', name: 'name', isActive: 'is_active' },
    select: `${META}, x.sap_code, x.short_code, x.name`,
    search: ['x.sap_code', 'x.short_code', 'x.name'],
    sortable: { sapCode: 'x.sap_code', shortCode: 'x.short_code', name: 'x.name' },
    defaultSort: 'sapCode',
    createSchema: plantCreateSchema,
    updateSchema: plantUpdateSchema,
    beforeWrite: checkPlantDeactivation,
  }),
);
router.use('/uoms', lookup('Unit of measure', 'mst.uom'));
router.use('/instruments', lookup('Instrument', 'mst.instrument'));
router.use('/item-categories', lookup('Item category', 'mst.item_category'));

router.use(
  '/vendors',
  crudRouter({
    label: 'Vendor',
    table: 'mst.vendor',
    writable: { vendorCode: 'vendor_code', name: 'name', isActive: 'is_active' },
    select: `${META}, x.vendor_code, x.name, x.source`,
    search: ['x.vendor_code', 'x.name'],
    sortable: { vendorCode: 'x.vendor_code', name: 'x.name' },
    defaultSort: 'vendorCode',
    createSchema: vendorCreateSchema,
    updateSchema: vendorUpdateSchema,
  }),
);

router.use(
  '/items',
  crudRouter({
    label: 'Item',
    table: 'mst.item',
    writable: {
      itemCode: 'item_code', description: 'description', categoryId: 'category_id', uomId: 'uom_id',
      drawingNo: 'drawing_no', drawingRev: 'drawing_rev', isActive: 'is_active',
    },
    from: 'mst.item x LEFT JOIN mst.item_category c ON c.id = x.category_id LEFT JOIN mst.uom u ON u.id = x.uom_id',
    select: `${META}, x.item_code, x.description, x.category_id, c.name AS category_name, x.uom_id, u.code AS uom_code,
             x.drawing_no, x.drawing_rev, x.windchill_synced_at, x.source`,
    search: ['x.item_code', 'x.description'],
    sortable: { itemCode: 'x.item_code', description: 'x.description', categoryName: 'c.name' },
    defaultSort: 'itemCode',
    createSchema: itemCreateSchema,
    updateSchema: itemUpdateSchema,
    beforeWrite: checkItemRefs,
  }),
);

router.get('/lookups', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (_req, res) => ok(res, await getLookups()));

export default router;
