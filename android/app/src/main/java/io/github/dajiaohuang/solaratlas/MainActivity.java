package io.github.dajiaohuang.solaratlas;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Native Android observation deck. A verified backend is the only state source. */
public final class MainActivity extends Activity {
    private static final List<Preset> PRESETS = Arrays.asList(
            new Preset("Solar system - Sun reference", "naif:10", "naif:10,naif:199,naif:299,naif:399,naif:499,naif:599,naif:699,naif:799,naif:899"),
            new Preset("Earth - Moon", "naif:399", "naif:399,naif:301,naif:10"),
            new Preset("Mars - Phobos - Deimos", "naif:499", "naif:499,naif:401,naif:402"),
            new Preset("Jupiter - Galilean moons", "naif:599", "naif:599,naif:501,naif:502,naif:503,naif:504"),
            new Preset("Saturn - major moons", "naif:699", "naif:699,naif:601,naif:602,naif:603,naif:604,naif:605,naif:606,naif:607,naif:608")
    );

    private TextView status, evidence;
    private TextView evidencePage;
    private Button evidencePrevious, evidenceNext;
    private EditText backend, epoch, reference, bodyIds;
    private NativeObservationDeck viewport;
    private StateTileCache tileCache;
    private Thread loadThread;
    private Thread renderThread;
    private StateTileService.Frame currentFrame;
    private String currentReferenceId = "";
    private int evidencePageIndex;
    private int renderGeneration;
    private int generation;
    private boolean mode3d = true;

    @Override protected void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        int padding = dp(18);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(padding, padding, padding, padding);
        content.setBackgroundColor(Color.rgb(4, 10, 20));
        content.addView(label("SOLAR ATLAS", 26, Color.WHITE));
        content.addView(label("Observation Deck - native Android", 15, Color.rgb(145, 190, 205)));
        viewport = new NativeObservationDeck(this);
        LinearLayout.LayoutParams viewportParams = new LinearLayout.LayoutParams(-1, dp(300));
        viewportParams.topMargin = dp(14);
        content.addView(viewport, viewportParams);
        status = label("No observation loaded. Configure an HTTPS backend below.", 15, Color.rgb(98, 208, 181));
        status.setPadding(0, dp(10), 0, dp(5));
        content.addView(status);
        content.addView(label("Exact positions appear only after manifest, plan, tile, provenance and SHA-256 checks pass. Missing rows remain visible with their reason; a missing reference never becomes an origin.", 13, Color.rgb(220, 230, 235)));
        backend = input("Full-version backend HTTPS address", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        epoch = input("TDB Julian date", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL | InputType.TYPE_NUMBER_FLAG_SIGNED);
        epoch.setText("2461287.5");
        reference = input("Reference body ID", InputType.TYPE_CLASS_TEXT);
        reference.setText("naif:10");
        bodyIds = input("Body IDs separated by commas or whitespace (custom selection)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        bodyIds.setMinLines(2);
        content.addView(sectionLabel("BACKEND AND EPOCH"));
        content.addView(backend); content.addView(epoch); content.addView(reference); content.addView(bodyIds);
        content.addView(sectionLabel("PRESET SCENES"));
        for (Preset preset : PRESETS) {
            Button button = new Button(this);
            button.setText(preset.title); button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            button.setOnClickListener(v -> selectPreset(preset));
            content.addView(button, new LinearLayout.LayoutParams(-1, -2));
        }
        LinearLayout actions = new LinearLayout(this);
        Button load = new Button(this); load.setText("Load observation"); load.setOnClickListener(v -> { if (loadThread != null) cancelLoad(); else loadObservation(); });
        Button switchMode = new Button(this); switchMode.setText("Switch to 2D");
        switchMode.setOnClickListener(v -> { mode3d = !mode3d; switchMode.setText(mode3d ? "Switch to 2D" : "Switch to 3D"); viewport.clearPoints(); if (currentFrame != null) prepareRenderer(currentFrame, currentReferenceId, epoch.getText().toString().trim(), exactCount(currentFrame)); });
        Button tutorial = new Button(this); tutorial.setText("Tutorial"); tutorial.setOnClickListener(v -> showTutorial());
        actions.addView(load, new LinearLayout.LayoutParams(0, -2, 1)); actions.addView(switchMode, new LinearLayout.LayoutParams(0, -2, 1)); actions.addView(tutorial, new LinearLayout.LayoutParams(0, -2, 1)); content.addView(actions);
        content.addView(sectionLabel("STATE EVIDENCE"));
        evidence = label("No rows loaded.", 12, Color.rgb(190, 205, 215)); evidence.setLineSpacing(0, 1.15f); content.addView(evidence);
        LinearLayout pager = new LinearLayout(this);
        evidencePrevious = new Button(this); evidencePrevious.setText("Previous"); evidencePrevious.setOnClickListener(v -> changeEvidencePage(-1));
        evidencePage = label("Page 0 / 0", 12, Color.rgb(145, 190, 205)); evidencePage.setGravity(Gravity.CENTER);
        evidenceNext = new Button(this); evidenceNext.setText("Next"); evidenceNext.setOnClickListener(v -> changeEvidencePage(1));
        pager.addView(evidencePrevious, new LinearLayout.LayoutParams(0, -2, 1)); pager.addView(evidencePage, new LinearLayout.LayoutParams(0, -2, 1)); pager.addView(evidenceNext, new LinearLayout.LayoutParams(0, -2, 1)); content.addView(pager);
        updateEvidencePageControls(0, 0);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        FrameLayout safeContent = new FrameLayout(this);
        safeContent.setBackgroundColor(Color.rgb(4, 10, 20));
        safeContent.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        // API 35+ edge-to-edge must not place actions under system navigation
        // or the keyboard. Reapply absolute insets, never accumulate padding.
        ViewCompat.setOnApplyWindowInsetsListener(safeContent, (view, windowInsets) -> {
            Insets safe = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return windowInsets;
        });
        setContentView(safeContent);
        ViewCompat.requestApplyInsets(safeContent);
        try { tileCache = new StateTileCache(new File(getCacheDir(), "state-tiles-v1")); }
        catch (Exception error) { tileCache = null; status.setText("Tile cache is unavailable; no observation can be loaded."); }
    }

    private void selectPreset(Preset preset) {
        cancelLoad(); cancelRender(); currentFrame = null; reference.setText(preset.reference); bodyIds.setText(preset.ids);
        status.setText(preset.title + " selected. Press Load observation for verified states."); viewport.clearPoints(); showEvidence(null, "");
    }

    private void loadObservation() {
        final int requestGeneration = ++generation;
        final String address = backend.getText().toString().trim();
        final String epochText = epoch.getText().toString().trim();
        final String referenceId = reference.getText().toString().trim();
        final List<String> ids = parseIds(bodyIds.getText().toString(), referenceId);
        final double epochJd;
        try { epochJd = Double.parseDouble(epochText); } catch (NumberFormatException error) { status.setText("Enter a finite TDB Julian date."); return; }
        if (!Double.isFinite(epochJd) || address.isEmpty() || ids.isEmpty() || referenceId.isEmpty()) { status.setText("Enter an HTTPS backend, finite TDB JD, body IDs and a reference ID."); return; }
        cancelRender(); currentFrame = null; viewport.clearPoints(); showEvidence(null, ""); evidence.setText("Loading; no partial observation will be published."); status.setText("Loading manifest, plans and verified state tiles...");
        loadThread = new Thread(() -> {
            try {
                if (tileCache == null) throw new StateTileDecoder.ProtocolException("tile cache is unavailable");
                StateTileService.Frame loaded = new StateTileService(address, tileCache).load(ids, epochJd);
                if (Thread.currentThread().isInterrupted()) throw new StateTileDecoder.ProtocolException("state load cancelled");
                runOnUiThread(() -> publish(requestGeneration, loaded, referenceId, epochText));
            } catch (Exception error) {
                runOnUiThread(() -> fail(requestGeneration, error));
            }
        }, "solar-state-load");
        loadThread.start();
    }

    private void publish(int requestGeneration, StateTileService.Frame loaded, String referenceId, String epochText) {
        if (requestGeneration != generation) return; loadThread = null; currentFrame = loaded; currentReferenceId = referenceId; showEvidence(loaded, referenceId); viewport.clearPoints();
        int exactCount = 0; for (boolean exact : loaded.exact) if (exact) exactCount++;
        status.setText(exactCount + " verified states - " + (loaded.exact.length - exactCount) + " data gaps - TDB JD " + epochText + ". Preparing GPU points...");
        prepareRenderer(loaded, referenceId, epochText, exactCount);
    }

    private void prepareRenderer(StateTileService.Frame frame, String referenceId, String epochText, int exactCount) {
        cancelRender();
        final int request = ++renderGeneration;
        final boolean render3d = mode3d;
        renderThread = new Thread(() -> {
            try {
                NativeObservationDeck.PreparedPoints prepared = NativeObservationDeck.prepare(frame, referenceId, render3d);
                if (Thread.currentThread().isInterrupted()) return;
                runOnUiThread(() -> {
                    if (request != renderGeneration || currentFrame != frame) return;
                    renderThread = null; viewport.setPrepared(prepared);
                    String referenceStatus = prepared.referenceAvailable ? "" : " Reference state unavailable; no origin substituted.";
                    status.setText(exactCount + " verified states - " + (frame.exact.length - exactCount) + " data gaps - TDB JD " + epochText + ". " + (render3d ? "3D" : "2D") + " GPU points " + prepared.displayedCount + "/" + prepared.candidateCount + " (limit " + prepared.displayLimit + ")." + referenceStatus);
                });
            } catch (RuntimeException error) {
                runOnUiThread(() -> { if (request == renderGeneration) { renderThread = null; viewport.clearPoints(); status.setText("GPU point preparation failed; no observation rendered."); } });
            }
        }, "solar-render-prepare");
        renderThread.start();
    }

    private static int exactCount(StateTileService.Frame frame) { int count = 0; for (boolean value : frame.exact) if (value) count++; return count; }

    private void fail(int requestGeneration, Exception error) { if (requestGeneration != generation) return; loadThread = null; currentFrame = null; cancelRender(); viewport.clearPoints(); status.setText(error.getMessage() == null ? "State load failed." : error.getMessage()); showEvidence(null, ""); evidence.setText("No partial observation was published."); }
    private void cancelLoad() { generation++; if (loadThread != null) { loadThread.interrupt(); loadThread = null; status.setText("Loading cancelled. No partial observation was published."); } currentFrame = null; cancelRender(); viewport.clearPoints(); }
    private void cancelRender() { renderGeneration++; if (renderThread != null) { renderThread.interrupt(); renderThread = null; } }

    private void showEvidence(StateTileService.Frame frame, String referenceId) { currentFrame = frame; currentReferenceId = referenceId == null ? "" : referenceId; evidencePageIndex = 0; renderEvidencePage(); }
    private void changeEvidencePage(int delta) { evidencePageIndex += delta; renderEvidencePage(); }
    private void renderEvidencePage() {
        if (currentFrame == null) { evidence.setText("No rows loaded."); updateEvidencePageControls(0, 0); return; }
        int total = currentFrame.metadata.size(), pages = Math.max(1, (total + 99) / 100);
        evidencePageIndex = Math.max(0, Math.min(evidencePageIndex, pages - 1));
        int start = evidencePageIndex * 100, end = Math.min(total, start + 100);
        StringBuilder out = new StringBuilder(4096);
        out.append("Rows ").append(start + 1).append('-').append(end).append(" of ").append(total).append('\n');
        int referenceIndex = -1;
        for (int i = 0; i < total; i++) if (currentFrame.metadata.get(i).id.equals(currentReferenceId)) { referenceIndex = i; break; }
        if (referenceIndex < 0 || !currentFrame.exact[referenceIndex]) out.append("Reference state is missing; no origin substituted.\n");
        for (int i = start; i < end; i++) {
            StateTileDecoder.Metadata row = currentFrame.metadata.get(i);
            out.append(row.id).append(currentFrame.exact[i] ? " - VERIFIED - " : " - MISSING - ")
                    .append(currentFrame.exact[i] ? row.model + " - " + row.source : row.missingReason).append('\n');
        }
        evidence.setText(out.toString()); updateEvidencePageControls(evidencePageIndex + 1, pages);
    }
    private void updateEvidencePageControls(int page, int pages) { if (evidencePage != null) evidencePage.setText("Page " + page + " / " + pages); if (evidencePrevious != null) evidencePrevious.setEnabled(page > 1); if (evidenceNext != null) evidenceNext.setEnabled(page > 0 && page < pages); }

    private static List<String> parseIds(String text, String referenceId) {
        Set<String> seen = new HashSet<>(); List<String> ids = new ArrayList<>();
        for (String value : text.split("[,\\s]+")) { String id = value.trim(); if (!id.isEmpty() && seen.add(id)) ids.add(id); }
        if (!referenceId.isEmpty() && seen.add(referenceId)) ids.add(referenceId);
        return ids;
    }

    private EditText input(String hint, int type) { EditText result = new EditText(this); result.setHint(hint); result.setTextColor(Color.WHITE); result.setHintTextColor(Color.rgb(125, 145, 160)); result.setInputType(type); return result; }
    private TextView sectionLabel(String value) { TextView result = label(value, 12, Color.rgb(145, 190, 205)); result.setPadding(0, dp(16), 0, dp(3)); return result; }
    private TextView label(String text, int size, int color) { TextView result = new TextView(this); result.setText(text); result.setTextSize(size); result.setTextColor(color); return result; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void showTutorial() { new android.app.AlertDialog.Builder(this).setTitle("First observation").setMessage("1. Enter an HTTPS backend address and a finite TDB Julian date. 2. Choose a preset or enter custom IDs. 3. Loading verifies manifest, plan and every binary tile; cancellation publishes nothing. 4. Only verified exact rows render. Missing references never become an invented origin.").setPositiveButton("Done", null).show(); }
    @Override protected void onPause() {
        cancelLoad(); showEvidence(null, "");
        status.setText("Observation released while inactive. Load again to resume verified states.");
        viewport.onPause(); super.onPause();
    }
    @Override protected void onResume() { super.onResume(); viewport.onResume(); }
    @Override protected void onDestroy() { cancelLoad(); super.onDestroy(); }

    private static final class Preset { final String title, reference, ids; Preset(String title, String reference, String ids) { this.title = title; this.reference = reference; this.ids = ids; } }

}
