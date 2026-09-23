package io.github.dajiaohuang.solaratlas;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.function.BooleanSupplier;

/** Owns the provider stream and enforces actual bytes, even when reported size
 * is missing or wrong. Cancellation is checked before reads and after EOF. */
final class StellarSourceImport {
    private StellarSourceImport() {}
    static byte[] read(InputStream stream,int limit,BooleanSupplier cancelled) throws IOException {
        if(stream==null)throw new IOException("Source file unavailable");
        try(InputStream input=stream;ByteArrayOutputStream output=new ByteArrayOutputStream()){
            if(limit!=1024*1024 && limit!=8*1024*1024)throw new IOException("Unsupported source byte budget");
            byte[] chunk=new byte[16384];
            while(true){
                check(cancelled);int count=input.read(chunk);check(cancelled);
                if(count<0)break;
                if(count==0){int value=input.read();check(cancelled);if(value<0)break;if(output.size()==limit)throw new IOException("Original source exceeds byte budget");output.write(value);continue;}
                if(count>limit-output.size())throw new IOException("Original source exceeds byte budget");
                output.write(chunk,0,count);
            }
            check(cancelled);if(output.size()==0)throw new IOException("Original source is empty");return output.toByteArray();
        }
    }
    private static void check(BooleanSupplier cancelled) throws IOException {if(Thread.currentThread().isInterrupted()||cancelled.getAsBoolean())throw new IOException("Source import cancelled");}
}
