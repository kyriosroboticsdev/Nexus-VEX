# App Icons

electron-builder expects these three files in this folder:

| File         | Platform | Size          |
|--------------|----------|---------------|
| `icon.ico`   | Windows  | 256×256 (multi-size .ico) |
| `icon.icns`  | macOS    | 512×512 (multi-size .icns) |
| `icon.png`   | Linux    | 512×512 PNG   |

## Quickest way to make them

1. Create a 1024×1024 PNG of your logo (e.g. the Nexus/VEXScout mark).
2. Use a free converter:
   - PNG → ICO: https://convertico.com
   - PNG → ICNS: https://cloudconvert.com/png-to-icns
3. Drop the three files here and run `npm run dist`.

Until icons are added, electron-builder will use its default Electron icon.
