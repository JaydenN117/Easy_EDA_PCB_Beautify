# Beautify/Optimize/Smooth PCB Routing

One-click PCB corner optimization to smooth arcs, ensuring impedance continuity; Bezier-based width transitions at width change points (better teardrops). Supports multi-step undo, snapshot management, merge short segments, force arc generation, and other advanced optimization features.

1. Corner beautification to arcs (radius is editable after creation)

![Preview](./images/preview1.gif)

2. Smooth width transitions (based on Bezier curves)

![Preview](./images/preview2.gif)

3. Snapshot management & undo support

![Preview](./images/preview3.gif)

> :warning: Extension is under active development. Please back up your project before operations. Feedback is welcome if you encounter any issues.

## Features

| Feature | Description |
| ------ | ------ |
| Smooth Routing | Converts sharp corners to smooth arcs with adjustable max radius |
| Width Transition | Smooth gradient between different track widths (better teardrops), based on Bezier curves |
| Snapshot Management | Auto/manual snapshot view switching, safely restore state at any time |
| Advanced Controls | Force small-radius arc generation, merge short segments, and other advanced strategies (Beta) |

## Usage

**Menu Location:** Advanced -> Beautify PCB

- **Smooth Routing (Selected/All)** - Process track corners (arc-based beautification)
- **Width Transition (Selected/All)** - Generate width gradients (Bezier curve-based beautification)
- **Undo** - Revert to previous operation (supports multi-step undo)
- **Settings** - Configure radius, transition parameters, manage snapshot history, and more

![Preview](./images/topMenu.png)

![Preview](./images/setting.png)

You can pin this to the top menu via: Advanced -> Extension Manager -> Installed Extensions -> Beautify PCB -> Configure

![Preview](./images/topMenuConfig.png)

## Contributing

Contributions via Fork & PR are welcome! Development environment setup:

### Clone the repository

```bash
git clone --recursive https://github.com/m-RNA/Easy_EDA_PCB_Beautify.git
cd Easy_EDA_PCB_Beautify
```

### Already cloned? Pull submodules

```bash
git submodule update --init --recursive
```

> :warning: **Note:** Submodules are locked to a specific compatible version. Do not use `--remote` to update them, as this may cause build failures.

### Install & Build

```bash
npm install
npm run build
```

Build output: `.eext` extension package in the `build/dist/` directory

### Development Notes

Please read this file to avoid common pitfalls: [DEVELOPER_NOTES.md](./DEVELOPER_NOTES.md)

## Project Structure

```txt
src/
├── index.ts               # Entry & menu registration
└── lib/
    ├── beautify.ts        # Corner smoothing (Beautify)
    ├── widthTransition.ts # Width transitions
    ├── snapshot.ts        # Snapshot management
    ├── math.ts            # Math utilities
    ├── eda_utils.ts       # EDA utilities
    ├── logger.ts          # Log output
    └── settings.ts        # Settings read/write
iframe/
└── settings.html          # Settings UI
pro-api-sdk/               # Git submodule (JLC EDA Pro Extension API SDK)
```

## License

This project is licensed under the Apache-2.0 License. See [Apache-2.0 License](https://www.apache.org/licenses/LICENSE-2.0.txt) for details.
