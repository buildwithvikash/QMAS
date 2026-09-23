/** Response envelope kept from WRL Tool Report: { success, data, meta? }. */
export const ok = (res, data, meta) => res.status(200).json(meta ? { success: true, data, meta } : { success: true, data });
export const created = (res, data) => res.status(201).json({ success: true, data });
export const noContent = (res) => res.status(204).end();

/** Validated request parts placed by the `validate` middleware. */
export const body = (req) => req.valid?.body ?? {};
export const query = (req) => req.valid?.query ?? {};
export const params = (req) => req.valid?.params ?? {};
