import { useCallback, useState } from 'react';

/**
 * Small form state helper driven by the same zod schemas the API uses (@qmas/shared).
 *   const f = useZodForm(schema, initialValues);
 *   f.values, f.set('name', v), f.error('name'), f.validate() → parsed data or null,
 *   f.setServerErrors(fieldErrors) to show API 422 messages next to the fields.
 * Errors appear on submit and clear as soon as the user edits that field.
 */
export function useZodForm(schema, initialValues) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});

  const set = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => {
      if (!e[name]) return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  }, []);

  const validate = useCallback(
    (extra = {}) => {
      const result = schema.safeParse({ ...values, ...extra });
      if (result.success) {
        setErrors({});
        return result.data;
      }
      const next = {};
      for (const issue of result.error.issues) next[issue.path.join('.') || '_form'] ??= issue.message;
      setErrors(next);
      return null;
    },
    [schema, values],
  );

  return {
    values,
    setValues,
    set,
    errors,
    error: (name) => errors[name],
    validate,
    setServerErrors: (fieldErrors) => setErrors(fieldErrors ?? {}),
    reset: (v = initialValues) => {
      setValues(v);
      setErrors({});
    },
  };
}
