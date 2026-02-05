# Changelog

## 1.0.5-rc1 (2026-02-05)

### New

- Design Rule Check (DRC) settings, including enable toggle and safety clearance configuration

## 1.0.4 (2026-02-04)

### Improvements

- Settings UI: completely new layout with dedicated snapshot management card; added auto/manual snapshot view toggle
- Animations: improved refresh button interaction with smooth spinning animation on document switch or data refresh

### Core Upgrade (Snapshot Management V2)

- Smart branching: Git-style timeline management; automatically truncates invalid "future" history when new changes occur after an undo
- Deep deduplication: introduced deep comparison algorithm based on sorted primitive IDs, completely resolving false duplicate snapshots caused by ordering differences
- Logic fix: fixed undo operation index calculation error, eliminating the state-skipping bug
- Code refactoring: cleaned up legacy code, fully migrated to V2 storage structure

### Other

- Updated documentation and settings UI screenshots
- Renamed extension: Beautify/Optimize/Smooth PCB Routing

## 1.0.3-rc1 (2026-02-03)

### New

- Optimized extension name and description
- Improved translation quality
- Version bump to 1.0.3

## 1.0.2 (2026-02-02)

### New

- Renamed extension
- Added "Melt" keyword
- Updated homepage and issue links
- Version bump to 1.0.2

## 1.0.1 (2026-02-02)

### New

- Settings UI: supports simple math expression evaluation; supports keyboard up/down arrows and mouse wheel for value adjustment
- Settings UI: added author information

### Bug Fixes

- Snapshot management: added PCB ID check to prevent restoring incorrect snapshots; improved undo experience by saving pre/post operation snapshots; manual snapshot creation no longer duplicates the latest recorded snapshot
- Settings UI: fixed JS warnings, input validation improvements
- Code cleanup: removed unnecessary unused code, unified log prefix format

## 1.0.0 (2026-02-01)

### Features

- Smooth Routing: converts right-angle corners to smooth arcs
- Width Transition: smooth gradients between different track widths, based on Bezier curves
- Snapshot Management: one-click backup/restore routing state
- Undo Support: automatic backup before operations, revert at any time
- Settings UI: configurable corner radius, transition parameters, snapshot options, and more

### Notes

- Supports both selected and global processing modes
- Arcs are based on actual arc primitives, allowing radius editing after creation
- Width transitions are intelligently limited to not exceed the narrow track length
