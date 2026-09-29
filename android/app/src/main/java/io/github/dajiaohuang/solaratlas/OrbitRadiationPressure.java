package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.CharBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Explicit fixed, unshadowed radial SRP parameters; no inferred defaults. */
public final class OrbitRadiationPressure {
    public final double pressure,area,mass,reflectivity;
    public final String source;
    public OrbitRadiationPressure(double pressure,double area,double mass,double reflectivity,String source) throws IOException {
        for(double value:new double[]{pressure,area,mass,reflectivity})require(Double.isFinite(value)&&value>0,"Positive finite SRP pressure, area, mass and reflectivity required");
        require(source!=null&&!source.trim().isEmpty(),"SRP source required");
        int size=StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(source)).remaining();
        require(size<=8192,"SRP source exceeds 8192 UTF-8 bytes");double amplitude=pressure*reflectivity*(area/mass)/1000;
        require(Double.isFinite(amplitude)&&amplitude>0,"SRP amplitude is not representable");
        this.pressure=pressure;this.area=area;this.mass=mass;this.reflectivity=reflectivity;this.source=source;
    }
    String json(){return "{\"model\":\"constant-radial-srp\",\"illumination\":\"unshadowed\",\"pressureAt1AuNewtonPerSquareMeter\":"+pressure+",\"areaSquareMeters\":"+area+",\"massKg\":"+mass+",\"reflectivityCoefficient\":"+reflectivity+",\"source\":"+OrbitCovarianceRequest.quote(source)+"}";}
    void bind(Map<String,Object> value) throws IOException {
        require(value.size()==7&&"constant-radial-srp".equals(value.get("model"))&&"unshadowed".equals(value.get("illumination"))&&source.equals(value.get("source")),"SRP model/source mismatch");
        String[] fields={"pressureAt1AuNewtonPerSquareMeter","areaSquareMeters","massKg","reflectivityCoefficient"};double[] expected={pressure,area,mass,reflectivity};
        for(int i=0;i<fields.length;i++){Object raw=value.get(fields[i]);require(raw instanceof Number&&((Number)raw).doubleValue()==expected[i],"SRP parameter mismatch");}
    }
    private static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
