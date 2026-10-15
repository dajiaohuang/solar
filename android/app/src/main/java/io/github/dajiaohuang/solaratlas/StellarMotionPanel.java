package io.github.dajiaohuang.solaratlas;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.IOException;
import java.util.Locale;
import java.util.function.Consumer;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;

/** On-demand original-file analysis with explicit scientific assumptions. */
final class StellarMotionPanel extends LinearLayout {
    private final EditText backend,id,epoch,utc,longitude,latitude,height,pressure,temperature,humidity,wavelength;
    private final CheckBox adopt,covariance,stationMode,refraction;
    private final Button load,cancel,export;
    private final TextView status,result,files;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final NativeUiResultSlot results=new NativeUiResultSlot();
    private final NativeProjectionPrefetch calculationWork=new NativeProjectionPrefetch();
    private byte[] manifest,rows;
    private StellarMotionReport displayed;
    private StellarObserverReport displayedObserver;
    private StellarMotionService service;
    private Future<?> importWork;
    private CancellationSignal sourceCancellation;
    private int generation;
    private Runnable workDeadline;
    StellarMotionPanel(Context context,EditText backend,Consumer<Boolean> pick,Consumer<byte[]> save) {
        super(context);this.backend=backend;setOrientation(VERTICAL);
        Button toggle=button(R.string.stellar_title,"stellar-toggle");addView(toggle);
        LinearLayout body=new LinearLayout(context);body.setOrientation(VERTICAL);body.setVisibility(GONE);addView(body);
        body.addView(label(getResources().getString(R.string.stellar_intro)));
        Button manifestButton=button(R.string.stellar_manifest,"stellar-manifest"),rowsButton=button(R.string.stellar_rows,"stellar-rows");body.addView(manifestButton);body.addView(rowsButton);
        manifestButton.setOnClickListener(v->pick.accept(true));rowsButton.setOnClickListener(v->pick.accept(false));
        files=label("");body.addView(files);
        id=field(body,R.string.stellar_id,"65212004581252736","stellar-id");
        stationMode=new CheckBox(context);stationMode.setText(R.string.stellar_station_mode);stationMode.setTextColor(Color.WHITE);stationMode.setTag("stellar-station-mode");body.addView(stationMode);
        LinearLayout catalogFields=new LinearLayout(context);catalogFields.setOrientation(VERTICAL);body.addView(catalogFields);
        epoch=field(catalogFields,R.string.stellar_epoch,"2026","stellar-epoch");
        LinearLayout stationFields=new LinearLayout(context);stationFields.setOrientation(VERTICAL);stationFields.setVisibility(GONE);body.addView(stationFields);
        stationFields.addView(label(getResources().getString(R.string.stellar_station_intro)));
        utc=field(stationFields,R.string.stellar_utc,"","stellar-utc");longitude=field(stationFields,R.string.stellar_longitude,"","stellar-longitude");
        latitude=field(stationFields,R.string.stellar_latitude,"","stellar-latitude");height=field(stationFields,R.string.stellar_height,"","stellar-height");
        refraction=new CheckBox(context);refraction.setText(R.string.stellar_refraction);refraction.setTextColor(Color.WHITE);refraction.setTag("stellar-refraction");stationFields.addView(refraction);
        LinearLayout weatherFields=new LinearLayout(context);weatherFields.setOrientation(VERTICAL);weatherFields.setVisibility(GONE);stationFields.addView(weatherFields);
        pressure=field(weatherFields,R.string.stellar_pressure,"","stellar-pressure");temperature=field(weatherFields,R.string.stellar_temperature,"","stellar-temperature");
        humidity=field(weatherFields,R.string.stellar_humidity,"","stellar-humidity");wavelength=field(weatherFields,R.string.stellar_wavelength,"","stellar-wavelength");
        adopt=new CheckBox(context);adopt.setText(R.string.stellar_rv);adopt.setTag("stellar-rv");adopt.setTextColor(Color.WHITE);body.addView(adopt);
        covariance=new CheckBox(context);covariance.setText(R.string.stellar_covariance);covariance.setTag("stellar-covariance");covariance.setTextColor(Color.WHITE);body.addView(covariance);
        load=button(R.string.stellar_load,"stellar-load");cancel=button(R.string.stellar_cancel,"stellar-cancel");export=button(R.string.stellar_export,"stellar-export");body.addView(load);body.addView(cancel);
        status=label("");status.setTag("stellar-status");status.setAccessibilityLiveRegion(ACCESSIBILITY_LIVE_REGION_POLITE);body.addView(status);
        result=label("");result.setTag("stellar-result");result.setTextIsSelectable(true);body.addView(result);body.addView(export);
        load.setOnClickListener(v->calculate());cancel.setOnClickListener(v->clear());export.setOnClickListener(v->{if(displayedObserver!=null)save.accept(displayedObserver.exportBytes());else if(displayed!=null)save.accept(displayed.exportBytes());});
        toggle.setOnClickListener(v->{boolean opening=body.getVisibility()!=VISIBLE;if(!opening)clear();body.setVisibility(opening?VISIBLE:GONE);});
        TextWatcher edited=new TextWatcher(){public void beforeTextChanged(CharSequence s,int at,int count,int after){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int at,int before,int count){clear();}};
        for(EditText field:new EditText[]{backend,id,epoch,utc,longitude,latitude,height,pressure,temperature,humidity,wavelength})field.addTextChangedListener(edited);
        stationMode.setOnCheckedChangeListener((v,value)->{clear();catalogFields.setVisibility(value?GONE:VISIBLE);stationFields.setVisibility(value?VISIBLE:GONE);covariance.setVisibility(value?GONE:VISIBLE);});
        refraction.setOnCheckedChangeListener((v,value)->{clear();weatherFields.setVisibility(value?VISIBLE:GONE);});
        adopt.setOnCheckedChangeListener((v,value)->clear());covariance.setOnCheckedChangeListener((v,value)->clear());clear();
    }
    void importSource(Uri uri,boolean isManifest) {
        clear();if(isManifest)manifest=null;else rows=null;showFiles();final int token=generation;
        final long resultToken=results.reset();
        CancellationSignal cancellation=new CancellationSignal();sourceCancellation=cancellation;busy();
        workDeadline=()->{if(token==generation){clear();status.setText(R.string.stellar_timeout);}};main.postDelayed(workDeadline,25000);
        try { importWork=StellarSourceImport.submit(()->{
            try(AssetFileDescriptor descriptor=getContext().getContentResolver().openAssetFileDescriptor(uri,"r",cancellation)) {
                if(descriptor==null)throw new IOException("Source file unavailable");int limit=isManifest?1024*1024:16*1024*1024;
                if(descriptor.getLength()>limit)throw new IOException("Original source exceeds byte budget");
                byte[] bytes=StellarSourceImport.read(descriptor.createInputStream(),limit,cancellation::isCanceled);
                results.offer(resultToken,()->{if(token!=generation)return;if(isManifest)manifest=bytes;else rows=bytes;finish();showFiles();status.setText(R.string.stellar_idle);});
            }catch(Exception error){results.offer(resultToken,()->{if(token!=generation)return;finish();status.setText(error.getMessage());});}
        }); } catch(RejectedExecutionException error) { finish();status.setText(R.string.stellar_import_busy); }
    }
    private void calculate() {
        clear();final int token=generation;final StellarMotionService current;
        final java.util.concurrent.Callable<StellarMotionRequest> requestFactory;
        final java.util.concurrent.Callable<StellarObserverRequest> observerFactory;
        // Imported arrays are private and replaced, never mutated in place.
        // Capture references now; the request makes its defensive copies only
        // after the serial worker has drained its predecessor.
        final byte[] sourceManifest=manifest,sourceRows=rows;
        final long resultToken=results.reset();
        try{
            String source=id.getText().toString().trim(),policy=adopt.isChecked()?StellarMotionRequest.RV_POLICY:"";
            if(stationMode.isChecked()) {
                StellarObserverRequest.Atmosphere atmosphere=refraction.isChecked()?new StellarObserverRequest.Atmosphere(numeric(pressure),numeric(temperature),numeric(humidity),numeric(wavelength)):null;
                final String requestedUtc=utc.getText().toString().trim();
                final double requestedLongitude=numeric(longitude),requestedLatitude=numeric(latitude),requestedHeight=numeric(height);
                observerFactory=()->new StellarObserverRequest(sourceManifest,sourceRows,source,policy,requestedUtc,requestedLongitude,requestedLatitude,requestedHeight,atmosphere);requestFactory=null;
            } else {
                final double requestedEpoch=numeric(epoch);
                final String covariancePolicy=covariance.isChecked()?StellarMotionRequest.COVARIANCE_POLICY:null;
                requestFactory=()->new StellarMotionRequest(sourceManifest,sourceRows,source,requestedEpoch,policy,covariancePolicy);observerFactory=null;
            }
            current=new StellarMotionService(backend.getText().toString());
        }
        catch(Exception error){status.setText(error.getMessage());return;}
        final long deadline=SystemClock.elapsedRealtime()+25000;
        service=current;busy();
        workDeadline=()->{if(token==generation){clear();status.setText(R.string.scientific_calculation_timeout);}};
        main.postDelayed(workDeadline,25000);
        calculationWork.start(()->{try{
            if(Thread.currentThread().isInterrupted()||SystemClock.elapsedRealtime()>=deadline)throw new java.util.concurrent.CancellationException();
            if(observerFactory!=null){StellarObserverRequest request=observerFactory.call();StellarObserverReport report=current.loadObserver(request);results.offer(resultToken,()->{if(finishCalculation(token,deadline))showObserver(report);});}
            else {StellarMotionRequest request=requestFactory.call();StellarMotionReport report=current.load(request);results.offer(resultToken,()->{if(finishCalculation(token,deadline))show(report);});}
        }catch(Exception error){results.offer(resultToken,()->{if(finishCalculation(token,deadline))status.setText(error.getMessage());});}finally{current.close();}},"solar-stellar-analysis");
    }
    private boolean finishCalculation(int token,long deadline){
        if(token!=generation)return false;
        if(SystemClock.elapsedRealtime()>=deadline){clear();status.setText(R.string.scientific_calculation_timeout);return false;}
        finish();return true;
    }
    private double numeric(EditText field) throws IOException {
        String value=field.getText().toString().trim();
        try {double result=Double.parseDouble(value);if(Double.isFinite(result))return result;}catch(NumberFormatException ignored){}
        throw new IOException(getResources().getString(R.string.stellar_number_required)+": "+field.getContentDescription());
    }
    private void showObserver(StellarObserverReport report) {
        displayedObserver=report;status.setText("Gaia DR3 "+report.sourceId+" · "+report.utc);export.setVisibility(VISIBLE);
        StringBuilder text=new StringBuilder(getResources().getString(R.string.stellar_airless)).append('\n');
        text.append(String.format(Locale.ROOT,"Az / Alt (deg): %.12g / %.12g\nCIRS RA / Dec (deg): %.12g / %.12g\n",report.azimuthDeg,report.altitudeDeg,report.cirsRaDeg,report.cirsDecDeg));
        if(report.refractionStatus.equals("applied")){double[] d=report.refractedDirection();text.append(getResources().getString(R.string.stellar_refracted)).append(String.format(Locale.ROOT,"\nAz / Alt (deg): %.12g / %.12g\n",d[0],d[1]));}
        else if(report.refractionStatus.equals("outside-altitude-domain"))text.append(getResources().getString(R.string.stellar_refraction_low)).append('\n');
        if(report.solarDeflectionLimited)text.append(getResources().getString(R.string.stellar_solar_limited)).append('\n');
        text.append('\n').append(getResources().getString(R.string.stellar_coordinate)).append(String.format(Locale.ROOT,"\nRA / Dec (deg): %.12g / %.12g\n",report.raDeg,report.decDeg));
        text.append("BCRS: ").append(java.util.Arrays.toString(report.coordinateDirection())).append("\nTDB JD parts: ").append(java.util.Arrays.toString(report.epochTdbParts())).append('\n');
        text.append(getResources().getString(R.string.stellar_solar_elongation)).append(": ").append(String.format(Locale.ROOT,"%.10g",report.solarElongationDeg)).append('\n');
        text.append("Catalog: ").append(report.catalogVersion).append("\nCatalog SHA-256: ").append(report.catalogManifestSha256).append("\nIERS SHA-256: ").append(report.earthOrientationSha256).append('\n');
        text.append(getResources().getString(R.string.stellar_station_limits));
        for(String note:report.notes())text.append("\n").append(note);
        result.setText(text.toString());
    }
    String exportFileName(){return displayedObserver==null?"solar-stellar-motion.json":"solar-stellar-observer.json";}
    private void show(StellarMotionReport report) {
        displayed=report;status.setText("Gaia DR3 "+report.sourceId+" · J"+report.epoch+" TCB");export.setVisibility(VISIBLE);
        String[] labels={"RA (deg)","Dec (deg)","Parallax (mas)","pmra (mas/yr)","pmdec (mas/yr)","RV (km/s)"};double[] state=report.state();StringBuilder text=new StringBuilder();
        for(int i=0;i<6;i++)text.append(labels[i]).append(": ").append(String.format(Locale.ROOT,"%.12g",state[i])).append('\n');
        double[] sigma=report.formalStandardDeviations();if(sigma!=null){text.append('\n').append(getResources().getString(R.string.stellar_sigmas)).append('\n');String[] units={"delta-alpha*cos(delta) (mas)","delta-dec (mas)","parallax (mas)","pmra (mas/yr)","pmdec (mas/yr)","RV (km/s)"};for(int i=0;i<6;i++)text.append(units[i]).append(": ").append(String.format(Locale.ROOT,"%.6g",sigma[i])).append('\n');}
        text.append('\n').append(getResources().getString(R.string.stellar_limits));result.setText(text.toString());
    }
    void clear(){generation++;results.reset();calculationWork.cancel();if(importWork!=null)importWork.cancel(true);if(sourceCancellation!=null)sourceCancellation.cancel();if(service!=null)service.close();finish();displayed=null;displayedObserver=null;result.setText("");export.setVisibility(GONE);status.setText(R.string.stellar_idle);}
    private void finish(){if(workDeadline!=null)main.removeCallbacks(workDeadline);workDeadline=null;importWork=null;sourceCancellation=null;service=null;load.setEnabled(manifest!=null&&rows!=null&&adopt.isChecked());cancel.setVisibility(GONE);}
    private void busy(){load.setEnabled(false);cancel.setVisibility(VISIBLE);status.setText(R.string.stellar_loading);}
    private void showFiles(){files.setText("manifest.json: "+(manifest==null?"—":manifest.length+" B")+"\nrows.csv: "+(rows==null?"—":rows.length+" B"));}
    void exportStatus(boolean success){status.setText(success?R.string.stellar_exported:R.string.stellar_export_failed);}
    private Button button(int resource,String tag){Button button=new Button(getContext());button.setText(resource);button.setTag(tag);return button;}
    private TextView label(String text){TextView view=new TextView(getContext());view.setText(text);view.setTextColor(Color.rgb(220,230,235));view.setTextSize(14);return view;}
    private EditText field(LinearLayout body,int resource,String value,String tag){String name=getResources().getString(resource);body.addView(label(name));EditText field=new EditText(getContext());field.setContentDescription(name);field.setTextColor(Color.WHITE);field.setSingleLine(true);field.setText(value);field.setTag(tag);body.addView(field);return field;}
    @Override protected void onDetachedFromWindow(){clear();super.onDetachedFromWindow();}
}
