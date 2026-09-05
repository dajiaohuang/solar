package io.github.dajiaohuang.solaratlas;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.clearText;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.action.ViewActions.closeSoftKeyboard;
import static androidx.test.espresso.action.ViewActions.replaceText;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withHint;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.hamcrest.CoreMatchers.containsString;
import static org.junit.Assert.fail;

import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Base64;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;

/** Real Go HTTPS/native UI smoke; test-only trust is scoped to this process. */
@RunWith(AndroidJUnit4.class)
public final class ObservationUITest {
    private static final long UI_TIMEOUT_MS = 30_000;
    private static final String BACKEND_HINT = "Full-version backend HTTPS address";
    private static final String EPOCH_HINT = "TDB Julian date";
    private static final String IDS_HINT = "Body IDs separated by commas or whitespace (custom selection)";

    @Test
    public void realEarthMoonStatesModesAndCacheReuse() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String backend = requiredArg(args, "solarBackend");
        String caBase64 = requiredArg(args, "solarCaBase64");
        SSLSocketFactory previousFactory = HttpsURLConnection.getDefaultSSLSocketFactory();
        ActivityScenario<MainActivity> scenario = null;
        boolean passed = false;
        try {
            HttpsURLConnection.setDefaultSSLSocketFactory(testCaFactory(caBase64));
            scenario = ActivityScenario.launch(MainActivity.class);

            // Exercise the unconfigured first screen before entering network data.
            waitForText(containsString("No observation loaded"));
            onView(withText("Tutorial")).perform(click());
            waitForText(containsString("First observation"));
            onView(withText("Done")).perform(click());
            onView(withText("Load observation")).perform(click());
            waitForText(containsString("Enter an HTTPS backend"));

            fill(BACKEND_HINT, backend);
            fill(EPOCH_HINT, "2461287.5");
            fill(IDS_HINT, "naif:399,naif:301,naif:10,unknown:fixture");
            onView(withText("Load observation")).perform(click());
            waitForText(containsString("3 verified states - 1 data gaps"));
            waitForText(containsString("3D GPU points 3/3 (limit 250000)"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "unknown:fixture - MISSING");
            screenshot("observation-3d.png");

            onView(withText("Switch to 2D")).perform(click());
            waitForText(containsString("2D GPU points 3/3 (limit 500000)"));
            screenshot("observation-2d.png");

            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            waitForText(containsString("Observation released while inactive"));
            onView(withText("Load observation")).perform(click());
            waitForText(containsString("3 verified states - 1 data gaps"));
            waitForText(containsString("2D GPU points 3/3 (limit 500000)"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "unknown:fixture - MISSING");
            screenshot("observation-resumed.png");
            passed = true;
        } finally {
            try {
                if (scenario != null && !passed) screenshot("observation-failure.png");
            } finally {
                if (scenario != null) scenario.close();
                HttpsURLConnection.setDefaultSSLSocketFactory(previousFactory);
            }
        }
    }

    private static String requiredArg(Bundle args, String name) {
        String value = args.getString(name);
        if (value == null || value.trim().isEmpty()) fail("Missing instrumentation argument: " + name);
        return value.trim();
    }

    private static SSLSocketFactory testCaFactory(String encodedPem) throws Exception {
        byte[] pem = Base64.getDecoder().decode(encodedPem.getBytes(StandardCharsets.US_ASCII));
        CertificateFactory certificates = CertificateFactory.getInstance("X.509");
        Certificate ca = certificates.generateCertificate(new ByteArrayInputStream(pem));
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
        store.load(null, null);
        store.setCertificateEntry("solar-native-smoke-ca", ca);
        TrustManagerFactory managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        managers.init(store);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, managers.getTrustManagers(), null);
        return context.getSocketFactory();
    }

    private static void fill(String hint, String value) {
        onView(withHint(hint)).perform(click(), clearText(), replaceText(value), closeSoftKeyboard());
    }

    private static void waitForEvidence(String... rows) {
        for (String row : rows) waitForText(containsString(row));
    }

    private static void waitForText(org.hamcrest.Matcher<String> matcher) {
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        AssertionError last = null;
        while (SystemClock.uptimeMillis() < deadline) {
            try {
                onView(withText(matcher)).check(matches(isDisplayed()));
                return;
            } catch (AssertionError error) {
                last = error;
                SystemClock.sleep(100);
            }
        }
        if (last != null) throw last;
        fail("Timed out waiting for UI text");
    }

    private static void screenshot(String name) {
        try {
            Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            File root = InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir("solar-native-smoke");
            if (root == null || (!root.exists() && !root.mkdirs())) throw new IllegalStateException("Cannot create screenshot directory");
            File output = new File(root, name);
            try (FileOutputStream stream = new FileOutputStream(output, false)) {
                if (!image.compress(Bitmap.CompressFormat.PNG, 100, stream)) throw new IllegalStateException("Screenshot encoding failed");
            }
        } catch (Exception error) {
            // Preserve the original UI assertion when a failure screenshot is unavailable.
            if (!name.contains("failure")) throw new AssertionError("Screenshot failed: " + error.getMessage(), error);
        }
    }
}
