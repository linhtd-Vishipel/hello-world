# Role-Based Access Control (RBAC) Design

This document defines the user roles and their permissions for the system.

## Roles

| Role | Description |
|---|---|
| **Administrator** | Full system access. Manages users, roles, branches, and global settings. |
| **Sales** | Manages customers, quotes, and sales orders. |
| **Technician** | Handles assigned service/work orders and technical tasks. |
| **Customer Service** | Handles customer inquiries, complaints, and support tickets. |
| **Accounting** | Manages invoices, payments, and financial reports. |
| **Branch Manager** | Oversees all operations within their own branch. |

## Modules / Resources

- **User & Role Management** — create/edit users, assign roles, configure permissions
- **System Settings** — global configuration, integrations, branch setup
- **Customers** — customer records and contact info
- **Sales (Quotes / Orders)** — quotes, sales orders, pricing
- **Service / Work Orders** — technician assignments, job status, service history
- **Inventory / Products** — stock levels, parts, product catalog
- **Invoices & Payments** — billing, payment records, financial documents
- **Reports & Dashboards** — sales, service, and financial reporting
- **Branches** — branch-level data and configuration

## Permission Matrix

Legend: **C** = Create, **R** = Read, **U** = Update, **D** = Delete, **—** = No access

| Module | Administrator | Sales | Technician | Customer Service | Accounting | Branch Manager |
|---|---|---|---|---|---|---|
| User & Role Management | CRUD | — | — | — | — | R (own branch staff) |
| System Settings | CRUD | — | — | — | — | R |
| Customers | CRUD | CRUD | R (assigned) | CRUD | R | CRUD (own branch) |
| Sales (Quotes / Orders) | CRUD | CRUD (own) | — | R | R | CRUD (own branch) |
| Service / Work Orders | CRUD | R | RU (assigned) | CRU | R | CRUD (own branch) |
| Inventory / Products | CRUD | R | R | R | R | RU (own branch) |
| Invoices & Payments | CRUD | R (own orders) | — | R | CRUD | R (own branch) |
| Reports & Dashboards | R (all) | R (own) | R (own) | R (own) | R (financial) | R (own branch) |
| Branches | CRUD | R (own) | R (own) | R (own) | R (all) | RU (own) |

## Role Details

### Administrator
- Full CRUD access across all modules and branches.
- Only role able to create/manage other users and assign roles.
- Only role able to change global system settings.

### Sales
- Creates and manages their own quotes and sales orders.
- Creates and manages customer records.
- Read-only access to inventory to check stock availability.
- Read-only access to their own sales reports.
- No access to invoices/payments beyond viewing their own orders' billing status.
- No access to service/work orders or accounting functions.

### Technician
- Views work orders assigned to them; updates status, notes, and completion details.
- Read-only access to customer info relevant to assigned jobs.
- Read-only access to inventory/parts needed for jobs.
- No access to sales, accounting, or customer management outside assigned tickets.

### Customer Service
- Creates and manages customer records and support tickets.
- Creates/updates service requests on behalf of customers (routes to Technician).
- Read-only access to sales orders and service history for support context.
- No access to accounting, inventory management, or user administration.

### Accounting
- Full CRUD over invoices and payments.
- Read-only access to sales orders, service orders, and customer data for billing context.
- Access to financial reports across all branches.
- No access to service/work order execution or user management.

### Branch Manager
- Full CRUD over sales, customers, and service/work orders within their own branch.
- Read/update access to branch-level inventory and settings.
- Read-only access to their branch's financial reports.
- Read-only visibility into their branch's staff (cannot create/delete user accounts — that remains an Administrator function).
- No cross-branch access and no global system settings access.
