# n8n-nodes-adhubapp

An [n8n](https://n8n.io) community node package for [AdHub](https://adhubapp.com) — manage leads, tasks, activities, notes, custom fields, statuses, tags, and sources directly from your n8n workflows.

> **v1.0.0** — stable release. Some advanced features (sorting endpoints, task status updates) are under active development and will be added in upcoming minor versions.

---

## Features

### Action Node — *AdHub App*

| Resource | Operations |
|---|---|
| **Lead** | List, Create, Get, Update, Delete, Bulk Create, Bulk Delete, Bulk Update Fields, Bulk Sync Tags, Bulk Update Custom Fields, Timeline, Entries, List Query Fields |
| **Lead Activity** | List, List Types, Create, Get, Update, Delete |
| **Lead Custom Field** | List, Create, Get, Update, Delete |
| **Lead Note** | List, Create, Get, Update, Delete |
| **Lead Source** | List, Create, Get, Update, Delete |
| **Lead Status** | List, Create, Get, Update, Delete |
| **Lead Tag** | List, Create, Get, Update, Delete |
| **Task** | List, Create, Get, Update, Delete, Complete, Bulk Complete, Bulk Delete |

The **List Leads** and **List Tasks** operations include a form-driven filter builder backed by the AdHub query builder API — pick fields, operators, and values from dropdowns without writing raw JSON.

### Trigger Node — *AdHub App Trigger*

Reacts to AdHub webhook events. Configure which event types to listen for:

- `lead.created`, `lead.updated`, `lead.deleted` (or `lead.*` for all lead events)
- `task.created`, `task.updated`, `task.deleted` (or `task.*` for all task events)
- `*` for all events

---

## Installation

### Via n8n UI (recommended)

1. Open n8n → **Settings** → **Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-adhubapp`
4. Click **Install**

### Self-hosted (manual)

```bash
npm install n8n-nodes-adhubapp
```

Then restart n8n. For Docker-based installs, add the package to your `N8N_CUSTOM_EXTENSIONS` path.

---

## Authentication

1. In n8n, go to **Credentials** → **New** → search for **AdHub App API**
2. Enter your **n8n Integration Token** from AdHub (Settings → Integrations → n8n)
3. Click **Test** to verify — you should see a green "Connected" status

---

## Usage

### Filtering Leads

The **List Leads** operation supports two body modes:

- **Form** — use the visual filter builder to add rules, pick fields from your AdHub account, set operators and values
- **JSON** — paste a raw JSON body for full control

Example filter body (JSON mode):

```json
{
  "per_page": 50,
  "filter": {
    "mode": "and",
    "rules": [
      { "field": "lead.status", "operator": "Equals To", "value": "New" },
      { "field": "lead.created_at", "operator": "This Week" }
    ]
  }
}
```

### Webhook Trigger

The trigger node provides a webhook URL to paste into AdHub (Settings → Integrations → Webhooks). Each n8n workflow gets a unique webhook URL. Select the event types you care about in the trigger node — events that don't match are acknowledged and dropped without executing the workflow.

---

## Compatibility

- **n8n** ≥ 1.0.0
- **Node.js** ≥ 18

---

## License

[MIT](LICENSE.md)

---

## Support

- **AdHub support:** support@adhub.app
- **Issues:** [github.com/AdHub-App/n8n-nodes-adhubapp/issues](https://github.com/AdHub-App/n8n-nodes-adhubapp/issues)
