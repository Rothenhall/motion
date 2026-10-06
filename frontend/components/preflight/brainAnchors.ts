/**
 * Where to hang each system's label on the cortex, in standard brain coordinates (mm, RAS), matching the mesh.
 * Each point is snapped to the nearest real surface vertex when the brain loads. They are general locations for
 * labelling, not exact parcel boundaries: the colours are the model's output, the labels only say what lives roughly where.
 * Systems that exist in both hemispheres list both; the label shows on whichever side faces the camera.
 */
export const ANCHORS: Record<string, [number, number, number][]> = {
  visual_motion: [[-46, -68, 4], [46, -68, 4]],
  auditory: [[-54, -22, 8], [54, -22, 8]],
  language: [[-50, 16, 12]],
  social: [[-52, -56, 24], [52, -56, 24]],
  text_reading: [[-44, -58, -16]],
  faces: [[-40, -52, -20], [40, -52, -20]],
  scenes: [[-26, -44, -10], [26, -44, -10]],
};

export type BrainRegion = { key: string; label: string; state: 'up' | 'down' | 'flat' };
