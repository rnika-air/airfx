import type { EffectDefinition } from '../types';
import { audioShapes } from './audioShapes';
import { crayon } from './crayon';
import { modulation } from './modulation';
import { nightVision } from './nightVision';
import { particleSim } from './particleSim';
import { reveal } from './reveal';
import { speechType } from './speechType';
import { thermal } from './thermal';

export const V43: EffectDefinition[] = [nightVision, thermal, reveal, particleSim, speechType, audioShapes, modulation, crayon];
