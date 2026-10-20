package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/** Receipt/source binding, not independent numerical validation of the backend.
 * Keeps exact response bytes so exports include the full covariance and source. */
public final class OrbitCovarianceReport {
    private static final Pattern DECIMAL_SOURCE_NUMBER=Pattern.compile("^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$");
    public static final int MAX_BYTES=4*1024*1024;
    private static final String FRAME="heliocentric-IAU76/80-ecliptic-J2000";
    private static final List<String> ORBIT=Arrays.asList("e","q","tp","node","peri","i");
    private static final String[] ELEMENTS={"e","q","tp","om","w","i"};
    private static final String[] ELEMENT_UNITS={null,"au","TDB","deg","deg","deg"};
    public final String designation,solutionId,sourceSha256,model,conicClass,gmSource;
    public final String planetaryEphemeris,smallBodyEphemeris;
    public final double epochTdb,gmAU3PerDay2;
    private final byte[] response;
    private final String[] labels,units;
    private final double[] nominal,sigmas;
    private final List<String> limitations;
    private OrbitCovarianceReport(byte[] raw,Map<String,Object> source,Map<String,Object> coordinates,String hash,OrbitCovarianceRequest request,boolean retainResponse) throws IOException {
        response=retainResponse?raw.clone():null;designation=text(source.get("designation"));solutionId=text(source.get("solutionId"));sourceSha256=hash;
        planetaryEphemeris=optionalText(source.get("planetaryEphemeris"));smallBodyEphemeris=optionalText(source.get("smallBodyEphemeris"));
        epochTdb=number(source.get("solutionEpochTdb"));model=text(coordinates.get("model"));conicClass=text(object(coordinates.get("nominalConic")).get("classification"));gmSource=request.gmSource;gmAU3PerDay2=request.gmAU3PerDay2;
        List<?> rawLabels=list(coordinates.get("labels")),rawUnits=list(coordinates.get("units"));int n=rawLabels.size();labels=new String[n];units=new String[n];
        for(int i=0;i<n;i++){labels[i]=text(rawLabels.get(i));units[i]=rawUnits.get(i)==null?null:text(rawUnits.get(i));}
        nominal=vector(coordinates.get("nominal"),n);sigmas=vector(coordinates.get("marginalSigmas"),n);
        limitations=new ArrayList<>();for(Object value:list(coordinates.get("limitations")))limitations.add(text(value));
    }
    public byte[] exportBytes(){if(response==null)throw new IllegalStateException("Embedded conversion has no standalone response; export its enclosing report");return response.clone();}
    public String[] labels(){return labels.clone();}
    public String[] units(){return units.clone();}
    public double[] nominal(){return nominal.clone();}
    public double[] marginalSigmas(){return sigmas.clone();}
    public List<String> limitations(){return new ArrayList<>(limitations);}

    // Admission only; the backend and response binding still perform full validation.
    static void preflightPropagation(byte[] original,double epoch) throws IOException {
        check();
        Map<String,Object> root=object(StateTileDecoder.parseJson(original));
        Map<String,Object> orbit=object(root.get("orbit")),cov=object(orbit.get("covariance"));
        List<?> labels=list(cov.get("labels"));
        require(labels.size()==6 && new java.util.HashSet<>(labels).size()==6 && labels.containsAll(ORBIT),
            "Propagation requires exactly six orbital axes; additional fitted parameters need matched forces and cannot be dropped");
        require(sourceNumber(cov.get("epoch"))==epoch,"Requested epoch differs from original SBDB covariance epoch");
        check();
    }
    public static OrbitCovarianceReport decode(byte[] raw,OrbitCovarianceRequest request) throws IOException {
        require(raw!=null && raw.length>0 && raw.length<=MAX_BYTES,"Orbit covariance response exceeds 4 MiB");check();
        Map<String,Object> envelope=object(StateTileDecoder.parseJson(raw));require("solar.api/v1".equals(envelope.get("apiVersion")),"Orbit API identity mismatch");
        return validateConversion(raw,request,object(envelope.get("conversion")),true);
    }
    // Nested validators need the checked summary, not a second copy of the
    // entire propagation/ensemble/event response. The enclosing report owns it.
    static OrbitCovarianceReport validateConversion(byte[] raw,OrbitCovarianceRequest request,Map<String,Object> conversion) throws IOException {
        return validateConversion(raw,request,conversion,false);
    }
    private static OrbitCovarianceReport validateConversion(byte[] raw,OrbitCovarianceRequest request,Map<String,Object> conversion,boolean retainResponse) throws IOException {
        Map<String,Object> inspection=object(conversion.get("inspection"));
        require("sbdb-solution-covariance-inspection-v1".equals(inspection.get("model")),"Unsupported SBDB inspection model");
        byte[] original=request.originalBytes();String hash=hash(original);
        require(StellarMotionRequest.base64(original).equals(inspection.get("originalSbdbBase64")) && hash.equals(inspection.get("sourceSha256")) && number(inspection.get("sourceBytes"))==original.length,"Original SBDB bytes or digest mismatch");
        text(inspection.get("provenanceLimitation"));
        Map<String,Object> root=object(StateTileDecoder.parseJson(original)),signature=object(root.get("signature")),body=object(root.get("object")),orbit=object(root.get("orbit")),cov=object(orbit.get("covariance"));
        require("1.3".equals(signature.get("version")) && "NASA/JPL Small-Body Database (SBDB) API".equals(signature.get("source")) && "J2000".equals(orbit.get("equinox")),"Unsupported original SBDB signature/frame");
        Map<String,Object> source=object(inspection.get("source")),coordinates=object(conversion.get("coordinates"));
        String solution=trimmed(orbit.get("orbit_id"));double epoch=sourceNumber(cov.get("epoch")),standard=sourceNumber(orbit.get("epoch"));
        require(solution.equals(source.get("solutionId")) && trimmed(body.get("des")).equals(source.get("designation")) && trimmed(body.get("spkid")).equals(source.get("spkId")),"SBDB solution identity mismatch");
        require(!body.containsKey("orbit_id") || solution.equals(body.get("orbit_id")),"Conflicting source solution identity");
        require(orbit.get("cov_epoch")==null || sourceNumber(orbit.get("cov_epoch"))==epoch,"Conflicting source covariance epoch");
        require(number(source.get("solutionEpochTdb"))==epoch && number(source.get("standardElementEpochTdb"))==standard && FRAME.equals(source.get("frame")),"Source solution epoch/frame mismatch");
        for(String[] pair:new String[][]{{"solutionDateLocal","soln_date"},{"planetaryEphemeris","pe_used"},{"smallBodyEphemeris","sb_used"}})require(Objects.equals(source.get(pair[0]),optionalText(orbit.get(pair[1]))),"SBDB source metadata mismatch");
        Object rawElements=cov.get("elements");if(rawElements==null && standard==epoch)rawElements=orbit.get("elements");
        Map<String,Map<String,Object>> elements=named(rawElements),models=orbit.get("model_pars")==null?new HashMap<>():named(orbit.get("model_pars"));
        List<?> rawLabels=list(cov.get("labels"));int n=rawLabels.size();require(n>=6 && n<=16,"Unsupported SBDB covariance dimension");
        List<String> labels=new ArrayList<>(),units=new ArrayList<>();double[] input=new double[n];
        for(int i=0;i<n;i++){
            String label=trimmed(rawLabels.get(i));require(!labels.contains(label),"Duplicate SBDB covariance axis");labels.add(label);Map<String,Object> entry;
            if(i<6){int axis=ORBIT.indexOf(label);require(axis>=0,"Unsupported orbital axis");entry=elements.get(ELEMENTS[axis]);require(entry!=null && Objects.equals(ELEMENT_UNITS[axis],entry.get("units")),"SBDB nominal element/units mismatch");units.add(axis==2?"d":ELEMENT_UNITS[axis]);}
            else{entry=models.get(label);require(entry!=null && "EST".equals(entry.get("kind")),"Extra covariance axes must be estimated model parameters");units.add(entry.get("units")==null?null:trimmed(entry.get("units")));}
            input[i]=sourceNumber(entry.get("value"));
        }
        validateModelParameterAxes(labels,models);
        require(labels.equals(source.get("labels")) && units.equals(source.get("units")) && labels.subList(6,n).equals(source.get("additionalParameters")),"Source covariance axes mismatch");
        require(Arrays.equals(input,vector(source.get("nominal"),n)),"Source nominal values mismatch");
        double[][] matrix=matrix(source.get("matrix"),n),jacobian=matrix(coordinates.get("jacobian"),n),output=matrix(coordinates.get("matrix"),n);
        List<?> originalMatrix=list(cov.get("data"));require(originalMatrix.size()==n,"Original covariance shape mismatch");
        for(int i=0;i<n;i++){check();List<?> row=list(originalMatrix.get(i));require(row.size()==n && matrix[i][i]>0,"Original covariance shape/variance mismatch");for(int j=0;j<n;j++)require(sourceNumber(row.get(j))==matrix[i][j],"Source covariance entry mismatch");}
        require(number(coordinates.get("epochTdb"))==epoch && FRAME.equals(coordinates.get("frame")) && labels.equals(coordinates.get("inputLabels")) && units.equals(coordinates.get("inputUnits")),"Coordinate source binding mismatch");
        List<String> outputLabels=new ArrayList<>(Arrays.asList("x","y","z","vx","vy","vz")),outputUnits=new ArrayList<>(Arrays.asList("au","au","au","au/d","au/d","au/d"));outputLabels.addAll(labels.subList(6,n));outputUnits.addAll(units.subList(6,n));
        require(outputLabels.equals(coordinates.get("labels")) && outputUnits.equals(coordinates.get("units")),"Cartesian coordinate axes mismatch");
        Map<String,Object> gm=object(coordinates.get("adoptedSolarGM"));require(number(gm.get("au3PerDay2"))==request.gmAU3PerDay2 && request.gmSource.equals(gm.get("source")),"Adopted GM differs from request");
        double e=input[labels.indexOf("e")],q=input[labels.indexOf("q")],tp=input[labels.indexOf("tp")],inclination=input[labels.indexOf("i")];
        require(e>=0 && q>0 && inclination>=0 && inclination<=180,"Invalid original conic");
        Map<String,Object> conic=object(coordinates.get("nominalConic")),domain=object(coordinates.get("numericalDomain"));boolean universal=e>.9999;
        require(number(conic.get("eccentricity"))==e && number(conic.get("periapsisAU"))==q && number(conic.get("elapsedTdbDaysFromPeriapsis"))==epoch-tp && (e<1?"elliptic":e==1?"parabolic":"hyperbolic").equals(conic.get("classification")),"Nominal conic binding mismatch");
        require((universal?"universal-conic-osculating-coordinate-transform":"elliptic-osculating-coordinate-transform").equals(coordinates.get("model")) && (universal?"unwrapped-universal-periapsis":"elliptic-anomaly").equals(domain.get("formulation")) && number(domain.get(universal?"maximumAbsoluteDimensionlessTime":"maximumAbsoluteMeanAnomalyRadians"))==1e6,"Coordinate numerical domain mismatch");
        double[] nominal=vector(coordinates.get("nominal"),n),sigmas=vector(coordinates.get("marginalSigmas"),n);
        for(int i=0;i<n;i++){
            require(output[i][i]>=0 && sigmas[i]>=0 && Math.abs(sigmas[i]-Math.sqrt(output[i][i]))<=8*Math.ulp(Math.sqrt(output[i][i])),"Output marginal variance mismatch");
            for(int j=0;j<n;j++){require(output[i][j]==output[j][i],"Asymmetric output covariance");if(i>=6)require(jacobian[i][j]==(i==j?1:0),"Extra-parameter identity block mismatch");else if(j>=6)require(jacobian[i][j]==0,"Unexpected extra-parameter coordinate derivative");}
            if(i>=6)require(nominal[i]==input[i],"Extra nominal parameter was changed");
        }
        // Receipt consistency only: this checks the supplied Jacobian against
        // the supplied result, not whether the conic derivatives are correct.
        double[][] left=new double[n][n];
        for(int i=0;i<n;i++){check();for(int j=0;j<n;j++){
            for(int k=0;k<n;k++)left[i][j]+=jacobian[i][k]*symmetricMean(matrix[k][j],matrix[j][k]);
            require(Double.isFinite(left[i][j]),"Nonfinite covariance receipt intermediate");
        }}
        for(int i=0;i<n;i++){check();for(int j=i;j<n;j++){
            double expected=0;for(int k=0;k<n;k++)expected+=left[i][k]*jacobian[j][k];
            require(Double.isFinite(expected),"Nonfinite transformed receipt covariance");
            if(sigmas[i]==0 || sigmas[j]==0)require(expected==output[i][j],"Zero-variance covariance receipt mismatch");
            else{double scaled=Math.abs(expected-output[i][j])/Math.min(sigmas[i],sigmas[j])/Math.max(sigmas[i],sigmas[j]);require(Double.isFinite(scaled) && scaled<=1e-10,"Covariance Jacobian receipt mismatch");}
        }}
        require(!list(coordinates.get("limitations")).isEmpty(),"Coordinate limitations missing");check();
        return new OrbitCovarianceReport(raw,source,coordinates,hash,request,retainResponse);
    }
    private static double symmetricMean(double a,double b){if(a>b){double swap=a;a=b;b=swap;}return (a<0)==(b<0)?a+(b-a)/2:(a+b)/2;}
    static void validateModelParameterAxes(List<String> labels,Map<String,Map<String,Object>> models) throws IOException {
        Set<String> estimated=new HashSet<>();Map<Integer,String> indices=new HashMap<>();
        for(Map.Entry<String,Map<String,Object>> row:models.entrySet()){
            String name=row.getKey(),kind=trimmed(row.getValue().get("kind"));
            require("SET".equals(kind)||"EST".equals(kind)||"CON".equals(kind),"Unsupported SBDB model parameter kind.");
            if("EST".equals(kind))estimated.add(name);
            Object raw=row.getValue().get("n");if(raw==null)continue;
            double numeric=sourceNumber(raw);require(numeric>=0&&numeric<=64&&numeric==Math.rint(numeric),"Invalid SBDB model parameter index.");int index=(int)numeric;
            require("SET".equals(kind)?index==0:index>0,"SBDB model parameter index/kind mismatch.");
            if(!"SET".equals(kind))require(indices.put(index,name)==null,"Duplicate SBDB estimated/considered parameter index.");
        }
        List<String> axes=labels.subList(6,labels.size());
        require(axes.size()==estimated.size()&&new HashSet<>(axes).equals(estimated),"Covariance labels disagree with estimated model parameters.");
        int previous=0;
        for(String label:axes){Object raw=models.get(label).get("n");if(raw==null)continue;int index=(int)sourceNumber(raw);require(index>previous,"Covariance labels disagree with SBDB model index order.");previous=index;}
    }
    private static Map<String,Map<String,Object>> named(Object raw) throws IOException {List<?> rows=list(raw);require(rows.size()<=64,"SBDB named list exceeds supported size 64");Map<String,Map<String,Object>> result=new HashMap<>();for(Object value:rows){check();Map<String,Object> entry=object(value);String name=trimmed(entry.get("name"));require(result.put(name,entry)==null,"Duplicate named SBDB element");}return result;}
    @SuppressWarnings("unchecked") private static Map<String,Object> object(Object value) throws IOException {require(value instanceof Map,"Covariance object required");return (Map<String,Object>)value;}
    private static List<?> list(Object value) throws IOException {require(value instanceof List,"Covariance array required");return (List<?>)value;}
    private static String text(Object value) throws IOException {require(value instanceof String && !((String)value).isEmpty(),"Covariance text required");return (String)value;}
    private static String trimmed(Object value) throws IOException {String result=text(value).trim();require(!result.isEmpty(),"Covariance text required");return result;}
    private static String optionalText(Object value){return value instanceof String&&!((String)value).trim().isEmpty()?((String)value).trim():null;}
    private static double number(Object value) throws IOException {require(value instanceof Number && Double.isFinite(((Number)value).doubleValue()),"Finite covariance number required");return ((Number)value).doubleValue();}
    private static double sourceNumber(Object value) throws IOException {if(value instanceof Number)return number(value);String raw=trimmed(value);require(DECIMAL_SOURCE_NUMBER.matcher(raw).matches(),"Decimal SBDB numeric text required");try{double parsed=Double.parseDouble(raw);require(Double.isFinite(parsed),"Finite SBDB number required");return parsed;}catch(NumberFormatException error){throw new IOException("Invalid SBDB numeric text",error);}}
    private static double[] vector(Object value,int n) throws IOException {List<?> raw=list(value);require(raw.size()==n,"Covariance vector shape mismatch");double[] result=new double[n];for(int i=0;i<n;i++)result[i]=number(raw.get(i));return result;}
    private static double[][] matrix(Object value,int n) throws IOException {List<?> raw=list(value);require(raw.size()==n,"Covariance matrix shape mismatch");double[][] result=new double[n][];for(int i=0;i<n;i++)result[i]=vector(raw.get(i),n);return result;}
    private static String hash(byte[] bytes) throws IOException {try{StringBuilder out=new StringBuilder();for(byte v:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format(java.util.Locale.ROOT,"%02x",v&255));return out.toString();}catch(NoSuchAlgorithmException error){throw new IOException(error);}}
    private static void check() throws IOException {require(!Thread.currentThread().isInterrupted(),"Orbit covariance validation cancelled");}
    private static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
