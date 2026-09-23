package io.github.dajiaohuang.solaratlas;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Explicit on-demand station search; edits and lifecycle changes discard stale work. */
final class GroundContactsPanel extends LinearLayout {
    private final EditText backend, start, end, longitude, latitude, height, foreground, background;
    private final TextView status, result;
    private final Button load, cancel, export;
    private GroundContactsReport displayed;
    private final Handler main = new Handler(Looper.getMainLooper());
    private GroundContactsService service;
    private Thread worker;
    private Runnable deadline;
    private int generation;
    GroundContactsPanel(Context context, EditText backend, java.util.function.Consumer<byte[]> exportResult) {
        super(context); this.backend = backend; setOrientation(VERTICAL);
        Button toggle = button(R.string.contacts_title, "contacts-toggle"); addView(toggle);
        LinearLayout body = new LinearLayout(context); body.setOrientation(VERTICAL); body.setVisibility(GONE); addView(body);
        body.addView(label(getResources().getString(R.string.contacts_intro)));
        start = field(body, R.string.contacts_start, "2024-04-08T17:00:00Z", "contacts-start");
        end = field(body, R.string.contacts_end, "2024-04-08T21:00:00Z", "contacts-end");
        longitude = field(body, R.string.contacts_longitude, "-96.797", "contacts-longitude");
        latitude = field(body, R.string.contacts_latitude, "32.7767", "contacts-latitude");
        height = field(body, R.string.contacts_height, "130", "contacts-height");
        foreground = field(body, R.string.contacts_foreground, "301", "contacts-foreground");
        background = field(body, R.string.contacts_background, "10", "contacts-background");
        load = button(R.string.contacts_load, "contacts-load"); body.addView(load);
        cancel = button(R.string.contacts_cancel, "contacts-cancel"); cancel.setVisibility(GONE); body.addView(cancel);
        status = label(getResources().getString(R.string.contacts_idle)); status.setTag("contacts-status"); status.setAccessibilityLiveRegion(ACCESSIBILITY_LIVE_REGION_POLITE); body.addView(status);
        result = label(""); result.setTag("contacts-result"); result.setTextIsSelectable(true); body.addView(result);
        export = button(R.string.contacts_export, "contacts-export"); export.setVisibility(GONE); body.addView(export);
        export.setOnClickListener(v -> { if (displayed != null) exportResult.accept(displayed.exportBytes()); });
        toggle.setOnClickListener(v -> { boolean opening = body.getVisibility() != VISIBLE; if (!opening) clear(); body.setVisibility(opening ? VISIBLE : GONE); });
        load.setOnClickListener(v -> search()); cancel.setOnClickListener(v -> { clear(); status.setText(R.string.contacts_cancelled); });
        TextWatcher changed = new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int at, int count, int after) { }
            public void onTextChanged(CharSequence s, int at, int before, int count) { clear(); }
            public void afterTextChanged(Editable e) { }
        };
        for (EditText input : new EditText[]{backend, start, end, longitude, latitude, height, foreground, background}) input.addTextChangedListener(changed);
    }
    private void search() {
        clear(); final int requestId = generation;
        final GroundContactsReport.Request request; final GroundContactsService current;
        try {
            request = new GroundContactsReport.Request(text(start), text(end), Double.parseDouble(text(longitude)), Double.parseDouble(text(latitude)), Double.parseDouble(text(height)), Integer.parseInt(text(foreground)), Integer.parseInt(text(background)));
            current = new GroundContactsService(text(backend));
        } catch (Exception error) { status.setText(getResources().getString(R.string.contacts_failed)+" · "+error.getMessage()); return; }
        service = current; load.setEnabled(false); cancel.setVisibility(VISIBLE); status.setText(R.string.contacts_loading);
        deadline = () -> { if (generation == requestId) { clear(); status.setText(R.string.contacts_timeout); } }; main.postDelayed(deadline, 25_000);
        worker = new Thread(() -> {
            try {
                GroundContactsReport report = current.load(request);
                main.post(() -> { if (requestId != generation) return; finish(); show(report); });
            } catch (Exception error) {
                main.post(() -> { if (requestId != generation) return; finish(); status.setText(getResources().getString(R.string.contacts_failed)+" · "+error.getMessage()); });
            } finally { current.close(); }
        }, "solar-ground-contacts"); worker.start();
    }
    void clear() {
        generation++; if (worker != null) worker.interrupt(); if (service != null) service.close(); finish();
        status.setText(R.string.contacts_idle); result.setText(""); displayed = null; export.setVisibility(GONE);
    }
    private void finish() { if (deadline != null) main.removeCallbacks(deadline); deadline = null; worker = null; service = null; load.setEnabled(true); cancel.setVisibility(GONE); }
    private void show(GroundContactsReport report) {
        displayed = report; export.setVisibility(VISIBLE);
        status.setText(getResources().getString(R.string.contacts_count, report.contacts.size(), report.evaluations));
        StringBuilder text = new StringBuilder(getResources().getString(R.string.contacts_limits)).append('\n');
        for (GroundContactsReport.Contact c : report.contacts) text.append('\n').append(c.boundary).append(" · ").append(c.direction).append('\n').append(c.utc).append('\n').append(c.bracketStartUTC).append(" → ").append(c.bracketEndUTC).append('\n');
        if (report.contacts.isEmpty()) text.append('\n').append(getResources().getString(R.string.contacts_no_crossing));
        if (report.hasOverlapWindows) {
            text.append("\n\n").append(getResources().getString(R.string.contacts_windows));
            for (GroundContactsReport.OverlapWindow window : report.overlapWindows) {
                text.append("\n\n").append(getResources().getString(window.boundary.equals("external") ? R.string.contacts_overlap : R.string.contacts_containment))
                        .append('\n').append(window.start.position.utc).append(" → ").append(window.end.position.utc)
                        .append('\n').append(getResources().getString(R.string.contacts_duration, window.duration, window.minimumDuration, window.maximumDuration))
                        .append('\n').append(edgeLabel(window.start.kind)).append(" / ").append(edgeLabel(window.end.kind));
            }
            if (report.overlapWindows.isEmpty()) text.append('\n').append(getResources().getString(R.string.contacts_no_window));
        }
        text.append('\n').append(getResources().getString(R.string.contacts_geometry)).append(": ").append(report.startGeometry).append(" / ").append(report.endGeometry)
                .append("\nIERS ").append(report.eopRetrievedAt).append('\n').append(report.eopHash).append("\nCatalog SHA-256\n").append(report.catalogHash);
        result.setText(text.toString());
    }
    private String edgeLabel(String kind) { return getResources().getString(kind.equals("search-boundary") ? R.string.contacts_clipped : kind.equals("sampled-zero") ? R.string.contacts_zero : R.string.contacts_bracketed); }
    void exportStatus(boolean success) { status.setText(success ? R.string.contacts_exported : R.string.contacts_export_failed); }
    private static String text(EditText view) { return view.getText().toString().trim(); }
    private Button button(int text, String tag) { Button v = new Button(getContext()); v.setText(text); v.setTag(tag); return v; }
    private TextView label(String text) { TextView v = new TextView(getContext()); v.setText(text); v.setTextSize(14); v.setTextColor(Color.rgb(220,230,235)); return v; }
    private EditText field(LinearLayout body, int name, String value, String tag) {
        body.addView(label(getResources().getString(name))); EditText v = new EditText(getContext()); v.setContentDescription(getResources().getString(name)); v.setTextColor(Color.WHITE); v.setSingleLine(true); v.setText(value); v.setTag(tag); body.addView(v); return v;
    }
    @Override protected void onDetachedFromWindow() { clear(); super.onDetachedFromWindow(); }
}
