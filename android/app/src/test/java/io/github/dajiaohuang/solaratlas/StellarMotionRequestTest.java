package io.github.dajiaohuang.solaratlas;

import org.junit.Test;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.Map;
import static org.junit.Assert.*;

public final class StellarMotionRequestTest {
    private static byte[] fixture(String file) throws IOException {
        Path root=Paths.get("").toAbsolutePath();
        while(root!=null) {Path path=root.resolve("tests/fixtures/gaia-six-20260923/"+file);if(Files.exists(path))return Files.readAllBytes(path);root=root.getParent();}
        throw new IOException("Original Gaia fixture missing");
    }
    @Test public void originalBytesAndLargeSourceIdentitySurviveWireEncoding() throws Exception {
        byte[] manifest=fixture("manifest.json"), rows=fixture("rows.csv");
        StellarMotionRequest request=new StellarMotionRequest(manifest,rows,"65212004581252736",2026,StellarMotionRequest.RV_POLICY,StellarMotionRequest.COVARIANCE_POLICY);
        Map<String,Object> wire=GroundContactsReport.object(StateTileDecoder.parseJson(request.bytes()));
        assertEquals("65212004581252736",wire.get("sourceId"));
        assertArrayEquals(manifest,Base64.getDecoder().decode((String)wire.get("originalManifestBase64")));
        assertArrayEquals(rows,Base64.getDecoder().decode((String)wire.get("originalRowsCsvBase64")));
        assertEquals(StellarMotionRequest.COVARIANCE_POLICY,wire.get("covariancePolicy"));
        manifest[0]=0;rows[0]=0;
        assertArrayEquals(fixture("manifest.json"),request.manifestBytes());
        assertArrayEquals(fixture("rows.csv"),request.rowsBytes());
        byte[] copy=request.rowsBytes();copy[0]=0;assertArrayEquals(fixture("rows.csv"),request.rowsBytes());
    }
    @Test public void covarianceIsNeverAssumedAndInvalidInputsAreRejected() throws Exception {
        byte[] m=fixture("manifest.json"),r=fixture("rows.csv");
        StellarMotionRequest nominal=new StellarMotionRequest(m,r,"65212004581252736",2026,StellarMotionRequest.RV_POLICY,null);
        assertFalse(GroundContactsReport.object(StateTileDecoder.parseJson(nominal.bytes())).containsKey("covariancePolicy"));
        for(String id:new String[]{"065212004581252736","9223372036854775808","1e16","1\"","0"}) {
            try {new StellarMotionRequest(m,r,id,2026,StellarMotionRequest.RV_POLICY,null);fail(id);}catch(IOException expected){}
        }
        for(double year:new double[]{Double.NaN,Double.POSITIVE_INFINITY,1915.999,2116.001}) {
            try {new StellarMotionRequest(m,r,"1",year,StellarMotionRequest.RV_POLICY,null);fail();}catch(IOException expected){}
        }
        try {new StellarMotionRequest(m,r,"1",2026,"",null);fail();}catch(IOException expected){}
        try {new StellarMotionRequest(m,r,"1",2026,StellarMotionRequest.RV_POLICY,"unknown");fail();}catch(IOException expected){}
        try {new StellarMotionRequest(new byte[1024*1024+1],r,"1",2026,StellarMotionRequest.RV_POLICY,null);fail();}catch(IOException expected){}
        try {new StellarMotionRequest(m,new byte[8*1024*1024+1],"1",2026,StellarMotionRequest.RV_POLICY,null);fail();}catch(IOException expected){}
    }
}
