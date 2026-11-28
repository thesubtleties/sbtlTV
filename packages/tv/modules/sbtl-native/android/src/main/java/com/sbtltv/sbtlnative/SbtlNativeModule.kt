package com.sbtltv.sbtlnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SbtlNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SbtlNative")
    Function("hello") { "sbtl-native" }
  }
}
