package io.github.dajiaohuang.solaratlas;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** One active HTTPS analysis per instance; call off the UI thread and close on
 * lifecycle/input changes. A closed or expired instance cannot be reused. */
public final class StellarMotionService implements Closeable {
    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }
    private final URL endpoint, observerEndpoint, covarianceEndpoint, propagationEndpoint, ensembleEndpoint, eventEndpoint;
    private final ConnectionFactory factory;
    private final long timeoutMillis;
    private volatile boolean cancelled, expired;
    private volatile Long deadlineNanos;
    private boolean running;
    private HttpURLConnection active;
    public StellarMotionService(String address) throws IOException {
        this(address,url -> (HttpURLConnection)url.openConnection(),25000);
    }
    StellarMotionService(String address,ConnectionFactory factory,long timeoutMillis) throws IOException {
        require(address!=null,"HTTPS backend required");URL url=new URL(address.trim());
        require("https".equalsIgnoreCase(url.getProtocol()) && !url.getHost().isEmpty() && url.getUserInfo()==null && url.getQuery()==null && url.getRef()==null,"HTTPS backend without credentials, query or fragment required");
        require(timeoutMillis>0 && timeoutMillis<=25000,"Invalid stellar request deadline");
        endpoint=new URL(address.trim().replaceAll("/+\\z","")+"/v1/stellar/motion");this.factory=factory;this.timeoutMillis=timeoutMillis;
        observerEndpoint=new URL(address.trim().replaceAll("/+\\z","")+"/v1/stellar/observer");
        covarianceEndpoint=new URL(address.trim().replaceAll("/+\\z","")+"/v1/orbit/covariance/convert");
        propagationEndpoint=new URL(address.trim().replaceAll("/+\\z","")+"/v1/orbit/covariance/propagate");
        ensembleEndpoint=new URL(address.trim().replaceAll("/+\\z","")+"/v1/orbit/covariance/ensemble");
        eventEndpoint=new URL(address.trim().replaceAll("/+\\z","")+"/v1/orbit/covariance/ensemble/events");
    }
    public StellarMotionReport load(StellarMotionRequest request) throws IOException {
        require(request!=null,"Stellar request required");
        return execute(endpoint,request::bytes,raw->StellarMotionReport.decode(raw,request));
    }
    public StellarObserverReport loadObserver(StellarObserverRequest request) throws IOException {
        require(request!=null,"Stellar observer request required");
        return execute(observerEndpoint,request::bytes,raw->StellarObserverReport.decode(raw,request));
    }
    public OrbitCovarianceReport loadCovariance(OrbitCovarianceRequest request) throws IOException {
        require(request!=null,"Orbit covariance request required");
        return execute(covarianceEndpoint,request::bytes,raw->OrbitCovarianceReport.decode(raw,request),OrbitCovarianceReport.MAX_BYTES);
    }
    public OrbitPropagationReport loadPropagation(OrbitPropagationRequest request) throws IOException {
        require(request!=null,"Orbit propagation request required");
        return execute(propagationEndpoint,request::bytes,raw->OrbitPropagationReport.decode(raw,request),OrbitPropagationReport.MAX_BYTES);
    }
    public OrbitEnsembleReport loadEnsemble(OrbitEnsembleRequest request) throws IOException {
        require(request!=null,"Orbit ensemble request required");
        return execute(ensembleEndpoint,request::bytes,raw->OrbitEnsembleReport.decode(raw,request),OrbitEnsembleReport.MAX_BYTES);
    }
    public OrbitEventReport loadEvents(OrbitEventRequest request) throws IOException {
        require(request!=null,"Orbit event request required");
        return execute(eventEndpoint,request::bytes,raw->OrbitEventReport.decode(raw,request),OrbitEventReport.MAX_BYTES);
    }
    private interface Encoder { byte[] encode() throws IOException; }
    private interface Decoder<T> { T decode(byte[] raw) throws IOException; }
    private <T> T execute(URL target,Encoder encoder,Decoder<T> decoder) throws IOException {
        return execute(target,encoder,decoder,StellarMotionReport.MAX_BYTES);
    }
    private <T> T execute(URL target,Encoder encoder,Decoder<T> decoder,int maxBytes) throws IOException {
        synchronized(this){check();require(!running,"Stellar request already running");running=true;deadlineNanos=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeoutMillis);}
        ScheduledThreadPoolExecutor timer=new ScheduledThreadPoolExecutor(1,runnable->{Thread thread=new Thread(runnable,"solar-stellar-deadline");thread.setDaemon(true);return thread;});
        timer.setRemoveOnCancelPolicy(true);
        ScheduledFuture<?> deadline=timer.schedule(()->{expired=true;close();},timeoutMillis,TimeUnit.MILLISECONDS);
        HttpURLConnection connection=null;
        try {
            check();byte[] payload=encoder.encode();check();connection=factory.open(target);
            synchronized(this){check();active=connection;}
            connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setUseCaches(false);connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout((int)Math.min(10000,timeoutMillis));connection.setReadTimeout((int)timeoutMillis);
            connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Accept","application/json");connection.setFixedLengthStreamingMode(payload.length);
            try(OutputStream output=connection.getOutputStream()){check();output.write(payload);}
            check();int status=connection.getResponseCode();check();
            require(status<300 || status>=400,"Stellar redirects are not followed");
            String type=connection.getContentType();long length=connection.getContentLengthLong();
            require(type!=null && "application/json".equalsIgnoreCase(type.split(";",2)[0].trim()) && length>0 && length<=maxBytes,"Analysis response content type or length invalid");
            byte[] raw=readBody(status>=400?connection.getErrorStream():connection.getInputStream(),(int)length,maxBytes);
            if(status!=200){Map<String,Object> error=GroundContactsReport.object(GroundContactsReport.object(StateTileDecoder.parseJson(raw)).get("error"));throw new IOException("HTTP "+status+" · "+GroundContactsReport.text(error.get("code"))+": "+GroundContactsReport.text(error.get("message")));}
            check();T report=decoder.decode(raw);check();return report;
        } catch(IOException error) {check();throw error;} finally {
            deadline.cancel(false);timer.shutdownNow();
            synchronized(this){active=null;running=false;deadlineNanos=null;}
            if(connection!=null)connection.disconnect();
        }
    }
    byte[] readBody(InputStream input,int expected) throws IOException {
        return readBody(input,expected,StellarMotionReport.MAX_BYTES);
    }
    private byte[] readBody(InputStream input,int expected,int maxBytes) throws IOException {
        require(input!=null && expected>0 && expected<=maxBytes,"Analysis body exceeds bounds");
        try(InputStream source=input){
            check();byte[] output=new byte[expected];int total=0;
            while(total<expected){
                check();int count=source.read(output,total,Math.min(expected-total,16384));check();if(count<0)break;
                if(count==0){check();int value=source.read();check();if(value<0)break;output[total++]=(byte)value;continue;}
                require(count<=expected-total,"Stellar body exceeds declared length");total+=count;
            }
            check();require(total==expected,"Stellar body is truncated");
            int extra=source.read();check();require(extra<0,"Stellar body exceeds declared length");
            return output;
        }
    }
    private void check() throws IOException {
        Long limit=deadlineNanos;
        if(limit!=null && System.nanoTime()-limit>=0)expired=true;
        require(!expired,"Stellar request deadline exceeded");require(!cancelled && !Thread.currentThread().isInterrupted(),"Stellar request cancelled");
    }
    @Override public void close(){HttpURLConnection connection;synchronized(this){cancelled=true;connection=active;}if(connection!=null)connection.disconnect();}
    private static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
