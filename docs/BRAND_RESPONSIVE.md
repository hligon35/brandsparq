# BrandSparQ brand and responsive system

The application UI now follows the visual language of the approved BrandSparQ logo:

- Deep navy for typography and authority
- Electric blue as the primary action color
- Cyan/teal for social/creative energy
- Orange as the spark/highlight color
- White cards on a soft blue-white application background
- Rounded cards and pills that echo the logo's social-media bubbles

## Responsive behavior

- Compact: under 640px
  - Mobile-first stacked layouts
  - Bottom tab navigation
  - Full-width cards and controls

- Medium: 640px–1023px
  - Wider gutters
  - Wrapping two-column card grids where space allows
  - Native/tablet bottom navigation remains intact

- Wide: 1024px+
  - Desktop web top navigation replaces the mobile bottom tab bar
  - Two-column editing/review surfaces
  - Multi-column dashboards and cards
  - Content remains constrained to a 1180px max width so large screens do not stretch the interface

Core responsive primitives live in:

- `src/hooks/useResponsive.ts`
- `src/components/ui.tsx`
- `src/components/brand.tsx`
- `src/theme/tokens.ts`
