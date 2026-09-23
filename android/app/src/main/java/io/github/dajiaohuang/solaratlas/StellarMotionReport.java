package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Validated source-bearing response. Export retains the exact received bytes. */
public final class StellarMotionReport {
    public static final int MAX_BYTES = 14*1024*1024;
    public final String sourceId;
    public final double epoch;
    private final byte[] originalResponse;
    private final double[] state, standardDeviations;
    private StellarMotionReport(byte[] raw, StellarMotionRequest request, double[] state, double[] deviations) {
        originalResponse=raw.clone(); sourceId=request.sourceId; epoch=request.targetEpochJulianYearTCB;
        this.state=state; standardDeviations=deviations;
    }
    public byte[] exportBytes() { return originalResponse.clone(); }
    public double[] state() { return state.clone(); }
    public double[] formalStandardDeviations() { return standardDeviations == null ? null : standardDeviations.clone(); }

    public static StellarMotionReport decode(byte[] raw, StellarMotionRequest request) throws IOException {
        require(raw!=null && raw.length>0 && raw.length<=MAX_BYTES,"Stellar response byte budget exceeded");
        checkCancelled();
        Map<String,Object> envelope=object(StateTileDecoder.parseJson(raw)), e=object(envelope.get("experiment")), r=object(e.get("result"));
        require("solar.api/v1".equals(envelope.get("apiVersion")) && number(e.get("schemaVersion"))==1,"Stellar API identity mismatch");
        byte[] manifest=request.manifestBytes(), rows=request.rowsBytes();
        require(StellarMotionRequest.base64(manifest).equals(e.get("originalManifestBase64")) && StellarMotionRequest.base64(rows).equals(e.get("originalRowsCsvBase64")),"Original source bytes mismatch");
        require(hash(manifest).equals(e.get("manifestSha256")) && hash(rows).equals(e.get("rowsSha256")),"Original source hash mismatch");
        Map<String,Object> source=object(e.get("selectedSource"));
        require(source.equals(selectedRow(rows,request.sourceId)),"Selected source differs from original CSV");
        require(number(source.get("ref_epoch"))==2016 && request.sourceId.equals(r.get("sourceId")) && number(r.get("targetEpochJulianYearTCB"))==request.targetEpochJulianYearTCB
            && "gofa-starpm-scaled-gaia-single-star-v1".equals(r.get("model")) && StellarMotionRequest.RV_POLICY.equals(r.get("radialVelocityPolicy"))
            && number(r.get("tdbCompatibleScaleFactor"))==1-1.550519768e-8,"Stellar model identity mismatch");
        texts(r.get("limitations")); text(e.get("provenanceBoundary"));
        vector(r.get("sourceJdTdbParts"),2); vector(r.get("targetJdTdbParts"),2);
        Map<String,Object> values=object(r.get("stateTCBCompatible"));
        String[] fields={"raDeg","decDeg","parallaxMas","pmraMasPerJulianYear","pmdecMasPerJulianYear","radialVelocityKmPerSecond"};
        double[] state=new double[6];for(int i=0;i<6;i++)state[i]=number(values.get(fields[i]));
        require(state[0]>=0 && state[0]<360 && Math.abs(state[1])<90 && state[2]>0,"Stellar state domain mismatch");
        double[] deviations=null;
        if(request.formalCovariance) deviations=covariance(object(e.get("formalCovariance")),source,request);
        else require(!e.containsKey("formalCovariance"),"Unrequested formal covariance");
        checkCancelled();
        return new StellarMotionReport(raw,request,state,deviations);
    }

    private static double[] covariance(Map<String,Object> c,Map<String,Object> source,StellarMotionRequest request) throws IOException {
        require("first-order-starpm-covariance-v1".equals(c.get("model")) && StellarMotionRequest.COVARIANCE_POLICY.equals(c.get("policy")) && "TCB".equals(c.get("timeScale")) && "ICRS".equals(c.get("frame")) && number(c.get("targetEpochJulianYearTCB"))==request.targetEpochJulianYearTCB,"Covariance identity mismatch");
        require(Arrays.asList("delta-alpha*cos(delta)","delta-dec","parallax","pmra","pmdec","radial-velocity").equals(c.get("coordinateLabels")) && Arrays.asList("mas","mas","mas","mas/Julian-year","mas/Julian-year","km/s").equals(c.get("coordinateUnits")),"Covariance coordinate mismatch");
        texts(c.get("assumptions"));
        double difference=number(c.get("maxScaledDerivativeDifference"));require(difference>=0 && difference<=1e-4,"Covariance derivative not converged");
        for(double step:vector(c.get("differenceSteps"),6)) require(request.targetEpochJulianYearTCB==2016 ? step==0 : step>0,"Invalid derivative step");
        double[][] input=matrix(c.get("inputMatrix")),output=matrix(c.get("outputMatrix")),jacobian=matrix(c.get("jacobian"));
        positive(input);positive(output);
        double solution=number(source.get("astrometric_params_solved"));require(solution==31||solution==95,"Invalid source solution");
        String[] fields={"ra","dec","parallax","pmra","pmdec","radial_velocity"};double[] sigma=new double[6];
        for(int i=0;i<6;i++){sigma[i]=number(source.get(fields[i]+"_error"));require(sigma[i]>0,"Missing positive formal error");}
        for(int i=0;i<6;i++)for(int j=0;j<6;j++) {
            double correlation=i==j?1:0;
            if(i<5 && j<5 && i!=j) {correlation=number(source.get(fields[Math.min(i,j)]+"_"+fields[Math.max(i,j)]+"_corr"));require(Math.abs(correlation)<=1,"Invalid source correlation");}
            double expected=correlation*sigma[i]*sigma[j];
            require(Double.isFinite(expected) && Math.abs(expected-input[i][j])<=1e-10*Math.sqrt(input[i][i]*input[j][j]),"Covariance source errors mismatch");
            double transformed=0;for(int a=0;a<6;a++)for(int b=0;b<6;b++)transformed+=jacobian[i][a]*input[a][b]*jacobian[j][b];
            require(Double.isFinite(transformed) && Math.abs(transformed-output[i][j])<=1e-10*Math.sqrt(output[i][i]*output[j][j]),"Covariance Jacobian mismatch");
        }
        double[] deviations=new double[6];for(int i=0;i<6;i++)deviations[i]=Math.sqrt(output[i][i]);return deviations;
    }
    private static void positive(double[][] matrix) throws IOException {
        double[][] lower=new double[6][6];
        for(int i=0;i<6;i++){require(matrix[i][i]>0,"Nonpositive covariance variance");for(int j=0;j<=i;j++){
            require(matrix[i][j]==matrix[j][i],"Asymmetric covariance");double v=matrix[i][j]/Math.sqrt(matrix[i][i]*matrix[j][j]);
            for(int k=0;k<j;k++)v-=lower[i][k]*lower[j][k];
            if(i==j){require(v>0 && Double.isFinite(v),"Covariance not positive definite");lower[i][j]=Math.sqrt(v);}else lower[i][j]=v/lower[j][j];
        }}
    }
    private static Map<String,Object> selectedRow(byte[] bytes,String id) throws IOException {
        String csv=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        List<String> header=null,selected=null,row=new ArrayList<>();StringBuilder cell=new StringBuilder();boolean quoted=false,closed=false;int count=0,nextCheck=0;
        for(int i=0;i<=csv.length();i++) {
            if(i>=nextCheck){checkCancelled();nextCheck=i+32768;}boolean end=i==csv.length();char ch=end?'\n':csv.charAt(i);
            if(quoted){require(!end,"Unterminated CSV field");if(ch=='"'){if(i+1<csv.length()&&csv.charAt(i+1)=='"'){cell.append('"');i++;}else{quoted=false;closed=true;}}else cell.append(ch);continue;}
            if(ch==','||ch=='\n'||ch=='\r') {
                row.add(cell.toString());cell.setLength(0);closed=false;
                if(ch==',')continue;
                if(ch=='\r' && i+1<csv.length() && csv.charAt(i+1)=='\n')i++;
                if(row.size()==1 && row.get(0).isEmpty()){row.clear();continue;}
                if(header==null){header=new ArrayList<>(row);require(header.get(0).equals("source_id") && new java.util.HashSet<>(header).size()==header.size() && !header.contains(""),"Invalid CSV header");}
                else {require(++count<=10000 && row.size()==header.size(),"CSV shape or row budget mismatch");if(row.get(0).equals(id)){require(selected==null,"Duplicate selected source");selected=new ArrayList<>(row);}}
                row.clear();
            } else if(ch=='"' && cell.length()==0 && !closed)quoted=true;
            else {require(!closed && ch!='"',"Malformed CSV quoting");cell.append(ch);}
        }
        require(header!=null && selected!=null,"Selected source absent");Map<String,Object> result=new HashMap<>();
        for(int i=0;i<header.size();i++) {
            String value=selected.get(i);Object parsed;
            if(i==0)parsed=value;else if(value.isEmpty())parsed=null;
            else {require(value.matches("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"),"Invalid CSV numeric field");double v=Double.parseDouble(value);require(Double.isFinite(v),"Nonfinite CSV field");parsed=v;}
            result.put(header.get(i),parsed);
        }
        return result;
    }
    @SuppressWarnings("unchecked") private static Map<String,Object> object(Object value) throws IOException {require(value instanceof Map,"Stellar object required");return (Map<String,Object>)value;}
    private static String text(Object value) throws IOException {require(value instanceof String && !((String)value).isEmpty(),"Stellar text required");return (String)value;}
    private static void texts(Object value) throws IOException {require(value instanceof List && !((List<?>)value).isEmpty(),"Stellar limits required");for(Object item:(List<?>)value)text(item);}
    private static double number(Object value) throws IOException {require(value instanceof Number && Double.isFinite(((Number)value).doubleValue()),"Finite stellar number required");return ((Number)value).doubleValue();}
    private static double[] vector(Object value,int size) throws IOException {require(value instanceof List && ((List<?>)value).size()==size,"Stellar vector shape mismatch");double[] result=new double[size];for(int i=0;i<size;i++)result[i]=number(((List<?>)value).get(i));return result;}
    private static double[][] matrix(Object value) throws IOException {require(value instanceof List && ((List<?>)value).size()==6,"Stellar matrix shape mismatch");double[][] result=new double[6][];for(int i=0;i<6;i++)result[i]=vector(((List<?>)value).get(i),6);return result;}
    private static String hash(byte[] bytes) throws IOException {try{StringBuilder result=new StringBuilder();for(byte v:MessageDigest.getInstance("SHA-256").digest(bytes))result.append(String.format(java.util.Locale.ROOT,"%02x",v&255));return result.toString();}catch(NoSuchAlgorithmException error){throw new IOException(error);}}
    private static void checkCancelled() throws IOException {require(!Thread.currentThread().isInterrupted(),"Stellar validation cancelled");}
    private static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
