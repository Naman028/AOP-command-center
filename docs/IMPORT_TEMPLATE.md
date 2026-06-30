# Import Template

## Accepted Files

- `.xlsx`
- `.csv`

Reject:

- `.xlsm`
- Macro-enabled files
- Files over 5 MB
- Files that exceed configured row or cell limits
- Files with invalid MIME type or signature

## Required Import Flow

1. Upload authenticated request.
2. Permission and plant-scope check.
3. Extension, MIME, signature, size, row, and cell-count validation.
4. Server-generated temporary filename outside the public web directory.
5. Row parsing and validation.
6. Preview response with row-level errors.
7. Separate confirm request.
8. Re-check permission and plant scope.
9. Controlled import workflow.
10. Temporary file deletion.
11. ImportBatch metadata and audit event.

## Row Validation

Each row must validate:

- Plant identifier is authorized for the user.
- Material, period, metric type, and value are valid.
- Required fields are present.
- Dates and financial periods are valid.
- Duplicate prevention rules are enforced by database indexes.

## Export Formula Escaping

Escape exported values beginning with:

- `=`
- `+`
- `-`
- `@`
- tab
- line break

