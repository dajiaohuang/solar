package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Binds the conditional propagation receipt; does not independently integrate. */
public final class OrbitPropagationReport {
    public static final int MAX_BYTES=4*1024*1024;
    private static final String KERNEL_HASH="8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069";
    private static final String KERNEL_ID="de440s-2000-01-01-2051-01-01";
    private static final String KERNEL_SOURCE_MD5="3917ee56769db332790c751e2168843d";
    private static final String KERNEL_SOURCE_LAST_MODIFIED="Mon, 21 Dec 2020 19:39:26 GMT";
    private static final String KERNEL_DERIVATION="Solar Atlas crop-spk.mjs: exact original J2000 type-2/3 records for segments overlapping the bounded TDB window; no refit. Parent SHA-256 was not captured; parent identity uses its URL, byte count, Last-Modified value and NAIF-published MD5.";
    private static final String GM_HASH="924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140";
    private static final String GM_SOURCE="https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc";
    public final String designation,solutionId,sourceSha256,model;
    public final String sourcePlanetaryEphemeris,sourceSmallBodyEphemeris,integrationKernel;
    public final double referenceEpochTdb,durationSeconds;
    public final int accepted,rejected,evaluations;
    public final Double smallestAcceptedStep;
    public final double largestAcceptedStep,maxAcceptedErrorRatio,relativeTolerance;
    private final String[] limitations;
    private final String[] forceEvidence;
    private final byte[] response;
    private final double[] nominal,sigmas;
    public final Refinement refinement;
    public static final class Refinement {
        public final String limitation;
        public final int accepted,rejected,evaluations;
        public final double relativeTolerance,maxAcceptedErrorRatio;
        private final double[] nominal,sigmas,differences;
        private Refinement(Map<String,Object> receipt,OrbitPropagationRequest request,double[] baseline) throws IOException {
            Map<String,Object> integration=object(receipt.get("integration")),coordinates=object(receipt.get("finalCoordinates"));
            validateIntegration(integration,request,true);validateCoordinates(coordinates,request);
            nominal=vector(coordinates.get("nominal"),6);sigmas=vector(coordinates.get("marginalSigmas"),6);
            differences=vector(receipt.get("marginalSigmaAbsoluteDifference"),6);
            for(int i=0;i<6;i++)require(differences[i]==Math.abs(sigmas[i]-baseline[i]),"Covariance refinement sigma difference mismatch");
            limitation=text(receipt.get("limitation"));
            accepted=integer(integration.get("accepted"));rejected=integer(integration.get("rejected"));evaluations=integer(integration.get("evaluations"));
            relativeTolerance=number(integration.get("relativeTolerance"));maxAcceptedErrorRatio=number(integration.get("maxAcceptedErrorRatio"));
        }
        public double[] nominal(){return nominal.clone();}
        public double[] marginalSigmas(){return sigmas.clone();}
        public double[] marginalSigmaAbsoluteDifference(){return differences.clone();}
    }
    private OrbitPropagationReport(byte[] raw,OrbitPropagationRequest request,OrbitCovarianceReport initial,Map<String,Object> force,Map<String,Object> integration,Map<String,Object> result,String[] notes,Refinement refinement) throws IOException {
        response=raw.clone();designation=initial.designation;solutionId=initial.solutionId;sourceSha256=initial.sourceSha256;model=text(force.get("model"));
        sourcePlanetaryEphemeris=initial.planetaryEphemeris;sourceSmallBodyEphemeris=initial.smallBodyEphemeris;integrationKernel=text(force.get("kernelId"));
        referenceEpochTdb=request.referenceEpochTdb;durationSeconds=request.durationSeconds;
        accepted=integer(integration.get("accepted"));rejected=integer(integration.get("rejected"));evaluations=integer(integration.get("evaluations"));
        nominal=vector(result.get("nominal"),6);sigmas=vector(result.get("marginalSigmas"),6);
        smallestAcceptedStep=integration.get("smallestAcceptedStep")==null?null:number(integration.get("smallestAcceptedStep"));
        largestAcceptedStep=number(integration.get("largestAcceptedStep"));maxAcceptedErrorRatio=number(integration.get("maxAcceptedErrorRatio"));relativeTolerance=number(integration.get("relativeTolerance"));
        limitations=notes.clone();
        forceEvidence=describeForce(force);
        this.refinement=refinement;
    }
    public byte[] exportBytes(){return response.clone();}
    public double[] nominal(){return nominal.clone();}
    public double[] marginalSigmas(){return sigmas.clone();}
    public String[] limitations(){return limitations.clone();}
    public String[] forceEvidence(){return forceEvidence.clone();}
    static String[] describeForce(Map<String,Object> force) throws IOException {
        ArrayList<String> lines=new ArrayList<>();
        for(String key:Arrays.asList("model","kernelId","kernelSha256","kernelBytes","kernelSource","kernelSourceBytes","kernelSourceMd5","kernelSourceLastModified","kernelDerivation","gmSource","gmSha256"))lines.add(key+": "+text(force.get(key)));
        Map<String,Object> gravity=object(force.get("gravity"));
        lines.add("J2000 / SSB / TDB · aberration NONE");
        for(Object value:list(gravity.get("masses"))){
            Map<String,Object> mass=object(value);
            lines.add("NAIF "+integer(mass.get("naifId"))+" · GM "+number(mass.get("gmKm3PerSecond2"))+" km³/s² · exclusion "+number(mass.get("exclusionKm"))+" km");
        }
        if(force.get("solarRelativity")==null)lines.add("solarRelativity: none");
        else{
            Map<String,Object> pn=object(force.get("solarRelativity"));
            lines.add(text(pn.get("model"))+" · c "+number(pn.get("speedOfLightKmPerSecond"))+" km/s · maxExpansionParameter "+number(pn.get("maxExpansionParameter")));
            lines.add(text(pn.get("approximation")));
        }
        if(force.get("solarRadiationPressure")==null)lines.add("solarRadiationPressure: none");
        else{
            Map<String,Object> srp=object(force.get("solarRadiationPressure"));
            lines.add(text(srp.get("model"))+" · "+text(srp.get("illumination")));
            lines.add("P (1 au): "+number(srp.get("pressureAt1AuNewtonPerSquareMeter"))+" N/m²");
            lines.add("A: "+number(srp.get("areaSquareMeters"))+" m² · m: "+number(srp.get("massKg"))+" kg · Cr: "+number(srp.get("reflectivityCoefficient")));
            lines.add("SRP source: "+text(srp.get("source")));
        }
        for(Object note:list(force.get("limitations")))lines.add(text(note));
        return lines.toArray(new String[0]);
    }
    public static OrbitPropagationReport decode(byte[] raw,OrbitPropagationRequest request) throws IOException {
        require(raw!=null && raw.length>0 && raw.length<=MAX_BYTES,"Propagation response exceeds 4 MiB");check();
        Map<String,Object> envelope=object(StateTileDecoder.parseJson(raw));require("solar.api/v1".equals(envelope.get("apiVersion")),"Propagation API mismatch");
        Map<String,Object> p=object(envelope.get("propagation")),force=object(p.get("forceModel")),gravity=object(force.get("gravity"));
        require("first-order-variational-square-root-pushforward".equals(p.get("method")),"Propagation method mismatch");
        require("neumaier-compensated-f64-dot-v1".equals(p.get("matrixArithmetic")),"Covariance matrix arithmetic mismatch");
        double solarGM=validateForce(force,request);
        Map<String,Object> conversion=new HashMap<>();conversion.put("inspection",p.get("inspection"));conversion.put("coordinates",p.get("initialCoordinates"));
        double adoptedGM=solarGM*86400*86400/(149597870.7*149597870.7*149597870.7);
        double reportedGM=number(object(object(p.get("initialCoordinates")).get("adoptedSolarGM")).get("au3PerDay2"));
        require(Double.isFinite(adoptedGM) && adoptedGM>0 && Math.abs(reportedGM-adoptedGM)<=8*Math.ulp(adoptedGM),"Solar GM unit conversion mismatch");
        OrbitCovarianceReport initial=OrbitCovarianceReport.validateConversion(raw,new OrbitCovarianceRequest(request.originalBytes(),reportedGM,GM_SOURCE+" SHA-256 "+GM_HASH),conversion);
        require(initial.epochTdb==request.referenceEpochTdb && initial.labels().length==6,"Initial covariance source mismatch");
        vector(p.get("initialStateKmKmPerSecond"),6);
        require("integration.state[0:6]: J2000 SSB km, km/s; [6:42]: row-major d(final state)/d(initial state)".equals(p.get("transitionLayout")),"Transition layout mismatch");
        Map<String,Object> integration=object(p.get("integration")),result=object(p.get("finalCoordinates"));
        validateIntegration(integration,request,false);
        validateCoordinates(result,request);
        Refinement refinement=null;
        if(request.compareRefinement)refinement=new Refinement(object(p.get("refinement")),request,vector(result.get("marginalSigmas"),6));
        else require(p.get("refinement")==null,"Unrequested covariance refinement");
        ArrayList<String> limitations=new ArrayList<>();
        for(Object value:Arrays.asList(p.get("limitations"),force.get("limitations"),gravity.get("limitations"))){notes(value);for(Object note:list(value))limitations.add(text(note));}
        check();
        return new OrbitPropagationReport(raw,request,initial,force,integration,result,limitations.toArray(new String[0]),refinement);
    }
    // Shared source/force binding for covariance and nonlinear ensemble receipts.
    static double validateForce(Map<String,Object> force,OrbitPropagationRequest request) throws IOException {
        return validateForce(force,request,Math.min(0,request.durationSeconds),Math.max(0,request.durationSeconds));
    }
    static double validateForce(Map<String,Object> force,OrbitPropagationRequest request,double start,double end) throws IOException {
        check();
        Map<String,Object> gravity=object(force.get("gravity"));
        require(KERNEL_HASH.equals(force.get("kernelSha256")) && GM_HASH.equals(force.get("gmSha256")) && number(force.get("kernelBytes"))==5558272 && KERNEL_ID.equals(force.get("kernelId")) && number(force.get("kernelSourceBytes"))==32726016 && KERNEL_SOURCE_MD5.equals(force.get("kernelSourceMd5")) && KERNEL_SOURCE_LAST_MODIFIED.equals(force.get("kernelSourceLastModified")) && KERNEL_DERIVATION.equals(force.get("kernelDerivation")) && GM_SOURCE.equals(force.get("gmSource")) && "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp".equals(force.get("kernelSource")),"Pinned propagation source identity mismatch");
        String expectedModel=request.radiation==null?(request.solarRelativity?"restricted-newtonian-plus-solar-1pn":"restricted-newtonian-prescribed-point-masses"):(request.solarRelativity?"restricted-newtonian-plus-solar-1pn-and-radial-srp":"restricted-newtonian-plus-radial-srp");
        require(expectedModel.equals(force.get("model")),"Propagation force model mismatch");
        if(request.radiation==null)require(force.get("solarRadiationPressure")==null,"Unrequested SRP force");else request.radiation.bind(object(force.get("solarRadiationPressure")));
        if(request.solarRelativity){Map<String,Object> pn=object(force.get("solarRelativity"));require("solar-monopole-1pn".equals(pn.get("model")) && number(pn.get("speedOfLightKmPerSecond"))==299792.458 && number(pn.get("maxExpansionParameter"))==1e-4,"Solar 1PN model mismatch");text(pn.get("approximation"));}
        else require(force.get("solarRelativity")==null,"Unrequested solar relativity");
        require("restricted-newtonian-prescribed-point-masses".equals(gravity.get("model")) && "J2000".equals(gravity.get("frame")) && "SSB".equals(gravity.get("origin")) && "TDB".equals(gravity.get("timeScale")) && "NONE".equals(gravity.get("aberration")) && number(gravity.get("referenceEpochTdb"))==request.referenceEpochTdb,"Force epoch/frame mismatch");
        double[] range=vector(gravity.get("elapsedRangeSeconds"),2);require(range[0]==start && range[1]==end,"Force time window mismatch");
        require(Arrays.asList("km","km","km","km/s","km/s","km/s").equals(gravity.get("stateUnits")) && ("de440s-2000-01-01-2051-01-01 SHA-256 "+KERNEL_HASH).equals(gravity.get("ephemerisSource")),"Force source units mismatch");
        List<?> masses=list(gravity.get("masses"));require(masses.size()==11,"Force mass plan mismatch");double[] exclusions=request.exclusionDistances();double solarGM=0;
        for(int i=0;i<11;i++){Map<String,Object> mass=object(masses.get(i));require(integer(mass.get("naifId"))==OrbitPropagationRequest.FORCE_IDS[i] && number(mass.get("exclusionKm"))==exclusions[i] && (GM_SOURCE+" SHA-256 "+GM_HASH).equals(mass.get("gmSource")),"Mass/exclusion/source mismatch");double gm=number(mass.get("gmKm3PerSecond2"));require(gm>0,"Nonpositive force GM");if(i==0)solarGM=gm;}
        notes(force.get("limitations"));notes(gravity.get("limitations"));check();
        return solarGM;
    }
    private static void validateIntegration(Map<String,Object> integration,OrbitPropagationRequest request,boolean refined) throws IOException {
        validateIntegration(integration,request,refined,42);
    }
    static void validateIntegration(Map<String,Object> integration,OrbitPropagationRequest request,boolean refined,int dimension) throws IOException {
        require(dimension==6 || dimension==42,"Unsupported integration dimension");
        require("dormand-prince-54-component-max-v1".equals(integration.get("algorithm")) && number(integration.get("elapsed"))==request.durationSeconds && number(integration.get("relativeTolerance"))==(refined?1e-13:1e-12) && number(integration.get("initialStep"))==(refined?1800:3600) && number(integration.get("maxStep"))==(refined?43200:86400) && integer(integration.get("maxAttempts"))==20000,"Integration settings mismatch");
        vector(integration.get("state"),dimension);double[] atol=vector(integration.get("absoluteTolerance"),dimension);for(int i=0;i<dimension;i++)require(atol[i]==(i<3?1e-5:1e-12)/(refined?10:1),"Integration tolerance mismatch");
        int accepted=integer(integration.get("accepted")),rejected=integer(integration.get("rejected")),attempts=integer(integration.get("attempts")),evaluations=integer(integration.get("evaluations"));
        require((long)accepted+rejected==attempts && attempts<=20000 && evaluations==(request.durationSeconds==0?0:1+6*attempts),"Integration counters mismatch");
        double largest=number(integration.get("largestAcceptedStep")),ratio=number(integration.get("maxAcceptedErrorRatio"));require(largest>=0 && largest<=(refined?43200:86400) && ratio>=0 && ratio<=1,"Integration diagnostics mismatch");
        if(request.durationSeconds==0)require(attempts==0 && integration.get("smallestAcceptedStep")==null && largest==0 && ratio==0,"Zero-duration integration mismatch");
        else{double smallest=number(integration.get("smallestAcceptedStep"));require(accepted>0 && smallest>0 && smallest<=largest && largest<=Math.abs(request.durationSeconds),"Accepted step bounds mismatch");}
    }
    private static void validateCoordinates(Map<String,Object> result,OrbitPropagationRequest request) throws IOException {
        Map<String,Object> epoch=object(result.get("epoch"));
        require(number(epoch.get("referenceEpochTdb"))==request.referenceEpochTdb && number(epoch.get("elapsedTdbSeconds"))==request.durationSeconds && "heliocentric-IAU76/80-ecliptic-J2000".equals(result.get("frame")),"Final split epoch/frame mismatch");
        require(Arrays.asList("x","y","z","vx","vy","vz").equals(result.get("labels")) && Arrays.asList("au","au","au","au/d","au/d","au/d").equals(result.get("units")),"Final axes mismatch");
        vector(result.get("nominal"),6);double[] sigmas=vector(result.get("marginalSigmas"),6);double[][] root=matrix(result.get("squareRoot")),matrix=matrix(result.get("matrix"));
        for(int i=0;i<6;i++){check();require(matrix[i][i]>=0 && sigmas[i]>=0 && Math.abs(sigmas[i]-Math.sqrt(matrix[i][i]))<=8*Math.ulp(Math.sqrt(matrix[i][i])),"Final variance mismatch");for(int j=0;j<6;j++){
            require(matrix[i][j]==matrix[j][i],"Asymmetric final covariance");double expected=0;for(int k=0;k<6;k++)expected+=root[i][k]*root[j][k];require(Double.isFinite(expected),"Nonfinite covariance root product");
            if(sigmas[i]==0 || sigmas[j]==0)require(expected==matrix[i][j],"Zero-variance root mismatch");else{double scaled=Math.abs(expected-matrix[i][j])/sigmas[i]/sigmas[j];require(Double.isFinite(scaled) && scaled<=1e-10,"Covariance root mismatch");}
        }}
    }
    @SuppressWarnings("unchecked") static Map<String,Object> object(Object value) throws IOException {require(value instanceof Map,"Propagation object required");return (Map<String,Object>)value;}
    static List<?> list(Object value) throws IOException {require(value instanceof List,"Propagation array required");return (List<?>)value;}
    static String text(Object value) throws IOException {require(value instanceof String && !((String)value).isEmpty(),"Propagation text required");return (String)value;}
    static double number(Object value) throws IOException {require(value instanceof Number && Double.isFinite(((Number)value).doubleValue()),"Finite propagation number required");return ((Number)value).doubleValue();}
    static int integer(Object value) throws IOException {double n=number(value);require(n>=0 && n<=Integer.MAX_VALUE && n==Math.floor(n),"Nonnegative integer required");return (int)n;}
    static double[] vector(Object value,int n) throws IOException {List<?> values=list(value);require(values.size()==n,"Propagation vector shape mismatch");double[] out=new double[n];for(int i=0;i<n;i++)out[i]=number(values.get(i));return out;}
    static double[][] matrix(Object value) throws IOException {List<?> rows=list(value);require(rows.size()==6,"Propagation matrix shape mismatch");double[][] out=new double[6][];for(int i=0;i<6;i++)out[i]=vector(rows.get(i),6);return out;}
    static void notes(Object value) throws IOException {List<?> notes=list(value);require(!notes.isEmpty(),"Propagation limitations missing");for(Object note:notes)text(note);}
    static void check() throws IOException {require(!Thread.currentThread().isInterrupted(),"Propagation receipt validation cancelled");}
    static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
