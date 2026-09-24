package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Source-bearing station request. The backend derives the stellar epoch from
 * UTC; no placeholder catalog epoch or invented station/weather is sent. */
public final class StellarObserverRequest {
    public final String sourceId, utc;
    public final double longitudeDeg, latitudeDeg, heightMeters;
    public final Atmosphere atmosphere;
    private final byte[] manifest, rows;

    public static final class Atmosphere {
        public final double pressureHPa, temperatureC, relativeHumidity, wavelengthMicrometers;
        public Atmosphere(double pressure, double temperature, double humidity, double wavelength) throws IOException {
            require(Double.isFinite(pressure) && pressure>=0 && pressure<=1100 && Double.isFinite(temperature) && temperature>=-100 && temperature<=100
                && Double.isFinite(humidity) && humidity>=0 && humidity<=1 && Double.isFinite(wavelength) && wavelength>=0.1 && wavelength<=1e6,"Invalid stellar atmosphere");
            pressureHPa=pressure; temperatureC=temperature; relativeHumidity=humidity; wavelengthMicrometers=wavelength;
        }
        String json() {
            return "{\"pressureHPa\":"+pressureHPa+",\"temperatureC\":"+temperatureC+",\"relativeHumidity\":"+relativeHumidity+",\"wavelengthMicrometers\":"+wavelengthMicrometers+"}";
        }
    }

    public StellarObserverRequest(byte[] manifest, byte[] rows, String sourceId, String policy, String utc,
                                  double longitude, double latitude, double height, Atmosphere atmosphere) throws IOException {
        StellarMotionRequest.validateOriginalSources(manifest,rows,sourceId,policy);
        require(utc!=null && utc.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z"),"Explicit ISO UTC Z required");
        // Calendar/leap-second validity remains authoritative in SOFA.
        require(Double.isFinite(longitude) && Math.abs(longitude)<=180 && Double.isFinite(latitude) && Math.abs(latitude)<=90
            && Double.isFinite(height) && height>=-1000 && height<=100000,"Invalid WGS84 stellar station");
        this.manifest=manifest.clone(); this.rows=rows.clone(); this.sourceId=sourceId; this.utc=utc;
        longitudeDeg=longitude; latitudeDeg=latitude; heightMeters=height; this.atmosphere=atmosphere;
    }
    public byte[] manifestBytes() { return manifest.clone(); }
    public byte[] rowsBytes() { return rows.clone(); }
    public byte[] bytes() throws IOException {
        require(!Thread.currentThread().isInterrupted(),"Stellar observer encoding cancelled");
        // All inserted strings are constrained ASCII UTC, decimal ID, base64 or
        // fixed policy text; all numbers are finite and range-checked.
        String json="{\"originalManifestBase64\":\""+StellarMotionRequest.base64(manifest)
            +"\",\"originalRowsCsvBase64\":\""+StellarMotionRequest.base64(rows)+"\",\"sourceId\":\""+sourceId
            +"\",\"radialVelocityPolicy\":\""+StellarMotionRequest.RV_POLICY+"\",\"utc\":\""+utc
            +"\",\"station\":{\"longitudeDeg\":"+longitudeDeg+",\"latitudeDeg\":"+latitudeDeg+",\"heightMeters\":"+heightMeters+"}"
            +(atmosphere==null?"":",\"atmosphere\":"+atmosphere.json())+"}";
        byte[] result=json.getBytes(StandardCharsets.UTF_8);
        require(result.length<=26*1024*1024,"Stellar observer wire request exceeds 26 MiB");
        require(!Thread.currentThread().isInterrupted(),"Stellar observer encoding cancelled");
        return result;
    }
    private static void require(boolean condition,String message) throws IOException { if(!condition)throw new IOException(message); }
}
