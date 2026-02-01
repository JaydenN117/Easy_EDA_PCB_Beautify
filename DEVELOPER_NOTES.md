# Developer Notes: Handling Memory Isolation Issues in EasyEDA Extension Development

This document describes a specific pitfall encountered during the development of JLC EDA extensions and how to solve it. This is particularly relevant when extensions involve both a Main Process (running in the extension worker) and an Iframe UI (running in a sandboxed iframe).

## Background: The `eda` Global Object

To understand the solution, we must first understand the host environment. The extension operates within a managed runtime provided by JLC EDA Pro.

### 1. The `eda` Object as a Singleton

Every extension runtime is injected with a **unique and independent** `eda` object in its root scope.

- **Isolation**: This object is not shared with other extensions, ensuring that properties attached to it do not collide with other installed plugins.
- **Ubiquity**: This object is accessible globally in both the Main Process (Worker) and the Iframe logic (through the parent scope proxy or direct injection), making it the *only* guaranteed shared memory reference between these contexts.

### 2. Standard Usage: The Official API Pattern

According to the official documentation, the extension API module contains many specialized classes. All Classes, Enums, Interfaces, and Type Aliases are registered under the EDA base class and instantiated as the `eda` object, which exists in the root scope of every extension runtime.

**Key Characteristics:**

- **Isolation**: Every extension runtime generates an independent `eda` object not shared with others.
- **Access Pattern**: `eda` + `Class Instance Name` + `Method/Variable`.
- **Naming Rule**: The system instantiates classes using a specific naming convention: **the first three letters before the underscore are lowercased**.

| Class Name | Instance Name |
| --- | --- |
| `SYS_I18n` | `sys_I18n` |
| `SYS_ToastMessage` | `sys_ToastMessage` |

```js
// Example: Calling SYS_I18n.text and SYS_ToastMessage.showMessage
// Note strictly lowercase 'sys' prefix
eda.sys_ToastMessage.showMessage(eda.sys_I18n.text('Done'), ESYS_ToastMessageType.INFO);
```

Because of property **#1 (Isolation)**, we can repurpose this object to store our own global state, solving the isolation problem described below.

## The Problem: Module-Level Variable Isolation

When developing extensions that share state between the worker logic and the settings UI (iframe), you might encounter situations where updates in one context are not reflected in the other, even if you are accessing what seems to be the same "File" or "API".

### Scenario

1. **Main Process (`src/lib/*.ts`)**: Updates a module-level variable (e.g., `let globalCache = [...]`).
2. **Iframe UI (`iframe/settings.html`)**: Calls a function exposed by the main process (via `eda.extension_api...`) that tries to read that variable.
3. **Result**: The Iframe sees an stale or empty version of the variable, while the Main Process sees the updated one.

### Cause

In the Javascript environment of EasyEDA Pro extensions:

- The `src/` code bundles into a worker script.
- The `iframe/settings.html` runs in a separate browser context (an iframe).
- While the `eda` global object facilitates communication, **Module Scoped Variables** (declared with `let`, `const` at the top level of a file) may be instantiated separately for different contexts or re-evaluated in ways that break reference equality.

## The Solution: Global Object Anchoring

To ensure that both the Main Process and the Iframe logic access the **exact same memory reference** for shared state (like a cache), you must anchor that state to the globally shared `eda` object.

### Implementation

Instead of:

```typescript
// src/lib/state.ts
let myCache: any[] = []; // ❌ Risky: May be isolated per context

export function updateCache(data: any) {
	myCache = data;
}

export function getCache() {
	return myCache;
}
```

Use:

```typescript
// src/lib/state.ts
const CACHE_KEY = '_unique_extension_id_cache';

export function updateCache(data: any) {
	// ✅ Safe: Anchored to the single source of truth 'eda'
	(eda as any)[CACHE_KEY] = data;
}

export function getCache() {
	return (eda as any)[CACHE_KEY] || [];
}
```

### Best Practices

1. **Unique Keys**: Always use a unique prefix (e.g., `_jlc_beautify_...`) to avoid collisions with other extensions or system properties.
2. **Callbacks**: This applies to callbacks as well. If you need the Main Process to trigger a UI update inside the Iframe, register the callback on the `eda` object rather than a local variable.
3. **Cleanup**: Be mindful of cleaning up large objects if the extension is unloaded (though rare for this type of extension).

## Case Study: Snapshot Feature

In the **Easy EDA PCB Beautify** extension, we encountered this with the Snapshot list.

- **Symptom**: Snapshots created automatically by the router were not appearing in the Settings UI list, despite the UI polling for updates.
- **Fix**: We moved `globalSnapshotsCache` from a file-level variable in `snapshot.ts` to `eda._jlc_beautify_snapshots_cache`. The UI and the Main Process now read/write to the exact same array reference in memory.

## Iframe Resource Inlining

When using `sys_IFrame.openIFrame`, external CSS (`<link href="...">`) and JS (`<script src="...">`) files referenced in the HTML may fail to load in the extension environment.

**Recommendation**: Always **inline** your CSS and JavaScript directly into the HTML file using `<style>` and `<script>` blocks to ensure the UI renders correctly.

---
Created: 2026-01-31
Updated: 2026-02-02
