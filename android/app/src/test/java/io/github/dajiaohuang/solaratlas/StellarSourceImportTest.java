package io.github.dajiaohuang.solaratlas;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public final class StellarSourceImportTest {
    @Test public void exactLimitWorksAndLimitPlusOneIsNeverTruncated() throws Exception {
        for(int limit:new int[]{1024*1024,8*1024*1024}) {
            byte[] bytes=new byte[limit];for(int i=0;i<limit;i++)bytes[i]=(byte)(i*19);
            AtomicBoolean closed=new AtomicBoolean();
            ByteArrayInputStream input=new ByteArrayInputStream(bytes){public void close(){closed.set(true);}};
            assertArrayEquals(bytes,StellarSourceImport.read(input,limit,()->false));assertTrue(closed.get());
            try{StellarSourceImport.read(new ByteArrayInputStream(new byte[limit+1]),limit,()->false);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("budget"));}
        }
        try{StellarSourceImport.read(new ByteArrayInputStream(new byte[0]),1024*1024,()->false);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("empty"));}
    }
    @Test public void cancellationBeforeReadAndAtEofClosesWithoutPublishing() throws Exception {
        AtomicBoolean closed=new AtomicBoolean();
        ByteArrayInputStream unread=new ByteArrayInputStream(new byte[]{1}){public synchronized int read(byte[] b,int off,int len){fail("pre-cancelled stream read");return -1;}public void close(){closed.set(true);}};
        try{StellarSourceImport.read(unread,1024*1024,()->true);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("cancelled"));}assertTrue(closed.get());
        AtomicBoolean cancelled=new AtomicBoolean();closed.set(false);
        ByteArrayInputStream late=new ByteArrayInputStream(new byte[]{1}){public synchronized int read(byte[] b,int off,int len){int n=super.read(b,off,len);if(n==-1)cancelled.set(true);return n;}public void close(){closed.set(true);}};
        try{StellarSourceImport.read(late,1024*1024,cancelled::get);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("cancelled"));}assertTrue(closed.get());
    }
    @Test public void zeroProgressReadFallsBackToOneByteWithoutSpinning() throws Exception {
        byte[] bytes={0,1,2,3};
        ByteArrayInputStream input=new ByteArrayInputStream(bytes){public synchronized int read(byte[] b,int off,int len){return 0;}};
        assertArrayEquals(bytes,StellarSourceImport.read(input,1024*1024,()->false));
    }
}
