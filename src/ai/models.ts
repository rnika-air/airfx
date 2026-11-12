/** Local AI models. Nothing is downloaded until the user presses a Load button. */
export type ModelKey = 'matteFast' | 'matteQuality' | 'depth' | 'depthLite' | 'depthV1' | 'sam' | 'detect' | 'scene' | 'lama' | 'asr';

export interface ModelInfo {
  key: ModelKey;
  label: string;
  task: 'background-removal' | 'depth-estimation' | 'sam' | 'object-detection' | 'zero-shot-image-classification' | 'onnx-inpaint' | 'automatic-speech-recognition';
  repo: string;
  /** dtype and download size per backend */
  webgpu: { dtype: string; mb: number };
  wasm: { dtype: string; mb: number };
  license: string;
  note: string;
  /** Tested: float weights on WebGPU return a broken result for this model, so it stays on the CPU. */
  cpuOnly?: boolean;
}

export const MODELS: Record<ModelKey, ModelInfo> = {
  sam: {
    key: 'sam', label: 'EdgeTAM (click to select)', task: 'sam', repo: 'onnx-community/EdgeTAM-ONNX',
    webgpu: { dtype: 'fp32', mb: 39 }, wasm: { dtype: 'fp32', mb: 39 }, license: 'Apache-2.0',
    note: 'Promptable segmentation. Click or box any object, then refine. Used for selection and tracking.',
  },
  matteFast: {
    key: 'matteFast', label: 'MODNet (fast, people)', task: 'background-removal', repo: 'Xenova/modnet',
    webgpu: { dtype: 'q8', mb: 6 }, wasm: { dtype: 'q8', mb: 6 }, license: 'Apache-2.0', cpuOnly: true,
    note: 'Trained on portraits. Small, and good on people and hair. Weak on objects. Runs on the CPU.',
  },
  matteQuality: {
    key: 'matteQuality', label: 'ISNet (any subject)', task: 'background-removal', repo: 'onnx-community/ISNet-ONNX',
    webgpu: { dtype: 'fp16', mb: 84 }, wasm: { dtype: 'q8', mb: 42 }, license: 'AGPL-3.0',
    note: 'People, animals and objects. Without WebGPU it uses a smaller build that is slower and leaves noise on plain backgrounds.',
  },
  depth: {
    key: 'depth', label: 'Depth Anything V2 Small', task: 'depth-estimation', repo: 'onnx-community/depth-anything-v2-small',
    webgpu: { dtype: 'fp16', mb: 47 }, wasm: { dtype: 'q8', mb: 26 }, license: 'Apache-2.0',
    note: 'Estimates relative depth from one image. Values are not metres.',
  },
  depthLite: {
    key: 'depthLite', label: 'Depth Anything V2 Small (lite)', task: 'depth-estimation', repo: 'onnx-community/depth-anything-v2-small',
    webgpu: { dtype: 'q4f16', mb: 18 }, wasm: { dtype: 'q4', mb: 26 }, license: 'Apache-2.0',
    note: 'Smaller download and lower quality.',
  },
  depthV1: {
    key: 'depthV1', label: 'Depth Anything V1 Small', task: 'depth-estimation', repo: 'Xenova/depth-anything-small-hf',
    webgpu: { dtype: 'fp16', mb: 50 }, wasm: { dtype: 'q8', mb: 27 }, license: 'Apache-2.0',
    note: 'The older model, kept as a comparison. V2 Small matched real depth better in the Depth Lab.',
  },
  detect: {
    key: 'detect', label: 'YOLOS Tiny (object detection)', task: 'object-detection', repo: 'Xenova/yolos-tiny',
    webgpu: { dtype: 'fp32', mb: 26 }, wasm: { dtype: 'q8', mb: 9 }, license: 'Apache-2.0',
    note: 'Finds people and 79 other everyday COCO object types. It only knows those types.',
  },
  scene: {
    key: 'scene', label: 'CLIP (scene type)', task: 'zero-shot-image-classification', repo: 'Xenova/clip-vit-base-patch32',
    webgpu: { dtype: 'q8', mb: 147 }, wasm: { dtype: 'q8', mb: 147 }, license: 'MIT', cpuOnly: true,
    note: 'Compares the image with scene descriptions such as portrait, architecture or night street.',
  },
  asr: {
    key: 'asr', label: 'Whisper Tiny (speech to text)', task: 'automatic-speech-recognition', repo: 'Xenova/whisper-tiny.en',
    webgpu: { dtype: 'q8', mb: 41 }, wasm: { dtype: 'q8', mb: 41 }, license: 'MIT', cpuOnly: true,
    note: 'Turns English speech into text on this computer. Used by Speech Typography. Audio never leaves the PC.',
  },
  lama: {
    key: 'lama', label: 'LaMa (AI inpainting)', task: 'onnx-inpaint', repo: 'opencv/inpainting_lama',
    webgpu: { dtype: 'fp32', mb: 88 }, wasm: { dtype: 'fp32', mb: 88 }, license: 'Apache-2.0', cpuOnly: true,
    note: 'Fills a masked region using only the surrounding image. Takes about 20 seconds on the CPU, in the background. WebGPU returned a broken fill in testing.',
  },
};
