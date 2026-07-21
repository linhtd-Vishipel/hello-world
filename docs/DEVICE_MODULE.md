# Device Module Design

This document specifies the data model, search, views, business rules, and
validation for the Devices module. Devices are pieces of equipment owned by
a customer (sold and/or serviced by the company) — tracked for service
history and warranty. It complements [docs/RBAC.md](RBAC.md), which defines
who may perform which actions and at what scope (`all` / `own_branch` /
`assigned`), and [docs/CUSTOMER_MODULE.md](CUSTOMER_MODULE.md), which a
device always belongs to.

## Required Fields

### Core (always required)

| Field | Type | Notes |
|---|---|---|
| `id` | system-generated | Immutable |
| `customer_id` | reference → Customers | Owning customer; immutable after creation |
| `branch_id` | reference → Branches | Servicing branch; drives `own_branch` scope |
| `category` | enum: `appliance`, `electronics`, `machinery`, `vehicle`, `other` | For reporting/search |
| `brand` | text | Manufacturer/brand name |
| `model` | text | Model name/number |
| `serial_number` | text | Unique system-wide |
| `status` | enum: `active`, `under_repair`, `retired` | See state machine under Business Rules |
| `created_by`, `created_at` | system | Set once, never edited |
| `updated_at` | system | Auto-updated on every change |

### Conditional / optional

| Field | Type | Notes |
|---|---|---|
| `purchase_date` | date | Optional; not in the future |
| `warranty_expiry` | date | Optional; if set with `purchase_date`, must not precede it |
| `assigned_to_id` | reference → User | Technician currently handling the device; drives `assigned` scope |
| `tags` | list of text | Free-form segmentation |
| `notes` | text | Free-form, append-only activity log preferred over a single editable field |

## Search Filters

- **Keyword** — matches serial number, brand, or model (partial match)
- **Customer** — devices belonging to a specific customer
- **Branch** — single or multi-select; implicitly restricted to the caller's own branch unless their role scope is `all`
- **Category**
- **Status** — active / under_repair / retired
- **Assigned to** — specific technician, "assigned to me", or "unassigned"
- **Under warranty** — boolean quick filter (`warranty_expiry` present and not in the past)
- **Created date range**

Filters compose with AND logic; keyword is the only OR-across-fields filter.
Every filtered query is additionally constrained server-side by the caller's
permission scope — filters narrow within that scope, they never widen it.

## Views

| View | Purpose | Primary roles |
|---|---|---|
| **List (table)** | Sortable/paginated grid driven by the filters above | All roles with any read access |
| **Detail / Profile** | Single device, tabbed: Overview, Service Orders, Activity Log | All roles, tabs shown vary by module access |
| **My Devices** | List pre-filtered to `assigned_to_id = current_user` | Technician |
| **Branch view** | List pre-filtered to the manager's branch | Branch Manager |

The Detail view's Service Orders tab is populated from the Service Orders
module and inherits that module's own permission scope — e.g. a Technician
sees the tab only for devices assigned to them.

## Business Rules

- **Status lifecycle**: `active ⇄ under_repair`, plus `active → retired` and
  `under_repair → retired`. `retired` is terminal — no transition out of it.
  Only Technician, Customer Service, Branch Manager, and Administrator may
  change status (a Technician's scope further restricts this to devices
  assigned to them, enforced via RBAC).
- **Customer is set at creation and does not change** — a device cannot be
  re-parented to a different customer; register a new device instead.
- **Branch is set at creation and does not change itself** — moving a
  device to another branch (e.g. because service moves to a different
  service center) is an explicit "transfer" action restricted to Branch
  Manager (own branch only, as the destination or source) and Administrator
  (any branch), and is logged.
- **Assignment**: `assigned_to_id` can be reassigned by Customer Service,
  Branch Manager (within their branch), or Administrator, and must
  reference a Technician. A device may be unassigned (null) but not
  assigned to a technician outside the device's branch.
- **Uniqueness**: `serial_number` must be unique system-wide.
- **Deletion is soft-delete only**. A device with any linked service order
  cannot be hard-deleted, only set `retired`; hard delete is reserved for
  genuine data-entry mistakes with zero linked records and is
  Administrator-only.
- **Read/write access always resolves through the RBAC scope** already
  defined in `docs/RBAC.md`: `all` (Administrator, Accounting read-only),
  `own_branch` (Branch Manager), `assigned` (Technician, read/update),
  `all` read-only (Sales), `all` create/read/update (Customer Service).
- **Every create/update/status-change/delete/transfer/reassignment is
  recorded** in the device's activity log with actor, timestamp, and a
  before/after diff of changed fields.

## Validation

| Field | Rule |
|---|---|
| `customer_id` | Required; must reference an existing customer |
| `branch_id` | Required; must reference an existing, active branch |
| `category` | Required; must be a valid enum value |
| `brand` | Required; 1–80 chars; not empty/whitespace-only |
| `model` | Required; 1–80 chars; not empty/whitespace-only |
| `serial_number` | Required; 3–50 chars, letters/digits/hyphens only; unique system-wide |
| `purchase_date` | Optional; must not be in the future |
| `warranty_expiry` | Optional; if `purchase_date` is also set, must be on or after it |
| `assigned_to_id` | Optional; if set, must reference a Technician who belongs to the device's `branch_id` |
| `status` | Required; must follow the allowed lifecycle transition from its current value |
| `tags` | Optional; each tag 1–30 chars, deduplicated, max 10 per device |
| `notes` entries | Max 2,000 chars per entry; append-only, not edited/deleted after save |

Server-side validation is authoritative; client-side validation mirrors it
for immediate feedback but is never trusted on its own.
