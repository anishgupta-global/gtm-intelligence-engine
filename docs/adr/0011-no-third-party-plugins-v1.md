# ADR-0011 — First-party plugins only in v1; marketplace deferred

**Status:** accepted

**Decision:** Connectors and providers are plugins behind stable interfaces, but only in-repo implementations load. No remote plugin loading, no marketplace, in v1.

**Why:** Executing community code in-process is a supply-chain hole (arbitrary code with DB access). An ecosystem is worthless if the first security incident kills trust.

**Consequences:** No third-party ecosystem at launch. The v2 path is a manifest + permission model with plugins running out-of-process (subprocess with a narrow RPC surface).
