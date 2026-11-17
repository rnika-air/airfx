import { focusBlur, radialBlur } from './blur';
import { hexMosaic } from './hexMosaic';
import { polarWarp } from './polarWarp';
import { oilPaint } from './oilPaint';
import { snowfall } from './snowfall';
import { voxelCubes } from './voxelCubes';

/** Effects added in 5.3, from the shader techniques in the Tim Hosqo / ASCII Magic reference. */
export const V53 = [radialBlur, focusBlur, polarWarp, hexMosaic, voxelCubes, oilPaint, snowfall];
