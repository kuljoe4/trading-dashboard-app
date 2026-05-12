## 2025-05-14 - [Enhanced Button Primitives & Form Accessibility]
**Learning:** Generic primitives like `Btn` often miss critical states (disabled, focus) and attribute support (props spreading), which limits their accessibility and usability. Forms also frequently lack proper label-input associations.
**Action:** Always ensure UI primitives support `disabled` states, spread props for ARIA/title attributes, and have clear focus indicators. Use `htmlFor` and `id` to explicitly link labels and inputs.
