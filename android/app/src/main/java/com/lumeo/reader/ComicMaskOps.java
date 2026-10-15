package com.lumeo.reader;

import java.util.BitSet;

/** Pixel operations on a model-space mask (row-major BitSet, {@code width} pixels per row). */
final class ComicMaskOps {
    private ComicMaskOps() {}

    /**
     * Keeps the connected component under the seed. If the seed is outside the mask, keeps the
     * component with the most pixels inside {@code box}; an empty mask if none touches it.
     */
    static BitSet keepComponent(BitSet mask, int width, int height, float seedX, float seedY, float[] box) {
        int sx = clamp(Math.round(seedX), 0, width - 1), sy = clamp(Math.round(seedY), 0, height - 1);
        if (mask.get(sy * width + sx)) return flood(mask, width, height, sy * width + sx, null, null);
        if (box == null) return new BitSet(width * height);
        int x0 = clamp((int) Math.floor(box[0]), 0, width - 1), y0 = clamp((int) Math.floor(box[1]), 0, height - 1);
        int x1 = clamp((int) Math.ceil(box[2]), x0 + 1, width), y1 = clamp((int) Math.ceil(box[3]), y0 + 1, height);
        BitSet visited = new BitSet(width * height); BitSet best = new BitSet(width * height); int bestInside = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
            int index = y * width + x;
            if (!mask.get(index) || visited.get(index)) continue;
            int[] inside = new int[1];
            BitSet component = flood(mask, width, height, index, new int[]{x0, y0, x1, y1}, inside);
            visited.or(component);
            if (inside[0] > bestInside) { bestInside = inside[0]; best = component; }
        }
        return best;
    }

    /** Fills every background region enclosed by the mask: lettering, highlights and specks
     *  inside a balloon must never become transparent holes in its cutout. */
    static BitSet fillHoles(BitSet mask, int width, int height) {
        int[] b = bounds(mask, width);
        if (b == null) return (BitSet) mask.clone();
        // Background reachable from outside the mask's bounding box (one pixel of margin).
        int x0 = Math.max(0, b[0] - 1), y0 = Math.max(0, b[1] - 1), x1 = Math.min(width, b[2] + 1), y1 = Math.min(height, b[3] + 1);
        BitSet outside = new BitSet(width * height);
        int[] queue = new int[(x1 - x0) * (y1 - y0)]; int head = 0, tail = 0;
        for (int x = x0; x < x1; x++) for (int y : new int[]{y0, y1 - 1}) tail = push(mask, outside, queue, tail, y * width + x);
        for (int y = y0; y < y1; y++) for (int x : new int[]{x0, x1 - 1}) tail = push(mask, outside, queue, tail, y * width + x);
        while (head < tail) {
            int current = queue[head++], x = current % width, y = current / width;
            if (x > x0) tail = push(mask, outside, queue, tail, current - 1);
            if (x + 1 < x1) tail = push(mask, outside, queue, tail, current + 1);
            if (y > y0) tail = push(mask, outside, queue, tail, current - width);
            if (y + 1 < y1) tail = push(mask, outside, queue, tail, current + width);
        }
        BitSet filled = (BitSet) mask.clone();
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
            int index = y * width + x;
            if (!mask.get(index) && !outside.get(index)) filled.set(index);
        }
        return filled;
    }

    /** Share of the box's pixels covered by the mask. */
    static float coverage(BitSet mask, int width, int height, float[] box) {
        int x0 = clamp((int) Math.floor(box[0]), 0, width), y0 = clamp((int) Math.floor(box[1]), 0, height);
        int x1 = clamp((int) Math.ceil(box[2]), 0, width), y1 = clamp((int) Math.ceil(box[3]), 0, height);
        int total = 0, covered = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) { total++; if (mask.get(y * width + x)) covered++; }
        return covered / (float) Math.max(1, total);
    }

    /** Overlap relative to the smaller mask: 1 when one lies wholly inside the other. */
    static float containment(BitSet a, BitSet b) {
        BitSet both = (BitSet) a.clone(); both.and(b);
        return both.cardinality() / (float) Math.max(1, Math.min(a.cardinality(), b.cardinality()));
    }

    /** {x0, y0, x1, y1} (end-exclusive) of the set pixels, or null when the mask is empty. */
    static int[] bounds(BitSet mask, int width) {
        int minX = Integer.MAX_VALUE, minY = Integer.MAX_VALUE, maxX = -1, maxY = -1;
        for (int i = mask.nextSetBit(0); i >= 0; i = mask.nextSetBit(i + 1)) {
            int x = i % width, y = i / width;
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        return maxX < 0 ? null : new int[]{minX, minY, maxX + 1, maxY + 1};
    }

    private static BitSet flood(BitSet mask, int width, int height, int seed, int[] box, int[] insideCount) {
        BitSet kept = new BitSet(width * height); int[] queue = new int[Math.max(1, mask.cardinality())]; int head = 0, tail = 0;
        kept.set(seed); queue[tail++] = seed;
        while (head < tail) {
            int current = queue[head++], x = current % width, y = current / width;
            if (box != null && x >= box[0] && x < box[2] && y >= box[1] && y < box[3]) insideCount[0]++;
            if (x > 0) tail = visit(mask, kept, queue, tail, current - 1);
            if (x + 1 < width) tail = visit(mask, kept, queue, tail, current + 1);
            if (y > 0) tail = visit(mask, kept, queue, tail, current - width);
            if (y + 1 < height) tail = visit(mask, kept, queue, tail, current + width);
        }
        return kept;
    }

    private static int visit(BitSet mask, BitSet kept, int[] queue, int tail, int next) {
        if (mask.get(next) && !kept.get(next)) { kept.set(next); queue[tail++] = next; }
        return tail;
    }

    private static int push(BitSet mask, BitSet outside, int[] queue, int tail, int next) {
        if (!mask.get(next) && !outside.get(next)) { outside.set(next); queue[tail++] = next; }
        return tail;
    }

    private static int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
}
