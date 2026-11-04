# DLT Logo

Square 1:1 logo assets for the DLT token and hourly lottery.

## Files

| File | Use | Size |
| --- | --- | --- |
| `dlt-logo-neon-1024.png` | Primary token icon / OKX avatar | 1024x1024, ~305 KB |
| `dlt-logo-neon-512.png` | Web / app | 512x512, ~122 KB |
| `dlt-logo-neon-256.png` | Token list / exchange upload | 256x256, ~48 KB |
| `dlt-logo-pop-1024.png` | Bright marketing variant | 1024x1024, ~288 KB |
| `dlt-logo-pop-512.png` | Bright marketing variant | 512x512, ~115 KB |
| `dlt-logo-pop-256.png` | Bright marketing variant | 256x256, ~44 KB |
| `dlt-mark-transparent-1024.png` | Mark only, transparent background | 1024x1024, ~141 KB |
| `dlt-mark-transparent-512.png` | Mark only, transparent background | 512x512, ~54 KB |
| `dlt-mark-transparent-256.png` | Mark only, transparent background | 256x256, ~20 KB |

Every PNG is 1:1 and below 1 MB. The SVG masters are included for editing.

## Design

- **D monogram**: the first letter of DLT, built as one continuous shape.
- **Clock**: one-hour lottery periods and the 200-block draw wait.
- **Four-point spark**: a winning draw / early-stage energy.
- **Gradient**: cyan, blue, violet, magenta, orange and lemon; vivid but still legible at small sizes.

## Palette

| Color | Hex |
| --- | --- |
| Cyan | `#00E5FF` / `#00F0FF` |
| Blue | `#5B6CFF` |
| Violet | `#A855F7` / `#7C3AED` |
| Magenta | `#FF2D95` |
| Orange | `#FF6A00` / `#FF9E00` |
| Lemon | `#FFE95C` / `#FFD400` |
| Navy | `#05070F` / `#081020` |

## Recommended use

- Use `dlt-logo-neon-1024.png` as the main brand and OKX/token icon source.
- Use `dlt-logo-pop-1024.png` for bright social/marketing material.
- Use `dlt-mark-transparent-1024.png` when placing the mark on a dark custom background.

## Regenerate

```bash
cd logo
npm install --omit=dev --no-audit --no-fund
node generate.js
```

