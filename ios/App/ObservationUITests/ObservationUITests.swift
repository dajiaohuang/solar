import XCTest

/// Runs the actual application against the local HTTPS Go backend started by
/// scripts/ios-native-smoke.mjs. No URLProtocol mocks or bundled state fixtures.
@MainActor
final class ObservationUITests: XCTestCase {
    private func waitForLabel(_ element: XCUIElement, _ value: String, timeout: TimeInterval = 30) {
        let matches = NSPredicate(format: "label == %@", value)
        let expectation = XCTNSPredicateExpectation(predicate: matches, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
    }

    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRealEarthMoonStatesAndNativeModes() {
        continueAfterFailure = false
        let app = XCUIApplication()
        // Standard UserDefaults launch arguments configure the same user-facing
        // address field. The production app has no test-specific network path.
        app.launchArguments = ["-native.backend.address", "https://127.0.0.1:18791",
                               "-native.onboarding.complete", "YES",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.buttons["observation.mode"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons["observation.mode"].label, "Switch to 2D")

        let earth = app.buttons["preset.earth"]
        XCTAssertTrue(earth.waitForExistence(timeout: 10))
        earth.tap()
        waitForLabel(app.staticTexts["observation.status"], "3 verified states · 0 data gaps")
        waitForLabel(app.staticTexts["observation.displayed"], "3/3 displayed · 250,000 display limit")
        screenshot(app, "earth-moon-native-3d")

        app.buttons["observation.mode"].tap()
        waitForLabel(app.staticTexts["observation.displayed"], "3/3 displayed · 500,000 display limit")
        screenshot(app, "earth-moon-native-2d")
        app.buttons["observation.mode"].tap()
        waitForLabel(app.staticTexts["observation.displayed"], "3/3 displayed · 250,000 display limit")

        // Repeat the same online plan. The server-side request ledger proves
        // that a verified disk tile is reused without another tile download.
        app.buttons["observation.load"].tap()
        waitForLabel(app.staticTexts["observation.status"], "3 verified states · 0 data gaps")
        waitForLabel(app.staticTexts["observation.displayed"], "3/3 displayed · 250,000 display limit")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["observation.load"].waitForExistence(timeout: 10))
        waitForLabel(app.staticTexts["observation.status"], "3 verified states · 0 data gaps")
        screenshot(app, "earth-moon-resumed")
        app.terminate()
    }

    func testFirstLaunchAndMissingBackendAreExplicit() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-native.backend.address", "", "-native.onboarding.complete", "NO",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.buttons["Start tutorial"].waitForExistence(timeout: 15))
        app.buttons["Start tutorial"].tap()
        XCTAssertTrue(app.navigationBars["First observation"].waitForExistence(timeout: 10))
        screenshot(app, "first-use-tutorial")
        app.buttons["Done"].tap()
        app.buttons["observation.load"].tap()
        XCTAssertTrue(app.staticTexts["observation.status"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["observation.displayed"].exists)
        XCTAssertFalse(app.staticTexts["observation.status"].label.contains("verified states ·"))
        screenshot(app, "missing-backend-no-invented-states")
        app.terminate()
    }
}
