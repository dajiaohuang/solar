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
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Consumer;

/** Source-bound coordinate conversion and conditional time propagation. */
final class OrbitCovariancePanel extends LinearLayout {
    private final EditText backend,gm,gmSource;
    private final EditText sourceEpoch,duration,pressure,area,mass,reflectivity,radiationSource,sourceOffsets;
    private final EditText eventStart,eventEnd,eventTarget,eventDistance,eventStep,eventTolerance,eventEvaluations,eventLimit;
    private final EditText[] exclusions=new EditText[11];
    private final CheckBox propagate,adopt,relativity,radiation,refinement,ensemble,eventMode;
    private final Button load,cancel,export;
    private final TextView files,status,result;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final NativeUiResultSlot results=new NativeUiResultSlot();
    private final NativeProjectionPrefetch calculationWork=new NativeProjectionPrefetch();
    private byte[] source;
    private OrbitCovarianceReport displayed;
    private OrbitPropagationReport displayedPropagation;
    private OrbitEnsembleReport displayedEnsemble;
    private OrbitEventReport displayedEvents;
    private final LinearLayout eventResults;
    private final TextView eventDetail;
    private final Button previousDraw,nextDraw;
    private int selectedDraw;
    private StellarMotionService service;
    private Future<?> importWork;
    private CancellationSignal sourceCancellation;
    private Runnable workDeadline;
    private int generation;
    OrbitCovariancePanel(Context context,EditText backend,Runnable pick,Consumer<byte[]> save){
        super(context);this.backend=backend;setOrientation(VERTICAL);
        Button toggle=button(R.string.orbit_covariance_title,"orbit-covariance-toggle");addView(toggle);
        LinearLayout body=new LinearLayout(context);body.setOrientation(VERTICAL);body.setVisibility(GONE);addView(body);
        Button choose=button(R.string.orbit_covariance_import,"orbit-covariance-import");choose.setOnClickListener(v->pick.run());body.addView(choose);
        files=label("");files.setTag("orbit-covariance-file");body.addView(files);
        propagate=check(body,R.string.orbit_propagation_mode,"orbit-propagation-mode");
        LinearLayout conversionFields=group(body);conversionFields.addView(label(getResources().getString(R.string.orbit_covariance_intro)));
        gm=field(conversionFields,R.string.orbit_covariance_gm,"orbit-covariance-gm");gmSource=field(conversionFields,R.string.orbit_covariance_gm_source,"orbit-covariance-gm-source");
        LinearLayout propagationFields=group(body);propagationFields.setVisibility(GONE);
        propagationFields.addView(label(getResources().getString(R.string.orbit_propagation_intro)));
        sourceEpoch=field(propagationFields,R.string.orbit_propagation_epoch,"orbit-propagation-epoch");duration=field(propagationFields,R.string.orbit_propagation_duration,"orbit-propagation-duration");
        adopt=check(propagationFields,R.string.orbit_propagation_adopt,"orbit-propagation-adopt");relativity=check(propagationFields,R.string.orbit_propagation_relativity,"orbit-propagation-relativity");
        ensemble=check(propagationFields,R.string.orbit_ensemble_mode,"orbit-ensemble-mode");
        LinearLayout ensembleFields=group(propagationFields);ensembleFields.setVisibility(GONE);
        ensembleFields.addView(label(getResources().getString(R.string.orbit_ensemble_intro)));
        sourceOffsets=field(ensembleFields,R.string.orbit_ensemble_offsets,"orbit-ensemble-offsets");
        sourceOffsets.setSingleLine(false);sourceOffsets.setMinLines(3);sourceOffsets.setMaxLines(8);
        eventMode=check(ensembleFields,R.string.orbit_event_mode,"orbit-event-mode");
        LinearLayout eventFields=group(ensembleFields);eventFields.setVisibility(GONE);
        eventFields.addView(label(getResources().getString(R.string.orbit_event_intro)));
        eventStart=field(eventFields,R.string.orbit_event_start,"orbit-event-start");eventEnd=field(eventFields,R.string.orbit_event_end,"orbit-event-end");
        eventTarget=field(eventFields,R.string.orbit_event_target,"orbit-event-target");eventDistance=field(eventFields,R.string.orbit_event_distance,"orbit-event-distance");
        eventStep=field(eventFields,R.string.orbit_event_step,"orbit-event-step");eventTolerance=field(eventFields,R.string.orbit_event_tolerance,"orbit-event-tolerance");
        eventEvaluations=field(eventFields,R.string.orbit_event_evaluations,"orbit-event-evaluations");eventLimit=field(eventFields,R.string.orbit_event_limit,"orbit-event-limit");
        LinearLayout refinementFields=group(propagationFields);
        refinement=check(refinementFields,R.string.orbit_propagation_refinement,"orbit-propagation-refinement");
        refinementFields.addView(label(getResources().getString(R.string.orbit_propagation_refinement_limits)));
        propagationFields.addView(label(getResources().getString(R.string.orbit_propagation_exclusions)));
        for(int i=0;i<exclusions.length;i++){int id=OrbitPropagationRequest.FORCE_IDS[i];String name=getResources().getString(R.string.orbit_propagation_exclusion,id);exclusions[i]=field(propagationFields,name,"orbit-propagation-exclusion-"+id);}
        radiation=check(propagationFields,R.string.orbit_propagation_radiation,"orbit-propagation-radiation");
        LinearLayout radiationFields=group(propagationFields);radiationFields.setVisibility(GONE);radiationFields.addView(label(getResources().getString(R.string.orbit_propagation_radiation_limits)));
        pressure=field(radiationFields,R.string.orbit_propagation_pressure,"orbit-propagation-pressure");area=field(radiationFields,R.string.orbit_propagation_area,"orbit-propagation-area");mass=field(radiationFields,R.string.orbit_propagation_mass,"orbit-propagation-mass");reflectivity=field(radiationFields,R.string.orbit_propagation_reflectivity,"orbit-propagation-reflectivity");radiationSource=field(radiationFields,R.string.orbit_propagation_source,"orbit-propagation-source");
        load=button(R.string.orbit_covariance_convert,"orbit-covariance-load");cancel=button(R.string.stellar_cancel,"orbit-covariance-cancel");export=button(R.string.stellar_export,"orbit-covariance-export");
        body.addView(load);body.addView(cancel);
        status=label("");status.setTag("orbit-covariance-status");status.setAccessibilityLiveRegion(ACCESSIBILITY_LIVE_REGION_POLITE);body.addView(status);
        result=label("");result.setTag("orbit-covariance-result");result.setTextIsSelectable(true);body.addView(result);body.addView(export);
        eventResults=group(body);eventResults.setVisibility(GONE);
        previousDraw=button(R.string.orbit_event_previous,"orbit-event-previous");nextDraw=button(R.string.orbit_event_next,"orbit-event-next");
        eventResults.addView(previousDraw);eventResults.addView(nextDraw);
        eventDetail=label("");eventDetail.setTag("orbit-event-detail");eventDetail.setTextIsSelectable(true);eventDetail.setAccessibilityLiveRegion(ACCESSIBILITY_LIVE_REGION_POLITE);eventResults.addView(eventDetail);
        previousDraw.setOnClickListener(v->{if(displayedEvents!=null && selectedDraw>0){selectedDraw--;showEventDraw();}});
        nextDraw.setOnClickListener(v->{if(displayedEvents!=null && selectedDraw+1<displayedEvents.count){selectedDraw++;showEventDraw();}});
        load.setOnClickListener(v->calculate());cancel.setOnClickListener(v->clear());export.setOnClickListener(v->{if(displayedEvents!=null)save.accept(displayedEvents.exportBytes());else if(displayedEnsemble!=null)save.accept(displayedEnsemble.exportBytes());else if(displayedPropagation!=null)save.accept(displayedPropagation.exportBytes());else if(displayed!=null)save.accept(displayed.exportBytes());});
        toggle.setOnClickListener(v->{boolean opening=body.getVisibility()!=VISIBLE;if(!opening)clear();body.setVisibility(opening?VISIBLE:GONE);});
        TextWatcher changed=new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int after){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int a,int before,int c){clear();}};
        for(EditText field:new EditText[]{backend,gm,gmSource,sourceEpoch,duration,pressure,area,mass,reflectivity,radiationSource,sourceOffsets})field.addTextChangedListener(changed);
        for(EditText field:exclusions)field.addTextChangedListener(changed);
        for(EditText field:new EditText[]{eventStart,eventEnd,eventTarget,eventDistance,eventStep,eventTolerance,eventEvaluations,eventLimit})field.addTextChangedListener(changed);
        Runnable modes=()->{boolean events=ensemble.isChecked()&&eventMode.isChecked();duration.setEnabled(!events);radiation.setEnabled(!events);radiationFields.setVisibility(!events&&radiation.isChecked()?VISIBLE:GONE);load.setText(!propagate.isChecked()?R.string.orbit_covariance_convert:events?R.string.orbit_event_run:ensemble.isChecked()?R.string.orbit_ensemble_run:R.string.orbit_propagation_run);};
        propagate.setOnCheckedChangeListener((v,value)->{clear();conversionFields.setVisibility(value?GONE:VISIBLE);propagationFields.setVisibility(value?VISIBLE:GONE);modes.run();});
        radiation.setOnCheckedChangeListener((v,value)->{clear();radiationFields.setVisibility(value?VISIBLE:GONE);});adopt.setOnCheckedChangeListener((v,value)->clear());relativity.setOnCheckedChangeListener((v,value)->clear());
        ensemble.setOnCheckedChangeListener((v,value)->{clear();ensembleFields.setVisibility(value?VISIBLE:GONE);refinementFields.setVisibility(value?GONE:VISIBLE);modes.run();});
        eventMode.setOnCheckedChangeListener((v,value)->{clear();eventFields.setVisibility(value?VISIBLE:GONE);modes.run();});
        refinement.setOnCheckedChangeListener((v,value)->clear());
        clear();showFile();
    }
    void importSource(Uri uri){
        clear();source=null;showFile();final int token=generation;
        final long resultToken=results.reset();
        final long deadline=SystemClock.elapsedRealtime()+25000;
        CancellationSignal cancellation=new CancellationSignal();sourceCancellation=cancellation;busy();
        workDeadline=()->{if(token==generation){clear();status.setText(R.string.stellar_timeout);}};main.postDelayed(workDeadline,25000);
        try{importWork=StellarSourceImport.submit(()->{
            try(AssetFileDescriptor descriptor=getContext().getContentResolver().openAssetFileDescriptor(uri,"r",cancellation)){
                if(descriptor==null)throw new IOException("Source file unavailable");
                if(descriptor.getLength()>OrbitCovarianceRequest.MAX_SOURCE_BYTES)throw new IOException("SBDB source exceeds 2 MiB");
                byte[] bytes=StellarSourceImport.read(descriptor.createInputStream(),OrbitCovarianceRequest.MAX_SOURCE_BYTES,cancellation::isCanceled);
                results.offer(resultToken,()->{
                    if(token!=generation)return;
                    if(SystemClock.elapsedRealtime()>=deadline){clear();status.setText(R.string.stellar_timeout);return;}
                    source=bytes;finish();showFile();status.setText(R.string.stellar_idle);
                });
            }catch(Exception error){results.offer(resultToken,()->{if(token!=generation)return;finish();status.setText(error.getMessage());});}
        });}catch(RejectedExecutionException error){finish();status.setText(R.string.stellar_import_busy);}
    }
    private interface Analysis { Runnable run(StellarMotionService service) throws Exception; }
    private void calculate(){
        clear();final int token=generation;final StellarMotionService current;final Analysis analysis;
        // Source import replaces this private array; it never mutates it.
        final byte[] original=source;
        final long resultToken=results.reset();
        try{
            if(propagate.isChecked()){
                Map<Integer,Double> distances=new HashMap<>();for(int i=0;i<exclusions.length;i++)distances.put(OrbitPropagationRequest.FORCE_IDS[i],numeric(exclusions[i]));
                boolean events=ensemble.isChecked()&&eventMode.isChecked();
                OrbitRadiationPressure srp=!events&&radiation.isChecked()?new OrbitRadiationPressure(numeric(pressure),numeric(area),numeric(mass),numeric(reflectivity),radiationSource.getText().toString()):null;
                final double epoch=numeric(sourceEpoch);
                final boolean adopted=adopt.isChecked(),relativistic=relativity.isChecked();
                if(events){
                    final double start=numeric(eventStart),end=numeric(eventEnd),distance=numeric(eventDistance),step=numeric(eventStep),tolerance=numeric(eventTolerance);
                    final int target=whole(eventTarget),evaluations=whole(eventEvaluations),limit=whole(eventLimit);
                    final double[] draws=offsets();
                    analysis=service->{
                        OrbitEventRequest request=new OrbitEventRequest(original,epoch,start,end,adopted,distances,relativistic,draws,target,distance,step,tolerance,evaluations,limit);
                        OrbitEventReport report=service.loadEvents(request);
                        return ()->showEvents(report,request);
                    };
                }else if(ensemble.isChecked()){
                    final double elapsed=numeric(duration);final double[] draws=offsets();
                    analysis=service->{
                        OrbitEnsembleRequest request=new OrbitEnsembleRequest(original,epoch,elapsed,adopted,distances,relativistic,srp,draws);
                        OrbitEnsembleReport report=service.loadEnsemble(request);
                        return ()->showEnsemble(report,request);
                    };
                }else{
                    final double elapsed=numeric(duration);final boolean refine=refinement.isChecked();
                    analysis=service->{
                        OrbitPropagationRequest request=new OrbitPropagationRequest(original,epoch,elapsed,adopted,distances,relativistic,srp,refine);
                        OrbitPropagationReport report=service.loadPropagation(request);
                        return ()->showPropagation(report);
                    };
                }
            }else{
                final double adoptedGM=numeric(gm);final String adoptedGMSource=gmSource.getText().toString();
                analysis=service->{
                    OrbitCovarianceReport report=service.loadCovariance(new OrbitCovarianceRequest(original,adoptedGM,adoptedGMSource));
                    return ()->show(report);
                };
            }
            current=new StellarMotionService(backend.getText().toString());
        }
        catch(Exception error){status.setText(error instanceof NumberFormatException?getResources().getString(R.string.stellar_number_required):error.getMessage());return;}
        final long deadline=SystemClock.elapsedRealtime()+25000;
        service=current;busy();
        workDeadline=()->{if(token==generation){clear();status.setText(R.string.scientific_calculation_timeout);}};
        main.postDelayed(workDeadline,25000);
        calculationWork.start(()->{
            try{
                if(Thread.currentThread().isInterrupted()||SystemClock.elapsedRealtime()>=deadline)throw new java.util.concurrent.CancellationException();
                Runnable publication=analysis.run(current);
                results.offer(resultToken,()->{if(finishCalculation(token,deadline))publication.run();});
            }
            catch(Exception error){results.offer(resultToken,()->{if(finishCalculation(token,deadline))status.setText(error.getMessage());});}
            finally{current.close();}
        },"solar-orbit-covariance");
    }
    private boolean finishCalculation(int token,long deadline){
        if(token!=generation)return false;
        if(SystemClock.elapsedRealtime()>=deadline){clear();status.setText(R.string.scientific_calculation_timeout);return false;}
        finish();return true;
    }
    private void show(OrbitCovarianceReport report){
        displayed=report;status.setText(report.designation+" · "+report.solutionId);export.setVisibility(VISIBLE);
        StringBuilder text=new StringBuilder("JD TDB: ").append(report.epochTdb).append("\n").append(report.model).append("\n").append(report.conicClass).append("\n");
        String[] labels=report.labels(),units=report.units();double[] nominal=report.nominal(),sigmas=report.marginalSigmas();
        text.append('\n').append(getResources().getString(R.string.orbit_covariance_values)).append('\n');
        for(int i=0;i<labels.length;i++)text.append(labels[i]).append(" [").append(units[i]==null?getResources().getString(R.string.orbit_covariance_unit_unspecified):units[i]).append("]: ").append(String.format(Locale.ROOT,"%.12g · σ %.6g",nominal[i],sigmas[i])).append('\n');
        text.append("\nGM (au³/d²): ").append(report.gmAU3PerDay2).append('\n').append(report.gmSource).append("\nSHA-256: ").append(report.sourceSha256).append("\n\n").append(getResources().getString(R.string.orbit_covariance_limits));
        for(String limitation:report.limitations())text.append('\n').append(limitation);
        result.setText(text.toString());
    }
    private void showPropagation(OrbitPropagationReport report){
        displayedPropagation=report;status.setText(report.designation+" · "+report.solutionId);export.setVisibility(VISIBLE);
        StringBuilder text=new StringBuilder(getResources().getString(R.string.orbit_propagation_final)).append('\n').append(getResources().getString(R.string.orbit_propagation_epoch_result,Double.toString(report.referenceEpochTdb),Double.toString(report.durationSeconds))).append('\n').append(report.model).append('\n');
        text.append(getResources().getString(R.string.orbit_fit_force_comparison,report.sourcePlanetaryEphemeris==null?"—":report.sourcePlanetaryEphemeris,report.sourceSmallBodyEphemeris==null?"—":report.sourceSmallBodyEphemeris,report.integrationKernel)).append('\n');
        String[] labels={"x [au]","y [au]","z [au]","vx [au/d]","vy [au/d]","vz [au/d]"};double[] nominal=report.nominal(),sigmas=report.marginalSigmas();
        for(int i=0;i<6;i++)text.append(labels[i]).append(": ").append(String.format(Locale.ROOT,"%.12g · σ %.6g",nominal[i],sigmas[i])).append('\n');
        text.append(getResources().getString(R.string.orbit_propagation_counts,report.accepted,report.rejected,report.evaluations));
        text.append('\n').append(getResources().getString(R.string.orbit_propagation_steps,report.smallestAcceptedStep==null?getResources().getString(R.string.orbit_propagation_no_steps):Double.toString(report.smallestAcceptedStep),Double.toString(report.largestAcceptedStep)));
        text.append('\n').append(getResources().getString(R.string.orbit_propagation_error_ratio,Double.toString(report.maxAcceptedErrorRatio),Double.toString(report.relativeTolerance)));
        text.append('\n').append(getResources().getString(R.string.orbit_propagation_numerical_limits));
        text.append("\nSBDB SHA-256: ").append(report.sourceSha256).append("\n\n").append(getResources().getString(R.string.orbit_force_sources)).append('\n');
        for(String line:report.forceEvidence())text.append(line).append('\n');
        text.append('\n').append(getResources().getString(R.string.orbit_propagation_limits));
        for(String limitation:report.limitations())text.append('\n').append(limitation);
        if(report.refinement!=null){
            OrbitPropagationReport.Refinement comparison=report.refinement;
            double[] refinedState=comparison.nominal(),refinedSigmas=comparison.marginalSigmas(),differences=comparison.marginalSigmaAbsoluteDifference();
            text.append("\n\n").append(getResources().getString(R.string.orbit_propagation_refinement_result)).append('\n');
            for(int i=0;i<6;i++)text.append(labels[i]).append(": ").append(String.format(Locale.ROOT,"%.12g · σ %.6g · |Δσ| %.6g",refinedState[i],refinedSigmas[i],differences[i])).append('\n');
            text.append(getResources().getString(R.string.orbit_propagation_counts,comparison.accepted,comparison.rejected,comparison.evaluations));
            text.append('\n').append(getResources().getString(R.string.orbit_propagation_error_ratio,Double.toString(comparison.maxAcceptedErrorRatio),Double.toString(comparison.relativeTolerance)));
            text.append('\n').append(getResources().getString(R.string.orbit_propagation_refinement_limits)).append('\n').append(comparison.limitation);
        }
        result.setText(text.toString());
    }
    private double[] offsets() throws IOException {
        if(sourceOffsets.length()>32768)throw new IOException(getResources().getString(R.string.orbit_ensemble_invalid_offsets));
        String input=sourceOffsets.getText().toString().trim();
        if(input.length()>32768)throw new IOException(getResources().getString(R.string.orbit_ensemble_invalid_offsets));
        java.util.List<?> values=OrbitPropagationReport.list(StateTileDecoder.parseJson(input.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        if(values.size()<6 || values.size()>768 || values.size()%6!=0)throw new IOException(getResources().getString(R.string.orbit_ensemble_invalid_offsets));
        double[] offsets=new double[values.size()];for(int i=0;i<offsets.length;i++)offsets[i]=OrbitPropagationReport.number(values.get(i));return offsets;
    }
    private void showEnsemble(OrbitEnsembleReport report,OrbitEnsembleRequest request){
        displayedEnsemble=report;status.setText(report.designation+" · "+report.solutionId);export.setVisibility(VISIBLE);
        StringBuilder text=new StringBuilder(getResources().getString(R.string.orbit_propagation_epoch_result,Double.toString(request.propagation.referenceEpochTdb),Double.toString(request.propagation.durationSeconds)));
        text.append('\n').append(getResources().getString(R.string.orbit_ensemble_counts,report.count,report.failedCount,report.forceEvaluations));
        String[] axes={"x [au]","y [au]","z [au]","vx [au/d]","vy [au/d]","vz [au/d]"};
        if("available".equals(report.momentsStatus)){
            text.append("\n\n").append(getResources().getString(R.string.orbit_ensemble_moments)).append('\n');
            double[] mean=report.mean(),sigma=report.standardDeviations();
            for(int i=0;i<6;i++)text.append(axes[i]).append(": ").append(String.format(Locale.ROOT,"%.12g · σ %.6g",mean[i],sigma[i])).append('\n');
            text.append(getResources().getString(R.string.orbit_ensemble_covariance,report.count-1)).append('\n');
            double[][] covariance=report.covariance();
            for(int i=0;i<6;i++)for(int j=0;j<6;j++)text.append(axes[i]).append(" × ").append(axes[j]).append(": ").append(Double.toString(covariance[i][j])).append('\n');
        }else text.append('\n').append(getResources().getString(report.failedCount>0?R.string.orbit_ensemble_failed_moments:R.string.orbit_ensemble_insufficient_moments));
        for(int index=0;index<report.count;index++){
            text.append("\n").append(getResources().getString(R.string.orbit_ensemble_draw,index)).append('\n');double[] state=report.state(index);
            text.append(getResources().getString(R.string.orbit_ensemble_draw_evaluations,report.forceEvaluations(index))).append('\n');
            if(state==null)text.append(report.failure(index)).append('\n');
            else for(int i=0;i<6;i++)text.append(axes[i]).append(": ").append(Double.toString(state[i])).append('\n');
        }
        text.append("\nSBDB SHA-256: ").append(report.sourceSha256).append("\n\n").append(getResources().getString(R.string.orbit_force_sources)).append('\n');
        for(String line:report.forceEvidence())text.append(line).append('\n');
        text.append('\n').append(getResources().getString(R.string.orbit_ensemble_limits));
        result.setText(text.toString());
    }
    private double numeric(EditText field) throws IOException {try{double value=Double.parseDouble(field.getText().toString().trim());if(Double.isFinite(value))return value;}catch(NumberFormatException ignored){}throw new IOException(getResources().getString(R.string.stellar_number_required)+": "+field.getContentDescription());}
    private int whole(EditText field) throws IOException {double value=numeric(field);if(value<0 || value>Integer.MAX_VALUE || value!=Math.floor(value))throw new IOException(getResources().getString(R.string.orbit_event_integer)+": "+field.getContentDescription());return (int)value;}
    private void showEvents(OrbitEventReport report,OrbitEventRequest request){
        displayedEvents=report;selectedDraw=0;status.setText(report.designation+" · "+report.solutionId);export.setVisibility(VISIBLE);
        StringBuilder text=new StringBuilder(getResources().getString(R.string.orbit_event_counts,report.count,report.searched,report.failed,report.unresolved,report.forceEvaluations));
        text.append('\n').append(getResources().getString(R.string.orbit_event_window,Double.toString(request.force.referenceEpochTdb),Double.toString(request.startSeconds),Double.toString(request.endSeconds)));
        text.append('\n').append(getResources().getString(R.string.orbit_event_definition,request.targetNaifId,Double.toString(request.distanceKm)));
        text.append("\nSBDB SHA-256: ").append(report.sourceSha256);
        for(String line:report.forceEvidence())text.append('\n').append(line);
        text.append("\n\n").append(getResources().getString(R.string.orbit_event_timing_intro));
        for(OrbitEventTiming summary:report.timing()){
            text.append("\n\n").append(getResources().getString("decreasing".equals(summary.direction)?R.string.orbit_event_timing_entry:R.string.orbit_event_timing_exit));
            text.append('\n').append(getResources().getString(R.string.orbit_event_timing_counts,summary.selected,summary.total,summary.failed,summary.unresolved,summary.notDetected,summary.ambiguousZero));
            if(summary.selected<2)text.append('\n').append(getResources().getString(R.string.orbit_event_timing_unavailable));
            for(OrbitEventTiming.Quantile quantile:summary.quantiles())text.append('\n').append(getResources().getString(R.string.orbit_event_timing_quantile,
                (int)Math.round(quantile.fraction*100),quantile.rank,Double.toString(quantile.elapsedTdbSeconds),Double.toString(quantile.lowerSeconds),Double.toString(quantile.upperSeconds)));
        }
        text.append("\n\n").append(getResources().getString(R.string.orbit_event_limits));result.setText(text.toString());eventResults.setVisibility(VISIBLE);showEventDraw();
    }
    private void showEventDraw(){
        OrbitEventReport report=displayedEvents;if(report==null)return;
        previousDraw.setEnabled(selectedDraw>0);nextDraw.setEnabled(selectedDraw+1<report.count);
        StringBuilder text=new StringBuilder(getResources().getString(R.string.orbit_ensemble_draw,selectedDraw)).append('\n').append(report.drawDetail(selectedDraw));
        OrbitEventReport.Event[] events=report.events(selectedDraw);
        for(int i=0;i<events.length;i++){
            OrbitEventReport.Event event=events[i];
            int kind="sampled-zero".equals(event.kind)?R.string.orbit_event_zero:"increasing".equals(event.direction)?R.string.orbit_event_exit:R.string.orbit_event_entry;
            text.append("\n\n").append(i+1).append(" · ").append(getResources().getString(kind));
            text.append('\n').append(getResources().getString(R.string.orbit_event_time,Double.toString(event.elapsedTdbSeconds),Double.toString(event.lowerSeconds),Double.toString(event.upperSeconds)));
        }
        eventDetail.setText(text.toString());
    }
    String exportFileName(){return displayedEvents!=null?"solar-orbit-events.json":displayedEnsemble!=null?"solar-orbit-ensemble.json":displayedPropagation==null?"solar-orbit-covariance.json":"solar-orbit-propagation.json";}
    void clear(){generation++;results.reset();calculationWork.cancel();if(importWork!=null)importWork.cancel(true);if(sourceCancellation!=null)sourceCancellation.cancel();if(service!=null)service.close();finish();displayed=null;displayedPropagation=null;displayedEnsemble=null;displayedEvents=null;selectedDraw=0;eventResults.setVisibility(GONE);eventDetail.setText("");result.setText("");export.setVisibility(GONE);status.setText(R.string.stellar_idle);}
    private void finish(){if(workDeadline!=null)main.removeCallbacks(workDeadline);workDeadline=null;importWork=null;sourceCancellation=null;service=null;load.setEnabled(source!=null&&(!propagate.isChecked()||adopt.isChecked()));cancel.setVisibility(GONE);}
    private void busy(){load.setEnabled(false);cancel.setVisibility(VISIBLE);status.setText(R.string.stellar_loading);}
    private void showFile(){files.setText("SBDB JSON: "+(source==null?"—":source.length+" B"));}
    void exportStatus(boolean success){status.setText(success?R.string.stellar_exported:R.string.stellar_export_failed);}
    private Button button(int resource,String tag){Button value=new Button(getContext());value.setText(resource);value.setTag(tag);return value;}
    private TextView label(String text){TextView value=new TextView(getContext());value.setText(text);value.setTextColor(Color.rgb(220,230,235));value.setTextSize(14);return value;}
    private EditText field(LinearLayout body,int resource,String tag){return field(body,getResources().getString(resource),tag);}
    private EditText field(LinearLayout body,String name,String tag){body.addView(label(name));EditText value=new EditText(getContext());value.setContentDescription(name);value.setTextColor(Color.WHITE);value.setSingleLine(true);value.setTag(tag);body.addView(value);return value;}
    private LinearLayout group(LinearLayout parent){LinearLayout value=new LinearLayout(getContext());value.setOrientation(VERTICAL);parent.addView(value);return value;}
    private CheckBox check(LinearLayout parent,int resource,String tag){CheckBox value=new CheckBox(getContext());value.setText(resource);value.setTextColor(Color.WHITE);value.setTag(tag);parent.addView(value);return value;}
    @Override protected void onDetachedFromWindow(){clear();super.onDetachedFromWindow();}
}
