# Adhub App n8n Node

An n8n community node for managing AdHub leads, tasks, lead sources, lead statuses, lead tags, activities, and custom fields.

## Local install note

Do not install this package into n8n from the repository root path. On Windows, `npm install <repo-path>` can link the whole checkout, including this repo's dev `node_modules`, and n8n may crash while scanning dependency files such as `brotli-wasm/index.node.js`.

Use one of these instead:

- Install from the compiled `dist` folder
- Install a tarball created with `npm pack`
- Install the published npm package

## Features

- Lead Sources: list, create, get, update, delete
- Lead Statuses: list, create, get, update, delete
- Lead Tags: list, create, get, update, delete
- Leads: list, create, get, update, delete (with advanced filtering)
- Lead extras: query fields, timeline, entries
- Lead Activities: list types, list, create, get, update, delete
- Lead Custom Fields: list, create, get, update, delete
- Tasks: list, create, get, update, delete

## Installation

1. Install dependencies

```bash
npm install
```

2. Start development server

```bash
npm run dev
```

3. In a second terminal, start n8n with live reload enabled

```bash
npm run dev:server
```

## Credentials

Create credentials named `Adhub App API` in n8n and provide:

- `Server URL`: your AdHub host
- `n8n Integration Token`: the one-time token generated from `Settings -> Integrations -> n8n`
- `Ignore SSL Issues`: optional for local or test environments with an incomplete TLS certificate chain

When you test the credential, n8n verifies the token with `POST /api/v1/integrations/n8n/verify`.

Recommended setup flow:

1. Create one AdHub Trigger node in an active n8n workflow and copy its production webhook URL.
2. In AdHub, open `Settings -> Integrations -> n8n`.
3. Paste that production n8n webhook URL into AdHub.
4. Select the trigger events and API scopes in AdHub.
5. Copy the one-time token shown by AdHub.
6. Save that token in the credential.
7. Test the credential to verify it.

Notes:

- Use the same token for AdHub API actions and webhook-linked workflows.
- AdHub manages the webhook subscription on its side. The n8n trigger node receives the webhook payload but does not create or delete AdHub webhook subscriptions through the API.
- Due to AdHub API limitations, you can use just one AdHub trigger webhook URL for each AdHub integration.
- Use one active AdHub Trigger workflow as the intake workflow, then route events with normal n8n nodes such as Switch, IF, or Execute Workflow.
- Do not save an n8n test webhook URL in AdHub. Test URLs are temporary editor URLs; AdHub should use a production URL from an active workflow.
- The trigger node can filter incoming events locally by the selected Trigger On event types.
- If your test host uses a self-signed or incomplete certificate chain, enable `Ignore SSL Issues` temporarily or add the issuing CA to n8n's trust store.

## Trigger routing

AdHub can send events to one webhook URL only. Configure that URL from one active n8n workflow that starts with the AdHub Trigger:

1. AdHub sends every selected event to the single saved n8n production webhook URL.
2. The receiving AdHub Trigger node reads the incoming event name.
3. The trigger starts the workflow only when its Trigger On selection matches the event.
4. Use downstream n8n nodes to branch by event type or call other workflows.

This keeps the trigger aligned with n8n's webhook model: one incoming webhook starts the workflow that owns that production URL, and routing happens inside the workflow.

## Operations

Resource: Lead Source

- List
- Create
- Get
- Update
- Delete

Resource: Lead Status

- List
- Create
- Get
- Update
- Delete

Resource: Lead Tag

- List
- Create
- Get
- Update
- Delete

Resource: Lead

- List
- Create
- Get
- Update
- Delete
- List Query Fields
- Timeline
- Entries

Resource: Lead Activity

- List Types
- List
- Create
- Get
- Update
- Delete

Resource: Lead Custom Field

- List
- Create
- Get
- Update
- Delete

Resource: Task

- List
- Create
- Get
- Update
- Delete

## Notes

- For lead creation and update you can send either form fields or a JSON body.
- When using form fields, Additional Fields supports a JSON object with custom keys.
- For lead list filtering, see [LEAD_LIST_FILTERING.md](LEAD_LIST_FILTERING.md) for detailed documentation.
- The trigger node supports local filtering for incoming AdHub webhook events such as `lead.created`, `lead.updated`, `task.created`, and `task.updated`.
- If a trigger does not run, confirm the AdHub integration is saving a production n8n URL, the workflow is active, the event is selected in AdHub, and the trigger node's Trigger On selection matches the incoming payload.

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```

## Release

```bash
npm run release
```

## License

MIT
