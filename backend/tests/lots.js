import { expect } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { adminAgent, agentWithRoles, plantId, uid } from './helpers.js';

/** Fixtures for tests that need real lots: SAP mock lots, approved formats, inspected IMIRs. */

let admin;
export const getAdmin = async () => (admin ??= (await adminAgent()).agent);

/** Queues a simulated QA32 lot and runs the SAP pull. Returns the IMIR created for it. */
export async function inwardLot({ itemCode, vendorCode = 'V100', qty = 500, plant = '1115', description = 'Test bracket' }) {
  const a = await getAdmin();
  const lot = await a.post('/api/v1/integration/sap/mock-lots').send({
    plantSapCode: plant, itemCode, itemDescription: description, itemCategory: 'Sheet Metal', uom: 'nos',
    vendorCode, vendorName: `Vendor ${vendorCode}`, grnNo: uid('GRN'), grnDate: '2026-09-23', invoiceNo: uid('INV'), inwardQty: qty,
  });
  expect(lot.status).toBe(201);
  const sync = await a.post('/api/v1/integration/sap/sync');
  expect(sync.status).toBe(200);
  const { rows } = await getPool().query(
    'SELECT m.id FROM qms.imir m JOIN intg.sap_inspection_lot l ON l.id = m.sap_lot_id WHERE l.sap_lot_no = $1',
    [lot.body.data.sapLotNo],
  );
  return { imirId: rows[0]?.id, sync: sync.body.data, sapLotNo: lot.body.data.sapLotNo };
}

export const DIM = { section: 'DIMENSIONAL', checkpoint: 'Dia', specification: '10 ± 0.1', nominal: 10, lsl: 9.9, usl: 10.1, uom: 'mm', instrument: 'DVC' };
export const VIS = { section: 'VISUAL', checkpoint: 'Aesthetic', specification: 'No burr', instrument: 'Visual' };
export const REL = { section: 'RELIABILITY', checkpoint: 'Static load', specification: '200 kg for 5 min', frequencyMonths: 6 };

/** Creates the item (if needed) and approves a format for it through the API. */
export async function approveFormat(itemCode, checkpoints = [DIM, VIS]) {
  const { agent: hd } = await agentWithRoles([{ roleCode: 'IQC_HEAD', plantId: await plantId('1115') }]);
  let { rows } = await getPool().query('SELECT id FROM mst.item WHERE item_code = $1', [itemCode]);
  if (!rows[0]) ({ rows } = await getPool().query("INSERT INTO mst.item (item_code, description) VALUES ($1, 'Test bracket') RETURNING id", [itemCode]));
  const d = (await hd.post(`/api/v1/formats/items/${rows[0].id}/drafts`).send({ from: 'BLANK' })).body.data;
  const s = (await hd.put(`/api/v1/formats/versions/${d.id}`).send({ checkpoints, rowVersion: d.rowVersion, refStandard: 'IS 2500' })).body.data;
  const p = (await hd.post(`/api/v1/formats/versions/${s.id}/actions`).send({ action: 'submit', rowVersion: s.rowVersion })).body.data.version;
  const a = await hd.post(`/api/v1/formats/versions/${p.id}/actions`).send({ action: 'approve', rowVersion: p.rowVersion });
  expect(a.body.data.outcome.result).toBe('APPROVED');
  return a.body.data.version;
}

export const inspector = async (plant = '1115') => agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId(plant) }]);
export const cellsFor = (imir, section, values) => {
  const cp = imir.checkpoints.find((c) => c.section === section);
  return values.map((v, i) => (section === 'DIMENSIONAL' ? { checkpointUid: cp.uid, sampleNo: i + 1, value: v } : { checkpointUid: cp.uid, sampleNo: i + 1, ok: v }));
};

