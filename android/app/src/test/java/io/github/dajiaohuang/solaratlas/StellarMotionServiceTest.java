package io.github.dajiaohuang.solaratlas;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

public final class StellarMotionServiceTest {
    private static byte[] fixture(String file) throws IOException {Path root=Paths.get("").toAbsolutePath();while(root!=null){Path path=root.resolve("tests/fixtures/"+file);if(Files.exists(path))return Files.readAllBytes(path);root=root.getParent();}throw new IOException("Fixture missing");}
    private static StellarMotionRequest request() throws IOException {return new StellarMotionRequest(fixture("gaia-six-20260923/manifest.json"),fixture("gaia-six-20260923/rows.csv"),"65212004581252736",2026,StellarMotionRequest.RV_POLICY,StellarMotionRequest.COVARIANCE_POLICY);}
    private static byte[] response() throws IOException {return ("{\"apiVersion\":\"solar.api/v1\",\"experiment\":"+new String(fixture("gaia-motion-covariance-experiment.json"),StandardCharsets.UTF_8)+"}").getBytes(StandardCharsets.UTF_8);}
    private static class Transport extends HttpURLConnection {
        final byte[] response;final ByteArrayOutputStream sent=new ByteArrayOutputStream();final CountDownLatch disconnected=new CountDownLatch(1);
        int status=200;long length;String type="application/json";boolean stall, headerWaitStarted;
        Transport(URL url,byte[] response){super(url);this.response=response;length=response.length;}
        public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){disconnected.countDown();}
        public OutputStream getOutputStream(){return sent;}
        public int getResponseCode() throws IOException {if(stall){headerWaitStarted=true;try{if(!disconnected.await(2,TimeUnit.SECONDS))throw new IOException("No deadline disconnect");}catch(InterruptedException error){Thread.currentThread().interrupt();throw new IOException(error);}throw new IOException("Disconnected");}return status;}
        public String getContentType(){return type;}public long getContentLengthLong(){return length;}
        public InputStream getInputStream(){return new ByteArrayInputStream(response);}public InputStream getErrorStream(){return getInputStream();}
    }
    @Test public void boundedPostUsesExactRequestAndValidatedRealOutputReplay() throws Exception {
        byte[] raw=response();Transport[] transport=new Transport[1];StellarMotionRequest request=request();
        StellarMotionService service=new StellarMotionService("https://example.test/science/",url->{assertEquals("https://example.test/science/v1/stellar/motion",url.toString());return transport[0]=new Transport(url,raw);},25000);
        StellarMotionReport report=service.load(request);assertArrayEquals(raw,report.exportBytes());assertArrayEquals(request.bytes(),transport[0].sent.toByteArray());
        assertEquals("POST",transport[0].getRequestMethod());assertFalse(transport[0].getInstanceFollowRedirects());assertEquals(0,transport[0].disconnected.getCount());
    }
    @Test public void badTransportContractsRedirectsAndSourceErrorsFail() throws Exception {
        for(int kind=0;kind<5;kind++) {final int mutation=kind;byte[] raw=response();
            StellarMotionService service=new StellarMotionService("https://example.test",url->{Transport t=new Transport(url,raw);if(mutation==0)t.length--;if(mutation==1)t.length++;if(mutation==2)t.type="text/html";if(mutation==3)t.status=302;if(mutation==4)t.length=StellarMotionReport.MAX_BYTES+1;return t;},25000);
            try{service.load(request());fail("transport mutation "+kind);}catch(IOException expected){}
        }
        byte[] error="{\"error\":{\"code\":\"invalid_stellar_source\",\"message\":\"radial velocity missing\"}}".getBytes(StandardCharsets.UTF_8);
        StellarMotionService service=new StellarMotionService("https://example.test",url->{Transport t=new Transport(url,error);t.status=422;return t;},25000);
        try{service.load(request());fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("radial velocity missing"));}
    }
    @Test public void totalDeadlineDisconnectsAStalledHeaderAndPreCancellationAvoidsNetwork() throws Exception {
        byte[] raw=response();Transport[] opened=new Transport[1];
        StellarMotionService service=new StellarMotionService("https://example.test",url->{Transport t=new Transport(url,raw);t.stall=true;opened[0]=t;return t;},200);
        try{service.load(request());fail();}catch(IOException expected){assertTrue(expected.getMessage(),expected.getMessage().contains("deadline"));}
        assertNotNull(opened[0]);assertTrue(opened[0].headerWaitStarted);assertEquals(0,opened[0].disconnected.getCount());
        StellarMotionService cancelled=new StellarMotionService("https://example.test",url->{fail("cancelled request opened transport");return null;},25000);cancelled.close();
        try{cancelled.load(request());fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("cancelled"));}
    }
    @Test public void onlyCredentialFreeHttpsAndUncancelledBodiesAreAccepted() throws Exception {
        for(String url:new String[]{"http://example.test","https://u@example.test","https://example.test?q=x","https://example.test#x"}){try{new StellarMotionService(url);fail(url);}catch(IOException expected){}}
        StellarMotionService service=new StellarMotionService("https://example.test");byte[] raw=response();
        InputStream late=new ByteArrayInputStream(raw){public synchronized int read(byte[] bytes,int offset,int length){int count=super.read(bytes,offset,length);service.close();return count;}};
        try{service.readBody(late,raw.length);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("cancelled"));}
    }
    @Test public void zeroProgressAndEofCancellationCannotSpinOrPublish() throws Exception {
        for(int actual:new int[]{2,3,4}){
            StellarMotionService service=new StellarMotionService("https://example.test");
            int[] reads={0};boolean[] closed={false};
            InputStream zero=new InputStream(){
                int remaining=actual;
                public int read(byte[] bytes,int offset,int length){assertTrue("Reader must make progress",++reads[0]<=5);return remaining==0?-1:0;}
                public int read(){if(remaining==0)return -1;remaining--;return 7;}
                public void close(){closed[0]=true;}
            };
            try{assertArrayEquals(new byte[]{7,7,7},service.readBody(zero,3));assertEquals(3,actual);}
            catch(IOException error){assertNotEquals(3,actual);assertTrue(error.getMessage().contains(actual<3?"truncated":"exceeds"));}
            assertTrue(closed[0]);
        }
        StellarMotionService service=new StellarMotionService("https://example.test");
        boolean[] closed={false};
        InputStream eof=new ByteArrayInputStream(new byte[]{7}){
            public synchronized int read(byte[] bytes,int offset,int length){int n=super.read(bytes,offset,length);if(n<0)service.close();return n;}
            public void close(){closed[0]=true;}
        };
        try{service.readBody(eof,1);fail("Cancelled EOF published a body");}catch(IOException error){assertTrue(error.getMessage().contains("cancelled"));}
        assertTrue(closed[0]);
    }
}
