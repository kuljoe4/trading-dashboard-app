## 2026-10-21 - Escape clear and XCircle clear button for ConfigModal Symbol Inputs
**Learning:** Found that some text inputs in ConfigModal (backtest-symbols, smart-symbols) lacked the Escape-to-clear and XCircle-to-clear functionality present in other search inputs. Implementing these features standardizes the clearability of symbol inputs across the UI, making it more robust.
**Action:** Always ensure that clearable search/symbol inputs have Escape key clearing, an XCircle button wrapped in a Tooltip, right padding to prevent text overlap, and refocus logic on clear.
