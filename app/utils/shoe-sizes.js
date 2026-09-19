// Shoe size tables, one row per half size: [US, UK, EU, foot length in cm].
// They follow the common sports-brand charts; brands differ by up to half a
// size, so a result is a starting point rather than gospel.

const rows = (list) => list.map(([us, uk, eu, cm]) => ({ us, uk, eu, cm }));

export const CATEGORIES = [
  {
    id: 'men',
    label: "Men's",
    sizes: rows([
      [6, 5.5, 38.5, 24],
      [6.5, 6, 39, 24.5],
      [7, 6.5, 40, 25],
      [7.5, 7, 40.5, 25.5],
      [8, 7.5, 41, 26],
      [8.5, 8, 42, 26.5],
      [9, 8.5, 42.5, 27],
      [9.5, 9, 43, 27.5],
      [10, 9.5, 44, 28],
      [10.5, 10, 44.5, 28.5],
      [11, 10.5, 45, 29],
      [11.5, 11, 45.5, 29.5],
      [12, 11.5, 46, 30],
      [12.5, 12, 47, 30.5],
      [13, 12.5, 47.5, 31],
      [14, 13.5, 48.5, 32],
      [15, 14.5, 49.5, 33],
    ]),
  },
  {
    id: 'women',
    label: "Women's",
    sizes: rows([
      [5, 2.5, 35.5, 22],
      [5.5, 3, 36, 22.5],
      [6, 3.5, 36.5, 23],
      [6.5, 4, 37.5, 23.5],
      [7, 4.5, 38, 24],
      [7.5, 5, 38.5, 24.5],
      [8, 5.5, 39, 25],
      [8.5, 6, 40, 25.5],
      [9, 6.5, 40.5, 26],
      [9.5, 7, 41, 26.5],
      [10, 7.5, 42, 27],
      [10.5, 8, 42.5, 27.5],
      [11, 8.5, 43, 28],
      [11.5, 9, 44, 28.5],
      [12, 9.5, 44.5, 29],
    ]),
  },
  {
    id: 'kids',
    label: "Kids'",
    sizes: rows([
      ['10C', 9.5, 27, 16.5],
      ['10.5C', 10, 27.5, 17],
      ['11C', 10.5, 28, 17.5],
      ['11.5C', 11, 29, 18],
      ['12C', 11.5, 30, 18.5],
      ['12.5C', 12, 30.5, 19],
      ['13C', 12.5, 31, 19.5],
      ['13.5C', 13, 31.5, 20],
      ['1Y', 13.5, 32, 20.5],
      ['1.5Y', 1, 33, 21],
      ['2Y', 1.5, 33.5, 21.5],
      ['2.5Y', 2, 34, 22],
      ['3Y', 2.5, 35, 22.5],
      ['3.5Y', 3, 35.5, 23],
      ['4Y', 3.5, 36, 23.5],
      ['4.5Y', 4, 36.5, 24],
      ['5Y', 4.5, 37.5, 24.5],
      ['5.5Y', 5, 38, 25],
      ['6Y', 5.5, 38.5, 25.5],
      ['6.5Y', 6, 39, 26],
      ['7Y', 6.5, 40, 26.5],
    ]),
  },
];

export const SYSTEMS = [
  { id: 'us', label: 'US' },
  { id: 'uk', label: 'UK' },
  { id: 'eu', label: 'EU' },
  { id: 'cm', label: 'cm' },
];

// The row whose foot length is nearest, after the wiggle room is added.
export function fitFoot(category, footCm, room = 0.5) {
  const want = footCm + room;
  let best = null;
  for (const row of category.sizes)
    if (!best || Math.abs(row.cm - want) < Math.abs(best.cm - want)) best = row;
  return best;
}
