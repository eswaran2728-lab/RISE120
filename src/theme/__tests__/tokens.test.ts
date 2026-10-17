import { tokens } from '../tokens';

// WCAG relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const c = tokens.color;

describe('Solar Gold + Midnight palette', () => {
  it('uses the approved colours', () => {
    expect(c.bg).toBe('#101419');
    expect(c.surface).toBe('#1C232B');
    expect(c.accent).toBe('#FFC568');
    expect(c.text).toBe('#F6F5F1');
    expect(c.textSecondary).toBe('#B1BAC5');
    expect(c.onAccent).toBe('#101419');
  });

  it('keeps the spacing scale and the 48-point minimum touch target', () => {
    expect(tokens.space).toEqual([0, 4, 8, 12, 16, 24, 32, 48]);
    expect(tokens.minTap).toBe(48);
  });

  it('defines a semantic token for every state the UI spec names', () => {
    for (const name of ['surfaceRaised', 'border', 'borderStrong', 'accentSoft', 'warning', 'danger', 'success', 'focus', 'disabled'] as const) {
      expect(c[name]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('contrast (WCAG)', () => {
  const textOn = [c.bg, c.surface, c.surfaceRaised];

  it.each(textOn)('primary and secondary text read at 4.5:1 or better on %s', (background) => {
    expect(contrast(c.text, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.textSecondary, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(textOn)('gold text and the status colours read at 4.5:1 on %s', (background) => {
    for (const colour of [c.accent, c.warning, c.danger, c.success]) expect(contrast(colour, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark text on gold reads at 4.5:1', () => {
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('gold text on the selected-tab fill reads at 4.5:1', () => {
    expect(contrast(c.accent, c.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.textSecondary, c.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('control outlines reach 3:1 against the page and card surfaces', () => {
    expect(contrast(c.borderStrong, c.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.borderStrong, c.surface)).toBeGreaterThanOrEqual(3);
  });

  it('the focus colour is visible against the page', () => {
    expect(contrast(c.focus, c.bg)).toBeGreaterThanOrEqual(3);
  });
});
