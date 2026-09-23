package io.github.dajiaohuang.solaratlas;

import org.junit.Test;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import static org.junit.Assert.*;

public final class StellarMotionReportTest {
    private static byte[] fixture(String file) throws IOException {
        Path root=Paths.get("").toAbsolutePath();
        while(root!=null){Path path=root.resolve("tests/fixtures/"+file);if(Files.exists(path))return Files.readAllBytes(path);root=root.getParent();}
        throw new IOException("Stellar fixture missing");
    }
    private static StellarMotionRequest request(boolean covariance) throws IOException {
        return new StellarMotionRequest(fixture("gaia-six-20260923/manifest.json"),fixture("gaia-six-20260923/rows.csv"),"65212004581252736",2026,StellarMotionRequest.RV_POLICY,covariance?StellarMotionRequest.COVARIANCE_POLICY:null);
    }
    private static byte[] response(boolean covariance) throws IOException {
        return ("{\"apiVersion\":\"solar.api/v1\",\"experiment\":"+new String(fixture(covariance?"gaia-motion-covariance-experiment.json":"gaia-motion-experiment.json"),StandardCharsets.UTF_8)+"}").getBytes(StandardCharsets.UTF_8);
    }
    @Test public void actualGoOutputsRetainStateCovarianceAndExactExportBytes() throws Exception {
        for(boolean covariance:new boolean[]{false,true}) {
            byte[] bytes=response(covariance);StellarMotionReport result=StellarMotionReport.decode(bytes,request(covariance));
            assertEquals("65212004581252736",result.sourceId);assertEquals(2026,result.epoch,0);
            assertEquals(56.692944329,result.state()[0],1e-9);
            assertArrayEquals(bytes,result.exportBytes());byte[] copy=result.exportBytes();copy[0]=0;assertArrayEquals(bytes,result.exportBytes());
            if(covariance){assertNotNull(result.formalStandardDeviations());assertEquals(.357911,result.formalStandardDeviations()[0],1e-6);double[] s=result.formalStandardDeviations();s[0]=0;assertTrue(result.formalStandardDeviations()[0]>0);}
            else assertNull(result.formalStandardDeviations());
        }
    }
    @Test public void alteredSourcesMatricesAndPoliciesAreRefused() throws Exception {
        String raw=new String(response(true),StandardCharsets.UTF_8);
        for(String[] mutation:new String[][]{
            {"first-order-starpm-covariance-v1","wrong-model"},{"independent-spectroscopic-rv","unknown-policy"},
            {"\"inputMatrix\"","\"missingMatrix\""},{"\"jacobian\"","\"missingJacobian\""},
            {"radial-velocity","pseudocolour"},{"\"radial_velocity\": 10.600615","\"radial_velocity\": 0"},
            {"\"sourceId\": \"65212004581252736\"","\"sourceId\": \"1\""}
        }) {
            assertTrue("mutation must apply",raw.contains(mutation[0]));
            try{StellarMotionReport.decode(raw.replace(mutation[0],mutation[1]).getBytes(StandardCharsets.UTF_8),request(true));fail(mutation[0]);}catch(IOException expected){}
        }
        try{StellarMotionReport.decode(response(true),request(false));fail();}catch(IOException expected){}
        try{StellarMotionReport.decode(response(false),request(true));fail();}catch(IOException expected){}
        try{StellarMotionReport.decode(new byte[StellarMotionReport.MAX_BYTES+1],request(false));fail();}catch(IOException expected){}
    }
    @Test public void interruptedValidationNeverPublishesAReport() throws Exception {
        byte[] bytes=response(true);StellarMotionRequest request=request(true);
        Thread.currentThread().interrupt();
        try{StellarMotionReport.decode(bytes,request);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("cancelled"));}finally{Thread.interrupted();}
    }
}
