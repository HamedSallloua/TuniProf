# Délégations: how to provide the list

Put the official list in **`db/data/delegations.csv`**. It is loaded automatically by `npm run db:reset` and `npm run db:reset:test`, or on its own with `npm run db:import:delegations`.

## Format

One line per délégation. The first line is the header and must contain these names (any order):

| Column        | Required | Content                                                                               |
| ------------- | -------- | ------------------------------------------------------------------------------------- |
| `governorate` | yes      | The governorate: French name (`Ben Arous`), its slug (`ben-arous`) or its Arabic name |
| `name_fr`     | yes      | The délégation name in French                                                         |
| `name_ar`     | no       | The délégation name in Arabic (can be empty)                                          |

- Separator: `;` or `,` (Excel in French saves with `;`, both work).
- Save as **CSV UTF-8** (in Excel: "Enregistrer sous" then "CSV UTF-8 (délimité par des virgules)"), so accents and Arabic stay correct.
- The same délégation name can appear in two different governorates.
- If anything is wrong, the import prints every problem with its line number and imports nothing.

## Example (made-up values, only to show the shape)

```
governorate;name_fr;name_ar
Tunis;Exemple Un;مثال
Sfax;Exemple Deux;
```

## Notes

- Running the import again is safe. It updates names of délégations that already exist. It is meant for the first load: it would overwrite names edited later in the admin panel.
