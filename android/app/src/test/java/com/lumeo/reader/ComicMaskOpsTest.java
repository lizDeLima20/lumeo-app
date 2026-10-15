package com.lumeo.reader;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.BitSet;

public class ComicMaskOpsTest {
    private static final int W = 40, H = 30;

    private static BitSet rect(int x0, int y0, int x1, int y1) {
        BitSet m = new BitSet(W * H);
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) m.set(y * W + x);
        return m;
    }

    @Test
    public void letteringHolesInsideABalloonAreFilledButTheOutsideStaysEmpty() {
        BitSet balloon = rect(5, 5, 35, 25);
        BitSet holes = rect(10, 10, 14, 14); holes.or(rect(20, 12, 30, 16)); // "letters"
        balloon.andNot(holes);
        BitSet filled = ComicMaskOps.fillHoles(balloon, W, H);
        assertEquals(rect(5, 5, 35, 25), filled);
        // A notch open to the outside is not a hole.
        BitSet notched = rect(5, 5, 35, 25); notched.andNot(rect(5, 12, 12, 16));
        assertEquals(notched, ComicMaskOps.fillHoles(notched, W, H));
    }

    @Test
    public void keepsTheComponentUnderTheSeedOrTheOneMostInsideTheBox() {
        BitSet two = rect(2, 2, 10, 10); two.or(rect(20, 5, 38, 25));
        assertEquals(rect(2, 2, 10, 10), ComicMaskOps.keepComponent(two, W, H, 5, 5, null));
        // Seed in empty space: pick the component filling the balloon box.
        assertEquals(rect(20, 5, 38, 25), ComicMaskOps.keepComponent(two, W, H, 15, 15, new float[]{18, 4, 39, 26}));
        assertTrue(ComicMaskOps.keepComponent(two, W, H, 15, 15, null).isEmpty());
    }

    @Test
    public void coverageContainmentAndBounds() {
        BitSet big = rect(0, 0, 20, 20), small = rect(5, 5, 10, 10);
        assertEquals(1f, ComicMaskOps.coverage(big, W, H, new float[]{5, 5, 15, 15}), 1e-6f);
        assertEquals(.5f, ComicMaskOps.coverage(big, W, H, new float[]{10, 0, 30, 10}), 1e-6f);
        assertEquals(1f, ComicMaskOps.containment(small, big), 1e-6f);
        assertEquals(0f, ComicMaskOps.containment(small, rect(30, 20, 35, 25)), 1e-6f);
        assertArrayEquals(new int[]{5, 5, 10, 10}, ComicMaskOps.bounds(small, W));
        assertNull(ComicMaskOps.bounds(new BitSet(), W));
    }
}
