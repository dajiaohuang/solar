package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Immutable request: no body exclusions or physical SRP parameters defaulted. */
public final class OrbitPropagationRequest {
    static final int[] FORCE_IDS={10,1,2,399,301,4,5,6,7,8,9};
    public final double referenceEpochTdb,durationSeconds;
    public final boolean solarRelativity,compareRefinement;
    public final OrbitRadiationPressure radiation;
    private final byte[] original;
    private final double[] exclusions;
    public OrbitPropagationRequest(byte[] original,double epoch,double duration,boolean adoptRestrictedDE440,Map<Integer,Double> exclusions,boolean relativity) throws IOException {
        this(original,epoch,duration,adoptRestrictedDE440,exclusions,relativity,null);
    }
    public OrbitPropagationRequest(byte[] original,double epoch,double duration,boolean adoptRestrictedDE440,Map<Integer,Double> exclusions,boolean relativity,OrbitRadiationPressure radiation) throws IOException {
        this(original,epoch,duration,adoptRestrictedDE440,exclusions,relativity,radiation,false);
    }
    public OrbitPropagationRequest(byte[] original,double epoch,double duration,boolean adoptRestrictedDE440,Map<Integer,Double> exclusions,boolean relativity,OrbitRadiationPressure radiation,boolean compareRefinement) throws IOException {
        require(original!=null && original.length>0 && original.length<=OrbitCovarianceRequest.MAX_SOURCE_BYTES,"Original SBDB JSON must fit 2 MiB");
        require(adoptRestrictedDE440 && Double.isFinite(epoch) && Double.isFinite(duration) && Math.abs(duration)<=365*86400,"Explicit restricted-DE440 adoption, finite source epoch and duration within 365 days required");
        require(exclusions!=null && exclusions.size()==FORCE_IDS.length,"Exact eleven-body exclusions required");
        this.exclusions=new double[FORCE_IDS.length];
        for(int i=0;i<FORCE_IDS.length;i++){Double value=exclusions.get(FORCE_IDS[i]);require(value!=null && Double.isFinite(value) && value>=0,"Finite nonnegative exclusion required for NAIF "+FORCE_IDS[i]);this.exclusions[i]=value;}
        this.original=original.clone();referenceEpochTdb=epoch;durationSeconds=duration;solarRelativity=relativity;this.radiation=radiation;
        this.compareRefinement=compareRefinement;
    }
    public byte[] originalBytes(){return original.clone();}
    public double[] exclusionDistances(){return exclusions.clone();}
    public byte[] bytes() throws IOException {
        return encode(null);
    }
    byte[] ensembleBytes(double[] sourceOffsets) throws IOException {
        require(!compareRefinement,"Ensemble propagation does not accept covariance refinement");
        require(sourceOffsets!=null && sourceOffsets.length>=6 && sourceOffsets.length<=128*6 && sourceOffsets.length%6==0,"Expected 1 to 128 complete six-axis source draws");
        double[] owned=sourceOffsets.clone();
        for(double value:owned)require(Double.isFinite(value),"Finite source offsets required");
        return encode(owned);
    }
    private byte[] encode(double[] offsets) throws IOException {
        require(!Thread.currentThread().isInterrupted(),"Propagation request encoding cancelled");
        OrbitCovarianceReport.preflightPropagation(original,referenceEpochTdb);
        StringBuilder json=new StringBuilder("{\"originalSbdbBase64\":\"").append(StellarMotionRequest.base64(original)).append("\",\"referenceEpochTdb\":").append(referenceEpochTdb)
            .append(",\"durationSeconds\":").append(durationSeconds).append(",\"adoptRestrictedDE440\":true,\"solarRelativity\":").append(solarRelativity).append(",\"exclusionKm\":{");
        for(int i=0;i<FORCE_IDS.length;i++){if(i>0)json.append(',');json.append('"').append(FORCE_IDS[i]).append("\":").append(exclusions[i]);}
        json.append('}');
        if(offsets==null)json.append(",\"compareRefinement\":").append(compareRefinement);
        else {json.append(",\"offsets\":[");for(int i=0;i<offsets.length;i++){if(i>0)json.append(',');json.append(offsets[i]);}json.append(']');}
        if(radiation!=null)json.append(",\"solarRadiationPressure\":").append(radiation.json());
        require(!Thread.currentThread().isInterrupted(),"Propagation request encoding cancelled");
        byte[] result=json.append('}').toString().getBytes(StandardCharsets.UTF_8);require(result.length<=3*1024*1024,"Propagation request exceeds 3 MiB");return result;
    }
    private static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
