package io.github.dajiaohuang.solaratlas;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Map;

/** Secondary disclosure: no network request until the user presses Load. */
final class CoveragePanel extends LinearLayout {
    private final EditText backend;
    private final LinearLayout body;
    private final TextView summary, details;
    private final Button toggle, load, cancel, detailToggle;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Thread worker;
    private CoverageService service;
    private Runnable deadline;
    private int generation;

    CoveragePanel(Context context, EditText backend) {
        super(context); this.backend = backend; setOrientation(VERTICAL);
        toggle = button(R.string.coverage_title, "coverage-toggle"); addView(toggle);
        body = new LinearLayout(context); body.setOrientation(VERTICAL); body.setVisibility(GONE); addView(body);
        body.addView(label(getResources().getString(R.string.coverage_intro)));
        load = button(R.string.coverage_load, "coverage-load"); body.addView(load);
        cancel = button(R.string.coverage_cancel, "coverage-cancel"); cancel.setVisibility(GONE); body.addView(cancel);
        summary = label(getResources().getString(R.string.coverage_idle)); summary.setTag("coverage-summary");
        summary.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); body.addView(summary);
        detailToggle = button(R.string.coverage_details, "coverage-details-toggle"); detailToggle.setVisibility(GONE); body.addView(detailToggle);
        details = label(""); details.setTag("coverage-details"); details.setTextIsSelectable(true); details.setVisibility(GONE); body.addView(details);
        toggle.setOnClickListener(view -> {
            boolean opening = body.getVisibility() != VISIBLE;
            if (!opening) cancelAndClear(R.string.coverage_idle);
            body.setVisibility(opening ? VISIBLE : GONE);
            toggle.setText(opening ? R.string.coverage_close : R.string.coverage_title);
        });
        load.setOnClickListener(view -> start());
        cancel.setOnClickListener(view -> cancelAndClear(R.string.coverage_cancelled));
        detailToggle.setOnClickListener(view -> {
            boolean opening = details.getVisibility() != VISIBLE;
            details.setVisibility(opening ? VISIBLE : GONE);
            detailToggle.setText(opening ? R.string.coverage_hide_details : R.string.coverage_details);
        });
        backend.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { cancelAndClear(R.string.coverage_idle); }
            @Override public void afterTextChanged(Editable text) { }
        });
    }

    private void start() {
        cancelAndClear(R.string.coverage_loading);
        final int request = generation;
        final String address = backend.getText().toString().trim();
        final CoverageService requestService;
        try { requestService = new CoverageService(address); }
        catch (Exception error) { summary.setText(error instanceof CoverageService.UnavailableException ? R.string.coverage_unavailable : R.string.coverage_failed); return; }
        service = requestService; load.setEnabled(false); cancel.setVisibility(VISIBLE);
        deadline = () -> { if (request == generation) cancelAndClear(R.string.coverage_timeout); };
        main.postDelayed(deadline, 30_000);
        worker = new Thread(() -> {
            try {
                CoverageReport report = requestService.load();
                main.post(() -> {
                    if (request != generation || !address.equals(backend.getText().toString().trim())) return;
                    finishRequest(); show(report);
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (request != generation) return;
                    finishRequest(); summary.setText(error instanceof CoverageService.UnavailableException ? R.string.coverage_unavailable : R.string.coverage_failed);
                });
            } finally { requestService.close(); }
        }, "solar-coverage-load");
        worker.start();
    }

    void cancelAndClear(int message) {
        generation++;
        if (worker != null) worker.interrupt();
        if (service != null) service.close();
        finishRequest(); load.setText(R.string.coverage_load); summary.setText(message);
        details.setText(""); details.setVisibility(GONE); detailToggle.setVisibility(GONE); detailToggle.setText(R.string.coverage_details);
    }

    private void finishRequest() {
        if (deadline != null) main.removeCallbacks(deadline);
        deadline = null; worker = null; service = null; load.setEnabled(true); cancel.setVisibility(GONE);
    }

    private void show(CoverageReport report) {
        summary.setText(getResources().getString(R.string.coverage_counts, report.sourceRecords, report.mappedRecords, report.unresolvedRecords,
                report.explicitTargets, report.availableTargets, report.dependencyCovered, report.dependencyGaps)
                + "\n\n" + getResources().getString(R.string.coverage_epoch, Double.toString(report.auditEt), Double.toString(report.windowStartEt), Double.toString(report.windowEndEt))
                + "\n\n" + getResources().getString(R.string.coverage_limits));
        StringBuilder text = new StringBuilder(getResources().getString(R.string.coverage_identities, report.catalogVersion, report.catalogHash,
                report.inventoryHash, report.reportHash, report.sourceHash, report.mappingHash, report.satelliteHash));
        text.append("\n\n").append(getResources().getString(R.string.coverage_reasons));
        for (Map.Entry<String, Long> reason : report.unresolvedReasons.entrySet()) text.append('\n').append(reason.getKey()).append(": ").append(reason.getValue());
        details.setText(text); detailToggle.setVisibility(VISIBLE); load.setText(R.string.coverage_reload);
    }

    private Button button(int text, String tag) { Button button = new Button(getContext()); button.setText(text); button.setTag(tag); return button; }
    private TextView label(String text) { TextView view = new TextView(getContext()); view.setText(text); view.setTextSize(14); view.setTextColor(Color.rgb(220, 230, 235)); view.setLineSpacing(0, 1.15f); return view; }
    @Override protected void onDetachedFromWindow() { cancelAndClear(R.string.coverage_idle); super.onDetachedFromWindow(); }
}
