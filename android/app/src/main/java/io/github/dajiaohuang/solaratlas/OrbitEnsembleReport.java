package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import static io.github.dajiaohuang.solaratlas.OrbitPropagationReport.*;

/** Binds indexed results to the original request; no independent integration. */
public final class OrbitEnsembleReport {
    public static final int MAX_BYTES=4*1024*1024;
    public final String designation,solutionId,sourceSha256,momentsStatus,momentsReason;
    public final int count,failedCount,forceEvaluations;
    private final byte[] response;
    private final double[][] states;
    private final String[] failures;
    private final double[] mean,sigmas;
    private final double[][] covariance;
    private final int[] evaluationsByDraw;
    private final String[] forceEvidence;

    private OrbitEnsembleReport(byte[] raw,OrbitCovarianceReport initial,double[][] states,String[] failures,
            int failed,int evaluations,String status,String reason,double[] mean,double[] sigmas,double[][] covariance,int[] evaluationsByDraw,String[] forceEvidence) {
        response=raw.clone();designation=initial.designation;solutionId=initial.solutionId;sourceSha256=initial.sourceSha256;
        this.states=states;this.failures=failures;count=states.length;failedCount=failed;forceEvaluations=evaluations;
        momentsStatus=status;momentsReason=reason;this.mean=mean;this.sigmas=sigmas;
        this.covariance=covariance;this.evaluationsByDraw=evaluationsByDraw;
        this.forceEvidence=forceEvidence;
    }
    public byte[] exportBytes(){return response.clone();}
    public double[] state(int index){return states[index]==null?null:states[index].clone();}
    public String failure(int index){return failures[index];}
    public double[] mean(){return mean==null?null:mean.clone();}
    public double[] standardDeviations(){return sigmas==null?null:sigmas.clone();}
    public int forceEvaluations(int index){return evaluationsByDraw[index];}
    public String[] forceEvidence(){return forceEvidence.clone();}
    public double[][] covariance(){
        if(covariance==null)return null;
        double[][] copy=new double[covariance.length][];
        for(int i=0;i<copy.length;i++)copy[i]=covariance[i].clone();
        return copy;
    }

    public static OrbitEnsembleReport decode(byte[] raw,OrbitEnsembleRequest request) throws IOException {
        require(request!=null && raw!=null && raw.length>0 && raw.length<=MAX_BYTES,"Ensemble response exceeds 4 MiB");check();
        OrbitPropagationRequest propagation=request.propagation;
        Map<String,Object> envelope=object(StateTileDecoder.parseJson(raw));
        require("solar.api/v1".equals(envelope.get("apiVersion")),"Ensemble API mismatch");
        Map<String,Object> result=object(envelope.get("ensemble")),initial=object(result.get("initial"));
        require("nonlinear-joint-source-offsets-restricted-dynamics-v1".equals(result.get("method")) &&
            "nonlinear-source-offsets-to-periapsis-conic-state-v1".equals(initial.get("method")),"Ensemble method mismatch");
        Map<String,Object> force=object(result.get("forceModel"));double solarGM=validateForce(force,propagation);
        Map<String,Object> conversion=object(initial.get("conversion")),coordinates=object(conversion.get("coordinates"));
        double adopted=solarGM*86400*86400/(149597870.7*149597870.7*149597870.7);
        double reported=number(object(coordinates.get("adoptedSolarGM")).get("au3PerDay2"));
        require(Double.isFinite(adopted) && adopted>0 && Math.abs(reported-adopted)<=8*Math.ulp(adopted),"Ensemble adopted GM mismatch");
        String gmSource=text(object(coordinates.get("adoptedSolarGM")).get("source"));
        require(gmSource.equals(text(force.get("gmSource"))+" SHA-256 "+text(force.get("gmSha256"))),"Ensemble GM source mismatch");
        OrbitCovarianceReport source=OrbitCovarianceReport.validateConversion(raw,
            new OrbitCovarianceRequest(propagation.originalBytes(),reported,gmSource),conversion);
        require(source.epochTdb==propagation.referenceEpochTdb && source.labels().length==6 && integer(initial.get("dimension"))==6,"Ensemble source epoch/dimension mismatch");
        Map<String,Object> audited=object(object(conversion.get("inspection")).get("source"));
        require(list(audited.get("additionalParameters")).isEmpty(),"Additional source forces unsupported");
        require(Arrays.equals(vector(initial.get("offsets"),request.count()*6),request.sourceOffsets()),"Ensemble offsets mismatch");
        require("heliocentric-IAU76/80-ecliptic-J2000".equals(result.get("frame")) &&
            Arrays.asList("x","y","z","vx","vy","vz").equals(result.get("labels")) &&
            Arrays.asList("au","au","au","au/d","au/d","au/d").equals(result.get("units")),"Ensemble endpoint frame/axes mismatch");
        Map<String,Object> epoch=object(result.get("finalEpoch"));
        require(number(epoch.get("referenceEpochTdb"))==propagation.referenceEpochTdb && number(epoch.get("elapsedTdbSeconds"))==propagation.durationSeconds,"Ensemble split epoch mismatch");
        notes(initial.get("limitations"));notes(result.get("limitations"));
        List<?> draws=list(initial.get("draws")),endpoints=list(result.get("endpoints"));int count=request.count();
        require(draws.size()==count && endpoints.size()==count && integer(result.get("maxEvaluations"))==250000,"Ensemble count/budget mismatch");
        double[][] states=new double[count][];String[] failures=new String[count];int failed=0;long total=0;
        int[] evaluationsByDraw=new int[count];
        for(int index=0;index<count;index++) {
            check();Map<String,Object> draw=object(draws.get(index)),endpoint=object(endpoints.get(index));
            require(integer(draw.get("index"))==index && integer(endpoint.get("index"))==index,"Ensemble draw identity mismatch");
            boolean initialValid=flag(draw.get("valid")),valid=flag(endpoint.get("valid"));
            int evaluations=integer(endpoint.get("forceEvaluations"));require(evaluations<=250000,"Draw force budget exceeded");total+=evaluations;
            evaluationsByDraw[index]=evaluations;
            double[] initialState=null;
            if(initialValid){initialState=vector(draw.get("state"),6);require(list(draw.get("additionalValues")).isEmpty() && draw.get("failure")==null,"Unexpected initial draw fields");}
            else {text(draw.get("failure"));require(draw.get("state")==null && draw.get("additionalValues")==null,"Invalid initial draw must have null values");}
            Object integration=endpoint.get("integration");
            if(!initialValid) {
                require(!valid && integration==null && evaluations==0 && "coordinates".equals(endpoint.get("failureStage")) &&
                    text(draw.get("failure")).equals(endpoint.get("failure")),"Failed initial draw was replaced");
            } else if(propagation.durationSeconds==0) {
                require(valid && integration==null && evaluations==0 && Arrays.equals(initialState,vector(endpoint.get("state"),6)),"Zero-duration ensemble identity mismatch");
            } else if(integration!=null) {
                Map<String,Object> receipt=object(integration);validateIntegration(receipt,propagation,false,6);
                require(evaluations==integer(receipt.get("evaluations")),"Draw evaluation count mismatch");
                if(!valid)require("projection".equals(endpoint.get("failureStage")),"Completed integration failure stage mismatch");
            } else require(!valid && "integration".equals(endpoint.get("failureStage")),"Missing completed integration");
            if(valid){require(endpoint.get("failure")==null && endpoint.get("failureStage")==null,"Valid endpoint contains failure");states[index]=vector(endpoint.get("state"),6);}
            else {require(endpoint.get("state")==null,"Failed endpoint must be null");failed++;failures[index]=text(endpoint.get("failureStage"))+": "+text(endpoint.get("failure"));}
        }
        require(total<=250000 && total==integer(result.get("forceEvaluations")),"Ensemble total force budget mismatch");
        Map<String,Object> moments=object(result.get("moments"));String status=text(moments.get("status")),reason="";
        require(integer(moments.get("count"))==count && integer(moments.get("failedCount"))==failed &&
            "anchored-compensated-two-pass-sample-moments-v1".equals(moments.get("method")),"Ensemble moments identity mismatch");text(moments.get("limitation"));
        double[] mean=null,sigmas=null;double[][] covariance=null;
        if(failed>0 || count<2) {
            reason=failed>0?"failed-draws":"insufficient-draws";
            require("unavailable".equals(status) && reason.equals(moments.get("reason")) && integer(moments.get("covarianceDivisor"))==0,"Unavailable moments mismatch");
            for(String key:Arrays.asList("anchor","meanOffset","mean","covariance","standardDeviations"))require(moments.get(key)==null,"Unavailable moments must have null arrays");
        } else {
            require("available".equals(status) && moments.get("reason")==null && integer(moments.get("covarianceDivisor"))==count-1,"Available moments mismatch");
            double[] anchor=vector(moments.get("anchor"),6),offset=vector(moments.get("meanOffset"),6);
            mean=vector(moments.get("mean"),6);sigmas=vector(moments.get("standardDeviations"),6);covariance=matrix(moments.get("covariance"));
            require(Arrays.equals(anchor,states[0]),"Ensemble anchor mismatch");
            for(int i=0;i<6;i++) {
                require(mean[i]==anchor[i]+offset[i] && covariance[i][i]>=0 && sigmas[i]>=0 && Math.abs(sigmas[i]-Math.sqrt(covariance[i][i]))<=8*Math.ulp(Math.sqrt(covariance[i][i])),"Ensemble moments consistency mismatch");
                for(int j=0;j<6;j++)require(covariance[i][j]==covariance[j][i],"Asymmetric ensemble covariance");
            }
        }
        check();return new OrbitEnsembleReport(raw,source,states,failures,failed,(int)total,status,reason,mean,sigmas,covariance,evaluationsByDraw,describeForce(force));
    }
    private static boolean flag(Object value) throws IOException {require(value instanceof Boolean,"Ensemble boolean required");return (Boolean)value;}
}
