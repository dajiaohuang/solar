package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** Consistency-validated receipt, not an independent astrometric calculation. */
public final class StellarObserverReport {
    public static final int MAX_BYTES=14*1024*1024;
    public final String sourceId,utc,refractionStatus,catalogVersion,catalogManifestSha256,earthOrientationSha256;
    public final double raDeg,decDeg,azimuthDeg,altitudeDeg,cirsRaDeg,cirsDecDeg,solarElongationDeg;
    public final boolean solarDeflectionLimited;
    private final byte[] original;
    private final double[] coordinate,epoch,refracted,catalogState;
    private final String[] notes;
    private StellarObserverReport(byte[] raw,StellarObserverRequest request,Map<String,Object> envelope,Map<String,Object> experiment,
                                  Map<String,Object> observed,double[] coordinate,double[] epoch,double[] airless,double[] refracted,double[] catalogState) throws IOException {
        original=raw.clone();sourceId=request.sourceId;utc=request.utc;
        this.coordinate=coordinate;this.epoch=epoch;this.refracted=refracted;this.catalogState=catalogState;
        raDeg=number(experiment.get("raDeg"));decDeg=number(experiment.get("decDeg"));azimuthDeg=airless[0];altitudeDeg=airless[1];
        cirsRaDeg=number(observed.get("cirsRaDeg"));cirsDecDeg=number(observed.get("cirsDecDeg"));solarElongationDeg=number(observed.get("solarElongationDeg"));
        solarDeflectionLimited=bool(observed.get("solarDeflectionLimited"));refractionStatus=text(observed.get("refractionStatus"));
        catalogVersion=text(envelope.get("catalogVersion"));catalogManifestSha256=hash(envelope.get("catalogManifestSha256"));
        earthOrientationSha256=hash(object(envelope.get("earthOrientation")).get("sha256"));
        java.util.ArrayList<String> collected=new java.util.ArrayList<>();
        for(Object group:Arrays.asList(experiment.get("limitations"),object(experiment.get("observation")).get("warnings"),observed.get("warnings"),observed.get("limitations")))
            for(Object note:list(group))collected.add(text(note));
        notes=collected.toArray(new String[0]);
    }
    public byte[] exportBytes(){return original.clone();}
    public double[] coordinateDirection(){return coordinate.clone();}
    public double[] epochTdbParts(){return epoch.clone();}
    public double[] refractedDirection(){return refracted==null?null:refracted.clone();}
    public double[] catalogState(){return catalogState.clone();}
    public String[] notes(){return notes.clone();}

    public static StellarObserverReport decode(byte[] raw,StellarObserverRequest request) throws IOException {
        require(raw!=null && raw.length>0 && raw.length<=MAX_BYTES,"Stellar observer response budget exceeded");checkCancelled();
        Map<String,Object> envelope=object(StateTileDecoder.parseJson(raw)),e=object(envelope.get("experiment"));
        require("solar.api/v1".equals(envelope.get("apiVersion")) && number(e.get("schemaVersion"))==1
            && "source-gaia-starpm-pmpx-earth-station-v1".equals(e.get("model")),"Stellar observer identity mismatch");
        text(envelope.get("catalogVersion"));hash(envelope.get("catalogManifestSha256"));texts(e.get("limitations"),true);
        Map<String,Object> observation=object(e.get("observation")),echo=object(observation.get("request")),station=object(echo.get("station"));
        require("earth-station-iau2006-2000a-spk-v1".equals(observation.get("model")) && request.utc.equals(echo.get("utc"))
            && Arrays.asList("naif:10").equals(echo.get("bodyIds")) && number(station.get("longitudeDeg"))==request.longitudeDeg
            && number(station.get("latitudeDeg"))==request.latitudeDeg && number(station.get("heightMeters"))==request.heightMeters,"Stellar station echo mismatch");
        if(request.atmosphere==null)require(echo.get("atmosphere")==null,"Unrequested atmosphere");
        else {
            Map<String,Object> a=object(echo.get("atmosphere"));StellarObserverRequest.Atmosphere wanted=request.atmosphere;
            require(number(a.get("pressureHPa"))==wanted.pressureHPa && number(a.get("temperatureC"))==wanted.temperatureC
                && number(a.get("relativeHumidity"))==wanted.relativeHumidity && number(a.get("wavelengthMicrometers"))==wanted.wavelengthMicrometers,"Stellar atmosphere echo mismatch");
        }
        Map<String,Object> manifest=object(envelope.get("earthOrientation")),sample=object(observation.get("earthOrientation"));
        String eopHash=hash(manifest.get("sha256")),retrieved=text(manifest.get("retrievedAt"));
        require("https://data.iers.org/products/eop/rapid/standard/finals2000A.all".equals(manifest.get("sourceUrl"))
            && eopHash.equals(sample.get("sourceSha256")) && retrieved.equals(sample.get("retrievedAt")),"Stellar EOP identity mismatch");
        bool(sample.get("predicted"));bool(sample.get("celestialPoleCorrectionAvailable"));
        number(sample.get("xpArcsec"));number(sample.get("ypArcsec"));number(sample.get("ut1MinusUtcSeconds"));
        double jd=number(observation.get("jdTdb"));number(observation.get("jdTt"));number(observation.get("jdUt1"));texts(observation.get("warnings"),false);
        Map<String,Object> contract=object(observation.get("contract")),observer=object(observation.get("observerState"));
        require("J2000".equals(observer.get("frame")) && "solar-system-barycenter".equals(observer.get("origin"))
            && "J2000".equals(contract.get("vectorFrame")) && "km".equals(contract.get("vectorUnit"))
            && "observer-at-reception".equals(contract.get("vectorOrigin")) && "WGS84-ellipsoidal-height".equals(contract.get("stationDatum"))
            && "deg".equals(contract.get("angleUnit")) && "north-zero-east-positive".equals(contract.get("azimuthConvention"))
            && "not-propagated".equals(contract.get("physicalUncertainty"))
            && "SOFA-Apco; terrestrial rotation plus source Earth barycentric state".equals(contract.get("observerStateModel")),"Stellar observer vector contract mismatch");
        vector(observer.get("positionKm"),3);vector(observer.get("velocityKmPerSecond"),3);
        double[] epoch=vector(e.get("epochJdTdbParts"),2),observerEpoch=vector(observer.get("epochJdTdbParts"),2);
        require(Arrays.equals(epoch,observerEpoch) && epoch[0]+epoch[1]==jd && Math.abs(epoch[0])<=10000000 && Math.abs(epoch[1])<=10000000,"Stellar observer epoch mismatch");
        List<?> sources=list(observation.get("sources"));require(sources.size()>=2 && sources.size()<=512,"Stellar SPK source budget mismatch");
        boolean earth=false,sun=false;
        for(Object rawSource:sources){Map<String,Object> source=object(rawSource);String id=text(source.get("bodyId"));text(source.get("source"));hash(source.get("kernelSha256"));
            double start=number(source.get("startJdTdb")),end=number(source.get("endJdTdb"));require(start<=end,"Invalid SPK interval");
            if(start<=jd && end>=jd){earth|=id.equals("naif:399");sun|=id.equals("naif:10");}}
        require(earth && sun,"Earth/Sun reception source coverage missing");
        validateSun(observation.get("bodies"),request.atmosphere!=null);
        Map<String,Object> stellar=object(e.get("stellar")),nominal=object(stellar.get("result"));
        double year=number(nominal.get("targetEpochJulianYearTCB"));
        double tdbOffset=(epoch[0]-2451545)+epoch[1];
        double elapsed1977=(epoch[0]-2443144.5)+(epoch[1]-32.184/86400);
        double tcbOffset=tdbOffset+(1.550519768e-8*elapsed1977+6.55e-5/86400)/(1-1.550519768e-8);
        require(Math.abs((year-(2000+tcbOffset/365.25))*365.25*86400)<=2e-6,"Stellar TCB year does not match observer");
        StellarMotionRequest nested=new StellarMotionRequest(request.manifestBytes(),request.rowsBytes(),request.sourceId,year,StellarMotionRequest.RV_POLICY,null);
        double[] catalogState=StellarMotionReport.validateExperiment(stellar,nested).state;
        double[] target=vector(nominal.get("targetJdTdbParts"),2);
        double residual=((epoch[0]-target[0])+(epoch[1]-target[1]))/365.25;
        require(Math.abs(number(e.get("propagationResidualTdbJulianYears"))-residual)*365.25*86400<=2e-6,"Stellar residual epoch mismatch");
        double[] coordinate=unit(e.get("coordinateDirectionBcrs"));double ra=angle(e.get("raDeg"),0,360,false),dec=angle(e.get("decDeg"),-90,90,true);
        double r=ra*Math.PI/180,d=dec*Math.PI/180;double[] expected={Math.cos(r)*Math.cos(d),Math.sin(r)*Math.cos(d),Math.sin(d)};
        for(int i=0;i<3;i++)require(Math.abs(coordinate[i]-expected[i])<=1e-12,"Stellar direction/angle mismatch");
        Map<String,Object> observed=object(e.get("observed"));require("sofa-ldsun-ab-cirs-atioq-v1".equals(observed.get("model")),"Stellar observed model mismatch");
        unit(observed.get("properDirectionGcrs"));angle(observed.get("cirsRaDeg"),0,360,false);angle(observed.get("cirsDecDeg"),-90,90,true);
        angle(observed.get("solarElongationDeg"),0,180,true);texts(observed.get("limitations"),true);List<?> warnings=texts(observed.get("warnings"),false);
        require(warnings.contains("solar-deflection-limited-near-solar-center")==bool(observed.get("solarDeflectionLimited")),"Solar limiter warning mismatch");
        double[] airless=direction(observed.get("apparentAirless"));String status=request.atmosphere==null?"not-requested":airless[1]<5?"outside-altitude-domain":"applied";
        require(status.equals(observed.get("refractionStatus")) && warnings.contains("refraction-outside-supported-altitude-at-least-5-deg")==status.equals("outside-altitude-domain"),"Stellar refraction status mismatch");
        double[] refracted=null;if(status.equals("applied"))refracted=direction(observed.get("refracted"));else require(observed.get("refracted")==null,"Unexpected refracted result");
        checkCancelled();return new StellarObserverReport(raw,request,envelope,e,observed,coordinate,epoch,airless,refracted,catalogState);
    }

    private static void validateSun(Object raw,boolean atmosphere) throws IOException {
        List<?> bodies=list(raw);require(bodies.size()==1,"Unexpected stellar observer bodies");Map<String,Object> b=object(bodies.get(0));
        require("naif:10".equals(b.get("bodyId")),"Unexpected stellar observer body");texts(b.get("warnings"),false);
        if("available".equals(b.get("status"))){direction(b.get("geometric"));direction(b.get("apparentAirless"));
            if(b.get("refracted")!=null){require(atmosphere,"Unrequested solar refraction");direction(b.get("refracted"));}
            require(number(b.get("lightTimeRangeKm"))>0 && number(b.get("lightTimeSeconds"))>0,"Invalid solar range");
            vector(b.get("geometricPositionKm"),3);vector(b.get("receptionPositionKm"),3);
            double residual=number(b.get("lightTimeResidualSeconds"));require(residual>=0 && residual<=0.00005,"Invalid solar light-time residual");
        }else{require("missing".equals(b.get("status")),"Invalid solar status");text(b.get("missingReason"));
            for(String key:Arrays.asList("geometric","apparentAirless","refracted","geometricPositionKm","receptionPositionKm","lightTimeResidualSeconds"))require(b.get(key)==null,"Contradictory missing solar state");}
    }
    @SuppressWarnings("unchecked") private static Map<String,Object> object(Object v)throws IOException{require(v instanceof Map,"Stellar observer object required");return(Map<String,Object>)v;}
    private static List<?> list(Object v)throws IOException{require(v instanceof List,"Stellar observer array required");return(List<?>)v;}
    private static String text(Object v)throws IOException{require(v instanceof String && !((String)v).isEmpty(),"Stellar observer text required");return(String)v;}
    private static String hash(Object v)throws IOException{String s=text(v);require(s.matches("[a-f0-9]{64}"),"Stellar observer hash required");return s;}
    private static List<?> texts(Object v,boolean nonempty)throws IOException{List<?> a=list(v);require(!nonempty||!a.isEmpty(),"Stellar observer limits missing");for(Object x:a)text(x);return a;}
    private static double number(Object v)throws IOException{require(v instanceof Number && Double.isFinite(((Number)v).doubleValue()),"Finite stellar observer number required");return((Number)v).doubleValue();}
    private static boolean bool(Object v)throws IOException{require(v instanceof Boolean,"Stellar observer boolean required");return(Boolean)v;}
    private static double[] vector(Object v,int n)throws IOException{List<?> a=list(v);require(a.size()==n,"Stellar observer vector shape mismatch");double[] out=new double[n];for(int i=0;i<n;i++)out[i]=number(a.get(i));return out;}
    private static double[] unit(Object v)throws IOException{double[] a=vector(v,3);require(Math.abs(Math.hypot(Math.hypot(a[0],a[1]),a[2])-1)<=1e-12,"Stellar unit direction required");return a;}
    private static double angle(Object v,double min,double max,boolean inclusive)throws IOException{double n=number(v);require(n>=min && (inclusive?n<=max:n<max),"Stellar angle domain mismatch");return n;}
    private static double[] direction(Object v)throws IOException{Map<String,Object>d=object(v);return new double[]{angle(d.get("azimuthDeg"),0,360,false),angle(d.get("altitudeDeg"),-90,90,true)};}
    private static void checkCancelled()throws IOException{require(!Thread.currentThread().isInterrupted(),"Stellar observer validation cancelled");}
    private static void require(boolean value,String message)throws IOException{if(!value)throw new IOException(message);}
}
