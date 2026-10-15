package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.util.Map;

/** Owns caller-supplied joint source offsets; no sampling or axis defaults. */
public final class OrbitEnsembleRequest {
    public final OrbitPropagationRequest propagation;
    private final double[] offsets;

    public OrbitEnsembleRequest(byte[] original,double epoch,double duration,
            boolean adoptRestrictedDE440,Map<Integer,Double> exclusions,boolean relativity,
            OrbitRadiationPressure radiation,double[] offsets) throws IOException {
        if(offsets==null || offsets.length<6 || offsets.length>128*6 || offsets.length%6!=0)
            throw new IOException("Expected 1 to 128 complete six-axis source draws");
        this.offsets=offsets.clone();
        for(double value:this.offsets)if(!Double.isFinite(value))throw new IOException("Finite source offsets required");
        propagation=new OrbitPropagationRequest(original,epoch,duration,adoptRestrictedDE440,exclusions,relativity,radiation,false);
    }

    public double[] sourceOffsets(){return offsets.clone();}
    public int count(){return offsets.length/6;}
    public byte[] bytes() throws IOException {return propagation.ensembleBytes(offsets);}
}
