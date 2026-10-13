import { mapFoodRow } from '../map';

describe('mapFoodRow', () => {
  it('maps a database row, converting numeric strings', () => {
    expect(
      mapFoodRow({
        id: 'f1',
        user_id: 'u1',
        name: 'Nasi lemak',
        aliases: { ms: ['nasi lemak biasa'] },
        serving_desc: '1 plate',
        calories: '644',
        protein_g: '15.5',
        carbs_g: '80',
        fat_g: '28',
        source: 'custom',
        verified: false,
        region: null,
        source_id: 'x1',
        barcode: '955',
      })
    ).toEqual({
      id: 'f1',
      userId: 'u1',
      name: 'Nasi lemak',
      aliases: { ms: ['nasi lemak biasa'] },
      servingDesc: '1 plate',
      calories: 644,
      proteinG: 15.5,
      carbsG: 80,
      fatG: 28,
      source: 'custom',
      verified: false,
      region: null,
      sourceId: 'x1',
      barcode: '955',
    });
  });

  it('treats missing aliases and ids as empty', () => {
    const food = mapFoodRow({
      id: 'f2', user_id: null, name: 'Apple', serving_desc: '1', calories: 52, protein_g: 0.3, carbs_g: 14, fat_g: 0.2,
      source: 'usda', verified: false, region: null,
    });

    expect(food).toMatchObject({ userId: null, aliases: {}, sourceId: null, barcode: null });
  });

  it('keeps only well-formed aliases', () => {
    const food = mapFoodRow({
      id: 'f3', user_id: null, name: 'X', serving_desc: '1', calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0,
      source: 'usda', verified: false, region: null,
      aliases: { en: ['ok', 5, null], ms: 'nope', ta: ['சரி'], zz: ['ignored'] },
    });

    expect(food.aliases).toEqual({ en: ['ok'], ta: ['சரி'] });
  });
});
