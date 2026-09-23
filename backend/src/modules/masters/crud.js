import { Router } from 'express';
import { idParam, listQuery, PERMISSIONS } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { txContext, withTransaction } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import { camelRow, camelRows, likeContains, offsetOf, orderBy, pageMeta } from '../../shared/sql.js';

/**
 * Generic master-data resource: list (search, sort, paginate), get, create, optimistic update.
 * Masters are never deleted (history refers to them); they are deactivated with isActive=false.
 *
 * config = {
 *   label: 'Plant', table: 'core.plant', alias: 'x',
 *   writable: { apiField: 'sql_column' },        // only these can be written
 *   select: 'extra select list / joins',          // optional; default x.*
 *   from: 'core.plant x LEFT JOIN ...',           // optional
 *   search: ['x.name', ...], sortable: { apiField: 'sql expr' }, defaultSort: 'name',
 *   createSchema, updateSchema, manage: permission (default masters.manage),
 *   beforeWrite: async (db, data, id?) => void    // optional cross-field checks
 * }
 */
export function crudRepo(cfg) {
  const from = cfg.from ?? `${cfg.table} x`;
  const select = cfg.select ?? 'x.*';

  return {
    async list(db, f) {
      const where = [];
      const args = [];
      const arg = (v) => { args.push(v); return `$${args.length}`; };
      if (f.q && cfg.search?.length) {
        const p = arg(likeContains(f.q));
        where.push(`(${cfg.search.map((c) => `${c} ILIKE ${p}`).join(' OR ')})`);
      }
      if (f.isActive !== undefined) where.push(`x.is_active = ${arg(f.isActive)}`);
      const { rows } = await db.query(
        `SELECT ${select}, count(*) OVER () AS total__
           FROM ${from}
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ${orderBy(cfg.sortable, f.sort, f.order, cfg.defaultSort)}
          LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
        args,
      );
      const total = rows[0]?.total__ ?? 0;
      return { rows: camelRows(rows.map(({ total__, ...r }) => r)), total: Number(total) };
    },

    async get(db, id) {
      const { rows } = await db.query(`SELECT ${select} FROM ${from} WHERE x.id = $1`, [id]);
      return camelRow(rows[0]);
    },

    async insert(db, data, actorId) {
      const cols = Object.keys(cfg.writable).filter((k) => data[k] !== undefined);
      const args = [...cols.map((k) => data[k]), actorId];
      const sql = `INSERT INTO ${cfg.table} (${cols.map((k) => cfg.writable[k]).join(', ')}, created_by, updated_by)
                   VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${args.length}, $${args.length}) RETURNING id`;
      const { rows } = await db.query(sql, args);
      return rows[0].id;
    },

    /** Returns false when rowVersion is stale. */
    async update(db, id, rowVersion, data) {
      const cols = Object.keys(cfg.writable).filter((k) => data[k] !== undefined);
      if (cols.length === 0) return true;
      const args = [id, rowVersion, ...cols.map((k) => data[k])];
      const { rowCount } = await db.query(
        `UPDATE ${cfg.table} SET ${cols.map((k, i) => `${cfg.writable[k]} = $${i + 3}`).join(', ')} WHERE id = $1 AND row_version = $2`,
        args,
      );
      return rowCount === 1;
    },
  };
}

export function crudRouter(cfg) {
  const repo = crudRepo(cfg);
  const router = Router();
  const canView = requirePermission(cfg.view ?? PERMISSIONS.MASTERS_VIEW);
  const canManage = requirePermission(cfg.manage ?? PERMISSIONS.MASTERS_MANAGE);

  router.get('/', canView, validate({ query: cfg.listQuery ?? listQuery }), async (req, res) => {
    const f = query(req);
    const { rows, total } = await repo.list(getPool(), f);
    ok(res, rows, pageMeta(f, total));
  });

  router.get('/:id', canView, validate({ params: idParam }), async (req, res) => {
    const row = await repo.get(getPool(), params(req).id);
    if (!row) throw AppError.notFound(cfg.label);
    ok(res, row);
  });

  router.post('/', canManage, validate({ body: cfg.createSchema }), async (req, res) => {
    const row = await withTransaction(txContext(req), async (db) => {
      await cfg.beforeWrite?.(db, body(req));
      const id = await repo.insert(db, body(req), req.user.id);
      return repo.get(db, id);
    });
    created(res, row);
  });

  router.patch('/:id', canManage, validate({ params: idParam, body: cfg.updateSchema }), async (req, res) => {
    const { id } = params(req);
    const { rowVersion, ...data } = body(req);
    const row = await withTransaction(txContext(req), async (db) => {
      if (!(await repo.get(db, id))) throw AppError.notFound(cfg.label);
      await cfg.beforeWrite?.(db, data, id);
      if (!(await repo.update(db, id, rowVersion, data))) throw AppError.staleVersion(`This ${cfg.label.toLowerCase()}`);
      return repo.get(db, id);
    });
    ok(res, row);
  });

  return router;
}
