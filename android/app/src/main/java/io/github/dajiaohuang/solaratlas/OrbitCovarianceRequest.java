package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.CharBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Owns original SBDB bytes and an explicitly adopted, source-labelled GM. */
public final class OrbitCovarianceRequest {
    public static final int MAX_SOURCE_BYTES=2*1024*1024;
    public final double gmAU3PerDay2;
    public final String gmSource;
    private final byte[] original;
    public OrbitCovarianceRequest(byte[] original,double gm,String source) throws IOException {
        require(original!=null && original.length>0 && original.length<=MAX_SOURCE_BYTES,"Original SBDB JSON must be 1 byte to 2 MiB");
        require(Double.isFinite(gm) && gm>0,"Explicit positive solar GM in au^3/day^2 required");
        require(source!=null && !source.trim().isEmpty(),"Solar GM source required");
        int sourceBytes=StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(source)).remaining();
        require(sourceBytes<=4096,"Solar GM source exceeds 4096 UTF-8 bytes");
        this.original=original.clone();gmAU3PerDay2=gm;gmSource=source;
    }
    public byte[] originalBytes(){return original.clone();}
    public byte[] bytes() throws IOException {
        byte[] result=("{\"originalSbdbBase64\":\""+StellarMotionRequest.base64(original)+"\",\"adoptedSolarGM\":{\"au3PerDay2\":"+Double.toString(gmAU3PerDay2)+",\"source\":"+quote(gmSource)+"}}").getBytes(StandardCharsets.UTF_8);
        require(result.length<=3*1024*1024,"Orbit covariance request exceeds 3 MiB");return result;
    }
    static String quote(String text){StringBuilder result=new StringBuilder("\"");for(int i=0;i<text.length();i++){char c=text.charAt(i);if(c=='"'||c=='\\')result.append('\\').append(c);else if(c<0x20)result.append(String.format(java.util.Locale.ROOT,"\\u%04x",(int)c));else result.append(c);}return result.append('"').toString();}
    private static void require(boolean condition,String message) throws IOException {if(!condition)throw new IOException(message);}
}
