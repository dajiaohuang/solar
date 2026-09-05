import UIKit
import SwiftUI

@MainActor
private final class NativeSceneLifecycle: ObservableObject {
    @Published var phase: ScenePhase = .inactive
}

private struct NativeSceneRoot: View {
    @ObservedObject var lifecycle: NativeSceneLifecycle

    var body: some View {
        ObservationDeckView().environment(\.scenePhase, lifecycle.phase)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let lifecycle = NativeSceneLifecycle()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // A UIKit-owned window does not have a SwiftUI App/WindowGroup to
        // publish scenePhase. Bridge this window's lifecycle explicitly;
        // otherwise the viewport can stay inactive after verified data loads.
        window?.rootViewController = UIHostingController(rootView: NativeSceneRoot(lifecycle: lifecycle))
        window?.makeKeyAndVisible()

    }

    func sceneDidBecomeActive(_ scene: UIScene) { lifecycle.phase = .active }
    func sceneWillResignActive(_ scene: UIScene) { lifecycle.phase = .inactive }
    func sceneWillEnterForeground(_ scene: UIScene) { lifecycle.phase = .inactive }
    func sceneDidEnterBackground(_ scene: UIScene) { lifecycle.phase = .background }
    func sceneDidDisconnect(_ scene: UIScene) { lifecycle.phase = .background }
}
