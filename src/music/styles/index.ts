import type { StyleId } from '../types';
import type { StyleDef } from './style';
import { swing } from './swing';
import { bossa } from './bossa';
import { neosoul } from './neosoul';

export const STYLES: Record<StyleId, StyleDef> = { swing, bossa, neosoul };
export const STYLE_ORDER: StyleId[] = ['swing', 'bossa', 'neosoul'];
export const nextStyle = (s: StyleId): StyleId => STYLE_ORDER[(STYLE_ORDER.indexOf(s) + 1) % STYLE_ORDER.length];
export type { StyleDef };
