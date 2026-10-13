package com.lumeo.reader;

import static org.junit.Assert.*;

import org.junit.Test;

/** Basic project identity check for host-side test discovery. */
public class ExampleUnitTest {

    @Test
    public void applicationId_isLumeoReader() {
        assertEquals("com.lumeo.reader", MainActivity.class.getPackageName());
    }
}
