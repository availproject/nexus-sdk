# Swap Pipeline Characterization

These tests pin the public `swap()` flow at stable boundaries so refactors don't silently shift sequencing or contracts between layers.

Keep assertions on stable boundaries:
- intent approval happens before execution
- source swaps run before bridge deposits
- bridge intent publication uses the cosmos signing client, not `vscCreateRFF`
- destination handling runs after bridge handling
- Step events and final result shape stay coherent

Avoid locking down internals that legitimately vary by execution mode (7702/Calibur vs `safe_account`), such as source quote recipient APIs, source-side batch assembly, or lazy bridge-ensure ordering.
