package io.github.dajiaohuang.solaratlas;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputFilter;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.function.Consumer;

/** Independent native directory UI. Browsing never requests scientific states. */
final class SourceIdentityPanel extends LinearLayout {
    private final EditText backend, query;
    private final LinearLayout body;
    private final TextView summary, records;
    private final Button toggle, load, next, cancel, select;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SourceIdentityPage page;
    private SourceIdentityService service;
    private Thread worker;
    private Runnable deadline;
    private int generation;

    SourceIdentityPanel(Context context, EditText backend, Consumer<SourceIdentityPage> selected) {
        super(context); this.backend = backend; setOrientation(VERTICAL);
        toggle = button(R.string.identity_title, "identity-toggle"); addView(toggle);
        body = new LinearLayout(context); body.setOrientation(VERTICAL); body.setVisibility(GONE); addView(body);
        body.addView(label(getResources().getString(R.string.identity_intro)));
        body.addView(label(getResources().getString(R.string.identity_query)));
        query = new EditText(context); query.setTag("identity-query"); query.setTextColor(Color.WHITE);
        query.setSingleLine(true); query.setFilters(new InputFilter[] {new InputFilter.LengthFilter(256)}); body.addView(query);
        load = button(R.string.identity_load, "identity-load"); body.addView(load);
        next = button(R.string.identity_next, "identity-next"); next.setVisibility(GONE); body.addView(next);
        cancel = button(R.string.coverage_cancel, "identity-cancel"); cancel.setVisibility(GONE); body.addView(cancel);
        summary = label(getResources().getString(R.string.identity_idle)); summary.setTag("identity-summary");
        summary.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); body.addView(summary);
        select = button(R.string.identity_select, "identity-select"); select.setVisibility(GONE); body.addView(select);
        records = label(""); records.setTag("identity-records"); records.setTextIsSelectable(true); body.addView(records);
        toggle.setOnClickListener(view -> {
            boolean opening = body.getVisibility() != VISIBLE;
            if (!opening) clear(); body.setVisibility(opening ? VISIBLE : GONE);
            toggle.setText(opening ? R.string.identity_close : R.string.identity_title);
        });
        load.setOnClickListener(view -> start(null)); next.setOnClickListener(view -> start(page));
        cancel.setOnClickListener(view -> clear());
        select.setOnClickListener(view -> {
            if (page == null || !page.base.equals(backend.getText().toString().trim().replaceAll("/+\\z", ""))) { clear(); return; }
            selected.accept(page); summary.setText(R.string.identity_selected);
        });
        TextWatcher watcher = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { clear(); }
            @Override public void afterTextChanged(Editable text) { }
        };
        query.addTextChangedListener(watcher); backend.addTextChangedListener(watcher);
    }

    private void start(SourceIdentityPage previous) {
        clear(); summary.setText(R.string.identity_loading);
        final int request = generation; final String address = backend.getText().toString().trim(), search = query.getText().toString();
        final SourceIdentityService requested;
        try { requested = new SourceIdentityService(address); }
        catch (Exception error) { summary.setText(R.string.identity_failed); return; }
        service = requested; load.setEnabled(false); cancel.setVisibility(VISIBLE);
        deadline = () -> { if (request == generation) { clear(); summary.setText(R.string.identity_failed); } };
        main.postDelayed(deadline, 30_000);
        worker = new Thread(() -> {
            try {
                SourceIdentityPage result = requested.load(search, previous);
                main.post(() -> { if (request == generation) { finish(); show(result); } });
            } catch (Exception error) {
                main.post(() -> { if (request == generation) { finish(); summary.setText(R.string.identity_failed); } });
            } finally { requested.close(); }
        }, "solar-identity-page"); worker.start();
    }

    void clear() {
        generation++; if (worker != null) worker.interrupt(); if (service != null) service.close(); finish();
        page = null; records.setText(""); summary.setText(R.string.identity_idle); next.setVisibility(GONE); select.setVisibility(GONE);
    }
    private void finish() {
        if (deadline != null) main.removeCallbacks(deadline); deadline = null; worker = null; service = null;
        load.setEnabled(true); cancel.setVisibility(GONE);
    }
    private void show(SourceIdentityPage result) {
        page = result;
        summary.setText(getResources().getString(R.string.identity_counts, result.rows.size(), result.totalRecords));
        StringBuilder text = new StringBuilder(getResources().getString(R.string.identity_hash, result.inventoryHash));
        for (SourceIdentityPage.Row row : result.rows) text.append("\n\n").append(row.name.isEmpty() ? row.id : row.name)
                .append('\n').append(row.id).append('\n').append(row.category).append(" / ").append(row.source).append(" / ").append(row.sourceRow)
                .append('\n').append(row.identityStatus).append(" / ").append(row.ephemerisStatus);
        records.setText(text); next.setVisibility(result.next.isEmpty() ? GONE : VISIBLE); select.setVisibility(result.rows.isEmpty() ? GONE : VISIBLE);
    }
    private Button button(int text, String tag) { Button button = new Button(getContext()); button.setText(text); button.setAllCaps(false); button.setTag(tag); return button; }
    private TextView label(String text) { TextView view = new TextView(getContext()); view.setText(text); view.setTextSize(14); view.setTextColor(Color.rgb(220, 230, 235)); return view; }
    @Override protected void onDetachedFromWindow() { clear(); super.onDetachedFromWindow(); }
}
