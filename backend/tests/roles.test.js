import { beforeAll, describe, expect, it } from 'vitest';
import { adminAgent, agentWithRoles, plantId, uid } from './helpers.js';

let admin;
const letters = () => uid('').replace(/[^A-Za-z]/g, '').slice(-6) || 'Xyz';

beforeAll(async () => {
  admin = (await adminAgent()).agent;
});

const details = (name) => ({ name, description: 'Checks stores', department: 'Stores', viewScope: 'OWN_PLANT', actionScope: 'PLANT', requiresPlant: true });

describe('custom roles', () => {
  it('adds a role, duplicates another, edits, deactivates and deletes it', async () => {
    const name = `Store Keeper ${letters()}`;
    const created = await admin.post('/api/v1/roles').send({ ...details(name), permissions: ['imir.view'] });
    expect(created.status).toBe(201);
    const role = created.body.data;
    expect(role).toMatchObject({ name, isSystem: false, isActive: true, permissions: ['imir.view'], userCount: 0 });
    expect(role.code).toMatch(/^STORE_KEEPER_[A-Z_]+$/);

    expect((await admin.post('/api/v1/roles').send(details(name.toUpperCase()))).status).toBe(409);

    const copy = await admin.post('/api/v1/roles').send({ ...details(`${name} copy`), copyFrom: 'IQC_INSPECTOR' });
    expect(copy.status).toBe(201);
    const inspector = (await admin.get('/api/v1/roles')).body.data.find((r) => r.code === 'IQC_INSPECTOR');
    expect(copy.body.data.permissions).toEqual(inspector.permissions);

    const edited = await admin.patch(`/api/v1/roles/${role.code}`).send({ description: 'Stores and receiving', viewScope: 'ALL_PLANTS', isActive: false });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ description: 'Stores and receiving', viewScope: 'ALL_PLANTS', isActive: false });
    expect(edited.body.data.updatedByName).toBeTruthy();

    expect((await admin.delete(`/api/v1/roles/${role.code}`)).status).toBe(200);
    expect((await admin.delete(`/api/v1/roles/${copy.body.data.code}`)).status).toBe(200);
    expect((await admin.get('/api/v1/roles')).body.data.some((r) => r.code === role.code)).toBe(false);
  });

  it('keeps built-in roles to description and permissions', async () => {
    expect((await admin.patch('/api/v1/roles/IQC_INSPECTOR').send({ name: 'Inspector' })).status).toBe(422);
    expect((await admin.patch('/api/v1/roles/IQC_INSPECTOR').send({ isActive: false })).status).toBe(422);
    expect((await admin.delete('/api/v1/roles/IQC_INSPECTOR')).status).toBe(422);
    expect((await admin.post('/api/v1/roles').send({ ...details(`Admin copy ${letters()}`), copyFrom: 'SYSTEM_ADMIN' })).status).toBe(422);
    const ok = await admin.patch('/api/v1/roles/AUDITOR').send({ description: 'Read-only access to records and reports' });
    expect(ok.status).toBe(200);
  });

  it('gives nothing while inactive, and cannot be deleted while held', async () => {
    const p = await plantId('1115');
    const role = (await admin.post('/api/v1/roles').send({ ...details(`Viewer ${letters()}`), permissions: ['imir.view'] })).body.data;
    const { agent } = await agentWithRoles([{ roleCode: role.code, plantId: p }]);
    expect((await agent.get('/api/v1/imirs')).status).toBe(200);

    await admin.patch(`/api/v1/roles/${role.code}`).send({ isActive: false });
    expect((await agent.get('/api/v1/imirs')).status).toBe(403);
    expect((await admin.delete(`/api/v1/roles/${role.code}`)).status).toBe(409);

    await admin.patch(`/api/v1/roles/${role.code}`).send({ isActive: true });
    expect((await agent.get('/api/v1/imirs')).status).toBe(200);
  });

  it('only role managers can change roles', async () => {
    const p = await plantId('1115');
    const { agent } = await agentWithRoles([{ roleCode: 'IQC_INCHARGE', plantId: p }]);
    expect((await agent.post('/api/v1/roles').send(details(`Nope ${letters()}`))).status).toBe(403);
  });
});
