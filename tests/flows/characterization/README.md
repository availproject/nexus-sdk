# Swap Pipeline Characterization

These tests capture the current public `swap()` flow before source-side Calibur execution changes.

Keep assertions on stable boundaries:
- intent approval happens before execution
- source swaps run before bridge deposits
- bridge intent publication uses the cosmos signing client, not `vscCreateRFF`
- destination handling runs after bridge handling
- Step events and final result shape stay coherent

Do not lock behavior that the source-side Calibur implementation intentionally changes, including source quote recipient APIs, Calibur bridge deposit batch assembly, or the current lazy bridge ensure ordering.
