package com.lumeo.reader;

/**
 * Coordinate chain of one MobileSAM page, independent of how the bitmap was decoded.
 *
 * <pre>
 *   OCR prompt space (the WebView canvas the boxes were measured on, W x H)
 *     -> model input (the page resized so its longest edge is MODEL_SIDE)
 *     -> mask (same space as the model input; the WebView maps it back with W / modelWidth)
 * </pre>
 *
 * The bitmap handed to the encoder may be decoded with {@code inSampleSize} (1/2, 1/4 of the
 * page) to bound native memory. That is an implementation detail of decoding: the model
 * input size is derived from the page itself, and prompts are scaled from their own space
 * to the model input, so a sampled decode can never move or shrink a prompt.
 */
final class ComicModelGeometry {
    final int modelWidth;
    final int modelHeight;
    /** Prompt space to model input, per axis. */
    final float scaleX;
    final float scaleY;

    private ComicModelGeometry(int modelWidth, int modelHeight, float scaleX, float scaleY) {
        this.modelWidth = modelWidth; this.modelHeight = modelHeight; this.scaleX = scaleX; this.scaleY = scaleY;
    }

    /**
     * @param pageWidth  width of the encoded page image, before any sampled decode
     * @param pageHeight height of the encoded page image, before any sampled decode
     * @param promptWidth  width of the space the OCR boxes are expressed in (0 = page)
     * @param promptHeight height of that space (0 = page)
     */
    static ComicModelGeometry of(int pageWidth, int pageHeight, int promptWidth, int promptHeight, int modelSide) {
        if (pageWidth <= 0 || pageHeight <= 0) throw new IllegalArgumentException("invalid page size " + pageWidth + "x" + pageHeight);
        if (modelSide <= 0) throw new IllegalArgumentException("invalid model side " + modelSide);
        final float resize = modelSide / (float) Math.max(pageWidth, pageHeight);
        final int width = Math.max(1, Math.round(pageWidth * resize));
        final int height = Math.max(1, Math.round(pageHeight * resize));
        final int spaceWidth = promptWidth > 0 ? promptWidth : pageWidth;
        final int spaceHeight = promptHeight > 0 ? promptHeight : pageHeight;
        return new ComicModelGeometry(width, height, width / (float) spaceWidth, height / (float) spaceHeight);
    }

    /** Largest power-of-two sample that still leaves at least {@code modelSide} pixels on the
     *  longest edge, so the resize to the model input only ever shrinks. */
    static int sampleSize(int pageWidth, int pageHeight, int modelSide) {
        int sample = 1;
        final int longest = Math.max(pageWidth, pageHeight);
        while (longest / (sample * 2) >= modelSide) sample *= 2;
        return sample;
    }

    /**
     * Maps an OCR box {x0, y0, x1, y1} from prompt space into the model input, clipped to
     * it. Returns {@code null} when the box does not overlap the page at all: such a box is
     * invalid geometry and must not be collapsed onto a one-pixel edge prompt.
     */
    float[] toModel(double x0, double y0, double x1, double y1) {
        if (!(Double.isFinite(x0) && Double.isFinite(y0) && Double.isFinite(x1) && Double.isFinite(y1))) return null;
        float left = (float) Math.min(x0, x1) * scaleX, right = (float) Math.max(x0, x1) * scaleX;
        float top = (float) Math.min(y0, y1) * scaleY, bottom = (float) Math.max(y0, y1) * scaleY;
        if (right <= 0 || bottom <= 0 || left >= modelWidth || top >= modelHeight) return null;
        left = clamp(left, 0, modelWidth - 1);
        top = clamp(top, 0, modelHeight - 1);
        right = clamp(right, left + 1, modelWidth);
        bottom = clamp(bottom, top + 1, modelHeight);
        return new float[]{left, top, right, bottom};
    }

    private static float clamp(float value, float min, float max) { return Math.max(min, Math.min(max, value)); }
}
