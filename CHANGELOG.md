# Changelog

All notable changes to this project will be documented in this file.

---

## [1.1.1] — 2026-05-25

Lead custom field fixes, clearer API errors, and node UI improvements.

### Fixed

- **Lead (Create / Update / Bulk Update Custom Fields):** Multiselect custom fields are now sent as JSON arrays instead of plain strings, fixing `422` validation errors (e.g. *"must be an array"*, required multiselect fields). Values accept a JSON array (`["option1"]`), comma-separated text (`option1,option2`), or a single option.
- **Lead Custom Field (Create / Update):** Multiselect default values are parsed correctly; field `type` is only sent on create (not update).
- **API errors:** HTTP failures (including `422` validation) surface Laravel-style field messages in the node error description via `NodeApiError`.
- **Continue On Fail:** Failed items include `errorSummary`, `httpCode`, and `apiResponseBody` when the API returns a structured error payload.

### Changed

- **Lead Custom Field (Create):** Removed the deprecated **Text Input (Legacy)** type from the Type dropdown. Use **Input** for single-line text fields.
- **Lead Note (List / Create / Get / Update / Delete):** Require **Lead ID** with a clearer UUID-oriented description; removed the unused list **Limit** parameter (API does not support it on this endpoint).
- **Lead Source (Create / Update):** Added **Body Type** (Form / JSON). Form mode supports **Name** and **Color** fields.
- **Lead / Lead Activity / Lead Note:** Shared **Lead ID** parameter is shown for note operations that require a lead context.
- **Custom Fields (Lead form):** Value field help text documents multiselect input formats.
- **Lead Activity Types:** Activity type dropdown now loads dynamically from the API.

---

## [1.1.0] - 2026-05-08

### Enhanced dynamic lead and task workflows

#### AdHub App - Action Node

- Added dynamic dropdown support for lead-related resources and field selectors.
- Improved lead and task filtering/query handling for cleaner node configuration.
- Refined helpers and resource handlers to improve consistency across CRUD and bulk operations.

#### AdHub App Trigger - Webhook Node

- Updated trigger shared services and webhook handling internals for more reliable event processing.

#### Docs and tooling

- Updated README and ignore files to match current package behavior.
- Updated project scripts and TypeScript/build configuration for release readiness.

## [1.0.0] — 2026-05-07

### Initial stable release

#### AdHub App — Action Node

Full CRUD and bulk operations across all core AdHub resources:

**Lead**
- List leads with a form-driven or raw JSON filter builder (powered by the AdHub query builder API)
- Create, Get, Update, Delete a single lead
- Bulk Create, Bulk Delete
- Bulk Update Fields, Bulk Sync Tags, Bulk Update Custom Fields
- Timeline, Entries, List Query Fields

**Lead Activity**
- List, List Types, Create, Get, Update, Delete

**Lead Custom Field**
- List, Create, Get, Update, Delete

**Lead Note**
- List, Create, Get, Update, Delete

**Lead Source**
- List, Create, Get, Update, Delete

**Lead Status**
- List, Create, Get, Update, Delete

**Lead Tag**
- List, Create, Get, Update, Delete

**Task**
- List tasks with the same filter builder as leads
- Create, Get, Update, Delete a single task
- Complete, Bulk Complete, Bulk Delete

#### AdHub App Trigger — Webhook Node

Listens to AdHub webhook events and executes an n8n workflow on match.

Supported event types:
- `lead.created`, `lead.updated`, `lead.deleted`, `lead.*`
- `task.created`, `task.updated`, `task.deleted`, `task.*`
- `*` (all events)

Each workflow gets a unique webhook URL to paste into AdHub (Settings → Integrations → Webhooks). Events that don't match the configured filter are acknowledged and dropped without triggering the workflow.

#### Credential — AdHub App API

Authenticates via an n8n Integration Token issued by AdHub (Settings → Integrations → n8n). Includes a built-in credential test that verifies the token against the AdHub API and shows a green "Connected" status in n8n.

