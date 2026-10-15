package com.lumeo.reader;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.Debug;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

/** Prompted instance segmentation for comic balloons using MobileSAM.
 *
 * The WebView supplies page bytes and boxes produced by its bundled, offline OCR.
 * Only model masks cross the Capacitor bridge; no page data or embeddings leave the
 * application process. One single-thread worker and one pair of sessions bound peak RAM.
 */
@CapacitorPlugin(name = "ComicSegmentation")
public final class ComicSegmentationPlugin extends Plugin {
    private static final String TAG = "LumeoComicML";
    private static final int MODEL_SIDE = 1024;
    private static final float MIN_SCORE = 0.78f;
    private static final float MAX_PAGE_SHARE = 0.18f;
    private static final float MIN_PROMPT_COVERAGE = 0.72f;
    // Fragmented SAM responses form thin crescents/islands around lettering. A complete
    // speech balloon is compact even with a tail; reject fragments instead of exporting
    // a visually broken cutout as an interaction target.
    private static final float MIN_MASK_SOLIDITY = 0.68f;
    private static final String MODEL_VERSION = "mobilesam-tinyvit-onnx-v1";
    /** Diagnostic images are evidence, not another full-resolution page cache. */
    private static final int DIAGNOSTIC_LONGEST_SIDE = 512;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object sessionLock = new Object();
    private OrtEnvironment environment;
    private OrtSession encoder;
    private OrtSession decoder;

    @PluginMethod
    public void segment(PluginCall call) {
        final String encoded = call.getString("imageBase64");
        final JSArray prompts = call.getArray("prompts");
        if (encoded == null || encoded.isEmpty() || prompts == null || prompts.length() == 0) {
            call.reject("Página ou regiões de texto ausentes.", "COMIC_ML_INVALID_REQUEST");
            return;
        }
        final int pageIndex = call.getInt("pageIndex", -1);
        // Size of the canvas the OCR boxes were measured on. Prompts are mapped from this
        // space, never from whatever size the page happens to be decoded at.
        final int promptWidth = call.getInt("sourceWidth", 0), promptHeight = call.getInt("sourceHeight", 0);
        executor.execute(() -> run(call, encoded, prompts, pageIndex, promptWidth, promptHeight));
    }

    private void run(PluginCall call, String encoded, JSArray prompts, int pageIndex, int promptWidth, int promptHeight) {
        final long totalStarted = System.nanoTime();
        Bitmap source = null;
        Bitmap resized = null;
        try {
            ensureSessions();
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            // Decoding a 4–8k PDF raster before shrinking it made a transient second
            // full-page native bitmap for every page. The model never sees more than
            // MODEL_SIDE pixels on an edge, so sample during decode instead.
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("invalid_bitmap");
            // The model input is derived from the page's real size; the sampled decode below
            // only feeds pixels into it and must not influence any coordinate.
            final ComicModelGeometry geometry = ComicModelGeometry.of(bounds.outWidth, bounds.outHeight, promptWidth, promptHeight, MODEL_SIDE);
            source = decodeForModel(bytes, ComicModelGeometry.sampleSize(bounds.outWidth, bounds.outHeight, MODEL_SIDE));
            bytes = null;
            if (source == null) throw new IOException("invalid_bitmap");
            final int width = geometry.modelWidth;
            final int height = geometry.modelHeight;
            resized = Bitmap.createScaledBitmap(source, width, height, true);
            if (resized != source) { source.recycle(); source = null; }

            final float[] rgb = bitmapRgb(resized);
            final long encoderStarted = System.nanoTime();
            List<Candidate> candidates = new ArrayList<>();
            try (OnnxTensor image = OnnxTensor.createTensor(environment, FloatBuffer.wrap(rgb), new long[]{height, width, 3});
                 OrtSession.Result encodedPage = encoder.run(Collections.singletonMap("input_image", image))) {
                final long encoderMs = elapsedMs(encoderStarted);
                final OnnxTensor embedding = (OnnxTensor) encodedPage.get(0);
                for (int index = 0; index < prompts.length(); index++) {
                    JSONObject prompt = prompts.getJSONObject(index);
                    // First use the OCR box plus a positive seed in its centre. If SAM's
                    // first instance is unsafe, retry with four negative context points.
                    // This is a distinct local prompt, not a threshold relaxation.
                    Candidate candidate = decodePrompt(embedding, prompt, index, geometry, 0, resized, pageIndex);
                    if (candidate == null) candidate = decodePrompt(embedding, prompt, index, geometry, 1, resized, pageIndex);
                    // Fragmented small balloons frequently need more than one interior
                    // seed. This remains a decoder-only retry (the page embedding is
                    // reused), with both positive lettering points and local negatives.
                    if (candidate == null) candidate = decodePrompt(embedding, prompt, index, geometry, 2, resized, pageIndex);
                    if (candidate != null) candidates.add(candidate);
                }
                candidates = suppressDuplicates(candidates);
                JSArray regions = new JSArray();
                for (Candidate candidate : candidates) regions.put(candidate.json());
                JSObject result = new JSObject();
                result.put("modelVersion", MODEL_VERSION);
                result.put("analysisWidth", width);
                result.put("analysisHeight", height);
                result.put("encoderMs", encoderMs);
                result.put("totalMs", elapsedMs(totalStarted));
                result.put("peakEstimateBytes", (long) width * height * 4L + 256L * 64L * 64L * 4L);
                final long javaHeapBytes = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
                final long nativeHeapBytes = Debug.getNativeHeapAllocatedSize();
                result.put("javaHeapUsedBytes", javaHeapBytes);
                result.put("nativeHeapAllocatedBytes", nativeHeapBytes);
                result.put("regions", regions);
                Log.i(TAG, "COMIC_ML_PAGE model=" + MODEL_VERSION + " prompts=" + prompts.length()
                    + " accepted=" + candidates.size() + " encoderMs=" + encoderMs + " totalMs=" + elapsedMs(totalStarted)
                    + " javaHeapBytes=" + javaHeapBytes + " nativeHeapBytes=" + nativeHeapBytes);
                call.resolve(result);
            }
        } catch (Throwable error) {
            Log.e(TAG, "COMIC_ML_FAILED class=" + error.getClass().getSimpleName(), error);
            call.reject("A segmentação local da página falhou.", "COMIC_ML_INFERENCE_FAILED",
                error instanceof Exception ? (Exception) error : new RuntimeException(error));
        } finally {
            if (resized != null && !resized.isRecycled()) resized.recycle();
            if (source != null && !source.isRecycled()) source.recycle();
            // A retained pair of ORT sessions accumulated hundreds of MB while the
            // progressive queue traversed a long comic. Work is strictly serialized, so
            // retaining sessions gives no concurrency benefit. Close native arenas after
            // each page; the next page lazily recreates them.
            closeSessions();
        }
    }

    private Candidate decodePrompt(OnnxTensor embedding, JSONObject prompt, int index, ComicModelGeometry geometry,
                                   int attempt, Bitmap diagnosticImage, int pageIndex) throws Exception {
        final int width = geometry.modelWidth, height = geometry.modelHeight;
        JSONArray box = prompt.getJSONArray("box");
        float[] mapped = geometry.toModel(box.getDouble(0), box.getDouble(1), box.getDouble(2), box.getDouble(3));
        if (mapped == null) {
            // Logged once (first attempt): retries would only repeat the same invalid box.
            if (attempt == 0) Log.w(TAG, "COMIC_ML_INSTANCE prompt=" + safeId(prompt.optString("id", String.valueOf(index)))
                + " result=prompt-outside-page");
            return null;
        }
        float x0 = mapped[0], y0 = mapped[1], x1 = mapped[2], y1 = mapped[3];
        final float centreX = (x0 + x1) / 2f, centreY = (y0 + y1) / 2f;
        final float radius = Math.max(12f, Math.max(x1 - x0, y1 - y0) * 1.8f);
        // SAM labels: 1 positive point, 0 negative point, 2/3 box corners.
        float[] pointCoords = attempt == 1
            ? new float[]{centreX, centreY, x0, y0, x1, y1,
                clamp(centreX - radius, 0, width - 1), clamp(centreY - radius, 0, height - 1),
                clamp(centreX + radius, 0, width - 1), clamp(centreY - radius, 0, height - 1),
                clamp(centreX - radius, 0, width - 1), clamp(centreY + radius, 0, height - 1),
                clamp(centreX + radius, 0, width - 1), clamp(centreY + radius, 0, height - 1)}
            : attempt == 2
                ? new float[]{centreX, centreY, x0, y0, x1, y1,
                    lerp(x0, x1, .25f), lerp(y0, y1, .25f), lerp(x0, x1, .75f), lerp(y0, y1, .25f),
                    lerp(x0, x1, .25f), lerp(y0, y1, .75f), lerp(x0, x1, .75f), lerp(y0, y1, .75f),
                    clamp(centreX - radius, 0, width - 1), centreY, clamp(centreX + radius, 0, width - 1), centreY,
                    centreX, clamp(centreY - radius, 0, height - 1), centreX, clamp(centreY + radius, 0, height - 1)}
                : new float[]{centreX, centreY, x0, y0, x1, y1};
        float[] pointLabels = attempt == 1 ? new float[]{1f, 2f, 3f, 0f, 0f, 0f, 0f}
            : attempt == 2 ? new float[]{1f, 2f, 3f, 1f, 1f, 1f, 1f, 0f, 0f, 0f, 0f}
            : new float[]{1f, 2f, 3f};
        float[] noMask = new float[256 * 256];
        Map<String, OnnxTensor> inputs = new HashMap<>();
        final long started = System.nanoTime();
        try (OnnxTensor coords = OnnxTensor.createTensor(environment, FloatBuffer.wrap(pointCoords), new long[]{1, pointLabels.length, 2});
             OnnxTensor labels = OnnxTensor.createTensor(environment, FloatBuffer.wrap(pointLabels), new long[]{1, pointLabels.length});
             OnnxTensor maskInput = OnnxTensor.createTensor(environment, FloatBuffer.wrap(noMask), new long[]{1, 1, 256, 256});
             OnnxTensor hasMask = OnnxTensor.createTensor(environment, FloatBuffer.wrap(new float[]{0}), new long[]{1});
             OnnxTensor originalSize = OnnxTensor.createTensor(environment, FloatBuffer.wrap(new float[]{height, width}), new long[]{2})) {
            inputs.put("image_embeddings", embedding);
            inputs.put("point_coords", coords);
            inputs.put("point_labels", labels);
            inputs.put("mask_input", maskInput);
            inputs.put("has_mask_input", hasMask);
            inputs.put("orig_im_size", originalSize);
            try (OrtSession.Result output = decoder.run(inputs)) {
                float[][][][] masks = (float[][][][]) output.get(0).getValue();
                float[][] scores = (float[][]) output.get(1).getValue();
                float score = scores[0][0];
                BitSet mask = new BitSet(width * height);
                int minX = width, minY = height, maxX = -1, maxY = -1, area = 0;
                for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                    if (masks[0][0][y][x] <= 0f) continue;
                    mask.set(y * width + x); area++;
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
                // Disconnected scenery islands are not part of a balloon. Keep only the
                // connected component that contains the OCR centre (or, if lettering is
                // hollow, the component with the greatest overlap with its text box).
                mask = retainPromptComponent(mask, width, height, centreX, centreY, x0, y0, x1, y1);
                minX = width; minY = height; maxX = maxY = -1; area = 0;
                for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) if (mask.get(y * width + x)) {
                    area++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
                int promptPixels = 0, covered = 0;
                for (int y = Math.max(0, (int) y0); y < Math.min(height, (int) Math.ceil(y1)); y++)
                    for (int x = Math.max(0, (int) x0); x < Math.min(width, (int) Math.ceil(x1)); x++) {
                        promptPixels++; if (mask.get(y * width + x)) covered++;
                    }
                float promptCoverage = covered / (float) Math.max(1, promptPixels);
                float pageShare = area / (float) (width * height);
                float maskSolidity = area / (float) Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
                boolean accepted = score >= MIN_SCORE && promptCoverage >= MIN_PROMPT_COVERAGE
                    && pageShare <= MAX_PAGE_SHARE && maskSolidity >= MIN_MASK_SOLIDITY && maxX >= minX && maxY >= minY;
                String reason = accepted ? "accepted" : score < MIN_SCORE ? "low-score"
                    : promptCoverage < MIN_PROMPT_COVERAGE ? "text-outside-mask"
                    : pageShare > MAX_PAGE_SHARE ? "page-sized-mask" : "fragmented-mask";
                Log.i(TAG, "COMIC_ML_INSTANCE prompt=" + safeId(prompt.optString("id", String.valueOf(index)))
                    + " score=" + score + " coverage=" + promptCoverage + " solidity=" + maskSolidity + " pageShare=" + pageShare
                    + " attempt=" + attemptName(attempt)
                    + " decoderMs=" + elapsedMs(started) + " result=" + reason);
                if (!accepted) {
                    String diagnostic = writeDiagnostic(diagnosticImage, mask, width, height, x0, y0, x1, y1,
                        pageIndex, safeId(prompt.optString("id", String.valueOf(index))), attemptName(attempt), reason,
                        score, promptCoverage, maskSolidity, pageShare);
                    Log.i(TAG, "COMIC_ML_DIAGNOSTIC page=" + pageIndex + " prompt=" + safeId(prompt.optString("id", String.valueOf(index)))
                        + " reason=" + reason + " overlay=" + diagnostic);
                    return null;
                }
                return new Candidate(prompt.optString("id", "p" + index), score, promptCoverage, maskSolidity,
                    elapsedMs(started), width, height, minX, minY, maxX + 1, maxY + 1, mask);
            }
        }
    }

    /** A private, temporary visual record for a rejected instance. It is deliberately
     * generated only for failures: full page, OCR box, exact mask and local crop can be
     * inspected through adb/run-as without retaining user pages in any server or library. */
    private String writeDiagnostic(Bitmap source, BitSet mask, int width, int height, float x0, float y0, float x1, float y1,
                                   int pageIndex, String promptId, String attempt, String reason, float score,
                                   float coverage, float solidity, float pageShare) {
        if (source == null || source.isRecycled()) return "unavailable";
        Bitmap overlay = null, crop = null;
        try {
            File directory = new File(getContext().getCacheDir(), "comic-diagnostics");
            if (!directory.exists() && !directory.mkdirs()) return "unavailable";
            String name = "p" + Math.max(0, pageIndex) + "-" + promptId + "-" + attempt + "-" + reason;
            float ratio = Math.min(1f, DIAGNOSTIC_LONGEST_SIDE / (float) Math.max(width, height));
            int outputWidth = Math.max(1, Math.round(width * ratio)), outputHeight = Math.max(1, Math.round(height * ratio));
            overlay = Bitmap.createScaledBitmap(source, outputWidth, outputHeight, true);
            int[] pixels = new int[outputWidth * outputHeight]; overlay.getPixels(pixels, 0, outputWidth, 0, 0, outputWidth, outputHeight);
            // Sample the exact native mask into a bounded evidence bitmap. This avoids a
            // second multi-megabyte full page for every rejected OCR prompt.
            for (int y = 0; y < outputHeight; y++) for (int x = 0; x < outputWidth; x++) {
                int nativeX = Math.min(width - 1, Math.round(x / ratio));
                int nativeY = Math.min(height - 1, Math.round(y / ratio));
                int i = y * outputWidth + x;
                if (!mask.get(nativeY * width + nativeX)) continue;
                int colour = pixels[i]; pixels[i] = Color.rgb(Math.min(255, Color.red(colour) + 90), Color.green(colour) / 3, Color.blue(colour) / 3);
            }
            Canvas canvas = new Canvas(overlay); Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.YELLOW); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(3);
            canvas.drawRect(x0 * ratio, y0 * ratio, x1 * ratio, y1 * ratio, paint);
            File overlayFile = new File(directory, name + "-overlay.png");
            try (FileOutputStream output = new FileOutputStream(overlayFile)) { overlay.compress(Bitmap.CompressFormat.PNG, 100, output); }
            Rect bounds = maskBounds(mask, width, height);
            if (bounds != null) {
                crop = Bitmap.createBitmap(source, bounds.left, bounds.top, bounds.width(), bounds.height());
                File cropFile = new File(directory, name + "-crop.png");
                try (FileOutputStream output = new FileOutputStream(cropFile)) { crop.compress(Bitmap.CompressFormat.PNG, 100, output); }
            }
            JSONObject metadata = new JSONObject();
            metadata.put("pageIndex", pageIndex); metadata.put("promptId", promptId); metadata.put("attempt", attempt); metadata.put("reason", reason);
            metadata.put("score", score); metadata.put("promptCoverage", coverage); metadata.put("maskSolidity", solidity); metadata.put("pageShare", pageShare);
            metadata.put("ocrBox", new JSONArray().put(x0).put(y0).put(x1).put(y1));
            metadata.put("overlay", overlayFile.getName()); metadata.put("crop", bounds == null ? JSONObject.NULL : name + "-crop.png");
            try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".json"))) { output.write(metadata.toString().getBytes("UTF-8")); }
            return overlayFile.getAbsolutePath();
        } catch (Exception error) { return "unavailable"; }
        finally { if (overlay != null && !overlay.isRecycled()) overlay.recycle(); if (crop != null && !crop.isRecycled()) crop.recycle(); }
    }

    private static Rect maskBounds(BitSet mask, int width, int height) {
        int minX = width, minY = height, maxX = -1, maxY = -1;
        for (int index = mask.nextSetBit(0); index >= 0; index = mask.nextSetBit(index + 1)) {
            int x = index % width, y = index / width;
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        return maxX < minX || maxY < minY ? null : new Rect(minX, minY, maxX + 1, maxY + 1);
    }

    /** Flood-fill only the SAM component that actually owns the OCR prompt. This removes
     * detached background/panel fragments without eroding a balloon's connected tail. */
    private static BitSet retainPromptComponent(BitSet input, int width, int height, float centreX, float centreY,
                                                 float x0, float y0, float x1, float y1) {
        final int size = width * height;
        int seed = Math.min(size - 1, Math.max(0, Math.round(centreY) * width + Math.round(centreX)));
        if (!input.get(seed)) {
            int best = -1;
            for (int y = Math.max(0, (int) y0); y < Math.min(height, (int) Math.ceil(y1)); y++) for (int x = Math.max(0, (int) x0); x < Math.min(width, (int) Math.ceil(x1)); x++) {
                int candidate = y * width + x; if (input.get(candidate)) { best = candidate; break; }
            }
            if (best < 0) return new BitSet(size); seed = best;
        }
        BitSet kept = new BitSet(size); int[] queue = new int[size]; int head = 0, tail = 1;
        queue[0] = seed; kept.set(seed);
        while (head < tail) {
            int current = queue[head++], x = current % width, y = current / width;
            if (x > 0) tail = visitComponent(input, kept, queue, tail, current - 1);
            if (x + 1 < width) tail = visitComponent(input, kept, queue, tail, current + 1);
            if (y > 0) tail = visitComponent(input, kept, queue, tail, current - width);
            if (y + 1 < height) tail = visitComponent(input, kept, queue, tail, current + width);
        }
        return kept;
    }

    private static int visitComponent(BitSet input, BitSet kept, int[] queue, int tail, int next) {
        if (input.get(next) && !kept.get(next)) { kept.set(next); queue[tail++] = next; }
        return tail;
    }

    /** Remove only masks that are effectively the same instance. Adjacent balloons whose
     * boxes overlap keep independent masks because their pixel IoU remains low. */
    private List<Candidate> suppressDuplicates(List<Candidate> values) {
        values.sort(Comparator.comparingDouble((Candidate value) -> value.score).reversed());
        List<Candidate> kept = new ArrayList<>();
        for (Candidate value : values) {
            boolean duplicate = false;
            for (Candidate other : kept) if (value.iou(other) > 0.72f) { duplicate = true; break; }
            if (!duplicate) kept.add(value);
            else Log.i(TAG, "COMIC_ML_INSTANCE prompt=" + safeId(value.id) + " result=duplicate-mask");
        }
        kept.sort(Comparator.comparing(value -> value.id));
        return kept;
    }

    private void ensureSessions() throws IOException, OrtException {
        synchronized (sessionLock) {
            if (encoder != null && decoder != null) return;
            environment = OrtEnvironment.getEnvironment();
            OrtSession.SessionOptions options = new OrtSession.SessionOptions();
            options.setIntraOpNumThreads(Math.max(1, Math.min(2, Runtime.getRuntime().availableProcessors())));
            options.setInterOpNumThreads(1);
            // Loading a model through byte[] keeps both Java's asset copy and ORT's native
            // copy alive. Materialising the immutable APK asset once lets ORT map it from a
            // file instead, which is important on long progressive conversions.
            encoder = environment.createSession(materializeModel("mobile_sam_image_encoder.onnx"), options);
            decoder = environment.createSession(materializeModel("sam_mask_decoder_single.onnx"), options);
            Log.i(TAG, "COMIC_ML_READY model=" + MODEL_VERSION + " runtime=onnxruntime-android");
        }
    }

    private void closeSessions() {
        synchronized (sessionLock) {
            try { if (encoder != null) encoder.close(); } catch (Exception ignored) {}
            try { if (decoder != null) decoder.close(); } catch (Exception ignored) {}
            encoder = null; decoder = null;
        }
    }

    private byte[] readAsset(String path) throws IOException {
        try (InputStream input = getContext().getAssets().open(path); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024]; int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private String materializeModel(String name) throws IOException {
        File directory = new File(getContext().getCodeCacheDir(), "lumeo-onnx");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("model_cache_directory");
        File target = new File(directory, name);
        if (target.isFile() && target.length() > 1024) return target.getAbsolutePath();
        File temporary = new File(directory, name + ".tmp");
        try (InputStream input = getContext().getAssets().open("models/" + name);
             FileOutputStream output = new FileOutputStream(temporary)) {
            byte[] buffer = new byte[64 * 1024]; int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        }
        if (!temporary.renameTo(target)) {
            if (target.exists() || !temporary.renameTo(target)) throw new IOException("model_cache_rename");
        }
        return target.getAbsolutePath();
    }

    /** Decodes only the pixels the 1024px encoder can use.  PDF pages and archive images
     * may be much larger; keeping their original raster here doubled the native heap while
     * the WebView already owns the source asset for the eventual high-resolution cutout. */
    private static Bitmap decodeForModel(byte[] bytes, int sample) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample; options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    private static float[] bitmapRgb(Bitmap bitmap) {
        int width = bitmap.getWidth(), height = bitmap.getHeight();
        int[] pixels = new int[width * height]; bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        float[] rgb = new float[pixels.length * 3];
        for (int index = 0; index < pixels.length; index++) {
            int pixel = pixels[index], offset = index * 3;
            rgb[offset] = (pixel >> 16) & 255; rgb[offset + 1] = (pixel >> 8) & 255; rgb[offset + 2] = pixel & 255;
        }
        return rgb;
    }

    private static String encodeRle(BitSet mask, int pageWidth, int x0, int y0, int x1, int y1) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        boolean current = false; int count = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
            boolean value = mask.get(y * pageWidth + x);
            if (value == current) count++; else { writeVarint(output, count); current = value; count = 1; }
        }
        writeVarint(output, count);
        return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
    }

    private static void writeVarint(ByteArrayOutputStream output, int value) {
        while (value >= 128) { output.write((value & 127) | 128); value >>>= 7; }
        output.write(value);
    }

    private static float clamp(float value, float minimum, float maximum) { return Math.max(minimum, Math.min(maximum, value)); }
    private static float lerp(float from, float to, float share) { return from + (to - from) * share; }
    private static String attemptName(int attempt) { return attempt == 2 ? "multi-positive-local-negative" : attempt == 1 ? "local-negative" : "box-positive"; }
    private static long elapsedMs(long start) { return Math.round((System.nanoTime() - start) / 1_000_000.0); }
    private static String safeId(String value) { return value.replaceAll("[^a-zA-Z0-9_-]", "_"); }

    @Override protected void handleOnDestroy() {
        executor.shutdownNow();
        closeSessions();
        super.handleOnDestroy();
    }

    private static final class Candidate {
        final String id; final float score; final float promptCoverage; final float maskSolidity; final long decoderMs;
        final int pageWidth, pageHeight, x0, y0, x1, y1; final BitSet mask;
        Candidate(String id, float score, float promptCoverage, float maskSolidity, long decoderMs, int pageWidth, int pageHeight,
                  int x0, int y0, int x1, int y1, BitSet mask) {
            this.id = id; this.score = score; this.promptCoverage = promptCoverage; this.maskSolidity = maskSolidity; this.decoderMs = decoderMs;
            this.pageWidth = pageWidth; this.pageHeight = pageHeight; this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.mask = mask;
        }
        float iou(Candidate other) {
            BitSet intersection = (BitSet) mask.clone(); intersection.and(other.mask);
            BitSet union = (BitSet) mask.clone(); union.or(other.mask);
            return intersection.cardinality() / (float) Math.max(1, union.cardinality());
        }
        JSObject json() throws IOException {
            JSObject value = new JSObject(); value.put("id", id); value.put("score", score);
            value.put("promptCoverage", promptCoverage); value.put("maskSolidity", maskSolidity); value.put("decoderMs", decoderMs);
            value.put("x", x0); value.put("y", y0); value.put("width", x1 - x0); value.put("height", y1 - y0);
            value.put("maskRle", encodeRle(mask, pageWidth, x0, y0, x1, y1)); return value;
        }
    }
}
