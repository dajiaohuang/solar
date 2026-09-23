package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

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
        require(manifest != null && manifest.length > 0 && manifest.length <= 1024*1024, "Original manifest must be 1 byte to 1 MiB");
        require(rows != null && rows.length > 0 && rows.length <= 8*1024*1024, "Original CSV must be 1 byte to 8 MiB");
        require(sourceId != null && sourceId.matches("[1-9][0-9]{0,18}"), "Exact decimal Gaia source ID required");
        try { require(Long.parseLong(sourceId) > 0, "Positive source ID required"); }
        catch (NumberFormatException error) { throw new IOException("Source ID exceeds signed 64-bit range", error); }
        require(Double.isFinite(epoch) && Math.abs(epoch-2016) <= 100, "Target TCB Julian year must be within J1916 to J2116");
        require(RV_POLICY.equals(radialVelocityPolicy), "Explicit spectroscopic radial-velocity approximation required");
        require(covariancePolicy == null || COVARIANCE_POLICY.equals(covariancePolicy), "Explicit supported covariance policy or omission required");
        this.manifest = manifest.clone(); this.rows = rows.clone(); this.sourceId = sourceId;
        this.targetEpochJulianYearTCB = epoch; this.formalCovariance = covariancePolicy != null;
    }

    public byte[] manifestBytes() { return manifest.clone(); }
    public byte[] rowsBytes() { return rows.clone(); }
    public byte[] bytes() throws IOException {
        // Every interpolated string is either validated decimal text, base64,
        // or a fixed policy constant; no arbitrary JSON string interpolation.
        String json = "{\"originalManifestBase64\":\""+Base64.getEncoder().encodeToString(manifest)
            +"\",\"originalRowsCsvBase64\":\""+Base64.getEncoder().encodeToString(rows)
            +"\",\"sourceId\":\""+sourceId+"\",\"targetEpochJulianYearTCB\":"+Double.toString(targetEpochJulianYearTCB)
            +",\"radialVelocityPolicy\":\""+RV_POLICY+"\""
            +(formalCovariance ? ",\"covariancePolicy\":\""+COVARIANCE_POLICY+"\"" : "")+"}";
        byte[] result = json.getBytes(StandardCharsets.UTF_8);
        require(result.length <= 13*1024*1024, "Stellar wire request exceeds 13 MiB");
        return result;
    }
    private static void require(boolean condition, String message) throws IOException { if (!condition) throw new IOException(message); }
}
