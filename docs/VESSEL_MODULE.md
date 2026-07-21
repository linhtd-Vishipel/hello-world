# Vessel Module Design (Odoo Addon)

This document records the approved design for `addons/vessel_management/`, a
new Odoo 17.0 addon. Unlike the Customers module (`docs/CUSTOMER_MODULE.md`),
which is part of this repo's standalone FastAPI demo app, the Vessel module
targets a real Odoo installation and is a separate, self-contained addon
(`depends: base, mail, contacts`).

## Domain

A Vessel is a ship owned/operated by a customer (Odoo's built-in
`res.partner`), tracked for its identity (IMO/MMSI/call sign), specifications,
ownership, and the maritime communication equipment onboard (VHF, MF/HF,
Inmarsat, EPIRB, AIS, SART, NAVTEX) — reflecting Vishipel's core business of
installing and maintaining that equipment. "Branch" is represented using
Odoo's native multi-company (`res.company`) rather than a bespoke field.

## Business Workflow

```
draft -> registered -> active <-> out_of_service -> decommissioned
```

- `decommissioned` is terminal; there is no path back.
- A vessel cannot be decommissioned while it has open (`new` or
  `in_progress`) work orders.
- IMO number is required from creation (`draft`); it, MMSI (if set), and call
  sign (if set) must be unique system-wide.

## Data Model

| Model | Purpose | Key fields | Relations |
|---|---|---|---|
| `vessel.vessel` | Core registry record | `name`, `imo_number` (unique, 7 digits), `mmsi` (unique if set, 9 digits), `call_sign` (unique if set), `vessel_type`, `flag_state`, `home_port`, `gross_tonnage`, `length_overall`, `state` | `owner_id`/`operator_id` → `res.partner`; `company_id` → `res.company`; `technician_id` → `res.users`; `equipment_ids`/`work_order_ids` one2many. Inherits `mail.thread`/`mail.activity.mixin`. |
| `vessel.equipment` | Onboard comms equipment | `equipment_type`, `serial_number`, `install_date`, `last_inspection_date`, `next_inspection_date`, `state` | `vessel_id` → `vessel.vessel` (cascade); `company_id` related & stored for record rules |
| `vessel.work.order` | Maintenance/service jobs | `name` (sequence `WO/<year>/####`), `description`, `state`, `date_open`, `date_closed` | `vessel_id`, `equipment_id` (optional), `technician_id` → `res.users` |

## Permissions

Four security groups (category "Vessel Management"), mapped from the six
roles in `docs/RBAC.md`:

| Group | Maps from | Access |
|---|---|---|
| Administrator | Administrator | CRUD, scoped to companies the user is granted (standard Odoo multi-company) |
| Officer | Customer Service, Branch Manager | CRUD, own company |
| Technician | Technician | Read all vessels/equipment/work orders in own company; write only where `technician_id` (directly or via the parent vessel) is themself |
| Viewer | Sales, Accounting | Read-only, own company |

Enforced via `ir.model.access.csv` (coarse grant per group) plus `ir.rule`
record rules: one multi-company rule per model (applies to everyone,
including Administrators — cross-company visibility is granted the standard
way, via a user's Allowed Companies) and paired read/write rules for
Technicians so their broad read access doesn't imply broad write access.

## UI

Top-level **Vessel Management** menu → Vessels (list/kanban-by-status/form
with a statusbar workflow and smart buttons for equipment/open work order
counts), Equipment, Work Orders. Vessel form has tabs for Equipment, Work
Orders, and Notes, plus chatter (mail thread) for activity history.

## Verification

The addon has been installed and exercised against a real Odoo 17.0 +
PostgreSQL 16 instance (`odoo-bin -i vessel_management`, then `-u
vessel_management` to confirm the update path), which caught and fixed two
real bugs the earlier static-only checks missed:

- View archs used `<list>`/`"list"` (the `tree` → `list` rename shipped in
  Odoo 18.0, not 17.0); reverted to `<tree>`/`"tree"` for 17.0 compatibility.
- `vessel.work.order`'s chatter referenced `activity_ids`, which requires
  `mail.activity.mixin`; the model only inherited `mail.thread`. Added the
  mixin.

Functional checks run via `odoo-bin shell` covered: IMO/MMSI/call-sign
uniqueness constraints, the full state machine (including the
decommission-blocked-by-open-work-orders guard and the terminal
`decommissioned` state), the work order sequence, and `ir.rule` scoping (a
Technician is blocked from writing to a vessel not assigned to them, can
write once assigned, and can always read vessels in their own company).
