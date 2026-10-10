import SwiftUI
import WorkOffDeskUI

@main
struct WorkOffDeskMenuApp: App {
  @StateObject private var model: Model

  init() {
    // Watched from the start: the menu is built only when first opened, and the icon must be right before that.
    let model = Model()
    model.watch()
    _model = StateObject(wrappedValue: model)
  }

  var body: some Scene {
    MenuBarExtra {
      MenuView(model: model)
    } label: {
      MenuBarLabel(mark: model.mark)
    }
    .menuBarExtraStyle(.window)
  }
}
