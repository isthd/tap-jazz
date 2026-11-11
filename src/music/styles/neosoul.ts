import type { StyleDef } from './style';

export const neosoul: StyleDef = {
  id: 'neosoul',
  name: 'Neo Soul',
  bpm: 84,
  bpmRange: [70, 100],
  key: 3, // E♭
  keys: [3, 8, 10, 1, 5],
  inst: { bass: 'ebass', drums: 'kit', guitar: 'eguitar', perc: 'kit', piano: 'rhodes' },
  tapInst: ['rhodes', 'vibes'],
  headPart: 'guitar',
  soloOrder: [
    { part: 'piano', p: 1 },
    { part: 'guitar', p: 1 },
    { part: 'bass', p: 0.4 },
  ],
  forms: [
    {
      name: 'AABB',
      order: ['A', 'B'],
      sections: {
        A: [
          '4:maj9 | 3:m9 | 2:m11 | 1:maj9 | 4:maj9 | 3:m7 6:7b9 | 2:m9 | 5:9sus',
          '2:m11 | 5:13 | 1:maj9 | 6:m9 | 4:maj9 | 4:m9 | 3:m11 | b3:13',
          '1:maj9 | 1:maj9/3 | 4:maj9 | 4:m9 | 3:m9 | 6:7b9 | 2:m11 | 5:9sus',
        ],
        B: [
          'b6:maj7#11 | b7:13 | 1:maj9 | 6:m9 | 4:maj9 | 3:m9 | 2:m11 | 5:9sus',
          '6:m9 | 5:m9 1:9 | 4:maj9 | b7:13 | 3:m9 | 6:7b9 | 2:m11 | b2:7#11',
        ],
      },
    },
  ],
  tags: ['4:maj9 | 5:9sus', '2:m11 | b2:7#11'],
  finalChord: '1:maj9',
  swing: 'sixteenth',
  feel: { bass: 14, drums: 10, piano: 24, guitar: 18, perc: 22, solo: 26, tap: 8 },
  pan: { drums: -0.18, bass: 0, piano: 0.3, guitar: -0.4, perc: 0.35, tap: 0.05 },
  perc: 'clap',
};
