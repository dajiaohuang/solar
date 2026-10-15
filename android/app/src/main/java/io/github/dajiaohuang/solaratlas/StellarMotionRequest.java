package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Original-source wire request. Validation of scientific source content belongs
 * to the backend and response validator; this class never invents missing values. */
public final class StellarMotionRequest {
    public static final String RV_POLICY = "spectroscopic-as-astrometric";
    public static final String COVARIANCE_POLICY = "independent-spectroscopic-rv";
    public final String sourceId;
    public final double targetEpochJulianYearTCB;
    public final boolean formalCovariance;
    private final byte[] manifest, rows;

    public StellarMotionRequest(byte[] manifest, byte[] rows, String sourceId, double epoch,
                               String radialVelocityPolicy, String covariancePolicy) throws IOException {
        validateOriginalSources(manifest, rows, sourceId, radialVelocityPolicy);
        require(Double.isFinite(epoch) && Math.abs(epoch-2016) <= 100, "Target TCB Julian year must be within J1916 to J2116");
        require(covariancePolicy == null || COVARIANCE_POLICY.equals(covariancePolicy), "Explicit supported covariance policy or omission required");
        this.manifest = manifest.clone(); this.rows = rows.clone(); this.sourceId = sourceId;
        this.targetEpochJulianYearTCB = epoch; this.formalCovariance = covariancePolicy != null;
    }

    static void validateOriginalSources(byte[] manifest, byte[] rows, String sourceId, String radialVelocityPolicy) throws IOException {
        require(manifest != null && manifest.length > 0 && manifest.length <= 1024*1024, "Original manifest must be 1 byte to 1 MiB");
        require(rows != null && rows.length > 0 && rows.length <= 16*1024*1024, "Original CSV must be 1 byte to 16 MiB");
        require(sourceId != null && sourceId.matches("[1-9][0-9]{0,18}"), "Exact decimal Gaia source ID required");
        try { require(Long.parseLong(sourceId) > 0, "Positive source ID required"); }
        catch (NumberFormatException error) { throw new IOException("Source ID exceeds signed 64-bit range", error); }
        require(RV_POLICY.equals(radialVelocityPolicy), "Explicit spectroscopic radial-velocity approximation required");
    }

    public byte[] manifestBytes() { return manifest.clone(); }
    public byte[] rowsBytes() { return rows.clone(); }
    public byte[] bytes() throws IOException {
        // Every interpolated string is either validated decimal text, base64,
        // or a fixed policy constant; no arbitrary JSON string interpolation.
        String json = "{\"originalManifestBase64\":\""+base64(manifest)
            +"\",\"originalRowsCsvBase64\":\""+base64(rows)
            +"\",\"sourceId\":\""+sourceId+"\",\"targetEpochJulianYearTCB\":"+Double.toString(targetEpochJulianYearTCB)
            +",\"radialVelocityPolicy\":\""+RV_POLICY+"\""
            +(formalCovariance ? ",\"covariancePolicy\":\""+COVARIANCE_POLICY+"\"" : "")+"}";
        byte[] result = json.getBytes(StandardCharsets.UTF_8);
        require(result.length <= 26*1024*1024, "Stellar wire request exceeds 26 MiB");
        return result;
    }
    // java.util.Base64 requires Android API 26; this app also supports API 24/25.
    static String base64(byte[] bytes) {
        checkEncodingCancelled();
        final String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        char[] result=new char[4*((bytes.length+2)/3)];int out=0;
        for(int i=0;i<bytes.length;i+=3){
            if(i%12288==0)checkEncodingCancelled();
            int a=bytes[i]&255,b=i+1<bytes.length?bytes[i+1]&255:0,c=i+2<bytes.length?bytes[i+2]&255:0;
            result[out++]=alphabet.charAt(a>>>2);result[out++]=alphabet.charAt(((a&3)<<4)|(b>>>4));
            result[out++]=i+1<bytes.length?alphabet.charAt(((b&15)<<2)|(c>>>6)):'=';result[out++]=i+2<bytes.length?alphabet.charAt(c&63):'=';
        }
        checkEncodingCancelled();
        String encoded=new String(result);
        checkEncodingCancelled();return encoded;
    }
    private static void checkEncodingCancelled() {
        if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("Source encoding cancelled");
    }
    private static void require(boolean condition, String message) throws IOException { if (!condition) throw new IOException(message); }
}
