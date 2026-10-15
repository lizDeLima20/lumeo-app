package com.lumeo.reader;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Turns the comic detector's boxes into MobileSAM prompts, one per speech balloon.
 *
 * The detector (RT-DETR v2, classes bubble / text_bubble / text_free) finds balloons by their
 * shape, whatever their colour, including ones whose text OCR cannot read. Each balloon is then
 * segmented by MobileSAM with the whole balloon as its box, so the mask is the balloon and not
 * the block of text. Two balloons that touch can come back as one detection: when it holds two
 * or more separate blocks of text, each block gets its own prompt (its point positive, the
 * others negative, and its own lower-confidence balloon box when the detector proposed one).
 * The caller accepts that split only if the masks it yields are separate and each holds its
 * whole text; otherwise the single prompt is used.
 *
 * All coordinates are in one space (the OCR/prompt space); nothing here depends on Android.
 */
final class ComicBalloonPlanner {
    static final int BUBBLE = 0, TEXT_BUBBLE = 1, TEXT_FREE = 2;
    /** A balloon has to be at least this sure to become a target. */
    static final float BUBBLE_MIN_SCORE = 0.35f;
    /** Text blocks used to place prompts inside a balloon. */
    static final float TEXT_MIN_SCORE = 0.20f;
    /** Lower-confidence balloon boxes are only used as the box of one part of a split. */
    static final float CANDIDATE_MIN_SCORE = 0.15f;
    private static final float CONTAIN_PAD = 8f, GAP = 4f, OWN_PAD = 12f;

    static final class Detection {
        final int label; final float score; final float[] box;
        Detection(int label, float score, float x0, float y0, float x1, float y1) {
            this.label = label; this.score = score;
            this.box = new float[]{Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)};
        }
    }

    /** One MobileSAM request. {@code box} may be null (points only). */
    static final class Prompt {
        final float[] box; final List<float[]> positives; final List<float[]> negatives; final float[] textBox;
        /** False when no text block was detected and {@code textBox} is just the balloon box. */
        final boolean detectedText;
        Prompt(float[] box, List<float[]> positives, List<float[]> negatives, float[] textBox, boolean detectedText) {
            this.box = box; this.positives = positives; this.negatives = negatives; this.textBox = textBox; this.detectedText = detectedText;
        }
    }

    static final class Balloon {
        final float detScore; final float[] box; final boolean hasText;
        /** The whole-balloon prompt; always present. */
        final Prompt whole;
        /** One prompt per text block when the detection looks like touching balloons; else empty. */
        final List<Prompt> parts;
        Balloon(float detScore, float[] box, boolean hasText, Prompt whole, List<Prompt> parts) {
            this.detScore = detScore; this.box = box; this.hasText = hasText; this.whole = whole; this.parts = parts;
        }
    }

    private ComicBalloonPlanner() {}

    /**
     * @param detections every detector output at or above {@link #CANDIDATE_MIN_SCORE}
     * @param ocrBoxes   text boxes found by OCR, in the same space; used only to tell a balloon
     *                   with lettering from a round piece of artwork when the detector saw no text
     */
    static List<Balloon> plan(List<Detection> detections, List<float[]> ocrBoxes, float pageHeight) {
        List<Detection> bubbles = new ArrayList<>(), candidates = new ArrayList<>(), texts = new ArrayList<>();
        for (Detection d : detections) {
            if (d.label == BUBBLE && d.score >= CANDIDATE_MIN_SCORE) candidates.add(d);
            if (d.label == BUBBLE && d.score >= BUBBLE_MIN_SCORE) bubbles.add(d);
            if (d.label == TEXT_BUBBLE && d.score >= TEXT_MIN_SCORE) texts.add(d);
        }
        // Reading-ish order: bands of 8% of the page, then left to right. The final reading
        // order is decided later by the page's own reading-order pass.
        final float band = Math.max(1f, pageHeight * 0.08f);
        Collections.sort(bubbles, (a, b) -> {
            int rows = Integer.compare(Math.round(a.box[1] / band), Math.round(b.box[1] / band));
            return rows != 0 ? rows : Float.compare(a.box[0], b.box[0]);
        });
        List<Balloon> out = new ArrayList<>();
        for (Detection bubble : bubbles) {
            List<float[]> inner = new ArrayList<>();
            for (Detection t : texts) if (inside(t.box, bubble.box, CONTAIN_PAD)) inner.add(t.box);
            boolean ocrInside = false;
            for (float[] o : ocrBoxes) { float[] c = centre(o); if (pointIn(c, bubble.box)) { ocrInside = true; break; } }
            float[] textBox = inner.isEmpty() ? bubble.box : largest(inner);
            Prompt whole = new Prompt(bubble.box, list(centre(textBox)), new ArrayList<>(), textBox, !inner.isEmpty());
            List<float[]> blocks = separateBlocks(inner);
            List<Prompt> parts = new ArrayList<>();
            if (blocks.size() >= 2) {
                for (float[] block : blocks) {
                    List<float[]> negatives = new ArrayList<>();
                    for (float[] other : blocks) if (other != block) negatives.add(centre(other));
                    float[] own = null;
                    for (Detection c : candidates) {
                        if (!inside(block, c.box, CONTAIN_PAD) || !inside(c.box, bubble.box, OWN_PAD)) continue;
                        boolean holdsOther = false;
                        for (float[] other : blocks) if (other != block && inside(other, c.box, CONTAIN_PAD)) { holdsOther = true; break; }
                        if (!holdsOther && (own == null || area(c.box) < area(own))) own = c.box;
                    }
                    parts.add(new Prompt(own, list(centre(block)), negatives, block, true));
                }
            }
            out.add(new Balloon(bubble.score, bubble.box, !inner.isEmpty() || ocrInside, whole, parts));
        }
        return out;
    }

    /** Smallest text boxes that are pairwise separate: a box holding another one (the text of
     *  both balloons together) is not a block of its own. */
    static List<float[]> separateBlocks(List<float[]> inner) {
        List<float[]> minimal = new ArrayList<>();
        for (float[] t : inner) {
            boolean holdsAnother = false;
            for (float[] o : inner) if (o != t && !same(o, t) && inside(o, t, 0)) { holdsAnother = true; break; }
            if (!holdsAnother) minimal.add(t);
        }
        List<float[]> blocks = new ArrayList<>();
        for (float[] t : minimal) {
            boolean separate = true;
            for (float[] o : minimal) if (o != t && !disjoint(t, o)) { separate = false; break; }
            if (separate) blocks.add(t);
        }
        return blocks;
    }

    static boolean inside(float[] a, float[] b, float pad) {
        return a[0] >= b[0] - pad && a[1] >= b[1] - pad && a[2] <= b[2] + pad && a[3] <= b[3] + pad;
    }
    static boolean disjoint(float[] a, float[] b) {
        return a[2] + GAP <= b[0] || b[2] + GAP <= a[0] || a[3] + GAP <= b[1] || b[3] + GAP <= a[1];
    }
    static float[] centre(float[] b) { return new float[]{(b[0] + b[2]) / 2f, (b[1] + b[3]) / 2f}; }
    private static boolean pointIn(float[] p, float[] b) { return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
    private static float area(float[] b) { return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]); }
    private static boolean same(float[] a, float[] b) { return a[0] == b[0] && a[1] == b[1] && a[2] == b[2] && a[3] == b[3]; }
    private static float[] largest(List<float[]> boxes) { float[] best = boxes.get(0); for (float[] b : boxes) if (area(b) > area(best)) best = b; return best; }
    private static List<float[]> list(float[] point) { List<float[]> value = new ArrayList<>(); value.add(point); return value; }
}
