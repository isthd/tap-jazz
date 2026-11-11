import type { StyleDef } from './style';

export const bossa: StyleDef = {
  id: 'bossa',
  name: 'Bossa Nova',
  bpm: 128,
  bpmRange: [100, 150],
  key: 2, // D
  keys: [2, 7, 0, 5, 9],
  inst: { bass: 'upright', drums: 'kit', guitar: 'nylon', perc: 'kit', piano: 'piano' },
  tapInst: ['piano', 'flute'],
  headPart: 'piano',
  soloOrder: [
    { part: 'guitar', p: 1 },
    { part: 'piano', p: 1 },
  ],
  forms: [
    {
      name: 'AABA',
      order: ['A', 'A', 'B', 'A'],
      sections: {
        A: [
          '1:maj7 | 6:m7 | 2:m9 | 5:7 | 3:m7 | b3:dim7 | 2:m7 | b2:7#11',
          '1:maj9 | 4:maj7#11 | 3:m7 | 6:7b9 | 2:m7 | 5:9sus | 1:69 | b2:7#11',
          '2:m7 | 5:7 | 1:maj7 | 4:maj7#11 | 7:m7b5 | 3:7b9 | 6:m7 | 2:m7 5:7',
        ],
        B: [
          '4:maj7 | b7:9 | 1:maj7 | 6:7b9 | 2:m7 | b2:7#11 | 1:maj7 | 5:9sus',
          '4:m7 | b7:7 | b3:maj7 | b6:7#11 | 2:m7 | 5:7 | 1:maj7 | 2:m7 5:7',
        ],
      },
    },
    {
      name: 'ABAC',
      order: ['A', 'B', 'A', 'C'],
      sections: {
        A: ['1:maj7 | 1:maj7 | 7:m7b5 | 3:7b9 | 6:m7 | 6:m7 | 2:m9 | 5:7'],
        B: ['3:m7 | 6:7 | 2:m7 | 5:7 | 1:maj9 | 4:maj7#11 | 3:m7 6:7b9 | 2:m7 5:7'],
        C: ['4:maj7 | b7:9 | 3:m7 | 6:7b9 | 2:m7 | 5:9sus | 1:69 | 2:m7 5:7'],
      },
    },
  ],
  tags: ['1:maj7 | b2:7#11', '3:m7 b3:dim7 | 2:m7 b2:7#11'],
  finalChord: '1:maj9',
  swing: 'straight',
  feel: { bass: -2, drums: 0, piano: 12, guitar: 4, perc: -2, solo: 14, tap: 0 },
  pan: { drums: -0.2, bass: 0, piano: 0.3, guitar: -0.35, perc: 0.45, tap: 0.05 },
  perc: 'shaker',
};
