package io.github.dajiaohuang.solaratlas;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.function.Consumer;

/** On-demand original-file analysis with explicit scientific assumptions. */
final class StellarMotionPanel extends LinearLayout {
    private final EditText backend,id,epoch;
    private final CheckBox adopt,covariance;
    private final Button load,cancel,export;
    private final TextView status,result,files;
    private final Handler main=new Handler(Looper.getMainLooper());
    private byte[] manifest,rows;
    private StellarMotionReport displayed;
    private StellarMotionService service;
    private Thread worker;
    private CancellationSignal sourceCancellation;
    private int generation;
    private Runnable importDeadline;
    StellarMotionPanel(Context context,EditText backend,Consumer<Boolean> pick,Consumer<byte[]> save) {
        super(context);this.backend=backend;setOrientation(VERTICAL);
        Button toggle=button(R.string.stellar_title,"stellar-toggle");addView(toggle);
        LinearLayout body=new LinearLayout(context);body.setOrientation(VERTICAL);body.setVisibility(GONE);addView(body);
        body.addView(label(getResources().getString(R.string.stellar_intro)));
        Button manifestButton=button(R.string.stellar_manifest,"stellar-manifest"),rowsButton=button(R.string.stellar_rows,"stellar-rows");body.addView(manifestButton);body.addView(rowsButton);
        manifestButton.setOnClickListener(v->pick.accept(true));rowsButton.setOnClickListener(v->pick.accept(false));
        files=label("");body.addView(files);
        id=field(body,R.string.stellar_id,"65212004581252736","stellar-id");epoch=field(body,R.string.stellar_epoch,"2026","stellar-epoch");
        adopt=new CheckBox(context);adopt.setText(R.string.stellar_rv);adopt.setTag("stellar-rv");adopt.setTextColor(Color.WHITE);body.addView(adopt);
        covariance=new CheckBox(context);covariance.setText(R.string.stellar_covariance);covariance.setTag("stellar-covariance");covariance.setTextColor(Color.WHITE);body.addView(covariance);
        load=button(R.string.stellar_load,"stellar-load");cancel=button(R.string.stellar_cancel,"stellar-cancel");export=button(R.string.stellar_export,"stellar-export");body.addView(load);body.addView(cancel);
        status=label("");status.setTag("stellar-status");status.setAccessibilityLiveRegion(ACCESSIBILITY_LIVE_REGION_POLITE);body.addView(status);
        result=label("");result.setTag("stellar-result");result.setTextIsSelectable(true);body.addView(result);body.addView(export);
        load.setOnClickListener(v->calculate());cancel.setOnClickListener(v->clear());export.setOnClickListener(v->{if(displayed!=null)save.accept(displayed.exportBytes());});
        toggle.setOnClickListener(v->{boolean opening=body.getVisibility()!=VISIBLE;if(!opening)clear();body.setVisibility(opening?VISIBLE:GONE);});
        TextWatcher edited=new TextWatcher(){public void beforeTextChanged(CharSequence s,int at,int count,int after){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int at,int before,int count){clear();}};
        backend.addTextChangedListener(edited);id.addTextChangedListener(edited);epoch.addTextChangedListener(edited);
        adopt.setOnCheckedChangeListener((v,value)->clear());covariance.setOnCheckedChangeListener((v,value)->clear());clear();
    }
    void importSource(Uri uri,boolean isManifest) {
        clear();if(isManifest)manifest=null;else rows=null;showFiles();final int token=generation;
        CancellationSignal cancellation=new CancellationSignal();sourceCancellation=cancellation;busy();
        importDeadline=()->{if(token==generation){clear();status.setText(R.string.stellar_timeout);}};main.postDelayed(importDeadline,25000);
        worker=new Thread(()->{
            try(AssetFileDescriptor descriptor=getContext().getContentResolver().openAssetFileDescriptor(uri,"r",cancellation)) {
                if(descriptor==null)throw new IOException("Source file unavailable");int limit=isManifest?1024*1024:8*1024*1024;
                if(descriptor.getLength()>limit)throw new IOException("Original source exceeds byte budget");
                byte[] bytes;
                try(InputStream stream=descriptor.createInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                    byte[] chunk=new byte[16384];int count;
                    while((count=stream.read(chunk))!=-1){if(Thread.currentThread().isInterrupted()||cancellation.isCanceled())throw new IOException("Source import cancelled");if(count>limit-output.size())throw new IOException("Original source exceeds byte budget");output.write(chunk,0,count);}
                    if(output.size()==0)throw new IOException("Original source is empty");bytes=output.toByteArray();
                }
                main.post(()->{if(token!=generation)return;if(isManifest)manifest=bytes;else rows=bytes;finish();showFiles();status.setText(R.string.stellar_idle);});
            }catch(Exception error){main.post(()->{if(token!=generation)return;finish();status.setText(error.getMessage());});}
        },"solar-stellar-import");worker.start();
    }
    private void calculate() {
        clear();final int token=generation;final StellarMotionRequest request;final StellarMotionService current;
        try{request=new StellarMotionRequest(manifest,rows,id.getText().toString().trim(),Double.parseDouble(epoch.getText().toString().trim()),adopt.isChecked()?StellarMotionRequest.RV_POLICY:"",covariance.isChecked()?StellarMotionRequest.COVARIANCE_POLICY:null);current=new StellarMotionService(backend.getText().toString());}
        catch(Exception error){status.setText(error.getMessage());return;}
        service=current;busy();worker=new Thread(()->{try{StellarMotionReport report=current.load(request);main.post(()->{if(token!=generation)return;finish();show(report);});}catch(Exception error){main.post(()->{if(token!=generation)return;finish();status.setText(error.getMessage());});}finally{current.close();}},"solar-stellar-analysis");worker.start();
    }
    private void show(StellarMotionReport report) {
        displayed=report;status.setText("Gaia DR3 "+report.sourceId+" · J"+report.epoch+" TCB");export.setVisibility(VISIBLE);
        String[] labels={"RA (deg)","Dec (deg)","Parallax (mas)","pmra (mas/yr)","pmdec (mas/yr)","RV (km/s)"};double[] state=report.state();StringBuilder text=new StringBuilder();
        for(int i=0;i<6;i++)text.append(labels[i]).append(": ").append(String.format(Locale.ROOT,"%.12g",state[i])).append('\n');
        double[] sigma=report.formalStandardDeviations();if(sigma!=null){text.append('\n').append(getResources().getString(R.string.stellar_sigmas)).append('\n');String[] units={"delta-alpha*cos(delta) (mas)","delta-dec (mas)","parallax (mas)","pmra (mas/yr)","pmdec (mas/yr)","RV (km/s)"};for(int i=0;i<6;i++)text.append(units[i]).append(": ").append(String.format(Locale.ROOT,"%.6g",sigma[i])).append('\n');}
        text.append('\n').append(getResources().getString(R.string.stellar_limits));result.setText(text.toString());
    }
    void clear(){generation++;if(worker!=null)worker.interrupt();if(sourceCancellation!=null)sourceCancellation.cancel();if(service!=null)service.close();finish();displayed=null;result.setText("");export.setVisibility(GONE);status.setText(R.string.stellar_idle);}
    private void finish(){if(importDeadline!=null)main.removeCallbacks(importDeadline);importDeadline=null;worker=null;sourceCancellation=null;service=null;load.setEnabled(manifest!=null&&rows!=null&&adopt.isChecked());cancel.setVisibility(GONE);}
    private void busy(){load.setEnabled(false);cancel.setVisibility(VISIBLE);status.setText(R.string.stellar_loading);}
    private void showFiles(){files.setText("manifest.json: "+(manifest==null?"—":manifest.length+" B")+"\nrows.csv: "+(rows==null?"—":rows.length+" B"));}
    void exportStatus(boolean success){status.setText(success?R.string.stellar_exported:R.string.stellar_export_failed);}
    private Button button(int resource,String tag){Button button=new Button(getContext());button.setText(resource);button.setTag(tag);return button;}
    private TextView label(String text){TextView view=new TextView(getContext());view.setText(text);view.setTextColor(Color.rgb(220,230,235));view.setTextSize(14);return view;}
    private EditText field(LinearLayout body,int resource,String value,String tag){String name=getResources().getString(resource);body.addView(label(name));EditText field=new EditText(getContext());field.setContentDescription(name);field.setTextColor(Color.WHITE);field.setSingleLine(true);field.setText(value);field.setTag(tag);body.addView(field);return field;}
    @Override protected void onDetachedFromWindow(){clear();super.onDetachedFromWindow();}
}
