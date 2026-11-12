# Native CLI document

```mermaid
---
config:
  layout: elk
---
flowchart LR
A[CLI input] --> B[Browser output]
```

:::filetree{title="sample/"}
- `src/` — application source
  - `fileTreeSearchToken.ts` — entry point
  - `modules/`
    - `users.module.ts` — feature module
- `empty/` — reserved directory
- `package.json` — dependencies
:::
