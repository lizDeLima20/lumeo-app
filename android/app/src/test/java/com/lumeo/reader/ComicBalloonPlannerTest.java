package com.lumeo.reader;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Balloon prompts from the comic detector, using detections recorded on real pages. */
public class ComicBalloonPlannerTest {
    private static ComicBalloonPlanner.Detection d(int label, float score, float... box) {
        return new ComicBalloonPlanner.Detection(label, score, box[0], box[1], box[2], box[3]);
    }

    @Test
    public void eachConfidentBalloonBecomesOnePromptWithTheWholeBalloonAsItsBox() {
        List<ComicBalloonPlanner.Detection> dets = Arrays.asList(
            d(0, .95f, 100, 100, 400, 260), d(1, .93f, 130, 120, 370, 230),
            d(0, .91f, 600, 90, 900, 300), d(1, .90f, 640, 120, 860, 270),
            d(0, .20f, 1000, 1000, 1100, 1100)); // below the balloon threshold
        List<ComicBalloonPlanner.Balloon> plan = ComicBalloonPlanner.plan(dets, Collections.emptyList(), 3000);
        assertEquals(2, plan.size());
        ComicBalloonPlanner.Balloon first = plan.get(0);
        assertArrayEquals(new float[]{100, 100, 400, 260}, first.whole.box, 0f);   // the balloon, not the text
        assertArrayEquals(new float[]{250, 175}, first.whole.positives.get(0), 0f); // seed on the text block
        assertTrue(first.hasText);
        assertTrue(first.parts.isEmpty());
    }

    @Test
    public void touchingBalloonsOnChicoBentoPage12AreSplitIntoTwoPrompts() {
        // "DÁ UM CANTINHO AÍ!" + "AI! ESTA ARTRITE...": one confident box, two text blocks.
        List<ComicBalloonPlanner.Detection> dets = Arrays.asList(
            d(0, .806f, 94, 770, 957, 912), d(1, .621f, 118, 788, 920, 886), d(1, .618f, 662, 791, 919, 885),
            d(0, .34f, 98, 770, 680, 882), d(0, .264f, 95, 769, 957, 923), d(0, .255f, 637, 774, 955, 922),
            d(1, .223f, 119, 787, 637, 857), d(0, .177f, 95, 771, 953, 896));
        List<ComicBalloonPlanner.Balloon> plan = ComicBalloonPlanner.plan(dets, Collections.emptyList(), 3072);
        assertEquals(1, plan.size());
        ComicBalloonPlanner.Balloon balloon = plan.get(0);
        assertEquals(2, balloon.parts.size());
        ComicBalloonPlanner.Prompt left = balloon.parts.get(0), right = balloon.parts.get(1);
        if (left.textBox[0] > right.textBox[0]) { ComicBalloonPlanner.Prompt t = left; left = right; right = t; }
        assertArrayEquals(new float[]{98, 770, 680, 882}, left.box, 0f);   // its own lower-confidence balloon
        assertArrayEquals(new float[]{637, 774, 955, 922}, right.box, 0f);
        assertEquals(1, left.negatives.size());                            // the neighbour's text is negative
        assertArrayEquals(ComicBalloonPlanner.centre(right.textBox), left.negatives.get(0), 0f);
    }

    @Test
    public void touchingBalloonsOnMonicaPage3UsePointsWhenOnlyOneSideHasItsOwnBox() {
        // "ÔÔÔÔÔ!" + "XIIII! VOU CAIR...": low-confidence detections as recorded.
        List<ComicBalloonPlanner.Detection> dets = Arrays.asList(
            d(0, .506f, 118, 1529, 1062, 1690), d(1, .432f, 152, 1555, 1012, 1653),
            d(1, .354f, 157, 1550, 438, 1650), d(1, .316f, 498, 1569, 1004, 1650), d(0, .213f, 118, 1523, 456, 1692));
        ComicBalloonPlanner.Balloon balloon = ComicBalloonPlanner.plan(dets, Collections.emptyList(), 3072).get(0);
        assertEquals(2, balloon.parts.size());
        ComicBalloonPlanner.Prompt left = balloon.parts.get(0).textBox[0] < balloon.parts.get(1).textBox[0] ? balloon.parts.get(0) : balloon.parts.get(1);
        ComicBalloonPlanner.Prompt right = left == balloon.parts.get(0) ? balloon.parts.get(1) : balloon.parts.get(0);
        assertArrayEquals(new float[]{118, 1523, 456, 1692}, left.box, 0f);
        assertNull(right.box);                                              // points only
        // The whole-text box (both balloons' text together) is not a block of its own.
        assertArrayEquals(new float[]{157, 1550, 438, 1650}, left.textBox, 0f);
        assertArrayEquals(new float[]{498, 1569, 1004, 1650}, right.textBox, 0f);
    }

    @Test
    public void roundArtworkWithoutAnyTextIsMarkedAsNotABalloon() {
        // The cartoon sun on Chico Bento page 4: a bubble with no text block and no OCR line.
        List<ComicBalloonPlanner.Detection> dets = Collections.singletonList(d(0, .9f, 30, 40, 140, 150));
        assertFalse(ComicBalloonPlanner.plan(dets, Collections.emptyList(), 3000).get(0).hasText);
        // The same shape with an OCR line inside is a balloon (e.g. a tiny "OH!").
        List<float[]> ocr = new ArrayList<>(); ocr.add(new float[]{60, 80, 110, 110});
        ComicBalloonPlanner.Balloon withOcr = ComicBalloonPlanner.plan(dets, ocr, 3000).get(0);
        assertTrue(withOcr.hasText);
        assertFalse(withOcr.whole.detectedText);
    }

    @Test
    public void overlappingTextBoxesAreNotTreatedAsTwoBalloons() {
        List<float[]> inner = Arrays.asList(new float[]{10, 10, 200, 60}, new float[]{150, 40, 300, 90});
        assertTrue(ComicBalloonPlanner.separateBlocks(inner).isEmpty());
    }
}
