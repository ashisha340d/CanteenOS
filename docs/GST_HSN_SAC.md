# GST / HSN / SAC Master Data Synchronization

> Verbatim requirement specification as supplied. Not yet implemented, not yet adapted to
> MenuBoard's existing schema/API conventions.

The application must support importing and synchronizing official Indian GST HSN/SAC master
data instead of manually entering thousands of classification codes.

Create a dedicated HSN/SAC Master table if an equivalent table does not already exist.

Suggested conceptual structure:

```
hsn_sac_master
id
code
code_type
description
chapter
heading
sub_heading
gst_rate
cgst_rate
sgst_rate
igst_rate
cess_rate
is_active
source
source_version
last_synced_at
created_at
updated_at
```

Do not blindly use these exact columns or types. Inspect the existing database conventions
first and adapt the schema accordingly.

The HSN/SAC Master must support both:

```
HSN = goods
SAC = services
```

## Official data source

Use the official GST/GSTN HSN/SAC master data as the authoritative source.

The system must NOT scrape random third-party HSN websites.

Provide an administrator-controlled synchronization mechanism.

Add a "Sync GST Master" button in the Tax/Compliance administration interface.

Example UI:

```
Tax & Compliance Masters

[ HSN/SAC Master ] [ Tax Profiles ]

HSN/SAC Master
Total Codes: 0
Last Synced: Never
Source: GST/GSTN

[ Sync GST Master ]
```

After synchronization:

```
Total Codes: 12,345
Last Synced: 11 Aug 2026 10:42 PM
Source: GST/GSTN
Status: Synced
```

The exact count must come from the imported dataset. Never hard-code a count.

## Sync behaviour

When the administrator clicks "Sync GST Master":

1. Retrieve the latest available official GST/GSTN HSN/SAC master dataset using the supported
   official download/API/source.
2. Validate the downloaded dataset.
3. Parse HSN and SAC records.
4. Normalize codes and descriptions.
5. Validate required fields.
6. Compare the incoming dataset with the existing local master.
7. Insert new codes.
8. Update changed descriptions, classifications and tax information.
9. Mark records no longer present in the authoritative dataset as inactive rather than
   immediately deleting them.
10. Preserve historical references used by existing Food Items.
11. Store source and synchronization metadata.
12. Update `last_synced_at`.
13. Return a synchronization summary.

Synchronization summary must show:

```
Records Downloaded
Records Added
Records Updated
Records Deactivated
Records Unchanged
Records Failed
Synchronization Time
Source
Source Version / Effective Date where available
```

Do not delete existing HSN/SAC records that are already referenced by Food Items.

If the official source does not provide GST rates in the downloadable HSN/SAC dataset, do not
invent or infer rates. Import the classification data and maintain GST rates through the Tax
Profile / official GST rate master mechanism.

## HSN/SAC search

The Food Item Tax & Compliance section must use the synchronized HSN/SAC Master.

HSN / SAC Code field:

```
[ Search HSN/SAC code or description... ]
```

Search must support:

```
Exact code
Partial code
Description
HSN/SAC type
```

Example:

```
Search:
"996331"

Result:
996331
Restaurant services including cafeteria and similar eating facilities

Search:
"restaurant"

Result:
Matching HSN/SAC records
```

When a code is selected, populate the applicable classification information from the
synchronized master.

Do not allow users to manually type arbitrary HSN/SAC codes without validation unless an
administrator explicitly enables an override.

## Tax Profile Master

Keep Tax Profiles as a separate reusable master.

Tax Profiles reference the HSN/SAC Master where appropriate.

Conceptually:

```
HSN/SAC Master
        ↓
Tax Profile Master
        ↓
Food Item Master
        ↓
Menu Variant
```

Example:

```
HSN/SAC Master
996331 → Restaurant Service

Tax Profile
Restaurant Service 5%
→ SAC 996331
→ GST 5%
→ CGST 2.5%
→ SGST 2.5%
→ IGST 5%

Food Item
Dal Tadka
→ Tax Profile = Restaurant Service 5%

Variants
200 g → inherits
300 g → inherits
500 g → inherits
```

## Synchronization UI location

Use the existing Menu Master / Masterfile administration architecture.

Do not create an unrelated standalone application.

If the application already has a Masterfile navigation structure, add:

```
Menu Master
  Food Items
  Categories
  Menus
  Variants
  ...
  Tax Profiles
  HSN/SAC Master
```

If there is already an appropriate Tax/Compliance master location, reuse it instead.

The Food Item screen should NOT contain the synchronization controls.

The Food Item screen only consumes the synchronized HSN/SAC Master through the Tax Profile /
HSN/SAC selector.

## Administration

Only authorized administrator roles may:

```
Sync GST Master
Create Tax Profiles
Edit Tax Profiles
Deactivate Tax Profiles
Manually override HSN/SAC mappings
```

Normal Food Item users may select an available Tax Profile and HSN/SAC classification
according to their permissions.

## Audit log

Record every synchronization:

```
Started At
Completed At
User
Source
Source Version
Records Downloaded
Records Added
Records Updated
Records Deactivated
Records Failed
Status
Error Details
```

Record manual Tax Profile changes and HSN/SAC overrides through the existing audit mechanism
if one exists.

## Scheduled synchronization

Do not automatically overwrite production tax configuration merely because new GST master data
becomes available.

The Sync GST Master operation updates the classification master.

Existing Food Item Tax Profiles must remain stable until an administrator reviews and changes
them.

If the official source provides effective dates, store them and preserve historical records.

Never automatically change the GST rate of an existing Food Item solely because the HSN/SAC
master was synchronized.

## Testing

Test:

1. Initial GST master synchronization.
2. Repeated synchronization with the same dataset.
3. New HSN/SAC records.
4. Changed HSN/SAC descriptions.
5. Deactivated HSN/SAC records.
6. Existing Food Items referencing synchronized codes.
7. HSN/SAC search by code.
8. HSN/SAC search by description.
9. Tax Profile selection.
10. Food Item creation using a Tax Profile.
11. Food Item editing.
12. Variant inheritance.
13. Variant tax override.
14. Failed synchronization.
15. Invalid source data.
16. Permission restrictions.
17. Audit logging.

## Important data integrity rule

The official GST/GSTN dataset is the source for HSN/SAC classification data.

The application's Tax Profile Master is the source for the Food Item's selected tax treatment.

Do not merge these two concepts into one table.

```
HSN/SAC Master = classification reference data.
Tax Profile Master = reusable tax treatment configuration.
Food Item = assignment of a Tax Profile.
Menu Variant = inherits Food Item Tax Profile unless an explicit override exists.
```

## Reference UI (supplied screenshot)

Food Item → Tax & Compliance section:

```
Tax Profile: Restaurant Service 5%    Supply Type: Service
HSN / SAC Code: 996331 [search]       GST Taxability: Taxable    GST Rate: 5%
  SAC: Restaurants, cafes and similar eating facilities
CGST Rate: 2.5%   SGST Rate: 2.5%   IGST Rate: 5%   Cess Rate: 0%
Tax Inclusive / Exclusive: Inclusive
ITC Eligibility: Not Available
Effective From: 01/07/2017   Effective To: —
Tax Exemption Reason: —
Regulatory Notes: Applies to dine-in, takeaway and delivery.
"Manage Profiles" link → Tax Profile master (not editable inline).
```
