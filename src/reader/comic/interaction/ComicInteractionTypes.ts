export type ComicRegionType = "speech" | "thought" | "caption" | "free-text" | "other";
export type ComicRegionShape = "balloon" | "rectangle" | "cloud" | "jagged" | "freeform" | "unknown";
export type ComicTailDirection = "none" | "up" | "right" | "down" | "left" | "up-left" | "up-right" | "down-right" | "down-left";

export interface NormalizedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A region carries three rectangles, all normalized to the page.
 *
 *  `textBounds` is where the letters are, `visualBounds` is the whole balloon or box that
 *  holds them - the yellow caption is 80x35 even when its words only fill 45x15 - and
 *  `hitBounds` is what a finger may touch. The balloon is enlarged from `visualBounds`, so
 *  its colour, border, tail and any little drawing inside come along with it.
 *
 *  The inherited x/y/width/height stay equal to `hitBounds`: a .lima written before these
 *  fields existed still opens, and [[comicRegionBounds]] fills the gaps. */
/** What the lettering of a region looks like, measured from the marks themselves.
 *
 *  Comics are lettered by hand, so no typeface is named: what is kept is what it takes to
 *  set the same words again at the right size, weight and alignment. */
export interface ComicTypography {
  family: "comic" | "sans" | "serif" | "handwritten";
  weight: "normal" | "bold";
  italic: boolean;
  align: "left" | "center" | "right";
  /** Height of a capital letter, as a share of the page height. */
  capHeight: number;
  lines: number;
}

/** A point of a container's outline, normalized to the page. */
export interface ComicContourPoint { x: number; y: number }

/** One connected original container with several lettering lobes, not nearby boxes. */
export interface ComicBubbleGroup {
  id: string;
  members: { id: string; bounds: NormalizedBounds }[];
  unionBounds: NormalizedBounds;
  unionMaskPath?: string;
}
export interface ComicTextRegion extends NormalizedBounds {
  id: string;
  pageIndex: number;
  bubbleGroup?: ComicBubbleGroup;
  text: string;
  shape: ComicRegionShape;
  tailDirection: ComicTailDirection;
  type: ComicRegionType;
  ocrConfidence?: number;
  recognitionStatus?: "recognized" | "needs-review";
  reviewReasons?: string[];
  /** Where this region falls in the likely reading order of its page, starting at 1.
   *  Computed from the layout when the comic is converted, and kept as written: a value
   *  corrected by hand is never recomputed over. */
  readingOrder?: number;
  textBounds?: NormalizedBounds;
  visualBounds?: NormalizedBounds;
  hitBounds?: NormalizedBounds;
  /** Sampled from the artwork: the container's own colours, for the rare fallback where
   *  the page image is not available and for contrast decisions. */
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  /** The container's own outline, normalized to the page: what makes it possible to draw
   *  this balloon again on its own, with nothing of the drawing around it. */
  contour?: ComicContourPoint[];
  tail?: ComicTailDirection;
  typography?: ComicTypography;
  /** How sure the shape and colours are, from 0 to 1. Low means the reader should fall
   *  back to a plain container rather than invent a shape. */
  styleConfidence?: number;
  /** Original pixels, never re-lettered. Paths are local entries inside the .lima. */
  assetPath?: string;
  maskPath?: string;
  assetWidth?: number;
  assetHeight?: number;
  segmentationConfidence?: number;
  segmentationNeedsReview?: boolean;
  segmentationMethod?: "component-mask" | "mobilesam-v1" | "original-crop-fallback";
  needsReview?: boolean;
  /** Relationship derived from the page visual hierarchy. It never changes the existing
   * hit area: the contour remains the only source of touch geometry. */
  hierarchy?: ComicRegionHierarchy;
}

export interface ComicScene extends NormalizedBounds {
  id: string;
  /** `panel` is a structural panel found from gutters; `freeform` is the safe whole-page
   * scene used when artwork has no reliable borders. */
  kind: "panel" | "freeform";
  confidence: number;
  zIndex: number;
}

export interface ComicSceneMembership {
  sceneId: string;
  /** Share of the balloon's mask that is inside this scene. The mask is never clipped. */
  maskShare: number;
}

export interface ComicTailSceneCandidate {
  sceneId: string;
  direction: ComicTailDirection;
  confidence: number;
  /** No character model is bundled in v1, so this is a spatial candidate only. */
  characterConfirmed: false;
}

export interface ComicRegionHierarchy {
  sceneId: string;
  memberships: ComicSceneMembership[];
  zIndex: number;
  /** Other scenes crossed by the balloon. This records visible overflow rather than
   * cutting the mask at a panel boundary. */
  overlapsSceneIds: string[];
  tailSceneCandidate?: ComicTailSceneCandidate;
}

/** A page-level observation.  Unlike `regions`, an element may deliberately be
 * non-interactive (for example an onomatopoeia).  It therefore lets the BODY tree retain
 * visual context without ever turning a character, panel or sound effect into a button. */
export type ComicVisualElementKind = "balloon" | "narration" | "effect" | "unclassified";
export interface ComicVisualElement extends NormalizedBounds {
  id: string;
  kind: ComicVisualElementKind;
  confidence: number;
  interactive: boolean;
  zIndex: number;
  sceneId?: string;
  memberships: ComicSceneMembership[];
  overflowSceneIds: string[];
  /** Region owning this element when it is a validated interactive balloon. */
  regionId?: string;
  reason?: "sound-effect" | "no-reliable-boundary";
}

/** Page-local tree. Regions are referenced by id because their full masks and assets stay
 * in `regions`, avoiding duplicated large data in the hierarchy record. */
export interface ComicPageHierarchy {
  version: "visual-hierarchy-v1" | "visual-hierarchy-v2";
  rootId: string;
  scenes: ComicScene[];
  sceneChildren: Record<string, string[]>;
  /** Observations belonging to the BODY. Characters are intentionally absent unless a
   * dedicated, licensed local instance model has actually detected them. */
  elements?: ComicVisualElement[];
  /** Reserved for a future licensed character-instance model. Never fabricated. */
  characters: [];
}

export interface ComicPage {
  index: number;
  id: string;
  imagePath: string;
  width?: number;
  height?: number;
  mimeType: "image/webp" | "image/png" | "image/jpeg";
  cover: boolean;
  regions: ComicTextRegion[];
  hierarchy?: ComicPageHierarchy;
}

export interface ComicMetadata {
  id: string;
  title: string;
  author?: string;
  language?: string;
  sourceFileName?: string;
  sourceFormat?: "pdf" | "cbr" | "cbz" | "image-sequence" | "lima" | "unknown";
  createdAt: string;
  conversionKey?: string;
}

export interface ComicLimaManifestPage {
  index: number;
  id: string;
  imagePath: string;
  interactionPath?: string;
  width?: number;
  height?: number;
  mimeType: ComicPage["mimeType"];
  cover?: boolean;
}

/** 1: text-shaped regions only. 2: the three rectangles above plus sampled colours.
 *  Readers accept both; the converter always writes the current version. */
export type ComicLimaVersion = 1 | 2 | 3 | 4 | 5;
export const COMIC_LIMA_VERSION: ComicLimaVersion = 5;

export interface ComicLimaManifest {
  format: "lima";
  version: ComicLimaVersion;
  contentType: "comic";
  documentId: string;
  createdAt: string;
  generator: string;
  metadataPath: "metadata/metadata.json";
  pagesPath: "pages/";
  interactionPath: "interaction/";
  pages: ComicLimaManifestPage[];
}

export interface ComicDocument {
  manifest: ComicLimaManifest;
  metadata: ComicMetadata;
  pages: ComicPage[];
}

export interface ComicPageAsset {
  path: string;
  data: Uint8Array;
  mimeType: ComicPage["mimeType"];
  width?: number;
  height?: number;
  cover?: boolean;
  interactionAssets?: ComicPageAsset[];
}

export type ComicConversionStage = "PREPARING" | "PROCESSING_PAGE" | "SAVING" | "COMPLETED" | "FAILED";

export interface ComicConversionProgress {
  stage: ComicConversionStage;
  currentPage: number;
  totalPages: number;
  progress: number;
  message?: string;
}

export interface ComicBubbleModel {
  text: string;
  shape: ComicRegionShape;
  tailDirection: ComicTailDirection;
  sourceBounds: NormalizedBounds;
  targetBounds: NormalizedBounds;
  type: ComicRegionType;
}
