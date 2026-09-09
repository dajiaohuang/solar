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

import android.accessibilityservice.AccessibilityService;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.MotionEvent;
import android.opengl.GLSurfaceView;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import androidx.test.core.app.ActivityScenario;
import androidx.test.espresso.NoMatchingViewException;
import androidx.test.espresso.PerformException;
import androidx.test.espresso.ViewInteraction;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
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
import java.util.Collection;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;

/** Real Go HTTPS/native UI smoke; test-only trust is scoped to this process. */
@RunWith(AndroidJUnit4.class)
public final class ObservationUITest {
    private static final long UI_TIMEOUT_MS = 30_000;
    private static final long FRONT_REQUEST_INTERVAL_MS = 2_000;
    private static final String BACKEND_HINT = "Full-version backend HTTPS address";
    private static final String EPOCH_HINT = "TDB Julian date";
    private static final String IDS_HINT = "Body IDs separated by commas or whitespace (custom selection)";
    private static final java.util.concurrent.atomic.AtomicLong lastFrontRequestAt =
            new java.util.concurrent.atomic.AtomicLong(Long.MIN_VALUE);

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
            // Fresh API 36 emulators can resume the activity before the window
            // has input focus. Espresso then fails immediately; recover first.
            awaitInteractiveWindow();

            // Exercise the unconfigured first screen before entering network data.
            waitForText(containsString("No observation loaded"));
            shown(withTagValue(is((Object) "coverage-summary"))).check(matches(withEffectiveVisibility(GONE)));
            shown(withText("Tutorial")).perform(scrollTo()).check((view, error) -> {
                if (error != null) throw error;
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
                if (insets == null) throw new AssertionError("Window insets unavailable");
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                int[] location = new int[2]; view.getLocationOnScreen(location);
                assertTrue("Tutorial must be above system navigation", location[1] + view.getHeight() <= view.getRootView().getHeight() - bars.bottom);
                assertTrue("Tutorial must be below status/cutout area", location[1] >= bars.top);
            // A separate Espresso assertion yields to another layout/insets
            // pass. Re-establish visibility immediately before the real click,
            // as for the other actions below; do not bypass click constraints.
            }).perform(scrollTo(), click());
            waitForText(containsString("First observation"));
            shown(withText("Done")).perform(click());
            shown(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("Enter an HTTPS backend"));

            shown(withText("Earth - Moon")).perform(scrollTo(), click());
            fill(BACKEND_HINT, backend);
            fill(EPOCH_HINT, "2461287.5");
            fill(IDS_HINT, "naif:399,naif:301,naif:10,naif:120050000,naif:920000617,unknown:fixture");
            shown(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("4 verified states - 2 data gaps"));
            waitForText(containsString("3D GPU points 4/4 (limit 100000)"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "naif:120050000 - VERIFIED", "naif:920000617 - MISSING - missing-compatible-system-center", "unknown:fixture - MISSING");
            viewportScreenshot(scenario, "observation-3d.png");
            verifyInteractionRenderMode();

            shown(withText("Switch to 2D")).perform(scrollTo(), click());
            waitForText(containsString("2D GPU points 4/4 (limit 250000)"));
            viewportScreenshot(scenario, "observation-2d.png");
            verifyInteractionRenderMode();

            // Synthetic pressure delivered through the standard lifecycle
            // callback, not fabricated states or a production test-only route.
            scenario.onActivity(activity -> activity.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW));
            waitForText(containsString("2D GPU points 4/4 (limit 25000)"));
            waitForText(containsString("native memory warning"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "naif:120050000 - VERIFIED", "naif:920000617 - MISSING - missing-compatible-system-center", "unknown:fixture - MISSING");
            shown(withText("Switch to 3D")).perform(scrollTo(), click());
            waitForText(containsString("3D GPU points 4/4 (limit 25000)"));
            shown(withText("Switch to 2D")).perform(scrollTo(), click());
            waitForText(containsString("2D GPU points 4/4 (limit 25000)"));

            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            waitForText(containsString("Observation released while inactive"));
            waitForText(containsString("No current display measurements."));
            shown(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("4 verified states - 2 data gaps"));
            waitForText(containsString("2D GPU points 4/4 (limit 25000)"));
            waitForEvidence("naif:399 - VERIFIED", "naif:301 - VERIFIED", "naif:10 - VERIFIED", "naif:120050000 - VERIFIED", "naif:920000617 - MISSING - missing-compatible-system-center", "unknown:fixture - MISSING");
            viewportScreenshot(scenario, "observation-resumed.png");
            // Separate, deliberately synthetic coverage cases. Real SPK state
            // routes above are untouched and verified independently by the harness.
            fill(BACKEND_HINT, backend + "/coverage-fixture/valid");
            shown(withTagValue(is((Object) "coverage-toggle"))).perform(scrollTo(), click());
            waitForText(containsString("No coverage report loaded."));
            shown(withTagValue(is((Object) "coverage-load"))).perform(scrollTo(), click());
            waitForText(containsString("Source records: 10"));
            shown(withTagValue(is((Object) "coverage-summary")))
                    .check(matches(withText(containsString("Distinct explicit NAIF targets: 2"))))
                    .check(matches(withText(containsString("Unresolved source records: 7"))))
                    .check(matches(withText(containsString("Audit ET: 500.125"))))
                    .check(matches(withText(containsString("Dependency-covered targets: 1"))))
                    .check(matches(withText(containsString("Whole-window numerical certification has not been established"))));
            coverageScreenshot(scenario, "coverage-synthetic-summary.png");
            shown(withTagValue(is((Object) "coverage-details"))).check(matches(withEffectiveVisibility(GONE)));
            shown(withTagValue(is((Object) "coverage-details-toggle"))).perform(scrollTo(), click());
            shown(withTagValue(is((Object) "coverage-details")))
                    .check(matches(withText(containsString("Catalog: coverage-fixture"))))
                    .check(matches(withText(containsString("no-explicit-naif-mapping: 6"))))
                    .check(matches(withText(containsString("Satellite catalog SHA-256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"))));
            shown(withTagValue(is((Object) "coverage-load"))).perform(scrollTo(), click());
            waitForText(containsString("Coverage report unavailable."));
            shown(withTagValue(is((Object) "coverage-summary"))).check(matches(not(withText(containsString("Source records: 10")))));
            shown(withTagValue(is((Object) "coverage-details"))).check(matches(withEffectiveVisibility(GONE))).check(matches(withText("")));
            coverageScreenshot(scenario, "coverage-unavailable.png");
            fill(BACKEND_HINT, backend + "/coverage-fixture/invalid");
            waitForText(containsString("No coverage report loaded."));
            shown(withTagValue(is((Object) "coverage-load"))).perform(scrollTo(), click());
            waitForText(containsString("Coverage could not be verified."));
            shown(withTagValue(is((Object) "coverage-toggle"))).perform(scrollTo(), click());
            shown(withTagValue(is((Object) "coverage-summary"))).check(matches(withEffectiveVisibility(GONE)));
            // Synthetic directory rows are never used as a science oracle.
            // The state request must reject changed inventory before planning.
            fill(BACKEND_HINT, backend + "/identity-fixture");
            shown(withTagValue(is((Object) "identity-toggle"))).perform(scrollTo(), click());
            shown(withTagValue(is((Object) "identity-summary"))).check(matches(withText("No source page loaded.")));
            shown(withTagValue(is((Object) "identity-load"))).perform(scrollTo(), click());
            waitForText(containsString("Records on this page: 50"));
            shown(withTagValue(is((Object) "identity-records"))).check(matches(withText(containsString("unknown:source:0"))));
            panelScreenshot(scenario, "identity-summary", "source-directory-synthetic.png");
            shown(withTagValue(is((Object) "identity-next"))).perform(scrollTo(), click());
            waitForText(containsString("Records on this page: 50"));
            shown(withTagValue(is((Object) "identity-records"))).check(matches(withText(containsString("unknown:source:50"))));
            shown(withTagValue(is((Object) "identity-next"))).check(matches(withEffectiveVisibility(GONE)));
            shown(withTagValue(is((Object) "identity-select"))).perform(scrollTo(), click());
            shown(withHint(IDS_HINT)).check(matches(withText(containsString("unknown:source:50"))));
            shown(withText("Load observation")).perform(scrollTo(), click());
            waitForText(containsString("Inventory changed; restart browsing"));
            shown(withTagValue(is((Object) "identity-toggle"))).perform(scrollTo(), click());
            shown(withTagValue(is((Object) "identity-records"))).check(matches(withText("")));
            String realDirectory = args.getString("solarRealDirectory");
            if (realDirectory != null) {
                org.json.JSONObject expected = new org.json.JSONObject(new String(Base64.getDecoder().decode(realDirectory), StandardCharsets.UTF_8));
                org.json.JSONArray sourceIds = expected.getJSONArray("sourceIds");
                java.util.List<String> selected = new java.util.ArrayList<>();
                for (int i = 0; i < sourceIds.length(); i++) selected.add(sourceIds.getString(i));
                assertEquals("Real source page must contain 50 original IDs", 50, selected.size());
                fill(BACKEND_HINT, backend + "/source-directory-real");
                fill(EPOCH_HINT, Double.toString(expected.getDouble("epochJd")));
                fill("Reference body ID", expected.getString("reference"));
                shown(withTagValue(is((Object) "identity-toggle"))).perform(scrollTo(), click());
                shown(withTagValue(is((Object) "identity-load"))).perform(scrollTo(), click());
                waitForText(containsString("Source records: " + expected.getLong("totalRecords")));
                shown(withTagValue(is((Object) "identity-records"))).check(matches(withText(containsString(expected.getString("inventoryHash")))));
                panelScreenshot(scenario, "identity-summary", "source-directory-real.png");
                shown(withTagValue(is((Object) "identity-select"))).perform(scrollTo(), click());
                shown(withHint(IDS_HINT)).check(matches(withText(String.join(",", selected))));
                shown(withText("Load observation")).perform(scrollTo(), click());
                int exact = expected.getInt("exactCount"), missing = expected.getInt("missingCount");
                waitForText(containsString(exact + " verified states - " + missing + " data gaps"));
                waitForText(containsString("2D GPU points " + exact + "/" + exact + " (limit 25000)"));
                viewportScreenshot(scenario, "source-directory-real-2d.png", exact);
                shown(withText("Switch to 3D")).perform(scrollTo(), click());
                waitForText(containsString("3D GPU points " + exact + "/" + exact + " (limit 25000)"));
                viewportScreenshot(scenario, "source-directory-real-3d.png", exact);
            }
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

    private static ViewInteraction shown(org.hamcrest.Matcher<View> matcher) {
        awaitInteractiveWindow();
        // Let Espresso choose its focused application root. A custom
        // touchable-root matcher can select Android's insertion-handle popup
        // or a never-focused instrumentation root on API 36.
        recoverInteractiveWindow();
        return onView(matcher);
    }

    private static void fill(String hint, String value) {
        // Use Espresso's default root for editor fields. The touchable-root
        // matcher can select Android's non-focusable insertion-handle popup
        // after the previous field closes, hiding the real EditText from the
        // matcher even though it remains on the activity screen.
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        Throwable last = null;
        while (SystemClock.uptimeMillis() < deadline) {
            try {
                awaitInteractiveWindow();
                shown(withHint(hint)).perform(scrollTo(), click(), clearText(), replaceText(value), closeSoftKeyboard());
                awaitInteractiveWindow();
                return;
            } catch (AssertionError | NoMatchingViewException | PerformException error) {
                last = error;
                recoverInteractiveWindow();
                awaitInteractiveWindow();
                SystemClock.sleep(100);
            }
        }
        if (last instanceof AssertionError) throw (AssertionError) last;
        if (last instanceof RuntimeException) throw (RuntimeException) last;
        fail("Timed out filling editor: " + hint);
    }

    private static void waitForEvidence(String... rows) {
        for (String row : rows) waitForText(containsString(row));
    }

    private static void awaitInteractiveWindow() {
        long deadline = SystemClock.uptimeMillis() + 5_000;
        int stableFocusSamples = 0;
        while (SystemClock.uptimeMillis() < deadline) {
            if (hasWindowFocus()) {
                if (++stableFocusSamples >= 2) return;
            } else {
                stableFocusSamples = 0;
                recoverInteractiveWindow();
            }
            SystemClock.sleep(100);
        }
        // Focus recovery is best-effort on headless first-boot API 36
        // emulators; Espresso will choose the focused application root.
    }

    private static boolean hasWindowFocus() {
        AtomicBoolean focused = new AtomicBoolean();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Collection<Activity> resumed = ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(Stage.RESUMED);
            if (!resumed.isEmpty()) focused.set(resumed.iterator().next().hasWindowFocus());
        });
        return focused.get();
    }

    private static void recoverInteractiveWindow() {
        if (hasWindowFocus()) return;
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        instrumentation.setInTouchMode(true);
        // A system ANR dialog can cover the activity while the activity still
        // reports window focus. Probe and dismiss it before relying on that
        // focus signal; with no dialog this is a no-op.
        boolean quickstepDialogSeen = dismissQuickstepNotResponding(instrumentation);
        // API 36's freshly booted emulator can show a system Quickstep
        // "isn't responding" dialog above the app. That dialog owns focus and
        // makes Espresso's default root picker fail even though the target
        // activity is still resumed. The dialog helper already clicks its own
        // Wait action when possible. Never send a global BACK here: if the
        // dialog closes between the accessibility probe and this branch,
        // Android delivers BACK to the target task and finishes MainActivity.
        // Keep the existing activity alive and let the next focus probe retry.
        if (!hasWindowFocus() && quickstepDialogSeen) {
            dismissQuickstepNotResponding(instrumentation);
        }
        try {
            instrumentation.getUiAutomation().performGlobalAction(
                    AccessibilityService.GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE);
        } catch (RuntimeException ignored) {
            // Shade dismissal is best-effort on a headless first-boot emulator.
        }
        try {
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_WAKEUP);
        } catch (SecurityException ignored) {
            // Headless emulators can reject injected keys while SystemUI holds the display.
        }
        instrumentation.runOnMainSync(() -> {
            Collection<Activity> resumed = ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(Stage.RESUMED);
            if (resumed.isEmpty()) return;
            Activity activity = resumed.iterator().next();
            if (activity.hasWindowFocus()) return;
            // API 36 can leave the target task behind the instrumentation
            // EmptyActivity after launch or a keyboard transition. Reorder
            // the existing singleTask activity to the front before asking
            // Espresso to pick its root; this preserves the observation state
            // and does not bypass any click or input constraint.
            long now = SystemClock.uptimeMillis();
            long previous = lastFrontRequestAt.get();
            if ((previous == Long.MIN_VALUE || now - previous >= FRONT_REQUEST_INTERVAL_MS)
                    && lastFrontRequestAt.compareAndSet(previous, now)) {
                try {
                    activity.startActivity(new Intent(activity, MainActivity.class)
                            .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                } catch (RuntimeException ignored) {
                    // Best-effort; the normal focus request below still handles
                    // emulators where the task is already foregrounded.
                }
            }
            View decor = activity.getWindow().getDecorView();
            decor.setFocusable(true);
            decor.setFocusableInTouchMode(true);
            decor.requestFocus();
        });
    }

    private static boolean dismissQuickstepNotResponding(Instrumentation instrumentation) {
        long deadline = SystemClock.uptimeMillis() + 1_500;
        boolean dialogSeen = false;
        while (SystemClock.uptimeMillis() < deadline) {
            AccessibilityNodeInfo activeRoot = null;
            try {
                android.app.UiAutomation automation = instrumentation.getUiAutomation();
                activeRoot = automation.getRootInActiveWindow();
                dialogSeen |= hasWaitAction(activeRoot);
                if (clickWaitAction(activeRoot)) return true;
                for (AccessibilityWindowInfo window : automation.getWindows()) {
                    AccessibilityNodeInfo root = null;
                    try {
                        root = window.getRoot();
                        dialogSeen |= hasWaitAction(root);
                        if (clickWaitAction(root)) return true;
                    } finally {
                        if (root != null) root.recycle();
                        window.recycle();
                    }
                }
            } catch (RuntimeException ignored) {
                // SystemUI can reject accessibility queries during first boot.
            } finally {
                if (activeRoot != null) activeRoot.recycle();
            }
            SystemClock.sleep(100);
        }
        return dialogSeen;
    }

    private static boolean hasWaitAction(AccessibilityNodeInfo root) {
        if (root == null) return false;
        java.util.List<AccessibilityNodeInfo> waitNodes =
                root.findAccessibilityNodeInfosByText("Wait");
        if (!waitNodes.isEmpty()) return true;
        // Some API 36 SystemUI builds expose the ANR action through a
        // content description rather than a text match.
        return hasWaitDescription(root);
    }

    private static boolean clickWaitAction(AccessibilityNodeInfo root) {
        if (root == null) return false;
        java.util.List<AccessibilityNodeInfo> waitNodes =
                root.findAccessibilityNodeInfosByText("Wait");
        for (AccessibilityNodeInfo node : waitNodes) {
            AccessibilityNodeInfo current = node;
            for (int depth = 0; current != null && depth < 12; depth++) {
                if (clickVisibleNode(current)) {
                    return true;
                }
                current = current.getParent();
            }
        }
        return clickWaitDescription(root);
    }

    private static boolean clickVisibleNode(AccessibilityNodeInfo node) {
        if (node == null || !node.isVisibleToUser()) return false;
        node.refresh();
        if (node.isClickable()
                && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            return true;
        }
        return false;
    }

    private static boolean hasWaitDescription(AccessibilityNodeInfo root) {
        java.util.List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText("Wait");
        if (!nodes.isEmpty()) return true;
        return findDescription(root, false);
    }

    private static boolean clickWaitDescription(AccessibilityNodeInfo root) {
        return findDescription(root, true);
    }

    private static boolean findDescription(AccessibilityNodeInfo node, boolean click) {
        if (node == null) return false;
        CharSequence description = node.getContentDescription();
        if (description != null && description.toString().equalsIgnoreCase("Wait")) {
            if (!click) return true;
            AccessibilityNodeInfo current = node;
            for (int depth = 0; current != null && depth < 12; depth++) {
                if (clickVisibleNode(current)) return true;
                current = current.getParent();
            }
        }
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (findDescription(child, click)) return true;
            if (child != null) child.recycle();
        }
        return false;
    }

    private static void waitForText(org.hamcrest.Matcher<String> matcher) {
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        Throwable last = null;
        while (SystemClock.uptimeMillis() < deadline) {
            try {
                try {
                    // Dialog titles are not ScrollView descendants.
                    shown(withText(matcher)).check(matches(isDisplayed()));
                } catch (AssertionError notVisible) {
                    shown(withText(matcher)).perform(scrollTo()).check(matches(isDisplayed()));
                }
                return;
            } catch (AssertionError | NoMatchingViewException | PerformException error) {
                last = error;
                recoverInteractiveWindow();
                SystemClock.sleep(100);
            }
        }
        if (last instanceof AssertionError) throw (AssertionError) last;
        if (last instanceof RuntimeException) throw (RuntimeException) last;
        if (last != null) throw new AssertionError(last);
        fail("Timed out waiting for UI text");
    }

    private static void viewportScreenshot(ActivityScenario<MainActivity> scenario, String name) throws Exception {
        viewportScreenshot(scenario, name, 3);
    }

    private static void viewportScreenshot(ActivityScenario<MainActivity> scenario, String name, int exactPoints) throws Exception {
        // Release the text field's focus before scrolling; otherwise keyboard/
        // focus restoration can scroll the viewport back out of the screenshot.
        scenario.onActivity(activity -> {
            View focus = activity.getCurrentFocus();
            if (focus != null) focus.clearFocus();
            View root = activity.findViewById(android.R.id.content);
            root.setFocusableInTouchMode(true); root.requestFocus();
        });
        int[] bounds = new int[4];
        shown(withContentDescription("Verified state GPU point observation viewport"))
                .perform(scrollTo()).check(matches(isCompletelyDisplayed()));
        // Espresso observes the UI hierarchy before SurfaceFlinger necessarily
        // presents its scroll. Fence two display frames before matching pixels.
        CountDownLatch presented = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getWindow().getDecorView().postOnAnimation(() ->
                activity.getWindow().getDecorView().postOnAnimation(presented::countDown)));
        assertTrue("Viewport frame was not presented", presented.await(5, TimeUnit.SECONDS));
        shown(withContentDescription("Verified state GPU point observation viewport"))
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
                // Each 6x6 point can cover at most36 pixels. An old screenshot
                // containing teal status text in this rectangle must not pass.
                if (points >= 30 && points <= exactPoints * 36) { saveScreenshot(image, name); return; }
            } finally { image.recycle(); }
            SystemClock.sleep(100);
        } while (SystemClock.uptimeMillis() < deadline);
        fail("No verified-state point pixels in fully visible GPU viewport: " + name);
    }

    private static void verifyInteractionRenderMode() {
        shown(withContentDescription("Verified state GPU point observation viewport"))
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
            shown(withContentDescription("Verified state GPU point observation viewport"))
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
        shown(withTagValue(is((Object) tag))).perform(scrollTo()).check(matches(isCompletelyDisplayed()));
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
