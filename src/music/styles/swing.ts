import type { StyleDef } from './style';

// All progressions are generic jazz patterns written for this app (no existing tunes).
export const swing: StyleDef = {
  id: 'swing',
  name: 'Swing',
  bpm: 132,
  bpmRange: [90, 220],
  key: 5, // F
  keys: [5, 10, 3, 0, 7],
  inst: { bass: 'upright', drums: 'kit', guitar: 'archtop', perc: 'kit', piano: 'piano' },
  tapInst: ['piano', 'vibes'],
  headPart: 'piano',
  soloOrder: [
    { part: 'piano', p: 1 },
    { part: 'guitar', p: 1 },
    { part: 'bass', p: 0.45 },
  ],
  forms: [
    {
      name: 'AABA',
      order: ['A', 'A', 'B', 'A'],
      sections: {
        A: [
          '1:maj7 6:7 | 2:m7 5:7 | 3:m7 6:7 | 2:m7 5:7 | 1:maj7 | 4:7 | 3:m7 6:7 | 2:m7 5:7',
          '1:6 | #1:dim7 | 2:m7 | 5:7 | 1:maj7 1:7 | 4:maj7 b7:7 | 3:m7 b3:7 | 2:m7 5:7',
          '2:m7 | 5:7 | 1:maj7 | 6:7b9 | 2:m7 | 5:7 | 3:m7 6:7 | 2:m7 5:7',
          '1:maj7 | 7:m7b5 3:7 | 6:m7 | 5:m7 1:7 | 4:maj7 | 4:m7 b7:7 | 1:maj7 6:7 | 2:m7 5:7',
        ],
        B: [
          '3:7 | 3:7 | 6:7 | 6:7 | 2:7 | 2:7 | 5:7 | 5:7',
          '5:m7 | 1:7 | 4:maj7 | 4:maj7 | 4:m7 | b7:7 | 3:m7 6:7 | 2:m7 5:7',
          'b3:maj7 | b6:7 | b2:maj7 | 2:m7 5:7 | 3:m7 | 6:7 | 2:m7 | 5:7',
        ],
      },
    },
    {
      name: 'Blues',
      order: ['L'],
      sections: {
        L: [
          '1:7 | 4:7 | 1:7 | 5:m7 1:7 | 4:7 | #4:dim7 | 1:7 | 3:m7 6:7 | 2:m7 | 5:7 | 1:7 6:7 | 2:m7 5:7',
          '1:7 | 4:7 | 1:7 | 1:7 | 4:7 | 4:7 | 1:7 | 6:7b9 | 2:m7 | 5:7 | 3:m7 b3:7 | 2:m7 b2:7',
        ],
      },
    },
  ],
  tags: ['3:m7 6:7 | 2:m7 5:7', '1:maj7 b3:7 | b6:7 b2:7', '1:6 6:7 | 2:m7 b2:7'],
  finalChord: '1:69',
  swing: 'tempo',
  feel: { bass: -7, drums: -3, piano: 16, guitar: 8, perc: 0, solo: 20, tap: 0 },
  pan: { drums: -0.22, bass: 0, piano: 0.32, guitar: -0.42, perc: 0.48, tap: 0.05 },
  perc: 'snap',
};
