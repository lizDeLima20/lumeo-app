package com.lumeo.reader;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Regression for the BODY v4 defect found on the Infinix: the page was decoded with
 * inSampleSize = 2 and the prompt scale was taken from that half-size bitmap, so every OCR
 * box reached MobileSAM at twice its real position and boxes in the lower half collapsed
 * into 1-pixel prompts on the edge ([663,1023,664,1024] in the device diagnostics).
 */
public class ComicModelGeometryTest {
    private static final int SIDE = 1024;

    /** Relative position of a box must survive the mapping on both axes. */
    private static void assertProportional(ComicModelGeometry g, int pageW, int pageH, double[] box) {
        float[] m = g.toModel(box[0], box[1], box[2], box[3]);
        assertNotNull(m);
        assertEquals(box[0] / pageW * g.modelWidth, m[0], 1.0);
        assertEquals(box[1] / pageH * g.modelHeight, m[1], 1.0);
        assertEquals(box[2] / pageW * g.modelWidth, m[2], 1.0);
        assertEquals(box[3] / pageH * g.modelHeight, m[3], 1.0);
    }

    @Test
    public void infinixPageDecodedAtHalfSizeKeepsItsPrompts() {
        // Chico Bento page 8 as rendered on the device: 2032 x 3072, decoded with sample 2.
        assertEquals(2, ComicModelGeometry.sampleSize(2032, 3072, SIDE));
        ComicModelGeometry g = ComicModelGeometry.of(2032, 3072, 2032, 3072, SIDE);
        assertEquals(677, g.modelWidth);
        assertEquals(1024, g.modelHeight);
        assertEquals(1024f / 3072f, g.scaleY, 1e-4f);  // one third, not the buggy two thirds
        // "ISTO AQUI É DENTE DI VREDADE!" sits near the bottom left of the page.
        double[] balloon = {455, 2730, 615, 2850};
        float[] m = g.toModel(balloon[0], balloon[1], balloon[2], balloon[3]);
        assertTrue("bottom balloon must not be clamped to the edge", m[3] < 1000 && m[3] - m[1] > 30);
        assertProportional(g, 2032, 3072, balloon);
    }

    @Test
    public void theOldScaleReproducesTheCollapsedEdgePrompt() {
        // What v4 did: scale from the 1016 x 1536 decoded bitmap, applied to page coordinates.
        float buggy = SIDE / (float) Math.max(2032 / 2, 3072 / 2);
        assertEquals(2f / 3f, buggy, 1e-4f);
        assertTrue("the old mapping pushes the balloon past the 1024 edge", 2730 * buggy > SIDE);
        // The fixed mapping keeps the same box well inside.
        float[] m = ComicModelGeometry.of(2032, 3072, 0, 0, SIDE).toModel(455, 2730, 615, 2850);
        assertTrue(m[1] < 1000 && m[0] < 677);
    }

    @Test
    public void mappingDoesNotDependOnTheSampledDecode() {
        int[][] pages = {{800, 1200}, {2032, 3072}, {2033, 3071}, {4096, 6144}, {6000, 9000}, {3000, 2000}, {1024, 1024}, {640, 480}};
        for (int[] page : pages) {
            int w = page[0], h = page[1];
            ComicModelGeometry g = ComicModelGeometry.of(w, h, w, h, SIDE);
            assertEquals("longest model edge for " + w + "x" + h, SIDE, Math.max(g.modelWidth, g.modelHeight));
            int sample = ComicModelGeometry.sampleSize(w, h, SIDE);
            assertTrue("sampled decode still feeds at least the model size", Math.max(w, h) / sample >= SIDE || sample == 1);
            // Centre, corners and an off-centre box keep their relative position on both axes.
            assertProportional(g, w, h, new double[]{w * .45, h * .45, w * .55, h * .55});
            assertProportional(g, w, h, new double[]{0, 0, w * .1, h * .1});
            assertProportional(g, w, h, new double[]{w * .9, h * .9, w, h});
            assertProportional(g, w, h, new double[]{w * .12, h * .83, w * .31, h * .91});
        }
    }

    @Test
    public void promptsAreMappedFromTheirOwnCanvasNotTheEncodedImage() {
        // OCR measured on a 2032 x 3072 canvas; the bytes sent happen to be 1016 x 1536.
        ComicModelGeometry g = ComicModelGeometry.of(1016, 1536, 2032, 3072, SIDE);
        assertEquals(677, g.modelWidth);
        assertEquals(1024, g.modelHeight);
        assertProportional(g, 2032, 3072, new double[]{455, 2730, 615, 2850});
        // Without a declared prompt space, boxes are taken as encoded-image pixels.
        ComicModelGeometry own = ComicModelGeometry.of(1016, 1536, 0, 0, SIDE);
        assertProportional(own, 1016, 1536, new double[]{227, 1365, 307, 1425});
    }

    @Test
    public void boxesAreClippedToThePageButNeverInventedOnItsEdge() {
        ComicModelGeometry g = ComicModelGeometry.of(2032, 3072, 0, 0, SIDE);
        // Partly outside: clipped to the page.
        float[] clipped = g.toModel(1900, 3000, 2200, 3300);
        assertNotNull(clipped);
        assertEquals(677f, clipped[2], 1e-3f);
        assertEquals(1024f, clipped[3], 1e-3f);
        assertTrue(clipped[2] - clipped[0] > 30);
        // Wholly outside, or not a number: rejected instead of collapsing to a 1-pixel prompt.
        assertNull(g.toModel(2100, 100, 2300, 200));
        assertNull(g.toModel(100, 3100, 200, 3200));
        assertNull(g.toModel(-300, -300, -10, -10));
        assertNull(g.toModel(Double.NaN, 0, 10, 10));
        // Corner order does not matter.
        assertArrayEquals(g.toModel(100, 200, 300, 400), g.toModel(300, 400, 100, 200), 1e-4f);
    }

    @Test(expected = IllegalArgumentException.class)
    public void anEmptyPageIsRejected() { ComicModelGeometry.of(0, 3072, 0, 0, SIDE); }
}
