import { describe, expect, it } from 'vitest';
import { adminAgent, agentWithRoles, plantId, uid } from './helpers.js';

describe('master data', () => {
  it('has the seven blueprint plants with SAP and short codes', async () => {
    const { agent } = await adminAgent();
    const res = await agent.get('/api/v1/masters/plants').query({ pageSize: 50 });
    const byCode = Object.fromEntries(res.body.data.map((p) => [p.sapCode, p]));
    expect(byCode['1115']).toMatchObject({ shortCode: '03', name: 'Sanjan' });
    expect(byCode['1179']).toMatchObject({ shortCode: '08', name: 'Tumb FG 1' });
    expect(Object.keys(byCode)).toEqual(expect.arrayContaining(['1111', '1115', '1120', '1125', '1130', '1179', '1191']));
  });

  it('creates items with category and UOM, and finds them by partial code or description', async () => {
    const { agent } = await adminAgent();
    const cat = (await agent.post('/api/v1/masters/item-categories').send({ code: uid('cat'), name: 'Sheet metal' })).body.data;
    const uom = (await agent.post('/api/v1/masters/uoms').send({ code: uid('U'), name: 'Numbers' })).body.data;
    const itemCode = uid('ITM');
    const res = await agent.post('/api/v1/masters/items').send({
      itemCode: itemCode.toLowerCase(), description: 'Compressor mounting bracket', categoryId: cat.id, uomId: uom.id, drawingNo: 'DWG-1528550',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ itemCode, categoryName: 'Sheet metal', uomCode: uom.code, drawingNo: 'DWG-1528550', isActive: true });

    const byCode = await agent.get('/api/v1/masters/items').query({ q: itemCode.slice(2, 8).toLowerCase() });
    expect(byCode.body.data.map((i) => i.itemCode)).toContain(itemCode);
    const byDesc = await agent.get('/api/v1/masters/items').query({ q: 'mounting brack' });
    expect(byDesc.body.data.map((i) => i.itemCode)).toContain(itemCode);
  });

  it('treats search text literally (no LIKE wildcards)', async () => {
    const { agent } = await adminAgent();
    const res = await agent.get('/api/v1/masters/items').query({ q: '%' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('PATCH only changes the fields sent', async () => {
    const { agent } = await adminAgent();
    const v = (await agent.post('/api/v1/masters/vendors').send({ vendorCode: uid('V'), name: 'Acme Metals', isActive: false })).body.data;
    const renamed = await agent.patch(`/api/v1/masters/vendors/${v.id}`).send({ name: 'Acme Metals Pvt Ltd', rowVersion: v.rowVersion });
    expect(renamed.body.data).toMatchObject({ name: 'Acme Metals Pvt Ltd', isActive: false, rowVersion: v.rowVersion + 1 });

    const cat = (await agent.post('/api/v1/masters/item-categories').send({ code: uid('C'), name: 'Plastics' })).body.data;
    const item = (await agent.post('/api/v1/masters/items').send({ itemCode: uid('I'), description: 'Knob', categoryId: cat.id })).body.data;
    const edited = await agent.patch(`/api/v1/masters/items/${item.id}`).send({ description: 'Control knob', rowVersion: item.rowVersion });
    expect(edited.body.data).toMatchObject({ description: 'Control knob', categoryId: cat.id });
  });

  it('rejects stale versions, duplicates and inactive references', async () => {
    const { agent } = await adminAgent();
    const code = uid('V');
    const v = (await agent.post('/api/v1/masters/vendors').send({ vendorCode: code, name: 'Vendor A' })).body.data;
    await agent.patch(`/api/v1/masters/vendors/${v.id}`).send({ name: 'Vendor A1', rowVersion: v.rowVersion });
    expect((await agent.patch(`/api/v1/masters/vendors/${v.id}`).send({ name: 'Vendor A2', rowVersion: v.rowVersion })).status).toBe(409);
    const dup = await agent.post('/api/v1/masters/vendors').send({ vendorCode: code, name: 'Other' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe(`Vendor code "${code}" already exists.`);

    const cat = (await agent.post('/api/v1/masters/item-categories').send({ code: uid('C'), name: 'Old', isActive: false })).body.data;
    const item = await agent.post('/api/v1/masters/items').send({ itemCode: uid('I'), description: 'X', categoryId: cat.id });
    expect(item.status).toBe(422);
    expect(item.body.errors).toEqual([{ path: 'categoryId', message: 'Choose an active item category.' }]);
  });

  it('validates plant codes and blocks deactivating a plant in use', async () => {
    const { agent } = await adminAgent();
    const bad = await agent.post('/api/v1/masters/plants').send({ sapCode: '11A5', shortCode: '9', name: 'Bad' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e) => e.path)).toEqual(['sapCode', 'shortCode']);

    await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId('1125') }]);
    const plant = (await agent.get(`/api/v1/masters/plants/${await plantId('1125')}`)).body.data;
    const res = await agent.patch(`/api/v1/masters/plants/${plant.id}`).send({ isActive: false, rowVersion: plant.rowVersion });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/role assignment\(s\) still use this plant/);
  });

  it('needs masters.manage to write and masters.view to read', async () => {
    const { agent: inspector } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId() }]);
    expect((await inspector.get('/api/v1/masters/vendors')).status).toBe(200);
    expect((await inspector.post('/api/v1/masters/vendors').send({ vendorCode: uid('V'), name: 'X' })).status).toBe(403);
    const { agent: scm } = await agentWithRoles([{ roleCode: 'SCM_REQUESTOR', plantId: await plantId() }]);
    expect((await scm.get('/api/v1/masters/vendors')).status).toBe(403);
  });

  it('serves all dropdown lists in one call', async () => {
    const { agent } = await agentWithRoles([{ roleCode: 'SCM_REQUESTOR', plantId: await plantId() }]);
    const res = await agent.get('/api/v1/masters/lookups');
    expect(res.status).toBe(200);
    expect(res.body.data.deviationActions.map((a) => a.code)).toEqual(['UAI', 'SEGREGATION', 'REWORK']);
    expect(res.body.data.deviationSeverities.map((a) => a.code)).toEqual(['MINOR', 'MAJOR', 'CRITICAL']);
    expect(res.body.data.escalationAuthorities.map((a) => [a.roleCode, a.rank])).toEqual([
      ['PLANT_HEAD', 1], ['PLANT_QA_HEAD', 2], ['PDC_HEAD', 3], ['CQA_HEAD', 4], ['CENTRAL_OPS_HEAD', 5],
    ]);
  });
});
