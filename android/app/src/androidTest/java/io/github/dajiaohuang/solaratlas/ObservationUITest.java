package io.github.dajiaohuang.solaratlas;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.clearText;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.action.ViewActions.closeSoftKeyboard;
import static androidx.test.espresso.action.ViewActions.replaceText;
import static androidx.test.espresso.action.ViewActions.scrollTo;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.isCompletelyDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withContentDescription;
import static androidx.test.espresso.matcher.ViewMatchers.withHint;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static androidx.test.espresso.matcher.ViewMatchers.withTagValue;
import static androidx.test.espresso.matcher.ViewMatchers.withEffectiveVisibility;
import static androidx.test.espresso.matcher.ViewMatchers.Visibility.GONE;
import static org.hamcrest.CoreMatchers.is;
import static org.hamcrest.CoreMatchers.not;
import static org.hamcrest.CoreMatchers.containsString;
import static org.junit.Assert.fail;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.MotionEvent;
import android.opengl.GLSurfaceView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

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
            onView(withTagValue(is((Object) "coverage-summary"))).check(matches(withEffectiveVisibility(GONE)));
            onView(withText("Tutorial")).perform(scrollTo()).check((view, error) -> {
                if (error != null) throw error;
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
                if (insets == null) throw new AssertionError("Window insets unavailable");
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                int[] location = new int[2]; view.getLocationOnScreen(location);
                assertTrue("Tutorial must be above system navigation", location[1] + view.getHeight() <= view.getRootView().getHeight() - bars.bottom);
                assertTrue("Tutorial must be below status/cutout area", location[1] >= bars.top);
            }).perform(click());
            waitForText(containsString("First observation"));
            onView(withText("Done")).perform(click());
            onView(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("Enter an HTTPS backend"));

            onView(withText("Earth - Moon")).perform(scrollTo(), click());
            fill(BACKEND_HINT, backend);
            fill(EPOCH_HINT, "2461287.5");
            fill(IDS_HINT, "naif:399,naif:301,naif:10,unknown:fixture");
            onView(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("3 verified states - 1 data gaps"));
            waitForText(containsString("3D GPU points 3/3 (limit 100000)"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "unknown:fixture - MISSING");
            viewportScreenshot(scenario, "observation-3d.png");
            verifyInteractionRenderMode();

            onView(withText("Switch to 2D")).perform(scrollTo(), click());
            waitForText(containsString("2D GPU points 3/3 (limit 250000)"));
            viewportScreenshot(scenario, "observation-2d.png");
            verifyInteractionRenderMode();

            // Synthetic pressure delivered through the standard lifecycle
            // callback, not fabricated states or a production test-only route.
            scenario.onActivity(activity -> activity.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW));
            waitForText(containsString("2D GPU points 3/3 (limit 25000)"));
            waitForText(containsString("native memory warning"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "unknown:fixture - MISSING");
            onView(withText("Switch to 3D")).perform(scrollTo(), click());
            waitForText(containsString("3D GPU points 3/3 (limit 25000)"));
            onView(withText("Switch to 2D")).perform(scrollTo(), click());
            waitForText(containsString("2D GPU points 3/3 (limit 25000)"));

            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            waitForText(containsString("Observation released while inactive"));
            waitForText(containsString("No current display measurements."));
            onView(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("3 verified states - 1 data gaps"));
            waitForText(containsString("2D GPU points 3/3 (limit 25000)"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "unknown:fixture - MISSING");
            viewportScreenshot(scenario, "observation-resumed.png");
            // Separate, deliberately synthetic coverage cases. Real SPK state
            // routes above are untouched and verified independently by the harness.
            fill(BACKEND_HINT, backend + "/coverage-fixture/valid");
            onView(withTagValue(is((Object) "coverage-toggle"))).perform(scrollTo(), click());
            waitForText(containsString("No coverage report loaded."));
            onView(withTagValue(is((Object) "coverage-load"))).perform(scrollTo(), click());
            waitForText(containsString("Source records: 10"));
            onView(withTagValue(is((Object) "coverage-summary")))
                    .check(matches(withText(containsString("Distinct explicit NAIF targets: 2"))))
                    .check(matches(withText(containsString("Unresolved source records: 7"))))
                    .check(matches(withText(containsString("Audit ET: 500.125"))))
                    .check(matches(withText(containsString("Dependency-covered targets: 1"))))
                    .check(matches(withText(containsString("Whole-window numerical certification has not been established"))));
            coverageScreenshot(scenario, "coverage-synthetic-summary.png");
            onView(withTagValue(is((Object) "coverage-details"))).check(matches(withEffectiveVisibility(GONE)));
            onView(withTagValue(is((Object) "coverage-details-toggle"))).perform(scrollTo(), click());
            onView(withTagValue(is((Object) "coverage-details")))
                    .check(matches(withText(containsString("Catalog: coverage-fixture"))))
                    .check(matches(withText(containsString("no-explicit-naif-mapping: 6"))))
                    .check(matches(withText(containsString("Satellite catalog SHA-256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"))));
            onView(withTagValue(is((Object) "coverage-load"))).perform(scrollTo(), click());
            waitForText(containsString("Coverage report unavailable."));
            onView(withTagValue(is((Object) "coverage-summary"))).check(matches(not(withText(containsString("Source records: 10")))));
            onView(withTagValue(is((Object) "coverage-details"))).check(matches(withEffectiveVisibility(GONE))).check(matches(withText("")));
            coverageScreenshot(scenario, "coverage-unavailable.png");
            fill(BACKEND_HINT, backend + "/coverage-fixture/invalid");
            waitForText(containsString("No coverage report loaded."));
            onView(withTagValue(is((Object) "coverage-load"))).perform(scrollTo(), click());
            waitForText(containsString("Coverage could not be verified."));
            onView(withTagValue(is((Object) "coverage-toggle"))).perform(scrollTo(), click());
            onView(withTagValue(is((Object) "coverage-summary"))).check(matches(withEffectiveVisibility(GONE)));
            // Synthetic directory rows are never used as a science oracle.
            // The state request must reject changed inventory before planning.
            fill(BACKEND_HINT, backend + "/identity-fixture");
            onView(withTagValue(is((Object) "identity-toggle"))).perform(scrollTo(), click());
            onView(withTagValue(is((Object) "identity-summary"))).check(matches(withText("No source page loaded.")));
            onView(withTagValue(is((Object) "identity-load"))).perform(scrollTo(), click());
            waitForText(containsString("Records on this page: 50"));
            onView(withTagValue(is((Object) "identity-records"))).check(matches(withText(containsString("unknown:source:0"))));
            panelScreenshot(scenario, "identity-summary", "source-directory-synthetic.png");
            onView(withTagValue(is((Object) "identity-next"))).perform(scrollTo(), click());
            waitForText(containsString("Records on this page: 50"));
            onView(withTagValue(is((Object) "identity-records"))).check(matches(withText(containsString("unknown:source:50"))));
            onView(withTagValue(is((Object) "identity-next"))).check(matches(withEffectiveVisibility(GONE)));
            onView(withTagValue(is((Object) "identity-select"))).perform(scrollTo(), click());
            onView(withHint(IDS_HINT)).check(matches(withText(containsString("unknown:source:50"))));
            onView(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("Inventory changed; restart browsing"));
            onView(withTagValue(is((Object) "identity-toggle"))).perform(scrollTo(), click());
            onView(withTagValue(is((Object) "identity-records"))).check(matches(withText("")));
            passed = true;
        } finally {
            try {
                if (scenario != null && !passed) screenshot("observation-failure.png");
            } finally {
                try {
                    if (scenario != null) scenario.close();
                } finally {
                    HttpsURLConnection.setDefaultSSLSocketFactory(previousFactory);
                }
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
        onView(withHint(hint)).perform(scrollTo(), click(), clearText(), replaceText(value), closeSoftKeyboard());
    }

    private static void waitForEvidence(String... rows) {
        for (String row : rows) waitForText(containsString(row));
    }

    private static void waitForText(org.hamcrest.Matcher<String> matcher) {
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        AssertionError last = null;
        while (SystemClock.uptimeMillis() < deadline) {
            try {
                try {
                    // Dialog titles are not ScrollView descendants.
                    onView(withText(matcher)).check(matches(isDisplayed()));
                } catch (AssertionError notVisible) {
                    onView(withText(matcher)).perform(scrollTo()).check(matches(isDisplayed()));
                }
                return;
            } catch (AssertionError | androidx.test.espresso.NoMatchingViewException error) {
                if (error instanceof AssertionError) last = (AssertionError) error;
                SystemClock.sleep(100);
            }
        }
        if (last != null) throw last;
        fail("Timed out waiting for UI text");
    }

    private static void viewportScreenshot(ActivityScenario<MainActivity> scenario, String name) throws Exception {
        // Release the text field's focus before scrolling; otherwise keyboard/
        // focus restoration can scroll the viewport back out of the screenshot.
        scenario.onActivity(activity -> {
            View focus = activity.getCurrentFocus();
            if (focus != null) focus.clearFocus();
            View root = activity.findViewById(android.R.id.content);
            root.setFocusableInTouchMode(true); root.requestFocus();
        });
        int[] bounds = new int[4];
        onView(withContentDescription("Verified state GPU point observation viewport"))
                .perform(scrollTo()).check(matches(isCompletelyDisplayed()));
        // Espresso observes the UI hierarchy before SurfaceFlinger necessarily
        // presents its scroll. Fence two display frames before matching pixels.
        CountDownLatch presented = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getWindow().getDecorView().postOnAnimation(() ->
                activity.getWindow().getDecorView().postOnAnimation(presented::countDown)));
        assertTrue("Viewport frame was not presented", presented.await(5, TimeUnit.SECONDS));
        onView(withContentDescription("Verified state GPU point observation viewport"))
                .check(matches(isCompletelyDisplayed())).check((view, error) -> {
                    if (error != null) throw error;
                    int[] location = new int[2]; view.getLocationOnScreen(location);
                    bounds[0] = location[0]; bounds[1] = location[1]; bounds[2] = view.getWidth(); bounds[3] = view.getHeight();
                });
        long deadline = SystemClock.uptimeMillis() + 10_000;
        do {
            Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            try {
                int points = 0;
                for (int y = bounds[1]; y < bounds[1] + bounds[3]; y++) {
                    for (int x = bounds[0]; x < bounds[0] + bounds[2]; x++) {
                        int color = image.getPixel(x, y);
                        int r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
                        if (r >= 95 && r <= 101 && g >= 204 && g <= 211 && b >= 176 && b <= 185) points++;
                    }
                }
                // Sources may overlap in projection; this proves pixels were
                // drawn, not three spatially distinct clusters or a FPS target.
                // Three 6x6 points can cover at most108 pixels. An old screenshot
                // containing teal status text in this rectangle must not pass.
                if (points >= 30 && points <= 108) { saveScreenshot(image, name); return; }
            } finally { image.recycle(); }
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < deadline);
        fail("No verified-state point pixels in fully visible GPU viewport: " + name);
    }

    private static void verifyInteractionRenderMode() {
        onView(withContentDescription("Verified state GPU point observation viewport"))
                .check((view, error) -> {
                    if (error != null) throw error;
                    NativeObservationDeck deck = (NativeObservationDeck) view;
                    assertEquals(GLSurfaceView.RENDERMODE_WHEN_DIRTY, deck.getRenderMode());
                    long now = SystemClock.uptimeMillis();
                    MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, 20, 20, 0);
                    try {
                        deck.onTouchEvent(down);
                        assertEquals(GLSurfaceView.RENDERMODE_CONTINUOUSLY, deck.getRenderMode());
                    } finally { down.recycle(); }
                });
        try {
            // Let actual GL callbacks produce a complete measured window.
            // Three real states are not a high-load performance benchmark.
            waitForText(containsString("Interaction GL intervals:"));
        } finally {
            onView(withContentDescription("Verified state GPU point observation viewport"))
                    .check((view, error) -> {
                        if (error != null) throw error;
                        NativeObservationDeck deck = (NativeObservationDeck) view;
                        long now = SystemClock.uptimeMillis();
                        MotionEvent cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 20, 20, 0);
                        try {
                            deck.onTouchEvent(cancel);
                            assertEquals(GLSurfaceView.RENDERMODE_WHEN_DIRTY, deck.getRenderMode());
                        } finally { cancel.recycle(); }
                    });
        }
    }

    private static void coverageScreenshot(ActivityScenario<MainActivity> scenario, String name) throws Exception {
        panelScreenshot(scenario, "coverage-summary", name);
    }

    private static void panelScreenshot(ActivityScenario<MainActivity> scenario, String tag, String name) throws Exception {
        scenario.onActivity(activity -> {
            View focus = activity.getCurrentFocus();
            if (focus != null) focus.clearFocus();
            View root = activity.findViewById(android.R.id.content);
            root.setFocusableInTouchMode(true); root.requestFocus();
        });
        onView(withTagValue(is((Object) tag))).perform(scrollTo()).check(matches(isCompletelyDisplayed()));
        CountDownLatch presented = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getWindow().getDecorView().postOnAnimation(() ->
                activity.getWindow().getDecorView().postOnAnimation(presented::countDown)));
        assertTrue("Coverage frame was not presented", presented.await(5, TimeUnit.SECONDS));
        screenshot(name);
    }

    private static void saveScreenshot(Bitmap image, String name) throws Exception {
        File root = InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir("solar-native-smoke");
        if (root == null || (!root.exists() && !root.mkdirs())) throw new IllegalStateException("Cannot create screenshot directory");
        try (FileOutputStream stream = new FileOutputStream(new File(root, name), false)) {
            if (!image.compress(Bitmap.CompressFormat.PNG, 100, stream)) throw new IllegalStateException("Screenshot encoding failed");
        }
    }

    private static void screenshot(String name) {
        try {
            Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            try { saveScreenshot(image, name); } finally { image.recycle(); }
        } catch (Exception error) {
            // Preserve the original UI assertion when a failure screenshot is unavailable.
            if (!name.contains("failure")) throw new AssertionError("Screenshot failed: " + error.getMessage(), error);
        }
    }
}
