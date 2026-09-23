package io.github.dajiaohuang.solaratlas;

import java.io.ByteArrayOutputStream;
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
    private final URL endpoint;
    private final ConnectionFactory factory;
    private final long timeoutMillis;
    private volatile boolean cancelled, expired;
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
    }
    public StellarMotionReport load(StellarMotionRequest request) throws IOException {
        require(request!=null,"Stellar request required");
        synchronized(this){check();require(!running,"Stellar request already running");running=true;}
        ScheduledThreadPoolExecutor timer=new ScheduledThreadPoolExecutor(1,runnable->{Thread thread=new Thread(runnable,"solar-stellar-deadline");thread.setDaemon(true);return thread;});
        timer.setRemoveOnCancelPolicy(true);
        ScheduledFuture<?> deadline=timer.schedule(()->{expired=true;close();},timeoutMillis,TimeUnit.MILLISECONDS);
        HttpURLConnection connection=null;
        try {
            check();byte[] payload=request.bytes();check();connection=factory.open(endpoint);
            synchronized(this){check();active=connection;}
            connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setUseCaches(false);connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout((int)Math.min(10000,timeoutMillis));connection.setReadTimeout((int)timeoutMillis);
            connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Accept","application/json");connection.setFixedLengthStreamingMode(payload.length);
            try(OutputStream output=connection.getOutputStream()){check();output.write(payload);}
            check();int status=connection.getResponseCode();check();
            require(status<300 || status>=400,"Stellar redirects are not followed");
            String type=connection.getContentType();long length=connection.getContentLengthLong();
            require(type!=null && "application/json".equalsIgnoreCase(type.split(";",2)[0].trim()) && length>0 && length<=StellarMotionReport.MAX_BYTES,"Stellar response content type or length invalid");
            byte[] raw=readBody(status>=400?connection.getErrorStream():connection.getInputStream(),(int)length);
            if(status!=200){Map<String,Object> error=GroundContactsReport.object(GroundContactsReport.object(StateTileDecoder.parseJson(raw)).get("error"));throw new IOException("HTTP "+status+" · "+GroundContactsReport.text(error.get("code"))+": "+GroundContactsReport.text(error.get("message")));}
            check();StellarMotionReport report=StellarMotionReport.decode(raw,request);check();return report;
        } catch(IOException error) {check();throw error;} finally {
            deadline.cancel(false);timer.shutdownNow();
            synchronized(this){active=null;running=false;}
            if(connection!=null)connection.disconnect();
        }
    }
    byte[] readBody(InputStream input,int expected) throws IOException {
        require(input!=null && expected>0 && expected<=StellarMotionReport.MAX_BYTES,"Stellar body exceeds bounds");
        try(InputStream source=input;ByteArrayOutputStream output=new ByteArrayOutputStream(expected)){
            byte[] chunk=new byte[Math.min(expected,16384)];int total=0;
            while(true){
                check();int count=source.read(chunk);check();if(count<0)break;
                if(count==0){check();int value=source.read();check();if(value<0)break;require(total<expected,"Stellar body exceeds declared length");output.write(value);total++;continue;}
                require(count<=expected-total,"Stellar body exceeds declared length");output.write(chunk,0,count);total+=count;
            }
            check();require(total==expected,"Stellar body is truncated");return output.toByteArray();
        }
    }
    private void check() throws IOException {require(!expired,"Stellar request deadline exceeded");require(!cancelled && !Thread.currentThread().isInterrupted(),"Stellar request cancelled");}
    @Override public void close(){HttpURLConnection connection;synchronized(this){cancelled=true;connection=active;}if(connection!=null)connection.disconnect();}
    private static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
