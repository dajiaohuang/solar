import XCTest

/// Runs the actual application against the local HTTPS Go backend started by
/// scripts/ios-native-smoke.mjs. State tests use real SPK; coverage UI tests
/// use a separately identified synthetic HTTPS route, never a science oracle.
@MainActor
final class ObservationUITests: XCTestCase {
    private func waitForLabel(_ element: XCUIElement, _ value: String, timeout: TimeInterval = 30) {
        let matches = NSPredicate(format: "label == %@", value)
        let expectation = XCTNSPredicateExpectation(predicate: matches, object: element)
        let result = XCTWaiter.wait(for: [expectation], timeout: timeout)
        XCTAssertEqual(result, .completed, "Expected \(value); actual element: \(element.debugDescription)")
    }

    override func tearDown() {
        if let run = testRun, run.failureCount > 0 {
            let app = XCUIApplication()
            screenshot(app, "failed-observation")
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "failed-observation-accessibility"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        super.tearDown()
    }

    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for _ in 0..<10 { if element.exists && element.isHittable { return }; app.swipeUp() }
        for _ in 0..<10 { if element.exists && element.isHittable { return }; app.swipeDown() }
        XCTAssertTrue(element.exists && element.isHittable, "Element could not be revealed: \(element)")
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

    func testSourceCoverageIsExplicitBoundedAndClears() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-native.backend.address", "https://127.0.0.1:18791/coverage-fixture/valid",
                               "-native.onboarding.complete", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let disclosure = app.buttons["coverage.disclosure"]
        XCTAssertTrue(app.buttons["observation.mode"].waitForExistence(timeout: 15))
        reveal(app, disclosure)
        XCTAssertFalse(app.buttons["coverage.load"].exists)
        disclosure.tap()
        let load = app.buttons["coverage.load"]
        reveal(app, load)
        waitForLabel(app.staticTexts["coverage.status"], "Load source coverage when you need an audit summary.")
        load.tap()
        waitForLabel(app.staticTexts["coverage.status"], "Source coverage loaded.")
        reveal(app, app.staticTexts["coverage.counts"])
        XCTAssertEqual(app.staticTexts["coverage.counts"].label, "Source records: 10 · mapped: 3 · unresolved: 7")
        XCTAssertEqual(app.staticTexts["coverage.targets"].label, "Explicit targets: 2 · available at audit: 2")
        reveal(app, app.staticTexts["coverage.audit"])
        XCTAssertTrue(app.staticTexts["coverage.audit"].label.contains("500.125"))
        XCTAssertTrue(app.staticTexts["coverage.audit"].label.contains("-20.5–1000.25"))
        XCTAssertTrue(app.staticTexts["coverage.audit"].label.contains("ECLIPJ2000"))
        XCTAssertEqual(app.staticTexts["coverage.windowCounts"].label, "Dependency window: 1 covered · 1 gaps")
        XCTAssertTrue(app.staticTexts["coverage.caveat"].exists)
        screenshot(app, "coverage-synthetic-summary")
        let details = app.buttons["coverage.details"]
        reveal(app, details)
        details.tap()
        for (label, character) in [("Report", "a"), ("Catalog", "b"), ("Inventory", "c"), ("Source snapshot", "d"), ("Identity mapping", "e"), ("Satellite catalog", "f")] {
            let value = app.staticTexts["\(label) SHA-256: \(String(repeating: character, count: 64))"]
            reveal(app, value)
            XCTAssertTrue(value.exists)
        }
        reveal(app, load)
        XCTAssertEqual(load.label, "Reload coverage")
        load.tap()
        waitForLabel(app.staticTexts["coverage.status"], "Source coverage is unavailable; no report was published. Unavailable does not mean zero coverage.")
        XCTAssertFalse(app.staticTexts["coverage.counts"].exists)
        XCTAssertFalse(app.buttons["coverage.details"].exists)
        screenshot(app, "coverage-unavailable-clears-counts")
        reveal(app, disclosure)
        disclosure.tap()
        XCTAssertFalse(load.exists)
        disclosure.tap()
        waitForLabel(app.staticTexts["coverage.status"], "Load source coverage when you need an audit summary.")
        app.terminate()

        let invalid = XCUIApplication()
        invalid.launchArguments = ["-native.backend.address", "https://127.0.0.1:18791/coverage-fixture/invalid",
                                   "-native.onboarding.complete", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        invalid.launch()
        let invalidDisclosure = invalid.buttons["coverage.disclosure"]
        XCTAssertTrue(invalid.buttons["observation.mode"].waitForExistence(timeout: 15))
        reveal(invalid, invalidDisclosure)
        invalidDisclosure.tap()
        reveal(invalid, invalid.buttons["coverage.load"])
        invalid.buttons["coverage.load"].tap()
        waitForLabel(invalid.staticTexts["coverage.status"], "Coverage could not be loaded. Check the HTTPS backend and try again.")
        XCTAssertFalse(invalid.staticTexts["coverage.counts"].exists)
        invalid.terminate()
    }
}
