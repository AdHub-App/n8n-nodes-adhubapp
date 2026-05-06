# Lead List Filtering Guide

This guide explains how to use the query builder fields API to filter leads in the AdHub App n8n node.

## Overview

The lead list API supports advanced filtering using a query builder approach. You can filter leads by system fields (status, source, created*at, etc.) and custom fields (cf*\*).

## Filter Payload Structure

The filter payload follows this structure:

```json
{
  "mode": "AND" | "OR",
  "rules": [
    {
      "field": "lead.status",
      "operator": "Equals To",
      "value": "New"
    }
  ]
}
```

## Available Filter Fields

### System Fields

| Field Key            | Label      | Type   | Operators                                                                                                                                                                                    |
| -------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lead.first_name`    | First name | text   | Equals To, Not Equals To, Contains, Does Not Contain, Starts With, Ends With, Is Empty, Is Not Empty                                                                                         |
| `lead.last_name`     | Last name  | text   | Equals To, Not Equals To, Contains, Does Not Contain, Starts With, Ends With, Is Empty, Is Not Empty                                                                                         |
| `lead.email`         | Email      | text   | Equals To, Not Equals To, Contains, Does Not Contain, Starts With, Ends With, Is Empty, Is Not Empty                                                                                         |
| `lead.mobile_number` | Phone      | text   | Equals To, Not Equals To, Contains, Does Not Contain, Starts With, Ends With, Is Empty, Is Not Empty                                                                                         |
| `lead.owner`         | Owner      | select | Equals To, Not Equals To, Is Empty, Is Not Empty                                                                                                                                             |
| `lead.status`        | Status     | select | Equals To, Not Equals To, Is Empty, Is Not Empty                                                                                                                                             |
| `lead.source`        | Source     | select | Equals To, Not Equals To, Is Empty, Is Not Empty                                                                                                                                             |
| `lead.created_at`    | Created at | date   | Equals To, Before, After, On Or Before, On Or After, Between, Is Empty, Is Not Empty, Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, X Days Before, X Days After |
| `lead.tag`           | Tags       | select | Equals To, Not Equals To, Is Empty, Is Not Empty                                                                                                                                             |

### Custom Fields

| Field Key             | Label                    | Type   | Operators                                                                                                                                                                                                                                     |
| --------------------- | ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cf_company`          | Company                  | text   | Equals To, Not Equals To, Contains, Starts With, Ends With, Before, After, Is Empty, Is Not Empty, Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, On Or Before, On Or After, Between, X Days Before, X Days After |
| `cf_job_title`        | Job Title                | text   | Equals To, Not Equals To, Contains, Starts With, Ends With, Before, After, Is Empty, Is Not Empty, Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, On Or Before, On Or After, Between, X Days Before, X Days After |
| `cf_service_interest` | Service interest         | select | Equals To, Not Equals To, Contains, Starts With, Ends With, Before, After, Is Empty, Is Not Empty, Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, On Or Before, On Or After, Between, X Days Before, X Days After |
| `cf_monthly_budget`   | Monthly marketing budget | select | Equals To, Not Equals To, Contains, Starts With, Ends With, Before, After, Is Empty, Is Not Empty, Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, On Or Before, On Or After, Between, X Days Before, X Days After |
| `cf_timeline`         | Timeline                 | select | Equals To, Not Equals To, Contains, Starts With, Ends With, Before, After, Is Empty, Is Not Empty, Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, On Or Before, On Or After, Between, X Days Before, X Days After |
| `cf_internal_notes`   | Internal notes           | text   | Equals To, Not Equals To, Contains, Starts With, Ends With, Before, After, Is Empty, Is Not Empty, Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year, On Or Before, On Or After, Between, X Days Before, X Days After |

### Select Field Options

#### Lead Status Options

- `Lead Unattended`
- `New`
- `Contacted`
- `Lead Won`
- `Lead Lost`

#### Lead Source Options

- `Website`
- `Facebook`
- `WhatsApp`
- `API`
- `N8N`
- `Manual`
- `Walk-in`
- `Referral`

#### Service Interest Options

- `Facebook Page Management`
- `Facebook Lead Campaign`
- `SEO`
- `Google Ads`
- `Content Marketing`
- `Multiple services`

#### Monthly Budget Options

- `< $500`
- `$500–$2k`
- `$2k–$5k`
- `$5k+`

#### Timeline Options

- `ASAP`
- `This quarter`
- `Next quarter`
- `Just exploring`

## Using Filters in n8n Node

### Method 1: Form Mode (Recommended)

When using the n8n node with `Body Type` set to `Form`:

1. **Set Filter Mode**: Choose between `And` (all rules must match) or `Or` (any rule can match)

2. **Add Filter Rules**: Use the `Filter Rules` collection to add multiple rules:
   - **Field**: Enter the field key (e.g., `lead.status`, `cf_company`)
   - **Operator**: Enter one of the allowed operators for that field (e.g., `Equals To`, `Contains`)
   - **Value**: Enter the value to filter by (for select fields, use the option value like `New`, `Website`)

### Example 1: Filter by Status

To get all leads with status "New":

```
Filter Mode: And
Filter Rules:
  - Field: lead.status
  - Operator: Equals To
  - Value: New
```

### Example 2: Filter by Multiple Conditions

To get leads with status "New" AND source "Website":

```
Filter Mode: And
Filter Rules:
  - Field: lead.status
  - Operator: Equals To
  - Value: New
  - Field: lead.source
  - Operator: Equals To
  - Value: Website
```

### Example 3: Filter with OR Logic

To get leads with status "New" OR status "Contacted":

```
Filter Mode: Or
Filter Rules:
  - Field: lead.status
  - Operator: Equals To
  - Value: New
  - Field: lead.status
  - Operator: Equals To
  - Value: Contacted
```

### Example 4: Filter by Custom Field

To get leads where company contains "Tech":

```
Filter Mode: And
Filter Rules:
  - Field: cf_company
  - Operator: Contains
  - Value: Tech
```

### Example 5: Filter by Date

To get leads created today:

```
Filter Mode: And
Filter Rules:
  - Field: lead.created_at
  - Operator: Today
  - Value: (leave empty for date operators like Today, Yesterday, etc.)
```

### Example 6: Filter by Date Range

To get leads created between two dates:

```
Filter Mode: And
Filter Rules:
  - Field: lead.created_at
  - Operator: Between
  - Value: 2026-01-01,2026-03-31
```

### Example 7: Check Empty Fields

To get leads without an email:

```
Filter Mode: And
Filter Rules:
  - Field: lead.email
  - Operator: Is Empty
  - Value: (leave empty)
```

### Example 8: Complex Filter

To get leads that are:

- Status is "New" OR "Contacted"
- AND source is "Website"
- AND company is not empty

```
Filter Mode: And
Filter Rules:
  - Field: lead.status
  - Operator: Equals To
  - Value: New
  - Field: lead.status
  - Operator: Equals To
  - Value: Contacted
  - Field: lead.source
  - Operator: Equals To
  - Value: Website
  - Field: cf_company
  - Operator: Is Not Empty
  - Value: (leave empty)
```

Note: For complex OR conditions within AND, you may need to use JSON mode.

### Method 2: JSON Mode

When using the n8n node with `Body Type` set to `JSON`, you can provide the complete filter payload directly:

```json
{
	"per_page": 50,
	"page": 1,
	"search": "john",
	"filter": {
		"mode": "AND",
		"rules": [
			{
				"field": "lead.status",
				"operator": "Equals To",
				"value": "New"
			},
			{
				"field": "lead.source",
				"operator": "Equals To",
				"value": "Website"
			},
			{
				"field": "cf_company",
				"operator": "Contains",
				"value": "Tech"
			}
		]
	},
	"sort_by": "name",
	"sort_dir": "asc"
}
```

## Getting Available Fields Dynamically

You can use the `List Query Fields` operation to fetch all available filter fields and their options:

1. Set Resource: `Lead`
2. Set Operation: `List Query Fields`
3. Set Context: `Lead List`

This will return all available fields with their types, operators, and options (for select fields).

## Important Notes

1. **Field Keys**: Always use the exact field key (e.g., `lead.status`, not `status`)
2. **Operator Names**: Use the exact operator name as returned by the query fields API
3. **Select Field Values**: For select fields, use the `value` from the options array (e.g., `New`, not `New Lead`)
4. **Date Operators**: Operators like `Today`, `Yesterday`, `This Week` don't require a value
5. **Empty Checks**: Use `Is Empty` or `Is Not Empty` operators without a value
6. **Multiple Rules**: You can add as many filter rules as needed
7. **Filter Mode**: Choose `And` for all rules to match, `Or` for any rule to match

## Troubleshooting

### Filter not working?

- Verify the field key is correct (use List Query Fields to check)
- Ensure the operator is valid for that field type
- For select fields, use the exact option value
- Check that the filter mode (AND/OR) is appropriate for your use case

### Getting empty results?

- Try removing filters one by one to identify the issue
- Use the List Query Fields operation to verify available options
- Check if the value format matches the field type (date format, etc.)

### Need complex OR logic?

- Use JSON mode for complex nested conditions
- Consider using multiple API calls with different filters if needed
