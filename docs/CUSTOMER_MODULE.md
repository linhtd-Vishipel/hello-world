# Customer Module Design

This document specifies the data model, search, views, business rules, and
validation for the Customers module. It complements
[docs/RBAC.md](RBAC.md), which defines who may perform which actions and at
what scope (`all` / `own_branch` / `assigned`).

## Required Fields

### Core (always required)

| Field | Type | Notes |
|---|---|---|
| `id` | system-generated | Immutable |
| `customer_type` | enum: `individual`, `company` | Drives which conditional fields apply |
| `name` | text | Person's full name or company name |
| `phone` | text | Primary contact number |
| `branch_id` | reference → Branches | Owning branch; drives `own_branch` scope |
| `status` | enum: `lead`, `active`, `inactive` | See state machine under Business Rules |
| `created_by`, `created_at` | system | Set once, never edited |
| `updated_at` | system | Auto-updated on every change |

### Conditional / optional

| Field | Type | Notes |
|---|---|---|
| `tax_code` | text | **Required when `customer_type = company`** |
| `contact_person`, `contact_title` | text | Required when `customer_type = company` |
| `email` | text | Optional, validated if present |
| `address` (street, ward, district, city/province) | text | Optional |
| `assigned_to_id` | reference → User | Sales/CS rep or Technician owning the relationship; drives `assigned` scope |
| `source` | enum: `referral`, `website`, `cold_call`, `walk_in`, `other` | For reporting |
| `tags` | list of text | Free-form segmentation |
| `notes` | text | Free-form, append-only activity log preferred over a single editable field |

## Search Filters

- **Keyword** — matches name, phone, email, or tax code (partial match)
- **Branch** — single or multi-select; implicitly restricted to the caller's own branch unless their role scope is `all`
- **Status** — lead / active / inactive
- **Customer type** — individual / company
- **Assigned to** — specific rep, "assigned to me", or "unassigned"
- **Source**
- **Tags**
- **Created date range**
- **Last activity date range** — last order, service ticket, or invoice touch
- **Has open service order** / **Has open sales order** — boolean quick filters

Filters compose with AND logic; keyword is the only OR-across-fields filter.
Every filtered query is additionally constrained server-side by the caller's
permission scope — filters narrow within that scope, they never widen it.

## Views

| View | Purpose | Primary roles |
|---|---|---|
| **List (table)** | Sortable/paginated grid driven by the filters above; columns configurable per role | All roles with any read access |
| **Detail / Profile** | Single customer, tabbed: Overview, Sales Orders, Service Orders, Invoices, Activity Log | All roles, tabs shown vary by module access |
| **My Customers** | List pre-filtered to `assigned_to_id = current_user` | Sales, Technician, Customer Service |
| **Branch view** | List pre-filtered to the manager's branch, with branch-level counts | Branch Manager |
| **Lead pipeline (kanban)** | Cards grouped by status (`lead → active`), drag to change status | Sales |
| **Merge/duplicate review** | Side-by-side comparison of two records flagged as possible duplicates | Administrator, Branch Manager |

The Detail view's tabs are populated from other modules (Sales Orders,
Service Orders, Invoices) and inherit that module's own permission scope —
e.g. a Technician sees the Service Orders tab but not Invoices.

## Business Rules

- **Status lifecycle**: `lead → active → inactive`, plus `active ⇄ inactive`.
  No direct `lead → inactive`. Only Sales, Customer Service, Branch Manager,
  and Administrator may change status.
- **Branch is set at creation and does not change itself** — moving a
  customer to another branch is an explicit "transfer" action restricted to
  Branch Manager (own branch only, as the destination or source) and
  Administrator (any branch), and is logged.
- **Assignment**: `assigned_to_id` can be reassigned by Branch Manager
  (within their branch), Customer Service, or Administrator. A customer may
  be unassigned (null) but not assigned to a user outside the customer's
  branch.
- **Uniqueness**: `phone` must be unique within a branch; `tax_code` must be
  unique system-wide (a company can't be legitimately registered at two
  branches under the same tax ID). A near-duplicate on name+phone raises a
  warning at create time rather than a hard block.
- **Deletion is soft-delete only**. A customer with any linked sales order,
  service order, or invoice cannot be hard-deleted, only set `inactive`
  and/or archived; hard delete is reserved for genuine data-entry mistakes
  with zero linked records and is Administrator-only.
- **Company-only fields are enforced by type**: `tax_code`,
  `contact_person`, and `contact_title` are required if and only if
  `customer_type = company`; they must be empty for `individual`.
- **Read/write access always resolves through the RBAC scope** already
  defined in `docs/RBAC.md`: `all` (Administrator, Sales, Customer Service),
  `own_branch` (Branch Manager), `assigned` read-only (Technician), `all`
  read-only (Accounting).
- **Every create/update/status-change/delete/transfer/reassignment is
  recorded** in the customer's activity log with actor, timestamp, and a
  before/after diff of changed fields.

## Validation

| Field | Rule |
|---|---|
| `name` | Required; 2–120 chars; not empty/whitespace-only |
| `customer_type` | Required; must be a valid enum value |
| `phone` | Required; digits only (+ optional leading `+`); 9–15 chars; unique within branch |
| `email` | Optional; standard email format if present; unique if present |
| `tax_code` | Required if `company`; must be blank if `individual`; numeric, 10 or 13 digits (VAT registration format) |
| `contact_person` / `contact_title` | Required if `company`; blank if `individual` |
| `branch_id` | Required; must reference an existing, active branch |
| `assigned_to_id` | Optional; if set, must reference a user who belongs to the same `branch_id` and holds a role permitted to own customers (Sales, Customer Service, Technician) |
| `status` | Required; must follow the allowed lifecycle transition from its current value |
| `address` | Optional; if any sub-field (ward/district/city) is provided, all are required together |
| `tags` | Optional; each tag 1–30 chars, deduplicated, max 10 per customer |
| `notes` entries | Max 2,000 chars per entry; append-only, not edited/deleted after save |

Server-side validation is authoritative; client-side validation mirrors it
for immediate feedback but is never trusted on its own.
