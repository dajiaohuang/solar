package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import static io.github.dajiaohuang.solaratlas.OrbitPropagationReport.*;

/** Explicit supplied-offset event search; no implicit sampling or physical radius. */
public final class OrbitEventRequest {
    public final OrbitPropagationRequest force;
    public final double startSeconds,endSeconds,maxStepSeconds,toleranceSeconds,distanceKm;
    public final int targetNaifId,maxEvaluations,maxEvents,scanIntervals;
    private final double[] offsets;

    public OrbitEventRequest(byte[] original,double epoch,double start,double end,
            boolean adopt,Map<Integer,Double> exclusions,boolean relativity,double[] offsets,
            int target,double distance,double step,double tolerance,int evaluations,int events) throws IOException {
        require(Double.isFinite(start) && Double.isFinite(end) && start<=end &&
            Math.max(Math.abs(start),Math.abs(end))<=365*86400,"Ordered search window within 365 days required");
        require(Double.isFinite(distance) && distance>0 && Double.isFinite(step) && step>0 &&
            Double.isFinite(tolerance) && tolerance>0 && tolerance<=step && evaluations>=1 && evaluations<=2048 &&
            events>=1 && events<=128,"Positive threshold/step/tolerance and bounded event budgets required");
        double intervals=end==start?0:Math.max(1,Math.ceil((end-start)/step));
        require(intervals+1<=evaluations,"Event scan exceeds evaluation budget");
        boolean found=false;for(int id:OrbitPropagationRequest.FORCE_IDS)if(id==target)found=true;
        require(found,"Event target must be a pinned force body");
        require(offsets!=null && offsets.length>=6 && offsets.length<=768 && offsets.length%6==0,"Expected 1 to 128 six-axis source draws");
        this.offsets=offsets.clone();for(double value:this.offsets)require(Double.isFinite(value),"Finite source offsets required");
        // Reuse immutable source/model adoption, not endpoint propagation semantics.
        force=new OrbitPropagationRequest(original,epoch,0,adopt,exclusions,relativity);
        startSeconds=start;endSeconds=end;maxStepSeconds=step;toleranceSeconds=tolerance;
        targetNaifId=target;distanceKm=distance;maxEvaluations=evaluations;maxEvents=events;scanIntervals=(int)intervals;
    }
    public int count(){return offsets.length/6;}
    public double[] sourceOffsets(){return offsets.clone();}
    public byte[] bytes() throws IOException {
        check();byte[] original=force.originalBytes();OrbitCovarianceReport.preflightPropagation(original,force.referenceEpochTdb);
        StringBuilder json=new StringBuilder("{\"originalSbdbBase64\":\"").append(StellarMotionRequest.base64(original))
            .append("\",\"referenceEpochTdb\":").append(force.referenceEpochTdb)
            .append(",\"startSeconds\":").append(startSeconds).append(",\"endSeconds\":").append(endSeconds)
            .append(",\"maxStepSeconds\":").append(maxStepSeconds).append(",\"toleranceSeconds\":").append(toleranceSeconds)
            .append(",\"maxEvaluations\":").append(maxEvaluations).append(",\"maxEvents\":").append(maxEvents)
            .append(",\"targetNaifId\":").append(targetNaifId).append(",\"distanceKm\":").append(distanceKm)
            .append(",\"adoptRestrictedDE440\":true,\"solarRelativity\":").append(force.solarRelativity).append(",\"exclusionKm\":{");
        double[] exclusions=force.exclusionDistances();
        for(int i=0;i<exclusions.length;i++){if(i>0)json.append(',');json.append('"').append(OrbitPropagationRequest.FORCE_IDS[i]).append("\":").append(exclusions[i]);}
        json.append("},\"offsets\":[");
        for(int i=0;i<offsets.length;i++){if(i>0)json.append(',');json.append(offsets[i]);}
        byte[] result=json.append("]}").toString().getBytes(StandardCharsets.UTF_8);
        require(result.length<=3*1024*1024,"Event request exceeds 3 MiB");check();return result;
    }
}
