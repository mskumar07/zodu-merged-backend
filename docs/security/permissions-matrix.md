# Permissions matrix

Who may call each customer route, per service. Generated from each service's
`src/security/rules.js` (the route policy itself), so this page and the code
say the same thing. When a rules file changes, replace the tables below with
the output of `node scripts/permissions-matrix.js .` (run from the repo root).

How to read it:

- **Path**: a prefix of whole segments (`/api/sales` also covers
  `/api/sales/history`), or a regular expression. Paths are the service's own;
  through the gateway they sit under the prefix in each heading.
- **Who**: `public` needs no token; `any signed-in user` needs a valid access
  token. A permission is `<module>:<read|create|edit|delete>`, from the user's
  role in that company and branch (tbl_access_control). `a + b` needs all of
  them; `one of` needs any of them.
- The first matching rule wins. **A route matching no rule is refused (403)**,
  so a new route stays closed until it is added here.
- Every signed-in route also gets the tenant checks: company and branch come
  from the token. A `zodu_id` of another company in the path, query or body is
  404. Another branch is accepted only after auth-service confirms the user may
  use it, and that branch's permissions then apply. Record ids in the request
  must belong to the caller's company.
- The company's **Admin** role passes every permission check, inside its own
  company only. `company:*`, `branch:*`, `role:read`, `role:edit` and
  `gst:export` are in no tbl_modules row yet, so only Admin has them.
- `public` routes behind their own checks: `/internal` (a service token,
  `requireInternal()`), and auth-service's `switch-context` and `role-access`
  (their own `authenticate`; the body or query names another of the user's
  companies by design).
- payroll-service has no customer routes; file-service checks access per call
  (docs/security/auth.md); admin-service has its own admin-console tokens.

## auth-service (gateway `/auth`)

| Method | Path | Who |
|---|---|---|
| any | `/internal` | public |
| POST | `^\/api\/(create-account\|login\|refresh-token\|logout)$` (regex) | public |
| POST | `/api/switch-context` | public |
| POST | `/api/logout-all` | any signed-in user |
| any | `/api/sessions` | any signed-in user |
| GET | `/api/auth-check` | any signed-in user |
| GET | `/api/my-companies` | any signed-in user |
| GET | `/api/role-access` | public |
| POST | `^\/api\/(company\/add\|create-company)$` (regex) | any signed-in user |
| PUT, POST | `^\/api\/company\/(edit\/[^/]+\|[^/]+\/logo)$` (regex) | `company:edit` |
| DELETE | `^\/api\/company\/[^/]+\/logo$` (regex) | `company:edit` |
| DELETE | `/api/company` | `company:delete` |
| POST | `/api/branch/add` | `branch:create` |
| PUT | `/api/branch/edit` | `branch:edit` |
| DELETE | `/api/branch` | `branch:delete` |
| GET | `^\/api\/(settings\|invoice-settings\|pos-settings)\/` (regex) | any signed-in user |
| PUT, POST, DELETE | `^\/api\/(invoice-settings\|pos-settings)\/` (regex) | `settings:edit` |
| GET | `/api/modules` | any signed-in user |
| GET | `/api/roles` | one of: `role:read`, `employee:read`, `employee:create`, `employee:edit` |
| POST, PUT, DELETE | `/api/roles` | `role:edit` |

## employee-service (gateway `/employee`)

| Method | Path | Who |
|---|---|---|
| GET | `/api/attendance/my` | any signed-in user |
| POST | `/api/attendance/face` | `attendance:create` |
| GET | `/api/attendance` | `attendance:read` |
| POST | `/api/attendance` | `attendance:create` |
| PUT | `/api/attendance` | `attendance:edit` |
| PATCH | `/api/attendance` | `attendance:edit` |
| DELETE | `/api/attendance` | `attendance:delete` |
| POST, DELETE | `^\/api\/employees\/[^/]+\/(documents\|face)(\/[^/]+)?$` (regex) | `employee:edit` |
| PUT | `^\/api\/employees\/[^/]+\/login-details$` (regex) | `employee:edit` |
| GET | `/api/employees` | `employee:read` |
| POST | `/api/employees` | `employee:create` |
| PUT | `/api/employees` | `employee:edit` |
| PATCH | `/api/employees` | `employee:edit` |
| DELETE | `/api/employees` | `employee:delete` |

## checklist-service (gateway `/checklist`)

| Method | Path | Who |
|---|---|---|
| GET | `/api/checklists/my-summary` | any signed-in user |
| GET | `/api/checklists/my-tasks` | any signed-in user |
| GET, POST | `/api/checklists/progress` | any signed-in user |
| GET | `^\/api\/checklists\/(assigned-employees\|assigned-employees-summary\|instances\/list)$` (regex) | `checklist:read` |
| POST | `^\/api\/checklists\/[^/]+\/attachments$` (regex) | `checklist:create` |
| DELETE | `^\/api\/checklists\/[^/]+\/attachments\/[^/]+$` (regex) | `checklist:edit` |
| GET | `/api/checklists` | `checklist:read` |
| POST | `/api/checklists` | `checklist:create` |
| PUT | `/api/checklists` | `checklist:edit` |
| PATCH | `/api/checklists` | `checklist:edit` |
| DELETE | `/api/checklists` | `checklist:delete` |

## retail-service (gateway `/retail`)

| Method | Path | Who |
|---|---|---|
| GET | `/get/my-companies` | any signed-in user |
| GET | `/get/branches` | any signed-in user |
| GET | `/api/branch` | any signed-in user |
| PUT | `/api/branch` | `branch:edit` |
| POST | `^\/upload(\/multiple)?$` (regex) | any signed-in user |
| DELETE | `/delete/file` | any signed-in user |
| GET | `/api/gst-state-code` | any signed-in user |
| GET | `/get/gst` | any signed-in user |
| POST | `/api/add/orders` | `billing:create` |
| PUT | `/api/update/orders` | one of: `billing:edit`, `sales:edit` |
| GET | `/api/sales` | one of: `sales:read`, `billing:read` |
| POST | `^\/api\/sales\/[^/]+\/payment$` (regex) | one of: `billing:create`, `sales:edit` |
| DELETE | `/api/sales` | one of: `sales:delete`, `billing:delete` |
| GET | `/api/doc-sequence` | one of: `billing:read`, `billing:create`, `settings:read` |
| PUT | `/api/doc-sequence` | `settings:edit` |
| POST | `/add/hold_menu` | `billing:create` |
| DELETE | `/delete/hold-menu` | `billing:create` |
| GET | `/get/hold_menu` | one of: `billing:read`, `billing:create` |
| GET | `/get/pos_data` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| POST | `^\/api\/sale-returns\/[^/]+\/refund$` (regex) | one of: `sales:edit`, `billing:create` |
| GET | `/api/sale-returns` | one of: `sales:read`, `billing:read` |
| POST | `/api/sale-returns` | one of: `sales:edit`, `billing:create` |
| PUT | `/api/sale-returns` | `sales:edit` |
| DELETE | `/api/sale-returns` | `sales:delete` |
| GET | `/api/customers` | one of: `customer:read`, `billing:read`, `billing:create` |
| POST | `^\/api\/customers\/[^/]+\/mark-payment$` (regex) | one of: `customer:edit`, `billing:create` |
| POST | `/api/customers` | one of: `customer:create`, `billing:create` |
| GET | `/api/customers` | `customer:read` |
| POST | `/api/customers` | `customer:create` |
| PUT | `/api/customers` | `customer:edit` |
| PATCH | `/api/customers` | `customer:edit` |
| DELETE | `/api/customers` | `customer:delete` |
| GET | `/api/menu/menu_items` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| GET | `/api/menu/check/item_id` | one of: `menu:create`, `menu:edit` |
| GET | `^\/api\/menu\/(inventory\|stock)(\/\|$)` (regex) | `inventory:read` |
| POST | `/api/menu/inventory/adjust` | `inventory:edit` |
| POST | `/api/menu/add/menu_item` | `menu:create` |
| PUT | `/api/menu/edit/menu_item` | `menu:edit` |
| PUT | `/api/menu/status` | `menu:edit` |
| DELETE | `/api/menu/remove/menu_item` | `menu:delete` |
| GET | `/api/menu/menu_item` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| GET | `/get/category` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| POST | `/check/category-name` | one of: `menu:create`, `inventory:create`, `expense:create`, `purchase:create` |
| POST | `/add/category` | one of: `menu:create`, `inventory:create`, `expense:create`, `purchase:create` |
| PUT | `^\/(update\|inactivate)\/category\/` (regex) | one of: `menu:edit`, `inventory:edit`, `expense:edit`, `purchase:edit` |
| DELETE | `/delete/category` | one of: `menu:delete`, `inventory:delete`, `expense:delete`, `purchase:delete` |
| GET | `/get/units` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| POST | `^\/api\/purchase\/payment\/` (regex) | one of: `purchase:create`, `purchase:edit` |
| GET | `/api/purchase` | `purchase:read` |
| POST | `/api/purchase` | `purchase:create` |
| PUT | `/api/purchase` | `purchase:edit` |
| PATCH | `/api/purchase` | `purchase:edit` |
| DELETE | `/api/purchase` | `purchase:delete` |
| POST | `^\/api\/purchase-returns\/[^/]+\/refund$` (regex) | `purchase:edit` |
| GET | `/api/purchase-returns` | `purchase:read` |
| POST | `/api/purchase-returns` | `purchase:create` |
| PUT | `/api/purchase-returns` | `purchase:edit` |
| PATCH | `/api/purchase-returns` | `purchase:edit` |
| DELETE | `/api/purchase-returns` | `purchase:delete` |
| GET | `/api/vendor` | one of: `purchase:read`, `expense:read` |
| POST | `/api/vendor` | one of: `purchase:create`, `expense:create` |
| PUT | `/api/vendor` | one of: `purchase:edit`, `expense:edit` |
| DELETE | `/api/vendor` | one of: `purchase:delete`, `expense:delete` |
| POST | `^\/api\/expense\/payment\/` (regex) | one of: `expense:create`, `expense:edit` |
| GET | `/api/expense` | `expense:read` |
| POST | `/api/expense` | `expense:create` |
| PUT | `/api/expense` | `expense:edit` |
| PATCH | `/api/expense` | `expense:edit` |
| DELETE | `/api/expense` | `expense:delete` |
| GET | `/api/dashboard` | `dashboard:read` |
| GET | `/api/report` | `report:read` |
| GET | `/api/accounting` | `report:read` |

## restaurant-service (gateway `/restaurant`)

| Method | Path | Who |
|---|---|---|
| GET | `/get/branches` | any signed-in user |
| GET | `/api/branch` | any signed-in user |
| PUT | `/api/branch` | `branch:edit` |
| POST | `^\/upload(\/multiple)?$` (regex) | any signed-in user |
| DELETE | `/delete/file` | any signed-in user |
| GET | `/api/gst-state-code` | any signed-in user |
| GET | `/get/gst` | any signed-in user |
| POST | `/api/orders/add/orders` | `billing:create` |
| PUT | `/api/orders/update/orders` | one of: `billing:create`, `billing:edit` |
| GET | `/api/orders/get/orders` | one of: `billing:read`, `billing:create` |
| GET | `/api/orders/api/order` | one of: `billing:read`, `billing:create`, `sales:read` |
| GET | `/api/orders/get/kot-list` | one of: `billing:read`, `billing:create` |
| PUT | `^\/api\/orders\/api\/kot\/(order\|item)-ready$` (regex) | `billing:create` |
| GET | `^\/api\/orders\/(api\/report\/orders\|get\/report\/order-category)$` (regex) | `report:read` |
| POST | `/api/completeorder` | `billing:create` |
| POST | `/api/hold/add/hold_menu` | `billing:create` |
| PUT | `/api/hold/update/hold-menu` | `billing:create` |
| DELETE | `/api/hold/delete/hold-menu` | `billing:create` |
| GET | `/api/hold/get/hold-orders` | one of: `billing:read`, `billing:create` |
| GET | `/get/pos_data` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| GET | `/api/sales` | one of: `sales:read`, `billing:read` |
| DELETE | `/api/sales` | one of: `sales:delete`, `billing:delete` |
| GET | `/get/kot-tickets` | one of: `billing:read`, `billing:create` |
| POST | `/add/kot-print-log` | one of: `billing:read`, `billing:create` |
| GET | `^\/get\/kot-(counters\|assignment\|item-routing\|printers\|settings\|config)\/` (regex) | one of: `billing:read`, `billing:create`, `settings:read` |
| POST | `^\/(add\/kot-(counter\|printer)\|assign\/kot-counter-items)$` (regex) | `settings:edit` |
| PUT | `^\/update\/kot-(counter\|printer\|item-routing\|settings)(\/\|$)` (regex) | `settings:edit` |
| DELETE | `^\/delete\/kot-(counter\|printer)\/` (regex) | `settings:edit` |
| GET | `/api/customers` | one of: `customer:read`, `billing:read`, `billing:create` |
| POST | `/api/customers` | one of: `customer:create`, `billing:create` |
| GET | `/api/customers` | `customer:read` |
| POST | `/api/customers` | `customer:create` |
| PUT | `/api/customers` | `customer:edit` |
| PATCH | `/api/customers` | `customer:edit` |
| DELETE | `/api/customers` | `customer:delete` |
| GET | `/api/menu/get/menu_item` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| GET | `/api/menu/check/item_id` | one of: `menu:create`, `menu:edit` |
| POST | `/api/menu/api/add/menu_item` | `menu:create` |
| PUT | `^\/api\/menu\/(api\/edit\/menu_item\|update\/menu_item\|update\/menustatus\|update\/menusfav)\/` (regex) | `menu:edit` |
| PUT | `^\/update\/(favorite\|menustatus)\/` (regex) | `menu:edit` |
| DELETE | `/api/menu/delete/menu_item` | `menu:delete` |
| GET | `^\/get\/category\/` (regex) | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| GET | `/category-name` | one of: `menu:create`, `inventory:create`, `expense:create`, `purchase:create` |
| POST | `/add/category` | one of: `menu:create`, `inventory:create`, `expense:create`, `purchase:create` |
| PUT | `^\/(update\|inactivate)\/category\/` (regex) | one of: `menu:edit`, `inventory:edit`, `expense:edit`, `purchase:edit` |
| DELETE | `/delete/category` | one of: `menu:delete`, `inventory:delete`, `expense:delete`, `purchase:delete` |
| GET | `/get/units` | one of: `billing:read`, `billing:create`, `menu:read`, `inventory:read`, `purchase:read`, `expense:read` |
| POST | `/add/unit` | one of: `menu:create`, `inventory:create` |
| PUT | `/update/unit` | one of: `menu:edit`, `inventory:edit` |
| POST | `/replace/unit` | one of: `menu:edit`, `inventory:edit` |
| DELETE | `/delete/unit` | one of: `menu:delete`, `inventory:delete` |
| GET | `/api/inventory` | `inventory:read` |
| POST | `/api/inventory/api/add/inventory` | `inventory:create` |
| PUT | `/api/inventory/api/update/inventory` | `inventory:edit` |
| POST | `/api/inventory/adjust` | `inventory:edit` |
| POST | `^\/api\/purchase\/payment\/` (regex) | one of: `purchase:create`, `purchase:edit` |
| GET | `/api/purchase` | `purchase:read` |
| POST | `/api/purchase` | `purchase:create` |
| PUT | `/api/purchase` | `purchase:edit` |
| PATCH | `/api/purchase` | `purchase:edit` |
| DELETE | `/api/purchase` | `purchase:delete` |
| POST | `^\/api\/purchase-returns\/[^/]+\/refund$` (regex) | `purchase:edit` |
| GET | `/api/purchase-returns` | `purchase:read` |
| POST | `/api/purchase-returns` | `purchase:create` |
| PUT | `/api/purchase-returns` | `purchase:edit` |
| PATCH | `/api/purchase-returns` | `purchase:edit` |
| DELETE | `/api/purchase-returns` | `purchase:delete` |
| GET | `^\/(api\/vendor\|get\/vendor\/)` (regex) | one of: `purchase:read`, `expense:read` |
| POST | `^\/api\/(vendor\|add\/vendor)(\/\|$)` (regex) | one of: `purchase:create`, `expense:create` |
| PUT | `/api/vendor` | one of: `purchase:edit`, `expense:edit` |
| DELETE | `/api/vendor` | one of: `purchase:delete`, `expense:delete` |
| POST | `^\/api\/expense\/payment\/` (regex) | one of: `expense:create`, `expense:edit` |
| GET | `/api/expense` | `expense:read` |
| POST | `/api/expense` | `expense:create` |
| PUT | `/api/expense` | `expense:edit` |
| PATCH | `/api/expense` | `expense:edit` |
| DELETE | `/api/expense` | `expense:delete` |
| GET | `/api/dashboard` | `dashboard:read` |
| GET | `/api/report` | `report:read` |
