# V25.2 — Process Persistence Fix

- Fixed disappearing process parameters and readings after cloud refresh.
- Registered `processTemplates` and `processReadings` in the client synchronization collection list.
- Preserved these collections during load, refresh, polling, seed, and cache replacement.
- Hardened equipment ID and project/model matching in process history.
- Preserved V25.1 Copilot Cross-Intelligence and all V24.4 functionality.
