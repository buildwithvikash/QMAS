import { Plus, Trash2 } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { Select, TextInput } from '../../components/ui/fields.jsx';

/**
 * Editable list of role assignments: role, plant (required for plant-bound roles, otherwise
 * optional = all plants) and an optional end date for temporary assignments such as leave cover.
 * errors: field errors keyed "roles.<i>.<field>" from the API.
 */
export default function RoleAssignmentsEditor({ value, onChange, roles = [], plants = [], errors = {} }) {
  // Inactive roles cannot be given; one the user already holds still shows so it can be removed.
  const roleOptions = roles
    .filter((r) => r.isActive !== false || value.some((v) => v.roleCode === r.code))
    .map((r) => ({ value: r.code, label: `${r.name} (${r.department})${r.isActive === false ? ' · inactive' : ''}` }));
  const plantOptions = plants.filter((p) => p.isActive).map((p) => ({ value: String(p.id), label: `${p.name} (${p.sapCode})` }));
  const byCode = Object.fromEntries(roles.map((r) => [r.code, r]));

  const update = (i, patch) => onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-slate-400">No roles yet. The user can sign in but will see nothing.</p>}
      {value.map((row, i) => {
        const needsPlant = byCode[row.roleCode]?.requiresPlant;
        return (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1.4fr_1.2fr_0.9fr_auto] gap-2 items-start rounded-lg border border-slate-200 p-2">
            <Select
              aria-label="Role"
              options={roleOptions}
              placeholder="Choose role…"
              value={row.roleCode}
              onChange={(v) => update(i, { roleCode: v ?? '' })}
              error={errors[`roles.${i}.roleCode`]}
            />
            <Select
              aria-label="Plant"
              options={plantOptions}
              placeholder={needsPlant ? 'Choose plant…' : 'All plants'}
              value={row.plantId ? String(row.plantId) : ''}
              onChange={(v) => update(i, { plantId: v ? Number(v) : null })}
              error={errors[`roles.${i}.plantId`]}
            />
            <TextInput
              aria-label="Valid until"
              type="date"
              title="Leave empty for a permanent assignment"
              value={row.validTo ?? ''}
              onChange={(e) => update(i, { validTo: e.target.value || null })}
              error={errors[`roles.${i}.validTo`]}
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label="Remove role"
              className="p-2 rounded-lg text-rose-400 hover:bg-rose-50 cursor-pointer justify-self-end"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      <Button variant="secondary" size="sm" icon={Plus} onClick={() => onChange([...value, { roleCode: '', plantId: null, validTo: null }])}>
        Add role
      </Button>
      <p className="text-[11px] text-slate-400">Valid-until is optional; use it for temporary cover such as leave.</p>
    </div>
  );
}
