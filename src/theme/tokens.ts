// Solar Gold + Midnight. Screens take every colour from here (never a literal), so the theme can change in one
// place. Contrast of each pair is checked in src/theme/__tests__/tokens.test.ts.
export const tokens = {
  color: {
    // Surfaces
    bg: '#101419', // page background
    surface: '#1C232B', // cards, tab bar
    surfaceRaised: '#28313A', // inputs and chips on a card
    // Lines
    border: '#46505B', // decorative dividers and card edges
    borderStrong: '#6F7B88', // outlines of controls (3:1 against the page and cards)
    // Text
    text: '#F6F5F1', // primary
    textSecondary: '#B1BAC5', // supporting text
    // Gold: the main action and journey progress, not every status
    accent: '#FFC568',
    onAccent: '#101419', // dark text on gold
    accentSoft: '#3A3021', // selected-tab fill
    focus: '#FFC568',
    // States (always paired with words or icons, never colour alone)
    warning: '#FFD18A',
    danger: '#FF8A80',
    success: '#7FDBA0',
    disabled: '#6B7580',
  },
  space: [0, 4, 8, 12, 16, 24, 32, 48],
  minTap: 48,
  radius: { card: 16, control: 12 },
} as const;
