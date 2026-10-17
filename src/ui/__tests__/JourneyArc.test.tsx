import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { JourneyArc, arcPoint } from '../JourneyArc';

const render = async (props: Partial<React.ComponentProps<typeof JourneyArc>> = {}) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<JourneyArc day={18} total={120} label="Journey day 18 of 120" dayText="Day 18 of 120" caption="Your journey, one day at a time" {...props} />);
  });
  return tree;
};
const texts = (tree: ReturnType<typeof create>): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};

describe('journey arc', () => {
  it('is announced as one element with the real journey day, not a bare percentage', async () => {
    const tree = await render();

    const arc = tree.root.findAll((n) => n.props.accessibilityLabel === 'Journey day 18 of 120' && typeof n.type === 'string')[0];
    expect(arc.props.accessible).toBe(true);
    expect(arc.props.accessibilityRole).toBe('progressbar');
    expect(arc.props.accessibilityValue).toEqual({ min: 0, max: 120, now: 18, text: 'Day 18 of 120' });
  });

  it('shows the day as visible text so the meaning does not depend on the drawing', async () => {
    const tree = await render();

    expect(texts(tree)).toEqual(expect.arrayContaining(['Day 18 of 120', 'Your journey, one day at a time']));
  });

  it('takes only the journey day: nothing about workouts or check-ins can move it', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'JourneyArc.tsx'), 'utf8');

    expect(source).not.toMatch(/workout|checkin|sets/i);
  });

  it('moves along the arc with the day, from the left end to the right end', () => {
    const start = arcPoint(0);
    const middle = arcPoint(0.5);
    const end = arcPoint(1);

    expect(start.x).toBeLessThan(middle.x);
    expect(middle.x).toBeLessThan(end.x);
    expect(middle.y).toBeLessThan(start.y); // the top of the arc is higher than its ends
    expect(Math.abs(start.y - end.y)).toBeLessThan(0.001);
  });

  it('clamps a day outside 0 to the total', async () => {
    expect(arcPoint(-1)).toEqual(arcPoint(0));
    expect(arcPoint(2)).toEqual(arcPoint(1));
    const tree = await render({ day: 130, total: 120 });
    const arc = tree.root.findAll((n) => n.props.accessibilityRole === 'progressbar' && typeof n.type === 'string')[0];
    expect(arc.props.accessibilityValue.now).toBe(120);
  });
});
